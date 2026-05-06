"""Seed the database with realistic building telemetry per the assessment brief.

Defaults to 7 days of 5-minute readings, split 3 manual / 4 AI to match
the brief's Before/After story:

    Day 1–3  Manual operation — all non-critical machines run 06:00–22:00
             regardless of need, setpoints stuck at 25°C, ~15% higher energy.
    Day 4–7  AI control — zone-aware schedules, dynamic setpoints, scheduled
             shutdowns (AC-S3 off at 14:30 when meeting rooms empty, etc.),
             ~15% lower energy. ~10 AI decisions per day are logged.

Sensor patterns follow the brief's Data Guide:
    AC power_kw     30–80% of rated when ON, 0 when OFF
    Fan power_kw    40–70% of rated when ON
    AC temperature  22–27°C, follows setpoint with drift driven by outdoor temp
    AC setpoint     23–26°C (manual fixed at 25; AI varies by zone + time)
    Fan speed_pct   40–80% when ON

Outdoor temperature is modelled as a sinusoidal day cycle (24°C overnight low
→ 34°C mid-afternoon peak) so AC load tracks reality: hotter outside ⇒ higher
power draw to hold the same setpoint. Indoor temp follows setpoint + drift,
where drift correlates with outdoor heat and the period (manual = sloppier
control, AI = tighter band).

Usage:
    python manage.py seed                # default — 7 days, additive
    python manage.py seed --clear        # wipe sensor + decision tables first
    python manage.py seed --days 14      # longer window (3/7 manual/AI ratio kept)
    python manage.py seed --seed 7       # different RNG seed for variety
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from building.models import AIDecision, Machine, SensorReading


# Schedule hours ("06:00 opens", "22:00 night mode") are Bangkok local.
# Generate in BANGKOK_TZ; Django converts to UTC on save (USE_TZ=True).
BANGKOK_TZ = timezone(timedelta(hours=7))


# Machine registry — names/zones/ratings from the brief's appendix.
MACHINES: list[dict] = [
    {"name": "AC-L1",  "machine_type": "large_ac", "zone": "Zone A (Lobby & Ground)",  "rated_power_kw": 45.0, "is_critical": False},
    {"name": "AC-L2",  "machine_type": "large_ac", "zone": "Zone B (Floors 1-3)",      "rated_power_kw": 45.0, "is_critical": False},
    {"name": "AC-L3",  "machine_type": "large_ac", "zone": "Zone C (Floors 4-6)",      "rated_power_kw": 45.0, "is_critical": False},
    {"name": "AC-S1",  "machine_type": "small_ac", "zone": "Floor 1 Office",           "rated_power_kw": 12.0, "is_critical": False},
    {"name": "AC-S2",  "machine_type": "small_ac", "zone": "Floor 2 Office",           "rated_power_kw": 12.0, "is_critical": False},
    {"name": "AC-S3",  "machine_type": "small_ac", "zone": "Floor 3 Meeting Rooms",    "rated_power_kw": 10.0, "is_critical": False},
    {"name": "AC-S4",  "machine_type": "small_ac", "zone": "Floor 5 Executive",        "rated_power_kw": 10.0, "is_critical": False},
    {"name": "AC-S5",  "machine_type": "small_ac", "zone": "Server Room (24/7)",       "rated_power_kw": 15.0, "is_critical": True},
    {"name": "FAN-01", "machine_type": "fan",      "zone": "Basement Parking",         "rated_power_kw": 5.5,  "is_critical": True},
    {"name": "FAN-02", "machine_type": "fan",      "zone": "Ground Floor",             "rated_power_kw": 3.5,  "is_critical": False},
    {"name": "FAN-03", "machine_type": "fan",      "zone": "Floors 1-3",               "rated_power_kw": 4.0,  "is_critical": False},
    {"name": "FAN-04", "machine_type": "fan",      "zone": "Floors 4-6",               "rated_power_kw": 4.0,  "is_critical": False},
]


@dataclass(frozen=True)
class MachineCtx:
    id: int
    name: str
    machine_type: str
    zone: str
    rated_power_kw: float
    is_critical: bool


# Schedules — when each machine is ON. Manual = flat 06:00–22:00 baseline;
# AI = zone-aware per the brief's daily-pattern table.

# Minute-of-day windows [start, end). 06:00=360, 18:30=1110, 22:00=1320.
AI_SCHEDULE: dict[str, tuple[int, int]] = {
    "AC-L1":  (6 * 60,    23 * 60),         # Lobby: 06:00–23:00 (extended hours, night mode at 22:00 still ON)
    "AC-L2":  (6 * 60,    19 * 60),         # Floors 1–3: 06:00–19:00 (evening shutdown)
    "AC-L3":  (6 * 60,    19 * 60),         # Floors 4–6: 06:00–19:00 (evening shutdown)
    "AC-S1":  (7 * 60,    18 * 60 + 30),    # Floor 1 Office: 07:00–18:30
    "AC-S2":  (7 * 60,    18 * 60 + 30),    # Floor 2 Office: 07:00–18:30
    "AC-S3":  (8 * 60,    14 * 60 + 30),    # Meeting Rooms: 08:00–14:30 (auto-off when empty)
    "AC-S4":  (7 * 60,    18 * 60 + 30),    # Executive: 07:00–18:30
    "FAN-02": (6 * 60 + 15, 19 * 60),       # Ground: 06:15–19:00
    "FAN-03": (6 * 60 + 15, 19 * 60),       # Floors 1–3: 06:15–19:00
    "FAN-04": (6 * 60 + 15, 19 * 60),       # Floors 4–6: 06:15–19:00
}

MANUAL_WINDOW = (6 * 60, 22 * 60)


# DayPlan = single source of truth for one AI day's setpoints/timings.
# Both the reading generator AND the decision generator consult the same
# plan, so the chart shows changes at the same minute the decision logs.
# Without per-day variation the AI looks like a cron job, not a learner.


@dataclass(frozen=True)
class DayPlan:
    # Outdoor peak (°C) for the day's sinusoidal temperature curve.
    # Real Bangkok varies 32–36°C peak in dry season.
    outdoor_peak_c: float

    # AC-L1 lobby setpoint schedule.
    ac_l1_morning_drop_min: int   # canonical 09:30 ± 15 min
    ac_l1_morning_setpoint: float  # canonical 24.0 ± 0.5
    ac_l1_evening_relax_min: int  # canonical 17:00 ± 15 min
    ac_l1_evening_setpoint: float  # canonical 26.0 ± 0.5
    ac_l1_night_setpoint: float    # canonical 27.0 ± 0.5 (always at 22:00)

    # AC-L2/L3 main floors.
    ac_main_noon_min: int          # canonical 12:00 ± 15 min
    ac_main_noon_setpoint: float   # canonical 24.5 ± 0.5
    ac_main_evening_min: int       # canonical 17:00 ± 15 min (relax to 26)
    ac_main_evening_setpoint: float

    # AC-S3 meeting rooms — when they go quiet.
    ac_s3_off_min: int             # canonical 14:30 ± 30 min

    # Office floors (AC-S1, AC-S2, AC-S4) and main floors evening shutdown.
    office_close_min: int          # canonical 18:30 ± 15 min
    main_evening_off_min: int      # canonical 19:00 ± 15 min

    # Optional events:
    # On hot days, AI tightens an extra setpoint at ~11:00.
    extra_morning_tighten: bool
    # On cool days (rare), AI skips the morning lobby drop entirely.
    skip_morning_drop: bool


def _make_day_plan(rng: random.Random) -> DayPlan:
    """Generate one day's plan from a per-day RNG. Times jitter ±15-30 min;
    setpoints jitter ±0.5°C. Conditional events (`extra_morning_tighten`,
    `skip_morning_drop`) are gated on the day's outdoor peak so the
    decision narrative reads like a response to the weather, not noise."""
    outdoor_peak_c = round(rng.uniform(32.0, 36.0), 1)
    return DayPlan(
        outdoor_peak_c=outdoor_peak_c,
        ac_l1_morning_drop_min=9 * 60 + 30 + rng.randint(-15, 15),
        ac_l1_morning_setpoint=round(rng.uniform(23.5, 24.5) * 2) / 2,
        ac_l1_evening_relax_min=17 * 60 + rng.randint(-15, 15),
        ac_l1_evening_setpoint=round(rng.uniform(25.5, 26.5) * 2) / 2,
        ac_l1_night_setpoint=round(rng.uniform(26.5, 27.5) * 2) / 2,
        ac_main_noon_min=12 * 60 + rng.randint(-15, 15),
        ac_main_noon_setpoint=round(rng.uniform(24.0, 25.0) * 2) / 2,
        ac_main_evening_min=17 * 60 + rng.randint(-15, 15),
        ac_main_evening_setpoint=round(rng.uniform(25.5, 26.5) * 2) / 2,
        ac_s3_off_min=14 * 60 + 30 + rng.randint(-30, 30),
        office_close_min=18 * 60 + 30 + rng.randint(-15, 15),
        main_evening_off_min=19 * 60 + rng.randint(-15, 15),
        # Extra tighten when day is forecast hot (>34.5°C).
        extra_morning_tighten=outdoor_peak_c > 34.5,
        # Skip morning drop on the cooler days (<32.8°C); rare in Bangkok.
        skip_morning_drop=outdoor_peak_c < 32.8,
    )


# Populated by Command.handle for the AI period; manual days don't read it.
_DAY_PLANS: dict = {}


def _plan_for(dt: datetime) -> DayPlan | None:
    """Return the day plan for the timestamp's calendar day, or None for
    timestamps outside the AI period (manual days)."""
    return _DAY_PLANS.get(dt.date())


def _is_on(m: MachineCtx, dt: datetime, period: str) -> bool:
    """True if the machine should be ON at the given local timestamp."""
    if m.is_critical:
        return True
    minute_of_day = dt.hour * 60 + dt.minute
    if period == "manual":
        start, end = MANUAL_WINDOW
        return start <= minute_of_day < end

    sched = AI_SCHEDULE.get(m.name)
    if sched is None:
        return False
    start, end = sched

    # Day-plan overrides — schedule matches what the decision log claims.
    plan = _plan_for(dt)
    if plan is not None:
        if m.name == "AC-S3":
            end = plan.ac_s3_off_min
        elif m.name in ("AC-S1", "AC-S2", "AC-S4"):
            end = plan.office_close_min
        elif m.name in ("AC-L2", "AC-L3", "FAN-02", "FAN-03", "FAN-04"):
            end = plan.main_evening_off_min

    return start <= minute_of_day < end


# Outdoor temp — sinusoidal day cycle, Bangkok-ish. AC load + indoor drift ride this.
OUTDOOR_LOW_C = 24.0
OUTDOOR_HIGH_C = 34.0


def _outdoor_temp(dt: datetime) -> float:
    """Return outdoor temperature (°C) at this timestamp.

    Daily peak comes from the day's `DayPlan` when one exists (AI period),
    falling back to the manual baseline of 34°C for days that don't have
    a plan. Phase is set so the trough lands at 06:00 and the peak at
    18:00 of the SAME local day — close to tropical Bangkok.
    """
    plan = _plan_for(dt)
    high_c = plan.outdoor_peak_c if plan is not None else OUTDOOR_HIGH_C
    hours = dt.hour + dt.minute / 60.0
    centre = (high_c + OUTDOOR_LOW_C) / 2.0
    amplitude = (high_c - OUTDOOR_LOW_C) / 2.0
    phase = 2 * math.pi * (hours - 18) / 24.0
    return centre + amplitude * math.cos(phase)


# Power, temperature, setpoint, and speed all ride the same outdoor-temp
# signal so a hot afternoon shows higher AC load AND higher indoor drift.


def _setpoint_for(m: MachineCtx, dt: datetime, period: str) -> float | None:
    """AC setpoint at this time. Returns None for fans. AI period reads
    from _plan_for(dt) so the chart matches the AIDecision row values."""
    if m.machine_type == Machine.FAN:
        return None

    if period == "manual":
        return 25.0  # Brief's "no setpoint adjustments during the day".

    if m.name == "AC-S5":
        return 22.0  # Server Room held cold 24/7.

    plan = _plan_for(dt)
    minute_of_day = dt.hour * 60 + dt.minute

    if m.name == "AC-L1":
        # Lobby: 25°C → morning drop → evening relax → 22:00 night mode.
        # `skip_morning_drop` (cool day) holds 25°C until evening relax.
        if plan is not None:
            if minute_of_day >= 22 * 60:
                return plan.ac_l1_night_setpoint
            if minute_of_day >= plan.ac_l1_evening_relax_min:
                return plan.ac_l1_evening_setpoint
            if (
                not plan.skip_morning_drop
                and minute_of_day >= plan.ac_l1_morning_drop_min
            ):
                return plan.ac_l1_morning_setpoint
        return 25.0

    if m.name in ("AC-L2", "AC-L3"):
        # Main floors: 25°C → noon tighten → evening relax.
        if plan is not None:
            if minute_of_day >= plan.ac_main_evening_min:
                return plan.ac_main_evening_setpoint
            if minute_of_day >= plan.ac_main_noon_min:
                return plan.ac_main_noon_setpoint
        return 25.0

    return 24.0  # Small office ACs held flat.


def _power_load_factor(
    m: MachineCtx, dt: datetime, period: str, rng: random.Random
) -> float:
    """Fraction of rated power when ON: ACs 30–80%, fans 40–70%.
    Manual runs ~10pp hotter than AI for the same outdoor temp because
    manual setpoints are stuck at 25°C while AI lets it drift to 26–27°C."""
    outdoor_norm = (_outdoor_temp(dt) - OUTDOOR_LOW_C) / (OUTDOOR_HIGH_C - OUTDOOR_LOW_C)
    outdoor_norm = max(0.0, min(1.0, outdoor_norm))

    if m.machine_type == Machine.FAN:
        base = 0.45 + 0.20 * outdoor_norm
        load = base + rng.gauss(0, 0.03)
        return max(0.40, min(0.70, load))

    if period == "manual":
        base = 0.55 + 0.22 * outdoor_norm
    else:
        base = 0.40 + 0.25 * outdoor_norm
    load = base + rng.gauss(0, 0.04)
    return max(0.30, min(0.80, load))


def _temp_drift(period: str, dt: datetime, rng: random.Random) -> float:
    """Indoor drift from setpoint, in °C. Manual is sloppier; AI tighter."""
    outdoor_norm = (_outdoor_temp(dt) - OUTDOOR_LOW_C) / (OUTDOOR_HIGH_C - OUTDOOR_LOW_C)
    if period == "manual":
        return rng.gauss(0.6, 0.7) + outdoor_norm * 0.6
    return rng.gauss(0.1, 0.3) + outdoor_norm * 0.3


def _gen_reading(
    m: MachineCtx, dt: datetime, period: str, rng: random.Random
) -> SensorReading:
    on = _is_on(m, dt, period)
    setpoint = _setpoint_for(m, dt, period)

    if not on:
        # ACs report drifting indoor temp even when OFF (room warms toward
        # outdoor) — feeds the temp_drift overnight alert narrative.
        if m.machine_type == Machine.FAN:
            return SensorReading(
                machine_id=m.id, recorded_at=dt, power_kw=0.0,
                temperature=None, setpoint=None, speed_pct=0.0,
                status=SensorReading.OFF,
            )
        outdoor = _outdoor_temp(dt)
        drifted = (setpoint or 25.0) + (outdoor - 25.0) * 0.3 + rng.gauss(0, 0.5)
        return SensorReading(
            machine_id=m.id, recorded_at=dt, power_kw=0.0,
            temperature=round(drifted, 2), setpoint=setpoint,
            speed_pct=None, status=SensorReading.OFF,
        )

    load = _power_load_factor(m, dt, period, rng)
    power_kw = round(m.rated_power_kw * load, 3)

    if m.machine_type == Machine.FAN:
        # Fan speed tracks load factor + small upward bias for VFD overhead.
        speed_pct = round(min(80.0, max(40.0, load * 100.0 + rng.gauss(0, 3))), 1)
        return SensorReading(
            machine_id=m.id, recorded_at=dt, power_kw=power_kw,
            temperature=None, setpoint=None, speed_pct=speed_pct,
            status=SensorReading.ON,
        )

    indoor = (setpoint or 25.0) + _temp_drift(period, dt, rng)
    indoor = max(22.0, min(27.0, indoor))  # Brief's 22–27°C clamp.
    return SensorReading(
        machine_id=m.id, recorded_at=dt, power_kw=power_kw,
        temperature=round(indoor, 2), setpoint=setpoint,
        speed_pct=None, status=SensorReading.ON,
    )


def _gen_day_decisions(
    machines: dict[str, MachineCtx],
    day_start: datetime,
    plan: DayPlan,
) -> list[AIDecision]:
    """One AI day's decision log (8–12 events). All times/setpoints/skips
    come from the day's `plan` — `_setpoint_for` and `_is_on` read the
    SAME plan so chart and decisions stay aligned.

    Hot day (>34.5°C peak) adds an extra 11:00 SET_TEMP; cool day
    (<32.8°C) skips the morning SET_TEMP.
    """
    out: list[AIDecision] = []

    def at_min(minute_of_day: int) -> datetime:
        h, m = divmod(minute_of_day, 60)
        return day_start.replace(hour=h, minute=m, second=0, microsecond=0)

    def add(dt: datetime, machine_name: str, action: str, value: float | None, reason: str) -> None:
        m = machines.get(machine_name)
        if m is None:
            return
        out.append(AIDecision(
            decided_at=dt, machine_id=m.id, action_type=action,
            value=value, reason=reason,
        ))

    add(at_min(6 * 60), "AC-L1", AIDecision.TURN_ON, None,
        f"Building opening — pre-cool Zone A & Floors 1-6 (forecast peak {plan.outdoor_peak_c}°C)")
    add(at_min(6 * 60 + 15), "FAN-02", AIDecision.TURN_ON, None,
        "Start ventilation FAN-02..04 for occupancy")
    add(at_min(7 * 60), "AC-S1", AIDecision.TURN_ON, None,
        "Office hours starting — AC-S1, AC-S2, AC-S4 online")

    if not plan.skip_morning_drop:
        morning_dt = at_min(plan.ac_l1_morning_drop_min)
        outdoor_now = round(_outdoor_temp(morning_dt), 1)
        add(morning_dt, "AC-L1", AIDecision.SET_TEMP, plan.ac_l1_morning_setpoint,
            f"Adjusted from 25°C to {plan.ac_l1_morning_setpoint}°C — outdoor temp rising to {outdoor_now}°C")

    if plan.extra_morning_tighten:
        add(at_min(11 * 60), "AC-L2", AIDecision.SET_TEMP,
            round(plan.ac_main_noon_setpoint - 0.5, 1),
            f"Pre-tighten Floors 1-6 — hot day forecast ({plan.outdoor_peak_c}°C)")

    add(at_min(plan.ac_main_noon_min), "AC-L2", AIDecision.SET_TEMP, plan.ac_main_noon_setpoint,
        f"Adjusted Floors 1-6 to {plan.ac_main_noon_setpoint}°C — peak occupancy period")
    add(at_min(plan.ac_s3_off_min), "AC-S3", AIDecision.TURN_OFF, None,
        "Meeting rooms empty — no occupancy detected")
    add(at_min(plan.ac_l1_evening_relax_min), "AC-L1", AIDecision.SET_TEMP, plan.ac_l1_evening_setpoint,
        f"Relaxed lobby + Floors 1-6 to {plan.ac_l1_evening_setpoint}°C — occupancy dropping")
    add(at_min(plan.office_close_min), "AC-S1", AIDecision.TURN_OFF, None,
        "Office floors closing — AC-S1, AC-S2, AC-S4")
    add(at_min(plan.main_evening_off_min), "AC-L2", AIDecision.TURN_OFF, None,
        "Evening shutdown — AC-L2, AC-L3, FAN-02..04")
    add(at_min(22 * 60), "AC-L1", AIDecision.SET_TEMP, plan.ac_l1_night_setpoint,
        f"Relaxed to {plan.ac_l1_night_setpoint}°C — lobby night mode")

    return out


# Engineered anomalies — guarantee each alert rule fires on first load.
# Values asserted by backend/building/tests/test_alerts.py — keep in sync.
ENGINEERED_AC_L1_POWER_KW = 41.4   # 92% of 45 kW rated → power_spike (warning)
ENGINEERED_AC_L1_STUCK_HOURS = 1   # how long the spike has been stuck
ENGINEERED_AC_S2_TEMP_C = 27.1     # vs setpoint 24.0 → 3.1°C drift (warning)
ENGINEERED_AC_S2_SETPOINT_C = 24.0
ENGINEERED_AC_L3_RUNTIME_H = 19    # consecutive ON hours → nonstop_runtime (critical)


def _apply_engineered_alerts(
    rows: list[SensorReading],
    machines: list[MachineCtx],
    end: datetime,
    rng: random.Random,
) -> None:
    """Mutate the trailing window so each alert rule fires from a coherent moment.

    1. AC-L1 power_spike: trailing hour held at 41.4 kW (92% of rated)
       with cool over-cooled indoor temp — reads as "valve stuck open".
    2. AC-S2 temp_drift: single hot reading at the end (27.1 vs setpoint 24).
    3. AC-L3 nonstop_runtime: trailing 19h all ON for a 19-hour streak.
    """
    by_machine = {m.name: m.id for m in machines}
    last_dt = max(r.recorded_at for r in rows)
    nonstop_window_start = last_dt - timedelta(hours=ENGINEERED_AC_L3_RUNTIME_H)
    stuck_window_start = last_dt - timedelta(hours=ENGINEERED_AC_L1_STUCK_HOURS)

    ac_l1_id = by_machine.get("AC-L1")
    ac_s2_id = by_machine.get("AC-S2")
    ac_l3_id = by_machine.get("AC-L3")

    for r in rows:
        # 1. AC-L1 stuck-high across the last hour. Final slot is exactly
        #    41.4 (alert test checks latest reading); others jitter so the
        #    line doesn't look hardcoded.
        if (
            r.machine_id == ac_l1_id
            and stuck_window_start <= r.recorded_at <= last_dt
        ):
            if r.recorded_at == last_dt:
                r.power_kw = ENGINEERED_AC_L1_POWER_KW
            else:
                r.power_kw = round(
                    ENGINEERED_AC_L1_POWER_KW + rng.gauss(0, 0.3), 2
                )
            r.status = SensorReading.ON
            if r.temperature is not None:
                # Over-cool: 23°C indoor against 27°C night setpoint.
                r.temperature = round(23.0 + rng.gauss(0, 0.3), 2)

        # 2. AC-S2 temp drift at the final slot.
        if r.machine_id == ac_s2_id and r.recorded_at == last_dt:
            r.temperature = ENGINEERED_AC_S2_TEMP_C
            r.setpoint = ENGINEERED_AC_S2_SETPOINT_C
            r.status = SensorReading.ON
            if r.power_kw == 0.0:
                r.power_kw = round(12.0 * 0.65, 3)  # avoid 0 kW under ON

        # 3. AC-L3 forced ON across the trailing 19h.
        if (
            r.machine_id == ac_l3_id
            and nonstop_window_start <= r.recorded_at <= last_dt
            and r.status == SensorReading.OFF
        ):
            r.status = SensorReading.ON
            r.power_kw = round(45.0 * 0.55, 3)
            r.setpoint = 25.0
            r.temperature = round(25.0 + rng.gauss(0.3, 0.4), 2)


class Command(BaseCommand):
    help = "Seed the database with realistic 7-day building telemetry."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=7,
                            help="Days of history to generate (default: 7).")
        parser.add_argument("--clear", action="store_true",
                            help="Delete existing sensor + decision rows first.")
        parser.add_argument("--seed", type=int, default=42,
                            help="Random seed for reproducibility (default: 42).")

    @transaction.atomic
    def handle(self, *args, **options):
        days: int = options["days"]
        do_clear: bool = options["clear"]
        readings_rng = random.Random(options["seed"])

        if do_clear:
            self.stdout.write("Clearing existing telemetry…")
            AIDecision.objects.all().delete()
            SensorReading.objects.all().delete()

        self._ensure_admin()
        machines = self._upsert_machines()

        # Anchor at the most recent Bangkok midnight so chart days line up
        # with the on-site clock; Django stores as UTC and the FE renders
        # back to local via `new Date(iso)`.
        end = datetime.now(BANGKOK_TZ).replace(
            hour=0, minute=0, second=0, microsecond=0
        ) + timedelta(days=1)
        start = end - timedelta(days=days)

        # Always 3 manual days then AI, even for days != 7, so /compare/
        # has both sides populated.
        manual_end = min(start + timedelta(days=3), end)

        # Per-day plans share state with the decision generator via the
        # module-level _DAY_PLANS dict (avoids threading through every helper).
        _DAY_PLANS.clear()
        ai_day = manual_end
        ai_day_index = 0
        while ai_day < end:
            day_rng = random.Random(options["seed"] * 100 + ai_day_index + 1)
            _DAY_PLANS[ai_day.date()] = _make_day_plan(day_rng)
            ai_day += timedelta(days=1)
            ai_day_index += 1

        self.stdout.write(
            f"Seeding {days} days of readings: "
            f"manual {start.date()} → {manual_end.date()}, "
            f"AI {manual_end.date()} → {end.date()} "
            f"({len(_DAY_PLANS)} day plans)"
        )

        readings = self._gen_readings(
            list(machines.values()), start, manual_end, end, readings_rng
        )
        self._bulk_insert(SensorReading, readings, batch_size=5000)

        decisions = self._gen_decisions(machines, manual_end, end)
        AIDecision.objects.bulk_create(decisions, batch_size=500)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {SensorReading.objects.count()} readings and "
            f"{AIDecision.objects.count()} AI decisions across "
            f"{Machine.objects.count()} machines."
        ))

    def _ensure_admin(self) -> None:
        """admin/admin superuser for local sign-in. Idempotent."""
        User = get_user_model()
        if not User.objects.filter(username="admin").exists():
            User.objects.create_superuser("admin", "admin@example.com", "admin")
            self.stdout.write("Created admin/admin superuser.")

    def _upsert_machines(self) -> dict[str, MachineCtx]:
        """Insert any missing machines; return a {name: MachineCtx} map."""
        ctx: dict[str, MachineCtx] = {}
        for spec in MACHINES:
            obj, _ = Machine.objects.update_or_create(
                name=spec["name"],
                defaults={
                    "machine_type": spec["machine_type"],
                    "zone": spec["zone"],
                    "rated_power_kw": spec["rated_power_kw"],
                    "is_critical": spec["is_critical"],
                },
            )
            ctx[spec["name"]] = MachineCtx(
                id=obj.id, name=obj.name, machine_type=obj.machine_type,
                zone=obj.zone, rated_power_kw=obj.rated_power_kw,
                is_critical=obj.is_critical,
            )
        return ctx

    def _gen_readings(
        self,
        machines: list[MachineCtx],
        start: datetime,
        manual_end: datetime,
        end: datetime,
        rng: random.Random,
    ) -> Iterable[SensorReading]:
        """5-minute readings across [start, end), period-aware. Wraps in
        `_apply_engineered_alerts` so the trailing window deterministically
        fires each Smart Alerts rule on first load."""
        step = timedelta(minutes=5)
        dt = start
        rows: list[SensorReading] = []
        while dt < end:
            period = "manual" if dt < manual_end else "ai"
            for m in machines:
                rows.append(_gen_reading(m, dt, period, rng))
            dt += step
        _apply_engineered_alerts(rows, machines, end, rng)
        return rows

    def _gen_decisions(
        self,
        machines: dict[str, MachineCtx],
        ai_start: datetime,
        ai_end: datetime,
    ) -> list[AIDecision]:
        """8–12 decisions per AI day, driven by each day's plan in
        `_DAY_PLANS`. Plans are populated by `handle()` before this runs."""
        out: list[AIDecision] = []
        day = ai_start
        while day < ai_end:
            plan = _DAY_PLANS.get(day.date())
            if plan is not None:
                out.extend(_gen_day_decisions(machines, day, plan))
            day += timedelta(days=1)
        return out

    def _bulk_insert(self, model, rows: Iterable, batch_size: int) -> None:
        """Stream rows into bulk_create batches without holding the full list in memory."""
        batch: list = []
        for row in rows:
            batch.append(row)
            if len(batch) >= batch_size:
                model.objects.bulk_create(batch, batch_size=batch_size)
                batch.clear()
        if batch:
            model.objects.bulk_create(batch, batch_size=batch_size)
