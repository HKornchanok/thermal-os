# ThermalOS — System Design

> Database schema, API contracts, and frontend architecture for the
> ThermalOS building energy dashboard. This document describes the
> system as built — read alongside the running code.

---

## 1A. Database Schema

### Design Goals

Three query patterns drive every schema decision:

| Pattern | Frequency | Latency Target |
|---------|-----------|----------------|
| Latest reading per machine (live status) | Every 30s per user | < 50ms |
| Time-series for one machine over a day | On demand | < 200ms |
| Building-wide aggregate (total kW, kWh) | Every 30s per user | < 100ms |

TimescaleDB sits on top of Postgres 15. We use it for one thing: efficient time-bucketed
aggregation via `time_bucket()`. Everything else is standard Postgres.

### Tables

#### `building_machine` — static registry

```sql
CREATE TABLE building_machine (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(20)  NOT NULL UNIQUE,   -- "AC-L1", "FAN-03"
    machine_type    VARCHAR(20)  NOT NULL,           -- "large_ac" | "small_ac" | "fan"
    zone            VARCHAR(100) NOT NULL,           -- human-readable location
    rated_power_kw  FLOAT        NOT NULL,
    is_critical     BOOLEAN      NOT NULL DEFAULT FALSE  -- TRUE = runs 24/7
);
```

12 rows. No time-series here — machines are a slow-changing reference table.
Queried once per page load, joined into sensor queries for context.

#### `building_sensorreading` — TimescaleDB hypertable

```sql
CREATE TABLE building_sensorreading (
    id           BIGSERIAL,
    machine_id   INTEGER      NOT NULL REFERENCES building_machine(id) ON DELETE CASCADE,
    recorded_at  TIMESTAMPTZ  NOT NULL,       -- partition key
    power_kw     FLOAT        NOT NULL,
    temperature  FLOAT,                       -- NULL for fans
    setpoint     FLOAT,                       -- NULL for fans
    speed_pct    FLOAT,                       -- NULL for ACs
    status       VARCHAR(3)   NOT NULL,       -- "ON" | "OFF"
    PRIMARY KEY (id, recorded_at)
);

-- TimescaleDB hypertable — 1-day chunks match the most common query window
SELECT create_hypertable(
    'building_sensorreading', 'recorded_at',
    chunk_time_interval => INTERVAL '1 day'
);

-- Indexes
CREATE INDEX ON building_sensorreading (machine_id, recorded_at DESC);
CREATE INDEX ON building_sensorreading (recorded_at DESC);
```

**Why a composite PK?** TimescaleDB requires the partition column (`recorded_at`) in
the primary key for unique constraint enforcement across chunks.

**Why 1-day chunks?** All dashboard queries are scoped to 1–7 days. Each query reads
only the relevant chunks — no full-table scans.

**Why separate `power_kw` from `status`?** A machine can be `ON` at 0 kW (spinning
down) or show reduced load. Keeping them separate makes both independently queryable.

**Sensor vs. AI command — how they differ:**
Sensor readings are high-frequency (every 5 minutes × 12 machines = 3,456 rows/day),
stored in a hypertable optimised for range scans. AI decisions are sparse events
(~10/day during the AI period, brief target 8–12), stored in a plain table. They
share `machine_id` as a foreign key but are never joined in hot-path queries — the
dashboard renders them on separate pages.

#### `building_aidecision` — sparse event log

```sql
CREATE TABLE building_aidecision (
    id          BIGSERIAL PRIMARY KEY,
    decided_at  TIMESTAMPTZ NOT NULL,
    machine_id  INTEGER     REFERENCES building_machine(id) ON DELETE SET NULL,
    action_type VARCHAR(10) NOT NULL,    -- "turn_on" | "turn_off" | "set_temp"
    value       FLOAT,                   -- target setpoint (°C), NULL for ON/OFF
    reason      TEXT        NOT NULL     -- human-readable explanation
);

CREATE INDEX ON building_aidecision (decided_at DESC);
```

**Why not a hypertable?** AI decisions are sparse (~10/day vs 3,456 sensor
readings/day). A plain B-tree index on `decided_at` is faster for sparse event logs.
TimescaleDB adds chunk management overhead that only pays off for high-cardinality
time-series.

**Why nullable `machine_id` with `ON DELETE SET NULL`?** Decisions must survive
machine deletions. The audit trail is preserved — Somchai can still see "something
happened" even if the machine record is gone.

### Key Query Patterns

