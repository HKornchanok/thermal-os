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


# ---------------------------------------------------------------------------
# Machine registry — names, zones, and rated powers from the brief's
# "Machines" appendix table.
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Schedule — when each machine is ON, by period.
# Times are local-day hours in [0, 24) interpreted against the reading's
# timestamp. The two periods diverge intentionally:
#   Manual: every non-critical machine runs 06:00–22:00 flat (the "no AI" baseline)
#   AI:     zone-aware schedule that mirrors the brief's daily-pattern table
#           and the Decision Examples (e.g. AC-S3 off at 14:30 when rooms empty)
# ---------------------------------------------------------------------------

# AI-period schedule: minute-of-day windows (start_min inclusive, end_min exclusive).
# 06:00 = 360, 18:30 = 1110, 19:00 = 1140, 22:00 = 1320, etc.
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

# Manual-period flat window (06:00–22:00) for every non-critical machine.
MANUAL_WINDOW = (6 * 60, 22 * 60)


def _is_on(m: MachineCtx, dt: datetime, period: str) -> bool:
    """True if the machine should be ON at the given local timestamp."""
    if m.is_critical:
        return True
    minute_of_day = dt.hour * 60 + dt.minute
    if period == "manual":
        start, end = MANUAL_WINDOW
    else:
        sched = AI_SCHEDULE.get(m.name)
        if sched is None:
            return False
        start, end = sched
    return start <= minute_of_day < end


# ---------------------------------------------------------------------------
# Outdoor temperature model — sinusoidal day cycle. Bangkok-ish: 24°C overnight
# low at 06:00, 34°C peak at 14:00. AC load and indoor drift both ride this.
# ---------------------------------------------------------------------------

OUTDOOR_LOW_C = 24.0
OUTDOOR_HIGH_C = 34.0


def _outdoor_temp(dt: datetime) -> float:
    """Return outdoor temperature (°C) at this timestamp.

    Model: amplitude (HIGH-LOW)/2 sinusoid centred on (HIGH+LOW)/2. Phase is
    set so the trough lands at 06:00 and the peak at 18:00 of the SAME local
    day — closer to a tropical climate than a Northern-hemisphere "afternoon
    peak" which would land at 14:00. Either way the curve drives load
    realistically; the exact peak hour matters less than the swing magnitude.
    """
    hours = dt.hour + dt.minute / 60.0
    centre = (OUTDOOR_HIGH_C + OUTDOOR_LOW_C) / 2.0
    amplitude = (OUTDOOR_HIGH_C - OUTDOOR_LOW_C) / 2.0
    # cos peaks at hours=18, troughs at hours=6
    phase = 2 * math.pi * (hours - 18) / 24.0
    return centre + amplitude * math.cos(phase)


# ---------------------------------------------------------------------------
# Reading generator — turns (machine, timestamp, period) into a SensorReading.
# Power, temperature, setpoint, speed are all driven by the same outdoor-temp
# signal so the dataset has internal consistency: a hot afternoon shows higher
# AC load AND higher indoor drift, not random independent draws.
# ---------------------------------------------------------------------------


def _setpoint_for(m: MachineCtx, dt: datetime, period: str) -> float | None:
    """AC setpoint at this time, given the period. Returns None for fans."""
    if m.machine_type == Machine.FAN:
        return None

    if period == "manual":
        # Stuck at 25°C — the brief's "no setpoint adjustments during the day".
        return 25.0

    # AI period — zone- and time-aware. Mirrors the brief's Decision Examples.
    hour = dt.hour

    if m.name == "AC-S5":
        # Server Room — held cold 22°C all day, the natural target for hot kit.
        return 22.0

    if m.name == "AC-L1":
        # Lobby — relaxes to 26°C after 17:00 (occupancy dropping), 27°C after
        # 22:00 night mode. Drops to 24°C at 09:30 when outdoor temp climbs —
        # the timestamp must match the SET_TEMP decision logged at 09:30.
        minute_of_day = hour * 60 + dt.minute
        if hour >= 22:
            return 27.0
        if hour >= 17:
            return 26.0
        if minute_of_day >= 9 * 60 + 30:
            return 24.0
        return 25.0

    if m.name in ("AC-L2", "AC-L3"):
        # Floors 1–6 — adjusted to 24.5°C at noon peak occupancy, 26°C after
        # 17:00 relaxed.
        if hour >= 17:
            return 26.0
        if 12 <= hour < 17:
            return 24.5
        return 25.0

    # Small ACs in offices — held at 24°C through office hours.
    return 24.0


