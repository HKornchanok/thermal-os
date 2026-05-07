# ThermalOS

![CI](../../actions/workflows/ci.yml/badge.svg)

Building energy monitoring dashboard for a full-stack engineering
take-home. Tracks 12 HVAC machines across 6 zones with live KPIs,
time-series charts, an AI decision audit trail, before/after energy
comparison, derived alerts, and an Anthropic-grounded chat assistant.

> Spec: [`DESIGN.md`](./DESIGN.md) · Plan: [`PLAN.md`](./PLAN.md)
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

## Common commands

All run from the repo root unless noted.

```sh
# stack
docker compose up                                # bring everything up
docker compose down                              # stop, keep DB volume
docker compose down -v                           # stop + wipe DB (need re-seed after)
docker compose logs -f backend                   # tail backend logs
docker compose restart backend                   # restart one service

# database
docker compose exec backend python manage.py seed --clear      # reset + reseed (creates admin/admin)
docker compose exec backend python manage.py migrate           # apply migrations only
docker compose exec backend python manage.py createsuperuser   # add another admin user
docker compose exec backend python manage.py shell             # Django REPL
docker compose exec db psql -U thermalos thermalos             # raw psql

# backend
docker compose exec backend pytest -q                          # 125 tests
docker compose exec backend pytest -k test_alerts -v           # one file
docker compose exec backend ruff check .                       # lint
docker compose exec backend ruff check . --fix                 # auto-fix
docker compose exec backend python manage.py makemigrations    # after model changes

# frontend (from frontend/, or via docker compose exec)
npm run dev                                      # local dev (already runs in container)
npm run build                                    # prod build
npm run typecheck                                # tsc --noEmit
npm run format                                   # prettier --write
npm run format:check                             # CI parity check
```

CI runs ruff + pytest + prettier + typecheck + build on every PR.
Prettier auto-formats staged frontend files on commit via Husky.

**If login fails after a `down -v`**: re-run `seed --clear` —
migrations don't recreate the `admin/admin` superuser, only seed does.

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
- **Bangkok TZ hardcoded in `utils.py`** — the spec describes a
  Bangkok building; UTC anchoring made "06:00 building opens" land at
  13:00 local. Production multi-region would lift to settings
- **`DayPlan` as single source for readings + decisions** — chart
  changes at the same minute the decision logs it, so the dashboard
  story stays internally consistent

## What I'd improve with more time

Concrete, scoped follow-ups — not blockers today, but the first
things I'd ship in a real production track.

**Performance & scale**

- TimescaleDB continuous aggregates for hourly building totals and
  per-zone daily kWh. At 24k rows raw `time_bucket` queries run in
  ~10–30 ms; at millions they'd want pre-materialised refreshing
  aggregates.
- Redis cache in front of `/api/machines/` and `/api/building/summary/`.
  Both are polled every 30s by every connected client — one shared
  cache flattens the query load for a multi-user deployment.
- Cursor pagination on `/api/decisions/`. Current `LIMIT/OFFSET`
  walks the offset rows; fine for the demo, expensive past ~10k.

**Reliability & ops**

- `/api/health/` endpoint distinct from auth liveness — orchestrator
  readiness probes shouldn't depend on the auth flow.
- Structured logging with a request-id correlation across FE/BE/DB.
  Turns "why was this user's chart blank?" from a forensic exercise
  into one grep.
- Sentry (or equivalent APM) for error tracking. Errors land in
  container logs only right now.

**Quality & testing**

- Playwright e2e suite in CI — promote the manual test plan into
  scripted runs that catch regressions in login → Overview → drill-in.
- Accessibility pass with axe-core in CI. Charts are currently
  unreadable to screen readers; that's a known gap.
- `pytest --cov` to surface untested branches (chat error paths
  weren't covered until they bit us in PR #36).
- Ruff in the pre-commit pipeline so backend formatting matches the
  frontend's automatic Prettier flow.

**Security**

- CSP headers via Next.js middleware. Currently absent.
- DRF throttling scopes beyond `/api/chat/` — anonymous-burst limit
  on the auth endpoint is the obvious next one (brute-force surface).

**AI & chat**

- Streaming replies via `messages.stream()` — same network cost,
  much better perceived latency than the current spinner→full-reply.
- Multi-turn conversations. Every question is single-turn today;
  threading conversation state would unlock follow-ups.

**Code quality**

- OpenAPI schema → frontend types (drf-spectacular +
  openapi-typescript). `frontend/src/lib/api.ts` hand-mirrors
  backend response shapes today — single source of truth removes
  a whole class of drift bugs.
