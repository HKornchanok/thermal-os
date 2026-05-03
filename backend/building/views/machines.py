"""Machine registry endpoints."""

from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import dictfetchall


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
