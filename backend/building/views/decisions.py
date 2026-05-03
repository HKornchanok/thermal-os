"""Paginated AI decision log endpoint."""

from datetime import timedelta
from math import ceil

from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import (
    ALLOWED_ACTIONS,
    get_max_recorded_at,
    parse_iso_datetime,
)


# Caps page_size to a sane range. Design says default 20, common sizes
# 10/20/50; we allow 1-100 for flexibility while keeping query cost bounded.
PAGE_SIZE_MIN = 1
PAGE_SIZE_MAX = 100


@api_view(["GET"])
def decisions_list(request):
    """Server-side paginated AI decision log.

    Query params (all optional):
        from        ISO 8601 datetime  default = `to` − 7 days
        to          ISO 8601 datetime  default = MAX(recorded_at)
        action      ∈ {turn_on, turn_off, set_temp}  default = no filter
        page        int >= 1           default 1
        page_size   int in [1, 100]    default 20

    Returns the standard paginated envelope:
        {
          "count":       <int total matching rows>,
          "page":        <int>,
          "page_size":   <int>,
          "total_pages": <int>,
          "results":     [ <DecisionItem>, ... ]
        }

    Decisions whose machine has been deleted (ON DELETE SET NULL) still
    appear with machine_name = null so the audit trail is preserved.
    """
    try:
        from_dt = parse_iso_datetime(request.query_params.get("from"))
        to_dt = parse_iso_datetime(request.query_params.get("to"))
    except ValueError as e:
        return Response({"detail": f"Invalid datetime: {e}"}, status=400)

    action = request.query_params.get("action") or None
    if action is not None and action not in ALLOWED_ACTIONS:
        return Response({"detail": f"Invalid action: {action!r}"}, status=400)

    try:
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))
    except ValueError:
        return Response(
            {"detail": "page and page_size must be integers"}, status=400
        )

    if page < 1:
        return Response({"detail": "page must be >= 1"}, status=400)
    if not (PAGE_SIZE_MIN <= page_size <= PAGE_SIZE_MAX):
        return Response(
            {
                "detail": (
                    f"page_size must be between {PAGE_SIZE_MIN} and {PAGE_SIZE_MAX}"
                )
            },
            status=400,
        )

    # Smart defaults — last 7 days of activity anchored to MAX(recorded_at).
    if to_dt is None:
        to_dt = get_max_recorded_at()
        if to_dt is None:
            return Response(
                {
                    "count": 0,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": 0,
                    "results": [],
                }
            )
    if from_dt is None:
        from_dt = to_dt - timedelta(days=7)

    offset = (page - 1) * page_size

    with connection.cursor() as cursor:
        cursor.execute(sql.DECISIONS_COUNT, [from_dt, to_dt, action, action])
        count = cursor.fetchone()[0]

        cursor.execute(
            sql.DECISIONS_PAGE,
            [from_dt, to_dt, action, action, page_size, offset],
        )
        rows = cursor.fetchall()

    total_pages = ceil(count / page_size) if count else 0
    results = [
        {
            "id": id_,
            "decided_at": decided_at.isoformat(),
            "machine": machine_id,
            "machine_name": machine_name,
            "action_type": action_type,
            "value": value,
            "reason": reason,
        }
        for id_, decided_at, machine_id, machine_name, action_type, value, reason in rows
    ]

    return Response(
        {
            "count": count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "results": results,
        }
    )
