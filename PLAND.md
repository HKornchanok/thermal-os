# ThermalOS — Implementation Plan & Delivery Log

> Originally a forward plan; now a retrospective. Per-step delivery
> notes live in [`docs/steps/NN-*.md`](./docs/steps/); PRs linked
> per phase below. Stack as built matches the original lock — Django 5,
> DRF, SimpleJWT, TimescaleDB on the backend; Next.js 14 (Pages Router),
> TypeScript, TanStack Query, NextAuth, Recharts, and shadcn/ui with
> the tweakcn green/yellow theme on the frontend.

---

## Phase 0 — Project bootstrap

**Goal:** repo skeleton + docker-compose with Django, Next.js,
TimescaleDB.

**Shipped** in [step 01](./docs/steps/01-bootstrap-backend.md):
`docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`,
`backend/pyproject.toml`, `backend/thermalos/{settings,urls,wsgi}.py`,
`frontend/package.json`, `next.config.js`, `tailwind.config.ts`,
`tsconfig.json`, `.env.example` files for both, `.gitignore`,
`.editorconfig`.

✅ `docker compose up` brings all three services up cold.

---

## Phase 1 — Database schema + seed data

Implements **DESIGN §1A**.

**Shipped** in [step 02](./docs/steps/02-database-schema-and-seed.md)
(later iterated by steps 16–22):

- `building/models.py` — `Machine`, `SensorReading`, `AIDecision`
- Migration `0001_initial` (auto) + `0002_timescale` (RunSQL —
  `create_hypertable` + indexes on `(machine_id, recorded_at DESC)`
  and `(recorded_at DESC)`)
- `building/management/commands/seed.py` — 12 machines + 7 days of
  5-minute readings (24,192 rows) split 3 manual / 4 AI

The seed evolved significantly past the initial draft — see steps
16 (rewrite for brief compliance), 17/20 (Bangkok TZ anchoring), 19
(per-day `DayPlan` for AI variation), 21 (engineered alert anomalies).

✅ Hypertable visible in `\d+ building_sensorreading`. Seed
reproduces 24,192 readings + 42 decisions + admin/admin user.

---

## Phase 2 — Authentication

Implements **DESIGN §1B (auth)**.

**Shipped** in [step 03](./docs/steps/03-auth-jwt.md):

- SimpleJWT wired at `/api/auth/token/` and `/api/auth/token/refresh/`
- DRF `IsAuthenticated` default permission
- `django-cors-headers` for dev cross-origin

