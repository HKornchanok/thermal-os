"""AI chat assistant grounded in live building telemetry.

DESIGN §"POST /api/chat/" + Phase 7. The endpoint is intentionally
graceful: if `ANTHROPIC_API_KEY` is unset, it returns 200 with a
"not configured" reply rather than 500, so the chat page works in
local/CI environments without the bonus dependency.

Context construction reads three slices that the rest of the API
already exposes — latest reading per machine, today/yesterday kWh,
last 20 AI decisions — and packages them as a system prompt the
model can reason against. Reusing the SQL keeps facts consistent
across `/api/chat/` and the dashboard cards/tables.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from building import sql
from building.utils import day_start, dictfetchall, get_max_recorded_at


# Context budget. We pull more decisions + multi-day energy data than the
# minimum so the model can answer diagnostic questions ("why was energy
# high yesterday?", "which zone consumed most last week?") instead of
# hedging that it lacks the data. The prompt is cached on the system
# block so the per-question cost is dominated by the user message and
# the reply tokens, not the snapshot itself.
DECISIONS_FOR_CONTEXT = 40
DAILY_HISTORY_DAYS = 7

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat(request):
    """Single-turn grounded chat.

    Body:
        { "message": "<user question>" }

    Returns:
        { "reply": "<assistant text>" }

    Behaviour matrix:
        - empty/missing message → 400
        - ANTHROPIC_API_KEY unset → 200 with graceful fallback string
          (lets the FE render the page in environments without the
          bonus dep installed)
        - upstream Anthropic error → 502 with a short error string
        - happy path → 200 with the assistant's first text block
    """
    message = (request.data or {}).get("message", "")
    if not isinstance(message, str) or not message.strip():
        return Response(
            {"detail": "`message` is required and must be a non-empty string."},
            status=400,
        )

    api_key = getattr(settings, "ANTHROPIC_API_KEY", "")
    if not api_key:
        return Response(
            {
                "reply": (
                    "AI assistant is not configured for this deployment. "
                    "Set ANTHROPIC_API_KEY on the backend to enable grounded "
                    "answers about building telemetry."
                )
            }
        )

    try:
        # Local import keeps the anthropic dep optional at import time —
        # if the package isn't installed we still serve the graceful
        # fallback above (env var would be unset). Once the env var is
        # set, the import is expected to succeed.
        import anthropic
    except ImportError:
        return Response(
            {"reply": "AI assistant is not installed (anthropic package missing)."}
        )

    system_prompt = _build_system_prompt()

    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                # Cache the grounded snapshot — it's stable for the
                # 30-second tick window the frontend refetches at, and
                # this is the bulk of the prompt by token count.
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": message.strip()}],
        )
    except Exception as exc:  # noqa: BLE001
        return Response(
            {"detail": f"Upstream AI error: {exc.__class__.__name__}"},
            status=502,
        )

    text_blocks = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    reply = "\n".join(text_blocks).strip() or "(empty reply)"
    return Response({"reply": reply})


def _build_system_prompt() -> str:
    """Stitch a rich snapshot of the building's state into a single string.

    Six sections, all grounded in real DB queries:
      1. Machine snapshot — latest reading per machine
      2. Energy totals — today + yesterday + 7-day daily history
      3. Hourly building power — today and yesterday, hour-by-hour
      4. Per-zone daily kWh — today + yesterday, sorted by consumption
      5. AI decisions — last 40, covering ~3 calendar days
      6. (Implicit) Snapshot reference time

    Together they answer the diagnostic questions Somchai asks: which
    zone consumed most, why was yesterday high (compare hourly + zone
    totals + decisions for that day), what's the trend across the week.
    """
    ctx = _gather_context()

    lines: list[str] = [
        "You are ThermalOS Assistant, an AI helper for a Bangkok commercial",
        "building's energy monitoring dashboard. Answer questions about HVAC",
        "machines, energy consumption, AI control decisions, and trends.",
        "",
        "Ground every numerical claim in the data tables below — they ARE",
        "the answer to most questions about hourly patterns, daily trends,",
        "zone-level breakdowns, and what the AI did. When a question can",
        "be answered from the tables, give the specific numbers, do not",
        "hedge or ask the user to look elsewhere. Only say 'I don't have",
        "that data' when the answer truly isn't in the snapshot.",
        "",
        "Keep replies concise — under 6 sentences unless the user asks",
        "for detail. Bangkok timezone (UTC+7); all timestamps below are UTC.",
    ]

    if ctx["max_ts"] is not None:
        lines += ["", f"Snapshot reference time: {ctx['max_ts'].isoformat()}"]

    # 1. Machines.
    lines += [
        "",
        "## Machines (latest reading per machine)",
        "name | type | zone | status | power_kw | temp | setpoint | speed_pct",
    ]
    for m in ctx["machines"]:
        temp = f"{m['temperature']:.1f}" if m["temperature"] is not None else "—"
        sp = f"{m['setpoint']:.1f}" if m["setpoint"] is not None else "—"
        spd = f"{m['speed_pct']:.0f}" if m["speed_pct"] is not None else "—"
        pw = f"{m['power_kw']:.2f}" if m["power_kw"] is not None else "—"
        lines.append(
            f"{m['name']} | {m['machine_type']} | {m['zone']} | "
            f"{m['status']} | {pw} | {temp} | {sp} | {spd}"
        )

    # 2. Energy totals + daily history.
    lines += [
        "",
        "## Energy totals (kWh)",
        f"today_kwh: {ctx['today_kwh']:.2f}",
    ]
    if ctx["yesterday_kwh"] is not None:
        lines.append(f"yesterday_kwh: {ctx['yesterday_kwh']:.2f}")
    else:
        lines.append("yesterday_kwh: (no data)")

    if ctx["daily_kwh_history"]:
        lines += ["", "## Last 7 days daily kWh"]
        lines.append("date | kwh")
        for date, kwh in ctx["daily_kwh_history"]:
            lines.append(f"{date.isoformat()} | {kwh:.1f}")

    # 3. Hourly building power.
    if ctx["hourly_yesterday"]:
        lines += ["", "## Yesterday hourly building power (kW)"]
        lines.append("hour_utc | total_kw")
        for bucket, kw in ctx["hourly_yesterday"]:
            lines.append(f"{bucket.isoformat()} | {kw}")
    if ctx["hourly_today"]:
        lines += ["", "## Today hourly building power so far (kW)"]
        lines.append("hour_utc | total_kw")
        for bucket, kw in ctx["hourly_today"]:
            lines.append(f"{bucket.isoformat()} | {kw}")

    # 4. Per-zone daily kWh.
    if ctx["zone_yesterday"]:
        lines += ["", "## Yesterday per-zone kWh (sorted highest first)"]
        lines.append("zone | kwh")
        for zone, kwh in ctx["zone_yesterday"].items():
            lines.append(f"{zone} | {kwh}")
    if ctx["zone_today"]:
        lines += ["", "## Today per-zone kWh so far (sorted highest first)"]
        lines.append("zone | kwh")
        for zone, kwh in ctx["zone_today"].items():
            lines.append(f"{zone} | {kwh}")

    # 5. Decisions.
    lines += [
        "",
        f"## Recent AI decisions (last {len(ctx['decisions'])})",
        "decided_at | machine | action | value | reason",
    ]
    for d in ctx["decisions"]:
        val = f"{d['value']:.1f}" if d["value"] is not None else "—"
        machine_name = d["machine_name"] or "(deleted)"
        lines.append(
            f"{d['decided_at'].isoformat()} | {machine_name} | "
            f"{d['action_type']} | {val} | {d['reason']}"
        )

    return "\n".join(lines)


def _gather_context() -> dict[str, Any]:
    """Pull every slice the model needs to diagnose questions about
    energy, machines, and AI decisions.

    Returns a dict with:
        machines             — latest reading per machine (12 rows)
        today_kwh            — building total kWh, today (Bangkok day)
        yesterday_kwh        — building total kWh, yesterday (or None)
        daily_kwh_history    — list of (date, kwh) for last DAILY_HISTORY_DAYS
        hourly_today         — list of (hour_iso, total_kw) for today's 24
        hourly_yesterday     — list of (hour_iso, total_kw) for yesterday's 24
        zone_today           — {zone: kwh} for today
        zone_yesterday       — {zone: kwh} for yesterday
        decisions            — last DECISIONS_FOR_CONTEXT rows
        max_ts               — for "snapshot taken at" line in the prompt
    """
    max_ts = get_max_recorded_at()
    ctx: dict[str, Any] = {
        "machines": [],
        "today_kwh": 0.0,
        "yesterday_kwh": None,
        "daily_kwh_history": [],
        "hourly_today": [],
        "hourly_yesterday": [],
        "zone_today": {},
        "zone_yesterday": {},
        "decisions": [],
        "max_ts": max_ts,
    }

    with connection.cursor() as cursor:
        cursor.execute(sql.LATEST_READING_PER_MACHINE)
        ctx["machines"] = dictfetchall(cursor)

        if max_ts is not None:
            today_start = day_start(max_ts)
            today_end = today_start + timedelta(days=1)
            yesterday_start = today_start - timedelta(days=1)

            # Today + yesterday totals (existing).
            cursor.execute(sql.KWH_BETWEEN, [today_start, today_end])
            ctx["today_kwh"] = cursor.fetchone()[0] or 0.0
            cursor.execute(sql.KWH_BETWEEN, [yesterday_start, today_start])
            yraw = cursor.fetchone()[0]
            ctx["yesterday_kwh"] = yraw if yraw and yraw > 0 else None

            # Last 7 days daily kWh. Loop is fine — N=7 is small.
            history: list[tuple[Any, float]] = []
            for offset in range(DAILY_HISTORY_DAYS, 0, -1):
                day_s = today_start - timedelta(days=offset - 1)
                day_e = day_s + timedelta(days=1)
                cursor.execute(sql.KWH_BETWEEN, [day_s, day_e])
                history.append((day_s.date(), cursor.fetchone()[0] or 0.0))
            ctx["daily_kwh_history"] = history

            # Hourly building power for today + yesterday — bucketed
            # via TOTAL_ENERGY_TPL with a 1-hour interval. Value is the
            # SUM(power_kw) at each bucket — the building's power draw
            # in kW for that hour.
            hourly_sql = sql.TOTAL_ENERGY_TPL.format(bucket_interval="1 hour")
            cursor.execute(hourly_sql, [today_start, today_end])
            ctx["hourly_today"] = [
                (b, round(p or 0.0, 1)) for b, p in cursor.fetchall()
            ]
            cursor.execute(hourly_sql, [yesterday_start, today_start])
            ctx["hourly_yesterday"] = [
                (b, round(p or 0.0, 1)) for b, p in cursor.fetchall()
            ]

            # Per-zone daily kWh — one row per zone per day. Multiplying
            # the 5-min sample power_kw by 5/60 converts to kWh, same
            # logic as KWH_BETWEEN.
            zone_sql = """
                SELECT m.zone,
                       COALESCE(SUM(sr.power_kw), 0) * 5.0 / 60.0 AS kwh
                FROM building_sensorreading sr
                JOIN building_machine m ON m.id = sr.machine_id
                WHERE sr.recorded_at >= %s AND sr.recorded_at < %s
                GROUP BY m.zone
                ORDER BY kwh DESC
            """
            cursor.execute(zone_sql, [today_start, today_end])
            ctx["zone_today"] = {row[0]: round(row[1], 1) for row in cursor.fetchall()}
            cursor.execute(zone_sql, [yesterday_start, today_start])
            ctx["zone_yesterday"] = {
                row[0]: round(row[1], 1) for row in cursor.fetchall()
            }

        cursor.execute(
            """
            SELECT a.id, a.decided_at, a.machine_id, m.name AS machine_name,
                   a.action_type, a.value, a.reason
            FROM building_aidecision a
            LEFT JOIN building_machine m ON m.id = a.machine_id
            ORDER BY a.decided_at DESC
            LIMIT %s
            """,
            [DECISIONS_FOR_CONTEXT],
        )
        ctx["decisions"] = dictfetchall(cursor)

    return ctx
