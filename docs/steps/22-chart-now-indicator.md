# 22 — Chart "now" indicator

PR #32 — `feat/chart-now-indicator` → `main`

Adds a vertical dashed reference line to every machine's sensor chart
marking the current wall-clock time, so an operator can immediately
see where in the 24-hour window "right now" lives.

## What landed

### `<AreaChart>` gains an optional `nowLine` prop

`components/dashboard/area-chart.tsx`:

- New prop `nowLine?: string | number` — when set, renders a Recharts
  `<ReferenceLine>` at that X position.
- Styled with the theme's primary green (`var(--primary)`), 1.5px
  stroke, `3 3` dash pattern, and a top-anchored `now` label in mono
  font matching the rest of the axis typography.
- `ifOverflow="extendDomain"` so the line still shows even if the
  exact value falls outside the rendered domain.

The prop is optional. Charts that don't pass `nowLine` (Energy,
Compare, Decisions) render unchanged.

### `/machines` page snaps "now" to the closest bucket

`pages/machines.tsx`:

- New `nowBucketIso` memo walks `sensorPoints` and picks the bucket
  timestamp closest to wall-clock `Date.now()`.
- Passed to `<AreaChart nowLine={nowBucketIso} />`.

### Why snap instead of using a raw timestamp

Recharts' X axis here is **categorical** — `xKey="bucket"` makes each
data point a discrete string label, not a continuous numeric/time
domain. `<ReferenceLine x={...}>` only positions correctly when the
value matches an EXACT data point's bucket label; passing
`Date.now().toISOString()` directly produces `x1="NaN"` because no
data point's ISO string matches that exact instant.

Snapping to the nearest 5-minute bucket gives Recharts a value it can
locate on the categorical axis. Visually the line lands within ±2.5
minutes of true NOW — well below the dot pitch on the chart.

A more rigorous alternative would be switching the X axis to a numeric
time scale (`type="number"` + `domain` + `tickFormatter`), but that
ripples across every chart that consumes `<AreaChart>` and changes how
ticks are picked. Snapping is the lower-risk path for one feature.

## Stacking note

This PR is targeted at `fix/realistic-power-spike` (PR #31) because
that PR makes the `/machines` chart show the last 24 hours from the
browser's NOW. Without PR #31, the chart's data window is anchored at
`MAX(recorded_at)` of the seed, so the closest bucket to NOW lands at
the LEFT edge (NOW is earlier than the chart range). With PR #31
merged, NOW lands inside the data window and the reference line sits
at the right edge — exactly where an operator would expect it.

GitHub will auto-retarget this PR to main once #31 merges.

## Files

```
frontend/src/components/dashboard/area-chart.tsx  (nowLine prop + ReferenceLine)
frontend/src/pages/machines.tsx                   (nowBucketIso memo + wiring)
docs/steps/22-chart-now-indicator.md              (this doc)
```

`npm run typecheck` clean.