Frontend half landed in [step 04](./docs/steps/04-frontend-auth-minimum.md):
NextAuth `CredentialsProvider`, JWT in httpOnly cookie, refresh
in the `jwt` callback, `enabled: !!session?.accessToken` gate on
every hook, `AuthGate` on every protected route ([PR #23](https://github.com/HKornchanok/alto-tech/pull/23)).

✅ `POST /api/auth/token/` issues access + refresh; bearer-protected
endpoints 401 without it.

---

## Phase 3 — Read API endpoints

Implements **DESIGN §1B endpoint catalog**. Hot paths use raw SQL via
`connection.cursor()` per the spec.

**Shipped** in [step 05](./docs/steps/05-read-endpoints.md) across
PRs [#1–#8](https://github.com/HKornchanok/alto-tech/pulls?q=is%3Apr+is%3Aclosed):

| #   | Endpoint                            | PR                                                    |
| --- | ----------------------------------- | ----------------------------------------------------- |
| 3.1 | `GET /api/machines/`                | [#1](https://github.com/HKornchanok/alto-tech/pull/1) |
| 3.2 | `GET /api/machines/{id}/sensors/`   | [#2](https://github.com/HKornchanok/alto-tech/pull/2) |
| 3.3 | `GET /api/building/summary/`        | [#3](https://github.com/HKornchanok/alto-tech/pull/3) |
| 3.4 | `GET /api/building/energy/`         | [#4](https://github.com/HKornchanok/alto-tech/pull/4) |
| 3.5 | `GET /api/building/energy/by-zone/` | [#5](https://github.com/HKornchanok/alto-tech/pull/5) |
| 3.6 | `GET /api/decisions/`               | [#6](https://github.com/HKornchanok/alto-tech/pull/6) |
| 3.7 | `GET /api/energy/compare/`          | [#7](https://github.com/HKornchanok/alto-tech/pull/7) |
| 3.8 | `GET /api/alerts/`                  | [#8](https://github.com/HKornchanok/alto-tech/pull/8) |

Files: `building/views/{machines,building,decisions,energy_compare,alerts}.py`,
`building/sql.py` (module-level SQL constants),
`building/utils.py` (helpers + allowlists), `building/urls.py`.

Tests: `building/tests/test_*.py` — 125 tests covering auth,
each endpoint shape, pagination, allowlist rejection, alert rules.

✅ All endpoints return shapes that match DESIGN.md. Latency target
hit locally (< 200 ms for every read).

---

## Phase 4 — Frontend foundation

Implements **DESIGN §1C (architecture, shared components, styling)**.

**Shipped** across steps 04, 09, 10, 11:

- App shell + Sidebar + Layout with `AuthGate` wrapping protected
  routes ([PR #10](https://github.com/HKornchanok/alto-tech/pull/10),
  [PR #23](https://github.com/HKornchanok/alto-tech/pull/23))
- shadcn/ui + tweakcn theme install + `next-themes` ([PR #9](https://github.com/HKornchanok/alto-tech/pull/9))
- TanStack Query foundation, `apiFetch` helper, hook-per-endpoint
  ([PR #11](https://github.com/HKornchanok/alto-tech/pull/11))
- Shared components: `KpiCard`, `MachineCard`, `StatusBadge`,
  `AlertBanner`, `AreaChart`, `LoadingState`, `ErrorState`,
  `EmptyState`, `MarkdownMessage`, `DataTable` + `ColumnFilter`
- Number formatter `fmtNum()`, chart config helpers, Inter +
  JetBrains Mono fonts via `next/font/google`

✅ Login flow yields a session cookie; `/api/machines/` returns 200
with bearer attached; theme tokens applied throughout.

---

## Phase 5 — Pages

Each page follows the `loading → error → empty → happy` pattern
from DESIGN §"Data-Fetching Pattern".

| Page         | PR                                                                                                                                                                        | Notes                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `/login`     | [#10](https://github.com/HKornchanok/alto-tech/pull/10)                                                                                                                   | Credentials form → NextAuth                              |
| `/` Overview | [#17](https://github.com/HKornchanok/alto-tech/pull/17)                                                                                                                   | AlertBanner + 6 KPIs + 12 machine cards                  |
| `/machines`  | [#16](https://github.com/HKornchanok/alto-tech/pull/16), [#22](https://github.com/HKornchanok/alto-tech/pull/22)                                                          | Selection in `?selected=`; "now" reference line on chart |
| `/energy`    | [#14](https://github.com/HKornchanok/alto-tech/pull/14), [#15](https://github.com/HKornchanok/alto-tech/pull/15)                                                          | Total ↔ By Zone, 15-colour palette, interactive legend   |
| `/decisions` | [#12](https://github.com/HKornchanok/alto-tech/pull/12)                                                                                                                   | TanStack Table v8 + per-column filter popovers           |
| `/compare`   | [#18](https://github.com/HKornchanok/alto-tech/pull/18), [#28](https://github.com/HKornchanok/alto-tech/pull/28), [#37](https://github.com/HKornchanok/alto-tech/pull/37) | Overlaid AreaChart, per-period bounds, diff in tooltip   |

✅ Every page renders happy path against seeded data.

---

## Phase 6 — Polish & cross-cutting

**Shipped** in [step 10](./docs/steps/10-phase-6-polish.md) and
follow-ups: `fmtNum()` applied to all kWh/kW values, all colours
via CSS variables (zero hardcoded hex), `enabled` gate audited,
favicons + page titles per route, [PR #20](https://github.com/HKornchanok/alto-tech/pull/20),
[PR #25](https://github.com/HKornchanok/alto-tech/pull/25).

[step 11](./docs/steps/11-prettier-pre-commit.md): Prettier + Husky
pre-commit hook + lint-staged ([PR #21](https://github.com/HKornchanok/alto-tech/pull/21)).

---

## Phase 7 — Bonus: AI Chat (Option A)

**Shipped** in [step 09](./docs/steps/09-chat-assistant.md)
([PR #19](https://github.com/HKornchanok/alto-tech/pull/19)),
later enriched in [PR #35](https://github.com/HKornchanok/alto-tech/pull/35) and
[PR #36](https://github.com/HKornchanok/alto-tech/pull/36):

- `building/views/chat.py` — `POST /api/chat/`, validates `message`,
  graceful fallback when key unset, typed exception handling for
  `APIStatusError` / `APIConnectionError` / `AnthropicError`,
  `UserRateThrottle`
- System prompt expanded from 3 slices (machine snapshot + 2
  totals + 20 decisions) to 6 slices (~8.5 KB) with
  `cache_control: ephemeral` so per-question cost stays low
- `pages/chat.tsx` — example chips, message bubbles, ⌘/Ctrl+Enter
  shortcut, `MarkdownMessage` rendering for assistant replies

✅ With key: replies cite real numbers from seed. Without key:
graceful fallback message, never 500.

---

## Phase 8 — Verification & docs

**Shipped** in [step 12](./docs/steps/12-readme-and-verification.md)
([PR #22](https://github.com/HKornchanok/alto-tech/pull/22)) and
later compactions ([PR #38](https://github.com/HKornchanok/alto-tech/pull/38),
[PR #39](https://github.com/HKornchanok/alto-tech/pull/39),
[PR #46](https://github.com/HKornchanok/alto-tech/pull/46),
[PR #47](https://github.com/HKornchanok/alto-tech/pull/47)):

- README — quickstart, login, frontend routes, API table, architecture,
  tech stack, verification, production deploy, decisions, "What I'd
  improve"
- DESIGN.md — system as built, 10-min read
- All steps documented in `docs/steps/`

✅ `pytest -q` → 125 passed. `npm run typecheck && npm run build`
→ clean.

---

## Post-MVP work

Past Phase 8 the project shipped four hardening passes that weren't
in the original plan but proved load-bearing for "ready to ship":

| Work                           | PR                                                                                                               | Notes                                                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend audit & quality fixes  | [#42](https://github.com/HKornchanok/alto-tech/pull/42)                                                          | 16 findings — naive-datetime rejection, `resolve_window`, RNG state leak, API contract guards. [step 23](./docs/steps/23-backend-audit-fixes.md) |
| Frontend audit & quality fixes | [#40](https://github.com/HKornchanok/alto-tech/pull/40)                                                          | a11y, focus rings, KPI composition                                                                                                               |
| Comment cleanup (FE then BE)   | [#41](https://github.com/HKornchanok/alto-tech/pull/41), [#43](https://github.com/HKornchanok/alto-tech/pull/43) | 17 → 5 % FE density; backend views 11 → 4 %. [step 24](./docs/steps/24-backend-comment-cleanup.md)                                               |
| Production deploy variants     | [#44](https://github.com/HKornchanok/alto-tech/pull/44)                                                          | gunicorn + WhiteNoise, Next.js standalone, `docker-compose.prod.yml`, `.env.prod.example`. [step 25](./docs/steps/25-production-deploy-prep.md)  |
| GitHub Actions CI              | [#45](https://github.com/HKornchanok/alto-tech/pull/45)                                                          | ruff + pytest + prettier + typecheck + build on every PR. Ruff cleanup pass: 57 → 0. [step 26](./docs/steps/26-github-actions-ci.md)             |

---

## Critical files (final map)

| Concern              | Path                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| Models               | `backend/building/models.py`                                                         |
| Hypertable migration | `backend/building/migrations/0002_timescale.py`                                      |
| SQL constants        | `backend/building/sql.py`                                                            |
| API views            | `backend/building/views/{machines,building,decisions,energy_compare,alerts,chat}.py` |
| Helpers / allowlists | `backend/building/utils.py`                                                          |
| Seed                 | `backend/building/management/commands/seed.py`                                       |
| Tests                | `backend/building/tests/test_*.py` (125 tests)                                       |
| NextAuth             | `frontend/src/pages/api/auth/[...nextauth].ts`                                       |
| Query hooks          | `frontend/src/lib/hooks/*`                                                           |
| Pages                | `frontend/src/pages/{index,machines,energy,decisions,compare,chat,login}.tsx`        |
| Per-page features    | `frontend/src/features/<page>/*`                                                     |
| Theme                | `frontend/src/styles/globals.css` (tweakcn vars)                                     |
| Rewrites             | `frontend/next.config.js`                                                            |
| Dev compose          | `docker-compose.yml`                                                                 |
| Prod compose         | `docker-compose.prod.yml` + `Dockerfile.prod` ×2 + `.env.prod.example`               |
| CI                   | `.github/workflows/ci.yml`                                                           |

## Verification (final)

- [x] `docker compose up` brings the stack up cleanly from a clean clone
- [x] `python manage.py migrate && python manage.py seed` succeeds
- [x] All 11 endpoints return shapes that match DESIGN.md
- [x] All 7 pages render against seeded data without console errors
- [x] `pytest -q` → 125 passed; `npm run build` → clean
- [x] Login → 30 s auto-refresh observed in Network tab
- [x] Theme: green/yellow palette visible; no hardcoded hex anywhere
- [x] CI green on `main`
- [x] Production compose boots end-to-end with required env vars