```sql
-- 1. Latest reading per machine (live dashboard)
--    Single index scan via DISTINCT ON — no subquery join.
SELECT DISTINCT ON (machine_id)
    machine_id, status, power_kw, temperature, setpoint, speed_pct, recorded_at
FROM building_sensorreading
ORDER BY machine_id, recorded_at DESC;

-- 2. Time-series for one machine, hourly buckets
--    time_bucket() is chunk-aware — reads only the relevant day-partition.
SELECT time_bucket('1 hour', recorded_at) AS bucket, AVG(power_kw) AS value
FROM building_sensorreading
WHERE machine_id = $1 AND recorded_at BETWEEN $2 AND $3
GROUP BY bucket ORDER BY bucket;

-- 3. Building-wide total power, 15-min buckets
SELECT time_bucket('15 minutes', recorded_at) AS bucket, SUM(power_kw) AS total_kw
FROM building_sensorreading
WHERE recorded_at BETWEEN $1 AND $2
GROUP BY bucket ORDER BY bucket;

-- 4. Today's total energy (kWh)
--    Each row is a 5-min sample → multiply by 5/60 to convert to kWh.
SELECT SUM(power_kw) * 5.0 / 60.0 AS today_kwh
FROM building_sensorreading
WHERE recorded_at >= $today_start AND recorded_at < $now;
```

**Why `time_bucket` instead of `DATE_TRUNC`?** `DATE_TRUNC` bypasses TimescaleDB's
chunk pruning — the query planner falls back to a full table scan. `time_bucket` is
chunk-aware and reads only the relevant partitions.

**Why `DISTINCT ON` instead of a subquery join?** `DISTINCT ON (machine_id) ORDER BY
machine_id, recorded_at DESC` is a single index scan. The equivalent `WHERE recorded_at
= (SELECT MAX(...))` requires one subquery per machine — ~12× slower for 12 machines.

### Seed shape

7 days of 5-minute readings × 12 machines = **24,192 sensor rows**. Split
3 manual / 4 AI per the brief's Before/After framing:

- **Days 1–3 (manual)**: every non-critical machine runs 06:00–22:00 flat,
  setpoints stuck at 25°C, ~78% load on hot afternoons. No AI decisions
  logged.
- **Days 4–7 (AI control)**: zone-aware schedule (lobby extended hours, main
  floors 06:00–19:00, offices 07:00–18:30, meeting rooms close at 14:30 when
  empty), dynamic setpoints, ~65% load. ~10 AI decisions per day = **40 total**.

**Per-day variation via `DayPlan`.** Each AI day gets an immutable plan
(outdoor peak 32–36°C, decision times jittered ±15–30 min, setpoints
jittered ±0.5°C, conditional events on hot/cool days). The plan drives
*both* sensor reading generation and decision log emission so the chart
shows the change at the same minute the decision logs it. Per-day RNG
seeded by `(global_seed × 100 + day_index + 1)` so re-runs reproduce.

**Bangkok timezone anchor.** The building is in Bangkok. Seed timestamps
anchor at midnight Bangkok (UTC+7), not UTC. Django stores tz-aware
datetimes as UTC (`USE_TZ=True`) so the round-trip is correct: 22:00
Bangkok → 15:00 UTC stored → 22:00 local rendered for a Bangkok viewer.
Without this, the schedule would be offset by +7 hours on the dashboard.

**Engineered alert anomalies in the trailing window.** Three deliberate
nudges so the Smart Alerts banner has each rule firing on first load:

- AC-L1 last hour held at ~41.4 kW (over-cooling, "valve stuck open"
  failure pattern) → fires `power_spike`.
- AC-S2 last reading temp 27.1°C vs setpoint 24.0°C → fires `temp_drift`.
- AC-L3 last 19 hours forced ON → fires `nonstop_runtime`.

Tuned to the values `test_alerts.py` asserts so the rule plumbing stays
verified end-to-end.

---

## 1B. API Design

All endpoints require `Authorization: Bearer <access_token>`.
Authentication: Django SimpleJWT on the backend, NextAuth.js CredentialsProvider on the
frontend. The JWT access token (30-min lifetime) is stored in a signed httpOnly cookie by
NextAuth — never in localStorage (prevents XSS token theft). Token refresh is automatic
and transparent to the user.

### Endpoint Summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/token/` | Obtain JWT access + refresh tokens |
| POST | `/api/auth/token/refresh/` | Refresh expired access token |
| GET | `/api/machines/` | All machines + latest sensor reading |
| GET | `/api/machines/{id}/sensors/` | Time-bucketed readings for one machine |
| GET | `/api/building/summary/` | Live KPI snapshot |
| GET | `/api/building/energy/` | Building-wide power over a time range |
| GET | `/api/decisions/` | AI decision log with filters |
| GET | `/api/energy/compare/` | Before vs. after energy comparison |
| GET | `/api/building/energy/by-zone/` | Zone-breakdown power over a time range |
| GET | `/api/alerts/` | Active anomaly alerts |
| POST | `/api/chat/` | AI chat assistant (bonus — Option A) |

