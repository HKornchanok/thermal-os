"""Populate the database with realistic 35-day demo data.

Generates:
    * 12 machines (one per zone in DESIGN.md)
    * ~121k sensor readings at 5-minute intervals
    * ~390 AI decisions in the second half of the window
    * admin/admin superuser

The window is split: the first half is "manual" (looser scheduling, higher
average power), the second half is "AI" (tighter setpoints, prompt shutdown).
This split drives /api/energy/compare/ and is the single most important
property of the seed.

Usage:
    python manage.py seed                # 35 days, additive
    python manage.py seed --days 14      # smaller window for tests
    python manage.py seed --clear        # wipe before reseeding
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from building.models import AIDecision, Machine, SensorReading


# Twelve zones from DESIGN.md, one machine per zone, so the by-zone
# endpoint pivots cleanly with no missing keys.
MACHINE_SPECS: list[dict] = [
    {"name": "AC-L1", "machine_type": "large_ac", "zone": "Zone A (Lobby & Ground)", "rated_power_kw": 45.0, "is_critical": False},
    {"name": "AC-L2", "machine_type": "large_ac", "zone": "Zone B (Floors 1-3)",     "rated_power_kw": 45.0, "is_critical": False},
    {"name": "AC-L3", "machine_type": "large_ac", "zone": "Zone C (Floors 4-6)",     "rated_power_kw": 45.0, "is_critical": False},
    {"name": "AC-S1", "machine_type": "small_ac", "zone": "Floor 1 Office",          "rated_power_kw": 12.0, "is_critical": False},
    {"name": "AC-S2", "machine_type": "small_ac", "zone": "Floor 2 Office",          "rated_power_kw": 12.0, "is_critical": False},
    {"name": "AC-S3", "machine_type": "small_ac", "zone": "Floor 3 Meeting Rooms",   "rated_power_kw": 12.0, "is_critical": False},
    {"name": "AC-S4", "machine_type": "small_ac", "zone": "Floor 5 Executive",       "rated_power_kw": 12.0, "is_critical": False},
    {"name": "AC-S5", "machine_type": "small_ac", "zone": "Server Room (24/7)",      "rated_power_kw": 15.0, "is_critical": True},
    {"name": "FAN-01", "machine_type": "fan",     "zone": "Basement Parking",        "rated_power_kw": 5.0,  "is_critical": True},
    {"name": "FAN-02", "machine_type": "fan",     "zone": "Ground Floor",            "rated_power_kw": 3.0,  "is_critical": False},
    {"name": "FAN-03", "machine_type": "fan",     "zone": "Floors 1-3",              "rated_power_kw": 3.0,  "is_critical": False},
    {"name": "FAN-04", "machine_type": "fan",     "zone": "Floors 4-6",              "rated_power_kw": 3.0,  "is_critical": False},
]


SAMPLE_INTERVAL = timedelta(minutes=5)
BULK_BATCH = 5000

DECISION_TEMPLATES = {
    AIDecision.SET_TEMP: [
        "Adjusted setpoint from {old:.0f}°C to {new:.0f}°C — outdoor temp rising to {outdoor:.0f}°C",
        "Optimised setpoint to {new:.0f}°C based on occupancy",
        "Reduced setpoint to {new:.0f}°C — comfort threshold reached",
        "Setpoint nudged to {new:.0f}°C to balance comfort and load",
    ],
    AIDecision.TURN_OFF: [
        "Building closing — shutting down {zone}",
        "Low occupancy in {zone} — saving energy",
        "Off-peak hours — non-critical machines off",
        "{zone} unoccupied for >30 min — turning off",
    ],
    AIDecision.TURN_ON: [
        "Building opening — pre-cool {zone}",
        "Occupancy detected in {zone} — activating",
        "Outdoor temp rising — pre-cooling {zone}",
    ],
}


@dataclass
class MachineCtx:
    id: int
    name: str
    machine_type: str
    zone: str
    rated_power_kw: float
    is_critical: bool


def _is_business_hour(dt: datetime) -> bool:
    """ON during 08:00-18:00 weekdays."""
    return dt.weekday() < 5 and 8 <= dt.hour < 18


def _round_to_5min(dt: datetime) -> datetime:
    return dt.replace(minute=(dt.minute // 5) * 5, second=0, microsecond=0)


def _gen_reading(m: MachineCtx, dt: datetime, period: str) -> SensorReading:
    is_on = m.is_critical or _is_business_hour(dt)

    # Manual period: machines linger past 18:00 on weekdays — the entire
    # point of "manual" is sloppy off-hours behaviour.
    if period == "manual" and not m.is_critical:
        if dt.weekday() < 5 and 18 <= dt.hour < 20:
            is_on = is_on or random.random() < 0.55

    if not is_on:
        return SensorReading(
            machine_id=m.id,
            recorded_at=dt,
            power_kw=0.0,
            temperature=None if m.machine_type == Machine.FAN else 22.0 + random.gauss(0, 1.0),
            setpoint=None if m.machine_type == Machine.FAN else 24.0,
            speed_pct=0.0 if m.machine_type == Machine.FAN else None,
            status=SensorReading.OFF,
        )

    # ON: AI period runs at lower load factor than manual.
    base_load = 0.70 if period == "ai" else 0.78
    load = base_load + random.gauss(0, 0.05)
    load = max(0.50, min(0.90, load))

    power = m.rated_power_kw * load

    if m.machine_type == Machine.FAN:
        return SensorReading(
            machine_id=m.id,
            recorded_at=dt,
            power_kw=power,
            temperature=None,
            setpoint=None,
            speed_pct=load * 100.0,
            status=SensorReading.ON,
        )

    # AC: tighter setpoint band in AI period.
    if period == "manual":
        setpoint = 25.0 + random.choice([-1.0, 0.0, 0.0, 1.0])
        temp_drift = random.gauss(0.6, 0.9)
    else:
        setpoint = 24.0 + random.choice([-0.5, 0.0, 0.0, 0.5])
        temp_drift = random.gauss(0.2, 0.4)

    return SensorReading(
        machine_id=m.id,
        recorded_at=dt,
        power_kw=power,
        temperature=setpoint + temp_drift,
        setpoint=setpoint,
        speed_pct=None,
        status=SensorReading.ON,
    )


def _gen_decisions(machines: list[MachineCtx], ai_start: datetime, ai_end: datetime) -> list[AIDecision]:
    """~23 decisions per day across the AI period."""
    decisions: list[AIDecision] = []
    days = max(1, math.ceil((ai_end - ai_start).total_seconds() / 86400))

    for day in range(days):
        day_start = ai_start + timedelta(days=day)
        if day_start >= ai_end:
            break
        for _ in range(23):
            offset_minutes = random.randint(0, 24 * 60 - 1)
            dt = day_start + timedelta(minutes=offset_minutes)
            if dt > ai_end:
                continue
            m = random.choice(machines)
            action = random.choices(
                [AIDecision.SET_TEMP, AIDecision.TURN_OFF, AIDecision.TURN_ON],
                weights=[0.5, 0.3, 0.2],
            )[0]

            # set_temp only makes sense for ACs; fall back to turn_off for fans.
            if action == AIDecision.SET_TEMP and m.machine_type == Machine.FAN:
                action = AIDecision.TURN_OFF

            template = random.choice(DECISION_TEMPLATES[action])

            if action == AIDecision.SET_TEMP:
                old_sp = random.choice([23.0, 24.0, 25.0, 26.0])
                new_sp = old_sp + random.choice([-1.0, 1.0])
                outdoor = random.uniform(28, 36)
                reason = template.format(old=old_sp, new=new_sp, outdoor=outdoor)
                value = new_sp
            else:
                reason = template.format(zone=m.zone)
                value = None

            decisions.append(
                AIDecision(
                    decided_at=dt,
                    machine_id=m.id,
                    action_type=action,
                    value=value,
                    reason=reason,
                )
            )

    return decisions


class Command(BaseCommand):
    help = "Populate the database with 35 days of realistic ThermalOS demo data."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=35, help="Days of history to generate (default: 35)")
        parser.add_argument("--clear", action="store_true", help="Delete existing data first")
        parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")

    def handle(self, *args, **options):
        days: int = options["days"]
        clear: bool = options["clear"]
        random.seed(options["seed"])

        if clear:
            self.stdout.write("Clearing existing data...")
            AIDecision.objects.all().delete()
            SensorReading.objects.all().delete()
            Machine.objects.all().delete()

        # Admin user
        User = get_user_model()
        if not User.objects.filter(username="admin").exists():
            User.objects.create_superuser("admin", "admin@example.com", "admin")
            self.stdout.write(self.style.SUCCESS("Created admin/admin superuser"))

        # Machines
        if Machine.objects.count() == 0:
            Machine.objects.bulk_create([Machine(**spec) for spec in MACHINE_SPECS])
            self.stdout.write(self.style.SUCCESS(f"Created {len(MACHINE_SPECS)} machines"))
        else:
            self.stdout.write(f"Using {Machine.objects.count()} existing machines")

        machines = [
            MachineCtx(
                id=m.id,
                name=m.name,
                machine_type=m.machine_type,
                zone=m.zone,
                rated_power_kw=m.rated_power_kw,
                is_critical=m.is_critical,
            )
            for m in Machine.objects.order_by("id")
        ]
        machines_by_name = {m.name: m for m in machines}

        # Time range — anchored to "now" rounded down to the nearest 5-min slot.
        end = _round_to_5min(datetime.now(tz=timezone.utc))
        start = end - timedelta(days=days)
        split = start + timedelta(days=days // 2)

        self.stdout.write(
            f"Generating readings: {start.isoformat()} → {end.isoformat()} "
            f"(manual until {split.isoformat()}, then AI)"
        )

        # Generate readings in batches.
        batch: list[SensorReading] = []
        total = 0
        dt = start
        while dt <= end:
            period = "manual" if dt < split else "ai"
            for m in machines:
                batch.append(_gen_reading(m, dt, period))
            if len(batch) >= BULK_BATCH:
                SensorReading.objects.bulk_create(batch, batch_size=2000)
                total += len(batch)
                batch = []
            dt += SAMPLE_INTERVAL

        if batch:
            SensorReading.objects.bulk_create(batch, batch_size=2000)
            total += len(batch)

        self.stdout.write(self.style.SUCCESS(f"Created {total:,} sensor readings"))

        # AI decisions only during the AI period.
        decisions = _gen_decisions(machines, split, end)
        AIDecision.objects.bulk_create(decisions, batch_size=500)
        self.stdout.write(self.style.SUCCESS(f"Created {len(decisions)} AI decisions"))

        # Engineer alert-firing scenarios into the latest readings so
        # /api/alerts/ has visible content on first dashboard load.
        self._inject_alert_seeds(machines_by_name, end)
        self.stdout.write(self.style.SUCCESS("Injected alert seeds (power_spike, temp_drift, nonstop_runtime)"))

    @staticmethod
    @transaction.atomic
    def _inject_alert_seeds(machines_by_name: dict[str, MachineCtx], end: datetime) -> None:
        # Power spike — AC-L1 latest at 92% of rated (>0.90 threshold).
        ac_l1 = machines_by_name["AC-L1"]
        SensorReading.objects.filter(
            machine_id=ac_l1.id, recorded_at=end
        ).update(
            power_kw=ac_l1.rated_power_kw * 0.92,
            status=SensorReading.ON,
            temperature=24.5,
            setpoint=24.0,
        )

        # Temp drift — AC-S2 latest temp 27.1°C vs setpoint 24.0°C (3.1°C drift).
        ac_s2 = machines_by_name["AC-S2"]
        SensorReading.objects.filter(
            machine_id=ac_s2.id, recorded_at=end
        ).update(
            power_kw=ac_s2.rated_power_kw * 0.78,
            status=SensorReading.ON,
            temperature=27.1,
            setpoint=24.0,
        )

        # Nonstop runtime — AC-L3 ON continuously for 19h (no OFF in last 19h).
        ac_l3 = machines_by_name["AC-L3"]
        nonstop_start = end - timedelta(hours=19)
        SensorReading.objects.filter(
            machine_id=ac_l3.id,
            recorded_at__gte=nonstop_start,
            recorded_at__lte=end,
        ).update(
            status=SensorReading.ON,
            power_kw=ac_l3.rated_power_kw * 0.72,
            temperature=24.6,
            setpoint=24.0,
        )
