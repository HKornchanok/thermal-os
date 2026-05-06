"""Shared helpers for the building app's read endpoints."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Optional

from django.db import connection


# Allowlists for query-param values that get string-formatted into raw SQL
# (column names, INTERVAL literals). NEVER format un-allowlisted user input
# into a SQL string — use %s parameter binding for everything else.
ALLOWED_METRICS: set[str] = {"power_kw", "temperature", "setpoint", "speed_pct"}

# Bucket aliases mapped to PostgreSQL INTERVAL strings, for endpoints that
# allow the full range (per-machine series).
ALLOWED_BUCKETS_FULL: dict[str, str] = {
    "5min": "5 minutes",
    "15min": "15 minutes",
    "1h": "1 hour",
    "1d": "1 day",
}

# Subset for building-wide aggregate endpoints. 5-min raw is too noisy at
# scale (288 points/day across all 12 machines summed); 1-day is too coarse
# for the area chart's pacing.
ALLOWED_BUCKETS_AGGREGATE: dict[str, str] = {
    "15min": "15 minutes",
    "1h": "1 hour",
}

# Action types accepted as a filter on /api/decisions/.
ALLOWED_ACTIONS: set[str] = {"turn_on", "turn_off", "set_temp"}


def dictfetchall(cursor) -> list[dict]:
    """Return all rows from a cursor as a list of dicts keyed by column name."""
    columns = [c[0] for c in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def parse_iso_datetime(s: Optional[str]) -> Optional[datetime]:
    """Parse an ISO 8601 datetime string. Returns None for None/empty.

    A naive datetime (no offset) is rejected — every timestamp the API
    accepts must commit to a timezone. Without this guard a caller could
    send "2026-05-01T00:00:00" and Django would compare it against UTC
    timestamps as if it were already UTC, silently shifting the window
    by 7 hours in Bangkok.

    Raises ValueError on malformed input or naive datetimes — caller
    should turn that into a 400 response.
    """
    if not s:
        return None
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError(
            "datetime must include a timezone offset (e.g. trailing 'Z' or '+07:00')"
        )
    return dt


def get_max_recorded_at(machine_id: Optional[int] = None) -> Optional[datetime]:
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


def get_min_max_recorded_at() -> tuple[Optional[datetime], Optional[datetime]]:
    """Earliest and latest sensor timestamps. Used by /api/energy/compare/
    to derive default before/after periods that span all available data."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT MIN(recorded_at), MAX(recorded_at) FROM building_sensorreading")
        row = cursor.fetchone()
    return (row[0], row[1]) if row else (None, None)


# The building lives in Bangkok, so day boundaries here are Bangkok local
# (00:00 → 24:00 BKK). Without this anchor, "today's energy" on the
# Overview KPIs and the default 24-hour window on /machines would start at
# UTC midnight = 07:00 BKK — which makes the chart show only 17 hours of
# the actual local day and a 7-hour gap before the next "day" starts.
BANGKOK_TZ = timezone(timedelta(hours=7))


def day_start(dt: datetime) -> datetime:
    """Bangkok midnight of the given datetime's local date.

    Returned datetime is timezone-aware in Bangkok TZ. Django's USE_TZ=True
    converts this to the right UTC instant for SQL parameter binding when
    the call site passes it as a query param.
    """
    bkk = dt.astimezone(BANGKOK_TZ)
    return datetime.combine(bkk.date(), time.min, tzinfo=BANGKOK_TZ)


def day_end(dt: datetime) -> datetime:
    """Bangkok midnight of the day AFTER the given datetime — exclusive end."""
    return day_start(dt) + timedelta(days=1)


def resolve_window(
    from_dt: Optional[datetime],
    to_dt: Optional[datetime],
    *,
    default_hours: int = 24,
    machine_id: Optional[int] = None,
) -> Optional[tuple[datetime, datetime]]:
    """Fill missing from/to with the standard "trailing window" defaults.

    Returns None when neither side is provided AND there are no readings
    yet — the caller should respond with an empty payload. Otherwise
    returns the resolved (from, to) pair.

    `to` defaults to MAX(recorded_at) (optionally scoped to a machine);
    `from` defaults to `to - default_hours`. This matches what every
    aggregate endpoint already did inline.
    """
    if to_dt is None:
        to_dt = get_max_recorded_at(machine_id=machine_id)
        if to_dt is None:
            return None
    if from_dt is None:
        from_dt = to_dt - timedelta(hours=default_hours)
    return from_dt, to_dt


def yesterday_kwh_or_none(raw: Optional[float]) -> Optional[float]:
    """Treat NULL/zero `yesterday_kwh` as "no data" to avoid divide-by-zero
    in trend calculations and "vs yesterday" comparisons. Used by
    /api/building/summary/ and the chat context builder."""
    return raw if raw and raw > 0 else None
