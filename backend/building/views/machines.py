"""Machine registry + per-machine sensor time-series."""

from datetime import timedelta

from django.db import connection
from django.http import Http404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import (
    ALLOWED_BUCKETS_FULL,
    ALLOWED_METRICS,
    dictfetchall,
    get_max_recorded_at,
    parse_iso_datetime,
)


@api_view(["GET"])
def list_machines(request):
    """All machines with their most recent sensor reading nested as `latest_reading`.

    A machine that has no readings yet (cold seed, or all readings deleted)
    returns `latest_reading: null` — the frontend renders an empty card
    rather than crashing on a missing key.
    """
    with connection.cursor() as cursor:
        cursor.execute(sql.LATEST_READING_PER_MACHINE)
        rows = dictfetchall(cursor)

    response = []
    for row in rows:
        machine = {
            "id": row["id"],
            "name": row["name"],
            "machine_type": row["machine_type"],
            "zone": row["zone"],
            "rated_power_kw": row["rated_power_kw"],
            "is_critical": row["is_critical"],
            "latest_reading": None,
        }
        if row["recorded_at"] is not None:
            machine["latest_reading"] = {
                "machine_id": row["id"],
                "recorded_at": row["recorded_at"].isoformat(),
                "power_kw": row["power_kw"],
                "temperature": row["temperature"],
                "setpoint": row["setpoint"],
                "speed_pct": row["speed_pct"],
                "status": row["status"],
            }
        response.append(machine)
    return Response(response)


@api_view(["GET"])
def machine_sensors(request, machine_id: int):
    """Time-bucketed sensor readings for a single machine.

    Query params (all optional):
        metric  ∈ {power_kw, temperature, setpoint, speed_pct}  default power_kw
        bucket  ∈ {5min, 15min, 1h, 1d}                          default 5min
        from    ISO 8601 datetime                                default = `to` − 24 hours
        to      ISO 8601 datetime                                default = MAX(recorded_at)

    Returns:
        [ {"bucket": "<iso>", "value": <float>}, ... ]

    Errors:
        400 invalid metric / bucket / datetime
        404 machine not found
    """
    metric = request.query_params.get("metric", "power_kw")
    bucket_alias = request.query_params.get("bucket", "5min")

    if metric not in ALLOWED_METRICS:
        return Response({"detail": f"Invalid metric: {metric!r}"}, status=400)
    if bucket_alias not in ALLOWED_BUCKETS_FULL:
        return Response({"detail": f"Invalid bucket: {bucket_alias!r}"}, status=400)
    bucket_interval = ALLOWED_BUCKETS_FULL[bucket_alias]

    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM building_machine WHERE id = %s", [machine_id])
        if cursor.fetchone() is None:
            raise Http404("Machine not found")

    try:
        from_dt = parse_iso_datetime(request.query_params.get("from"))
        to_dt = parse_iso_datetime(request.query_params.get("to"))
    except ValueError as e:
        return Response({"detail": f"Invalid datetime: {e}"}, status=400)

    # Smart default — last 24 hours ending at this machine's latest reading.
    # A sliding 24h window matches what an operations dashboard wants to
    # show ("what happened in the last day") and matches the Energy page's
    # default behaviour. A calendar-day window would clip to half a day on
    # an operator opening the page right after midnight.
    if to_dt is None:
        to_dt = get_max_recorded_at(machine_id=machine_id)
        if to_dt is None:
            return Response([])
    if from_dt is None:
        from_dt = to_dt - timedelta(hours=24)

    sql_query = sql.SENSOR_TIMESERIES_TPL.format(
        metric=metric,
        bucket_interval=bucket_interval,
    )
    with connection.cursor() as cursor:
        cursor.execute(sql_query, [machine_id, from_dt, to_dt])
        rows = cursor.fetchall()

    return Response([
        {"bucket": bucket.isoformat(), "value": value}
        for bucket, value in rows
    ])
