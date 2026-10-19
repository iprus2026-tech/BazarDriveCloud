# BD-RIDE-AUTHORITY-01A — Ride state & receipt server authority contract

Status: contract-only; the target obligations below are not shipped runtime behaviour.

Gate: `BD-RIDE-AUTHORITY-01A` (this contract) → runtime slices `01B-A`, `01B-B`, `01B-C`.

Issues: epic #1041; #1046 (`01B-A`), #1045 (`01B-B`), #1060 (`01B-C`); client follow-up #1059. Related: #830 (BD-AUTH-POLICY-01), #592 (Ride State Machine anchor), #593 (History & Receipt anchor).

Layers: Backend API / Domain / Server tests / Docs. No PWA, service-worker, CSP or migration change.

Audited baseline: [`main@747ecf6c3281d28f431103f36fbb4a025c707acc`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/747ecf6c3281d28f431103f36fbb4a025c707acc).

## Scope and authority

BD-DOCS-041 and BD-DOCS-031 move the ride status machine from the client to the server "without changing the enum or transitions". This contract defines what that server authority means for three write paths:

1. who may move a ride to which status (`PATCH /api/v1/ride-state/rides/:tripId/status`);
2. who may create a driver offer (`POST /api/v1/matching/offers`);
3. who computes the amounts of a completed-ride receipt (`POST /api/v1/history/receipts`).

It implements a slice of #830's acceptance ("passenger-only and driver-only mutations reject the wrong role"; "cross-role negative tests cover … offers, … ride transitions and receipts").

