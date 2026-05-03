# ThermalOS — Implementation Plan

## Context

`DESIGN.md` specifies a complete full-stack monitoring dashboard for the AltoTech assessment ("ThermalOS") — a building energy monitor over 12 HVAC machines with live KPIs, time-series charts, an AI decision log, before/after energy comparison, derived alerts, and an optional AI chat assistant.

The working directory is greenfield (only `DESIGN.md` exists). This plan turns the design into an executable, file-level task breakdown organised into eight phases. Each phase has explicit files to create, acceptance checks, and the design sections it implements.

**Stack (locked by design):**
- Backend: Django 5 + DRF + SimpleJWT, PostgreSQL 15 + TimescaleDB, raw SQL for hot paths
- Frontend: Next.js (Pages Router) + TypeScript, TanStack Query, NextAuth.js, Recharts, shadcn/ui with tweakcn green/yellow theme
- Bonus: Anthropic SDK (Claude) for `/api/chat/`
- Orchestration: docker-compose (postgres+timescaledb, backend, frontend)

---

## Phase 0 — Project bootstrap

**Goal:** Repo skeleton + dev tooling + docker-compose running an empty Django and Next.js side-by-side against TimescaleDB.

### Files to create
- `README.md` — quickstart, login creds, architecture diagram pointer
- `docker-compose.yml` — three services:
  - `db`: `timescale/timescaledb-ha:pg15-latest`, volume `pgdata`, env `POSTGRES_*`
  - `backend`: build `./backend`, depends on db, port `8000`, env from `backend/.env`
  - `frontend`: build `./frontend`, depends on backend, port `3000`, env from `frontend/.env.local`
