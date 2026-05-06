"""Paginated AI decision log endpoint."""

from math import ceil

from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import (
    ALLOWED_ACTIONS,
    parse_iso_datetime,
    resolve_window,
)


PAGE_SIZE_MIN = 1
PAGE_SIZE_MAX = 100


@api_view(["GET"])
def decisions_list(request):
    """Server-side paginated AI decision log.

    Params: from/to (default last 7 days of MAX(recorded_at)),
            action ∈ ALLOWED_ACTIONS (comma-separated list ok),
            page (default 1), page_size ∈ [1,100] (default 20).
    Returns: {count, page, page_size, total_pages, results}.
    Decisions whose machine was deleted keep machine_name = null.
    """
    try:
        from_dt = parse_iso_datetime(request.query_params.get("from"))
        to_dt = parse_iso_datetime(request.query_params.get("to"))
    except ValueError as e:
        return Response({"detail": f"Invalid datetime: {e}"}, status=400)

    action_param = request.query_params.get("action") or None
    actions: list[str] | None = None
    if action_param:
        actions = [a.strip() for a in action_param.split(",") if a.strip()]
        for a in actions:
            if a not in ALLOWED_ACTIONS:
                return Response({"detail": f"Invalid action: {a!r}"}, status=400)
        if not actions:
            actions = None  # ?action=,, → no filter

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

    window = resolve_window(from_dt, to_dt, default_hours=24 * 7)
    if window is None:
        return Response(
            {
                "count": 0,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
                "results": [],
            }
        )
    from_dt, to_dt = window

    offset = (page - 1) * page_size

    with connection.cursor() as cursor:
        cursor.execute(sql.DECISIONS_COUNT, [from_dt, to_dt, actions, actions])
        count = cursor.fetchone()[0]

        cursor.execute(
            sql.DECISIONS_PAGE,
            [from_dt, to_dt, actions, actions, page_size, offset],
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
