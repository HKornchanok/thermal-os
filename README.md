# ThermalOS

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
