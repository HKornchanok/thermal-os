# 17 — Seed timestamps anchor at Bangkok midnight

PR #27 — `fix/seed-bangkok-tz` → `main`

Quick fix to the seed so the schedule hours land at the right wall-clock
time on the dashboard.

## The bug

The seed used `datetime.now(timezone.utc)` to anchor "midnight" of each
day. The schedule constants ("06:00 building opens", "22:00 night
mode") were then interpreted against that UTC clock.

The brief is for a **Bangkok** building (UTC+7). When the frontend
renders timestamps via `new Date(iso).getHours()`, the browser converts
to local. A Bangkok-based viewer saw the building wake up at **13:00**
and go to night mode at **05:00** — schedule offset by +7 hours.

## The fix

Anchor the seed window at midnight **Bangkok**, not midnight UTC:

```python
BANGKOK_TZ = timezone(timedelta(hours=7))

end = datetime.now(BANGKOK_TZ).replace(
    hour=0, minute=0, second=0, microsecond=0
) + timedelta(days=1)
```

Now `dt.hour == 6` inside `_is_on` / `_setpoint_for` / `_outdoor_temp`
means 06:00 **Bangkok**. Django stores the resulting tz-aware datetime
as UTC (USE_TZ=True), but the round-trip via ISO → `new Date(iso)` →
local renders correctly:

| Stored UTC        | Bangkok local | Browser elsewhere      |
| ----------------- | ------------- | ---------------------- |
| 2026-05-04T15:00Z | 22:00 BKK     | 11:00 ET / 16:00 CET   |
| 2026-05-04T11:30Z | 18:30 BKK     | 07:30 ET / 12:30 CET   |
| 2026-05-04T00:00Z | 07:00 BKK     | shifted by viewer's TZ |

A Bangkok-based viewer (the assessment audience) sees the schedule at
the right wall-clock; a remote viewer sees the same building day
shifted by their offset, which is the correct reading of "this is what
happened in Bangkok at this UTC moment."

## Verified

Playwright check on `/decisions` with `Intl.DateTimeFormat` reporting
`Asia/Bangkok`:

| Stored ISO           | Rendered             | Brief expects                |
| -------------------- | -------------------- | ---------------------------- |
| 2026-05-04T15:00:00Z | May 04, **10:00 PM** | 22:00 lobby night mode ✅    |
| 2026-05-04T12:00:00Z | May 04, **07:00 PM** | 19:00 evening shutdown ✅    |
| 2026-05-04T11:30:00Z | May 04, **06:30 PM** | 18:30 office floors close ✅ |

`/energy` X-axis now spans `23:00 → 23:00` (Bangkok local last 24h)
with hourly ticks from 06:00 morning ramp-up through 22:00 night mode.

## Tests

`pytest -q` → 125 passed. The shift in stored timestamps is invisible
to API tests since they assert on day boundaries (e.g.
`MAX(recorded_at)` arithmetic) that work the same against any
consistent timezone anchor.
