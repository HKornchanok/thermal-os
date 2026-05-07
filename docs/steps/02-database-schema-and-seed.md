# Step 02 — Database schema, TimescaleDB hypertable, seed data

## What

- Three Django models (`Machine`, `SensorReading`, `AIDecision`) matching DESIGN.md §1A.
- Two migrations: `0001_initial` (auto-style schema) + `0002_timescale` (composite PK swap, hypertable conversion, indexes).
- A `seed` management command that produces 35 days of realistic demo data — 12 machines, ~121k readings, ~414 AI decisions, plus engineered alert-firing scenarios on the latest readings.
- Admin registration for all three models so `/admin/` is browsable from day one.

## Why

PLAND.md Phase 1. Every API endpoint downstream depends on (a) a hypertable that supports `time_bucket`, and (b) data that exercises every dashboard feature on first load — KPIs, charts, alerts, before/after savings, and the AI decision log.

### Why a 5-minute sampling cadence (288 readings/machine/day)

This question came up explicitly. The cadence is locked at 5 min for three reasons:

1. **It matches the smallest API bucket.** `/api/machines/{id}/sensors/` accepts `bucket=5min`. Sampling slower than the smallest bucket would give one reading per bucket — the chart would render as steps, not a smooth curve. Faster (e.g. 1-minute) is wasted: the dashboard polls every 30s anyway and the screen can't show 1-minute resolution differently.
2. **It's the realistic HVAC rate.** Real BMS systems (BACnet/Modbus) poll at 1–5 min. 15 min is energy-meter territory; 1 min is over-instrumented. 5 min is the boring-correct industrial default.
3. **121k rows is the right database size for the demo.** Big enough that TimescaleDB chunk pruning visibly matters (the whole reason the design uses it). Small enough that seed runs in well under a minute and queries return in well under the 200ms target. Math: 24h × 60min ÷ 5min = 288 readings/day × 12 machines × 35 days = 120,960 rows.

The lever for "faster seed" is shorter date range (`--days 14`), not coarser cadence.

### Why a composite primary key on `building_sensorreading`

TimescaleDB requires the partitioning column (`recorded_at`) to be part of every unique constraint, including the primary key. Django's auto-generated single-column PK on `id` would block `create_hypertable`. The fix is in `0002_timescale.py`:

```sql
ALTER TABLE building_sensorreading DROP CONSTRAINT building_sensorreading_pkey;
ALTER TABLE building_sensorreading ADD CONSTRAINT building_sensorreading_pkey PRIMARY KEY (id, recorded_at);
SELECT create_hypertable('building_sensorreading', 'recorded_at', chunk_time_interval => INTERVAL '1 day');
```

`id` is still globally unique (it's a `BIGSERIAL`), so Django ORM treats it as the conceptual PK. The composite key only exists for TimescaleDB's correctness rule.

### Why non-hypertable for `building_aidecision`

DESIGN.md §1A: AI decisions are sparse (~23/day) vs sensor readings (~3,456/day). A plain B-tree index on `decided_at` is faster for sparse event logs than a hypertable, which adds chunk-management overhead that only pays off for high-cardinality time-series.

## Files

| Path                                            | Purpose                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/building/models.py`                    | Three model classes with `db_table` matching DESIGN.md exactly                                                                                                                             |
| `backend/building/admin.py`                     | All three models registered with sensible `list_display` / filters                                                                                                                         |
| `backend/building/migrations/0001_initial.py`   | Hand-written migration matching what `makemigrations` would produce — checked in so `migrate` works on fresh clones without first running `makemigrations`                                 |
| `backend/building/migrations/0002_timescale.py` | `RunSQL`: composite PK swap, `create_hypertable`, three indexes                                                                                                                            |
| `backend/building/management/commands/seed.py`  | The seed command — 360 lines, fully deterministic via `random.seed(42)`                                                                                                                    |
| `docker-compose.yml`                            | Parameterised ports (`${DB_PORT:-5432}`, `${BACKEND_PORT:-8000}`) so the stack can run alongside another project on the same host                                                          |
| `backend/Dockerfile`                            | Pip install now reads dependencies from `pyproject.toml` via `tomllib` instead of `pip install -e .`, which fixed a build-order bug where setuptools couldn't find the package directories |

## Seed properties

- **Anchored to `now`.** Time range = `[now - 35d, now]`, rounded to 5-minute slots. The dashboard always shows fresh data because the API uses `MAX(recorded_at)` as its reference point.
- **Manual / AI split at the midpoint.** Days 0–17 are "manual" (load factor ~0.78, looser setpoint band, machines linger past 18:00 with 55% probability); days 17–35 are "AI" (load factor ~0.70, tighter setpoint band). This drives `/api/energy/compare/`.
- **Engineered alerts on the latest reading** so `/api/alerts/` has visible content on first load:
  - AC-L1 latest at 41.4 kW (92% of 45 rated) → triggers `power_spike` warning
  - AC-S2 latest at temp 27.1°C, setpoint 24.0°C → triggers `temp_drift` warning
  - AC-L3 ON for the last 19h continuously → triggers `nonstop_runtime` critical
- **AI decisions only in the AI half** with a realistic mix (43% turn_off, 33% set_temp, 25% turn_on). Set_temp targeted at fans gracefully falls back to turn_off because fans don't have a setpoint.

## Verification (already executed)

Ran end-to-end on an isolated test stack (`-p thermalos-test`, ports 5433/8001 to avoid colliding with another project on 5432/8000):

```
$ docker compose -p thermalos-test up -d --build
Applying building.0001_initial... OK
Applying building.0002_timescale... OK
$ docker compose -p thermalos-test exec backend python manage.py seed --clear
Created 12 machines
Generating readings: 2026-03-29T14:50 → 2026-05-03T14:50 (manual until 2026-04-15T14:50, then AI)
Created 120,972 sensor readings
Created 414 AI decisions
Injected alert seeds (power_spike, temp_drift, nonstop_runtime)
```

Checks:

- Hypertable registered: `SELECT * FROM timescaledb_information.hypertables` → 1 row
- Chunks: 36 (one per day in the 35-day window plus the partial day at the end)
- Composite PK: `\d building_sensorreading` → `PRIMARY KEY, btree (id, recorded_at)`
- Period split: manual avg power 5.58 kW, AI avg 4.48 kW → 19.7% reduction (target was ≥10%)
- Alert seeds verified — AC-L1 latest = 41.4 kW, AC-S2 latest temp = 27.1°C, AC-L3 has 227 ON / 0 OFF readings in last 19h

## How to run for yourself

```bash
cd /path/to/repo

# If the default ports clash with another project, override:
#   DB_PORT=5433 BACKEND_PORT=8001 docker compose ...

docker compose up -d --build           # migrations run automatically
docker compose exec backend python manage.py seed --clear

# Optional: log in to Django admin to browse the data
open http://localhost:8000/admin/      # admin / admin
```

## Known minor cleanup (non-blocking)

- `building_sensorreading_recorded_at_idx` is auto-created by TimescaleDB on the partition column. My `0002_timescale.py` also creates `sensorreading_recorded_idx` — they're functionally identical. Could drop the redundant one but doesn't affect correctness or performance materially.

## Next

Phase 2 — wire SimpleJWT auth (`/api/auth/token/`, `/api/auth/token/refresh/`), enforce `IsAuthenticated` on the building API.