---

### `POST /api/auth/token/`

Django SimpleJWT token endpoint. NextAuth calls this server-side — never exposed to the browser directly.

**Request:**
```json
{ "username": "admin", "password": "admin" }
```

**Response:**
```json
{ "access": "eyJ...", "refresh": "eyJ..." }
```

---

### `POST /api/auth/token/refresh/`

**Request:**
```json
{ "refresh": "eyJ..." }
```

**Response:**
```json
{ "access": "eyJ...", "refresh": "eyJ..." }
```

---

### `GET /api/machines/`

Returns all 12 machines with their most recent sensor reading.

**Query params:** none

**Implementation:** Uses raw SQL with `DISTINCT ON (machine_id) ORDER BY machine_id,
recorded_at DESC` — a single index scan across the latest hypertable chunk.

**Response:**
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
      "machine_id": 1,
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

---

### `GET /api/machines/{id}/sensors/`

Time-bucketed sensor readings for a single machine. Powers the detail chart on the
Machines page.

**Query params:**

| Param | Default | Values |
|-------|---------|--------|
| `from` | `to − 24 hours` | ISO datetime |
| `to` | `MAX(recorded_at)` for this machine | ISO datetime |
| `metric` | `power_kw` | `power_kw`, `temperature`, `setpoint`, `speed_pct` |
| `bucket` | `5min` | `5min`, `15min`, `1h`, `1d` |

**Smart default date range:** Sliding 24-hour window ending at the machine's
latest reading. Operations dashboards want "what happened in the last day,"
not "today so far" which clips to ~half a day right after midnight. The
frontend additionally overrides with the **browser's** wall-clock NOW (not
the server's MAX) so an operator opening the page at 06:00 sees data
spanning 06:00 yesterday → 06:00 today.

**Security:** `metric` is validated against an allowlist before interpolation into the
SQL column name — prevents SQL injection.

**Response:**
```json
[
  { "bucket": "2026-05-03T08:00:00+00:00", "value": 31.2 },
  { "bucket": "2026-05-03T09:00:00+00:00", "value": 33.8 }
]
```

---

### `GET /api/building/summary/`

Live snapshot of the whole building. Polled every 30s by the Overview page.

**Query params:** none

**Reference time:** Instead of `datetime.now(UTC)`, the endpoint queries
`SELECT MAX(recorded_at) FROM building_sensorreading` and uses that as the reference
point. "Today" = the **Bangkok-local day** of `max_ts` (`day_start`/`day_end` in
`utils.py` anchor at midnight UTC+7), "yesterday" = one day before. This ensures KPIs
always reflect the latest available data, whether the data is live or seeded into the
future, and that "today" matches what an on-site operator calls "today." Returns an
empty/zero response if no data exists.

**Response:**
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

- `trend_pct`: negative = today is lower than yesterday (energy saving, shown green).
  Positive = higher (shown red). `null` if no yesterday data.
- `avg_temperature`: average across all AC machines currently ON. `null` if no ACs active.

---

### `GET /api/building/energy/`

Total building power over a time range, time-bucketed. Powers the Energy page area chart.

**Query params:**

| Param | Default | Values |
|-------|---------|--------|
| `from` | 24h ago | ISO datetime |
| `to` | now | ISO datetime |
| `bucket` | `1h` | `15min`, `1h` |

**Response:**
```json
[
  { "bucket": "2026-05-03T01:00:00+00:00", "total_kw": 11.3 },
  { "bucket": "2026-05-03T02:00:00+00:00", "total_kw": 117.4 }
]
```

---

### `GET /api/decisions/`

Chronological AI decision log with server-side pagination. The dataset grows at ~23
records/day — pagination keeps the response fast and the table usable as data
accumulates over weeks.

**Query params:**

| Param | Default | Values |
|-------|---------|--------|
| `from` | 7 days ago | ISO datetime |
| `to` | now | ISO datetime |
| `action` | (all) | `turn_on`, `turn_off`, `set_temp` |
| `page` | `1` | positive integer |
| `page_size` | `20` | `10`, `20`, `50` |