- `backend/Dockerfile` — python:3.12-slim + poetry/uv + entrypoint running migrations then `runserver`
- `backend/.env.example` — `DATABASE_URL`, `DJANGO_SECRET_KEY`, `ANTHROPIC_API_KEY`, `DEBUG`
- `backend/pyproject.toml` — django, djangorestframework, djangorestframework-simplejwt, psycopg[binary], anthropic, pytest-django, ruff
- `backend/manage.py`, `backend/thermalos/{settings,urls,wsgi,asgi}.py`
- `backend/building/{__init__,apps,admin,models,views,urls,serializers,sql}.py` (empty stubs)
- `frontend/Dockerfile` — node:20-alpine, `npm ci`, `npm run dev`
- `frontend/.env.example` — `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `BACKEND_URL`
- `frontend/package.json` — next@14 (Pages Router), react, typescript, @tanstack/react-query, next-auth, recharts, tailwindcss, class-variance-authority, lucide-react
- `frontend/tsconfig.json`, `frontend/next.config.js`, `frontend/tailwind.config.ts`, `frontend/postcss.config.js`
- `.gitignore`, `.editorconfig`

### Acceptance
- `docker-compose up` starts all three services without crashing
- `curl localhost:8000/api/` returns 404 (Django alive)
- `curl localhost:3000` returns 200 (Next.js placeholder home)

---

## Phase 1 — Database schema + seed data

Implements **DESIGN §1A**.

### Tasks
1. **Models** — `backend/building/models.py`
   - `Machine`: `name` (unique 20), `machine_type` (choices), `zone`, `rated_power_kw`, `is_critical` — `db_table = 'building_machine'`
   - `SensorReading`: `machine` FK, `recorded_at`, `power_kw`, `temperature` (null), `setpoint` (null), `speed_pct` (null), `status` (3 chars). Composite PK `(id, recorded_at)` declared via `Meta.constraints` — `managed = True` for the table; hypertable conversion handled in a `RunSQL` migration.
   - `AIDecision`: `decided_at`, `machine` FK with `on_delete=SET_NULL` and `null=True`, `action_type` (choices), `value` (null float), `reason` (text)
2. **Migrations**
   - `0001_initial.py` — auto-generated, creates the three tables
   - `0002_timescale.py` — `RunSQL` only:
     - `SELECT create_hypertable('building_sensorreading', 'recorded_at', chunk_time_interval => INTERVAL '1 day');`
     - `CREATE INDEX ... ON building_sensorreading (machine_id, recorded_at DESC);`
     - `CREATE INDEX ... ON building_sensorreading (recorded_at DESC);`
     - `CREATE INDEX ... ON building_aidecision (decided_at DESC);`
3. **Seed command** — `backend/building/management/commands/seed.py`
   - 12 machines across `Zone A`, `Zone B`, `Zone C`, `Server Room (24/7)`, etc. (match design's zone strings exactly so by-zone API response keys line up)
   - 35 days of readings at 5-minute intervals = 12 × 288 × 35 ≈ 121k rows. Use `bulk_create` in batches of 5k.
   - Two regimes: first ~17 days "manual" (steady high power, oscillating temps), last ~17 days "AI" (lower averages, tighter setpoint control) — drives `/api/energy/compare/`
   - ~23 AI decisions per day across the AI period (~390 rows total)
   - Seed an `admin/admin` superuser

### Acceptance
- `python manage.py migrate` succeeds, hypertable visible in `\d+ building_sensorreading`
- `python manage.py seed` populates DB; `SELECT COUNT(*) FROM building_sensorreading` ≈ 121k
- `EXPLAIN ANALYZE` of `SELECT DISTINCT ON (machine_id) ...` reads only the latest chunk

---

## Phase 2 — Authentication

Implements **DESIGN §1B (auth section)**.

### Tasks
- `backend/thermalos/settings.py`:
  - `INSTALLED_APPS += ['rest_framework', 'rest_framework_simplejwt', 'building']`
  - `REST_FRAMEWORK = { 'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication'], 'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'] }`
  - `SIMPLE_JWT = { 'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30), 'REFRESH_TOKEN_LIFETIME': timedelta(days=7) }`
  - CORS: `django-cors-headers` allowing `http://localhost:3000`
- `backend/thermalos/urls.py` — wire `/api/auth/token/` and `/api/auth/token/refresh/` to SimpleJWT views; include `building.urls` under `/api/`

### Acceptance
- `POST /api/auth/token/ {"username":"admin","password":"admin"}` returns access + refresh
- `GET /api/machines/` without bearer returns 401; with bearer returns 200 (after Phase 3)

---

## Phase 3 — Core read API endpoints

Implements **DESIGN §1B endpoint catalog**. All views are function-based (`@api_view(['GET'])`) with raw SQL via `connection.cursor()` for performance — design explicitly mandates raw SQL for the hot paths.

### File layout
- `backend/building/views/__init__.py`
- `backend/building/views/machines.py` — `list_machines`, `machine_sensors`
- `backend/building/views/building.py` — `summary`, `energy`, `energy_by_zone`
- `backend/building/views/decisions.py` — `decisions_list`
- `backend/building/views/energy_compare.py` — `compare`
- `backend/building/views/alerts.py` — `alerts_list`
- `backend/building/sql.py` — module-level SQL constants (DISTINCT ON queries, alert rules) so views stay readable
- `backend/building/urls.py` — wire all endpoints

### Endpoint detail (each is its own task)

| # | Path | Source SQL | Notes |
|---|------|------------|-------|
| 3.1 | `GET /api/machines/` | DESIGN §"Latest reading per machine" | Joins `building_machine` with `DISTINCT ON` subquery. Response shape: array of machine objects with nested `latest_reading`. |
| 3.2 | `GET /api/machines/{id}/sensors/` | DESIGN §"Time-series for one machine" | **Allowlist `metric`** ∈ `{power_kw, temperature, setpoint, speed_pct}` and **`bucket`** ∈ `{5min, 15min, 1h, 1d}` before string-formatting into SQL. Smart default: `SELECT MAX(recorded_at) WHERE machine_id=%s` to pick the day. 404 if machine not found. |
| 3.3 | `GET /api/building/summary/` | DESIGN §"Today's total energy (kWh)" + variants | Reference time = `MAX(recorded_at)` (not `now()`). Returns the 8-field object. `trend_pct` = `(today - yesterday)/yesterday*100`, null if no yesterday. `avg_temperature` only over ON ACs. |
| 3.4 | `GET /api/building/energy/` | DESIGN §"Building-wide total power" | `bucket` allowlist `{15min, 1h}`. Default range = last 24h. |
| 3.5 | `GET /api/building/energy/by-zone/` | DESIGN §1B inline SQL (zone breakdown) | Backend pivots rows in Python: `defaultdict(dict)` keyed by bucket, then list of `{bucket, **zone_kws}`. |
| 3.6 | `GET /api/decisions/` | Filtered + paginated query on `building_aidecision` | LEFT JOIN `building_machine` for `machine_name`. `from`/`to`/`action` filters via SQL params; `LIMIT/OFFSET` for page. Separate `COUNT(*)` with same WHERE for `count`. Returns `{count, page, page_size, total_pages, results}`. |
| 3.7 | `GET /api/energy/compare/` | DESIGN §"hourly avg per period" | Defaults derive from `MIN(recorded_at)` to find the manual/AI split. Two `time_bucket('1 hour', ...)` aggregates → mean of means. `savings_pct = (before-after)/before*100`. |
| 3.8 | `GET /api/alerts/` | DESIGN §"Implementation (SQL for each rule)" | Three rules executed independently, results merged in Python, sorted critical→warning. No DB writes — alerts are derived. |

### Tests — `backend/building/tests/`
- `test_auth.py` — token issue + 401 without bearer
- `test_machines.py` — 200 shape, includes `latest_reading`, count=12; sensors endpoint allowlist rejects bad metric with 400
- `test_summary.py` — 8 keys present, types correct
- `test_energy.py` — total + by-zone shape; 15min bucket honoured
- `test_decisions.py` — pagination math (count, total_pages), action filter
- `test_compare.py` — savings_pct sign convention
- `test_alerts.py` — rules fire on synthetic data fixtures

### Acceptance
- All endpoints return 200 with seeded data, < 200ms latency target met locally
- pytest suite green
- Manual `curl` of every endpoint matches the JSON shapes in DESIGN.md exactly

---

## Phase 4 — Frontend foundation

Implements **DESIGN §1C (architecture, shared components, styling)**.

### Tasks

1. **App shell** — `frontend/src/pages/_app.tsx`
   - Wraps `<SessionProvider>` (next-auth) → `<QueryClientProvider>` (TanStack Query, `staleTime: 60_000`, `retry: 1`) → `<Layout>`
   - Skip `<Layout>` for `/login` via pathname check
2. **Layout + Sidebar** — `frontend/src/components/layout/{Layout,Sidebar,NavLink}.tsx`
   - Sidebar with 6 NavLinks (Overview, Machines, Energy, AI Decisions, Before/After, AI Assistant), user email + Sign out at bottom
3. **NextAuth config** — `frontend/src/pages/api/auth/[...nextauth].ts`
   - `CredentialsProvider` posts to `${BACKEND_URL}/api/auth/token/`; on success returns `{accessToken, refreshToken, expiresAt}`
   - `jwt` callback: refresh access via `/api/auth/token/refresh/` when within 60s of expiry
   - `session` callback exposes `session.accessToken`
   - Session strategy: `jwt` (httpOnly cookie default)
4. **API client** — `frontend/src/lib/api.ts`
   - `apiFetch(path, opts)` reads session token via `getSession()` and attaches `Authorization: Bearer …`. All hooks call this.
5. **Query hooks** — `frontend/src/lib/hooks/`
   - `useMachines.ts` (`refetchInterval: 30_000`)
   - `useMachineSensors.ts` (params: id, from, to, metric, bucket)
   - `useBuildingSummary.ts` (`refetchInterval: 30_000`)
   - `useBuildingEnergy.ts` and `useBuildingEnergyByZone.ts`
   - `useDecisions.ts` (params: from, to, action, page, page_size)
   - `useEnergyCompare.ts`
   - `useAlerts.ts` (`refetchInterval: 30_000`)
   - `useChat.ts` (mutation; Phase 7)
   - Every hook gates with `enabled: !!session?.accessToken`
6. **Shared components** — `frontend/src/components/dashboard/`
   - `KpiCard.tsx`, `MachineCard.tsx`, `StatusBadge.tsx`, `SensorChart.tsx`, `AlertBanner.tsx`, `LoadingState.tsx`, `ErrorState.tsx`, `EmptyState.tsx`
7. **shadcn/ui + theme** — run `npx shadcn@latest init` then add `table, tabs, badge, select, separator, button, input, dialog`. Apply tweakcn theme: `npx shadcn@latest add https://tweakcn.com/r/themes/cmlewiz0s000304l7hc2n2l1z`. Verify `--background`, `--primary`, `--chart-1..5` are populated in `globals.css`.
8. **Fonts** — `_document.tsx`: link Inter, JetBrains Mono, Georgia (Google Fonts). Tailwind `fontFamily.{sans,mono,serif}` mapped to CSS vars.
9. **Number helper** — `frontend/src/lib/utils.ts`: `fmtNum()` per design.
10. **Recharts theming util** — `frontend/src/lib/chart.ts`: shared axis/tooltip/grid configs that read `hsl(var(...))`.
11. **Next.js rewrites** — `frontend/next.config.js`:
    ```js
    rewrites: async () => [
      { source: '/api/auth/:path*', destination: '/api/auth/:path*' }, // NextAuth
      { source: '/api/:path*', destination: `${process.env.BACKEND_URL}/api/:path*` },
    ]
    ```
    Order matters — `/api/auth/*` must match first or use `beforeFiles`/`fallback` accordingly.

### Acceptance
- `/login` renders, login flow yields a valid session cookie
- Dev tools Network tab shows `/api/machines/` returning 200 with bearer attached
- shadcn `<Button>` reflects the green/yellow theme in dark mode

---

## Phase 5 — Pages

Each page strictly follows the **loading → error → empty → happy** pattern from DESIGN §"Data-Fetching Pattern".

### 5.1 `/login` — `pages/login.tsx`
- Credentials form (username, password) → `signIn('credentials')`. Redirects to `/` on success.

### 5.2 `/` Overview — `pages/index.tsx`
- `useAlerts()` → `<AlertBanner>` (clickable rows route to `/machines?selected={id}`)
- `useBuildingSummary()` → 6 KpiCards: total/active/inactive machines, total power, today kWh (with trend), avg temp
- `useMachines()` → 12 MachineCards in a responsive grid

### 5.3 `/machines` — `pages/machines.tsx`
- Local state: `selectedMachineId` (initialized from `?selected=` query)
- Top: 12 clickable MachineCards
- Bottom (when selected): StatusBadge + Tabs (metric: power_kw / temperature / setpoint / speed_pct — disable speed_pct for ACs and temp/setpoint for fans) + SensorChart pulling `useMachineSensors`

### 5.4 `/energy` — `pages/energy.tsx`
- Local state: `from`, `to`, `bucket` (`15min|1h`), `view` (`total|by_zone`)
- Date nav buttons (← Prev day / Next day → relative to current `from`)
- View toggle and bucket toggle
- Summary stats (peak, average, data points) computed client-side from the response
- Chart: `<AreaChart>` for total view; stacked `<AreaChart>` mapping each zone key to `--chart-1..5` plus generated variants for the by-zone view

### 5.5 `/decisions` — `pages/decisions.tsx`
- Local state: `from`, `to`, `action`, `page`, `pageSize`
- Filter controls (Date range pickers + shadcn `<Select>` for action + page size)
- shadcn `<Table>` + `<Badge>` color-coded by `action_type`
- Pagination footer: `← Prev | Page N of M | Next →`. Disable buttons at bounds.

### 5.6 `/compare` — `pages/compare.tsx`
- Two `<input type="date">` ranges (Period A, Period B). Defaults from API's smart defaults (don't pass any params on first load).
- 3 KpiCards: before avg_kw, after avg_kw, savings_pct (green if positive)
- Recharts `<BarChart>` with two bars side-by-side

