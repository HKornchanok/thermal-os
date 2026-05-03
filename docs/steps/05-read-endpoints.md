# Step 05 — Phase 3: eight read endpoints

## What

Every read endpoint listed in DESIGN.md §1B (excluding the bonus chat) is now implemented, tested, and verified live. Shipped across eight per-endpoint pull requests:

| PR | Endpoint | Tests added | Cumulative tests |
|---:|----------|------------:|-----------------:|
| #1 | `GET /api/machines/` | 11 | 20 |
| #2 | `GET /api/machines/{id}/sensors/` | 20 | 41 |
| #3 | `GET /api/building/summary/` | 10 | 51 |
| #4 | `GET /api/building/energy/` | 13 | 65 |
| #5 | `GET /api/building/energy/by-zone/` | 11 | 77 |
| #6 | `GET /api/decisions/` | 24 | 101 |
| #7 | `GET /api/energy/compare/` | 11 | 112 |
| #8 | `GET /api/alerts/` | 10 | 122 |

**122/122 pytest tests green. ~5s avg run time.**

## Why

PLAND.md Phase 3. Every frontend page in Phase 5 needs at least one of these endpoints. Auth (Phase 2) is fail-closed by default, so the verification pattern for each endpoint was the same: 401 without bearer, 200 with bearer + correct shape, plus rule-specific assertions (allowlist enforcement, pagination math, alert seed visibility, etc.).

## Workflow

Per-endpoint PRs landed sequentially against `main`. PR 1 also carried the structural foundation that the remaining seven endpoints share, so it was the largest:

- `views.py` → `views/` package
- `building/utils.py` (parsers, allowlists, `get_max_recorded_at`, `dictfetchall`)
- `building/sql.py` (raw SQL constants, one per query)
- `conftest.py` `django_db_setup` override seeds the test DB once per session (~6s amortised across all tests) + `admin_client` fixture authenticated as the seeded admin

Subsequent PRs added one endpoint module each plus the SQL/utility additions specific to it.

## Architectural decisions worth remembering

### One SQL constant per query, allowlists for column/interval interpolation

Every query lives in `building/sql.py` as a module-level string. User input always binds via `%s`. The only string-formatting allowed is for `metric` (allowlisted in `utils.ALLOWED_METRICS`) and `bucket` (allowlisted in `ALLOWED_BUCKETS_*`) before being interpolated into `time_bucket()` calls and column references. Tests include explicit SQL-injection probes against the `metric` param to keep the allowlist honest.

### Reference time = `MAX(recorded_at)`, not `now()`

`/api/building/summary/`, `/api/building/energy/`, `/api/decisions/`, and `/api/machines/{id}/sensors/` all anchor their default windows to the latest seeded timestamp rather than the wall clock. The dashboard therefore always shows fresh data whether the seed is live or has been seeded forward into the future. The cost is a single extra `SELECT MAX(recorded_at)` per request, which hits the index and is sub-millisecond.

### Bucket allowlists narrow as scale grows

| Endpoint | Allowed buckets |
|----------|-----------------|
| `/machines/{id}/sensors/` | `5min`, `15min`, `1h`, `1d` |
| `/building/energy/`, `/building/energy/by-zone/` | `15min`, `1h` |

5-min raw at 12-machine sum is too noisy for the area chart; 1-day is too coarse for the visible window. The narrower aggregate set is enforced via a separate constant (`ALLOWED_BUCKETS_AGGREGATE`).

### Pivot at the server, not the client

`/api/building/energy/by-zone/` returns one entry per bucket with zone names as keys mixed alongside `bucket`. Every entry carries every known zone — zones with zero power in a bucket are present at `0.0`. Stable shape across the time axis means Recharts series IDs stay stable and stack colors don't flicker between buckets. A cross-check test asserts that per-zone sums equal the un-pivoted `/api/building/energy/` totals for every bucket, catching double-count and losing-power bugs that per-endpoint tests would miss.

### Alerts are derived, never persisted

`/api/alerts/` runs three independent SQL queries every request and merges the rows into a uniform alert dict. No alert table; no staleness; nothing to migrate. Sort: critical first, then warning, then alphabetical-by-machine for stable rendering between polls.

