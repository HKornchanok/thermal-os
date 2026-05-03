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

    Raises ValueError on malformed input — caller should turn that into
    a 400 response.
    """
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


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


def day_start(dt: datetime) -> datetime:
    """UTC midnight of the given datetime's date."""
    return datetime.combine(dt.date(), time.min, tzinfo=timezone.utc)


def day_end(dt: datetime) -> datetime:
    """UTC midnight of the day AFTER the given datetime — exclusive end-of-day."""
    return day_start(dt) + timedelta(days=1)
