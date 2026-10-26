---
id: BD-DOCS-052
docType: decision-record
title: "Sign-in with Telegram Mini App initData — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-10-26
effectiveFrom: 2026-10-26
reviewAfter: 2027-04-26
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/auth/telegram
  files:
    - server/src/services/auth/index.js
    - server/src/repositories/users.js
    - server/src/repositories/otps.js
    - server/src/config.js
    - server/migrations/0002_auth.sql
    - server/migrations/0009_merchant_identity_contact_authority.sql
  issues: [1127, 1128, 1154, 1152, 830, 829, 585]
  prs: []
tags: [decision-record, adr, auth, identity, telegram, mini-app, target]
slug: /decisions/telegram-initdata-sign-in
---

# Sign-in with Telegram Mini App initData — Decision Record

> **Contract-first / docs-only (`status: draft`).** This ADR is slice M3 of
> BD-AUTH-TELEGRAM-01 (#1127). It fixes the identity model, the sign-in
> contract and the data rules before any code. The owner made the decisions
> R1–R11 on 2026-10-26, with amendments to R5, R6, R7 and R9. The server (M4),
> the bot (M6, BD-TG-BOT-01 #1128) and the Mini App client (M5) implement it in
> later slices. This document changes no runtime, migration or PWA file.

## Context

- The goal is a Telegram Mini App with a working server and database, for a
  small group of friends.
- On a public stand OTP is off (BD-STAND-PUBLIC-01 #1124), so Telegram is the
  only way to sign in there. `POST /auth/otp/*` already answers 403
  `OTP_DISABLED` («Вход через Telegram») when public exposure is on.
- Today an account is a phone number. `resolveVerifiedLoginUser`
  (`server/src/repositories/users.js`) finds or creates the user for a verified
  phone and grants `passenger`, which is the existing grant rule. Roles stay
  server facts: a role needs a verified phone (#830), and the driver role comes
  only through enrollment and an ops decision.
- The Mini App receives `initData`, a query string that Telegram signs with the
  bot token. initData carries no phone number. The phone comes from the bot,
  where the user shares a contact (`requestContact`, #1128).

Decisions taken earlier in #1127 (2026-10-24) and kept here:

- HMAC verification with the bot token.
- The phone is accepted only from a contact whose `user_id` equals the sender's
  `from.id`.
- The raw initData is never stored or logged.
- Telegram never grants a role by itself.

## Decisions

### R1 — Identity table: a dedicated `telegram_identities`

A new table, not `external_contact_identities` with a `TELEGRAM` channel:

| Column | Type | Rule |
|---|---|---|
| `telegram_user_id` | `BIGINT` | Primary key. Telegram ids exceed 32 bits. |
| `user_id` | `UUID` | `NOT NULL`, `UNIQUE`, FK `users(id) ON DELETE RESTRICT`. One Telegram account ↔ one BazarDrive account. |
| `linked_at` | `TIMESTAMPTZ` | When the contact linked the two. |
| `consented_at` | `TIMESTAMPTZ` | When the contact was received after the consent text (R9). `NOT NULL`. |
| `consent_version` | `TEXT` | The consent text version shown (R9). `NOT NULL`. |
| `revoked_at` | `TIMESTAMPTZ` | `NULL` while active. Set only by the owner, by hand. A revoked identity cannot sign in. |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | Housekeeping. |

`telegram_user_id` and `user_id` are immutable once written. Changing a link
is a manual recovery step for the owner (R5).

Why not `external_contact_identities` (0009): it would need its `channel` CHECK
widened. It would also need a new unique index for «one Telegram, one account».
Sign-in authority would be mixed with merchant contact routing in a table built
for «channel proof ≠ user link ≠ membership». #1127 allowed that table only «if
it fits without stretching», and it does not.

### R2 — Personal data: the minimum

The data stored is the Telegram user id, the first name and the phone:

- The **Telegram user id** goes to `telegram_identities.telegram_user_id`.
- The **first name** comes from initData `user.first_name`. It is written to
  `users.first_name` only when that is empty, and is never overwritten.
- The **phone** comes from the shared contact. It is written to `users.phone`
  through `resolveVerifiedLoginUser`, the same path as OTP.

Not stored: `username`, `last_name`, `photo_url`, `language_code`,
`is_premium`, `allows_write_to_pm`, `chat_instance`, `start_param`, or the raw
initData.

### R3 — No account before the phone

A sign-in by a Telegram user who has no `telegram_identities` row creates
nothing. The server answers 403 `PHONE_REQUIRED`, and the Mini App sends the
user to the bot to share the number.

The account is found or created only when the contact arrives (R4). This way
two accounts never need merging: a Telegram-first account without a phone can
never meet an OTP account that later turns out to own the same number.

### R4 — Linking to an existing account by phone

When the bot receives a contact (M6), it checks four things:

- the chat is private;
- `contact.user_id == message.from.id`;
- the phone normalizes to E.164 (Telegram may send it without `+`);
- the consent text was shown (R9).

If any check fails, the bot replies with a refusal and stores nothing.

Then, in one transaction:

1. `resolveVerifiedLoginUser(phone)` finds the account that owns the number, or
   creates it. The phone becomes verified and `passenger` is granted under the
   existing rule. An OTP account keeps its orders, roles and history.
2. A `telegram_identities` row links `from.id` to that account, with
   `consented_at` and `consent_version`.

This contact intake is a server function. M4 implements it with its tests, and
M6 calls it from the bot transport.

### R5 — Conflicts: refuse, explain, resolve by hand

There are two cases:

- **(a)** The account that owns the number is already linked to a *different*
  Telegram id.
- **(b)** A linked Telegram id shares a contact with a *different* number than
  its account's phone.

In both cases nothing is linked, changed or relinked:

- The result is `TELEGRAM_CONFLICT`, and the user sees: «Этот номер уже связан
  с другим Telegram. Напишите в поддержку.» Case (b) shows the same text.
- The log line carries only `user_id`, `telegram_user_id` and the conflict type
  (`phone_linked_elsewhere` or `phone_changed`). It never carries the phone or
  initData.
- The owner resolves conflicts by hand. There is no admin UI.

Automatic relinking would let anyone who controls a number take over the
account bound to it.

### R6 — initData lifetime and replay

- `auth_date` must be at most `TELEGRAM_INITDATA_MAX_AGE_SECONDS` old (default
  `600`, ten minutes), and at most 60 seconds in the future (clock skew).
- An initData is exchanged once. The SHA-256 of its `hash` field goes into a
  replay record, and a second exchange gets 409 `TELEGRAM_REPLAYED`.
- **Cleanup**, the same way as the OTP retention sweep of BD-AUTH-HARDEN-01
  (#824, `deleteOldOtps`): each `POST /auth/telegram` deletes a bounded batch of
  records, oldest first. A record is deleted once it is older than
  `TELEGRAM_INITDATA_MAX_AGE_SECONDS + 3600` seconds. Until then it still
  blocks a replay and counts for the hourly limits (R8), and after that it does
  neither.

The replay records and the attempt counts share one table,
`auth_telegram_attempts`:

| Column | Rule |
|---|---|
| `id` | Primary key. |
| `ip` | The source address of the attempt. |
| `telegram_user_id` | `BIGINT NULL`. Set only after the signature is valid. |
| `init_data_hash` | `TEXT NULL`. The SHA-256 of initData `hash`, set only after the signature is valid. A partial `UNIQUE` index (where not null) is the replay store. |
| `outcome` | `ok`, `invalid`, `expired`, `replayed`, `no_user`, `phone_required`, `revoked` or `rate_limited`. |
| `created_at` | Indexed for the sweep and the limit windows. |

The consequence is that a Mini App which loses its local token inside the same
launch must be closed and reopened to sign in again. An ordinary reload keeps
the token in `localStorage`.

### R7 — Sessions: own method, finite TTL, same-method replacement

- `auth_session` gains `auth_method TEXT NOT NULL DEFAULT 'otp'` with
  `CHECK (auth_method IN ('otp', 'telegram'))`. Existing rows are `otp`.
- A Telegram session expires after `TELEGRAM_SESSION_TTL_SECONDS` (default
  `604800`, seven days). This does not depend on `SESSION_TTL_SECONDS`, whose
  `0` still means no expiry for OTP sessions. The short TTL costs the user
  nothing, because the Mini App signs in again on every launch (M5).
- A new sign-in revokes a presented live session of the **same account and
  the same `auth_method`**, as OTP verify does (BD-AUTH-POLICY-01B-B):
  Telegram replaces Telegram, and OTP replaces OTP. A browser session from an
  OTP sign-in is never touched by a Telegram sign-in, and the reverse also
  holds. Another account's session is left alone (B2-C, #829).
- A Telegram session is `phoneVerified: true`: the phone was verified by the
  contact (R4). Its `active_role` follows `sessionRole(user)`, the same as OTP.

### R8 — Attempt limits

The limits are counted from `auth_telegram_attempts`:

- **Per IP:** at most 30 attempts per hour, any outcome.
- **Per Telegram id:** at most 10 attempts per hour with a valid signature.
- Over a limit, the answer is 429 `TELEGRAM_RATE_LIMITED` with `Retry-After`,
  in the same shape as the OTP limits (#824).
- An invalid signature is counted per IP only, because its Telegram id is not
  trusted.

The general per-IP limit for all of `/api` stays a separate task (#1152).

### R9 — Consent: in the bot, recorded with the contact

- The bot (M6) shows the consent text **in the message that carries the
  `requestContact` button**: «Отправляя номер, вы соглашаетесь на обработку
  Telegram ID, имени и номера телефона для работы сервиса», plus a link to the
  privacy policy (#1154).
- `consented_at` and `consent_version` are written when the contact is
  received (R4), in the same transaction as the link.
- The Mini App (M5) repeats the same line as a reminder, not as the first
  consent.
- `consent_version` is a constant of the server build, for example
  `2026-10-privacy-v1`. The final wording and the policy page belong to #1154.
  A new version does not invalidate existing links; re-consent rules, if any,
  are #1154's decision.

### R10 — Logs and secrets

- The bot token is read only from `TELEGRAM_BOT_TOKEN` in `server/.env`. It is
  never logged, echoed, committed or put in a report. At startup the server
  checks only its shape (`<digits>:<35+ chars>`), and `/readyz` reports only
  whether it is configured, never its value.
- The `/auth/telegram` request body is never logged. Errors are logged without
  initData, and so are the outcome records.
- Tests use a fake token and generate initData themselves.

### R11 — Migration, readiness, dark switch

- Migration `0015_auth_telegram.sql` adds `telegram_identities`,
  `auth_telegram_attempts` and `auth_session.auth_method`. It is idempotent, as
  server-ci applies every migration twice.
- `/readyz` checks the new structure. Without the migration it answers 503,
  and a CI step asserts this.
- Without `TELEGRAM_BOT_TOKEN`, `POST /auth/telegram` answers 503
  `TELEGRAM_DISABLED` and the rest of the server works as before.

## Contract: `POST /api/v1/auth/telegram`

Request: `{ "initData": "<raw Telegram.WebApp.initData>" }`. It is a string of
1 to 4096 characters, and no other fields are allowed.

Steps, in order:

1. **Limits.** Check the per-IP limit (R8).
2. **Signature.** Parse initData as a query string; a duplicate key makes it
   invalid. Build the data-check string from every field except `hash`, sorted
   by key, as `key=value` lines joined with `\n`. Compute
   `secret = HMAC_SHA256(key = "WebAppData", message = bot_token)` and
   `expected = hex(HMAC_SHA256(key = secret, message = data_check_string))`.
   Compare `expected` with `hash` in constant time. A mismatch, including
   initData signed for another bot, is 401 `TELEGRAM_INVALID`.
3. **Freshness.** Check `auth_date` (R6). An old one is 401 `TELEGRAM_EXPIRED`;
   one more than 60 seconds in the future is 401 `TELEGRAM_INVALID`.
4. **User.** `user` must be JSON with an integer `id`. Otherwise the answer is
   400 `TELEGRAM_NO_USER`.
5. **Per-id limit and replay.** Check the per-Telegram-id limit (R8), then
   insert the replay record (R6). A duplicate is 409 `TELEGRAM_REPLAYED`.
6. **Identity.** Look up `telegram_identities`. With no row, the answer is 403
   `PHONE_REQUIRED`; with `revoked_at` set, it is 403 `TELEGRAM_REVOKED`.
7. **Session.** In one transaction:
   - fill `users.first_name` if it is empty (R2);
   - replace a same-account, same-method session (R7);
   - insert the session with `auth_method = 'telegram'` and the R7 TTL.

The success response is `200` with the same shape as `POST /auth/otp/verify`,
so the client keeps one session model:

```json
{ "token": "<opaque>", "user": { "userId": "…", "activeRole": "passenger", "phoneVerified": true, "roles": ["passenger"] } }
```

Errors use the existing problem shape `{ error, code, retryable }`:

| Status | Code | When |
|---|---|---|
| 400 | (schema) | The body is not `{ initData }` within the bounds. |
| 400 | `TELEGRAM_NO_USER` | Valid initData without `user`. |
| 401 | `TELEGRAM_INVALID` | Bad or foreign signature, a malformed string, or `auth_date` in the future. |
| 401 | `TELEGRAM_EXPIRED` | `auth_date` older than the max age. |
| 403 | `PHONE_REQUIRED` | No linked identity yet: share the number in the bot. |
| 403 | `TELEGRAM_REVOKED` | The identity was revoked by hand. |
| 409 | `TELEGRAM_REPLAYED` | This initData was already exchanged. |
| 429 | `TELEGRAM_RATE_LIMITED` | A limit of R8 was hit (`retryable`, `Retry-After`). |
| 503 | `TELEGRAM_DISABLED` | No bot token configured. |

`TELEGRAM_CONFLICT` (R5) is a result of the contact intake (R4), which the bot
shows, not of this route.

## Authority invariants

- Telegram proves who the Telegram user is. It never grants a role:
  - `passenger` comes from the verified-phone rule in `resolveVerifiedLoginUser`;
  - `driver` comes only from enrollment and an ops decision;
  - authority checks `activeRole` as before.
- One Telegram account ↔ one BazarDrive account. A link never changes without
  the owner.
- No session is minted without a linked identity, so none exists without a
  verified phone.
- No raw initData, bot token or phone appears in any log line produced by this
  feature.

## Explicit non-goals

- The bot transport, the `/start` flow, the `requestContact` message and the
  webhook or polling choice: these are M6, BD-TG-BOT-01 (#1128).
- Automatic sign-in in the Mini App, and the rule that an explicit logout does
  not sign back in silently: these are M5.
- Account switch (B2-C, #829), notifications (#589) and OTP delivery (#824).
- The final consent wording and the privacy policy (#1154).
- An admin UI for conflicts or revocation. The owner handles both by hand (R5).

## Verification scenarios for M4

These are the server tests M4 must include. They run with a fake bot token and
initData generated by the test, so no real bot or network is needed.

- **Signature:** valid; tampered field; tampered `hash`; signed with another
  bot's token; a duplicate key; a `signature` field present alongside `hash`.
- **Freshness:** `auth_date` older than the max age; more than 60 seconds in
  the future.
- **User:** initData without `user`; `user` without an integer `id`.
- **Replay:** the same initData twice gives 200, then 409;
  records older than max age + 3600 seconds are swept.
- **Limits:** the per-IP limit; the per-id limit; invalid signatures counted per
  IP only.
- **Identity:** no identity gives `PHONE_REQUIRED`; a revoked identity gives
  `TELEGRAM_REVOKED`.
- **Contact intake:**
  - links a new account, and links an existing OTP account by phone with its
    data intact;
  - refuses a contact whose `user_id ≠ from.id`;
  - conflicts (a) and (b) change nothing, and their log lines contain no phone.
- **Sessions:**
  - a Telegram sign-in replaces only a live Telegram session of the same
    account;
  - an OTP session survives a Telegram sign-in, and the reverse;
  - a Telegram session expires after its TTL.
- **Dark switch and readiness:** no token gives 503 `TELEGRAM_DISABLED`; without
  migration 0015, `/readyz` gives 503.
- **Logs:** a captured log stream contains neither the initData nor the token.

The live check with the real bot happens only after the owner confirms that the
token is in `server/.env`.

## Acceptance criteria for this ADR (docs-only)

- [ ] R1–R11 and the amendments to R5, R6, R7 and R9 are recorded as decided
  by the owner on 2026-10-26.
- [ ] The contract matches the acceptance list of #1127.
- [ ] docs-site validators, `npm run check`, `npm run build`, the root
  `check.mjs` and the dispatcher pass.
