# ThermalOS

[![CI](https://github.com/HKornchanok/alto-tech/actions/workflows/ci.yml/badge.svg)](https://github.com/HKornchanok/alto-tech/actions/workflows/ci.yml)

Building energy monitoring dashboard for the AltoTech full-stack
assessment. Tracks 12 HVAC machines across 6 zones with live KPIs,
time-series charts, an AI decision audit trail, before/after energy
comparison, derived alerts, and an Anthropic-grounded chat assistant.

> Spec: [`DESIGN.md`](./DESIGN.md) · Plan: [`PLAND.md`](./PLAND.md)
> · Per-step notes: [`docs/steps/`](./docs/steps/)

## Quickstart

Requires Docker Desktop (or compatible).

```sh
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
docker compose up
```

Open <http://localhost:3000>, sign in with `admin` / `admin`. First
bring-up builds the images, applies migrations, converts
`building_sensorreading` to a Timescale hypertable, and seeds 12
machines + ~24k readings spanning 7 days (4 days "manual" + 3 days
"AI" so the `/compare` page has a real before/after delta).

To enable the chat assistant, set `ANTHROPIC_API_KEY` and recreate the
backend container. Without the key, `/chat` returns a graceful
fallback message.

## Frontend routes

| Route        | Surface                                                |
| ------------ | ------------------------------------------------------ |
| `/`          | Overview — alert banner, 6 KPI cards, 12 machine cards |
| `/machines`  | Per-machine sensor chart with metric tabs              |
| `/energy`    | Building-wide timeseries, Total ↔ By Zone toggle       |
| `/decisions` | Paginated AI decision log with column filters          |
| `/compare`   | Before/After KPIs + overlaid hourly chart              |
| `/chat`      | Anthropic-grounded assistant                           |

## API

All endpoints are JSON, JWT-protected (Bearer header). Full request/response
shapes in [`DESIGN.md §1B`](./DESIGN.md).

| Endpoint                             | Returns                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `POST /api/auth/token/`              | Access (30 min) + refresh (7 d) tokens               |
| `POST /api/auth/token/refresh/`      | New access token                                     |
| `GET  /api/machines/`                | 12 machines + latest reading per machine             |
| `GET  /api/machines/{id}/sensors/`   | Time-series for one metric (allowlisted bucket)      |
| `GET  /api/building/summary/`        | 8-field overview (kWh today, trend, avg temp, …)     |
| `GET  /api/building/energy/`         | Building-wide power timeseries (15min / 1h buckets)  |
| `GET  /api/building/energy/by-zone/` | Zone breakdown, server-side pivot                    |
| `GET  /api/decisions/`               | Paginated AI decisions, filterable by date / action  |
| `GET  /api/energy/compare/`          | Before-vs-after avg power + `savings_pct`            |
| `GET  /api/alerts/`                  | Derived alerts (3 rules, no DB writes)               |
| `POST /api/chat/`                    | Anthropic reply with grounded context (rate-limited) |

NextAuth wraps the JWT in a signed httpOnly cookie so the access token
never touches `localStorage`.

## Architecture

```
Browser ──▶ NextAuth (/api/auth/*, local catch-all)
        ──▶ Django + DRF (/api/*, proxied via Next rewrites)
                ──▶ TimescaleDB (PG15, hypertable + idx on (machine_id, recorded_at DESC))
```

Live pages (Overview, Machines, Energy, Alerts) refetch every 30s
via TanStack Query. Decisions and Compare skip the interval. Hot
paths use raw SQL via `connection.cursor()` per the spec.

## Tech stack

- **Backend** — Python 3.12, Django 5, DRF, SimpleJWT, psycopg,
  anthropic SDK
- **Database** — TimescaleDB on Postgres 15
- **Frontend** — Next.js 14 (Pages Router), TypeScript, TanStack
  Query/Table, NextAuth, Recharts, shadcn/ui + tweakcn theme,
  Tailwind 3
- **Tooling** — ruff, pytest-django, Prettier + Husky pre-commit,
  GitHub Actions CI

## Verification

```sh
docker compose exec backend pytest -q       # 125 passed
cd frontend && npm run typecheck && npm run build
```

CI runs both on every PR. Prettier auto-formats staged frontend files
on commit (Husky + lint-staged).

## Production deploy

The default `docker-compose.yml` is dev-only. For an exposed
deployment use the production variant:

```sh
cp .env.prod.example .env.prod   # fill in secrets
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Backend runs under gunicorn + WhiteNoise; frontend uses Next.js
standalone output (~150 MB image, non-root). Required env vars are
enforced — compose refuses to boot without them. Backend port is not
published; the frontend is the only public surface. See
[`docs/steps/25-production-deploy-prep.md`](./docs/steps/25-production-deploy-prep.md)
for details and the `ALLOWED_HOSTS` gotcha.

The same images push cleanly to Fly / Railway / Cloud Run (backend) +
Vercel (frontend) with managed Timescale Postgres.

## Key decisions & trade-offs

Headlines below; full reasoning in
[`DESIGN.md §"Trade-Off Notes"`](./DESIGN.md).

- **Raw SQL via `connection.cursor()` for hot paths** — DRF's ORM
  generates extra joins; latest-reading and time-bucket queries run
  hundreds of times per page load
- **`time_bucket()` not `DATE_TRUNC()`** — chunk-aware, preserves
  hypertable pruning. `DATE_TRUNC` triggers full scans
- **`DISTINCT ON (machine_id)` for latest reading** — one index scan
  on the most recent chunk; subquery-per-machine is ~12× slower
- **JWT in httpOnly cookie via NextAuth** — XSS-safe; access token
  never reaches `localStorage`. 30 min access / 7 d refresh
- **30 s polling, not WebSockets** — sensor data arrives every 5 min;
  Channels + Redis broker would buy nothing visible to users
- **Pages Router, not App Router** — RSC default doesn't compose with
  TanStack Query's `refetchInterval`; would need `"use client"` everywhere
- **Server-side pivot for by-zone** — Python `defaultdict` keyed by
  bucket; clients shouldn't reshape time-series matrices
- **Bangkok TZ hardcoded in `utils.py`** — the brief specifies a
  Bangkok building; UTC anchoring made "06:00 building opens" land at
  13:00 local. Production multi-region would lift to settings
- **`DayPlan` as single source for readings + decisions** — chart
  changes at the same minute the decision logs it, so the dashboard
  story stays internally consistent

## What I'd improve with more time

Most of these aren't blockers at the current data volume but would
matter as the system grows.

**Performance & data layer**

- TimescaleDB continuous aggregates for hourly building totals and
  per-zone daily kWh — at 24k rows the raw `time_bucket` queries are
  ~10–30 ms; at millions they'd want pre-materialised aggregates
- Cursor pagination on `/api/decisions/` — current `LIMIT/OFFSET`
  walks the offset rows past ~10k decisions
- Redis cache in front of `/api/machines/` and
  `/api/building/summary/` — both polled every 30s by every client
- Tighter rate-limit on `/api/chat/` (Anthropic credit drain risk)

**Reliability & ops**

- Structured logging with correlation IDs across FE/BE/DB
- `/api/health/` endpoint distinct from auth liveness
- Sentry / similar APM for error tracking

**Frontend**

- Real e2e tests on Playwright (turn the test plan into a CI suite)
- Storybook for `KpiCard`, `MachineCard`, `AlertBanner`, chart
  permutations — visual-regression coverage matters for a chart-heavy
  dashboard
- Skeleton loading states instead of spinners
- Accessibility pass with axe-core in CI (chart data is currently
  inaccessible to screen readers)
- Bundle analysis + per-route code splitting (TanStack Table on
  /decisions, react-markdown on /chat)

**AI & chat**

- Tool-calling instead of front-loaded context — let Sonnet pull
  only what it needs via the existing endpoints, instead of pumping
  ~8.5 KB of snapshots into every system prompt
- Multi-turn conversations (currently single-turn)
- Streaming replies via `messages.stream()`

**Features**

- Cost view ($/kWh tariff converting every total into money)
- Per-zone energy budgets — operational targets distinct from
  fault-detection alerts
- Rolling 7-day / month-to-date summaries
- Option B from the brief: one-click monthly PDF (we shipped A and C)

**Data realism**

- Real weather API instead of the sinusoidal model — real load drives
  a more meaningful AI control narrative
- Replace canned AI decisions with an actual optimisation pass
  (LP model or heuristic reading the sensor stream)

**Security**

- DRF throttling scopes (per-user, per-endpoint, anonymous-burst)
- CSP headers via Next.js middleware
- Audit log for human actions (mirror of `building_aidecision`)
- 2FA for admin accounts

**Code quality**

- OpenAPI schema → frontend types (drf-spectacular +
  openapi-typescript) so `frontend/src/lib/api.ts` isn't hand-mirrored
- Ruff in the pre-commit pipeline (currently manual)
- `pytest --cov` to surface untested paths
