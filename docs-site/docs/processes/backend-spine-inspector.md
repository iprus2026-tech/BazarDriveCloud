---
id: BD-DOCS-042
docType: process
title: Mini Yonder Backend Spine docs build integration
owner: docs-contract-agent
status: current
revision: 2026-08-29
effectiveFrom: 2026-06-19
reviewAfter: 2026-12-19
visibleFor: [developer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - "docs-site/docs/processes/backend-spine-inspector.md"
    - "docs-site/static/img/mini-yonder-backend-spine.svg"
    - "docs-site/sidebars.js"
    - "docs-site/package.json"
    - "docs/screen-contracts.md"
    - "server/README.md"
  issues:
    - 820
    - 821
    - 931
  prs: []
tags: [process, mini-yonder, backend, database, docs-site]
slug: /processes/mini-yonder-backend-spine
---

# Mini Yonder Backend Spine docs build integration

This page is the governed current-state baseline for the BazarDrive Phase-1 backend and the Mini Yonder Backend Spine & DB Inspector. It records what is live, dark, or pilot-blocked, while keeping this change docs-only.

![Mini Yonder Backend Spine and DB Inspector](/img/mini-yonder-backend-spine.svg)

_Historical concept mock: labels inside this image predate the implemented server and are not current runtime status. The governed matrix below is the current-state source of truth._

## Status vocabulary

| Status | Meaning |
|---|---|
| **LIVE** | The route is registered and implemented. It uses the database where the route contract requires I/O; operational liveness may intentionally perform no I/O. This does not mean the PWA is fully cut over or the feature is production-ready. |
| **DARK** | The route/module seam exists but intentionally returns `501 NOT_IMPLEMENTED`, or its infrastructure adapter is not active. |
| **PILOT-BLOCKED** | The implementation exists, but a documented identity, authorization, delivery, operational, or activation gap prevents pilot use. |

## Live baseline — 24 July 2026

| Module / route | State | Auth and role boundary | Database writes / reads | PWA consumer or activation seam | Verification owner |
|---|---|---|---|---|---|
| `GET /api/v1/health` | LIVE | Operational endpoint; no user session | No product tables; no I/O | Deployment liveness probe only | health route smoke |
| `GET /api/v1/readyz` | LIVE | Operational endpoint; no user session | Reads PostgreSQL connectivity and migration state | Deployment readiness probe only | readiness + migration CI |
| `GET /api/v1/auth/session` | LIVE / PILOT-BLOCKED | Resolves an optional bearer session; expiry/revocation policy remains a pilot gate | Reads `auth_session` only; the session row mirrors identity and verification fields, with no `users` join | `api_client.getSession()`; API base remains guarded/off by default | auth route/repository tests |
| `POST /api/v1/auth/otp/request` | LIVE / PILOT-BLOCKED | Public request; unthrottled and without a production delivery provider | Writes hashed codes to `auth_otp` | guarded auth cutover; dev response may include `devCode` only in dev mode | OTP request tests + auth hardening issue owner |
| `POST /api/v1/auth/otp/verify` | LIVE / PILOT-BLOCKED | Public verification; attempt cap enforced; final session lifecycle remains a pilot gate | Reads the latest live `auth_otp` and commits its attempt increment before the success transaction. On a correct code, one transaction consumes the OTP, upserts/verifies `users` and inserts `auth_session`; the separate attempt count therefore persists on failed verification | guarded auth/token cutover | OTP concurrency + session tests |
| `GET /api/v1/orders` | LIVE | Public created-order read; optional viewer session only affects ownership projection | Reads `orders` | guarded `mock_api.listFeedPosts()` seam; API base off by default | orders route + API client smoke |
| `POST /api/v1/orders` | LIVE / PILOT-BLOCKED | Requires a live authenticated session; `phone_verified` and passenger-role enforcement remain pilot gates | Writes `orders` | guarded order-create seam; local fallback remains active while API base is off | orders route/validation tests |
| `POST /api/v1/matching/offers` | LIVE / PILOT-BLOCKED | Requires a live authenticated session and blocks self-offers; `phone_verified`, granted driver role and readiness are not enforced yet | Locks `orders`; upserts `offers` transactionally | guarded driver-offer seam | matching transaction/concurrency tests |
| `GET /api/v1/matching/offers?orderId=…` | LIVE | Authenticated order owner only | Reads `orders`, `offers` | guarded passenger responses seam | matching ownership tests |
| `POST /api/v1/matching/select` | LIVE / PILOT-BLOCKED | Authenticated order owner only; rejects self-selection; body identity is `{orderId, driverId}` where `driverId` is the server driver UUID returned by the selected offer | Locks/writes `orders`, `offers`, `assignment`, `rides` in one transaction | guarded select/handoff seam; `responseId` / `offer.id` are not select inputs | matching race + ride-bootstrap tests |
| `GET /api/v1/ride-state/rides/:tripId` | LIVE | Authenticated ride participant only | Reads `rides` | guarded active-ride read seam | ride participant tests + enum parity |
| `PATCH /api/v1/ride-state/rides/:tripId/status` | LIVE | Authenticated ride participant only | Locks/updates `rides`; appends `ride_events` in one transaction | guarded active-ride write seam | terminal-freeze/idempotency + enum parity tests |
| `GET /api/v1/realtime/poll?tripId=…&since=…` | LIVE (polling) | Authenticated ride participant only | Reads `rides`, cursor-ordered `ride_events` | guarded self-clearing poll seam; WebSocket/SSE push remains dark | realtime cursor/participant tests + client smoke |
| `GET /api/v1/history` | LIVE | Authenticated viewer; query is scoped to viewer identity | Reads `ride_history` view | guarded history seam; local history fallback remains while API base is off | history viewer-scope tests |
| `POST /api/v1/history/receipts` | LIVE | Authenticated ride driver only; completed ride only; write-once | Reads `rides`; inserts/reads `receipts` | guarded receipt seam | completed/driver/write-once tests |
| `GET /api/v1/chat/messages?chatId=…` | LIVE persistence / PILOT-BLOCKED | No authenticated participant check | Reads `messages` | guarded chat seam must stay off for pilot until authorization lands | chat route tests + chat-auth issue owner |
| `POST /api/v1/chat/messages` | LIVE persistence / PILOT-BLOCKED | No authenticated participant check; `senderRole` is request-supplied | Inserts/deduplicates `messages` | guarded chat seam must stay off for pilot until authorization lands | chat idempotency tests + chat-auth issue owner |
| `ALL /api/v1/availability/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future availability track (outside #820 pilot) |
| `ALL /api/v1/route-price/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future route-price track (outside #820 pilot) |
| `ALL /api/v1/notifications/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future notifications track (outside #820 pilot) |
| `ALL /api/v1/safety/*` | DARK | No pilot contract | None; catch-all returns `501 NOT_IMPLEMENTED` | no activation | future safety track (outside #820 pilot) |
| `GET /metrics` | DARK | Operational policy not frozen | None; returns `501 NOT_IMPLEMENTED` | no activation | observability follow-up |

## Authority and invariants

- PostgreSQL and the server domain layer own order, offer, assignment and ride status after a feature is activated.
- Matching selection is one transaction: lock the open order, accept one offer, reject competing offers, create the assignment, accept the order and attempt to bootstrap the ride. A pre-existing `trip_id` is reread; the complete direct conflict-Ride invariant below — linkage, exact status/seed equality, lifecycle consistency, and full `serializeRide()` field accounting — must land before that ACK path is activated in the PWA.
- Terminal ride states `CANCELED`, `NO_SHOW` and `COMPLETED` cannot transition to a different state; saving the same terminal state is idempotent.
- `ride_events` is append-only. Polling advances by cursor and must not mutate history.
- Driver receipts are created only for completed rides and are write-once.
- PWA calls remain guarded. A live server route is not permission to activate a client cutover before its pilot blocker is closed.
- The service worker must continue to bypass `/api`; API responses are never an offline cache source.

### Matching selection identity

**Status: Current server contract; PWA runtime alignment shipped
(BD-RIDE-SELECTED-RESPONSE-IDENTITY-01A defined the contract, 01B implements
the PWA-side enforcement below — merged in PR #928).** This section does not
change the live route.

- **Request identity:** `POST /api/v1/matching/select` accepts exactly
  `{ orderId, driverId }`. `orderId` is the client-facing order business id and
  resolves the locked `orders.legacy_id` row. `driverId` is the driver's server
  user UUID exposed by `GET /api/v1/matching/offers` as `offer.driverId`.
- **Identifiers that are not inputs:** the server offer projection's `offer.id`
  and the PWA's browser-local/synthetic `responseId` are not accepted as
  substitutes for `driverId`. The server resolves the target live offer by the
  locked order plus the exact driver UUID.
- **Selectability:** the offer must belong to that order, still be `sent`, and
  not be expired. Missing, malformed, foreign, terminal, or expired candidates
  return a non-success response and produce no selection writes.
- **Authority and transaction:** only the authenticated order owner may select.
  One transaction locks the open order, accepts the target offer, rejects
  every other peer offer still in `status='sent'` (including one that is
  expired but not yet processed by the separate future TTL sweep), creates
  the `ACCEPTED` assignment, moves the order `CREATED -> ACCEPTED`, and
  attempts to bootstrap `trip_<orderId>` at `DRIVER_EN_ROUTE`. On a
  pre-existing `trip_id`, the current service rereads that row; the ACK section
  below freezes the complete direct conflict-Ride gate required before PWA
  cutover.
- **Success linkage:** the response returns `{ order, offer, assignment, ride }`.
  `offer.driverId` and `assignment.selectedDriverId` identify the same selected
  driver; `ride.tripId` is `trip_<orderId>`. A client-side response/chat id may
  be retained as local handoff metadata, but it cannot override these server
  identities. These public relations do not expose or prove the Ride row's
  hidden order/driver/passenger foreign-key equality; that remains a pilot gate
  defined below.
- **Conflict semantics:** concurrent selects have exactly one winner. A replay
  after the order is accepted currently returns `409 ORDER_NOT_OPEN`, including
  a replay for the same driver; idempotent success acknowledgement remains a
  future `BD-API-IDEMPOTENCY-01` (#826) concern.
- **PWA alignment (shipped, PR #928):** a click-time DOM/card id is intent
  only. `responses.js` re-resolves the exact current offer/card by requiring
  exactly one board candidate matching both DOM `driverId` and `responseId`
  simultaneously, then requires its canonical `offer.driverId` before any
  backend call, failing closed without an API call, local selection write,
  ride write, or navigation when the identity is stale, missing, foreign, or
  ambiguous (2+ matching candidates). An existing-ride pin-compatibility check
  runs both before the backend select call and again after it settles, closing
  a TOCTOU window where local state could change during the await. A pre-API
  pin mismatch fails closed with zero backend API calls, local order/ride
  writes, and navigation. A post-API pin mismatch fails closed after the
  fact — the server selection may already have succeeded — and prevents all
  subsequent local order/ride writes and navigation. The canonical Inbox
  demo order is excluded from backend authority even when the backend is
  enabled, so it never reaches the backend call at all. An ordinary canonical
  order with zero real local responses reconciles to the actual empty
  read/domain state (for both `state=list` and `state=selected`) instead of a
  stale non-empty board. It never substitutes a selected/first/latest driver.
  Behavioral negative-test coverage lives in
  `scripts/smoke-ride-selected-response-identity.mjs`.

### Matching select ACK handoff authority

**Status: Contract-only target (BD-RIDE-SELECT-ACK-AUTHORITY-01A, #931);
current PWA runtime gap; no route, server, schema, activation, or deployment
change.** The preceding identity gate remains shipped. This newer contract
defines how a later, separately authorized PWA slice must consume the already
live select acknowledgement instead of reconstructing a second local Ride.

- **Exact success envelope:** `POST /api/v1/matching/select` returns
  `{ order, offer, assignment, ride }`. A coherent 2xx ACK requires non-array
  objects and all of these exact relations:
  `order.id === orderId`, `order.status === 'ACCEPTED'`, a non-empty `offer.id`,
  `offer.orderId === orderId`, `offer.driverId === driverId`,
  `offer.status === 'accepted'`, `assignment.orderId === orderId`,
  `assignment.selectedDriverId === driverId`,
  `assignment.status === 'ACCEPTED'`,
  `ride.tripId === 'trip_' + orderId`, and
  `ride.status === 'DRIVER_EN_ROUTE'`. The two `driverId` relations
  (`offer.driverId`, `assignment.selectedDriverId`) canonicalize both sides to
  lowercase before `===`: PostgreSQL's UUID type and this route's validation
  are case-insensitive, but the serializers always emit normalized lowercase.
  Every other relation above stays a raw case-sensitive `===`.
- **Complete direct conflict-Ride gate:** the focused `serializeRide()`
  projection exposes `tripId`, status and participant/display snapshots, but no
  `orderId`, `driverUserId`, or `passengerUserId`. The PWA must not invent or
  require those public Ride fields, but the public ACK matrix is necessary
  rather than sufficient. Before returning the ACK, the server must account for
  both the persisted selection seed and every field `serializeRide()` would
  expose. It must first re-derive the expected seed via the same
  `buildRideSeed(order, acceptedOffer)` the insert path uses and verify the
  persisted conflict row agrees on every selection-owned field: `trip_id`,
  `order_id`, `status === 'DRIVER_EN_ROUTE'`, `role`, `driver_user_id`,
  `passenger_user_id`, `passenger_name`, `passenger_initials`,
  `passenger_phone_masked`, `passenger_note`, `driver_name`, `driver_car`,
  `driver_rating`, `route_pickup_label`, `route_dropoff_label`,
  `order_offer_price`, and `ride_price`. UUID identities (`driver_user_id`,
  `passenger_user_id`) compare lowercased, same as the ACK's `driverId`
  relations above; every other nullable/string/numeric seed field compares by
  the server's canonical representation, matching exactly what
  `bootstrapRide()` persists.
- **Serializer closure:** exact seed equality does not exhaust the public
  projection. The direct gate must also account for `passenger_rating`,
  `driver_initials`, `route_eta_to_pickup`, `route_eta_to_destination`,
  `cancel_by`, `cancel_reason`, and every serialized timestamp. On a fresh
  `DRIVER_EN_ROUTE` insert those six columns are `NULL`. A non-default
  passenger/driver/route value may reach the ACK only when a named server-owned
  source validates it for this exact selection; otherwise a server-owned
  projection must neutralize it to `NULL`/unavailable before
  `serializeRide()`. Cancellation metadata must remain `NULL` for this
  non-canceled status. The post-accept lifecycle columns `approaching_at`,
  `arrived_at`, `started_at`, `completed_at`, and `canceled_at` must also remain
  `NULL`; a populated value contradicts the initial lifecycle and cannot become
  authoritative by being hidden after serialization.
- **Database timestamps:** `created_at`, `accepted_at`, and `updated_at` remain
  excluded from exact equality to `buildRideSeed()` or a
  client/current-request clock. All three are nevertheless required to be
  present, parse as server timestamps, and satisfy the chronological relation
  `created_at <= accepted_at <= updated_at`. Every `serializeRide()` field is
  therefore either seed-proven, lifecycle-consistent, validated by a named
  server-owned source, or neutralized before serialization. The transaction and
  foreign keys do not establish these facts for an existing `trip_id`; the
  current conflict reread performs none of this validation. ACK consumption
  remains blocked until the complete gate is separately implemented.
- **Rollback on direct conflict-Ride invariant failure:** the complete gate must
  execute inside the select transaction before `COMMIT`. A conflict Ride that
  is missing, has any linkage or seed mismatch, is in any status other than
  `DRIVER_EN_ROUTE`, contains a serializer-only value that is neither validated
  nor neutralized, violates the fresh lifecycle defaults, or lacks
  chronologically coherent database timestamps must throw or otherwise force
  `ROLLBACK`, not return via the ordinary `{ err: ... }` result path that
  commits. This contract
  does not authorize an automatic refresh or overwrite of the conflicting row
  as an alternative to rollback. DB-gated transaction coverage must prove zero
  durable target-offer acceptance, peer rejection, assignment, order-status, or
  Ride writes after that failure and no authoritative Ride serialization or
  rendering. Focused negative coverage must exercise legacy/imported conflict
  rows whose linkage, seed fields, and `DRIVER_EN_ROUTE` status otherwise match
  but each serializer-only column is stale, each post-accept lifecycle timestamp
  is populated, or the core timestamps are missing/non-chronological. Every
  stale case left neither validated nor server-neutralized must produce full
  rollback and no authoritative rendering. This in-transaction gate governs
  only the current selection attempt's conflict reread; it must never recognize
  a terminal (`COMPLETED`, `CANCELED`,
  `NO_SHOW`) or otherwise non-`DRIVER_EN_ROUTE` conflict Ride as a coherent
  ACK. Terminal recovery is authorized exclusively through the read-side
  reconciliation below, gated on that path's own independent proof of the
  exact committed selection via authoritative order/offer/assignment/Ride
  linkage and an allowed lifecycle status — never gated on proving the
  acceptance predates the current request, since a correctly linked terminal
  Ride may equally be the product of the very ambiguous request being
  reconciled.
- **ACK authority:** after a coherent ACK, it owns both the selected identity
  and the initial handoff once the complete direct conflict-Ride invariant above
  is enforced. The PWA must
  navigate from `ack.ride.tripId`; it must not run `acceptOrder`,
  `acceptDriverResponse`, `buildPassengerRideSeed`, or a replacement
  `saveActiveRide` as success authority. The acknowledged Ride or the existing
  participant-gated Ride read is the hydration source.
- **Hydration before render:** the acknowledged or reconciled server Ride must
  reach Active Ride before the screen chooses a visible branch. A reconciled
  `COMPLETED`, `CANCELED`, or `NO_SHOW` Ride must be fetched or carried into the
  terminal renderer before its early return; `tripId` plus status navigation is
  not sufficient hydration. A reconciled `ACCEPTED` Ride is held to the same
  hydration and projection-truth rule — the PWA must render or hand it off from
  authoritative data, never a demo or locally fabricated Ride.
- **Truthful projection:** backend-authoritative rendering must never preserve a
  demo or stale local Ride participant, route, fare, vehicle, payment, or chat
  value when that field is absent from the ACK/read and every other explicitly
  named authoritative source. The follow-up must consume authoritative data or
  omit/render the missing section neutrally. The focused serializer currently
  exposes `driver.car` but no `vehicle`, `payment`, or `chat`; those gaps require
  explicit mapping, another separately authorized authoritative read/projection,
  or neutral UI — never merge-on-demo fallback.
- **Local metadata boundary:** browser-local/synthetic `responseId` may remain
  transient UI linkage only. It cannot replace `offer.driverId`,
  `assignment.selectedDriverId`, `ride.tripId`, Ride status, or a server-owned
  participant identity. No new backend-mode local Ride projection is required
  at the select seam.
- **Local conflict after commit:** a stale or incompatible local
  `trip_<orderId>` mirror cannot veto a coherent ACK. A later runtime slice must
  ignore, evict, or quarantine it before the authoritative handoff; cleanup is
  not a second local success write.
- **Responses revisit:** reopening `/responses` for the same backend order must
  reconcile authoritative accepted or terminal state before showing an
  empty/selectable board. The exact `ack.order` may replace, or the client may
  evict, the transitional cached `CREATED` order as replaceable UI cache only;
  no synthesized `acceptOrder` transition or local Ride is permitted. The
  accepted offer plus a linkage-validated Ride read drive the handoff. Pending,
  failed, malformed, or inconclusive reads render loading/error/uncertain state,
  never an empty board or demo fallback that hides a committed trip.
- **Malformed 2xx / HTTP 5xx / transport ambiguity:** never reconstruct local
  success and never blindly repeat the select mutation. Every HTTP 5xx observed
  after dispatch, including a proxy-generated `502` or `504`, is uncertain; it
  does not prove that the selection transaction failed or rolled back. Reconcile
  all of these outcomes with both owner
  `GET /api/v1/matching/offers?orderId=...` and participant
  `GET /api/v1/ride-state/rides/trip_<orderId>`. Recovery requires exactly one
  accepted offer plus the exact Ride in a valid post-selection lifecycle state
  (`ACCEPTED`, `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`,
  `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`, or `NO_SHOW`).
  `ACCEPTED` is recoverable only through this read-side path; the direct
  in-transaction ACK gate above still requires the conflict/inserted Ride to
  be exactly `DRIVER_EN_ROUTE`. The offers read proves canonical driver identity; the Ride read alone cannot,
  because its public serializer exposes no driver UUID. Recovery does not
  inherit proof from the direct-ACK gate: `409 ORDER_NOT_OPEN` returns before
  that gate, and legacy/imported accepted orders may predate it. Before recovery
  may navigate, a server-owned check must independently validate that the
  authoritative owner order has `status === 'ACCEPTED'` and that the persisted
  Ride's order/driver/passenger/canonical-trip linkage agrees with that order,
  one accepted offer, the `ACCEPTED` assignment, and the authenticated owner.
  This gate applies to every pre-existing accepted order. An existing recovery
  read/coordinator may enforce it, or a separately authorized validated
  backfill/migration may establish the invariant before cutover; participant
  access and deterministic `tripId` are not proof. Missing proof, any mismatch,
  or any authoritative owner-order status other than `ACCEPTED` stays uncertain
  with no navigation. Focused recovery coverage must reject a partial/imported
  state where the offer and assignment are accepted and the Ride linkage
  otherwise agrees, but the authoritative owner order remains `CREATED`.
  Linkage, order status, and Ride lifecycle proof alone do not authenticate the
  serialized display snapshot. Server-owned recovery validation or a validated
  backfill must prove that persisted passenger, driver, route, and fare values
  agree with the applicable authoritative acceptance-time source. A field that
  cannot be validated must be omitted/null or explicitly projected unavailable
  and rendered neutrally, never used as display authority. Focused recovery
  coverage must include a correctly linked legacy/imported Ride with an allowed
  lifecycle but stale or unrelated passenger/driver/route/fare snapshots and
  prove that none of those unverified values is rendered.
- **Stable-negative proof:** one observation with no accepted offer and a `404`
  Ride is not proof that no commit occurred; both reads can race a select
  transaction that is still able to commit. Only server-coordinated
  stable-negative proof or a separately specified bounded-recheck protocol that
  observes both reads stably negative after the original mutation can no longer
  commit may close the uncertain outcome. Until then, and when bounded rechecks
  are exhausted or inconclusive, there is no success claim, navigation, local
  reconstruction, or repeated select mutation.
- **Conflict semantics:** `409 ORDER_NOT_OPEN` says only that the order is not
  open. It does not prove that another driver won and also occurs on a
  same-driver replay. Use the same read-side reconciliation before describing
  the winner. If the requested driver is the accepted offer and the Ride agrees,
  recover the committed success; if another driver is accepted, do not claim
  the requested selection succeeded, but the read Ride is the authoritative
  existing handoff. Inconclusive or disagreeing reads stay uncertain with no
  automatic mutation replay. Broad idempotent-success semantics remain #826.
- **Backend-off preservation:** the local prototype keeps its exact-response ->
  local order accept -> pure Ride seed -> local Ride persistence chain. This
  contract does not make those stores server authority or remove the fallback.
- **Runtime status:** `public/src/screens/responses.js` currently discards the
  successful envelope, reconstructs a same-device local Ride, and lets a
  post-API local pin mismatch block navigation. Without that local success
  chain, a later `/responses` visit currently rereads a stale local `CREATED`
  order, filters the accepted server offer out of the selectable board, and has
  no local Ride handoff, so it can render a false empty state. In addition,
  `active_ride_passenger.js` chooses terminal renderers before starting the
  participant read, and its merge path preserves demo vehicle/payment/chat
  sections that the focused Ride serializer omits. These are explicitly
  recorded gates for the separately authorized
  `BD-RIDE-SELECT-ACK-AUTHORITY-01B — Consume authoritative select ACK in Passenger PWA`;
  01B must also wait for two separately authorized server-side gates: the
  complete direct conflict-Ride invariant (persisted
  order/driver/passenger/trip linkage, exact `DRIVER_EN_ROUTE` status,
  selection-owned equality against the canonical seed, lifecycle-consistent
  timestamps, and validated-or-neutral accounting for every additional
  `serializeRide()` field, with full transaction rollback and no authoritative
  rendering on any failure) on the `trip_id` conflict reread, and the
  separate recovery acceptance/linkage invariant (authoritative owner-order
  `status === 'ACCEPTED'`, independent linkage proof, and an allowed Ride
  lifecycle status) on every recovery path, including legacy accepted rows.
  Every serialized recovery snapshot must also be validated/backfilled or
  projected complete-or-neutral for unverified fields; this does not impose the
  direct gate's blanket current-seed equality on historical rows. Focused
  coverage must pin the `/responses` revisit, HTTP 5xx reconciliation, the
  pre-commit negative-read race, and both server gates independently. Direct
  negative cases must include legacy/imported conflict rows with matching
  linkage/seed/status but stale non-seed serialized values or invalid timestamp
  presence/order; recovery cases must include an authoritative owner order
  still in `CREATED` and coherent linkage/lifecycle with stale
  passenger/driver/route/fare snapshots. None of these runtime/backend changes
  is implemented or activated by this documentation change.

### Ride transition authority - NO_SHOW

This is a contract-only staging-pilot rule. It does not activate the PWA backend seam and does not introduce a new ride status.

- **Canonical status:** `NO_SHOW` remains the existing terminal `RIDE_STATUS`; no `NO_SHOW_PENDING` or parallel lifecycle state is introduced.
- **Endpoint:** `PATCH /api/v1/ride-state/rides/:tripId/status` with `{ "status": "NO_SHOW" }`.
- **Authority:** the authenticated session user must be the assigned ride driver. Client-supplied role or cancel actor fields never grant authority.
- **Allowed transition:** `WAITING_PASSENGER -> NO_SHOW`.
- **Server-derived fields:** `status=NO_SHOW`, `cancel_by=driver`, `cancel_reason=passenger_no_show`, `canceled_at` from server time.
- **Transaction:** lock ride -> validate actor and from-state -> update ride -> append status-change event -> commit.
- **Idempotent replay:** `NO_SHOW -> NO_SHOW` returns the acknowledged ride without re-stamping the terminal timestamp or duplicating the ride event.
- **Wrong actor:** passenger attempt -> `403 FORBIDDEN`.
- **Wrong non-terminal from-state:** driver attempt outside `WAITING_PASSENGER` -> `409 RIDE_TRANSITION_NOT_ALLOWED`.
- **Different terminal state:** existing terminal freeze -> `409 RIDE_TERMINAL`.
- **Ownership:** role/actor enforcement belongs to #830 `BD-AUTH-POLICY-01`; retry/conflict/idempotency belongs to #826 `BD-API-IDEMPOTENCY-01`.
- **Migration:** none for this contract slice; existing rides schema already carries cancel actor/reason and terminal timestamp.
- **Activation:** this docs contract does not authorize server/runtime implementation or client cutover.

## Pilot blockers and delivery slices

| Slice | Depends on | Exit condition |
|---|---|---|
| **BD-BACKEND-BASELINE-01** (#821) | Epic #820 | Live/dark matrix, ownership, envelopes, checks and docs are reconciled. |
| **BD-BACKEND-DEPLOY-01** (#823) | Baseline | Staging API/PostgreSQL 16 deploy and rollback are reproducible. |
| **BD-AUTH-HARDEN-01** (#824) | Baseline + staging | OTP delivery, per-phone/IP throttling and no-code-echo policy are tested. |
| **BD-AUTH-SESSION-01** (#829) | Auth hardening | Session transport, expiry, rotation and revocation are frozen and tested. |
| **BD-AUTH-POLICY-01** (#830) | Session lifecycle | Granted roles and minimum driver readiness are server-enforced. |
| **BD-CHAT-AUTH-01** (#825) | Session + role policy | Sender identity is session-derived and limited to order/ride participants. |
| **BD-API-IDEMPOTENCY-01** (#826) | Frozen endpoint contracts | Mutation retries and concurrency preserve exactly-once/write-once invariants. |
| **BD-E2E-MULTIDEVICE-01** (#831) | Auth, policy, chat and idempotency | Two sessions complete the PostgreSQL 16 vertical slice. |
| **BD-OBS-PILOT-01** (#827) | Staging + vertical slice | Redacted logs, metrics, alerts, backup/restore and rollback are rehearsed. |
| **BD-BACKEND-ACTIVATE-01** (#828) | All prior gates | Staging activates first; production pilot is allow-listed and reversible. |

## Pilot envelopes and error codes

The pilot contract preserves each endpoint's current success body; introducing a global success wrapper requires a versioned contract change. Product-route errors cross the API boundary as a stable JSON object:

```json
{
  "error": "Human-readable summary",
  "code": "STABLE_MACHINE_CODE",
  "retryable": false
}
```

Operational exception: `GET /api/v1/readyz` does not use the product problem object. A failed readiness check returns HTTP 503 as `{ status: 'degraded', db: 'down' | 'schema-incomplete' }`; success is `{ status: 'ready', db: 'up' }`. Neither envelope includes `error`, `code` or `retryable`.

The route-owned machine-code inventory below is descriptive of the existing routes. The server fallback also preserves Fastify `err.code` for non-validation 4xx failures, so those framework codes are an explicit part of the current boundary. Changing or normalizing a code requires an explicit contract update rather than a silent PWA translation:

| Boundary | Current success envelope(s) | Current machine codes |
|---|---|---|
| Operational health/readiness | `{ status, service }`, `{ status, db }` (including readiness HTTP 503) | None; `/readyz` failure intentionally bypasses the product problem object |
| Auth/session | `{ user }`, `{ ok, expiresInSeconds, devCode? }`, `{ token, user }` | `SESSION_LOOKUP_FAILED`, `INVALID_PHONE`, `OTP_INVALID`, `OTP_LOCKED`, plus uniform `VALIDATION` |
| Orders | `{ items }`, `{ order }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, plus uniform `VALIDATION` |
| Matching/offers/select | `{ offer }`, `{ items }`, `{ order, offer, assignment, ride }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `ORDER_NOT_FOUND`, `CANNOT_OFFER_OWN_ORDER`, `ORDER_NOT_OPEN`, `FORBIDDEN`, `CANNOT_SELECT_SELF`, `OFFER_NOT_FOUND`, plus uniform `VALIDATION` |
| Ride state | `{ ride }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `RIDE_NOT_FOUND`, `FORBIDDEN`, `INVALID_STATUS`, `RIDE_TERMINAL`, plus uniform `VALIDATION` |
| Realtime poll | `{ tripId, status, events, cursor }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `RIDE_NOT_FOUND`, `FORBIDDEN`, `VALIDATION` |
| Chat | `{ items }`, `{ message }` | `INTERNAL`, plus uniform `VALIDATION`; authentication/participant errors do not exist yet and are a pilot blocker |
| History/receipts | `{ items }`, `{ receipt }` | `SESSION_LOOKUP_FAILED`, `UNAUTHENTICATED`, `RIDE_NOT_FOUND`, `FORBIDDEN`, `RIDE_NOT_COMPLETED`, plus uniform `VALIDATION` |
| Dark routes | problem object | `NOT_IMPLEMENTED` |
| Uniform server fallback | problem object | `VALIDATION`, `NOT_FOUND`, `INTERNAL`, `BAD_REQUEST`; other non-validation 4xx preserve Fastify `err.code`, including `FST_ERR_CTP_EMPTY_JSON_BODY` and `FST_ERR_CTP_INVALID_JSON_BODY` |
| Client-only transport | n/a | `BACKEND_DISABLED`, `NETWORK`, `ABORTED`, `HTTP_<status>`, `UNKNOWN` |

A route that currently emits a different code is a baseline mismatch to resolve in its implementation slice, not a reason to silently translate errors in the PWA.

## Purpose of Mini Yonder Backend Spine

Mini Yonder Backend Spine answers one question:

```text
Where is a feature broken across the data chain?

screen → frontend state → API contract → service rule → database table → migration → check → issue
```

It should make backend and database gaps visible before a UI screen grows into a polished but unsafe mock.

## Feature screens

| Screen | Purpose | First data source |
|---|---|---|
| Backend Spine | Module map for Auth, Profiles, Orders, Responses, Rides, Chat, Media, Notifications and Reports. | Static catalog |
| Data Trace | One selected screen traced through state, API, database, smoke and issue. | Screen contract + catalog |
| API Contracts | Endpoint cards with auth, role guard, transaction and DB writes. | API catalog |
| DB Schema | Tables, relations, migrations and missing constraints. | DB catalog |
| Contract Diff | Frontend/API/DB mismatch detector. | Contract catalogs |
| Issue Generator | Generates a scoped backend prompt/issue from detected gaps. | Diff findings |

## Build integration

This slice updates governed docs, not runtime:

```text
docs-site/docs/processes/backend-spine-inspector.md
server/README.md
```

The page must remain governed by the Mini Yonder frontmatter passport and visible from `sidebars.js`. Required repository checks are:

```bash
cd docs-site && npm run check
node scripts/check.mjs
node scripts/dispatcher.mjs
```

## Runtime boundaries

This docs baseline must not touch:

- `public/` runtime PWA files;
- `public/sw.js` or service worker cache lists;
- CSP in `public/index.html`;
- Mapbox loaders, adapters or token policy;
- backend server code;
- database migrations.

The Inspector remains a docs/catalog feature. The server baseline above describes existing runtime; it does not activate or modify it.

## Future catalog shape

A future catalog slice may introduce machine-readable files such as:

```text
public/src/yonder/backend_catalog.js
public/src/yonder/api_catalog.js
public/src/yonder/db_catalog.js
public/src/yonder/contract_diff.js
```

The docs-site equivalent can later mirror those catalogs under `docs-site/governance/` if Mini Yonder needs to validate them as governed docs data.

## Backend contract fields for screen contracts

Each critical screen contract should include:

```text
Backend contract:
- API endpoints
- DB tables
- DTO input
- DTO output
- auth guard
- role guard
- status authority
- transaction required
- migration needed
- smoke needed
```

## Detection rules

Mini Yonder Backend Spine should flag:

1. screen status is missing from the backend enum;
2. critical status can be changed from frontend only;
3. endpoint is live but has no required role guard;
4. endpoint writes several tables but has no transaction requirement;
5. route coordinates exist in UI but have no DB fields;
6. passenger and driver snapshots share a mutable object;
7. ride history mirrors between roles;
8. chat is not authorized against its order or ride;
9. migration exists without smoke coverage;
10. smoke exists but does not pin the authority boundary;
11. a PWA cutover is active while its backend module is dark or pilot-blocked.

## Working issue

This baseline is delivered by **BD-BACKEND-BASELINE-01 (#821)** under **Epic #820**.

In scope:

- reconcile the server README, Backend Spine and data-layer documentation;
- record live, dark and pilot-blocked modules;
- pin auth/role authority, DB ownership, PWA seams and test ownership;
- freeze pilot envelope/error-code expectations;
- leave runtime and migrations unchanged.

## Acceptance checklist

- [x] Current-state matrix names each module as live, dark or pilot-blocked.
- [x] Auth/role guard, DB ownership, PWA seam and verification owner are recorded.
- [x] Pilot envelope and error-code policy is explicit.
- [x] Runtime PWA, backend code, migrations, service worker, CSP and Mapbox are out of scope.
- [ ] `cd docs-site && npm run check` passes.
- [ ] `node scripts/check.mjs` passes.
- [ ] `node scripts/dispatcher.mjs` passes.
