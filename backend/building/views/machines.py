"""Machine registry + per-machine sensor time-series."""

from django.db import connection
from django.http import Http404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import (
    ALLOWED_BUCKETS_FULL,
    ALLOWED_METRICS,
    dictfetchall,
    parse_iso_datetime,
    resolve_window,
)


@api_view(["GET"])
def list_machines(request):
    """All machines with their most recent reading nested as `latest_reading`.
    Machines with no readings get `latest_reading: null`."""
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

    Params: metric ∈ ALLOWED_METRICS (default power_kw),
            bucket ∈ ALLOWED_BUCKETS_FULL (default 5min),
            from/to ISO datetimes (default: last 24h of MAX(recorded_at)).
    Returns: [ {"bucket": <iso>, "value": <float>}, ... ].
    400 invalid metric/bucket/datetime; 404 machine not found.
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

    # Sliding 24h window vs calendar-day — operators want "last day", not
    # a window that clips to half a day right after local midnight.
    window = resolve_window(from_dt, to_dt, machine_id=machine_id)
    if window is None:
        return Response([])
    from_dt, to_dt = window

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