### Pagination uses `(%s::text IS NULL OR action_type = %s)`

`/api/decisions/` runs the same SQL whether the action filter is supplied or not. NULL passed twice means "no filter"; a value passed twice means "filter to that action". Single template, no string assembly, same plan in the optimizer.

## Subtleties learned across the phase

1. **ISO datetimes in URL params need the `Z` suffix.** A `+00:00` offset URL-decodes to a space. Tests and frontend hooks must use `2026-05-03T16:10:00Z` form. Caught in PR 2 when the first custom-range test failed with 400.
2. **Per-test transactions roll back, but session-scoped seed survives.** Overriding `django_db_setup` to seed once at session start gives every test consistent data; per-test `db` fixture wraps writes in a transaction that's rolled back. test_auth's `testuser` creation doesn't conflict with the seeded `admin`.
3. **TimescaleDB `time_bucket` boundaries don't align with the request window.** A 2-hour range at 15-min buckets can yield 9 entries, not 8 — the leading and trailing buckets are partial. Test bounds need a +1 tolerance.
4. **Auto-increment IDs change between seed runs.** `--clear` resets the data but not the sequence; AC-L1's `id` is whatever the next BIGSERIAL gives. Tests look up IDs dynamically via `/api/machines/`; live curls can't hardcode `id=1`.
5. **`time_bucket` is chunk-aware; `DATE_TRUNC` is not.** Every aggregation query in this app uses `time_bucket` so the planner only reads relevant 1-day partitions. Verified by `EXPLAIN ANALYZE` on the longest queries during seed verification.

## Files (cumulative across 8 PRs)

```
backend/building/
├── sql.py                               # ~10 SQL constants
├── utils.py                             # parsers, allowlists, helpers
├── urls.py                              # 8 routes
├── views/
│   ├── __init__.py                      # public exports
│   ├── machines.py                      # list_machines, machine_sensors
│   ├── building.py                      # summary, energy, energy_by_zone
│   ├── decisions.py                     # decisions_list
│   ├── energy_compare.py                # compare
│   └── alerts.py                        # alerts_list
└── tests/
    ├── conftest.py                      # session seed, admin_client, auth_client
    ├── test_auth.py                     # 9 tests (Phase 2)
    ├── test_machines.py                 # 11 tests
    ├── test_machine_sensors.py          # 20 tests
    ├── test_summary.py                  # 10 tests
    ├── test_building_energy.py          # 13 tests
    ├── test_energy_by_zone.py           # 11 tests
    ├── test_decisions.py                # 24 tests
    ├── test_energy_compare.py           # 11 tests
    └── test_alerts.py                   # 10 tests
```

## Verification

- **`pytest -v`** — 122/122 passing in ~5s (full suite including Phase 2 auth)
- **Live curl** for every endpoint:
  - 401 without bearer
  - 200 with bearer + shape matches DESIGN.md
  - Engineered seed values visible (AC-L1 41.4 kW, AC-S2 27.1°C drift, AC-L3 19h nonstop)
  - 400 / 404 paths exercised
- **Cross-checks:**
  - Per-zone bucket sums equal `/building/energy/` totals
  - Action-filtered decision counts sum to total
  - `compare` default split shows ~18.82% manual→AI savings (matches seed engineering)

## Operational state at end of Phase 3

- Stack still up at `localhost:3000` (frontend), `localhost:8000` (backend), `localhost:5432` (db)
- Tests run with `docker compose exec backend pytest`
- Test stack on alt ports (`-p alto-tech-test`) was used during early verification but is torn down

## Next

Phase 4 (full) — TanStack Query setup, sidebar, shadcn/ui + tweakcn theme, dashboard components (`KpiCard`, `MachineCard`, `StatusBadge`, `SensorChart`, `AlertBanner`, loading/error/empty states), `apiFetch` with bearer attachment, per-endpoint hooks (`useMachines`, `useBuildingSummary`, `useAlerts` etc.). Then Phase 5 wires all 6 dashboard pages against the now-complete API.