def _power_load_factor(m: MachineCtx, dt: datetime, period: str) -> float:
    """Fraction of rated power when ON, in [0.30, 0.80] for ACs / [0.40, 0.70] for fans.

    Driven by outdoor heat: the hotter it is outside, the harder the AC works
    to hold its setpoint. Manual period runs ~10 percentage points hotter than
    AI for the same outdoor temp because manual setpoints are stuck at 25°C
    where AI has already let the lobby drift to 26–27°C.
    """
    outdoor_norm = (_outdoor_temp(dt) - OUTDOOR_LOW_C) / (OUTDOOR_HIGH_C - OUTDOOR_LOW_C)
    outdoor_norm = max(0.0, min(1.0, outdoor_norm))

    if m.machine_type == Machine.FAN:
        # Fans 40–70% — narrower band, less weather-driven (they move air
        # regardless), small noise.
        base = 0.45 + 0.20 * outdoor_norm
        load = base + random.gauss(0, 0.03)
        return max(0.40, min(0.70, load))

    # AC: 30–80%. Manual sits ~78% of rated on a hot afternoon; AI sits ~65%.
    if period == "manual":
        base = 0.55 + 0.22 * outdoor_norm
    else:
        base = 0.40 + 0.25 * outdoor_norm
    load = base + random.gauss(0, 0.04)
    return max(0.30, min(0.80, load))


def _temp_drift(period: str, dt: datetime) -> float:
    """Indoor drift from setpoint, in °C. Manual is sloppier; AI tighter."""
    outdoor_norm = (_outdoor_temp(dt) - OUTDOOR_LOW_C) / (OUTDOOR_HIGH_C - OUTDOOR_LOW_C)
    if period == "manual":
        return random.gauss(0.6, 0.7) + outdoor_norm * 0.6
    return random.gauss(0.1, 0.3) + outdoor_norm * 0.3


def _gen_reading(m: MachineCtx, dt: datetime, period: str) -> SensorReading:
    on = _is_on(m, dt, period)
    setpoint = _setpoint_for(m, dt, period)

    if not on:
        # OFF rows: power=0. ACs still report a slowly-drifting indoor temp
        # because the room isn't actively cooled — useful for showing why a
        # zone is "drifting from setpoint" overnight on the alert system.
        # Fans report speed_pct=0.
        if m.machine_type == Machine.FAN:
            return SensorReading(
                machine_id=m.id, recorded_at=dt, power_kw=0.0,
                temperature=None, setpoint=None, speed_pct=0.0,
                status=SensorReading.OFF,
            )
        # AC OFF: indoor drifts toward outdoor when not actively cooled.
        outdoor = _outdoor_temp(dt)
        drifted = (setpoint or 25.0) + (outdoor - 25.0) * 0.3 + random.gauss(0, 0.5)
        return SensorReading(
            machine_id=m.id, recorded_at=dt, power_kw=0.0,
            temperature=round(drifted, 2), setpoint=setpoint,
            speed_pct=None, status=SensorReading.OFF,
        )

    load = _power_load_factor(m, dt, period)
    power_kw = round(m.rated_power_kw * load, 3)

    if m.machine_type == Machine.FAN:
        # Fan speed roughly tracks load factor (40–80% per brief Data Guide,
        # which lines up with the 40–70% power band plus a small upward bias
        # for VFD overhead at low load).
        speed_pct = round(min(80.0, max(40.0, load * 100.0 + random.gauss(0, 3))), 1)
        return SensorReading(
            machine_id=m.id, recorded_at=dt, power_kw=power_kw,
            temperature=None, setpoint=None, speed_pct=speed_pct,
            status=SensorReading.ON,
        )

    indoor = (setpoint or 25.0) + _temp_drift(period, dt)
    # Clamp to the brief's 22–27°C indoor range; gauss noise can push outside.
    indoor = max(22.0, min(27.0, indoor))
    return SensorReading(
        machine_id=m.id, recorded_at=dt, power_kw=power_kw,
        temperature=round(indoor, 2), setpoint=setpoint,
        speed_pct=None, status=SensorReading.ON,
    )


# ---------------------------------------------------------------------------
# AI decision generator — ~10 events per AI day, mirroring the brief's
# Decision Examples table. We synthesise one decision per machine that an
# event references so the timeline reads naturally.
# ---------------------------------------------------------------------------


