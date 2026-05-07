# ThermalOS — System Design

> Schema, API contracts, frontend architecture. Reading time ~10 min.
> Trade-off summaries at the end.

---

## 1A. Database Schema

Three query patterns drive every decision:

| Pattern                                  | Frequency       | Latency target |
| ---------------------------------------- | --------------- | -------------- |
| Latest reading per machine (live status) | every 30 s/user | < 50 ms        |
| Time-series for one machine over a day   | on demand       | < 200 ms       |
| Building-wide aggregate (kW, kWh)        | every 30 s/user | < 100 ms       |

TimescaleDB sits on top of Postgres 15. Used for one thing:
chunk-aware aggregation via `time_bucket()`. Everything else is plain
Postgres.

### Tables

```sql
CREATE TABLE building_machine (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(20)  NOT NULL UNIQUE,    -- "AC-L1"
    machine_type    VARCHAR(20)  NOT NULL,            -- "large_ac" | "small_ac" | "fan"
    zone            VARCHAR(100) NOT NULL,
    rated_power_kw  FLOAT        NOT NULL,
    is_critical     BOOLEAN      NOT NULL DEFAULT FALSE   -- TRUE = runs 24/7
);

CREATE TABLE building_sensorreading (
    id           BIGSERIAL,
    machine_id   INTEGER     NOT NULL REFERENCES building_machine(id) ON DELETE CASCADE,
    recorded_at  TIMESTAMPTZ NOT NULL,        -- partition key
    power_kw     FLOAT       NOT NULL,
    temperature  FLOAT,                       -- NULL for fans
    setpoint     FLOAT,                       -- NULL for fans
    speed_pct    FLOAT,                       -- NULL for ACs
    status       VARCHAR(3)  NOT NULL,        -- "ON" | "OFF"
    PRIMARY KEY (id, recorded_at)             -- recorded_at required for hypertable PK
);
SELECT create_hypertable('building_sensorreading', 'recorded_at',
                         chunk_time_interval => INTERVAL '1 day');
CREATE INDEX ON building_sensorreading (machine_id, recorded_at DESC);
CREATE INDEX ON building_sensorreading (recorded_at DESC);

CREATE TABLE building_aidecision (
    id          BIGSERIAL PRIMARY KEY,
    decided_at  TIMESTAMPTZ NOT NULL,
    machine_id  INTEGER     REFERENCES building_machine(id) ON DELETE SET NULL,
    action_type VARCHAR(10) NOT NULL,         -- "turn_on" | "turn_off" | "set_temp"
    value       FLOAT,                        -- target setpoint °C, NULL for ON/OFF
    reason      TEXT        NOT NULL
);
CREATE INDEX ON building_aidecision (decided_at DESC);
```

### Why these choices

- **1-day chunks** match the most common query window (1–7 days), so
  every range scan reads only relevant chunks
- **Composite PK on the hypertable** — Timescale requires the partition
  column in any unique constraint
- **`(machine_id, recorded_at DESC)` index** powers `DISTINCT ON` and
  per-machine range queries. **`(recorded_at DESC)`** powers
  building-wide range queries that don't filter by machine
- **`power_kw` separate from `status`** — a machine can be ON at 0 kW
  (spinning down); both must be independently queryable
- **AI decisions are not a hypertable** — sparse events (~10/day vs
  3,456 sensor readings/day). Plain B-tree on `decided_at` is faster
- **`machine_id` nullable on decisions, `ON DELETE SET NULL`** — the
  audit trail must outlive the machine record

### Sensor reading vs AI command

| Dimension           | Sensor reading                 | AI decision                |
| ------------------- | ------------------------------ | -------------------------- |
| Frequency           | 5 min × 12 machines (3.5k/day) | sparse (~10/day)           |
| Storage             | hypertable, day chunks         | plain table + B-tree index |
| Direction           | machine → system               | system → machine           |
| Mutability          | append-only                    | append-only                |
| Joined in hot path? | yes (per-machine status)       | no (rendered separately)   |

Both share `machine_id` as a foreign key but are never joined in
hot-path queries — the dashboard renders them on separate pages.

### Key query patterns

```sql
-- 1. Latest reading per machine (live dashboard)
--    Single index scan via DISTINCT ON — no subquery join.
SELECT DISTINCT ON (machine_id) *
FROM building_sensorreading
ORDER BY machine_id, recorded_at DESC;

-- 2. Time-series for one machine, hourly buckets
--    time_bucket() is chunk-aware — reads only the relevant day chunks.
SELECT time_bucket('1 hour', recorded_at) AS bucket, AVG(power_kw)
FROM building_sensorreading
WHERE machine_id = $1 AND recorded_at BETWEEN $2 AND $3
GROUP BY bucket ORDER BY bucket;

-- 3. Today's total kWh — each row is a 5-min sample.
SELECT SUM(power_kw) * 5.0 / 60.0 AS today_kwh
FROM building_sensorreading
WHERE recorded_at >= $today_start AND recorded_at < $now;
```

