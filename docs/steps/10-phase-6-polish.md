# 10 — Phase 6 polish

PR #20 — `chore/fe-phase-6-polish` → `main`

Cross-cutting cleanup pass per PLAND.md Phase 6.

## What landed

### `fmtNum()` helper

Added `fmtNum(value, decimals = 1)` in `src/lib/utils.ts`. Wraps
`Number.prototype.toLocaleString` with min/max fraction digits pinned
to the same value so the number doesn't visually jitter as the value
crosses a decimal boundary.

The DESIGN rule: apply `fmtNum()` everywhere a value above 999 is
plausible. Skip it for values that stay small (temperature, %,
machine count) — separators would be visual noise on `12.5°C`.

### Where applied

| Location                    | Before                              | After                       |
|-----------------------------|-------------------------------------|-----------------------------|
| Overview — Total power      | `${total_power_kw.toFixed(1)} kW`   | `${fmtNum(total_power_kw)} kW` |
| Overview — Today's energy   | `${today_kwh.toFixed(1)} kWh`       | `${fmtNum(today_kwh)} kWh`     |
| Overview — Yesterday        | `${yesterday_kwh.toFixed(1)} kWh`   | `${fmtNum(yesterday_kwh)} kWh` |
| Energy — Peak / Average     | `${peak.toFixed(1)} kW`             | `${fmtNum(peak)} kW`           |
| Energy — chart Y/tooltip    | `${(v).toFixed(1)} kW`              | `${fmtNum(v as number)} kW`    |
| Compare — Before/After avg  | `${avg_kw.toFixed(0)} kW`           | `${fmtNum(avg_kw)} kW`         |
| Compare — chart Y/tooltip   | `${(v).toFixed(1)} kW`              | `${fmtNum(v as number)} kW`    |

Not applied:

- **Machines page** — single-machine power tops out at the rated
  ceiling (~45 kW), comfortably under 999, so the chart tooltips stay
  on `.toFixed()`. Adding `fmtNum` here would never produce a
  separator and only adds an import.
- **Overview avg temperature** — small float by definition.

### Favicon

- `frontend/public/favicon.svg` — minimal flame/leaf glyph in the
  theme's primary green + accent yellow over a dark surface. SVG is
  the cheapest format that respects the theme without separate
  light/dark assets.
- `_document.tsx` — `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`
  inside the document `<Head>`. Document-level so every route picks
  it up; route-level `<Head>` continues to own the page title.

## Items audited and already correct

- **No hardcoded hex / rgb in chart code** — verified by grep across
  `components/dashboard/` and `lib/chart.ts`. All colours flow through
  `var(--*)` tokens that flip with the theme.
- **`enabled: !!session?.accessToken` on every query hook** — verified
  via grep. The chat hook is a `useMutation` (no `enabled` semantics);
  the auth-guarded page prevents it from being called pre-session
  anyway.
- **Page titles per route** — every page already declares its own
  `<title> · ThermalOS` in `<Head>`.
- **Rewrites isolation** — `next.config.js` uses `rewrites().fallback`
  so NextAuth's `/api/auth/[...nextauth]` dynamic route always wins
  over the Django proxy. Trailing slash hardcoded in destination
  (`${backendUrl}/api/:path*/`) so Django's APPEND_SLASH never 301s
  back into a redirect loop.

## Verification

- Hot-reload — clean compile on every page.
- `/favicon.svg` → 200, served as `image/svg+xml`.
- Visual review confirmed favicon shows in the tab and KPI numbers
  unchanged in this seed (today_kwh ≈ 754, well under 1000) but ready
  to render with separators when totals cross over.

## Files

```
frontend/public/favicon.svg          (new)
frontend/src/lib/utils.ts            (fmtNum helper)
frontend/src/pages/_document.tsx     (favicon link)
frontend/src/pages/index.tsx         (KPIs)
frontend/src/pages/energy.tsx        (KPIs + chart formatters)
frontend/src/pages/compare.tsx       (KPIs + chart formatters)
```
