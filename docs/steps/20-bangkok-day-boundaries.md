# 20 — Day boundaries: UTC midnight → Bangkok midnight

PR #30 — `fix/bangkok-day-boundaries` → `main`

Bug companion to PR #27. The seed was already anchored at Bangkok
midnight; the API's `day_start` / `day_end` helpers were still anchored
at UTC midnight, producing a 7-hour offset visible on /machines and
the Overview KPIs.

## The bug

`day_start(dt)` returned UTC midnight of `dt.date()`. With seed
timestamps anchored at Bangkok midnight (= 17:00 UTC the previous day),
the SQL `MAX(recorded_at)` was a UTC datetime whose `date()` was the
UTC calendar date. UTC midnight of that date converted back to Bangkok
local was **07:00 BKK** — so:

- `/api/machines/{id}/sensors/` smart default was
  `[07:00 BKK today → 07:00 BKK tomorrow]`. The chart only showed
  17 hours of the actual local day (07:00–23:55). The first 7 hours
  of the day were a gap.
- `/api/building/summary/` "today's kWh" / "yesterday's kWh" used
  the wrong day boundary. Both values still made sense numerically
  but were mis-anchored — "today" started 7 hours late.

## The fix

`day_start` / `day_end` in `building/utils.py` now anchor on **Bangkok
local midnight**:

```python
BANGKOK_TZ = timezone(timedelta(hours=7))

def day_start(dt: datetime) -> datetime:
    bkk = dt.astimezone(BANGKOK_TZ)
    return datetime.combine(bkk.date(), time.min, tzinfo=BANGKOK_TZ)
```

Returned datetime is timezone-aware in Bangkok TZ. Django's USE_TZ=True
converts to the right UTC instant when bound as a SQL parameter, so
all four call sites (`views/building.py:summary`,
`views/machines.py:machine_sensors`, `views/chat.py` system prompt) get
the correct ranges automatically.

## Why hardcode Bangkok TZ

The brief is for a Bangkok building. Hardcoding `BANGKOK_TZ` in utils
matches the seed's anchor and avoids passing a timezone parameter
through every helper. A real production multi-region system would read
this from a building registry or `settings.BUILDING_TIMEZONE`; for the
assessment, one constant with a comment is the right scope.

## Verified

Playwright on `/machines?selected=14` (AC-L2):

```
xTicks: ["00:00", "01:00", "02:00", ..., "23:00"]   ← 24 ticks, full BKK day
```

Previously: `["07:00", "08:00", ..., "23:00"]` — 17 ticks.

Overview summary KPIs still resolve sensible numbers:

- today_kwh: 1,786 kWh
- yesterday_kwh: 1,690 kWh
- trend_pct: +5.7%

Both periods are now full Bangkok days, so the comparison is
apples-to-apples (was: today's first 7 hours vs yesterday's last 7
hours of the previous comparison-window).

`pytest -q` → 125 passed.
