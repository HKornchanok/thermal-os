"""AI chat assistant grounded in live building telemetry.

If `ANTHROPIC_API_KEY` is unset the endpoint returns 200 with a
"not configured" reply instead of 500 — keeps the chat page
working in environments without the bonus dependency.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import connection
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from building import sql
from building.utils import (
    day_start,
    dictfetchall,
    get_max_recorded_at,
    yesterday_kwh_or_none,
)


# Snapshot is the bulk of the prompt by token count; pulling more than
# the minimum lets the model answer diagnostic questions ("why was
# yesterday high?") without hedging. Cached on the system block so
# the per-question cost is dominated by user message + reply tokens.
DECISIONS_FOR_CONTEXT = 40
DAILY_HISTORY_DAYS = 7

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024

# 4 KB caps Anthropic spend per call; longer pastes 400 rather than
# silently burning credit.
MAX_MESSAGE_LEN = 4000


class ChatRateThrottle(UserRateThrottle):
    """30/min/user — Anthropic calls cost real money and a logged-in
    client looping the endpoint can rack up spend fast."""

    scope = "chat"
    rate = "30/min"


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ChatRateThrottle])
def chat(request):
    """Single-turn grounded chat. POST { "message": str } → { "reply": str }.

    400 on empty/oversized message; 200 fallback when API key unset;
    502 on upstream Anthropic transport/auth/rate-limit error.
    """
    message = (request.data or {}).get("message", "")
    if not isinstance(message, str) or not message.strip():
        return Response(
            {"detail": "`message` is required and must be a non-empty string."},
            status=400,
        )
    if len(message) > MAX_MESSAGE_LEN:
        return Response(
            {"detail": f"`message` must be at most {MAX_MESSAGE_LEN} characters."},
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
        # Local import keeps the dep optional at import time.
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
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": message.strip()}],
        )
    except anthropic.APIStatusError as exc:
        return Response(
            {"detail": f"Upstream AI error ({exc.status_code})."},
            status=502,
        )
    except anthropic.APIConnectionError:
        return Response({"detail": "Could not reach AI service."}, status=502)
    except anthropic.AnthropicError as exc:
        return Response(
            {"detail": f"AI client error: {exc.__class__.__name__}"},
            status=502,
        )

    text_blocks = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
    reply = "\n".join(text_blocks).strip() or "(empty reply)"
    return Response({"reply": reply})


def _build_system_prompt() -> str:
    """Snapshot prompt with six grounded sections: machines, energy
    totals, hourly power, per-zone kWh, AI decisions, reference time."""
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
        lines += ["", "## Last 7 days daily kWh", "date | kwh"]
        for date, kwh in ctx["daily_kwh_history"]:
            lines.append(f"{date.isoformat()} | {kwh:.1f}")

    if ctx["hourly_yesterday"]:
        lines += ["", "## Yesterday hourly building power (kW)", "hour_utc | total_kw"]
        for bucket, kw in ctx["hourly_yesterday"]:
            lines.append(f"{bucket.isoformat()} | {kw}")
    if ctx["hourly_today"]:
        lines += ["", "## Today hourly building power so far (kW)", "hour_utc | total_kw"]
        for bucket, kw in ctx["hourly_today"]:
            lines.append(f"{bucket.isoformat()} | {kw}")

    if ctx["zone_yesterday"]:
        lines += ["", "## Yesterday per-zone kWh (sorted highest first)", "zone | kwh"]
        for zone, kwh in ctx["zone_yesterday"].items():
            lines.append(f"{zone} | {kwh}")
    if ctx["zone_today"]:
        lines += ["", "## Today per-zone kWh so far (sorted highest first)", "zone | kwh"]
        for zone, kwh in ctx["zone_today"].items():
            lines.append(f"{zone} | {kwh}")

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
    """Pull machines + today/yesterday/7-day kWh + hourly power + per-zone
    + recent decisions in one cursor session."""
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

            cursor.execute(sql.KWH_BETWEEN, [today_start, today_end])
            ctx["today_kwh"] = cursor.fetchone()[0] or 0.0
            cursor.execute(sql.KWH_BETWEEN, [yesterday_start, today_start])
            ctx["yesterday_kwh"] = yesterday_kwh_or_none(cursor.fetchone()[0])

            history_start = today_start - timedelta(days=DAILY_HISTORY_DAYS - 1)
            cursor.execute(sql.DAILY_KWH_HISTORY, [history_start, today_end])
            ctx["daily_kwh_history"] = [
                (bucket.date(), float(kwh or 0.0))
                for bucket, kwh in cursor.fetchall()
            ]

            hourly_sql = sql.TOTAL_ENERGY_TPL.format(bucket_interval="1 hour")
            cursor.execute(hourly_sql, [today_start, today_end])
            ctx["hourly_today"] = [
                (b, round(p or 0.0, 1)) for b, p in cursor.fetchall()
            ]
            cursor.execute(hourly_sql, [yesterday_start, today_start])
            ctx["hourly_yesterday"] = [
                (b, round(p or 0.0, 1)) for b, p in cursor.fetchall()
            ]

            cursor.execute(sql.ZONE_KWH_BETWEEN, [today_start, today_end])
            ctx["zone_today"] = {row[0]: round(row[1], 1) for row in cursor.fetchall()}
            cursor.execute(sql.ZONE_KWH_BETWEEN, [yesterday_start, today_start])
            ctx["zone_yesterday"] = {
                row[0]: round(row[1], 1) for row in cursor.fetchall()
            }

        cursor.execute(sql.DECISIONS_RECENT, [DECISIONS_FOR_CONTEXT])
        ctx["decisions"] = dictfetchall(cursor)

    return ctx
