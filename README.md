# ThermalOS

[![CI](https://github.com/HKornchanok/alto-tech/actions/workflows/ci.yml/badge.svg)](https://github.com/HKornchanok/alto-tech/actions/workflows/ci.yml)

Building energy monitoring dashboard for the AltoTech full-stack assessment.
Tracks 12 HVAC machines (large ACs, small ACs, fans) across 6 zones, surfaces
live KPIs, time-series charts, an AI decision audit trail, before/after energy
comparison, derived alerts, and an Anthropic-grounded chat assistant.

> Authoritative spec: [`DESIGN.md`](./DESIGN.md). Implementation plan with
> per-phase task breakdown: [`PLAND.md`](./PLAND.md). Per-step delivery notes:
> [`docs/steps/`](./docs/steps/).

## Quickstart

Requires Docker Desktop (or compatible). One command to bring the stack up:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
docker compose up
```

Then open <http://localhost:3000> and sign in with `admin` / `admin`.

The first-time bring-up:

1. Builds backend (Python 3.12, Django 5, DRF, SimpleJWT) and frontend (Node
   20, Next.js 14) images.
2. Starts TimescaleDB (Postgres 15 + the `timescaledb` extension).
3. Applies migrations and converts `building_sensorreading` to a hypertable.
4. Seeds 12 machines and ~121k sensor readings spanning 35 days. The first
   ~17 days are "manual operations" (steady high power, oscillating temps);
   the last ~17 days are "AI control" (lower averages, tighter setpoints) so
   the `/compare` page has a real before/after delta to show.

Subsequent `docker compose up` is fast — migrations and seed are idempotent.

## Logging in

Default superuser:

| field    | value |
|----------|-------|
| username | `admin` |
| password | `admin` |

Created by the seed command. Auth is JWT (SimpleJWT) issued by the backend at
`/api/auth/token/`; NextAuth wraps the token in an httpOnly cookie. Access
tokens live 30 minutes; refresh tokens 7 days.

## Routes

| Route        | What lives here |
|--------------|-----------------|
| `/`          | Overview — alert banner, 6 KPI cards, 12-card machine grid |
| `/machines`  | Per-machine sensor chart with metric tabs (Power / Temp / Setpoint / Speed) |
| `/energy`    | Building-wide energy timeseries, Total ↔ By Zone toggle, day stepper |
| `/decisions` | Paginated AI decision log with column filters (date, action, machine) |
| `/compare`   | Before/After comparison — KPIs + overlaid hourly area chart |
| `/chat`      | Anthropic-grounded assistant (set `ANTHROPIC_API_KEY` to enable) |

## Architecture

```
┌─────────────┐   /api/auth/* (local)   ┌────────────────────┐
│  Browser    │────────────────────────▶│ NextAuth (Pages)   │
│  React 18   │                          │ src/pages/api/auth │
│  TanStack   │                          └────────────────────┘
│  Query      │   /api/* (proxied)
│             │────────────────────────▶┌────────────────────┐
└─────────────┘                          │ Django + DRF       │
       ▲                                 │ /api/machines/     │
       │                                 │ /api/building/...  │
       │                                 │ /api/decisions/    │
       │                                 │ /api/alerts/       │
       │                                 │ /api/energy/...    │
       │                                 │ /api/chat/         │
       │                                 └────────────────────┘
       │                                          │
       │                                          ▼
       │                                 ┌────────────────────┐
       │                                 │ TimescaleDB        │
       │                                 │ (PG15 + hypertable)│
       │                                 └────────────────────┘
       │
       └─── Recharts (theme-token colours, OKLCH via color-mix)
```

Frontend rewrites isolation: `/api/auth/*` resolves locally to NextAuth's
catch-all; `/api/*` falls through to Django. Trailing slash hardcoded in the
Django destination so APPEND_SLASH never 301s back into a redirect loop.

Data pattern across pages: every read endpoint uses a TanStack Query hook
(`use-*` in `frontend/src/lib/hooks/`) gated on `!!session?.accessToken`.
Live pages (Overview, Machines, Energy, Alerts) refetch every 30s; slow-moving
pages (Decisions, Compare) skip the interval.

## Tech stack

**Backend** — Python 3.12, Django 5, DRF, SimpleJWT, django-cors-headers,
psycopg, anthropic SDK. Hot paths use raw SQL via `connection.cursor()` for
performance (DESIGN §1B mandates this).

**Database** — TimescaleDB on Postgres 15. `building_sensorreading` is a
hypertable chunked daily; indexes on `(machine_id, recorded_at DESC)` and
`(recorded_at DESC)` for the two query shapes that matter.

**Frontend** — Next.js 14 (Pages Router), TypeScript, TanStack Query,
TanStack Table, NextAuth.js, Recharts, shadcn/ui (new-york variant) + tweakcn
green/yellow theme, next-themes for light/dark, Tailwind 3.

**Tooling** — Prettier + Husky pre-commit hook (formats only staged files),
ruff for Python, pytest-django for backend tests.

## Manual end-to-end test plan

After `docker compose up` and login as `admin`:

1. **Overview (`/`)** — Alert banner shows 1+ alerts (1 critical, 2 warning
   on a fresh seed). 6 KPI cards populate (~12 / ~5 / ~96 kW / ~754 kWh /
   ~430 kWh / ~25°C). 12 machine cards render in a responsive grid. Click a
   card → routes to `/machines?selected=<id>`.

2. **Machines (`/machines`)** — Grid renders. Click any machine: detail
   panel shows StatusBadge + metric Tabs + 24h area chart with hourly X
   ticks. Tabs disable invalid combos (fans hide Temp/Setpoint, ACs hide
   Speed).

3. **Energy (`/energy`)** — Toggle Total ↔ By Zone, both render. By Zone
   shows a stacked area + zone legend with show/hide checkboxes. Step day
   with ←/→; reset back to "Last 24 hours" via clearing the date.

4. **Decisions (`/decisions`)** — Paginate forward and back. Open a column
   filter popover and apply a filter (action multiselect or date operator).
   "Clear filters" resets state.

5. **Compare (`/compare`)** — Default load shows server-resolved boundaries
   echoed as `default YYYY-MM-DD` hints. KPIs read ~794 / ~644 / 18.8%.
   Chart overlays Before AI and After AI on a shared elapsed-hours axis.
   Override either period and the KPIs + chart re-resolve.

6. **Alerts** — On the Overview page, edit a seed row to push `power_kw`
   above 0.9× rated (or change the latest reading's `recorded_at` so a
   machine has been ON >16h). Within 30s the banner refreshes with a new
   row.

7. **Chat (`/chat`)** — Without `ANTHROPIC_API_KEY`: empty state + 4
   example chips, clicking one returns the graceful fallback message in an
   assistant bubble. With the key set, replies cite real numbers from the
   seed.

To enable real chat:

```sh
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d --force-recreate backend
```

## Verification

**Backend tests** — `docker compose exec backend pytest -q` → 125 passed.

**Frontend** — from `frontend/`:

```sh
npm install
npm run typecheck
npm run build
```

Both clean.

**Format check** — Prettier runs automatically on every `git commit` against
the staged files (Husky + lint-staged). Run on demand with `npm run format`
or `npm run format:check` from `frontend/`.

## Trade-off notes

See [`DESIGN.md` §"Trade-Off Notes"](./DESIGN.md). Key choices documented
inline in the spec: raw SQL over the ORM for hot paths, server-side pivot
for by-zone, JWT-in-cookie via NextAuth, and 30s polling instead of
WebSockets for live updates.

## Project structure

```
alto-tech/
├── backend/
│   ├── building/           # The single Django app
│   │   ├── views/          # One file per endpoint group
│   │   ├── sql.py          # Raw-SQL constants
│   │   ├── models.py       # Machine, SensorReading, AIDecision
│   │   ├── management/commands/seed.py
│   │   └── tests/
│   ├── thermalos/          # Project settings + URLs
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── pages/          # Next.js routes
│   │   ├── components/     # dashboard/, data-table/, layout/, ui/
│   │   ├── features/       # Page-specific column defs etc.
│   │   ├── lib/            # api.ts, hooks/, chart.ts, utils.ts
│   │   └── styles/globals.css
│   ├── .husky/             # Pre-commit hook
│   ├── .prettierrc.json
│   └── package.json
├── docs/steps/             # NN-* notes, one per delivery step
├── docker-compose.yml
├── DESIGN.md               # The spec
├── PLAND.md                # Phase-by-phase plan
└── README.md               # This file
```

## Development workflow

- One PR per delivery step; commits use Conventional Commits.
- Per-step delivery notes land in `docs/steps/NN-*.md`.
- Pre-commit hook runs Prettier on staged frontend files. Backend Python
  is formatted by ruff (run manually).
- Backend tests live in `backend/building/tests/` — `pytest -q` runs them.

## Production deploy

The default `docker-compose.yml` is dev-only (`runserver`, `next dev`).
For an exposed deployment use the production variant:

```bash
cp .env.prod.example .env.prod   # fill in secrets
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

What that gives you:
- Backend behind **gunicorn** (3 workers) with **WhiteNoise** serving
  collected admin static under `DEBUG=False`
- Frontend in Next.js **standalone** mode, non-root, ~150 MB image
- DB password / Django secret / NextAuth secret all required (compose
  refuses to boot otherwise)
- Backend port not published — the frontend is the only public surface

For real production the same images push cleanly to Fly / Railway /
Cloud Run (backend) + Vercel (frontend) with a managed
TimescaleDB-compatible Postgres. See `docs/steps/25-production-deploy-prep.md`
for details and the `ALLOWED_HOSTS` gotcha.

## What I'd improve with more time

Honest take on what's missing or could be sharper, grouped by where it
would most affect the system. Most of these aren't blockers for the
current data volume / single-tenant use case but would matter as the
system grows.

### Performance & data layer

- **TimescaleDB continuous aggregates** for the hourly building total
  and per-zone daily kWh queries the chat assistant pumps into its
  system prompt. At 24k rows the raw `time_bucket` queries are
  ~10–30 ms; at millions they'd want pre-materialised aggregates
  refreshing on a schedule. Already noted in DESIGN.md.
- **Cursor pagination on `/api/decisions/`.** Current `LIMIT/OFFSET`
  works for the 40-row demo but gets expensive past the first ~10k
  decisions because Postgres still walks the offset rows.
- **Redis cache** in front of `/api/machines/` and `/api/building/summary/`
  with a short TTL. Both are polled every 30s by every connected
  client; for a multi-user deployment one shared cache flatten the
  query load.
- **Server-side rate limiting on `/api/chat/`.** Each call costs
  Anthropic credits — a malicious or misconfigured client could
  drain a budget fast. DRF throttling on the chat endpoint is the
  right scope (low rate, per-user quota).

### Reliability & ops

- **Real CI pipeline** — GitHub Actions running `pytest`,
  `npm run typecheck`, and `npm run build` on every PR. Currently
  these gates exist but are run manually; CI would catch
  regressions before merge.
- **Production server** instead of `runserver`. Gunicorn (WSGI) or
  Uvicorn (ASGI) behind nginx. The Dockerfile still uses Django's
  development server because the assessment is local-only.
- **Structured logging with correlation IDs.** Every request gets
  a UUID; logs from the FE, BE, and DB tag each line with it so
  debugging "why was this user's chart blank?" becomes one grep
  instead of a forensic exercise.
- **Health check endpoint** (`/api/health/`) for orchestration
  readiness probes — distinct from `/api/auth/token/` which is the
  current de-facto liveness check.
- **Sentry / similar APM** for error tracking. Errors currently
  land in container logs only.

### Frontend

- **Real e2e tests** built on Playwright. We used Playwright for
  ad-hoc audits during development; turning the manual test plan in
  this README into a Playwright suite that runs in CI would catch
  regressions in critical flows (login → Overview → drill into a
  machine → see the chart populate).
- **Storybook** for the shared dashboard components (`KpiCard`,
  `MachineCard`, `AlertBanner`, `AreaChart` permutations).
  Visual-regression coverage matters for a chart-heavy dashboard
  where styling drift is invisible until someone notices.
- **Skeleton loading states** instead of spinner-only `LoadingState`.
  Mainly an issue on the Overview where six KPIs and twelve cards
  pop in together — skeletons would make the perceived load smoother.
- **Accessibility pass** with axe-core in CI. We did manual focus-ring
  + keyboard nav fixes during the audit (PR #24) but didn't audit
  for screen-reader semantics on every component (e.g. chart data
  is fundamentally inaccessible to screen readers right now).
- **Bundle analysis + per-route code splitting.** The /decisions
  page pulls in TanStack Table; the /chat page pulls in
  react-markdown. Both should be lazy-loaded so the Overview's
  first paint isn't paying for code it doesn't use.

### AI & chat

- **Tool-calling instead of front-loaded context.** The chat system
  prompt currently pumps ~8.5 KB of structured snapshots in front
  of every question. A more elegant pattern: expose the existing API
  endpoints as Anthropic tools and let Sonnet pull only what it
  needs ("get_zone_kwh(date='2026-05-04')" instead of dumping all
  zone data up front). Lower per-question token cost and richer
  follow-ups.
- **Multi-turn conversations.** Right now every question is
  single-turn — the assistant has no memory of "what did you mean
  earlier?" Threading conversation state through `/api/chat/`
  (server-side or client-managed history array) would unlock
  follow-up questions.
- **Streaming replies.** Sonnet's `messages.stream()` API gives the
  user words-per-second feedback rather than a thinking spinner →
  full reply pop. Same network cost, much better perceived latency.

### Features

- **Cost view.** Energy is shown in kWh; operators ultimately care
  about money. A configurable `$/kWh` tariff converts every total
  into baht/USD on the same screen.
- **Energy budgets per zone.** "Floor 1 should not exceed 80 kWh/day"
  → an alert when it's tracking to overrun. Different mental model
  from the threshold alerts (90% of rated etc.) — those are
  fault-detection, budgets are operational targets.
- **Daily / weekly / monthly summary** cards on the Overview.
  Currently the dashboard only frames "today vs yesterday"; a
  rolling 7-day or month-to-date number tells a different story.
- **Option B from the brief — one-click PDF report.** We did Options
  A and C; B (monthly PDF for management) was deferred. ReportLab
  or WeasyPrint server-side, scheduled or on-demand.

### Data realism

- **Real outdoor weather API** instead of the sinusoidal model.
  OpenWeatherMap or local meteorological feed — the seed currently
  fakes a daily 24°C → 34°C cycle. Real weather drives real load,
  which would make the AI control narrative more meaningful.
- **Replace canned AI decisions with an actual optimisation pass.**
  The seed's `_gen_day_decisions` produces a hand-curated 10
  events/day. A small linear programming model (or even a
  heuristic) reading the sensor stream and producing decisions
  would let the dashboard demo a closed loop, not a replay.

### Security

- **API rate limiting** via DRF throttling — anonymous-burst,
  per-user, and per-endpoint scopes (`/api/chat/` deserves
  stricter limits than `/api/machines/`).
- **CSP headers** on the frontend response (Next.js middleware).
  Currently absent — script-src is wide open in dev.
- **Audit log** for sign-ins, machine config changes, and AI
  decision overrides. The `building_aidecision` table already
  models "who/what/when/why" for the AI; an analogous table for
  human actions would close the loop.
- **2FA for admin accounts.** SimpleJWT supports custom claims,
  TOTP integration is straightforward; assessment scope is
  `admin/admin` so this is firmly out of scope right now.

### Code quality

- **OpenAPI schema → frontend types.** `frontend/src/lib/api.ts`
  hand-mirrors backend response shapes. drf-spectacular on the
  backend + openapi-typescript on the frontend would generate
  these types from a single source.
- **Backend pre-commit hook.** Frontend gets Prettier on every
  commit via husky; backend ruff is run manually. Adding ruff
  to the pre-commit pipeline would keep both sides consistent.
- **Coverage reports.** 125 tests pass but coverage isn't measured.
  `pytest --cov` + a CI report would surface untested paths
  (e.g. the chat error-handling branches that surfaced during
  PR #36 weren't covered until that PR added them).