### Acceptance
- Manual smoke: log in → click every nav item → every page renders happy path against seeded data
- Resize to mobile width — sidebar collapses, grids reflow
- Light/dark toggle works (if shadcn theme-toggle is wired)

---

## Phase 6 — Polish & cross-cutting

- Apply `fmtNum()` to KpiCard kWh, kW values, compare avg_kw, chart tooltips (everywhere `value > 999` is plausible per DESIGN table)
- Audit chart components: zero hardcoded hex; all colors via `hsl(var(--…))` or `oklch(var(--…))`
- Verify `enabled: !!session?.accessToken` on every hook
- Replace stub `LoadingState` / `ErrorState` / `EmptyState` content with the design's exact copy patterns
- Add favicons + page titles per route
- Tighten `next.config.js` rewrites — confirm `/api/auth/*` is *not* proxied to Django

---

## Phase 7 — Bonus: AI Chat (Option A)

Implements **DESIGN §"POST /api/chat/"** and the `/chat` page.

### Backend
- `backend/building/views/chat.py` — `POST /api/chat/`
  - Validate `message` field; reject empty
  - If `settings.ANTHROPIC_API_KEY` is unset → return `{"reply":"AI assistant is not configured."}` (200, not 500 — matches design's graceful fallback)
  - Build context: latest reading per machine (reuse SQL from §3.1), today/yesterday kWh (reuse §3.3 SQL), last 20 decisions (reuse §3.6 SQL with `LIMIT 20`)
  - Call `anthropic.Anthropic().messages.create(model='claude-sonnet-4-6', system=<grounded prompt>, messages=[{role:'user', content: message}], max_tokens=1024)` with prompt caching on the system block
  - Return `{"reply": resp.content[0].text}`
- Wire `/api/chat/` in `building/urls.py`. Add `anthropic>=0.40` to pyproject.

### Frontend
- `pages/chat.tsx`
  - Local state: `messages: Array<{role, content}>`, `input`
  - Example chips ("Why was energy so high yesterday?", "Which machine consumes the most?", "What did the AI change overnight?")
  - Message list with user/assistant bubbles
  - Form (input + Send button) → `useChatMutation()` → append assistant reply
  - Loading/error states inside the form

### Acceptance
- With `ANTHROPIC_API_KEY` set: chat reply references real numbers from seeded data
- Without key: page shows the graceful fallback message — never 500
- System prompt includes machine snapshot + energy totals + last 20 decisions

---

## Phase 8 — Verification & docs

- `README.md`:
  - Quickstart: `cp backend/.env.example backend/.env && cp frontend/.env.example frontend/.env.local && docker-compose up`
  - Default login `admin` / `admin`
  - Architecture diagram (ASCII or screenshot)
  - Trade-off notes (link to DESIGN.md §"Trade-Off Notes")
- Backend: `pytest -q` — all green
- Frontend: `npm run typecheck && npm run build` — clean
- Manual end-to-end test plan documented in README:
  1. Login → Overview shows 12 machines, KPIs populated
  2. Open a machine → chart renders for each metric
  3. Energy page: switch Total ↔ By Zone, both render
  4. Decisions page: paginate forward and back, filter by action
  5. Compare page: shows manual vs AI savings
  6. Alerts: trigger by tweaking a seed row to power_kw > 0.9 × rated, refresh — banner appears within 30s
  7. Chat page: ask "Why was energy high yesterday?" — reply references real numbers

---

## Critical files (quick map)

| Concern | Path |
|---------|------|
| Models | `backend/building/models.py` |
| Hypertable migration | `backend/building/migrations/0002_timescale.py` |
| SQL constants | `backend/building/sql.py` |
| API views | `backend/building/views/{machines,building,decisions,energy_compare,alerts,chat}.py` |
| Seed | `backend/building/management/commands/seed.py` |
| NextAuth | `frontend/src/pages/api/auth/[...nextauth].ts` |
| Query hooks | `frontend/src/lib/hooks/*` |
| Pages | `frontend/src/pages/{index,machines,energy,decisions,compare,chat,login}.tsx` |
| Theme | `frontend/src/styles/globals.css` (tweakcn vars) |
| Rewrites | `frontend/next.config.js` |
| Compose | `docker-compose.yml` |

## Verification checklist

- [ ] `docker-compose up` brings stack up cleanly from a clean clone
- [ ] `python manage.py migrate && python manage.py seed` succeeds
- [ ] All 11 endpoints return shapes that match DESIGN.md byte-for-byte (key names, types)
- [ ] All 7 pages render against seeded data without console errors
- [ ] `pytest` green; `npm run build` green
- [ ] Login → poll loop → 30s auto-refresh observed in Network tab
- [ ] Theme: green/yellow palette visible; no hardcoded hex anywhere
