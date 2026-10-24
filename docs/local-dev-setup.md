# Local Development Setup

This document covers how to set up the BazarDriveCloud development environment
on non-standard platforms, specifically **Android via Termux + proot-distro (Ubuntu)**.
It records the decisions and blockers discovered during initial setup so future
contributors on similar platforms do not need to rediscover them.

---

## Platform: Termux + Ubuntu (proot-distro) on Android

[proot-distro](https://github.com/termux/proot-distro) runs a full Linux
userland (Ubuntu) inside Termux without root. It is a supported setup for
lightweight server/backend work but has kernel-level restrictions that affect
some database operations (see PostgreSQL note below).

### Prerequisites

Install inside the proot Ubuntu environment:

```bash
# Inside proot-distro Ubuntu shell
apt update && apt install -y curl git build-essential
```

---

## Node.js via nvm

The repo uses **Node 22** everywhere, managed by
[nvm](https://github.com/nvm-sh/nvm) and pinned in two `.nvmrc` files:

| Area | Node version | Source |
|------|-------------|--------|
| Root project (PWA / scripts / docs-site) | 22.x | `.nvmrc` (repo root) |
| `server/` (Fastify backend) | 22.x | `server/.nvmrc` |

### Installing nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Restart shell, then:
nvm install 22
```

### Switching versions

```bash
# In repo root
nvm use          # picks up root .nvmrc → Node 22

# In server/
cd server
nvm use          # picks up server/.nvmrc → Node 22
npm ci
```

---

## PWA / Root project

```bash
# In repo root (Node 22)
node scripts/check.mjs
node scripts/dispatcher.mjs
```

No separate `npm install` is needed at the root — the PWA is a static app with
no build step. Scripts run directly with Node.

---

## docs-site (Docusaurus)

```bash
cd docs-site
npm ci           # Node 22 (root .nvmrc)
npm run check    # validate frontmatter, registry, navigation
npm run build    # confirmed working
```

**Known non-blocking issue — `npm audit`**: 18 moderate vulnerabilities in the
`webpack-dev-server` → `uuid` chain (dev-only tooling). No upstream fix is
available yet; `npm audit --omit=dev --audit-level=high` passes clean.

---

## server/ (Fastify + PostgreSQL backend)

```bash
cd server
nvm use          # Node 22
npm ci
```

### Database: Supabase instead of local PostgreSQL

**Why Supabase and not local `pg` in proot?**

`initdb` (PostgreSQL cluster initialisation) requires `shmget` / POSIX shared
memory, which the proot kernel shim does not expose. Attempting to run a local
Postgres cluster inside proot-distro Ubuntu fails at `initdb` with a shared
memory error and cannot be worked around without root.

**Solution**: use [Supabase](https://supabase.com) free tier as the development
database over its **Session pooler** (IPv4-compatible) connection string.

Steps:
1. Create a free project on supabase.com.
2. In *Project Settings → Database → Connection string*, choose
   **Session pooler** (port 5432, IPv4) — this avoids IPv6-only issues on
   mobile networks.
3. Copy the connection string and create `server/.env`:

```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

4. Run migrations:

```bash
npm run migrate   # applies all migrations from server/migrations/
```

5. Start the dev server:

```bash
npm run dev
```

Expected output:

```
Server listening at http://127.0.0.1:3000
```

### `psql` CLI note

`psql` parses connection strings differently from Node's `pg` driver and may
fail with a password/URL error when invoked directly on the shell. This does
**not** affect `npm run migrate` or `npm run dev` — both use the `.env` URL
through Node directly. The CLI quirk is not a blocker.

### Known non-blocking warnings

| Warning | Severity | Action |
|---------|----------|--------|
| `FastifyDeprecation: disableRequestLogging option is deprecated` | Info | Can be cleaned up in Fastify config later; does not affect runtime. |
| `ALLOWED_ORIGIN unset — CORS disabled (same-origin only)` | Info | Normal for local dev. Set `ALLOWED_ORIGIN` in `.env` when deploying. |

---

## Quick-start summary (Termux / Android)

```bash
# 1. Enter proot Ubuntu
proot-distro login ubuntu

# 2. Root project checks (Node 22)
nvm use
node scripts/check.mjs

# 3. docs-site (Node 22)
cd docs-site && npm ci && npm run build && cd ..

# 4. Backend (Node 22)
cd server && nvm use && npm ci && npm run migrate && npm run dev
```

---

## Local backend-ON stand (PC): passenger + driver clients

`scripts/dev-stand.mjs` runs the real PWA against the local `/server` with one
command. It is a dev-only tool: it does not change `public/`, the CSP, the
service worker or `/server`, and it is not part of `node scripts/check.mjs`.

Prerequisites: `server/.env` with a working `DATABASE_URL` (migrations applied
via `npm run migrate`), `REDIS_URL` **unset** (Phase 1 refuses to boot with
it), and `npm ci` done in `server/`.

```bash
# In repo root (Node 22)
node scripts/dev-stand.mjs
# options: --api-port 3000 --passenger-port 8080 --driver-port 8081
#          --no-server   (reuse a /server you already started on --api-port)
```

It starts `/server` and two client origins, all on `127.0.0.1` only (the
server child is forced to `HOST=127.0.0.1`, whatever `server/.env` says).
Ctrl+C stops everything; if the server exits, the stand stops too.

| Client | URL |
|---|---|
| Passenger | `http://127.0.0.1:8080/` |
| Driver | `http://127.0.0.1:8081/#/welcome?smokeRole=driver` |

How it works: each client serves `public/` and injects
`<meta name="bd-api-base" content="<request origin>">` into `index.html` (the
switch read by `public/src/api_config.js`), and proxies `/api/*` to the server.
The API is same-origin, so CSP `connect-src 'self'` and an empty
`ALLOWED_ORIGIN` need no change. The two roles use **separate origins** because
the auth token lives in `localStorage` (one per origin): on a single origin
the passenger and the driver would share one session.

Notes:

- `smokeRole` is read from the query **inside the hash**
  (`#/welcome?smokeRole=driver`), not from `?smokeRole=` before the `#`. It is
  a per-tab view override; the role is still chosen in onboarding.
- With the backend ON, gated routes (`/map`, `/driver-map`, …) send you to
  `/onboarding` until a real OTP login. With `OTP_DEV_MODE=true` the code is
  not sent anywhere: it comes back as `devCode` in the
  `POST /api/v1/auth/otp/request` response (DevTools → Network).
- The committed Mapbox token is URL-restricted to `iprus2026-tech.github.io`,
  so expect the map to fail on `127.0.0.1` and on tunnel hosts; flows do not
  depend on it.

### Phone test via cloudflared

1. Install cloudflared, e.g. `winget install --id Cloudflare.cloudflared`.
2. Start the stand, then one quick tunnel per role (separate origins again):

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8080   # passenger
   cloudflared tunnel --url http://127.0.0.1:8081   # driver
   ```

3. On the phone open the printed `https://<random>.trycloudflare.com/` URL
   (passenger) and `https://<other>.trycloudflare.com/#/welcome?smokeRole=driver`
   (driver). The stand derives the API base from `X-Forwarded-Proto` /
   `Cf-Visitor` and the forwarded host, so it stays `https` and same-origin.
4. A quick-tunnel URL changes on every restart: that is a new origin, so the
   session, `localStorage` and service worker start from scratch.

> **Warning — `OTP_DEV_MODE`.** With `OTP_DEV_MODE=true` the server echoes
> every OTP code in the API response, so **anyone who has the tunnel URL can
> log in as any phone number**. Keep tunnels short-lived, use synthetic test
> numbers only, and stop `cloudflared` as soon as the test is over. Never run
> dev mode on a reachable server outside such a test.

---

## Follow-up / known gaps

- Switch to a local Postgres instance (e.g. on a PC) if shared memory is
  available — replace `DATABASE_URL` in `server/.env` and re-run migrations.
- Test `docs-site` dev server (`npm run start`) — not yet verified on Termux.
- Set `ALLOWED_ORIGIN` in `server/.env` before any networked deployment.