`time_bucket` (not `DATE_TRUNC`) keeps chunk pruning. `DISTINCT ON`
(not `MAX()` subquery) is one index scan instead of one-per-machine.

---

## 1B. API Design

All endpoints are JSON, JWT-protected (`Authorization: Bearer …`).
SimpleJWT issues the token; NextAuth wraps it in an httpOnly cookie so
the access token never reaches `localStorage`.

### Summary

| Method | Path                            | Purpose                                 |
| ------ | ------------------------------- | --------------------------------------- |
| POST   | `/api/auth/token/`              | Login → access (30 min) + refresh (7 d) |
| POST   | `/api/auth/token/refresh/`      | Rotate access token                     |
| GET    | `/api/machines/`                | All machines + latest reading           |
| GET    | `/api/machines/{id}/sensors/`   | Time-bucketed series for one machine    |
| GET    | `/api/building/summary/`        | Live KPI snapshot                       |
| GET    | `/api/building/energy/`         | Building-wide power over time           |
| GET    | `/api/building/energy/by-zone/` | Same, pivoted by zone                   |
| GET    | `/api/decisions/`               | Paginated AI decision log               |
| GET    | `/api/energy/compare/`          | Before-vs-after savings                 |
| GET    | `/api/alerts/`                  | Derived anomaly alerts (no DB writes)   |
| POST   | `/api/chat/`                    | Anthropic-grounded assistant (bonus)    |

### `GET /api/machines/`

No query params. `DISTINCT ON (machine_id) ORDER BY machine_id, recorded_at DESC`.

```json
[
  {
    "id": 1,
    "name": "AC-L1",
    "machine_type": "large_ac",
    "zone": "Zone A (Lobby & Ground)",
    "rated_power_kw": 45.0,
    "is_critical": false,
    "latest_reading": {
      "recorded_at": "2026-05-03T01:15:00+00:00",
      "power_kw": 32.4,
      "temperature": 24.1,
      "setpoint": 24.0,
      "speed_pct": null,
      "status": "ON"
    }
  }
]
```

### `GET /api/machines/{id}/sensors/`

| Param    | Default            | Values                                                   |
| -------- | ------------------ | -------------------------------------------------------- |
| `from`   | `to − 24 h`        | ISO datetime                                             |
| `to`     | `MAX(recorded_at)` | ISO datetime                                             |
| `metric` | `power_kw`         | `power_kw` \| `temperature` \| `setpoint` \| `speed_pct` |
| `bucket` | `5min`             | `5min` \| `15min` \| `1h` \| `1d`                        |

`metric` and `bucket` are validated against allowlists before string-formatting
into SQL — no injection surface. 404 if machine missing.

```json
[{ "bucket": "2026-05-03T08:00:00+00:00", "value": 31.2 }]
```

### `GET /api/building/summary/`

No query params. Reference time is `MAX(recorded_at)` (works for live
or seeded-into-future data); "today" anchors at Bangkok midnight.

```json
{
  "total_machines": 12,
  "active_machines": 9,
  "inactive_machines": 3,
  "total_power_kw": 187.4,
  "today_kwh": 342.1,
  "yesterday_kwh": 398.7,
  "trend_pct": -14.2,
  "avg_temperature": 24.3
}
```

`trend_pct` negative = saving. `avg_temperature` averages ON ACs
only. Both `null` if no comparison data.

### `GET /api/building/energy/` and `…/by-zone/`

| Param    | Default  | Values          |
| -------- | -------- | --------------- |
| `from`   | 24 h ago | ISO datetime    |
| `to`     | now      | ISO datetime    |
| `bucket` | `1h`     | `15min` \| `1h` |

Total returns one `total_kw` per bucket. By-zone pivots server-side so
each row carries one key per zone (Recharts maps each key to an
`<Area>` directly):

```json
[
  {
    "bucket": "…01:00…",
    "Zone A (Lobby & Ground)": 32.4,
    "Zone B (Floors 1-3)": 28.1,
    "...": "..."
  }
]
```

### `GET /api/decisions/`

| Param       | Default | Values                                |
| ----------- | ------- | ------------------------------------- |
| `from`      | 7 d ago | ISO datetime                          |
| `to`        | now     | ISO datetime                          |
| `action`    | (all)   | `turn_on` \| `turn_off` \| `set_temp` |
| `page`      | `1`     | positive int                          |
| `page_size` | `20`    | `10` \| `20` \| `50`                  |