It does **not**:
- change `RIDE_STATUS`, `NEXT_STATUS`, `canTransition` or the client/server parity tests;
- add a route, an endpoint or a migration;
- change PWA code (the client completion display is #1059);
- enable the backend for the PWA (the cutover stays pilot-blocked);
- decide fare truth — BD-DOCS-035 (draft) remains that decision record. §3 defines an explicitly **interim** fare basis.

This new legacy document stays outside the document registry in this slice: registration is a separate scope, and the repository treats `UNACCOUNTED_DOCUMENT` as warn-only.

## Audited implementation at the baseline

| Surface | Shipped behaviour | Gap closed by this contract |
|---|---|---|
| Ride status PATCH (`server/src/services/ride-state/index.js:121-243`) | Checks: auth → known status → cancel metadata only with `CANCELED` → row lock → participant (`participantRole`, `:45`). `NO_SHOW`: driver only, from `WAITING_PASSENGER` (`:158-181`). `CANCELED`: driver reason required (`:35-41`, `:183-212`). Any other status: same-status no-op (`:218`), terminal → 409, otherwise **any** status from **any** non-terminal status for **either** role. | Per-role, forward-only transitions. `NEXT_STATUS` (`server/src/domain/ride-status.js:28`) is not consulted by the handler today. |
| Driver offer (`server/src/services/matching/index.js:76-131`) | Authenticated caller; not the order owner (`:109`); order `CREATED` (`:111`). The session role is never read. | Granted, active driver role required. |
| Dark authority core (`server/src/services/auth/authority.js:23`, `:64`) | `resolveActorAuthority` (current grants from `users.roles` + session `activeRole` + phone verified) and `requireDriverActor` exist; no route calls them (#1021). | Wired into the offer transaction. |
| Receipt write (`server/src/services/history/index.js:29-81`) | Driver of the ride; ride `COMPLETED`; integer bounds and signs; amounts stored verbatim (`:30`). Write-once only via `ON CONFLICT (ride_id) DO NOTHING`. No server commission rate. | Server-derived amounts; client amounts ignored. |
| Receipt schema (`server/migrations/0001_phase1_init.sql:777-800`) | `fare`, `commission ≤ 0`, `tip ≥ 0`, `net` are plain `INTEGER`s; no `net = fare + commission + tip` CHECK; `UNIQUE (ride_id)`; no write-once trigger. | Unchanged in this slice. |
| Price facts | `offers.price NUMERIC(12,2) NULL` (`0001:394`); `orders.estimated_price NUMERIC(12,2) NOT NULL DEFAULT 0` (`0001:274`). `/select` copies `formatRub(offer.price)` or the order's estimate label into `rides.order_offer_price` / `ride_price` (TEXT, `matching/index.js:40`). | §3 reads the numeric facts, not the labels. |

Live evidence (local backend-ON E2E, 2026-10-19, journal in #1041):
- a passenger bearer moved its own ride `DRIVER_EN_ROUTE → IN_PROGRESS → DRIVER_EN_ROUTE` (both 200; `ride_events.role = passenger`);
- a passenger session reached order lookup on `POST /matching/offers` (404, not 403);
- a ride agreed at 763 ₽ produced a receipt `950 / −114 / 120 / 956` from client demo values.

Server tests that pin the old behaviour and will change with the runtime slices: `ride-state-flow.test.mjs:111-161, 358-362`; `history-flow.test.mjs:66, 72, 94-105`; `realtime-flow.test.mjs:66-77`; `select-recovery-linkage-flow.test.mjs` (tests at `:506`, `:540`, `:669`, `:877`, and every HTTP offer); `matching-flow.test.mjs:58-80`; `select-flow.test.mjs:63-64, 108, 139-140, 178, 224-225`; `e2e-two-session-cycle.test.mjs:116-121, 220-234, 268`.

## 1. Ride status transitions — `01B-B` (#1045)

### Actor

The actor role is the caller's **participation in the ride** — `driver` when `rides.driver_user_id` is the caller, `passenger` when `rides.passenger_user_id` is the caller (`participantRole`, unchanged). A non-participant keeps getting 403 `FORBIDDEN`. Cross-checking the session `activeRole` on this route is deferred to #830.

### Transition table

| From | Driver may set | Passenger may set |
|---|---|---|
| `ACCEPTED` | `DRIVER_EN_ROUTE`, `CANCELED`¹ | `CANCELED` |
| `DRIVER_EN_ROUTE` | `DRIVER_APPROACHING_PICKUP`, `CANCELED`¹ | `CANCELED` |
| `DRIVER_APPROACHING_PICKUP` | `WAITING_PASSENGER`, `CANCELED`¹ | `CANCELED` |
| `WAITING_PASSENGER` | `IN_PROGRESS`, `NO_SHOW`, `CANCELED`¹ | `IN_PROGRESS` (boarding), `CANCELED` |
| `IN_PROGRESS` | `COMPLETED`, `CANCELED`¹ | — (`CANCELED` → 409 `RIDE_TRANSITION_NOT_ALLOWED`) |
| `COMPLETED` / `CANCELED` / `NO_SHOW` | same-status retry only | same-status retry only |

¹ Driver cancellation requires a reason from `DRIVER_CANCEL_REASONS` (unchanged). Passenger reasons stay optional and must belong to `PASSENGER_CANCEL_REASONS` when present (unchanged).

Forward targets by owner:
- **driver**: `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`, `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`;
- **passenger**: `IN_PROGRESS`;
- **nobody** (never set through this route): `NEW_ORDER`, `CONFIRMATION_PENDING`, `CONFIRMED`, `CHAT_STARTED`, `ACCEPTED`. Server rides are bootstrapped at `DRIVER_EN_ROUTE` by `/select`.

### Decision order (normative)

Unchanged prefix: 401/503 auth → 400 `INVALID_STATUS` → 400 `INVALID_CANCEL_METADATA` → row lock → 404 `RIDE_NOT_FOUND` → 403 `FORBIDDEN` (non-participant).

1. **`NO_SHOW`** — unchanged: driver only (403 `FORBIDDEN`); same status → 200 no-op; other terminal → 409 `RIDE_TERMINAL`; from anything but `WAITING_PASSENGER` → 409 `RIDE_TRANSITION_NOT_ALLOWED`.
2. **`CANCELED`**:
   1. ride already `CANCELED` → 200 no-op (unchanged);
   2. ride in another terminal status → 409 `RIDE_TERMINAL` (unchanged);
   3. **new:** passenger and ride `IN_PROGRESS` → 409 `RIDE_TRANSITION_NOT_ALLOWED`, before any reason validation;
   4. reason rules, write, `ride_events` row and outbox row — unchanged (driver without a reason → 400 `CANCEL_REASON_REQUIRED`, including from `IN_PROGRESS`).
3. **Any other status:**
   1. target owned by nobody → 409 `RIDE_TRANSITION_NOT_ALLOWED`;
   2. target not owned by the caller's role → 403 `RIDE_ROLE_FORBIDDEN`;
   3. target equals the current status → 200 no-op: no re-stamp, no event, no outbox (unchanged semantics, now owner-only);
   4. ride terminal → 409 `RIDE_TERMINAL` (unchanged code, so existing terminal assertions keep their code);
   5. target is not `NEXT_STATUS[current]` → 409 `RIDE_TRANSITION_NOT_ALLOWED` — rejects forward skips and backward moves;
   6. write + status-keyed timestamp + `ride_events` row + outbox row — unchanged.

Every **transition rejection** from steps 1–3 (`FORBIDDEN`, `RIDE_ROLE_FORBIDDEN`, `RIDE_TERMINAL`, `RIDE_TRANSITION_NOT_ALLOWED`, `CANCEL_REASON_REQUIRED`, `INVALID_CANCEL_REASON`) writes nothing — no ride update, no event, no outbox row — and uses the envelope `{ error, code, retryable: false }`. Responses of the unchanged prefix keep their current semantics; in particular 503 `SESSION_LOOKUP_FAILED` stays `retryable: true`.

### Invariants

- Every committed non-branch change advances exactly one `NEXT_STATUS` step, so each stage timestamp is stamped on first entry only; `accepted_at` stays write-once.
- `ride_events.role` always equals the role that owns the committed transition.
- Rows written before `01B-B` may already contain skips or backward re-stamps. The recovery-linkage validator and `pg_chronology_ok` (`server/src/repositories/rides.js:153-171`) stay tolerant; tightening them is out of scope. Their tests build such legacy shapes with SQL fixtures instead of the API.
- The table lives in a new pure domain module (e.g. `server/src/domain/ride-transition-authority.js`). `ride-status.js` and `ride-status-parity.test.mjs` are untouched.

### Client compatibility

No client change is required:
- the driver UI advances strictly along `NEXT_STATUS` (`public/src/screens/active_ride.js`, `#ar-start-pickup` → `#ar-finish`); its local `NEW_ORDER → DRIVER_EN_ROUTE` accept path (`:1289`) never runs for a server ride;
- the passenger writes only boarding (`public/src/screens/active_ride_passenger.js:2392`) and cancel (`:2352`); there is no passenger cancel control in `IN_PROGRESS`.

Documentation drift resolved by this table, to be synced in the docs-sync PR: `docs/flow-contracts.md` lists `WAITING_PASSENGER → IN_PROGRESS` as "Driver starts trip" only (both roles may); BD-DOCS-034 seeds an assigned ride at `ACCEPTED` (the server bootstraps `DRIVER_EN_ROUTE`).

## 2. Driver role gate on offers — `01B-A` (#1046)

Inside the existing offer transaction and **before** `lockOrderByLegacyId` (`matching/index.js:105`):

```js
const authority = requireDriverActor(await resolveActorAuthority(client, viewer));
```

| Authority result | HTTP | `code` | `retryable` |
|---|---|---|---|
| `AUTHORITY_LOOKUP_FAILED` | 503 | `AUTHORITY_LOOKUP_FAILED` | true |
| `UNAUTHENTICATED`, `INVALID_SESSION_ACTOR`, `ACCOUNT_NOT_FOUND` | 401 | `UNAUTHENTICATED` | false |
| `INVALID_ROLE_GRANTS`, `ACTIVE_ROLE_MISSING`, `INVALID_ACTIVE_ROLE`, `ACTIVE_ROLE_NOT_GRANTED`, `WRONG_ACTIVE_ROLE`, `PHONE_NOT_VERIFIED` | 403 | `DRIVER_ROLE_REQUIRED` | false |

Rules:
- The gate reads **current** grants (`users.roles`), so a revoked grant takes effect on the next request even for an older session.
- Because the gate precedes the order lookup, a non-driver learns nothing about order existence. `ORDER_NOT_FOUND`, `CANNOT_OFFER_OWN_ORDER` and `ORDER_NOT_OPEN` remain, for drivers only.
- Unchanged: `GET /matching/offers` and `POST /matching/select` keep their owner checks. A passenger active-role gate on them is deferred to #830, because without an active-role switch a dual-role account would lose access to its own orders. That switch is an #830 concern ([BD-AUTH-POLICY-01A](driver-role-grant-contract.md) §2), not the B2-C account switch of #829.
- Out of scope: minimum driver readiness (#830) and driver grant writing (#1042 / #830).

Consequence: until a product path grants the driver role, only accounts granted through SQL can offer. The backend-ON PWA is pilot-blocked, so no shipped flow regresses. For a non-driver, `public/src/screens/respond.js:742-761` already rejects before the local write.

## 3. Receipt amounts — `01B-C` (#1060)

### Interim fare basis — not final fare truth

> **INTERIM.** Until the Route & Price authority (BD-DOCS-035, #588) defines quote, tariff and negotiation truth, the receipt fare is the price fixed server-side when the passenger selected the driver. BD-DOCS-035 states that a selected bid is not fare truth "merely by copying" it; this contract knowingly uses it as the interim basis because it is strictly stronger than completion-time client totals, and it is replaced as soon as #588 provides an authoritative fare fact.

Derivation, inside the receipt write, after the existing "driver of the ride" and "ride `COMPLETED`" checks:

1. Basis: the ride's order's **accepted** offer by the ride's driver (`offers.order_id = rides.order_id`, `offers.driver_id = rides.driver_user_id`, `offers.status = 'accepted'`) → `offers.price`. If there is no such offer, or its price is `NULL` → `orders.estimated_price`.
2. If the ride has no order (`rides.order_id` is `NULL` or the row is gone), or the basis is not `> 0` → 409 `RECEIPT_FARE_UNKNOWN`, nothing written. (`orders.estimated_price` defaults to `0`, which is treated as unknown.)
3. `fare = round(basis)` to whole rubles, half up.
4. `commission = −round(fare × commissionPercent / 100)`, half up; always `≤ 0`.
5. `tip = 0`. No tip workflow exists; any production tip needs its own server fact (BD-DOCS-035).
6. `net = fare + commission + tip`.
7. `paymentMode`: taken from the request as today (`cash` | `noncash`, default `noncash`). It is not authoritative; the payment provider is deferred (#634).
8. `completedAt = rides.completed_at` (unchanged).

Write-once is unchanged: `ON CONFLICT (ride_id) DO NOTHING`; a replay returns the stored receipt and never recomputes it.

### Commission configuration

- Environment variable `RECEIPT_COMMISSION_PERCENT`; exposed as `config.receipts.commissionPercent`.
- Unset → `12` (the rate the shipped UI already shows: «Комиссия сервиса · 12%»).
- When set, it must parse as a finite decimal number with `0 ≤ value ≤ 100`; otherwise `loadConfig` fails at startup with `Invalid RECEIPT_COMMISSION_PERCENT: … — must be a number 0..100`, mirroring the existing guards in `server/src/config.js`.
- A change affects only receipts written afterwards.
- `01B-C` documents the variable in `server/README.md` and `server/.env.example`.

### Client-supplied amounts

- `fare`, `commission`, `tip`, `net` become **optional** request fields with the same integer bounds; `additionalProperties: false` stays. They are accepted only for backward compatibility and are never stored or used.
- If any provided field differs from the server-computed value, the request logs exactly one `warn` line (after the driver/`COMPLETED` checks pass):
  ```json
  { "event": "receipt_client_amounts_ignored", "tripId": "<trip id>",
    "mismatched": ["fare", "tip"],
    "client": { "fare": 950, "commission": -114, "tip": 120, "net": 956 },
    "server": { "fare": 763, "commission": -92, "tip": 0, "net": 671 } }
  ```
  No user ids, phone numbers, names, tokens or IP addresses are added to this line. It exists to measure legacy clients until #1059 ships.
- The response stays `201 { receipt }`, now carrying the server amounts.

### Receipts written before `01B-C`

They hold client-authored amounts. Decision: **no migration and no code-level remediation**. No shared environment exists yet (`infra/staging`), and the only known affected row is the local dev E2E receipt recorded in #1041. After `01B-C` merges, an operator may recompute that dev row with a one-off SQL script. A database `CHECK (net = fare + commission + tip)` is a possible later migration, not part of this slice.

## Acceptance and test plan

Every runtime slice runs the server suite on a disposable PostgreSQL 16 with the `main` migrations (never against a developer database), plus `node scripts/check.mjs`, `node scripts/check-precache-drift.mjs`, `node scripts/dispatcher.mjs`, and a live re-probe on the local stand (#1040).

### `01B-A` — offers (#1046)

- A shared test helper grants the driver role (`users.roles`, `users.active_role` and the session's `auth_session.active_role`); every suite that creates offers over HTTP uses it.
- Passenger-only account → 403 `DRIVER_ROLE_REQUIRED`, for both an existing and a non-existent `orderId`.
- Granted driver whose session `activeRole` is `passenger` → 403.
- Grant revoked after the session was issued → 403.
- Granted, active driver → 201 (existing idempotency unchanged); `CANNOT_OFFER_OWN_ORDER`, `ORDER_NOT_FOUND`, `ORDER_NOT_OPEN` still apply to drivers.

### `01B-B` — transitions (#1045)

- Full driver chain → 200 at every step; passenger boarding from `WAITING_PASSENGER` → 200.
- Passenger targeting `DRIVER_APPROACHING_PICKUP`, `WAITING_PASSENGER` or `COMPLETED` → 403 `RIDE_ROLE_FORBIDDEN`.
- Skips (`DRIVER_EN_ROUTE → WAITING_PASSENGER | IN_PROGRESS | COMPLETED`), passenger boarding from `DRIVER_EN_ROUTE`, and backward moves (`WAITING_PASSENGER → DRIVER_EN_ROUTE`) → 409 `RIDE_TRANSITION_NOT_ALLOWED`.
- Targets owned by nobody (e.g. `ACCEPTED`, `NEW_ORDER`) → 409.
- **Passenger `CANCELED` from `IN_PROGRESS` → 409 `RIDE_TRANSITION_NOT_ALLOWED`**; passenger `CANCELED` from `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`, `WAITING_PASSENGER` → 200; driver `CANCELED` from `IN_PROGRESS` with a reason → 200, without → 400 `CANCEL_REASON_REQUIRED`.
- Owner same-status retry → 200 no-op; non-owner same-status → 403.
- Every rejection leaves the ride row, `ride_events` and the outbox unchanged.
- Existing `RIDE_TERMINAL` assertions keep their code; `ride-status-parity` tests pass untouched.
- Recovery-linkage tests build sparse/backward legacy shapes with SQL fixtures and still pass; the API rejects the same shapes.

### `01B-C` — receipts (#1060)

- Receipt from an accepted priced offer → server amounts (e.g. 763 → `763 / −92 / 0 / 671` at 12%).
- Offer without a price → `orders.estimated_price`; neither usable (`NULL` / `0`) → 409 `RECEIPT_FARE_UNKNOWN`.
- Fractional basis rounds half up (`763.50 → 764`), and so does the commission.
- Body without amounts → 201; body with mismatching amounts → 201 with server amounts and one `receipt_client_amounts_ignored` warn line without PII; matching amounts → no warn line.
- Replay returns the stored receipt without recomputation.
- `RECEIPT_COMMISSION_PERCENT`: default 12; override honoured; `-1`, `101`, `abc`, `""` fail `loadConfig`.

## Delivery and release boundary

1. `01A` — this contract (docs only).
2. `01B-A` — offer role gate + test grant helper (#1046).
3. `01B-B` — per-role transition table (#1045).
4. `01B-C` — server-derived receipt amounts + commission config (#1060).
5. Client #1059 — completion shows and sends the agreed fare, no demo tip.
6. Docs sync — BD-DOCS-042 Backend Spine Inspector current state, `server/README.md`, `docs/flow-contracts.md` reconciliation.

Each step is its own PR with its own review and merge approval. None of them activates the PWA backend cutover.

## Deferred, not decided by silence

- Passenger active-role gate on `/select` and `GET /matching/offers` (#830).
- Active-role switch and driver grant writing (#1042 / #830), now specified by [BD-AUTH-POLICY-01A](driver-role-grant-contract.md).
- Minimum driver readiness at offer time (#830).
- Fare truth, tariffs, negotiated pricing (BD-DOCS-035 / #588); tips and payment provider (#634).
- Session `activeRole` cross-check on ride-state writes (#830).
- Passenger cancel reason forwarding (#1050) and order status after a ride cancel (#1051).
- Tightening the recovery-linkage chronology once only forward-only rows exist.
