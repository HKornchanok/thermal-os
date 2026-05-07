# Step 24 — Backend comment cleanup

Same treatment the frontend got in step 22 (PR #41), now applied to the
backend. Comments that restated the code, narrated section banners, or
duplicated the docstring were removed; WHY-comments that explain
non-obvious decisions (Bangkok TZ anchoring, the day-plan/decision
parity contract, the engineered-alerts trick, the ALERT_NONSTOP
false-positive history) were kept and compacted.

## Density before → after (comment lines / total)

| File                          | Before | After |
| ----------------------------- | -----: | ----: |
| `views/alerts.py`             |   ~11% |  4.5% |
| `views/building.py`           |   7.0% |  4.2% |
| `views/chat.py`               |  12.6% |  6.2% |
| `views/decisions.py`          |   6.8% |  2.6% |
| `views/energy_compare.py`     |   9.8% |  8.3% |
| `views/machines.py`           |   8.8% |  7.1% |
| `sql.py`                      |  35.5% | 24.9% |
| `utils.py`                    |  19.7% | 13.9% |
| `thermalos/settings.py`       |   7.5% |  2.9% |
| `management/commands/seed.py` |  23.0% | 11.6% |

`sql.py` stays denser than the rest by design — each constant carries a
one-line `/api/...` purpose tag so view files stay readable.

## What was kept

- WHY behind narrative choices (manual vs AI period split, day-plan
  alignment with decisions, engineered alerts to demo the banner).
- Bug-fix history that explains a guard's existence (ALERT_NONSTOP
  fallback regression, summary undercount, RNG state leak).
- API contracts in view docstrings — params, return shapes, error codes
  — so endpoints remain self-documenting without DESIGN.md context.

## What was removed

- Section-banner blocks (`# --- 80 chars ---`) with multi-line prose
  about what came next.
- Restatements of what the code does (`# Smart defaults — last 24 hours`
  next to a `resolve_window(...)` call).
- Duplicated explanations between docstring and inline comment.
- Comments referencing this PR or a "previous version" of the code.

## Verification

- `pytest -q` → **125 passed** (same as pre-cleanup).
- No behaviour changes — comment-only delta.