```json
{
  "count": 736,
  "page": 1,
  "page_size": 20,
  "total_pages": 37,
  "results": [
    {
      "id": 42,
      "decided_at": "2026-05-02T23:00:00+00:00",
      "machine": 1,
      "machine_name": "AC-L1",
      "action_type": "turn_on",
      "value": null,
      "reason": "Building opening — pre-cool zones A and B"
    }
  ]
}
```

### `GET /api/energy/compare/`

| Param    | Default          | Notes                         |
| -------- | ---------------- | ----------------------------- |
| `a_from` | seed start       | ISO datetime — Period A start |
| `a_to`   | seed start + 3 d | ISO datetime — Period A end   |
| `b_from` | seed start + 3 d | ISO datetime — Period B start |
| `b_to`   | seed start + 7 d | ISO datetime — Period B end   |

Defaults auto-detect the manual/AI split. Hourly avg via
`time_bucket('1 hour', …)` for each period, compared as means.
Returns 400 if `a_from >= b_from` (period order is meaningful).

```json
{
  "before": { "from": "…", "to": "…", "avg_kw": 142.3 },
  "after": { "from": "…", "to": "…", "avg_kw": 121.0 },
  "savings_pct": 15.0
}
```

### `GET /api/alerts/`

No query params. Derived on the fly — no persistent alert table, so
results always reflect current state. Polled every 30 s.

| Rule              | Condition                                     | Severity |
| ----------------- | --------------------------------------------- | -------- |
| `power_spike`     | `power_kw > 0.90 × rated_power_kw`, status ON | warning  |
| `temp_drift`      | `\|temperature − setpoint\| > 2.0°C`, AC ON   | warning  |
| `nonstop_runtime` | non-critical machine ON > 16 h consecutive    | critical |

```json
[
  {
    "severity": "critical",
    "rule": "nonstop_runtime",
    "machine_id": 3,
    "machine_name": "AC-L3",
    "message": "AC-L3 has been ON for 19 consecutive hours",
    "value": 19,
    "threshold": 16
  }
]
```

Each rule is one SQL query (DISTINCT ON the latest reading + a WHERE
threshold). Results merged in Python and sorted critical → warning.

### `POST /api/chat/` (bonus — Option A)

Anthropic-grounded assistant. System prompt is ~8.5 KB of live
telemetry slices (machine snapshot, today/yesterday kWh, daily history,
hourly building power, per-zone daily kWh, last 40 decisions) sent
with `cache_control: ephemeral` so per-question cost is dominated by
the user message, not the snapshot.

Behaviour matrix:

| Input                             | Status | Body                                           |
| --------------------------------- | ------ | ---------------------------------------------- |
| empty `message`                   | 400    | `{"detail": "..."}`                            |
| `ANTHROPIC_API_KEY` unset         | 200    | `{"reply": "AI assistant is not configured…"}` |
| Anthropic auth/billing/rate-limit | 200    | `{"reply": "⚠️ AI service error: <upstream>"}` |
| Network / SDK / unexpected        | 502    | `{"detail": "Upstream AI error: <Class>"}`     |
| Happy path                        | 200    | `{"reply": "<assistant text>"}`                |

Throttled by `UserRateThrottle`. Replies render as Markdown via
`react-markdown` + `remark-gfm`.

---

## 1C. Frontend Components

### Architecture decisions

- **Pages Router, not App Router.** Every view is client-interactive
  (live polling, date pickers, chat input). RSC default would force
  `"use client"` on nearly every component
- **TanStack Query for all server state.** No Redux/Zustand. Local UI
  state (selected machine, date, bucket toggle) is plain `useState` in
  the page that owns it
- **No prop drilling.** Each page fetches its own data via hooks;
  components receive only what they render

### Component tree

```
_app.tsx
├── SessionProvider     (NextAuth — JWT session in httpOnly cookie)
├── QueryClientProvider (staleTime: 60s, retry: 1)
├── ThemeProvider       (next-themes — dark default)
└── Layout (skipped for /login)
    ├── Sidebar          (6 NavLinks + brand)
    ├── Header           (ThemeToggle + UserMenu)
    └── AuthGate         (redirects to /login?callbackUrl=… when unauth)
        ├── /            Overview — AlertBanner + 6 KpiCard + 12 MachineCard
        ├── /machines    12 cards + detail panel (StatusBadge, Tabs, AreaChart)
        ├── /energy      Date nav + view/bucket toggles + 3 KpiCard + AreaChart
        ├── /decisions   DataTable (filter popovers per column) + pagination
        ├── /compare     2 PeriodPickers + 3 KpiCard + overlaid AreaChart
        ├── /chat        EmptyChat + MessageBubble × N + Composer
        └── /login       Credentials form → NextAuth signIn
```

### Data-fetching pattern