**Response (paginated envelope):**
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
    },
    {
      "id": 43,
      "decided_at": "2026-05-03T02:30:00+00:00",
      "machine": 1,
      "machine_name": "AC-L1",
      "action_type": "set_temp",
      "value": 24.0,
      "reason": "Adjusted from 25°C to 24°C — outdoor temp rising to 34°C"
    }
  ]
}
```

**Implementation:** `LIMIT %s OFFSET %s` appended to the existing query. A separate
`SELECT COUNT(*)` with the same filters provides the total for pagination metadata.
Date-range and action-type filters apply to both the count and the page query.

---

### `GET /api/energy/compare/`

Side-by-side energy comparison between any two periods. Somchai can compare the manual
period vs AI period, last week vs this week, or a hot day vs a cool day. The frontend
exposes two date-range pickers (Period A, Period B).

**Query params:**

| Param | Default | Notes |
|-------|---------|-------|
| `a_from` | seed start | ISO datetime — start of Period A |
| `a_to` | seed start + 3 days | ISO datetime — end of Period A |
| `b_from` | seed start + 3 days | ISO datetime — start of Period B |
| `b_to` | seed start + 7 days | ISO datetime — end of Period B |

Defaults auto-detect the manual/AI split from `MIN(recorded_at)` for a sensible
first-load experience, but all four params are freely overridable.

**Response:**
```json
{
  "before": { "from": "2026-04-26T00:00:00+00:00", "to": "2026-04-29T00:00:00+00:00", "avg_kw": 142.3 },
  "after":  { "from": "2026-04-29T00:00:00+00:00", "to": "2026-05-03T00:00:00+00:00", "avg_kw": 121.0 },
  "savings_pct": 15.0
}
```

**Implementation:** Computes hourly averages via `time_bucket('1 hour', ...)` for each
period, then compares the means. This smooths out per-interval noise and gives a stable
comparison figure.

---

### `GET /api/building/energy/by-zone/`

Zone-breakdown of building power. Powers the "By Zone" toggle on the Energy page,
letting Somchai see which zones drive consumption.

**Query params:**

| Param | Default | Values |
|-------|---------|--------|
| `from` | 24h ago | ISO datetime |
| `to` | now | ISO datetime |
| `bucket` | `1h` | `15min`, `1h` |

**Implementation:**

```sql
SELECT time_bucket(%s, sr.recorded_at) AS bucket,
       m.zone,
       SUM(sr.power_kw) AS total_kw
FROM building_sensorreading sr
JOIN building_machine m ON m.id = sr.machine_id
WHERE sr.recorded_at >= %s AND sr.recorded_at <= %s
GROUP BY bucket, m.zone
ORDER BY bucket, m.zone
```

**Response (pivoted — one key per zone per time bucket):**
```json
[
  {
    "bucket": "2026-05-03T01:00:00+00:00",
    "Zone A (Lobby & Ground)": 32.4,
    "Zone B (Floors 1-3)": 28.1,
    "Zone C (Floors 4-6)": 27.8,
    "Floor 1 Office": 8.2,
    "Floor 2 Office": 7.9,
    "Floor 3 Meeting Rooms": 0.0,
    "Floor 5 Executive": 0.0,
    "Server Room (24/7)": 11.3,
    "Basement Parking": 4.1,
    "Ground Floor": 2.8,
    "Floors 1-3": 3.2,
    "Floors 4-6": 3.1
  }
]
```

The backend pivots rows into this shape so the frontend can map each zone key directly
to a Recharts `<Area>` without client-side transforms.

---

### `GET /api/alerts/`

Active anomaly alerts computed from the latest readings and recent history. Polled
every 30s alongside the summary endpoint. No persistent alert table — alerts are
derived on the fly so they always reflect current state.

**Alert rules:**

| # | Rule | Condition | Severity |
|---|------|-----------|----------|
| 1 | Power spike | `power_kw > 0.90 × rated_power_kw` for any ON machine | warning |
| 2 | Temperature drift | `ABS(temperature - setpoint) > 2.0°C` for any AC | warning |
| 3 | Nonstop runtime | Non-critical machine ON for >16 consecutive hours | critical |

**Response:**
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
  },
  {
    "severity": "warning",
    "rule": "power_spike",
    "machine_id": 1,
    "machine_name": "AC-L1",
    "message": "AC-L1 at 42.3 kW (94% of 45 kW rated)",
    "value": 42.3,
    "threshold": 40.5
  },
  {
    "severity": "warning",
    "rule": "temp_drift",
    "machine_id": 5,
    "machine_name": "AC-S2",
    "message": "AC-S2 zone temp 27.1°C vs setpoint 24.0°C (drift: 3.1°C)",
    "value": 3.1,
    "threshold": 2.0
  }
]
```

**Implementation (SQL for each rule):**

