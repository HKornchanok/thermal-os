"""Building-wide aggregate endpoints."""

from collections import defaultdict
from datetime import timedelta

from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import (
    ALLOWED_BUCKETS_AGGREGATE,
    day_start,
    dictfetchall,
    get_max_recorded_at,
    parse_iso_datetime,
    resolve_window,
    yesterday_kwh_or_none,
)

# Fans don't have temperature; only AC types feed the avg_temperature KPI.
AC_MACHINE_TYPES = ("large_ac", "small_ac")


@api_view(["GET"])
def summary(request):
    """Live KPI snapshot of the whole building.

    Reference time is `MAX(recorded_at)`, not `now()`, so "today" tracks
    the most recent sample regardless of seed clock drift.

    Returns the 8-field object from DESIGN.md §1B; on an empty DB the
    shape is preserved with zeroed/null values.
    """
    max_ts = get_max_recorded_at()

    if max_ts is None:
        return Response(
            {
                "total_machines": _total_machines(),
                "active_machines": 0,
                "inactive_machines": _total_machines(),
                "total_power_kw": 0.0,
                "today_kwh": 0.0,
                "yesterday_kwh": None,
                "trend_pct": None,
                "avg_temperature": None,
            }
        )

    today_start = day_start(max_ts)
    today_end = today_start + timedelta(days=1)
    yesterday_start = today_start - timedelta(days=1)
    yesterday_end = today_start

    with connection.cursor() as cursor:
        cursor.execute(sql.LATEST_FOR_SUMMARY)
        latest = dictfetchall(cursor)

        cursor.execute("SELECT COUNT(*) FROM building_machine")
        total_machines = cursor.fetchone()[0]

        cursor.execute(sql.KWH_BETWEEN, [today_start, today_end])
        today_kwh = cursor.fetchone()[0] or 0.0

        cursor.execute(sql.KWH_BETWEEN, [yesterday_start, yesterday_end])
        yesterday_kwh_raw = cursor.fetchone()[0]

    active = sum(1 for r in latest if r["status"] == "ON")
    inactive = sum(1 for r in latest if r["status"] == "OFF")
    total_power = sum(r["power_kw"] for r in latest if r["status"] == "ON")

    ac_temps = [
        r["temperature"]
        for r in latest
        if r["status"] == "ON"
        and r["machine_type"] in AC_MACHINE_TYPES
        and r["temperature"] is not None
    ]
    avg_temp = (sum(ac_temps) / len(ac_temps)) if ac_temps else None

    yesterday_kwh = yesterday_kwh_or_none(yesterday_kwh_raw)
    trend_pct = (
        (today_kwh - yesterday_kwh) / yesterday_kwh * 100.0
        if yesterday_kwh is not None
        else None
    )

    return Response(
        {
            "total_machines": total_machines,
            "active_machines": active,
            "inactive_machines": inactive,
            "total_power_kw": round(total_power, 2),
            "today_kwh": round(today_kwh, 2),
            "yesterday_kwh": round(yesterday_kwh, 2) if yesterday_kwh is not None else None,
            "trend_pct": round(trend_pct, 2) if trend_pct is not None else None,
            "avg_temperature": round(avg_temp, 2) if avg_temp is not None else None,
        }
    )


def _total_machines() -> int:
    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM building_machine")
        return cursor.fetchone()[0]


@api_view(["GET"])
def energy(request):
    """Building-wide total power, time-bucketed.

    Params: from, to (ISO; defaults: last 24h of MAX(recorded_at)),
            bucket ∈ {15min, 1h} (default 1h).
    Returns: [ {"bucket": <iso>, "total_kw": <float>}, ... ]
    """
    bucket_alias = request.query_params.get("bucket", "1h")
    if bucket_alias not in ALLOWED_BUCKETS_AGGREGATE:
        return Response({"detail": f"Invalid bucket: {bucket_alias!r}"}, status=400)
    bucket_interval = ALLOWED_BUCKETS_AGGREGATE[bucket_alias]

    try:
        from_dt = parse_iso_datetime(request.query_params.get("from"))
        to_dt = parse_iso_datetime(request.query_params.get("to"))
    except ValueError as e:
        return Response({"detail": f"Invalid datetime: {e}"}, status=400)

    window = resolve_window(from_dt, to_dt)
    if window is None:
        return Response([])
    from_dt, to_dt = window

    sql_query = sql.TOTAL_ENERGY_TPL.format(bucket_interval=bucket_interval)
    with connection.cursor() as cursor:
        cursor.execute(sql_query, [from_dt, to_dt])
        rows = cursor.fetchall()

    return Response(
        [
            {"bucket": bucket.isoformat(), "total_kw": round(total_kw, 2) if total_kw else 0.0}
            for bucket, total_kw in rows
        ]
    )


@api_view(["GET"])
def energy_by_zone(request):
    """Building power broken down by zone, pivoted for stacked area charts.

    Params: same as `energy`.
    Returns one entry per bucket with every known zone as a key — zones
    with zero power are present as 0.0 so the chart series stays stable
    across the time axis.
    """
    bucket_alias = request.query_params.get("bucket", "1h")
    if bucket_alias not in ALLOWED_BUCKETS_AGGREGATE:
        return Response({"detail": f"Invalid bucket: {bucket_alias!r}"}, status=400)
    bucket_interval = ALLOWED_BUCKETS_AGGREGATE[bucket_alias]

    try:
        from_dt = parse_iso_datetime(request.query_params.get("from"))
        to_dt = parse_iso_datetime(request.query_params.get("to"))
    except ValueError as e:
        return Response({"detail": f"Invalid datetime: {e}"}, status=400)

    window = resolve_window(from_dt, to_dt)
    if window is None:
        return Response([])
    from_dt, to_dt = window

    sql_query = sql.ZONE_ENERGY_TPL.format(bucket_interval=bucket_interval)
    with connection.cursor() as cursor:
        cursor.execute(sql_query, [from_dt, to_dt])
        rows = cursor.fetchall()  # (bucket, zone, total_kw)

        cursor.execute(sql.ALL_ZONES)
        all_zones = [r[0] for r in cursor.fetchall()]

    pivoted: dict = defaultdict(dict)
    for bucket, zone, total_kw in rows:
        pivoted[bucket][zone] = round(total_kw, 2) if total_kw else 0.0

    response = []
    for bucket in sorted(pivoted.keys()):
        entry = {"bucket": bucket.isoformat()}
        for zone in all_zones:
            entry[zone] = pivoted[bucket].get(zone, 0.0)
        response.append(entry)
    return Response(response)