def _gen_day_decisions(machines: dict[str, MachineCtx], day_start: datetime) -> list[AIDecision]:
    """Build one AI day's decision log: ~10 events tracking the brief's
    Decision Examples timeline. The brief specifies "~8–12 decisions per
    day"; we pick the canonical 10 — one per narrative beat — and let
    each decision target the single representative machine for that beat
    (rather than spamming one row per fellow machine).

    The timestamps and setpoint values intentionally match what the
    sensor schedule (AI_SCHEDULE) and `_setpoint_for` produce, so
    Somchai sees the chart change at the same minute the decision log
    records the change.
    """
    out: list[AIDecision] = []

    def at(hour: int, minute: int) -> datetime:
        return day_start.replace(hour=hour, minute=minute, second=0, microsecond=0)

    def add(dt: datetime, machine_name: str, action: str, value: float | None, reason: str) -> None:
        m = machines.get(machine_name)
        if m is None:
            return
        out.append(AIDecision(
            decided_at=dt, machine_id=m.id, action_type=action,
            value=value, reason=reason,
        ))

    # 06:00 — Building opening, pre-cool the lobby. (AC-L2/L3 also turn on
    # at 06:00 per their AI_SCHEDULE; we log only the canonical Zone A
    # event to keep the count to ~10 — operators don't need each fellow
    # machine logged separately.)
    add(at(6, 0), "AC-L1", AIDecision.TURN_ON, None,
        "Building opening — pre-cool Zone A (lobby) and Floors 1-6")

    # 06:15 — Start ventilation across the building.
    add(at(6, 15), "FAN-02", AIDecision.TURN_ON, None,
        "Start ventilation FAN-02..04 for occupancy")

    # 07:00 — Office hours start; office floors come online together.
    add(at(7, 0), "AC-S1", AIDecision.TURN_ON, None,
        "Office hours starting — AC-S1, AC-S2, AC-S4 online")

    # 09:30 — Outdoor climbing past 30°C, drop lobby setpoint.
    outdoor_morning = round(_outdoor_temp(at(9, 30)), 1)
    add(at(9, 30), "AC-L1", AIDecision.SET_TEMP, 24.0,
        f"Adjusted from 25°C to 24°C — outdoor temp rising to {outdoor_morning}°C")

    # 12:00 — Peak occupancy, tighten Floors 1-6 setpoint.
    add(at(12, 0), "AC-L2", AIDecision.SET_TEMP, 24.5,
        "Adjusted to 24.5°C — peak occupancy period (AC-L2, AC-L3)")

    # 14:30 — Meeting rooms empty, shut Floor 3.
    add(at(14, 30), "AC-S3", AIDecision.TURN_OFF, None,
        "Meeting rooms empty — no occupancy detected")

    # 17:00 — Occupancy dropping, relax lobby + main floors.
    add(at(17, 0), "AC-L1", AIDecision.SET_TEMP, 26.0,
        "Relaxed lobby + Floors 1-6 to 26°C — occupancy dropping")

    # 18:30 — Office floors close.
    add(at(18, 30), "AC-S1", AIDecision.TURN_OFF, None,
        "Office floors closing — AC-S1, AC-S2, AC-S4")

    # 19:00 — Evening shutdown for main floors and ventilation.
    add(at(19, 0), "AC-L2", AIDecision.TURN_OFF, None,
        "Evening shutdown — AC-L2, AC-L3, FAN-02..04")

    # 22:00 — Lobby night mode.
    add(at(22, 0), "AC-L1", AIDecision.SET_TEMP, 27.0,
        "Relaxed to 27°C — lobby night mode")

    return out


# ---------------------------------------------------------------------------
# Engineered anomalies — guarantee the Smart Alerts banner has at least one
# row of each rule (power_spike / temp_drift / nonstop_runtime) on first
# load, so the bonus feature actually demos. Tuned to the exact numbers
# the alert-rule tests check against.
# ---------------------------------------------------------------------------


# Specific values the test-suite asserts. Keep these in sync with
# backend/building/tests/test_alerts.py if either changes.
ENGINEERED_AC_L1_POWER_KW = 41.4   # 92% of 45 kW rated → power_spike (warning)
ENGINEERED_AC_S2_TEMP_C = 27.1     # vs setpoint 24.0 → 3.1°C drift (warning)
ENGINEERED_AC_S2_SETPOINT_C = 24.0
ENGINEERED_AC_L3_RUNTIME_H = 19    # consecutive ON hours → nonstop_runtime (critical)