```sql
-- Rule 1: Power spike (latest reading per machine, filtered post-DISTINCT ON)
SELECT sub.machine_id, sub.name, sub.power_kw, sub.rated_power_kw
FROM (
    SELECT DISTINCT ON (sr.machine_id)
        sr.machine_id, m.name, sr.power_kw, m.rated_power_kw
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    WHERE sr.status = 'ON'
    ORDER BY sr.machine_id, sr.recorded_at DESC
) sub
WHERE sub.power_kw > sub.rated_power_kw * 0.90;

-- Rule 2: Temp drift (latest AC reading where |temp - setpoint| > 2)
SELECT sub.machine_id, sub.name, sub.temperature, sub.setpoint
FROM (
    SELECT DISTINCT ON (sr.machine_id)
        sr.machine_id, m.name, sr.temperature, sr.setpoint
    FROM building_sensorreading sr
    JOIN building_machine m ON m.id = sr.machine_id
    WHERE sr.status = 'ON' AND sr.temperature IS NOT NULL AND sr.setpoint IS NOT NULL
    ORDER BY sr.machine_id, sr.recorded_at DESC
) sub
WHERE ABS(sub.temperature - sub.setpoint) > 2.0;

-- Rule 3: Nonstop runtime (non-critical machines ON for >16h straight)
SELECT m.id, m.name,
       EXTRACT(EPOCH FROM (max_on.ts - COALESCE(last_off.ts, max_on.ts - INTERVAL '24h'))) / 3600
         AS hours_on
FROM building_machine m
JOIN (
    SELECT DISTINCT ON (machine_id) machine_id, recorded_at AS ts
    FROM building_sensorreading WHERE status = 'ON'
    ORDER BY machine_id, recorded_at DESC
) max_on ON max_on.machine_id = m.id
LEFT JOIN (
    SELECT DISTINCT ON (machine_id) machine_id, recorded_at AS ts
    FROM building_sensorreading WHERE status = 'OFF'
    ORDER BY machine_id, recorded_at DESC
) last_off ON last_off.machine_id = m.id
WHERE NOT m.is_critical
  AND (last_off.ts IS NULL OR last_off.ts < max_on.ts);
```

Results from all three queries are merged and sorted by severity (critical first).

---

### `POST /api/chat/` (Bonus — Option A)

AI chat assistant grounded in live building telemetry. Uses the Anthropic API
(`claude-sonnet-4-6`) with a system prompt that pumps six slices of real data so
the model can answer diagnostic questions ("why was yesterday high?") without
hedging.

**Request:**
```json
{ "message": "Why was energy so high yesterday?" }
```

**Response:**
```json
{ "reply": "Yesterday's total was 1,690.29 kWh — peak load of 1,580 kW hit at 14:00 UTC (21:00 BKK), driven mainly by Zone B (Floors 1-3) which alone consumed 380 kWh..." }
```

**System prompt sections** (all from live SQL — no caching layer between
DB and prompt):

1. Machine snapshot — latest reading per machine
2. Energy totals — today + yesterday kWh anchored at Bangkok midnight
3. Daily kWh history — last 7 days, gives the model trend context
4. Hourly building power — full 24h for today AND yesterday
5. Per-zone daily kWh — today + yesterday, sorted highest first
6. Last 40 AI decisions, covering ~3 calendar days

The prompt is ~8.5 KB and sent with `cache_control: "ephemeral"` on the
system block, so per-question cost is dominated by the user message and
reply tokens, not the snapshot itself.

**Behaviour matrix:**

| Input | Status | Body |
|-------|--------|------|
| empty/missing `message` | 400 | `{"detail": "..."}` |
| `ANTHROPIC_API_KEY` unset | 200 | `{"reply": "AI assistant is not configured..."}` |
| Anthropic auth/billing/rate-limit (`APIStatusError`) | 200 | `{"reply": "⚠️ AI service error: <upstream message>"}` |
| Network / SDK / unexpected | 502 | `{"detail": "Upstream AI error: <ClassName>"}` |
| Happy path | 200 | `{"reply": "<assistant text>"}` |

The "auth/billing → 200 with ⚠️" path lets operators see actionable upstream
messages ("Your credit balance is too low...") in the chat surface itself,
instead of digging into server logs to interpret a 502.

**Frontend rendering:** Replies render as Markdown via `react-markdown` +
`remark-gfm` so Sonnet's `**bold**`, headings, lists, inline code, fenced
code, and GFM tables come through correctly. User messages stay plain text.

---

## 1C. Frontend Component Hierarchy

### Architecture Decisions

**Pages Router, not App Router.** Every view in this dashboard is client-interactive:
live polling every 30s, date pickers, machine selection, chat input. App Router's React
Server Components would require `"use client"` on nearly every component, adding
complexity without benefit. Pages Router is the correct tool for a fully interactive SPA
dashboard.

**TanStack Query for all server state.** No global store (no Redux, no Zustand). All
server data is managed by TanStack Query — it handles caching, deduplication,
background refetching, and stale-while-revalidate. Local UI state (selected machine,
selected date, bucket toggle) is plain `useState` in the owning page component.

**No prop drilling.** Each page fetches its own data via hooks. Components receive only
the data they render — never a query object or loading flag.

### Component Tree

