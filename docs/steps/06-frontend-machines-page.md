# 06 — Frontend `/machines` page

PR #16 — `feat/fe-machines-page` → `main`

## Goal

Implement the Machines route from DESIGN §1C: a grid of all 12 machines plus a
detail panel that charts a chosen sensor metric over time for the selected
machine. Selection is URL-driven (`?selected=<id>`) so alerts can deep-link
into a specific machine on the Overview page later.

## What landed

### Hooks

- `src/lib/hooks/use-machines.ts` — `useMachines()` returns the full list
  of machines (12 rows, with `latest_reading` joined server-side). Lives at
  30s `refetchInterval` so the grid stays fresh while the page is open.
- `src/lib/hooks/use-machine-sensors.ts` — `useMachineSensors({ machineId,
metric, bucket, from, to })`. Exports the `MachineMetric` and
  `MachineSensorBucket` union types so the page can drive the metric tabs
  type-safely. `enabled: !!token && machineId > 0` keeps it from firing
  before a selection is made. `keepPreviousData` smooths the chart when the
  user switches metrics on the same machine.

### Components

- `src/components/dashboard/status-badge.tsx` — `<StatusBadge status={ON|OFF} />`
  pill. Coloured dot + label, primary text for `ON`, muted for `OFF`.
- `src/components/dashboard/machine-card.tsx` — Clickable tile. Shows name,
  zone, primary metric (power for ACs/critical machines, speed for fans
  when available), and a `<StatusBadge>`. Polymorphic root: renders
  `<button>` when `onClick` is supplied (with `aria-pressed`), `<div>`
  otherwise. Selected highlight uses `border-primary ring-1 ring-primary`.
- `src/components/ui/tabs.tsx` — Standard shadcn Tabs (Radix-backed).
  Active state via `data-[state=active]:bg-primary
data-[state=active]:text-primary-foreground`; disabled triggers go to
  50% opacity and lose pointer events. Uses `@radix-ui/react-tabs`
  (newly installed).

### Page — `src/pages/machines.tsx`

- `useMachines()` drives the grid. Loading/error states from the shared
  `<LoadingState />` / `<ErrorState />` components.
- Selection lives in `?selected=<id>` query string, mirrored into local
  state via `useEffect`. `select(id)` does a `router.replace(..., {
shallow: true })` so the URL updates without a server round-trip.
- Metric tabs: all four (`power_kw`, `temperature`, `setpoint`,
  `speed_pct`) render side-by-side, but `metricsForMachine(machine)`
  decides which are enabled — fans get power + speed, ACs get the
  thermal triplet. When the selected machine changes, the active tab
  resets to that machine's first allowed metric so we don't sit on a
  disabled state.
- Chart: `<AreaChart />` with a single `value` series, 5-minute bucket,
  unit-aware Y formatter (`kW`, `°C`, `%`).

## X-axis tick density fix

5-minute buckets over 24 hours = ~288 ticks, which crowded the X axis to
the point of being unreadable. Two-part fix:

1. Added an optional `xTicks?: ReadonlyArray<string | number>` prop to
   `<AreaChart />`. When provided, it pins the visible tick set instead
   of letting Recharts auto-pick.
2. The page filters `sensorPoints` down to buckets where the wall-clock
   minute equals zero (one tick per hour, 24 across a day) and passes
   that list as `xTicks`.

Why this lives at the page rather than baked into AreaChart: tick
cadence depends on the chosen bucket size and the time window — `/energy`
already uses larger buckets (15min/1h) where Recharts' default works
fine, so we don't want to force-thin there. Page-level control keeps
each caller honest.

## Verification

- `docker compose restart frontend` — clean compile, no TypeScript errors.
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/machines` → `200`.
- User confirmed visual review: grid renders, click-through populates
  detail panel, tabs respect machine type, chart shows hourly ticks.

## Files

```
frontend/package.json                              (added @radix-ui/react-tabs)
frontend/package-lock.json
frontend/src/components/dashboard/area-chart.tsx   (xTicks prop)
frontend/src/components/dashboard/machine-card.tsx (new)
frontend/src/components/dashboard/status-badge.tsx (new)
frontend/src/components/ui/tabs.tsx                (new)
frontend/src/lib/hooks/use-machine-sensors.ts      (new)
frontend/src/lib/hooks/use-machines.ts             (new)
frontend/src/pages/machines.tsx                    (was a stub, now the page)
```

## Up next

- PR #17: `/` Overview — `useBuildingSummary` + `useAlerts` + KpiCard +
  AlertBanner + machine grid (links to `/machines?selected=<id>`).
- PR #18: `/compare` — `useEnergyCompare` + side-by-side BarChart.
- PR #19: `/chat` — Anthropic chat assistant (Phase 7 bonus).
