"""Before-vs-after energy comparison."""

from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import get_min_max_recorded_at, parse_iso_datetime


@api_view(["GET"])
def compare(request):
    """Average building power for two periods (A and B) plus savings_pct.

    Query params (all optional — any subset can be supplied):
        a_from, a_to    Period A (e.g. "before AI" / manual operations)
        b_from, b_to    Period B (e.g. "after AI" / automated operations)

    Smart defaults: when ANY of the four params is missing, fill remaining
    ones from the seed boundaries — Period A = [MIN, midpoint),
    Period B = [midpoint, MAX]. Caller can override any subset.

    Returns:
        {
          "before": { "from": <iso>, "to": <iso>, "avg_kw": <float> },
          "after":  { "from": <iso>, "to": <iso>, "avg_kw": <float> },
          "savings_pct": <float>   // (before - after) / before × 100
        }

    Implementation: average of hourly totals (`SUM(power_kw)` bucketed at
    1 hour) within each period. Avg-of-hourly-sums smooths over per-interval
    noise and gives a stable comparison figure regardless of period length.
    """
    try:
        a_from = parse_iso_datetime(request.query_params.get("a_from"))
        a_to = parse_iso_datetime(request.query_params.get("a_to"))
        b_from = parse_iso_datetime(request.query_params.get("b_from"))
        b_to = parse_iso_datetime(request.query_params.get("b_to"))
    except ValueError as e:
        return Response({"detail": f"Invalid datetime: {e}"}, status=400)

    if any(p is None for p in (a_from, a_to, b_from, b_to)):
        min_ts, max_ts = get_min_max_recorded_at()
        if min_ts is None or max_ts is None:
            return Response({"before": None, "after": None, "savings_pct": None})

        midpoint = min_ts + (max_ts - min_ts) / 2
        a_from = a_from or min_ts
        a_to = a_to or midpoint
        b_from = b_from or midpoint
        b_to = b_to or max_ts

    if a_from >= a_to or b_from >= b_to:
        return Response({"detail": "from must be earlier than to"}, status=400)

    with connection.cursor() as cursor:
        cursor.execute(sql.COMPARE_AVG, [a_from, a_to])
        before_avg = cursor.fetchone()[0] or 0.0
        cursor.execute(sql.COMPARE_AVG, [b_from, b_to])
        after_avg = cursor.fetchone()[0] or 0.0

    if before_avg > 0:
        savings_pct = (before_avg - after_avg) / before_avg * 100.0
    else:
        # Either no data in Period A, or it averages to 0. Either way,
        # savings is undefined — return null so the frontend can render
        # "—" instead of NaN.
        savings_pct = None

    return Response(
        {
            "before": {
                "from": a_from.isoformat(),
                "to": a_to.isoformat(),
                "avg_kw": round(before_avg, 2),
            },
            "after": {
                "from": b_from.isoformat(),
                "to": b_to.isoformat(),
                "avg_kw": round(after_avg, 2),
            },
            "savings_pct": round(savings_pct, 2) if savings_pct is not None else None,
        }
    )