```
_app.tsx
├── SessionProvider (next-auth — JWT session in httpOnly cookie)
├── QueryClientProvider (tanstack-query — staleTime: 60s, retry: 1)
├── ThemeProvider (next-themes — defaultTheme="dark", enableSystem)
└── Layout (skipped for /login)
    ├── Sidebar
    │   ├── ThermalOS brand + collapse toggle
    │   ├── Separator (shadcn)
    │   └── NavLink × 6 (Overview, Machines, Energy, AI Decisions,
    │                     Before/After, AI Assistant)
    ├── Header (right-aligned ThemeToggle + UserMenu dropdown)
    └── AuthGate                       (redirects unauthenticated users to
        │                                /login?callbackUrl=<path>; login
        │                                page restores the URL after sign-in)
        └── <page>
        │
        ├── pages/index.tsx             →  /
        │   ├── AlertBanner            (active alerts — critical/warning,
        │   │                            clickable → /machines?selected=<id>)
        │   ├── KpiCard × 6            (total machines, active, inactive,
        │   │                            total power, today kWh, avg temp)
        │   └── MachineCard × 12       (card grid of all machines)
        │
        ├── pages/machines.tsx          →  /machines (selection in ?selected=<id>)
        │   ├── MachineCard × 12       (clickable — selects machine)
        │   └── [detail panel]         (shown when a machine is selected)
        │       ├── StatusBadge
        │       ├── Tabs               (shadcn — metric selector with
        │       │                        invalid combos disabled: fans get
        │       │                        no temp/setpoint, ACs no speed)
        │       └── AreaChart          (5-min buckets, hour-aligned X ticks,
        │                                vertical "now" reference line)
        │
        ├── pages/energy.tsx            →  /energy
        │   ├── Date nav buttons       (← Prev / Next →)
        │   ├── View toggle            (Total / By Zone)
        │   ├── Bucket toggle          (15min / 1h)
        │   ├── ZoneLegend             (per-zone show/hide checkboxes,
        │   │                            "Show all" / "Hide all", visible
        │   │                            only in By Zone view)
        │   ├── KpiCard × 3            (peak, average, data points)
        │   └── AreaChart              (total_kw, or stacked by zone)
        │
        ├── pages/decisions.tsx         →  /decisions
        │   ├── DataTable (TanStack Table v8 + shadcn Table + Badge)
        │   │   └── ColumnFilter popovers in each header (funnel icon):
        │   │       ├── When           (date operator: between / on / before /
        │   │       │                    same_or_before / after / same_or_after)
        │   │       ├── Action         (multi-select with checkboxes)
        │   │       └── Machine        (text contains)
        │   ├── Refreshing indicator  (spinner during background refetch)
        │   └── Pagination footer      (per-page Select + Prev / Page N of M / Next)
        │
        ├── pages/compare.tsx           →  /compare
        │   ├── PeriodPicker × 2       (Period A bounded to manual window,
        │   │                            Period B bounded to AI window;
        │   │                            defaults to first 3 vs first 3 days
        │   │                            for an equal-length comparison)
        │   ├── Reset to defaults      (visible only when inputs differ)
        │   ├── KpiCard × 3            (before avg, after avg, savings %)
        │   └── AreaChart              (overlaid Before/After on a shared
        │                                "hours from period start" X axis;
        │                                yellow = manual era, green = AI era;
        │                                custom tooltip shows the per-hour
        │                                diff prefixed +/− with savings %)
        │
        ├── pages/chat.tsx              →  /chat  (Bonus — Option A)
        │   ├── EmptyChat              (Sparkles icon + 4 example chips)
        │   ├── MessageBubble × N      (user = primary-tinted plain text,
        │   │                            assistant = muted bg + Markdown
        │   │                            rendered via MarkdownMessage)
        │   └── Composer               (textarea with ⌘/Ctrl+Enter shortcut;
        │                                disabled during pending request)
        │
        └── pages/login.tsx             →  /login
            └── Credentials form       (username + password → NextAuth signIn)
```

### Data-Fetching Pattern

Every page follows the same structure — no exceptions:

```tsx
const { data, isLoading, error } = useHook(params);

if (isLoading) return <LoadingState message="..." />;
if (error)     return <ErrorState message={error.message} />;
if (!data || data.length === 0) return <EmptyState message="..." />;

// render happy path
```

All queries are gated by `enabled: !!session?.accessToken` — no requests fire until the
user is authenticated.

Live pages (`/`, `/machines`) use `refetchInterval: 30_000`.
Historical views (energy, decisions, compare) fetch once and refetch on param change.

### API Proxy

`next.config.js` rewrites `/api/*` to the Django backend. The browser never sees the
backend URL:

```
Browser → GET /api/machines/ → Next.js rewrite → http://backend:8000/api/machines/
```

