# 08 — Frontend `/compare` page

PR #18 — `feat/fe-compare-page` → `main`

## Goal

Implement the Before/After comparison view from DESIGN §1C — the
showcase page for the manual-vs-AI energy savings story.

## What landed

### Hook

- `src/lib/hooks/use-energy-compare.ts` — `useEnergyCompare(params)`
  wraps `/api/energy/compare/`. All four boundaries (`a_from`, `a_to`,
  `b_from`, `b_to`) are optional; omitting them lets the server split
  the seed window in half. `keepPreviousData` smooths the chart while
  the user steps date inputs. No refetch interval — this is a
  slow-moving comparison, not a live dashboard.

### AreaChart enhancement

- Added a `mode?: "area" | "line"` prop. Default `"area"` preserves
  existing behaviour (gradient fills for single-series, soft fills for
  multi). `"line"` strips fills entirely for cases where overlaid fills
  would muddle readability. Also added `connectNulls` on the underlying
  `<Area>` so two series of differing length can coexist on one chart
  without breaking the line where one side runs out of data.

### Page — `src/pages/compare.tsx`

- Two `<PeriodPicker>` cards (Period A "Before AI", Period B "After
  AI"), each with From/To `<input type="date">`. Empty inputs show
  `default YYYY-MM-DD` hints echoing the server-resolved boundaries —
  the user can see what the smart default actually is and tweak from
  there. **Reset to defaults** button only appears when at least one
  input has been set.
- 3 KPI cards: before avg kW, after avg kW, savings %. Savings %
  colour-codes positive (green) / negative (red) and prefixes with `−`
  for cuts and `+` for increases — the sign always matches the
  direction of energy use, never the math sign of the percentage.
- **Overlaid timeseries chart** — fetches 1h-bucket building energy
  for each period (using the server-resolved boundaries from the
  compare response so the chart and KPIs stay in sync), then merges
  the two series by **elapsed hours from period start**. Periods of
  different lengths align cleanly: the shorter line just stops where
  its data runs out. Both periods render as area series (semi-
  transparent fills + visible strokes), letting the user compare the
  shape of consumption directly.
- Tooltip translates the offset back into `Day N, h+M` so the user
  doesn't have to mentally convert "hour 73" → "day 4 morning".

## Why elapsed-hours instead of absolute timestamps

Periods A and B have different absolute timestamps (a few weeks apart)
so plotting them on a real time axis produces two disjoint clusters
with empty space between — useless for comparison. Aligning by
"hours from each period's own start" puts the curves on top of each
other where the eye can compare amplitude and shape directly.

## Why two AreaChart hooks instead of returning the timeseries from /api/energy/compare/

`/api/energy/compare/` is a scalar endpoint — it returns the single
mean for each period, plus the savings ratio. Returning ~408 hourly
rows × 2 periods would inflate the response for every consumer (KPI
cards don't need it). Composing two `useBuildingEnergy` calls lets
each query stay focused; React Query dedupes by key so there's no
redundant traffic.

## Verification

- Hot-reload picked up cleanly, `/compare` → 200.
- User confirmed visual review on both line and area mode; settled on
  area for the visual weight under each curve.

## Files

```
frontend/src/components/dashboard/area-chart.tsx (mode + connectNulls)
frontend/src/lib/hooks/use-energy-compare.ts     (new)
frontend/src/pages/compare.tsx                   (was placeholder, now the page)
```

## Up next

- PR #19: `/chat` — Anthropic chat assistant (Phase 7 bonus). Backend
  `/api/chat/` view + frontend chat surface.
