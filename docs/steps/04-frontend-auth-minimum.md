# Step 04 — Frontend auth (minimum Phase 4 + login page)

## What

A working Next.js (Pages Router, TypeScript) frontend wired to NextAuth's CredentialsProvider, talking to the Django `/api/auth/token/` endpoint built in Step 03. Just enough surface to prove the auth round-trip end-to-end through a real browser:

- `/login` — credentials form (admin/admin pre-filled), error message on failure.
- `/` — shows "Signed in as <user>" + a JWT access-token preview, redirects to `/login` if unauthenticated.
- NextAuth `[...nextauth].ts` with full `jwt` / `session` callbacks including proactive refresh-before-expiry.
- `next.config.js` rewrite that proxies `/api/*` to Django **except** `/api/auth/*`, which stays local.
- New `frontend` service in `docker-compose.yml` running `next dev` on port 3000.

This is intentionally not the full Phase 4 from PLAND.md — there's no TanStack Query, no Sidebar, no shadcn/ui, no theme. Those land alongside the read endpoints in subsequent steps. The goal here was to make auth visibly testable.

## Why

Auth was wired and unit-tested in Step 03, but a passing pytest run + curl probe doesn't prove the actual user flow: form → NextAuth → Django → cookie → session. With no UI, the frontend rewrite, NextAuth callbacks, and cookie security policies are all unproven assumptions.

## Files created

| Path | Purpose |
|------|---------|
| `frontend/package.json` | Pinned versions: next 14.2.18, next-auth 4.24.10, react 18.3.1, typescript 5.6.3 |
| `frontend/tsconfig.json` | Standard Next.js Pages Router tsconfig with `@/*` path alias |
| `frontend/next.config.js` | `rewrites().fallback` proxy to `${BACKEND_URL}/api/*` |
| `frontend/Dockerfile` | `node:20-alpine`, `npm install`, `npm run dev` |
| `frontend/.env.example` | `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `BACKEND_URL` |
| `frontend/.dockerignore` | Excludes `node_modules`, `.next`, `.env*` from build context |
| `frontend/next-env.d.ts` | Next.js TypeScript reference shim |
| `frontend/src/types/next-auth.d.ts` | Module augmentation: `Session.accessToken`, `Session.error`, `JWT.refreshToken` etc. |
| `frontend/src/pages/_app.tsx` | `<SessionProvider>` wrapping the app |
| `frontend/src/pages/api/auth/[...nextauth].ts` | CredentialsProvider posting to Django, JWT/session callbacks with refresh logic |
| `frontend/src/pages/login.tsx` | Credentials form with `data-testid` hooks for E2E |
| `frontend/src/pages/index.tsx` | Authenticated landing — shows user + token preview + sign-out |

## Files modified

| Path | Change |
|------|--------|
| `docker-compose.yml` | New `frontend` service depending on `backend`, `${FRONTEND_PORT:-3000}` mapping, anonymous volumes for `node_modules` + `.next` to avoid host-shadow |

## Critical bug found and fixed during verification

**Symptom:** Right after first `docker compose up`, NextAuth requests to `/api/auth/_log` and `/api/auth/error` returned 404 from Django — visible in `alto-tech-backend-1` logs.

**Root cause:** Initial `next.config.js` returned the rewrite as a plain array — Next.js treats that as `afterFiles`, which runs **before** dynamic file routes. NextAuth's `[...nextauth].ts` is a dynamic catch-all, so my `/api/:path*` proxy was beating it to the punch and shipping NextAuth's internal endpoints to Django.

**Fix:** Move the rewrite into `fallback`:

```js
return {
  fallback: [
    { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
  ],
};
```

`fallback` rewrites run after both static AND dynamic file routes. Now `/api/auth/anything` resolves to NextAuth locally, and `/api/machines/`, `/api/decisions/`, etc. (no local route) drop through to Django.

This is a precedence subtlety I'd already considered in planning but hadn't gotten right on the first try — leaving it documented here because it'll bite future developers who add new `/api/*` routes locally.

## Verification (executed via Playwright + browser_evaluate)

| Check | Result |
|-------|--------|
| `GET /login` renders the form | ✅ "Sign in · ThermalOS" |
| Submit `admin/admin` → redirect to `/` | ✅ URL changes, "Signed in as **admin**" rendered |
| Access-token preview is a 3-segment JWT | ✅ `eyJhbGciOiJI…ppYoLcZE_Yps` |
| Submit `admin/definitely-wrong` → stays on `/login` with "Invalid username or password." | ✅ |
| Sign out → redirect to `/login` | ✅ |
| `GET /api/auth/session` after sign-in returns `{user:{name:"admin"}, accessToken:"..."}` | ✅ JWT decodes to `{token_type:"access", user_id:"1", exp-iat=1800}` (= 30 min, matches Django `SIMPLE_JWT.ACCESS_TOKEN_LIFETIME`) |
| `document.cookie` from JS is empty after login | ✅ NextAuth session cookie is httpOnly — XSS-safe per DESIGN.md trade-off note |

Screenshots captured:
- `phase4-login-success.png` — landing page with admin user + access token preview
- `phase4-login-error.png` — login form with "Invalid username or password."

## Operational note: I killed the previous port-3000 process

Port 3000 was held by a `next-server (v16.2.4)` process (PID 42645, owned by you). On your direct instruction I `kill`'d it before bringing the stack up — it had no Docker container, no parent process I recognised, and you authorised it. If that was a dev server you wanted preserved, restart it on a different port; our stack now owns 3000.

## Reproduce for yourself

```bash
docker compose up -d --build       # backend, db, frontend on 8000/5432/3000
docker compose exec backend python manage.py seed --clear
open http://localhost:3000         # → /login → admin / admin → /
```

## What's left for the full Phase 4 (deferred)

- TanStack Query setup with `staleTime: 60s, retry: 1`
- shared `apiFetch` that attaches `Authorization: Bearer ${session.accessToken}` from the session
- per-endpoint hooks (`useMachines`, `useBuildingSummary`, etc.)
- Layout + Sidebar (6 nav links per DESIGN.md)
- shadcn/ui init + tweakcn green-yellow theme
- Inter / JetBrains Mono / Georgia fonts
- Shared dashboard components (`KpiCard`, `MachineCard`, `StatusBadge`, `SensorChart`, `AlertBanner`, loading/error/empty states)
- `fmtNum()` and Recharts theming util

These will come alongside Phase 3 (read endpoints) and Phase 5 (pages) — there's no point styling components against an API that doesn't exist yet.

## Next

Phase 3 — implement the eight read endpoints. With auth fully proven through the UI, the natural test for each endpoint is now:
1. `curl -H "Authorization: Bearer <expired-token>"` → 401
2. `curl -H "Authorization: Bearer <fresh-token>"` → 200 + correct shape
3. Direct call from the running frontend (via TanStack Query once we add it) → renders without errors
