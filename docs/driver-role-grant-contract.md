# BD-AUTH-POLICY-01A — Driver role grant, active-role switch and passenger gates contract

Status: contract-only; the target obligations below are not shipped runtime behaviour.

Gate: `BD-AUTH-POLICY-01A` (this contract) → runtime slices `01B-A` (driver enrollment), `01B-B` (active-role switch), `01C` (client login, enrollment and switch), `01B-C` (passenger gates).

Issues:
- #830 (BD-AUTH-POLICY-01), epic #585;
- D1 #1042 (driver role cannot be obtained) and D3 #1044 (a role-rejected login leaves a stuck state);
- D2 #1043 (welcome ↔ onboarding loop) is fixed separately by #1072.

Related:
- #829 — session lifecycle, including the **B2-C account switch A → B**, which is a different scenario (see "Terms");
- #1041 — the backend-ON E2E journal;
- [first-login authority contract](first-login-authority-contract.md) (#999);
- [ride state & receipt authority contract](ride-state-receipt-authority-contract.md) (#1063).

Layers: Backend API / DB / Ops tooling / PWA / Server tests / Smoke / Docs.

Audited baseline: [`main@cca2a19`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/cca2a19042df13cbb6dda730dd2d140a945d202f).

## Scope and authority

The first-login contract leaves role grants to #830: "Only #830's server policy grants roles and accepts a session role choice. A grant request/enrollment decision is separate from choosing an existing role." This contract fills those gaps:

1. who grants the driver role, and how (§1);
2. how one account switches its active role between passenger and driver (§2);
3. how the client handles a login whose chosen role is not the session's active role (§3, resolving D3);
4. which passenger mutations require the passenger role (§4).

It does **not** decide:
- driver line readiness (documents, shift, vehicle — `DRIVER_LINE_READY`);
- an admin console or an HTTP decision route;
- the B2-C account switch (#829);
- Telegram login;
- chat authorization;
- token rotation or TTL.

These are listed under "Deferred".

This new legacy document stays outside the document registry in this slice: registration is a separate scope, and the repository treats `UNACCOUNTED_DOCUMENT` as warn-only.

## Terms

| Term | Meaning |
|---|---|
| Grant | A role in the account's `users.roles` (`passenger`, `driver`). Only server policy changes it. |
| Active role | The current session's `auth_session.active_role`. It must be one of the account's current grants. |
| Driver enrollment | A driver's application for the driver grant, plus the decision on it. `APPROVED` = `DRIVER_REGISTERED` in first-login terms. |
| Line readiness | Documents, shift and vehicle eligibility (`DRIVER_LINE_READY`). **Not** granted by enrollment. |
| Active-role switch (§2) | One account, two grants: the same person switches passenger ↔ driver. |
| Account switch (B2-C, #829) | A *different* account B logs in within the same tab, replacing session A. Out of scope here. |

## Audited implementation at the baseline

| Surface | Shipped behaviour | Gap closed by this contract |
|---|---|---|
| Account creation (`server/src/repositories/users.js:69-79`) | A new OTP-verified account gets `roles=['passenger']`, `active_role='passenger'` (#1017). An existing account keeps its grants. | No product path to the driver grant; the E2E used manual SQL. |
| OTP verify (`server/src/services/auth/index.js:181-191`) | Body is `{phone, code}` only (`additionalProperties:false`); the response carries `roles` and `activeRole`. | — (unchanged: the client never sends roles) |
| Session role (`auth/index.js:33-37`, `repositories/sessions.js:36-54`) | `auth_session.active_role` is written once, at mint, from `users.active_role` when granted. Nothing updates it. `GET /auth/session` omits `roles`. | No way to change the active role. |
| Authority core (`server/src/services/auth/authority.js`) | `resolveActorAuthority` reads **current** `users.roles` on every call. `requireDriverActor` is live on offers (#1064). `requirePassengerActor` has no caller. | Passenger mutations are not role-gated. |
| `POST /orders`, `GET /matching/offers`, `POST /matching/select` | Live session plus owner checks only. `select` does not re-check the selected driver's current grant. | Wrong-role mutations are accepted. |
| Admin / staff | No admin role, table, env var or header. The only near match is the dark merchant `membership_role` (0009). | Who decides a driver application. |
| Readiness tables (0005–0007) | Present but dark: no live code reads them. | Out of scope (line readiness). |
| `OTP_DEV_MODE` (`server/src/config.js:45`, `:113-115`) | Forbidden when `NODE_ENV=production`; its only effect is `devCode`. | The pattern for a stand-only switch. |
| Client login (`public/src/auth_session_bootstrap.js:113-197`, `screens/onboarding.js:618-691`) | The bearer is installed even when the chosen role is not confirmed. «Сервер не подтвердил выбранную роль.» is shown, and «Повторить» repeats the same rejection. A re-requested code overwrites the bearer without revoking it. | D3. |
| Client role switch (`screens/profile.js` `#pfp-role-switch`, `#pf2-act-role-switch`) | Writes only the per-tab `smokeRole`; never calls the server. | No server role switch. |

## 1. Driver enrollment and grant — `01B-A`

### Data (migration `0010_driver_enrollments`)

`driver_enrollments` holds one row per application:

| Column | Type | Rule |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `user_id` | UUID NOT NULL | FK `users(id)` ON DELETE CASCADE |
| `status` | TEXT NOT NULL | `PENDING`, `APPROVED`, `REJECTED`, `REVOKED` |
| `requested_at` | TIMESTAMPTZ NOT NULL | `now()` |
| `decided_at` | TIMESTAMPTZ NULL | set by every decision; NULL exactly while `PENDING` (CHECK) |
| `decided_by` | TEXT NULL | non-PII actor label of the decision, e.g. `ops-cli:<operator>` or `auto-approve`; NULL while `PENDING` |
| `decision_reason` | TEXT NULL | optional, ≤ 500 chars |
| `created_at`, `updated_at` | TIMESTAMPTZ | the existing `set_updated_at()` trigger |

- At most one **open** row per account: a partial unique index on `(user_id) WHERE status IN ('PENDING', 'APPROVED')`.
- `REJECTED` and `REVOKED` rows are kept as history.
- The migration only creates the table. It neither backfills nor grants anyone (accounts granted by SQL before `01B-A` keep their grant without a row).

### HTTP — the applicant

| Route | Rule |
|---|---|
| `POST /api/v1/drivers/enrollment` | Empty body (`additionalProperties:false`). Requires a live session and a verified phone, any active role (a roleless account may apply). |
| `GET /api/v1/drivers/enrollment` | The caller's latest application, or `null`. |

Both routes respond `{ enrollment: { status, requestedAt, decidedAt } | null, roles }`. No `decided_by` or reason is exposed to the applicant.

`POST` outcomes, in order:
1. The account already holds the driver grant → `200`. No new row; `enrollment` is the latest row, or `null` for a grant made before this slice.
2. A `PENDING` row exists → `200` with that row (idempotent).
3. Otherwise a new `PENDING` row → `201`. With auto-approve (below) it is `APPROVED` in the same transaction, and the grant is added.

A new application is allowed after `REJECTED` or `REVOKED`; it becomes a new row.

Errors:
- `401 UNAUTHENTICATED`;
- `403 PHONE_NOT_VERIFIED`;
- `503 AUTHORITY_LOOKUP_FAILED` (retryable).

The routes read and write nothing the client supplies beyond the session.

### Decisions — a transport-agnostic module and the `ops:driver` command

A decision changes the application row and the grant **in one transaction**:

| Decision | From → to | Grant effect |
|---|---|---|
| `approve` | `PENDING` → `APPROVED` | add `driver` to `users.roles` |
| `reject` | `PENDING` → `REJECTED` | none |
| `revoke` | `APPROVED` → `REVOKED`; or, for a grant made before this slice, a new `REVOKED` row | remove `driver` from `users.roles`. If `users.active_role = 'driver'`, it becomes `'passenger'` when that grant exists, else NULL. Every live session of the account with `active_role = 'driver'` gets the same fallback. |

- A decision from any other state is refused with a structured code (`NO_PENDING_APPLICATION`, `NOT_APPROVED`, …), and nothing is written.
- Repeating the same decision is a no-op that returns the current state.
- **Reuse requirement.** The logic lives in a module with no transport dependency: `decideDriverEnrollment(db, { target, decision, decidedBy, reason })`, where `target` is `{ phone }` or `{ userId }`. It returns a structured `{ ok, code, enrollment, roles }` result, never prints, and never exits.
- **CLI adapter.** `server/scripts/ops-driver.mjs` is only an adapter, run as `npm run ops:driver -- <list|approve|reject|revoke> <phone|userId> [--reason …] [--by …]`. It:
  - parses arguments;
  - opens a DB pool from `DATABASE_URL`;
  - calls the module and prints the result;
  - exits non-zero when `ok` is false.

  A later Telegram bot or an admin HTTP route calls the same module with its own `decidedBy` label. Neither is designed here.
- **Logging.** The command prints the target's user id and the masked phone (`+7 900 ***-10-04`), never a token.

### Auto-approve for the local stand

- `DRIVER_ENROLLMENT_AUTO_APPROVE` is a plain boolean, unset = `false`.
- `NODE_ENV=production` with `true` makes `loadConfig` throw `Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: true is forbidden when NODE_ENV=production`, mirroring `OTP_DEV_MODE`.
- When `true`, `POST /drivers/enrollment` approves in the same transaction with `decided_by = 'auto-approve'`.
- It is documented in `server/README.md`, `server/.env.example` and the stand guide (`docs/local-dev-setup.md`, #1040).

### Grant is not readiness

`APPROVED` means the account may *act as* a driver; it is not line readiness.

- Until the readiness slice of #830, a driver offer keeps requiring only a granted, active driver role (#1064).
- The #830 acceptance item "a driver offer requires … minimum readiness" stays open.

## 2. Active-role switch — `01B-B`

`PUT /api/v1/auth/session/active-role`, body `{ activeRole: 'passenger' | 'driver' }` (`additionalProperties:false`).

Rules:
- **Preconditions.** A live session, a resolved account, a verified phone, and `activeRole` ∈ the account's **current** `users.roles`.
- **One transaction** updates:
  - the **current session's** `auth_session.active_role` (`revoked_at IS NULL`);
  - `users.active_role`, which seeds the next login.
- **Other sessions keep their own active role.** There is no token rotation (#829).
- **Idempotent.** The same role → `200`, no write.
- **Response:** `{ user: { userId, sessionId, activeRole, phoneVerified, roles } }`.
- **Errors:**
  - `400 VALIDATION` (unknown role);
  - `401 UNAUTHENTICATED`;
  - `403 ROLE_NOT_GRANTED`;
  - `403 PHONE_NOT_VERIFIED`;
  - `503` (retryable).
- `GET /api/v1/auth/session` gains `roles`, the account's current grants. This is an additive DTO field.
- **A revoked grant blocks immediately.** The authority core reads current grants, so it denies `ACTIVE_ROLE_NOT_GRANTED` even while an older session row still says `driver`. `revoke` (§1) also resets those rows.
- **Ride state is unaffected:** it uses ride participation, not the session role (BD-RIDE-AUTHORITY-01A). Locking a switch during an active ride is deferred.

### Same-account session replacement at verify

A new OTP verify in a tab that already holds a bearer for the **same** account replaces that bearer, e.g. a re-requested code after a role rejection (§3). The replaced session must not stay live, and the guarantee is server-side and atomic. No separate client cleanup request is relied on.

- **What the client sends.** `POST /api/v1/auth/otp/verify` carries the tab's current bearer as `Authorization`. The client transport already attaches the installed bearer.
- **What the server does.** In the **same transaction** that consumes the OTP and mints the new session, it revokes the presented session. This applies only when that session is live and belongs to the account being verified.
- **Another account's bearer** is left untouched: replacing a different account is the B2-C account switch (#829).
- **A missing, revoked or expired presented session** is ignored. Verify behaves as today.
- **No partial success.** If the lookup or revocation of the presented session fails, verify fails with `503` (retryable) and mints no session. A successful verify therefore guarantees that the replaced same-account session is revoked.
- This is part of `01B-B`.

## 3. Client — `01C` (resolves D3 #1044)

**Login with a chosen role.** The client still never sends a role at OTP. After verify it compares the chosen role with the response:

| Response | Client behaviour |
|---|---|
| chosen ∈ `roles` and `activeRole` = chosen | As today. |
| chosen ∈ `roles` and `activeRole` ≠ chosen | Calls §2 for the chosen role, then continues the normal finish. On failure it shows a retryable error. The identity stays installed: no new OTP is needed. |
| chosen ∉ `roles` | The identity **stays installed** (`AUTHENTICATED`). A defined state «Вход выполнен. Роль водителя пока не выдана.» offers three actions. |

The three actions of that state:
- **«Подать заявку водителя».** Calls §1 and shows the application status.
  - `APPROVED`, including auto-approve: switch (§2) and continue.
  - `PENDING`: stay on the status view, with refresh / continue as passenger / log out.
- **«Продолжить как пассажир».** Only when `passenger` ∈ `roles`: switch (§2) and run the normal passenger finish.
- **«Выйти».** The existing server-first onboarding detach (#1027).

«Повторить» no longer repeats the same rejection.

**A replaced bearer is revoked by the server.** When a re-requested code is verified in a tab that holds a bearer for the same account, the verify request carries that bearer. The server revokes it in the same transaction as the new session (§2, "Same-account session replacement at verify"). The client installs the new bearer only after a successful verify, and a failed verify leaves the old bearer in place. A replaced session is never left live by a successful login.

**Profile role switch.** Applies to `#pfp-role-switch` and `#pf2-act-role-switch`.
- Backend-ON:
  - the control calls §2 and updates the local projection only on success;
  - it is offered only when the target role ∈ `roles`;
  - for a driver target without the grant, it opens the enrollment status instead.
- Backend-OFF: unchanged (`smokeRole`).

**Roles are a cache.** The client reads `roles` from the session DTO as cache only; a local value never grants anything. D2 (#1043) is already fixed at the guard level (#1072).

## 4. Passenger gates — `01B-C`

- **Gated routes.** `requirePassengerActor(await resolveActorAuthority(client, viewer))` runs on `POST /api/v1/orders`, `GET /api/v1/matching/offers` and `POST /api/v1/matching/select`. It runs inside the existing transaction where there is one, and before any order lookup, the same pattern as offers (#1064).
- **Denial mapping:**
  - `AUTHORITY_LOOKUP_FAILED` → `503` (retryable);
  - the unauthenticated family → `401 UNAUTHENTICATED`;
  - every other denial → `403 PASSENGER_ROLE_REQUIRED`.
- **Owner and self checks stay unchanged.**
- **`select` re-checks the driver.** The selected offer's driver must still hold the driver grant; otherwise `409 DRIVER_NOT_ELIGIBLE`, and nothing is written.
- **Release dependency.** `01B-C` ships **after** `01B-B` and `01C`. Before that, a dual-role account whose session is in driver mode could not reach its own orders.
- **Unchanged:** ride-state writes and receipts stay participation-based (BD-RIDE-AUTHORITY-01A). A session-role cross-check there is deferred.

## Acceptance and test plan

### `01B-A` — enrollment (#1042)

- A new OTP account applies:
  - `201 PENDING`;
  - a repeat returns `200` with the same row;
  - `GET` returns it;
  - an offer from that account still answers `403 DRIVER_ROLE_REQUIRED`.
- `approve` through the module:
  - the account gains `driver`;
  - after switching (`01B-B`), or for a new session minted with an active driver role, the offer returns `201`.
- `reject` and `revoke`:
  - the state transitions and the grant effects are as in the table;
  - an illegal decision writes nothing;
  - `revoke` resets driver-mode sessions;
  - an older driver session gets `403` on its next offer.
- **Auto-approve:** `true` approves in the same transaction; `true` with `NODE_ENV=production` fails `loadConfig`.
- **CLI:** exit codes and output, with no token and a masked phone.
- **Migration:** replays in `server-ci`; the partial unique index rejects a second open row.
- **Negative control** against `main` and a **live probe** on the stand: apply from the PWA's API with a new phone, then `ops:driver approve`, then offer → `201`.

### `01B-B` — active-role switch

- Switching to a granted role updates the session and the user; an ungranted role → `403 ROLE_NOT_GRANTED`; idempotent.
- `GET /auth/session` returns `roles`.
- After a switch, the offer gate follows the new active role: driver `201`, passenger `403`.
- Another session of the same account is unchanged.
- **Session replacement at verify:**
  - a presented live same-account bearer is revoked in the verify transaction, and the old bearer then gets `401` on `GET /auth/session`;
  - a presented bearer of another account stays live;
  - a missing, revoked or expired presented bearer is ignored;
  - an injected lookup or revoke failure gives `503`, with no new session row and no OTP consumed.

### `01C` — client (D3 #1044)

All three login rows of §3 are covered, together with:
- the re-requested-code verify carries the replaced bearer, and the new bearer is installed only after a successful verify;
- no endless «Повторить»;
- the profile switch in ON and OFF.

The smoke pins in `scripts/smoke-auth-session-bootstrap.mjs` that assert the old retain-identity behaviour (`:2674`, `:2718`, `:3121`, `:3153`) are updated to the new defined state, not deleted.

**Live probe:**
1. a new phone chooses driver → the not-granted state → apply;
2. with auto-approve → driver;
3. without it → `PENDING`, then `ops:driver approve` → refresh → driver.

### `01B-C` — passenger gates

- **Driver-mode session:** on the three routes, `403 PASSENGER_ROLE_REQUIRED` with nothing written.
- **Passenger-mode session:** unchanged results.
- **Dual-role account:** switches, then succeeds.
- **`select`:** for a driver whose grant was revoked after offering → `409 DRIVER_NOT_ELIGIBLE`.

## Delivery order

1. D2 guard fix (#1072): independent, before this contract.
2. This contract (docs only).
3. `01B-A` — server: migration `0010`, enrollment routes, the decision module and `ops:driver`, the auto-approve flag. The user applies migration `0010` to the dev database via `docker cp` + `psql -v ON_ERROR_STOP=1 -f`.
4. `01B-B` — server: the active-role switch, `roles` in the session DTO, and same-account session replacement at verify.
5. `01C` — client: login role handling (D3), the enrollment UI, the profile switch.
6. `01B-C` — server: passenger gates.
7. Docs sync (#1067).

Each runtime slice is its own PR with a negative control and a live stand probe. Backend-ON PWA cutover stays pilot-blocked.

## Deferred, not decided by silence

- Driver line readiness (documents, shift, vehicle) at offer time and for going online (#830).
- An admin console or HTTP decision route, and a Telegram bot adapter for decisions. The decision module is the reuse point for both.
- Telegram Mini App login via `initData`: a future identity provider that would map to the same `users` / `auth_session`. Not designed here.
- The B2-C account switch A → B, and token rotation / TTL (#829).
- Chat authorization and the sender role (pilot-blocked).
- Locking the active-role switch during an active ride.
- Application payload (documents, vehicle) and applicant notifications.
