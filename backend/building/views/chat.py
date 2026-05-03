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


# Cap context size — we don't need every decision, just enough to ground
# answers about "what did the AI change overnight?" type questions.
DECISIONS_FOR_CONTEXT = 20

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
    """Stitch a snapshot of the building's state into a single string.

    Three sections — machine snapshot, energy totals, recent decisions —
    each compact enough to comfortably fit in the prompt budget. We keep
    structured fields rather than narrating, so the model can reference
    exact numbers in answers without us having to re-format them.
    """
    machines, today_kwh, yesterday_kwh, decisions = _gather_context()

    lines: list[str] = [
        "You are ThermalOS Assistant, an AI helper for a building energy",
        "monitoring dashboard. Answer questions about building HVAC machines,",
        "energy consumption, and the AI control decisions the system has made.",
        "",
        "Ground every numerical claim in the snapshot below. If a question",
        "asks for data not present in the snapshot, say so plainly rather",
        "than guessing. Keep replies concise — under 6 sentences unless",
        "the user explicitly asks for more detail.",
        "",
        "## Machines (latest reading per machine)",
        "name | type | zone | status | power_kw | temp | setpoint | speed_pct",
    ]
    for m in machines:
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
        "## Energy totals",
        f"today_kwh: {today_kwh:.2f}",
        f"yesterday_kwh: "
        f"{yesterday_kwh:.2f}" if yesterday_kwh is not None else "yesterday_kwh: (no data)",
    ]

    lines += [
        "",
        f"## Recent AI decisions (last {len(decisions)})",
        "decided_at | machine | action | value | reason",
    ]
    for d in decisions:
        val = f"{d['value']:.1f}" if d["value"] is not None else "—"
        machine_name = d["machine_name"] or "(deleted)"
        lines.append(
            f"{d['decided_at'].isoformat()} | {machine_name} | "
            f"{d['action_type']} | {val} | {d['reason']}"
        )

    return "\n".join(lines)


def _gather_context() -> tuple[list[dict[str, Any]], float, float | None, list[dict[str, Any]]]:
    """Run the three context queries in one DB round-trip block.

    Returns (machines, today_kwh, yesterday_kwh_or_None, decisions).
    """
    max_ts = get_max_recorded_at()

    today_kwh = 0.0
    yesterday_kwh: float | None = None

    with connection.cursor() as cursor:
        cursor.execute(sql.LATEST_READING_PER_MACHINE)
        machine_rows = dictfetchall(cursor)

        if max_ts is not None:
            today_start = day_start(max_ts)
            today_end = today_start + timedelta(days=1)
            yesterday_start = today_start - timedelta(days=1)
            yesterday_end = today_start

            cursor.execute(sql.KWH_BETWEEN, [today_start, today_end])
            today_kwh = cursor.fetchone()[0] or 0.0

            cursor.execute(sql.KWH_BETWEEN, [yesterday_start, yesterday_end])
            yesterday_raw = cursor.fetchone()[0]
            yesterday_kwh = yesterday_raw if yesterday_raw and yesterday_raw > 0 else None

        # Latest 20 decisions, newest first — the snippet pattern
        # answers "what did the AI change overnight?" type questions.
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
        decisions = dictfetchall(cursor)

    return machine_rows, today_kwh, yesterday_kwh, decisions