Every page follows the same shape — no exceptions:

```tsx
const { data, isLoading, error } = useHook(params);
if (isLoading) return <LoadingState />;
if (error) return <ErrorState message={error.message} />;
if (!data || data.length === 0) return <EmptyState />;
// render happy path
```

Every hook is gated by `enabled: !!session?.accessToken` — no requests
fire until authenticated. Live pages (`/`, `/machines`, alerts) use
`refetchInterval: 30_000`; historical views (energy, decisions,
compare) refetch on param change only.

### State management

| State kind           | Tool                                           |
| -------------------- | ---------------------------------------------- |
| Server state         | TanStack Query (per-hook cache key)            |
| Auth session         | NextAuth (`useSession`), httpOnly cookie       |
| Per-page UI state    | `useState` in the owning page component        |
| Cross-page nav state | URL query params (e.g. `/machines?selected=3`) |
| Theme                | `next-themes` (localStorage + CSS class)       |

Nothing global beyond auth + theme. Cache invalidation happens
automatically via TanStack's stale-while-revalidate.

### Reusable vs page-specific

| Component                                                         | Where          | Used by                   |
| ----------------------------------------------------------------- | -------------- | ------------------------- |
| `KpiCard`, `MachineCard`, `StatusBadge`, `AlertBanner`            | `dashboard/`   | Overview, Machines, …     |
| `AreaChart` (mode prop, custom tooltip slot, `nowLine` reference) | `dashboard/`   | Machines, Energy, Compare |
| `LoadingState`, `ErrorState`, `EmptyState`                        | `dashboard/`   | every page                |
| `DataTable`, `ColumnFilter` (TanStack Table v8 wrapper)           | `data-table/`  | Decisions only            |
| `MarkdownMessage`                                                 | `dashboard/`   | Chat only                 |
| `AuthGate`, `Sidebar`, `Header`, `UserMenu`, `ThemeToggle`        | `layout/`      | shell                     |
| `Table`, `Tabs`, `Badge`, `Button`, `Select`, `Popover`, …        | `ui/` (shadcn) | primitives                |

Page-specific code lives in `src/features/<page>/` (column defs for
Decisions, period helpers for Compare, etc.) — kept out of `dashboard/`
so reusable components stay reusable.

### Frontend ↔ backend

```
Browser ──▶ NextAuth (/api/auth/*, local catch-all in pages/api/auth/[...nextauth].ts)
        ──▶ Django (/api/*, proxied via Next rewrites)
                ──▶ TimescaleDB
```

`next.config.js` uses `fallback` rewrites so `/api/auth/*` resolves
locally first; everything else falls through to Django. Trailing slash
is appended on the destination so `APPEND_SLASH=True` doesn't 301-loop.

All chart colors reference CSS variables (`hsl(var(--chart-1))` etc.)
from the tweakcn green/yellow theme — no hardcoded hex anywhere — so
light/dark mode swap cleanly. Numbers > 999 go through a shared
`fmtNum()` helper for locale-aware separators (kWh, kW totals, tooltips).

---

## Trade-Off Notes

**`time_bucket` over `DATE_TRUNC`** — chunk-aware, preserves
hypertable pruning. `DATE_TRUNC` triggers full table scans.

**`DISTINCT ON` over `MAX()` subquery** — single index scan on the
latest chunk vs one correlated subquery per machine (~12× slower).

**JWT in httpOnly cookie over `localStorage`** — XSS can't read
httpOnly cookies. Access token (30 min) refreshes transparently via
the NextAuth JWT callback.

**30 s polling over WebSockets** — sensor data arrives every 5 min;
Channels + Redis broker buys nothing user-visible at this frequency.

**Pages Router over App Router** — RSC default doesn't compose with
TanStack Query's `refetchInterval`; would need `"use client"` on every
component anyway.

**Server-side pivot for by-zone** — Python `defaultdict` keyed by
bucket. Clients shouldn't reshape time-series matrices.

**Bangkok TZ hardcoded in `utils.py`** — the spec describes a
Bangkok building. UTC anchoring made "06:00 building opens" land at
13:00 local. A multi-region deployment would lift this to settings.

**Flat hypertable, no continuous aggregates (yet)** — at 24 k rows,
raw `time_bucket` is < 50 ms. Continuous aggregates add materialized
view management complexity that pays off at millions of rows.

**Engineered alert anomalies in the seed** — clean data would leave
the alert banner empty, masking a key feature. Each rule's pattern is
injected once in the trailing window, tuned to test assertions so the
plumbing stays verified end-to-end.

**Compare chart: overlaid AreaChart, not side-by-side bars** — bars
compare totals well but lose the load-curve shape that's the actual AI
value. Overlay preserves shape; tooltip restores per-bar comparison.
