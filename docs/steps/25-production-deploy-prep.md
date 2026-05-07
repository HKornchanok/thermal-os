# Step 25 — Production deploy prep

The dev `docker-compose.yml` runs `runserver` and `next dev`. Neither is
appropriate for an exposed deployment. This step adds parallel
production variants without touching the dev workflow.

## What changed

### Backend

- `backend/Dockerfile.prod` — gunicorn (3 workers, configurable via
  `GUNICORN_WORKERS`), build-time `collectstatic`, runtime `migrate`.
- `backend/pyproject.toml` — added `whitenoise` to base deps (middleware
  loads at import time), added `gunicorn` to `optional-dependencies.prod`.
- `backend/thermalos/settings.py` —
  - `WhiteNoiseMiddleware` after `SecurityMiddleware`.
  - `STATIC_ROOT = BASE_DIR / "staticfiles"`, auto-mkdir so dev tests
    don't warn.
  - `CompressedManifestStaticFilesStorage` only when `DEBUG=False` —
    manifest storage requires post-collectstatic assets, which dev
    doesn't have.

### Frontend

- `frontend/Dockerfile.prod` — three-stage (deps → builder → runner)
  using Next.js standalone output. Final image runs as non-root
  `nextjs:nodejs` and ships only `server.js` + minimal `node_modules`
  (~150 MB instead of ~1 GB).
- `frontend/next.config.js` — added `output: "standalone"`.

### Compose / config

- `docker-compose.prod.yml` — separate file consumed via
  `docker compose -f docker-compose.prod.yml --env-file .env.prod up`.
  All required env vars use `${VAR:?…}` so the stack refuses to boot
  without them. Backend port is `expose`d only (no `ports:`); the
  frontend is the sole public surface and proxies `/api/*` to backend.
- `.env.prod.example` — template covering `DJANGO_SECRET_KEY`,
  `ALLOWED_HOSTS` (incl. the `backend` internal hostname gotcha),
  `CORS_ALLOWED_ORIGINS`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
  `POSTGRES_PASSWORD`, with generation hints.

## Why a separate Dockerfile and compose file

Two reasons:

1. The dev image installs `pytest`/`ruff`; the prod image deliberately
   does not. Mixing both in one `Dockerfile` means either prod ships
   test deps (bigger surface) or dev tests can't be run (`pytest` not
   on `PATH`). Cleanest split is two Dockerfiles.
2. The dev compose has hot-reload bind mounts; prod must not. Separate
   files keep the intent explicit.

The image-name collision (both compose files default to
`thermalos-backend:latest`) is a known wrinkle — switching between
dev and prod requires a `docker compose build` to re-tag.

## ALLOWED_HOSTS gotcha

In prod compose the frontend reaches the backend via
`http://backend:8000`. That request's `Host` header is `backend:8000`,
so Django's `ALLOWED_HOSTS` must include `backend` in addition to
public hostnames. Documented in `.env.prod.example`.

## Verification

Built and ran the prod stack against a real env file:

- `docker compose -f docker-compose.prod.yml --env-file .env.prod.test build` — clean
- `up -d` — db healthy, gunicorn boots with 2 workers (test value),
  migrations applied
- `seed --clear` — 24,192 readings, 42 decisions, 12 machines
- JWT login via internal `http://backend:8000/api/auth/token/` — 231-char access token returned
- `/api/machines/`, `/api/building/summary/`, `/api/alerts/`,
  `/api/decisions/?page=1&page_size=3` — all 200 with bearer
- `/static/admin/css/base.css` and `/admin/login/` — both 200,
  confirming WhiteNoise serves collected static under `DEBUG=False`
- `pytest -q` (dev image) — **125 passed**, 1 warning (unchanged)

## What this is _not_

This is the self-host / VPS shape. Real production should still:

- Push the backend image to Fly / Railway / Cloud Run; frontend to Vercel
- Use managed Postgres with the Timescale extension (Timescale Cloud)
- Terminate TLS at the platform edge
- Add structured logging, a `/health` endpoint, rate-limit `/api/auth/token/`,
  and PgBouncer once load justifies it

`README.md` already lists these in the "What I'd improve with more
time" section.