NextAuth routes (`/api/auth/*`) are handled by the filesystem API route
(`pages/api/auth/[...nextauth].ts`) and are excluded from the rewrite via the `fallback`
rewrite strategy.

### Shared Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `KpiCard` | `dashboard/` | Label + value + optional `hint` slot for trend % / units |
| `MachineCard` | `dashboard/` | Machine status tile: name, zone, primary metric, StatusBadge |
| `StatusBadge` | `dashboard/` | ON (primary green) / OFF (muted) pill |
| `AreaChart` | `dashboard/` | Recharts wrapper. Props: `mode` (area/line), `xTicks` (pre-thinned), `nowLine` (vertical reference at NOW), `tooltipContent` (full custom slot) |
| `MarkdownMessage` | `dashboard/` | Renders Markdown via `react-markdown` + `remark-gfm` for chat replies |
| `AlertBanner` | `dashboard/` | Stacked alert list — destructive (critical), muted (warning). Clickable → `/machines?selected=<id>` |
| `LoadingState` | `dashboard/` | `Loader2` spinner + message |
| `ErrorState` | `dashboard/` | `CircleAlert` + destructive message |
| `DataTable` | `data-table/` | TanStack Table v8 wrapper with column-header filter popovers, manual pagination, refreshing indicator |
| `ColumnFilter` | `data-table/` | Funnel-icon popover with date / multiselect / select / text variants |
| `AuthGate` | `layout/` | Wraps protected routes; redirects to `/login?callbackUrl=…` when unauthenticated |
| `Sidebar`, `Header`, `UserMenu`, `ThemeToggle` | `layout/` | Shell + auth UI |
| `Table`, `Tabs`, `Badge`, `Button`, `Select`, `Separator`, `Popover`, `DropdownMenu` | `ui/` (shadcn) | Standard primitives |

### Number Formatting

A shared formatter in `src/lib/utils.ts` applies locale-aware thousand separators to
any value that can exceed 999:

```typescript
export function fmtNum(value: number, decimals = 1): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
```

**Where applied:**

| Location | Example | Formatted |
|----------|---------|-----------|
| `KpiCard` (kWh values) | `1797.4 kWh` | `1,797.4 kWh` |
| Compare page `avg_kw` | `2139` | `2,139.0` |
| Chart tooltips (kW) | `1187.4 kW` | `1,187.4 kW` |

**Not applied** to values that stay small: temperature (°C), setpoint (°C), speed (%),
machine count. The rule: if `value > 999` is plausible, use `fmtNum()`.

### Chart Config (applied consistently across all pages)

```typescript
// Axis ticks
{ fill: "hsl(var(--muted-foreground))", fontSize: 10, fontFamily: "var(--font-mono)" }

// Tooltip
{
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "var(--radius)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "hsl(var(--foreground))",
}

// Grid
<CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
```

All values reference CSS variables — never hardcoded hex — so the theme applies
uniformly. Zone breakdown charts use `--chart-1` through `--chart-5` plus generated
variants for consistent multi-series coloring.

### Styling

The UI uses the **tweakcn "green with yellow"** theme
(`npx shadcn@latest add https://tweakcn.com/r/themes/cmlewiz0s000304l7hc2n2l1z`),
which provides both light and dark mode via CSS variables in OKLCH color space.

**Fonts:** Inter (sans-serif), JetBrains Mono (monospace). Loaded via
`next/font/google` with `variable: --font-sans` / `--font-mono` so the
theme references them as CSS variables.
**Border radius:** 0.5rem. **Spacing unit:** 0.25rem.
**Default theme:** dark (control-room context). `<ThemeToggle>` cycles
through light → dark → system; choice persists in localStorage.

Key CSS variables (dark mode — the default for a monitoring dashboard):

| Variable | Value | Role |
|----------|-------|------|
| `--background` | `oklch(0.14 0.016 161)` | Very dark green-gray page bg |
| `--foreground` | `oklch(0.96 0.004 157)` | Near-white primary text |
| `--primary` | `oklch(0.72 0.190 150)` | Bright green — main accent |
| `--secondary` | `oklch(0.84 0.170 91)` | Yellow — secondary accent / highlights |
| `--accent` | `oklch(0.35 0.066 94)` | Dark yellow — hover / active states |
| `--card` | dark green-tinted surface | Card/panel background |
| `--border` | muted green | Border and grid line color |
| `--destructive` | `oklch(0.64 0.208 25)` | Red-orange for errors and critical alerts |
| `--muted-foreground` | dimmed green-white | Secondary/dimmed text |
| `--chart-1` through `--chart-5` | theme-provided | Consistent palette for Recharts series |

Tailwind utilities are used freely alongside the CSS variable system. All color
references in components use `hsl(var(...))` or `oklch(var(...))` — never hardcoded
hex values.

---

## Trade-Off Notes

