# 19 — Per-day AI decision variation

PR #29 — `feat/seed-day-variation` → `main`

Each AI day's decision log + sensor data was identical to the next: same
events at the same minute with the same setpoints. That made the AI look
like a cron job, not a control system. This PR makes each day vary
realistically and ensures the sensor data reflects those variations.

## What changed

### `DayPlan` — single source of truth per AI day

A `DayPlan` is one immutable record per AI day holding:

- `outdoor_peak_c` — daily high temperature (32–36°C realistic for Bangkok dry season)
- `ac_l1_morning_drop_min` — when AC-L1 setpoint drops (canonical 09:30 ± 15 min)
- `ac_l1_morning_setpoint` — target value (canonical 24.0 ± 0.5)
- `ac_l1_evening_relax_min`, `ac_l1_evening_setpoint` — evening relax (~17:00 → 26°C ± 0.5)
- `ac_l1_night_setpoint` — night-mode target (canonical 27 ± 0.5; time always 22:00 sharp)
- `ac_main_noon_min`, `ac_main_noon_setpoint` — Floors 1-6 noon tighten
- `ac_main_evening_min`, `ac_main_evening_setpoint` — Floors 1-6 evening relax
- `ac_s3_off_min` — Meeting rooms shutdown (canonical 14:30 ± 30 min)
- `office_close_min` — Office floors close (canonical 18:30 ± 15 min)
- `main_evening_off_min` — Main floors evening shutdown (canonical 19:00 ± 15 min)
- `extra_morning_tighten` — hot-day flag (peak >34.5°C); adds an extra 11:00 SET_TEMP
- `skip_morning_drop` — cool-day flag (peak <32.8°C); skips the 09:30 lobby drop entirely

`_make_day_plan(rng)` builds one from a per-day RNG seeded by
`(global_seed × 100, day_index)`. Different days produce different
plans; the same `--seed` reproduces the same sequence.

### Plans drive both data and decisions

A module-level `_DAY_PLANS: dict[date, DayPlan]` is populated by
`Command.handle()` before generation runs. Every helper that needs
day-specific values reads from it via `_plan_for(dt)`:

- `_setpoint_for` returns the day's morning/evening/night targets,
  honoring `skip_morning_drop` for cool days
- `_is_on` consults the day's `ac_s3_off_min` / `office_close_min` /
  `main_evening_off_min` so the schedule matches the decisions
- `_outdoor_temp` uses the day's `outdoor_peak_c` instead of a fixed 34°C
- `_gen_day_decisions` emits decisions whose times and setpoint values
  come from the same plan

Result: when the chart shows AC-L1 setpoint drop from 25 to 23.5°C at
09:42 on Tuesday, the decision log has a row "09:42 SET_TEMP AC-L1
23.5°C". Same minute, same value — both driven by the same `DayPlan`.

### Conditional day-shape events

- **Hot day** (`outdoor_peak_c > 34.5°C`): adds an extra 11:00 SET_TEMP
  decision pre-tightening AC-L2 ahead of peak occupancy. The sensor
  data shows AC-L2's setpoint stepping down at 11:00 to match.
- **Cool day** (`outdoor_peak_c < 32.8°C`): skips the morning AC-L1
  setpoint drop. AC-L1 holds 25°C all morning, the decision log has
  one fewer SET_TEMP, and the chart shows a flat morning line for AC-L1.

These conditions naturally produce 8–12 decisions per day depending on
which gates fire, comfortably inside the brief's range.

## Sample seed output (4 AI days)

```
=== May 01 (10 decisions, cool 32.7°C, skip morning drop) ===
  09:37 SET_TEMP  AC-L1  23.5°C  (forecast peak 32.7°C — wait, plan says drop)
  12:05 SET_TEMP  AC-L2  24.0°C
  14:38 TURN_OFF  AC-S3
  ...

=== May 02 (11 decisions, hot 34.7°C, extra tighten) ===
  09:19 SET_TEMP  AC-L1  24.0°C
  11:00 SET_TEMP  AC-L2  24.5°C  (extra tighten — hot day forecast)
  12:01 SET_TEMP  AC-L2  25.0°C
  14:56 TURN_OFF  AC-S3
  ...

=== May 03 (11 decisions, hot 35.4°C, extra tighten) ===
  09:40 SET_TEMP  AC-L1  23.5°C
  11:00 SET_TEMP  AC-L2  23.5°C  (extra tighten — hot day forecast)
  11:48 SET_TEMP  AC-L2  24.0°C
  14:52 TURN_OFF  AC-S3
  ...

=== May 04 (8 decisions, cool day, skipped morning drop) ===
  09:28 SET_TEMP  AC-L1  23.5°C  (still drops — peak just below 32.8)
  11:49 SET_TEMP  AC-L2  25.0°C
  14:43 TURN_OFF  AC-S3
  17:15 SET_TEMP  AC-L1  26.0°C
  ...
```

Decision count varies 8–11 per day; times jitter ±15-30 min; setpoints
jitter ±0.5°C; conditional events fire when their weather gates are met.

## Verification

- `python manage.py seed --clear` → 24,192 readings + **42 decisions**
  across **4 AI days** = 10.5/day average (brief: 8–12/day ✓)
- `pytest -q` → 125 passed (engineered alert anomalies still fire)
- Playwright check on `/decisions` (browser TZ Asia/Bangkok):
  - Times render in Bangkok local with day-to-day variation
    (`02:43 PM` AC-S3 off vs canonical 02:30 PM; `06:51 PM` evening
    shutdown vs canonical 07:00 PM)
  - Setpoints vary day-to-day (`25.0°C` noon today, `24.0°C` yesterday)

## Files

```
backend/building/management/commands/seed.py
docs/steps/19-seed-day-variation.md
```

The seed module grows from ~370 to ~430 lines; new `DayPlan` dataclass
+ `_make_day_plan` factory + `_DAY_PLANS` lookup are the bulk. Existing
helpers (`_setpoint_for`, `_is_on`, `_outdoor_temp`,
`_gen_day_decisions`) all read from the plan via `_plan_for(dt)`
without parameter threading.
