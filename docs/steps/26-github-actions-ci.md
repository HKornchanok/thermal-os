# Step 26 — GitHub Actions CI

Adds `.github/workflows/ci.yml`. Two parallel jobs on every push to
`main` and every pull request:

- **backend**: ruff lint + pytest against a Timescale Postgres service container
- **frontend**: prettier check + tsc typecheck + Next.js build

`concurrency` group cancels superseded runs on the same branch.

## Backend prep

Ruff was wired into `pyproject.toml` from the start but had never been
run. First `ruff check .` reported 57 violations:

- 45 auto-fixable (import sort, `Optional[X] → X | None`, `timezone.utc → UTC`,
  unused imports, deprecated `from typing` aliases) — applied via `--fix`
- 2 manual fixes:
  - `summary_resp` unused-variable in `test_building_energy.py` — removed
  - `zip(columns, row)` without `strict=` in `dictfetchall` — added
    `strict=True` (cursor description and row are guaranteed to match;
    the explicit flag catches future bugs if that invariant breaks)
- 15 E501 line-too-long in `seed.py` — these are the column-aligned
  `MACHINES` and `AI_SCHEDULE` literal tables where readability beats
  the 100-char limit. Suppressed via `[tool.ruff.lint.per-file-ignores]`
  rather than mangling the layout.

Net diff: 9 backend files touched for ruff cleanup, 0 behavioural changes.
`pytest -q` still **125 passed**.

## Frontend prep

Already clean: `prettier --check` passes, `tsc --noEmit` passes,
`next build` produces 9 routes. No code changes needed.

## CI design notes

- **`pip cache-dependency-path: backend/pyproject.toml`** — keeps the
  pip cache keyed on the lockfile-equivalent. Cache invalidates exactly
  when deps actually change.
- **`npm ci --ignore-scripts`** — needed because `package.json`'s
  `prepare` script invokes husky for git hook installation, which
  expects a working tree layout CI doesn't have. Lifecycle scripts
  aren't required for `npm run build`.
- **`DJANGO_SECRET_KEY: ci-not-a-real-secret-tests-only-${{ github.run_id }}`**
  — varies per run so it can't be confused with a real secret in logs,
  and `DEBUG: "true"` keeps the production-startup guard in `settings.py`
  from blocking CI.
- **Service container vs docker compose** — used the GitHub Actions
  `services:` shorthand instead of starting compose. Lighter and the
  Timescale image is the same one the dev compose uses.
- **No frontend lint job** — `next lint` isn't wired into
  `package.json` scripts; `tsc + build` already catches the
  consequential issues. Can add later.

## Verification

Ran the full CI pipeline locally (against the dev compose containers):

- `ruff check .` → All checks passed
- `pytest -q` → 125 passed, 1 warning
- `npm run format:check` → All matched files use Prettier code style
- `npm run typecheck` → clean
- `npm run build` → 9 routes generated

CI badge added to `README.md`. First green run on `main` activates it.