**TimescaleDB `time_bucket` vs `DATE_TRUNC`**
`time_bucket` is chunk-aware. `DATE_TRUNC` is not — it defeats hypertable chunk pruning
and triggers full table scans. Every aggregation query in this project uses `time_bucket`.

**`DISTINCT ON` vs subquery for latest reading**
`DISTINCT ON (machine_id) ORDER BY machine_id, recorded_at DESC` is a single index scan
that reads only the most recent chunk. A `WHERE recorded_at = (SELECT MAX(...))` subquery
approach requires one correlated subquery per machine — ~12× slower.

**JWT in cookies vs localStorage**
NextAuth stores the session token in a signed, httpOnly cookie. XSS attacks cannot
read httpOnly cookies, so the JWT is safe even if a script injection occurs. The access
token (30-min lifetime) is refreshed transparently via the NextAuth JWT callback.

**30s polling vs WebSockets**
`refetchInterval: 30_000` via TanStack Query is sufficient for a building dashboard where
sensor data arrives every 5 minutes. WebSockets would require Django Channels + a Redis
broker — significant infrastructure overhead with no user-visible improvement at this
data frequency.

**Pages Router vs App Router**
This dashboard is 100% client-interactive. React Server Components (App Router default)
don't compose with TanStack Query's `refetchInterval` and would require `"use client"` on
every component. Pages Router is the right tool.

**Flat hypertable vs continuous aggregates**
For the current data volume (~24k readings over 7 days), raw `time_bucket` queries
execute in < 50ms. Continuous aggregates add materialized view management complexity
that isn't justified until the dataset grows to millions of rows. This is noted as a
future optimisation in the README.

**Bangkok timezone anchoring**
The seed timestamps + `day_start` / `day_end` helpers anchor at Bangkok midnight,
not UTC. The brief describes a Bangkok building; UTC anchoring made the dashboard
show "06:00 building opens" at 13:00 local. Hardcoding `BANGKOK_TZ` in `utils.py`
matches the seed and avoids threading a timezone parameter through every helper.
A multi-region production system would move this to `settings.BUILDING_TIMEZONE`.

**Per-day variation via `DayPlan`**
Every AI day's decisions used to be identical: same 10 events at the same minute
with the same setpoint values. Real AI control varies day to day in response to
weather and occupancy. `DayPlan` is the single source of truth per day — drives
both sensor readings and decision emission, so the chart shows the change at the
same minute the decision logs it. Without this single source, the two would drift
and the dashboard story would stop being internally consistent.

**Engineered alert anomalies in the seed**
The Smart Alerts feature is the most prominent thing on the Overview banner. With
a clean seed, all three rules would silently pass and the banner would render
empty — a confusing demo for a feature whose entire value is "is the building
behaving normally?" The seed deliberately injects one of each rule's pattern in
the trailing window, tuned to the values `test_alerts.py` asserts against so the
rule plumbing stays verified end-to-end.

**Compare chart: overlay AreaChart over BarChart**
Two periods plotted as side-by-side bars compare totals well but lose the curve
shape — the AI's value is visible most strongly in the *shape* of the daily
load curve (later ramp-up, deeper midday cooling, earlier evening shutdown).
Overlaying the two periods on a shared "hours from period start" X axis
preserves that shape while still showing the magnitude difference. The custom
tooltip restores the per-bar comparison ("After: 820 kW; Before: 1,180 kW;
diff: −360 kW / −30.5%") so no information is lost.

**Decisions filters in column-header popovers**
Page-level filter controls take vertical space and lose the column they filter.
Funnel-icon popovers in each header cluster the filter controls next to their
data, support multi-select / six date operators / text-contains without crowding
the page chrome, and the active-filter dot reminds the user a filter is in
effect when the data looks suspiciously sparse.

**Chat: rich context + Markdown rendering**
A minimal system prompt (machine snapshot + 2 totals + 20 decisions) made the
model hedge on diagnostic questions like "why was yesterday high?" because the
data wasn't actually in the prompt. The richer prompt (six slices including
hourly + per-zone + 7-day daily history + 40 decisions) is ~8.5 KB cached on
the system block, so per-question cost is dominated by the user message and
reply. Markdown rendering matters because Sonnet's outputs lean heavily on
`**bold**`, headings, lists, and GFM tables — rendering them as text via
`whitespace-pre-wrap` is bad UX.

**Pre-commit formatting via Husky + lint-staged**
Prettier formats only the staged files in the current commit (not a whole-tree
pass on every commit). The pre-commit hook means "prettier-only" diffs in later
PRs become impossible — every commit lands already-formatted. Husky commits the
hook scripts to `.husky/` so a fresh clone gets the hook on `npm install`,
unlike a hand-written `.git/hooks/` script which would be invisible to other
contributors.

