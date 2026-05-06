"""Active anomaly alerts derived from latest readings + recent history."""

from django.db import connection
from rest_framework.decorators import api_view
from rest_framework.response import Response

from building import sql
from building.utils import dictfetchall


_SEVERITY_ORDER = {"critical": 0, "warning": 1}
_POWER_THRESHOLD_FRACTION = 0.90
_TEMP_DRIFT_THRESHOLD = 2.0
_NONSTOP_THRESHOLD_HOURS = 16


@api_view(["GET"])
def alerts_list(request):
    """Active anomaly alerts, computed on the fly (no persistent table).

    Three rules (DESIGN.md §1B):
      1. power_spike     WARNING  power_kw > 0.90 × rated, latest = ON
      2. temp_drift      WARNING  |temp − setpoint| > 2°C, latest AC ON
      3. nonstop_runtime CRITICAL non-critical machine ON >16h straight

    Sorted critical first, then alphabetical by machine_name.
    """
    alerts: list[dict] = []

    with connection.cursor() as cursor:
        cursor.execute(sql.ALERT_POWER_SPIKE)
        for r in dictfetchall(cursor):
            pct = r["power_kw"] / r["rated_power_kw"] * 100
            alerts.append(
                {
                    "severity": "warning",
                    "rule": "power_spike",
                    "machine_id": r["machine_id"],
                    "machine_name": r["name"],
                    "message": (
                        f"{r['name']} at {r['power_kw']:.1f} kW "
                        f"({pct:.0f}% of {_format_rated(r['rated_power_kw'])} kW rated)"
                    ),
                    "value": round(r["power_kw"], 2),
                    "threshold": round(r["rated_power_kw"] * _POWER_THRESHOLD_FRACTION, 2),
                }
            )

        cursor.execute(sql.ALERT_TEMP_DRIFT)
        for r in dictfetchall(cursor):
            drift = abs(r["temperature"] - r["setpoint"])
            alerts.append(
                {
                    "severity": "warning",
                    "rule": "temp_drift",
                    "machine_id": r["machine_id"],
                    "machine_name": r["name"],
                    "message": (
                        f"{r['name']} zone temp {r['temperature']:.1f}°C vs "
                        f"setpoint {r['setpoint']:.1f}°C (drift: {drift:.1f}°C)"
                    ),
                    "value": round(drift, 2),
                    "threshold": _TEMP_DRIFT_THRESHOLD,
                }
            )

        cursor.execute(sql.ALERT_NONSTOP)
        for r in dictfetchall(cursor):
            hours = int(r["hours_on"])
            alerts.append(
                {
                    "severity": "critical",
                    "rule": "nonstop_runtime",
                    "machine_id": r["machine_id"],
                    "machine_name": r["name"],
                    "message": f"{r['name']} has been ON for {hours} consecutive hours",
                    "value": hours,
                    "threshold": _NONSTOP_THRESHOLD_HOURS,
                }
            )

    alerts.sort(key=lambda a: (_SEVERITY_ORDER.get(a["severity"], 99), a["machine_name"]))
    return Response(alerts)


def _format_rated(rated: float) -> str:
    """Trim trailing .0 — "45 kW rated" reads better than "45.0 kW rated"."""
    return str(int(rated)) if rated == int(rated) else f"{rated:.1f}"
