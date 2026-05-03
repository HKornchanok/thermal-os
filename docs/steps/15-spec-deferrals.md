# 15 — Spec deferrals: KPIs, Select, Separator

PR #25 — `chore/spec-deferrals` → `main`

Closes the three audit findings that map cleanly back to the spec
without contradicting earlier user-driven design decisions.

Stacked on PRs #23 + #24 so polish + spec-fixups land together.

## What landed

### #3 — Overview KPI composition matches spec

**Audit finding:** Spec lists `total / active / inactive / total power
/ today / avg temp` (6 cards). Implementation had `total / active (off
hint) / total power / today / yesterday / avg temp` — Inactive folded
into Active's hint, replaced by a Yesterday card.

**Fix:** `pages/index.tsx` — restored the dedicated `Inactive` card
and dropped the `Yesterday` card. The day-over-day relationship is
already encoded as the trend hint under "Today's energy"
(`+75.4% vs yesterday`), and the absolute yesterday number is one
click away on the `/energy` page if anyone needs it.

Verified: KPIs render as `Total machines (12) / Active (5) /
Inactive (7) / Total power (96.3 kW) / Today's energy (754.3 kWh +
trend) / Avg temperature (25.0 °C)`.

### #6 — Add shadcn `Select` primitive

**Audit finding:** Spec shared-components table lists `Select`. We
were using a native `<select>` for the per-page selector on
`/decisions`.

**Fix:**

- New `src/components/ui/select.tsx` — standard shadcn new-york
  variant. Wraps `@radix-ui/react-select` for keyboard navigation,
  focus management, and screen-reader semantics.
- `data-table.tsx` per-page selector now uses `Select`. The trigger
  is `role=combobox` with `aria-label="Rows per page"` and a 4.5rem
  fixed width that fits values up to 999. `pageSize` is converted
  to `String` on the way in / `Number` on the way out — Radix's
  Select expects string values.

Verified end-to-end: trigger appears as a `<button role=combobox>`
with the current page size visible.

### #7 — Add shadcn `Separator` primitive

**Audit finding:** Spec lists `Separator`. Not previously in
`components/ui/`. (DropdownMenu has its own internal separator
primitive; Sidebar used implicit border-r only.)

**Fix:**

- New `src/components/ui/separator.tsx` — standard shadcn new-york
  variant. Wraps `@radix-ui/react-separator`.
- `Sidebar` — added a `<Separator className="bg-sidebar-border" />`
  between the brand block (ThermalOS / Building monitor / collapse
  toggle) and the nav list. Reads as a clear visual section break
  without adding ad-hoc `<hr>` markup.

The `bg-sidebar-border` class overrides the default `bg-border`
because the sidebar palette has its own border token that's
slightly different in dark mode.

## Findings explicitly NOT addressed

Two audit findings map to deliberate user-driven design decisions in
earlier PRs. Reverting them would un-do choices the user explicitly
made and approved:

- **#4 — Compare BarChart vs overlay AreaChart.** During PR #18 the
  user asked for "line chart with 2 data source", then "maybe area",
  and approved the resulting overlay. Spec says BarChart; user chose
  overlay. Keeping current.
- **#5 — Decisions filter UX.** During PR #12 the user iterated 4×
  to land on column-header popover filters with a funnel-icon
  trigger ("instead of display filter should each column should has
  filter toggle button"). Spec says page-level controls; user chose
  column popovers. Keeping current.

If the user later changes their mind on either, both are
straightforward reverts.

## Verification

- `npm run typecheck` clean.
- `/`, `/decisions`, `/machines` all return 200 after restart.
- Playwright confirms:
  - Overview KPIs render as `Total / Active / Inactive / Total power
    / Today's energy / Avg temperature` (6 cards, spec order).
  - `[data-testid="page-size"]` is `<button role="combobox"
    aria-label="Rows per page">` with current value visible.
  - Sidebar renders the new Separator under the brand block.

## Audit closeout (final)

After PRs #23, #24, #25:

- ✅ #1 (auth gate) — PR #23
- ✅ #2 (alert spacing) — PR #23
- ✅ #3 (KPI composition) — this PR
- ⏸ #4 (compare chart) — kept overlay area per user decision in PR #18
- ⏸ #5 (decisions filters) — kept column popovers per user decision in PR #12
- ✅ #6 (Select primitive) — this PR
- ✅ #7 (Separator primitive) — this PR
- ✅ #8 (dark default) — PR #23
- 👍 #9 (axis spacing) — already correct
- ✅ #10 (Y-axis width) — PR #23
- 👍 #11 (devtools gating) — already correct
- ✅ #12 (focus rings) — PR #24
- ✅ #13 (Georgia cleanup) — PR #24

11/13 closed; 2 conscious deviations from spec.
