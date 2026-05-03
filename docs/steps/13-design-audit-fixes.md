# 13 — Design audit fixes (round 1)

PR #23 — `fix/auth-gate-and-a11y` → `main`

Closes the two critical findings from the post-Phase-8 design audit
plus three high-impact polish items. Verified end-to-end with
Playwright.

## Critical bugs fixed

### 1. Auth gate now covers every protected route

**Audit finding:** Logged-out navigation to `/machines`, `/energy`,
`/decisions`, `/compare`, `/chat` rendered the layout shell + console
401s. Only `/` had a guard.

**Fix:** New `<AuthGate>` in `src/components/layout/AuthGate.tsx`. It
reads the session via `useSession()`, shows a neutral `LoadingState`
during `status === "loading"` to prevent layout-shell flash, and
`router.replace`s to `/login?callbackUrl=<path>` when unauthenticated.
Wired into `_app.tsx` as the wrapper inside `<Layout>` so every route
that opts into the layout is automatically protected. Only `/login`
opts out via the existing `NO_LAYOUT_ROUTES` set.

The pre-existing inline guard in `pages/index.tsx` was deleted —
duplicate logic now that AuthGate runs at the layout level.

**Bonus: callback URL round-trip.** AuthGate captures `router.asPath`
into the redirect's `callbackUrl` query param; `pages/login.tsx` reads
it after sign-in and pushes the user back to where they were trying
to go. So the "deep link → forced sign-in" pattern from email alerts
or bookmarks works without dropping users at `/`.

**Why client-side, not `getServerSideProps`:** the dashboard's data
is fetched client-side via TanStack Query anyway, so SSR HTML
wouldn't carry user data. A single client-side gate at the layout
level keeps auth in one place. Server-side gates would require one
`getServerSideProps` wrapper per page — five extra files for no
incremental security since the API is already JWT-gated.

### 2. AlertBanner accessible-name spacing

**Audit finding:** Severity span and machine name span had `mr-2`
applied to the severity (visual gap) but no whitespace in the DOM,
so screen readers and the rendered button's accessible name read
`"criticalAC-L3 · …"`.

**Fix:** Inserted an explicit `{" "}` between the spans in
`alert-banner.tsx`. Visual gap unchanged; accessible name now reads
`"critical AC-L3 · …"`. Verified via `textContent` extraction in
Playwright.

## Polish landed alongside

### Theme defaults to dark

**Audit finding (#8):** `defaultTheme="system"` resolved to light on
typical OS preferences, contradicting DESIGN's "dark mode — the
default for a monitoring dashboard."

**Fix:** Flipped to `defaultTheme="dark"` in `_app.tsx`. `enableSystem`
stays on so users with explicit system preferences still flow through;
any choice via `<ThemeToggle>` persists in localStorage as before.

### Compare chart Y-axis no longer clips wide labels

**Audit finding (#10):** With `fmtNum` rendering `1,650 kW` /
`2,200 kW` on `/compare`, the leading digit clipped because YAxis
`width={48}` was tuned for short labels.

**Fix:** Bumped to `width={64}` in `area-chart.tsx`. Verified via
Playwright: all five tick labels (`0 kW` through `2,200 kW`) now
render flush at the same x-coordinate.

## Audited and confirmed already correct

- **Energy Y-axis spacing (#9)** — verified all ticks render with
  consistent spacing (`"0 kW"`, `"150 kW"`, `"300 kW"`, …). The audit
  may have caught a transient rendering state; current implementation
  is fine.
- **TanStack Query devtools in production (#11)** — already gated by
  `process.env.NODE_ENV === "development"` in `_app.tsx`. The audit
  was incorrect on this finding; the devtools button only renders in
  dev.

## Verification

End-to-end, in Playwright:

1. Signed-out navigation:
   - `GET /machines` → redirects to `/login?callbackUrl=%2Fmachines`
   - `GET /decisions` → redirects to `/login?callbackUrl=%2Fdecisions`
   - `GET /chat` → redirects to `/login?callbackUrl=%2Fchat`
2. Sign-in with `callbackUrl=/chat` → bounces directly to `/chat`
   after auth, not `/`.
3. AlertBanner rows expose accessible name `"critical AC-L3 · …"`
   and `"warning AC-L1 · …"` (space between severity and name).
4. `/compare` Y-axis ticks render `"0 kW"`, `"550 kW"`, `"1,100 kW"`,
   `"1,650 kW"`, `"2,200 kW"` — all left-aligned at consistent x.

Plus `npm run typecheck` clean.

## Items from the audit deferred to a future PR

These need a product call before I touch them — happy to take any
direction:

- **KPI composition (#3)** — current /Overview shows total / active /
  total power / today / **yesterday** / avg-temp; spec lists total /
  active / **inactive** / total power / today / avg-temp. Inactive
  count was folded into Active's hint. Worth keeping as-is or revert?
- **Compare BarChart vs overlay AreaChart (#4)** — we explicitly
  switched to overlay during PR #18 because BarChart didn't show the
  curve shape. Spec wants BarChart. Revert?
- **Decisions filter UX (#5)** — column-header popovers vs page-level
  controls. Current is more powerful but less discoverable.
- **shadcn Select / Separator primitives (#6, #7)** — DESIGN lists
  them; not currently in `components/ui/`. Can add as part of
  general primitive expansion.

Other deferred:

- **Focus ring on icon buttons (#12)** — separate a11y polish PR.
- **Unused Georgia serif font (#13)** — strip from theme since it's
  declared but never loaded or used.
