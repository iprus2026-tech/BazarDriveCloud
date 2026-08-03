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

The repo uses **two different Node versions** managed by
[nvm](https://github.com/nvm-sh/nvm):

| Area | Node version | Source |
|------|-------------|--------|
| Root project (PWA / scripts) | 20.x | `.nvmrc` (repo root) |
| `server/` (Fastify backend) | 22.x | `server/.nvmrc` |

### Installing nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# Restart shell, then:
nvm install 20
nvm install 22
```

### Switching versions

```bash
# In repo root
nvm use          # picks up root .nvmrc → Node 20

# In server/
cd server
nvm use          # picks up server/.nvmrc → Node 22
npm ci
```

---

## PWA / Root project

```bash
# In repo root (Node 20)
node scripts/check.mjs
node scripts/dispatcher.mjs
```

No separate `npm install` is needed at the root — the PWA is a static app with
no build step. Scripts run directly with Node.

---

## docs-site (Docusaurus)

```bash
cd docs-site
npm ci           # Node 20 is fine here
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

# 2. Root project checks (Node 20)
nvm use
node scripts/check.mjs

# 3. docs-site (Node 20)
cd docs-site && npm ci && npm run build && cd ..

# 4. Backend (Node 22)
cd server && nvm use && npm ci && npm run migrate && npm run dev
```

---

## Follow-up / known gaps

- Switch to a local Postgres instance (e.g. on a PC) if shared memory is
  available — replace `DATABASE_URL` in `server/.env` and re-run migrations.
- Test `docs-site` dev server (`npm run start`) — not yet verified on Termux.
- Set `ALLOWED_ORIGIN` in `server/.env` before any networked deployment.
