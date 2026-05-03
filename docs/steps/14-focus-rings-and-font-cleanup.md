# 14 — Focus rings + font cleanup

PR #24 — `chore/focus-rings-and-font-cleanup` → `main`

Closes the last two findings from the design audit:

- **#12** — Focus rings on icon buttons / interactive cards
- **#13** — Unused Georgia serif font declaration

Stacked on top of PR #23 (auth gate + a11y) so the polish lands
together; rebases cleanly once #23 merges.

## Focus rings (#12)

The audit found that focus state on icon buttons rendered as
`rgba(0,0,0,0)` — the user-agent default outline was being killed by
`focus-visible:outline-none` but the replacement ring was either
missing or too subtle to notice (the shared `<Button>` shipped with
`focus-visible:ring-1` and no offset).

Two-part fix:

1. **`<Button>` primitive** (`components/ui/button.tsx`) — bumped
   `focus-visible:ring-1` → `focus-visible:ring-2` plus
   `focus-visible:ring-offset-2 focus-visible:ring-offset-background`.
   Two-pixel ring with a two-pixel offset against the page bg gives a
   visible halo in both light and dark themes; the green `--ring`
   token shows clearly against bg-card and bg-muted alike.
2. **Raw `<button>` elements** that bypassed the primitive — same
   utility classes pasted into:
   - `MachineCard` (polymorphic `<button>` when `onClick` is supplied)
   - Chat example-prompt chips (`pages/chat.tsx`)
   - `ZoneLegend` Show all / Hide all (`pages/energy.tsx`)
   - `ToggleGroup` segmented buttons (`pages/energy.tsx`)
   For the energy page buttons the `ring-offset-color` is `--card`
   instead of `--background` because the buttons live inside a
   `bg-card` panel — offset against `bg-background` would render with
   the wrong colour underneath.

### Why ring-2 + offset, not ring-1

shadcn's default ring-1 is the bare-minimum hint. For a monitoring
dashboard with operators tabbing through controls, "where am I
focused" needs to be obvious at a glance. ring-2 with offset is the
established pattern for a11y-first apps and is what shadcn itself
uses when explicitly tuned for accessibility (their docs show the
same combo on focus-visible-heavy components).

### Verified

In Playwright on `/`, after Tab from the URL bar:

```
boxShadow: oklch(0.1397... 160.864) 0px 0px 0px 2px,    // bg ring offset
           oklch(0.7176... 149.6)   0px 0px 0px 4px,    // primary ring
           rgba(0,0,0,0)             0px 0px 0px 0px;
```

The green primary ring at 4px with 2px bg offset matches the
`ring-2 ring-offset-2` tailwind output exactly.

## Georgia font cleanup (#13)

The theme declared `--font-serif: Georgia, serif` in two `:root`
blocks (light + dark) and aliased it as `font-serif` in
`tailwind.config.ts`, but no component or page used it — `font-serif`
returned zero hits across `frontend/src/`. The declaration was
DESIGN.md residue from the pre-implementation theme spec; the
delivered UI uses Inter (sans) for body and JetBrains Mono for code,
KPI values, and machine names.

Stripped:

- `globals.css` — removed both `--font-serif: Georgia, serif;` lines
  (light + dark `:root`).
- `tailwind.config.ts` — removed the `serif: [...]` entry from
  `theme.extend.fontFamily`. `font-sans` and `font-mono` remain.

If serif typography is later wanted (long-form copy, settings docs,
etc.) the font can be reintroduced via `next/font/google` and a new
`--font-serif` token in one place — same pattern Inter and
JetBrains Mono already use.

## Verification

- `npm run typecheck` clean.
- `/`, `/machines`, `/energy`, `/chat` all return 200 after
  hot-reload.
- Tab navigation confirmed focused element renders the green
  ring-2 + ring-offset-2 halo.

## Audit closeout

After PRs #23 and #24, the original 13 findings stand at:

- ✅ Critical #1 — auth gate (PR #23)
- ✅ Critical #2 — AlertBanner spacing (PR #23)
- ✅ Polish #8 — dark default (PR #23)
- ✅ Polish #10 — Compare Y-axis width (PR #23)
- ✅ Polish #12 — focus rings (this PR)
- ✅ Nice-to-have #13 — Georgia cleanup (this PR)
- 👍 Confirmed already correct: #9, #11
- 🟡 Deferred to product call: #3, #4, #5, #6, #7
