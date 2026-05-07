# 12 — README + Phase 8 verification

PR #22 — `docs/readme-and-verification` → `main`

Closes out PLAN.md Phase 8: top-level README, verification gates, and
a couple of typecheck fixes uncovered while running the build.

## What landed

### `README.md`

Top-level entry point covering:

- 3-line quickstart (cp env files → `docker compose up`).
- Default login (`admin` / `admin`).
- Route map of the six pages and what lives on each.
- ASCII architecture diagram showing the rewrites split (NextAuth local,
  everything else proxied to Django).
- Tech stack reference and tooling notes.
- Manual end-to-end test plan — seven scenarios that cover every read
  endpoint and the alert refresh path.
- `ANTHROPIC_API_KEY` instructions for the chat bonus.
- Project structure and development workflow notes.

Trade-off discussion stays in DESIGN.md so the README doesn't duplicate
content that's already canonical there.

### Typecheck fixes

`npm run typecheck` was failing on two pre-existing issues that
`tsc --noEmit` flagged once we put it in the verification gate:

1. **`AreaChart<TData extends Record<string, unknown>>`** — the strict
   `unknown` constraint rejects concrete domain types (`BuildingEnergyPoint`,
   `SensorSeriesPoint`) because they don't have an index signature.
   Relaxed to `Record<string, any>` on both the `AreaChartProps` type
   and the function generic. `// eslint-disable-next-line` annotates
   the deliberate `any` so it survives a future eslint pass.

2. **`CHART_AXIS_STYLE: CSSProperties`** — Recharts' XAxis/YAxis `tick`
   prop accepts SVG text props, not React CSSProperties. The two
   nominally overlap but diverge on `alignmentBaseline` enums (CSS has
   `-moz-initial` etc., SVG doesn't). Retyped to
   `SVGProps<SVGTextElement>` in `lib/chart.ts` so the consumer
   signature matches exactly.

### Verification

- `docker compose exec backend pytest -q` → **125 passed**.
- `npm run typecheck` → clean.
- `npm run build` → clean. All 9 routes prerender static
  (only `/api/auth/[...nextauth]` is dynamic, as expected).

## Why no test-runner config in CI

The brief is a take-home assessment, not a long-running team project, so
running `pytest` and `npm run build` manually as gates is enough. If
this were to grow, a GitHub Actions workflow with the same three steps
(pytest → typecheck → build) would be the natural next addition.

## Phase 8 closeout

PLAN.md Phase 8 verification checklist is now satisfied:

- [x] `docker compose up` brings the stack up cleanly from a clean clone
- [x] `pytest -q` green
- [x] `npm run build` green; no TypeScript errors
- [x] All 11 endpoints + 7 pages render against seeded data
- [x] README documents quickstart, login, architecture, test plan
- [x] Trade-off notes referenced (DESIGN.md §"Trade-Off Notes")
- [x] Theme: green/yellow palette visible; no hardcoded hex anywhere
- [x] Pre-commit hook + format script exist and work

The plan is fully delivered.
