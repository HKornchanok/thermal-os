# 18 — /compare date pickers: per-period bounds + canonical defaults

PR #28 — `feat/compare-date-bounds` → `main`

Two related changes to the Before/After page so the comparison stays
semantically meaningful out of the box:

1. **Each calendar bound to its own period's half** of the seed window
2. **Defaults pre-populate to first 3 days vs first 3 AI days** —
   equal-length, fair comparison

## Per-period bounds

`pages/compare.tsx`:

- Derive two ranges from the resolved compare response:
  - `periodARange = { min: compare.before.from, max: compare.before.to }`
  - `periodBRange = { min: compare.after.from,  max: compare.after.to }`
- `<PeriodPicker>` accepts `minDate` / `maxDate` and forwards them to
  the `<input type="date">`'s `min` / `max` attributes — the native
  calendar greys out everything outside the range.
- Cross-input clamp: From's `max` falls back to current To value, To's
  `min` falls back to current From — neither input can jump past its
  sibling.
- Inline footer per picker: `Available data: 2026-04-28 → 2026-04-30`
  so the bounds are visible even before opening the calendar.

### Why per-period rather than full-window

The whole point of `/compare` is **manual vs AI**. If a user could
pick a Period A date inside the AI half, the comparison would silently
stop being a manual-vs-AI delta and become "early-AI vs late-AI" —
same chart, much less interesting story. Scoping each picker to its
half enforces the brief's framing.

## Canonical defaults — first 3 vs first 3 AI

Per the brief's "Day 1–3 manual / Day 4–7 AI" framing, the natural
default for the page is to compare 3 manual days against 3 AI days
of equal length:

```
Period A — Before AI:  Day 1 → Day 3   (full manual window)
Period B — After AI:   Day 4 → Day 6   (first 3 AI days)
```

Equal-length windows make the savings_pct delta directly comparable.
The previous implementation defaulted Period B to the entire AI
window (4 days) which skewed the average against the longer side.

Implementation:

- `defaults` is a `useMemo` that computes `{ aFrom, aTo, bFrom, bTo }`
  from the resolved bounds — `aFrom = periodARange.min`,
  `aTo = aFrom + 2 days` (clamped to `periodARange.max`), and the
  symmetric for B.
- A first-load `useEffect` populates the input state with these
  defaults once `compare` resolves. Gated by an `initialised` flag so
  the user's own picks aren't clobbered if the underlying compare
  refreshes mid-session.
- `Reset to defaults` button now restores those canonical defaults
  instead of clearing inputs to empty.
- The button is hidden when the inputs already match the defaults
  (`usingCanonicalDefaults`) — no point offering "reset" when there's
  nothing to reset to.
- Page intro updated to reflect the new framing: "first 3 days of
  manual vs first 3 days of AI".

The previous "default YYYY-MM-DD" placeholder hint inside the date
inputs is gone — inputs are always populated now.

## Verified

In Playwright (current 7-day seed, browser TZ Asia/Bangkok):

| Input | value | min | max |
|-------|-------|-----|-----|
| period-a-from | 2026-04-28 | 2026-04-28 | 2026-04-30 |
| period-a-to | 2026-04-30 | 2026-04-28 | 2026-04-30 |
| period-b-from | 2026-05-01 | 2026-05-01 | 2026-05-03 |
| period-b-to | 2026-05-03 | 2026-05-01 | 2026-05-03 |

KPIs at default:
- Before — avg power: **1,180.8 kW**
- After — avg power: **816.9 kW**
- Savings: **30.8%** (manual cut by AI, equal 3-day windows)

`npm run typecheck` clean.

## Files

```
frontend/src/pages/compare.tsx
docs/steps/18-compare-date-bounds.md
```
