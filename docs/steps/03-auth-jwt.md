# Step 03 — JWT authentication via SimpleJWT

## What

- DRF + `djangorestframework-simplejwt` wired into Django settings as the default authentication and permission backend.
- `django-cors-headers` configured so the dev frontend (localhost:3000) and curl/REST-client tools can call the API directly.
- Two endpoints exposed: `POST /api/auth/token/` (obtain access + refresh) and `POST /api/auth/token/refresh/` (exchange refresh for new access).
- Nine pytest tests covering happy path, wrong password, unknown user, malformed payload, refresh, garbage-refresh, missing refresh, claim shape, and URL routing.
- Dev tooling: Dockerfile installs both `[project.dependencies]` and `[project.optional-dependencies.dev]` so `pytest` is available in the running container without an extra install step.

## Why

PLAN.md Phase 2. Every API endpoint that ships in Phases 3 and beyond will return 401 unless authenticated; the frontend (Phase 4) ships with NextAuth's CredentialsProvider that posts to `/api/auth/token/` server-side. Locking auth down now and proving it works lets the rest of the build assume "if the request lands in a view, the user is authenticated" without re-litigating it for every endpoint.

### Why JWT, not session cookies, for the API

Per DESIGN.md trade-off note: NextAuth stores the JWT in an httpOnly signed cookie on the browser side. The browser → Next.js → Django chain is server-to-server with the bearer attached server-side. JWT in the Authorization header is the lingua franca for stateless server-to-server traffic; session cookies would force every Django request to re-look-up the session in the DB and would break under multi-replica deployments. SimpleJWT is the canonical Django JWT library — no need to roll our own.

### Why 30 minutes / 7 days

DESIGN.md §1B: 30-minute access token + 7-day refresh. Short access window keeps the blast radius of a stolen access token small (one half-hour); the long refresh keeps users from re-authenticating every meeting. NextAuth refreshes transparently in its `jwt` callback — users never see the cycle.

### Why CORS at all (when Next.js proxies?)

Production traffic flows browser → `/api/...` → Next.js rewrite → Django, never crossing origins from the browser's perspective. CORS is purely a developer-experience affordance: lets us hit Django directly with curl, Postman, or a browser DevTools fetch from the localhost:3000 origin while debugging. Locked down to `http://localhost:3000` and `http://127.0.0.1:3000` by default, overridable via `CORS_ALLOWED_ORIGINS` env var.

## Files

| Path                                  | Change                                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/thermalos/settings.py`       | + `rest_framework`, `corsheaders` apps; + `corsheaders.middleware.CorsMiddleware` (top of MIDDLEWARE); + `REST_FRAMEWORK`, `SIMPLE_JWT`, `CORS_ALLOWED_ORIGINS` blocks; longer dev SECRET_KEY default to clear the HS256 32-byte minimum |
| `backend/thermalos/urls.py`           | + `path("api/auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair")` and the matching refresh path                                                                                                                       |
| `backend/Dockerfile`                  | Pip install now also pulls `[project.optional-dependencies.dev]` (pytest, pytest-django, ruff)                                                                                                                                           |
| `backend/.env.example`                | Updated `DJANGO_SECRET_KEY` example to match the longer dev default                                                                                                                                                                      |
| `docker-compose.yml`                  | Updated `DJANGO_SECRET_KEY` default likewise                                                                                                                                                                                             |
| `backend/building/tests/__init__.py`  | New (empty) — tests package marker                                                                                                                                                                                                       |
| `backend/building/tests/conftest.py`  | New — `api_client`, `user`, `auth_client` fixtures                                                                                                                                                                                       |
| `backend/building/tests/test_auth.py` | New — 9 tests covering all auth flows                                                                                                                                                                                                    |

## Settings shape

```python
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "UNAUTHENTICATED_USER": None,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}
```

`UNAUTHENTICATED_USER = None` means anonymous requests get `request.user = None` (instead of `AnonymousUser`). Combined with `IsAuthenticated`, every endpoint without an explicit `permission_classes` override is locked down by default — fail-closed.

## Test results (already executed)

```
$ docker compose -p thermalos-test exec backend pytest -v
building/tests/test_auth.py::test_token_obtain_with_valid_credentials_returns_access_and_refresh PASSED
building/tests/test_auth.py::test_token_obtain_with_wrong_password_returns_401             PASSED
building/tests/test_auth.py::test_token_obtain_with_unknown_user_returns_401               PASSED
building/tests/test_auth.py::test_token_obtain_with_missing_password_returns_400           PASSED
building/tests/test_auth.py::test_token_refresh_returns_new_access_token                   PASSED
building/tests/test_auth.py::test_token_refresh_with_garbage_returns_401                   PASSED
building/tests/test_auth.py::test_token_refresh_with_missing_token_returns_400             PASSED
building/tests/test_auth.py::test_access_token_carries_user_id_claim                       PASSED
building/tests/test_auth.py::test_token_endpoint_routes_are_reachable_by_name              PASSED
======================== 9 passed in 1.19s ========================
```

## Live curl checks (already executed)

```
── valid credentials ──
{ "refresh": "eyJ…", "access": "eyJ…" }

── bad password ──
HTTP 401

── refresh flow ──
{ "access": "eyJ…" }   # fresh access from a valid refresh

── CORS preflight ──
HTTP/1.1 200 OK
access-control-allow-origin: http://localhost:3000
access-control-allow-credentials: true
access-control-allow-methods: DELETE, GET, OPTIONS, PATCH, POST, PUT
```

## Notable subtleties (for future debugging)

1. **`user_id` claim is a string in JWT.** SimpleJWT (≥5.x) serialises numeric ID claims as strings inside the JWT payload. Tests cast both sides (`int(access["user_id"]) == user.id`) — comparing the raw claim with `user.id` would silently fail on type mismatch.
2. **SECRET_KEY must be ≥32 bytes for HS256.** PyJWT logs an `InsecureKeyLengthWarning` otherwise. The dev default is now 50 chars; production must override via `DJANGO_SECRET_KEY`.
3. **`docker compose restart` does not re-evaluate `${VAR:-default}`.** Env-var changes in `docker-compose.yml` need `up --force-recreate` (or full `down/up`). Burned on this when the SECRET_KEY change didn't propagate.
4. **CorsMiddleware must be near the top.** Specifically before `CommonMiddleware` so it sees responses generated by short-circuiting middleware (e.g. `APPEND_SLASH` redirects). Currently first in the list.
5. **The token endpoints intentionally have no `IsAuthenticated`.** SimpleJWT's `TokenViewBase` declares `permission_classes = ()` internally, so the global default doesn't lock out unauthenticated callers from getting their first token.

## Verify for yourself

```bash
docker compose up -d --build
docker compose exec backend python manage.py seed --clear  # if not already seeded
docker compose exec backend pytest -v

# obtain a token
ACCESS=$(curl -s -X POST http://localhost:8000/api/auth/token/ \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' | jq -r .access)

echo "$ACCESS"
```

## Next

Phase 3 — implement the eight read endpoints (`/api/machines/`, `/api/machines/{id}/sensors/`, `/api/building/summary/`, `/api/building/energy/`, `/api/building/energy/by-zone/`, `/api/decisions/`, `/api/energy/compare/`, `/api/alerts/`) using raw SQL on the hypertable. With auth gated, the natural acceptance test for each will be "401 without bearer, 200 + correct shape with bearer."
