"""Shared helpers for the building app's read endpoints."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from django.db import connection

# Allowlists for values that get string-formatted into raw SQL.
# NEVER format un-allowlisted user input — use %s parameter binding.
ALLOWED_METRICS: set[str] = {"power_kw", "temperature", "setpoint", "speed_pct"}

ALLOWED_BUCKETS_FULL: dict[str, str] = {
    "5min": "5 minutes",
    "15min": "15 minutes",
    "1h": "1 hour",
    "1d": "1 day",
}

# 5-min raw is too noisy across 12 machines summed; 1-day too coarse for the chart.
ALLOWED_BUCKETS_AGGREGATE: dict[str, str] = {
    "15min": "15 minutes",
    "1h": "1 hour",
}

ALLOWED_ACTIONS: set[str] = {"turn_on", "turn_off", "set_temp"}


def dictfetchall(cursor) -> list[dict]:
    """Return all rows from a cursor as a list of dicts keyed by column name."""
    columns = [c[0] for c in cursor.description]
    return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]


def parse_iso_datetime(s: str | None) -> datetime | None:
    """Parse an ISO 8601 datetime string. Returns None for None/empty.

    Naive datetimes (no offset) are rejected — without a tz, Django
    silently treats them as UTC, shifting Bangkok windows by 7h.
    Raises ValueError → caller turns into a 400.
    """
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError(
            "datetime must include a timezone offset (e.g. trailing 'Z' or '+07:00')"
        )
    return dt


def get_max_recorded_at(machine_id: int | None = None) -> datetime | None:
    """Latest sensor timestamp, optionally scoped to one machine."""
    with connection.cursor() as cursor:
        if machine_id is None:
            cursor.execute("SELECT MAX(recorded_at) FROM building_sensorreading")
        else:
            cursor.execute(
                "SELECT MAX(recorded_at) FROM building_sensorreading WHERE machine_id = %s",
                [machine_id],
            )
        row = cursor.fetchone()
    return row[0] if row and row[0] else None


def get_min_max_recorded_at() -> tuple[datetime | None, datetime | None]:
    """Earliest + latest sensor timestamps. Drives /api/energy/compare/ defaults."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT MIN(recorded_at), MAX(recorded_at) FROM building_sensorreading")
        row = cursor.fetchone()
    return (row[0], row[1]) if row else (None, None)


# Building is in Bangkok; day boundaries are local (BKK midnight). Anchoring
# in UTC instead would shift "today" by 7h and clip the chart.
BANGKOK_TZ = timezone(timedelta(hours=7))


def day_start(dt: datetime) -> datetime:
    """Bangkok midnight of the given datetime's local date (tz-aware)."""
    bkk = dt.astimezone(BANGKOK_TZ)
    return datetime.combine(bkk.date(), time.min, tzinfo=BANGKOK_TZ)


def day_end(dt: datetime) -> datetime:
    """Bangkok midnight of the day AFTER the given datetime — exclusive end."""
    return day_start(dt) + timedelta(days=1)


def resolve_window(
    from_dt: datetime | None,
    to_dt: datetime | None,
    *,
    default_hours: int = 24,
    machine_id: int | None = None,
) -> tuple[datetime, datetime] | None:
    """Fill missing from/to with trailing-window defaults.

    Returns None when neither is provided AND no readings exist —
    caller should respond with an empty payload.
    """
    if to_dt is None:
        to_dt = get_max_recorded_at(machine_id=machine_id)
        if to_dt is None:
            return None
    if from_dt is None:
        from_dt = to_dt - timedelta(hours=default_hours)
    return from_dt, to_dt


def yesterday_kwh_or_none(raw: float | None) -> float | None:
    """Treat NULL/0 yesterday_kwh as "no data" to avoid divide-by-zero in trend calcs."""
    return raw if raw and raw > 0 else None
