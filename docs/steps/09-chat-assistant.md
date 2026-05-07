# 09 — AI Chat Assistant (bonus phase)

PR #19 — `feat/chat-assistant` → `main`

Implements DESIGN §"POST /api/chat/" + Phase 7 of the plan. Backend
endpoint + frontend chat surface, both wired to ground responses in
live building telemetry.

## Backend — `/api/chat/`

### Files

- `backend/building/views/chat.py` (new)
- `backend/building/views/__init__.py` (export `chat`)
- `backend/building/urls.py` (route)

### Behaviour matrix

| Input                       | Status | Body                                             |
| --------------------------- | ------ | ------------------------------------------------ |
| missing/empty `message`     | 400    | `{"detail": "..."}`                              |
| `ANTHROPIC_API_KEY` unset   | 200    | `{"reply": "AI assistant is not configured..."}` |
| `anthropic` package missing | 200    | `{"reply": "AI assistant is not installed..."}`  |
| upstream Anthropic error    | 502    | `{"detail": "Upstream AI error: ..."}`           |
| happy path                  | 200    | `{"reply": "<assistant text>"}`                  |

The "no key → 200" path is intentional and matches DESIGN — the chat
page must not 500 in environments without the bonus dependency
configured. The frontend renders the fallback message as a normal
assistant bubble, so the surface is always usable.

### Grounded system prompt

`_build_system_prompt()` stitches three slices into one cached system
block:

1. **Machines** — latest reading per machine via the existing
   `LATEST_READING_PER_MACHINE` SQL. One row per machine: name, type,
   zone, status, power_kw, temperature, setpoint, speed_pct.
2. **Energy totals** — `today_kwh` and `yesterday_kwh` via the same
   `KWH_BETWEEN` query the `/building/summary/` endpoint uses.
   Reference time is `MAX(recorded_at)`, not wall-clock now.
3. **Recent decisions** — last 20 AI decisions, newest first, with
   `LEFT JOIN building_machine` so deleted-machine rows still surface
   their historical reasoning.

Reusing the dashboard's SQL is the whole point: the model can't
disagree with the cards/tables because both render off the same data.

### Caching

The system block is sent with `cache_control: {type: "ephemeral"}`. The
snapshot turns over on the dashboard's 30s tick, but during a single
chat session multiple back-to-back questions reuse the cached prefix
— meaningful savings for the bulk of the prompt by token count.

### Model

`claude-sonnet-4-6`, `max_tokens=1024`. Sonnet is enough for the
single-turn structured-context Q&A this endpoint serves; Opus would
be overkill given the prompt is mostly tabular.

## Frontend — `/chat`

### Files

- `frontend/src/lib/api.ts` (added `ChatRequest` / `ChatResponse` types)
- `frontend/src/lib/hooks/use-chat.ts` (new — `useMutation` wrapper)
- `frontend/src/pages/chat.tsx` (was placeholder, now the page)

### Why mutation, not query

We don't want auto-refetch, dedup, or cache reuse — each ask is
intentional and the inputs are user-driven. `useMutation` matches the
semantics: fire on demand, surface `isPending` for the "Thinking…"
bubble, surface errors as a regular assistant message rather than
crashing the page.

### Page surface

- **Empty state** — Sparkles icon + 4 example prompt chips. Clicking
  a chip immediately sends, so the user can prove the surface works
  without typing.
- **Transcript** — alternating user (right, primary-tinted) and
  assistant (left, muted) bubbles. `whitespace-pre-wrap` preserves the
  model's formatting. Auto-scrolls to the bottom on new messages and
  during the pending state.
- **Composer** — `<textarea>` (multiline support) with ⌘/Ctrl+Enter
  shortcut. Plain Enter inserts a newline so longer questions don't
  get cut off mid-sentence. Disabled state during pending requests so
  rapid double-sends can't pile up. Submit button is disabled when
  input is empty or a request is in flight.
- **Error handling** — caught exceptions render as an assistant
  bubble prefixed with `⚠️` rather than wiping the transcript or
  popping a modal.

## Verification

- `docker compose restart backend` — backend healthy.
- `POST /api/chat/` empty body → 400.
- `POST /api/chat/` with message and no key → 200 + fallback string.
- Hot-reload picked up the frontend; `/chat` → 200.
- User confirmed visual review of the empty-state chips and the
  fallback-message round-trip.

## Up next

Phase 8 (the final pass): README quickstart, env example for
`ANTHROPIC_API_KEY`, manual end-to-end test plan, fmtNum() polish
across all KPI cards.
