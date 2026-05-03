# 11 — Prettier + pre-commit hook

PR #21 — `chore/prettier-setup` → `main`

## Goal

Add Prettier as the single source of formatting truth for the frontend
and wire it to a Husky-managed pre-commit hook so formatting is
enforced automatically — no human ever has to remember to run it.

## What landed

### Tooling

- `frontend/devDependencies`:
  - `prettier@^3.8`
  - `prettier-plugin-tailwindcss` — sorts Tailwind class lists
    canonically; without it, the same component can drift across PRs
    just because two contributors wrote classes in different orders.
  - `husky@^9` — manages `.husky/` hook scripts (committed) and wires
    `core.hooksPath` via the `prepare` lifecycle script.
  - `lint-staged@^16` — runs prettier only against the files staged
    for this commit, not the whole tree.
- `frontend/scripts`:
  - `format` → `prettier --write .`
  - `format:check` → `prettier --check .` (CI-friendly exit code)
  - `prepare` → `cd .. && husky frontend/.husky` — installs hooks
    after `npm install`. The `cd ..` is the bridge between npm running
    in `frontend/` and git living at the repo root: husky needs to
    register `core.hooksPath` against the git work tree, and we want
    the hook scripts colocated with the package that owns prettier.

### Configuration

- `frontend/.prettierrc.json` — semicolons on, double quotes,
  `trailingComma: es5`, 80-col print width, 2-space tabs, plus the
  Tailwind plugin in `plugins`. Boring choices on purpose; the
  cheapest defaults end debate fastest.
- `frontend/.prettierignore` — `node_modules`, `.next`, build outputs,
  `package-lock.json` (npm owns its formatting), husky internals
  (`.husky/_`), and `public/favicon.svg` (hand-authored SVG paths
  shouldn't be reflowed).
- `lint-staged` config in `frontend/package.json`:
  ```json
  "*.{ts,tsx,js,jsx,json,css,md}": "prettier --write"
  ```
  Globs are resolved relative to the directory lint-staged runs in
  (frontend/). Prettier picks up `.prettierrc.json` from the same
  directory.

### Hook script — `frontend/.husky/pre-commit`

```sh
#!/usr/bin/env sh
cd frontend && npx lint-staged
```

The hook runs from the git repo root (husky's default), and `cd
frontend &&` shifts into the package that owns prettier. lint-staged
then sees only the files in the current commit, formats them in
place, and re-stages the result — so the commit you create matches
the commit reviewers see, and "prettier-only diffs" never appear in
later PRs.

### .gitignore

Added `.husky/_/` — these are husky's auto-generated bootstrap
scripts (one per hook type). The user-authored hooks (e.g.
`frontend/.husky/pre-commit`) ARE committed; only the internals are
ignored so they regenerate fresh on each `npm install`.

## Format pass (separate commit)

The setup commit is touch-only — config + hook + scripts. A separate
follow-up commit runs `npm run format` across the entire frontend so
the format churn is reviewable in isolation:

- 30+ files reformatted (mostly whitespace, line breaks, class-attr
  ordering from the Tailwind plugin)
- All routes still return 200 after hot-reload
- No semantic changes — `git diff -w` shows only whitespace-class
  reordering

Splitting setup from format makes a future bisect cheap: if
something regresses, the format-pass commit is one revert away.

## Verification

- `npx prettier --write .` — exit 0, files reformatted.
- Direct hook test:
  ```sh
  echo 'const   x = "ugly"   ;' > frontend/src/test.tsx
  git add frontend/src/test.tsx
  bash frontend/.husky/pre-commit
  cat frontend/src/test.tsx  # → const x = "ugly";
  ```
  Pass: lint-staged backs up, formats, and re-stages.
- Visual smoke after format pass: every route compiles and renders
  correctly.

## How a contributor enables hooks on a fresh clone

```sh
cd frontend && npm install
```

The `prepare` script auto-runs and registers the hook. No extra
steps. CI environments can opt out by setting `HUSKY=0` in the
environment before `npm install` (husky honours that).

## Why husky instead of a plain git hook

`.git/hooks/` lives outside version control. A plain pre-commit
script in there would drift between contributors — first time someone
clones fresh, no hook. Husky commits the hook scripts to `.husky/`
and points git's `core.hooksPath` to them on `npm install`.
