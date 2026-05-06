# Step 23 — Backend audit fixes

Backend code-quality audit produced 16 findings; this step lands the
fixes in one branch (`chore/be-quality-fixes`).

## Correctness

- **`ALERT_NONSTOP` false positive (`backend/building/sql.py`).** The
  old rule fell back to `latest - 24h` when `last_off` was NULL, which
  always evaluated as exactly 24h `> 16h` and fired for any never-OFF
  machine. The seed had to engineer AC-L3's behaviour to make this rule
  visible. Replaced with a LATERAL JOIN that computes streak start as
  the first ON reading after the most recent OFF (or `MIN(ON)` if there
  is no OFF history). Existing alert tests still pass.

- **Summary undercount for zero-reading machines
  (`backend/building/views/building.py`).** `inactive = total - active`
  miscounted machines that have no readings yet (they vanish from the
  DISTINCT ON view and got attributed to "inactive"). Now counts OFF
  status directly so the KPI matches the actual on/off state plus an
  explicit "no reading yet" bucket.

- **Seed RNG state leak
  (`backend/building/management/commands/seed.py`).** Reading
  generation called global `random.gauss`, breaking the per-day
  determinism that the day-plan code already enforced for AC schedules.
  Threaded a `random.Random` through `_gen_reading`, `_temp_drift`,
  `_power_load_factor`, and `_apply_engineered_alerts`. Removed the
  redundant `random.seed(options["seed"])` from `handle()` since each
  generator now owns its own RNG.

- **Period-A vs Period-B chronology
  (`backend/building/views/energy_compare.py`).** `before/after` carries
  chronological meaning, but the endpoint only enforced
  `from < to` per period. Swapping A and B silently flipped the
  `savings_pct` sign. Added `a_from >= b_from` → 400 and updated
  `test_compare_identical_periods_returns_400` accordingly.

## Defensiveness

- **`parse_iso_datetime` rejects naive datetimes
  (`backend/building/utils.py`).** A naive timestamp without an offset
  was previously parsed and bound straight into TimescaleDB queries,
  which silently treated it as UTC and shifted Bangkok windows by
  7 hours. Now raises ValueError → 400 if the offset is missing.

- **Chat hardening (`backend/building/views/chat.py`).**
  - 4 KB cap on the user `message` to bound Anthropic spend per call.
  - DRF `UserRateThrottle` (`30/min` per user) on `/api/chat/`.
  - Replaced the `except Exception` blanket with typed handlers for
    `APIStatusError`, `APIConnectionError`, and `AnthropicError`.

- **Settings hardening (`backend/thermalos/settings.py`).** With
  `DEBUG=False` and the dev `DJANGO_SECRET_KEY` placeholder, the
  process now refuses to start. Pytest gets a softer `RuntimeWarning`.
  Added a parallel guard for `ALLOWED_HOSTS=*` in production.

## Cleanup / DRY

- **`resolve_window` helper (`backend/building/utils.py`).** Four views
  open-coded the same `to_dt = MAX(recorded_at) ... from_dt = to_dt -
  Δ` pattern. Centralised; views now early-return on the empty-DB path
  via a single `if window is None`.

- **`yesterday_kwh_or_none` helper.** Same "treat 0/NULL as no data"
  guard appeared in `views/building.py` and `views/chat.py`. Now lives
  in `utils.py`.

- **Chat SQL moved to `sql.py`.** `zone_sql` was inline; now
  `sql.ZONE_KWH_BETWEEN`. Recent-decisions snippet became
  `sql.DECISIONS_RECENT`. Daily history loop replaced with one
  `time_bucket('1 day'::interval, recorded_at, '+07:00')` call
  (`sql.DAILY_KWH_HISTORY`) — 7 round-trips → 1.

- **Removed `bulk_create([])` flush in seed.** `transaction.atomic`
  already orders writes correctly; the no-op call was misleading.

## Verification

- `pytest -q`: **125 passed** (1 expected RuntimeWarning for the dev
  secret key in tests).
- `python manage.py seed --clear`: 24 192 readings + 42 decisions
  across 12 machines, identical totals to pre-fix run.

## Files touched

```
backend/building/management/commands/seed.py
backend/building/sql.py
backend/building/tests/test_energy_compare.py
backend/building/utils.py
backend/building/views/building.py
backend/building/views/chat.py
backend/building/views/decisions.py
backend/building/views/energy_compare.py
backend/building/views/machines.py
backend/thermalos/settings.py
```