def _apply_engineered_alerts(
    rows: list[SensorReading],
    machines: list[MachineCtx],
    end: datetime,
) -> None:
    """Mutate the trailing window of the seed so each alert rule fires.

    All three nudges target the SAME run-up to `end` so the alert banner
    populates with realistic-looking values from a coherent moment in time
    (rather than three distinct "this happened a week ago" anomalies).

    1. AC-L1 power_spike — last reading shows 41.4 kW (92% of rated). Tweak
       only the final 5-min slot so the chart spike is visible and recent.
    2. AC-S2 temp_drift — last reading shows temperature=27.1, setpoint=24.0.
       Visible as a single "hot reading at the end" point on the chart.
    3. AC-L3 nonstop_runtime — every reading in the trailing 19 hours is
       forced ON with realistic load. Combined with a natural OFF earlier
       in the day, the SQL rule sees a 19-hour ON streak.
    """
    by_machine = {m.name: m.id for m in machines}
    last_dt = max(r.recorded_at for r in rows)
    nonstop_window_start = last_dt - timedelta(hours=ENGINEERED_AC_L3_RUNTIME_H)

    ac_l1_id = by_machine.get("AC-L1")
    ac_s2_id = by_machine.get("AC-S2")
    ac_l3_id = by_machine.get("AC-L3")

    for r in rows:
        # 1. AC-L1 power spike at the very last slot.
        if r.machine_id == ac_l1_id and r.recorded_at == last_dt:
            r.power_kw = ENGINEERED_AC_L1_POWER_KW
            r.status = SensorReading.ON
            # Setpoint at the end of the day for AC-L1 is night-mode 27°C
            # per _setpoint_for; leave temp realistic so it doesn't also
            # trigger temp_drift (which would be misleading double-fire).
            if r.temperature is not None:
                r.temperature = max(r.temperature, 26.5)

        # 2. AC-S2 temp drift at the very last slot.
        if r.machine_id == ac_s2_id and r.recorded_at == last_dt:
            r.temperature = ENGINEERED_AC_S2_TEMP_C
            r.setpoint = ENGINEERED_AC_S2_SETPOINT_C
            r.status = SensorReading.ON
            # Pick a power consistent with ON status — avoid 0 kW which
            # would conflict with status=ON in the dashboard reading.
            if r.power_kw == 0.0:
                r.power_kw = round(12.0 * 0.65, 3)  # ~mid load on a 12 kW unit

        # 3. AC-L3 forced ON across the last 19 hours (no OFF in window).
        if (
            r.machine_id == ac_l3_id
            and nonstop_window_start <= r.recorded_at <= last_dt
            and r.status == SensorReading.OFF
        ):
            r.status = SensorReading.ON
            # Mid-range load so the streak is plausible — not a bug.
            r.power_kw = round(45.0 * 0.55, 3)
            # Hold a comfortable temp so this doesn't also trip temp_drift.
            r.setpoint = 25.0
            r.temperature = round(25.0 + random.gauss(0.3, 0.4), 2)


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


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
        random.seed(options["seed"])

        if do_clear:
            self.stdout.write("Clearing existing telemetry…")
            AIDecision.objects.all().delete()
            SensorReading.objects.all().delete()

        self._ensure_admin()
        machines = self._upsert_machines()

        # Anchor the seed window at the most recent midnight UTC so charts
        # land on whole-day boundaries. Total span is `days` long, ending
        # at midnight + 24h (i.e. last reading is at 23:55 of the final day).
        end = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ) + timedelta(days=1)
        start = end - timedelta(days=days)

        # Brief's split: first 3 days manual, remainder AI control. For
        # `days != 7` we hold the same 3-day manual lead-in so the comparison
        # endpoint always has both sides populated.
        manual_end = min(start + timedelta(days=3), end)

        self.stdout.write(
            f"Seeding {days} days of readings: "
            f"manual {start.date()} → {manual_end.date()}, "
            f"AI {manual_end.date()} → {end.date()}"
        )

        readings = self._gen_readings(list(machines.values()), start, manual_end, end)
        self._bulk_insert(SensorReading, readings, batch_size=5000)

        decisions = self._gen_decisions(machines, manual_end, end)
        SensorReading.objects.bulk_create([])  # ensure prior writes flush
        AIDecision.objects.bulk_create(decisions, batch_size=500)

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {SensorReading.objects.count()} readings and "
            f"{AIDecision.objects.count()} AI decisions across "
            f"{Machine.objects.count()} machines."
        ))

    # -- helpers ---------------------------------------------------------

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
    ) -> Iterable[SensorReading]:
        """Yield 5-minute readings across [start, end), period-aware.

        Wraps the natural generation in `_apply_engineered_alerts` so the
        last few hours of the seed are nudged to deterministically fire
        each of the three Smart Alerts rules — without that, the dashboard
        boots into the demo with an empty alert banner and there's nothing
        for Somchai to look at on the most prominent feature in the bonus.
        """
        step = timedelta(minutes=5)
        dt = start
        rows: list[SensorReading] = []
        while dt < end:
            period = "manual" if dt < manual_end else "ai"
            for m in machines:
                rows.append(_gen_reading(m, dt, period))
            dt += step
        _apply_engineered_alerts(rows, machines, end)
        return rows

    def _gen_decisions(
        self,
        machines: dict[str, MachineCtx],
        ai_start: datetime,
        ai_end: datetime,
    ) -> list[AIDecision]:
        """One day's worth of ~17 events for each AI day in the window."""
        out: list[AIDecision] = []
        day = ai_start
        while day < ai_end:
            out.extend(_gen_day_decisions(machines, day))
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
