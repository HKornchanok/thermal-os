# 07 — Frontend `/` Overview page

PR #17 — `feat/fe-overview-page` → `main`

## Goal

Replace the placeholder Overview page with the real DESIGN §1C landing
view: derived alerts banner, headline KPIs, and the machine grid.
First page the user sees after login — has to read in one glance.

## What landed

### Hooks

- `src/lib/hooks/use-building-summary.ts` — `useBuildingSummary()` for
  the 8-field snapshot (`total_machines`, `active_machines`,
  `inactive_machines`, `total_power_kw`, `today_kwh`, `yesterday_kwh`,
  `trend_pct`, `avg_temperature`). Refetch every 30s.
- `src/lib/hooks/use-alerts.ts` — `useAlerts()` for the merged list of
  derived alerts (power spike / temp drift / non-stop runtime). Server
  sorts critical → warning. Also 30s refetch so banners appear and
  disappear without a manual reload.

### Components

- `src/components/dashboard/alert-banner.tsx` — `<AlertBanner alerts
onSelect />`. Stacks one row per alert with severity-driven colour:
  destructive border + tinted bg + AlertTriangle for `critical`, neutral
  border + muted bg + CircleAlert for `warning`. Renders nothing when
  the array is empty (no "all clear" placeholder; the absence of the
  banner is the signal).
- Polymorphic row: when `onSelect` is supplied, the row is a `<button>`
  with hover state and click target = the offending machine; otherwise
  presentational `<div>`. Used here to deep-link into `/machines?selected=<id>`.

### Page — `src/pages/index.tsx` (rewrite)

- Auth guard via `useSession()` — redirects to `/login` on
  `unauthenticated` (kept from the placeholder).
- Three live queries fan out: `useAlerts()`, `useBuildingSummary()`,
  `useMachines()`.
- **Alert banner** — only renders when `alerts.length > 0`. Clicking
  routes to `/machines?selected=<id>`.
- **6 KPIs** — total / active (+off count hint) / total power /
  today's kWh (with trend % vs yesterday hint) / yesterday's kWh /
  avg ON-AC temperature. Trend hint is colour-coded: red when up
  (more energy = bad), green when down (savings), muted when no
  baseline. Layout: 2 columns on mobile, 3 on md, 6 on xl.
- **Machine grid** — same 12-card grid as `/machines` but cards link
  _into_ `/machines?selected=<id>` rather than selecting in place.
  This keeps the Overview a launching pad and `/machines` the
  full inspection surface.

## Why no fmtNum() yet

DESIGN §1C calls for `fmtNum()` once values reliably push past 999. With
the current seed (today_kwh ≈ 754, total_power ≈ 96), `.toFixed(1)`
reads cleanly and avoids a thousands-separator visual jump as numbers
cross 1000. We'll standardise everywhere in the Phase 6 polish pass.

## Verification

- `docker compose restart` not needed — hot-reload picked up cleanly.
- `curl -s -o /dev/null -w '%{http_code}' /` → 200.
- User confirmed visual review: alerts banner with 3 alerts (1 critical
  AC-L3 nonstop_runtime, 2 warnings), 6 KPI cards, 12 machine cards,
  click-through into `/machines?selected=<id>` works.

## Files

```
frontend/src/components/dashboard/alert-banner.tsx  (new)
frontend/src/lib/hooks/use-alerts.ts                (new)
frontend/src/lib/hooks/use-building-summary.ts      (new)
frontend/src/pages/index.tsx                        (was placeholder, now the page)
```

## Up next

- PR #18: `/compare` — `useEnergyCompare` + side-by-side BarChart
  (before vs after the AI took over).
- PR #19: `/chat` — Anthropic chat assistant (Phase 7 bonus).
