# Step 01 — Bootstrap backend

## What

Skeleton Django 5 project + docker-compose stack (TimescaleDB + backend service). Frontend service is intentionally deferred to Phase 4.

## Why

PLAN.md Phase 0 — establish a runnable backend container talking to TimescaleDB before adding any models, auth, or endpoints. Subsequent phases (schema, auth, API) all assume `docker-compose up` brings the stack up cleanly.

## Files created

| Path                                                                          | Purpose                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`                                                          | `db` (TimescaleDB pg15) + `backend` (Django) services with healthcheck-gated dependency                       |
| `.gitignore`                                                                  | Python/Node/IDE/env exclusions                                                                                |
| `backend/Dockerfile`                                                          | python:3.12-slim image, installs project via `pip install -e .`, runs `migrate` then `runserver`              |
| `backend/.dockerignore`                                                       | Excludes venvs, caches, secrets from build context                                                            |
| `backend/.env.example`                                                        | Template for `DATABASE_URL`, `DJANGO_SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `ANTHROPIC_API_KEY`               |
| `backend/pyproject.toml`                                                      | Dependencies (django, drf, simplejwt, psycopg, dj-database-url, cors-headers, anthropic) + ruff/pytest config |
| `backend/manage.py`                                                           | Standard Django entry point                                                                                   |
| `backend/thermalos/{__init__,settings,urls,wsgi,asgi}.py`                     | Project package — minimal settings reading from env, root URLConf includes `building.urls` under `/api/`      |
| `backend/building/{__init__,apps,admin,models,views,serializers,sql,urls}.py` | App stubs (mostly empty) — `urls.py` exposes empty `urlpatterns` so `include('building.urls')` doesn't fail   |
| `backend/building/migrations/__init__.py`                                     | Migrations package                                                                                            |

## Deviations from PLAN.md

1. **Image:** used `timescale/timescaledb:latest-pg15` (vanilla) instead of `timescale/timescaledb-ha:pg15-latest`. Vanilla image has a predictable PGDATA path (`/var/lib/postgresql/data`) and a smaller footprint — fine for dev. The HA variant adds Patroni/replication tooling we don't need. Will revisit if production deployment is in scope.
2. **Env handling:** docker-compose sets `environment:` inline with `${VAR:-default}` interpolation rather than `env_file: ./backend/.env`. This means the stack runs out of the box with no `.env` file required. `.env.example` is still provided for users who want to override.

## Verify

```bash
cd /path/to/repo
docker compose up --build

# In another terminal:
curl -i http://localhost:8000/api/         # → 404 (Django alive, no /api/ routes yet)
curl -i http://localhost:8000/admin/login/ # → 200 (Django admin renders)
docker compose exec db psql -U thermalos -d thermalos -c "\dx"
# → should list 'timescaledb' extension as installed
```

Acceptance from PLAN Phase 0: `docker compose up` brings up cleanly, `curl localhost:8000/api/` returns 404. Both met when run.

## Next

Phase 1 — define `Machine`, `SensorReading`, `AIDecision` models, write the TimescaleDB hypertable migration, build the seed command.
