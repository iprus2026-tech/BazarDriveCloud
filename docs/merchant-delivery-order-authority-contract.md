# BD-MERCHANT-DELIVERY-ORDER-AUTHORITY-01A

Status: contract-first / docs-only

Issue: #979

Baseline: `main@7ddb3971f078da93193b5cf22413ddb3aabf40ae`

Architecture: Merchant / Delivery Order / Quote boundary / Cargo policy / Backend API / PostgreSQL / Privacy

## Purpose

Freeze the minimum server-authoritative model that turns a merchant's stated
delivery intent into a single authoritative **Delivery Order**, without reusing
passenger ride-order authority, without letting a WhatsApp/SMS message or an
intake draft become the order, and without letting a resolved contact context
authorize an economically binding order.

Concretely, this slice freezes the funnel:

```text
inbound merchant message
      -> non-authoritative Delivery Draft (recipient + cargo + pickup/dropoff intent)
      -> server Quote (priced, time-bounded)   [computation owned by Quote Authority]
      -> AUTHORIZED_MERCHANT_ACTOR approval
      -> ONE authoritative Delivery Order       [created here, immutable core]
      -> driver dispatch                        [owned by Dispatch Authority]
```

This slice is contract-only. It adds no migration, repository runtime, route,
PWA behavior, WhatsApp/Peach automation, webhook, pricing computation, driver
dispatch, or delivery execution state machine.

The worked business case throughout is a synthetic seafood merchant ("Морской
Разливной"): cooked and live crayfish are deliverable cargo; bottled alcohol is
in-store-only and is never dispatched to a driver.

## Existing anchors

This contract composes with the current BazarDriveCloud backend instead of
creating a parallel order space.

- `docs/merchant-identity-contact-authority-contract.md`
  (`BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01A`, frozen) and
  `server/migrations/0009_merchant_identity_contact_authority.sql`
  (`-01B`, merged, dark).
  - `merchants`, `merchant_memberships`, `merchant_locations`,
    `external_contact_identities`, `merchant_contact_bindings` are the identity
    and pickup-location anchors. This contract adds delivery order state; it does
    not add identity state.
  - `resolveAuthorizedMerchantActor(...) -> AUTHORIZED_MERCHANT_ACTOR(U, M)` is
    the composed actor gate a channel approval must pass. 01B's own note applies:
    that resolver is a read-side current-state snapshot, so a state-changing
    order-creation path MUST re-resolve the actor inside its own write
    transaction/lock boundary immediately before it creates the order.
    `resolveMerchantMembership(...)` is the equivalent gate for an authenticated
    session actor.
  - Merchant pickup location resolves from ACTIVE `merchant_locations`
    (default or explicit). Recipient addresses are never written there.
- `server/migrations/0001_phase1_init.sql`
  - `orders` / `rides` are **passenger** ride authority. `orders.passenger_id`,
    `orders.passenger_snapshot`, `orders.type IN ('ride_order','passenger_request')`,
    `orders.source IN ('feed','map')`, `orders.estimated_price`, `rides.*`, the
    12 RIDE_STATUS literals, and `rides_freeze_terminal()` are passenger-specific
    and must not be repurposed for merchant delivery.
- `server/src/services/matching/index.js` and `server/src/repositories/offers.js`
  - passenger price discovery is driver bids + order-owner selection
    (`driver.price || request.price`). A merchant Delivery Order price is a
    server Quote the merchant approves, not a driver bid the recipient selects.
- `server/src/repositories/notification_outbox.js` and its frozen contract
  - the precedent that an authoritative row is immutable, server-stamped,
    provenance-bearing, never hard-deleted, and that operational logs carry
    stable codes and correlation IDs, not raw payloads.
- `docs-site/docs/processes/backend-spine-inspector.md` (BD-DOCS-042)
  - the LIVE / DARK / PILOT-BLOCKED vocabulary. No merchant/delivery route
    exists today; this slice does not add one.

No existing passenger order, ride, matching, driver-authority, or auth enum is
widened by this slice.

## Problem

A merchant delivery introduces structure the passenger ride-order model cannot
represent correctly:

1. The price is a **server quote the merchant approves**, not a fare discovered
   by driver bids and recipient selection.
2. The paying/authorizing party (merchant actor) is not the receiving party
   (recipient), and the recipient is not a BazarDrive user.
3. Pickup is a **persistent merchant location**; the destination is
   **per-delivery recipient data**. A passenger order has one route the same
   person owns end to end.
4. A message or an intake draft is not an order. A draft may legitimately be
   built from an unlinked / merely `OBSERVED` contact; an order may not.
5. Cargo has a **server-owned deliverability policy**. Cooked crayfish and live
   crayfish are deliverable; bottled alcohol is in-store-only. The merchant does
   not get to declare alcohol deliverable, and message text does not decide it.
6. "Deliver to two addresses" is two orders, not one order with two recipients.
   Batching several orders onto one driver trip is a separate route entity.
7. A retried approval (adapter redelivery, user double-tap) must not create a
   second order.
8. Approval must fail closed against merchant suspension/closure, membership
   revocation, quote expiry, and pickup-location archival that happen between
   quote and approval.
9. Recipient PII (name, phone, destination, entrance/floor/door code, requested
   time) is bounded per-order operational data, not profile data and not a log
   field.
10. **Cancellation is itself an authority action.** Merchant cancel changes an
    economically-relevant state, so it must lock the order and its source draft,
    derive the merchant from those rows, and re-validate `AUTHORIZED_MERCHANT_ACTOR`
    under the same authority locks — not trust a read-side check or a
    client-named order id.
11. **A quote races the approval that consumes it.** Quote publish / supersede /
    invalidate must serialize on the same per-draft lock the approval takes, or
    "approve only the current quote" is timing-dependent.
12. **Row-level tenant and provenance binding.** A persisted `delivery_order`'s
    `merchant_id` must equal its source draft's, its pickup must belong to that
    merchant, and its recipient snapshot must be immutable — each enforced by a
    DB constraint / its own guard trigger, not only by the approval query.
13. **Resolved-point and policy-activation edges.** A pickup `merchant_locations`
    row may legitimately lack coordinates (`0009` permits `lat`/`lng` both null)
    yet a delivery needs a routable pickup point fixed before pricing; and a
    process-local cargo-policy constant needs a coordinated activation across
    replicas, not an after-the-fact `policy_version` note.

## Source of truth

The target authority chain layered on top of 01A/01B:

```text
external_contact_identity / users
        |
        |  (channel actor gate)        (session actor gate)
        v                                     v
resolveAuthorizedMerchantActor        resolveMerchantMembership
        \___________________  ________________/
                            \/
                 AUTHORIZED_MERCHANT_ACTOR(U, M)   <- re-resolved in the write txn
                            |
   delivery_draft  --------->|<---------  server quote (priced, expires_at,
   (non-authoritative)       |            delivery_input_fingerprint)
                            v            [internals owned by Quote Authority]
                    delivery_order   (AT MOST ONE per draft, ever; immutable core)
                            |
                            v
              dispatch / execution   [owned by downstream slices]
```

Distinct concepts, none of them interchangeable:

- `delivery_draft` = a non-authoritative capture of one requested delivery
  (one recipient, one destination, cargo intent, pickup intent). It can be
  edited, abandoned, or expired. It authorizes nothing.
- server **quote** = a priced, time-bounded server computation attached to a
  draft, carrying a `delivery_input_fingerprint` over the exact inputs it priced.
  Its computation, reprice, expiry policy, and fingerprint algorithm are owned by
  `BD-MERCHANT-QUOTE-AUTHORITY-01A`; this contract owns only the boundary — an
  order references the exact approved quote snapshot; an expired, superseded, or
  input-stale quote cannot become an order.
- `delivery_order` = the single authoritative record that a specific merchant
  actor approved a specific quote for a specific recipient/destination/cargo.
  Its core is immutable after creation; a draft yields at most one, ever.
- delivery **route / batch** = a separate downstream entity that groups several
  `delivery_order`s onto one driver trip. It is never a column on
  `delivery_order` and never a second recipient.

## Core distinction: quote != order != draft

```text
draft      : intent, mutable, non-authoritative, may come from OBSERVED contact
quote      : price + expires_at + delivery_input_fingerprint, attached to a draft
order      : created ONLY by AUTHORIZED_MERCHANT_ACTOR approval
             x current, unexpired quote
             x fingerprint still matches the confirmed inputs + resolved pickup
```

- Editing a draft never edits an order; `QUOTED -> APPROVED` and order creation
  are one atomic transaction (invariant 6), reached only from `QUOTED`.
- A quote binds to the exact delivery inputs it priced. **Mutating any confirmed
  input on a `QUOTED` draft — recipient, contact, destination, access note,
  window, cargo — or changing the resolved pickup content drops the draft back to
  `OPEN` and stales the quote** (`QUOTE_STALE` on approval); a fresh quote is
  required.
- Approving an **expired** quote does not create an order (`QUOTE_EXPIRED`); an
  `AUTHORIZED_MERCHANT_ACTOR` must obtain a fresh quote and approve that.
- Approving a **superseded** quote (a newer quote exists for the draft) is
  rejected (`QUOTE_SUPERSEDED`); approval must name the current quote id.
- A later reprice creates a new quote; it never mutates an already-created order.
- The order snapshots the approved quote's boundary fields, including its
  `delivery_input_fingerprint` (see **Quote boundary contract**), so it is
  readable without walking back into quote history.
- A retry that names the exact `(draft_id, quote_id)` of an existing order is a
  **recovery**: after the access check and an **integrity check** (order's
  `merchant_id == M`, locked source draft is `APPROVED`), it returns that order —
  in any state, including `CANCELED` — with zero writes. An exact-pair order whose
  draft was never `APPROVED` is a `DELIVERY_ORDER_STATE_INCONSISTENT` integrity
  fault, not a recovery (see **Idempotency and recovery**).

## Authority invariant 1: merchant delivery does not reuse passenger order authority

This slice does NOT:

- add `merchant_id`, cargo, recipient, or quote columns to `orders`;
- write a merchant or a recipient into `orders.passenger_id` /
  `rides.passenger_user_id`;
- reuse `orders.status` / RIDE_STATUS / `rides_freeze_terminal()` for delivery
  order lifecycle;
- reuse `offers` / `matching/select` (driver-bid + owner-select) for delivery
  pricing or approval;
- model a recipient as a passenger, or a Delivery Order as a ride.

`delivery_order` is a separate domain entity with its own table(s), its own
status vocabulary, and its own immutability trigger, mirroring the *pattern* of
the passenger side without sharing its rows or enums.

## Authority invariant 2: message and draft are transport/intent, not authority

WhatsApp / Peach / SMS carry the request. A `delivery_draft` captures it. Neither
owns:

- whether an order exists;
- the approved price;
- the approving actor's identity;
- cargo deliverability;
- dispatch or execution state.

A draft may be created and refined from a contact that is `ACTIVE` but not
`VERIFIED` and not `linked_user_id` (per 01A's Delivery-Draft allowance). Crossing
from draft to order requires the composed actor gate. Provider/message ids are
provenance only.

## Authority invariant 3: one order, one recipient, one destination

```text
delivery_order  --1:1-->  delivery_order_recipient_snapshot
                          (name, contact, destination, access note, window)
```

- A merchant asking to deliver to R1 and R2 produces two drafts, two quotes,
  two orders — each with its own recipient snapshot.
- A `delivery_order` has exactly one destination point and one recipient contact,
  in one immutable snapshot child row.
- Multi-stop batching is a separate `delivery route / batch` entity created by
  `BD-MERCHANT-DELIVERY-DISPATCH-01A` that references N `delivery_order`s. It does
  not add a second recipient to any order and does not exist in this slice.

## Authority invariant 4: pickup is merchant location, destination is recipient data

- Pickup for a `delivery_order` is resolved from ACTIVE `merchant_locations`
  (default, or an explicit location supplied with the draft/approval) **whose
  `merchant_id` equals the draft's `merchant_id`**. If no unambiguous ACTIVE
  same-merchant pickup location resolves, order creation fails closed with
  `MERCHANT_LOCATION_REQUIRED` (01A code); it never guesses and never uses
  recipient data as pickup.
- Same-merchant ownership is enforced in the approval query **and** as a database
  invariant — a **composite FK** `delivery_order (pickup_location_id, merchant_id)
  -> merchant_locations (id, merchant_id)` (or an equivalent validation trigger);
  a plain cross-table `CHECK` cannot express it. The composite FK needs a
  redundant `UNIQUE (id, merchant_id)` on `merchant_locations` — an additive
  index the schema slice adds, changing no 01B semantics.
- **The order's `merchant_id` is bound to its source draft at the row level.**
  `delivery_order.draft_id` and `delivery_order.merchant_id` are both `NOT NULL`,
  and a **composite FK** `delivery_order (draft_id, merchant_id) -> delivery_draft
  (id, merchant_id)` (backed by a redundant additive `UNIQUE (id, merchant_id)` on
  `delivery_draft`), or an equivalent guard trigger, forces
  `delivery_order.merchant_id == delivery_draft.merchant_id`. Two independent
  single-column FKs are **not** sufficient — a secondary writer / backfill could
  otherwise persist an order whose `draft_id` belongs to merchant B while its
  `merchant_id` (and pickup provenance) belong to A, and exact-pair recovery would
  then authorize against B from the locked draft while returning an A-provenance
  order (Idempotency and recovery, race row 24).
- **The resolved pickup location must carry coordinates.** `0009` permits an
  ACTIVE `merchant_locations` row with `lat` and `lng` both null; a *delivery*
  pickup additionally requires a canonical **resolved pickup point** (coordinates
  + provider/place provenance), fixed before quoting exactly like the resolved
  `destination_point`. A resolved / explicit pickup whose coordinates are null is
  unusable → `DELIVERY_PICKUP_UNRESOLVED` (no guess, no approval-time geocode).
  The point is carried into `pickup_snapshot` and the fingerprint, so later
  routing never re-geocodes into a different one.
- The destination is recipient-supplied per-delivery data. It is never inserted
  into `merchant_locations` and never promoted to merchant identity. Its
  **resolved point** (coordinates + provider/place provenance) is fixed before
  quoting and carried into the order snapshot and the fingerprint.
- The order stores a pickup **snapshot** (location id + label + address text +
  resolved coordinates + bounded pickup instructions + default flag as they were
  at approval, read under the pickup-row lock) so later location edits do not
  rewrite a created order.

## Authority invariant 5: cargo deliverability is server-owned policy

Every `delivery_order` carries a non-empty list of cargo **lines**
`{ category_code, quantity, unit }`. **Deliverability is decided over the
category set**; `quantity` / `unit` are carried (in the draft, the fingerprint,
and the immutable order snapshot) for quote binding, vehicle-capacity selection,
handling requirements, and proof of what the merchant approved — the
capacity/handling checks themselves are downstream, and `resolveCargoDeliveryPolicy`
is **not** extended with them here. Each category maps, via a server-owned
policy, to a deliverability class:

| Cargo category | Deliverability | Notes |
| --- | --- | --- |
| `COOKED_CRAYFISH` | `DELIVERABLE` | Standard prepared-food handling. |
| `LIVE_CRAYFISH` | `DELIVERABLE` | Live cargo; time/temperature handling constraints are enforced by the Execution slice, not here. The category itself is deliverable. |
| `ALCOHOL` | `NOT_DELIVERABLE` (`IN_STORE_ONLY`) | An order whose cargo set contains `ALCOHOL` cannot reach an authoritative order state. A draft may record the merchant's stated intent, but order creation is rejected with `CARGO_NOT_DELIVERABLE`. |

Rules:

- the policy is a **server-owned, versioned constant** in the initial runtime,
  behind a `resolveCargoDeliveryPolicy(categorySet) -> { class, reason,
  policy_version }` interface — **not** a mutable admin-editable table (that
  would add another authority surface with its own audit, admin UI, and
  misconfiguration risk). A future move to a versioned policy store is an ordered
  follow-up, not a hole in this contract;
- the merchant actor does not choose a category's deliverability, and message
  text does not set it;
- an unknown category code is `CARGO_CATEGORY_UNKNOWN` (fail closed), never
  silently treated as deliverable;
- `ALCOHOL` anywhere in an order's cargo set blocks the whole order
  (`CARGO_NOT_DELIVERABLE`); a mixed cooked-crayfish + alcohol request must be
  split by the merchant into a deliverable order plus an in-store item;
- the resolver is called over the **whole cargo set** and fails closed on the
  first non-deliverable/unknown member; incompatible handling requirements among
  otherwise-deliverable members are a separate `policy result` for the Execution
  slice, not a reason to split one recipient/stop into multiple orders;
- order creation re-checks deliverability against the **current** policy — the
  constant active on the replica running the transaction — so a category that
  becomes non-deliverable between quote and approval blocks the approval; the
  resolved `policy_version` is recorded on the order **for audit only**, not as
  the coordination mechanism;
- the policy vocabulary is extended only by an ordered contract change, like the
  01A channel enum.

### Policy-version activation (deployment contract)

`resolveCargoDeliveryPolicy` is a **process-local versioned constant**, so a
version change is **not** atomic across replicas: during a rolling deploy an old
process still answers with the previous constant and could approve a category
newer replicas already forbid. `cargo_policy_version` on the order records which
constant cleared the cargo *after the fact*; it does not make "current policy"
fail-closed by itself.

A policy-class or vocabulary change is therefore an **explicitly coordinated
activation**, not an ordinary deploy:

1. stop admitting new **creation-branch** approvals on **all** writers
   (`CARGO_POLICY_TRANSITION`, retryable);
2. drain in-flight approval transactions;
3. confirm no replica still running the old constant remains;
4. activate the new constant everywhere;
5. resume admitting creation-branch approvals.

If any step cannot be confirmed, creation **stays blocked** (fail-closed) — a
stalled activation never silently falls back to mixed constants. **Recovery**
does not re-check cargo policy, so an order already approved under the old
constant stands unchanged. This keeps the versioned-constant model (no mutable
policy store) while making the cross-replica transition honest; a future move to
a coordinated policy store is still an ordered follow-up (Explicit non-goals).

This is the **BazarDrive merchant-delivery product policy**, not a universal
legal statement about any category. `ALCOHOL = IN_STORE_ONLY / NOT_DELIVERABLE`
means only that BazarDrive does not dispatch a driver for it in this product —
nothing more.

## Authority invariant 6: approval and order creation are one atomic transaction

Invariant 6 governs the **creation** branch of the approval transaction (a
**recovery** performs the access check and returns the existing order with zero
writes — see **Order-creation authority**).

### Transaction locking and lock order

The re-validation below is only fail-closed if every row a concurrent mutation
could change is **held under a row lock** for the duration of the transaction,
acquired in one fixed order. Merely running the 01B resolvers — which today do
non-locking reads — inside a transaction does **not** close the TOCTOU race.

**Channel-actor discovery is not authorization.** A channel approval first does a
**non-authoritative** read of the canonical `external_contact_identities` row for
`(channel, subject_namespace, canonical_subject_key)` to obtain a *candidate*
`linked_user_id` (`U`) — solely so the transaction knows which
`merchant_memberships` row to lock and in what order. This pre-lock lookup
authorizes nothing; every fact it read is re-verified under the locks below (see
**Approver parity**). A session actor already has an authoritative `U` from the
session and skips this step.

Lock order (skip rows not relevant to the actor kind; take each `FOR UPDATE`):

1. `delivery_draft` (the row named by `draft_id`); set `M :=
   delivery_draft.merchant_id`.
2. the actor's ACTIVE `merchant_memberships` row for `(M, U)`
   (`lockActiveMerchantMembership`) — for a channel actor, `U` is the candidate
   from discovery.
3. `merchants(M)` — the row `= delivery_draft.merchant_id` (`lockMerchantById`).
4. channel actor only: the `external_contact_identities` row (`FOR UPDATE`), then
   the ACTIVE `merchant_contact_bindings` row (`FOR UPDATE` — a
   `lockActiveMerchantContactBinding` primitive the schema slice adds; it does
   not change 01B behaviour).

The resolved pickup `merchant_locations` row is **not** part of this shared
chain: it is locked (`lockMerchantLocationById`) **only in the creation branch,
at step 5a** — after `merchants(M)` is already held, so the merchant-default
boundary is covered — and never on the recovery path.

**Membership before `merchants(M)`** is the order 01B's own last-ACTIVE-ADMIN
revoke already uses: `UPDATE merchant_memberships …` takes the implicit row lock,
then the membership-guard trigger does `SELECT … FROM merchants … FOR UPDATE`.
The approval transaction adopts the same relative order so it cannot form an ABBA
cycle with that path.

**Whole-transaction lock protocol (shared obligation, not an 01B guarantee).**
The order above is a property of *this* transaction, re-derived against the 01B
mutation paths as they exist at `7ddb3971` — it is **not** a universal
deadlock-impossibility claim. It is deadlock-free against every **confirmed
single-mutation 01B path** (§ *Concurrency and race matrix* preamble): every 01B
write is a single statement, and the only one that locks both a
`merchant_memberships` row and `merchants(M)` (the ADMIN-revoke guard trigger)
takes them in this same order. A **composite** future mutation — e.g. `close
merchant` then `revoke membership` in one transaction, or an atomic ADMIN
replacement (`grant` + `revoke` together) — can acquire `merchants(M)` *before* a
`merchant_memberships` row and would then cross this order. 01B exposes no such
composite primitive today (its repositories are single-statement writes; the
identity/contact service is read-only), so this is a **forward obligation on
future mutation callers**, not something 01B already enforces: any caller that
touches more than one authority row in one transaction MUST first `FOR UPDATE`
**every** affected existing `merchant_memberships` row in a deterministic order
(ascending `id`), **then** `lockMerchantById(M)`, then mutate. The approval
transaction complies — it locks exactly one deterministic membership row (the
actor's own `(M, U)`) before `merchants(M)`. Any later change to a lock order on
either side requires re-deriving the whole lock graph.

**Tenant binding.** `M` is taken from the **locked** `delivery_draft.merchant_id`
— never from the request and never from the actor's independently-resolved sole
operable merchant. Every authority row at (2)–(4) is re-read under its lock for
exactly that `M`; if the actor gate resolves a different merchant, or a channel
actor's locked `linked_user_id` no longer equals the discovery `U`, the request
is `MERCHANT_ACTOR_UNAUTHORIZED`.

### The creation transaction

In the creation branch, `delivery_draft: QUOTED -> APPROVED` and the `INSERT` of
the `delivery_order` (with its `delivery_order_recipient_snapshot`) occur in
**one** database transaction, after that same transaction — **holding the
invariant-6 locks and the step-5a pickup lock** — has re-validated, in order:

- the merchant actor — `AUTHORIZED_MERCHANT_ACTOR(U, M)` re-resolved from the
  **locked** authority rows for the **locked draft's** `M`, never carried in from
  a pre-transaction check; a channel actor's candidate `U` from pre-lock
  discovery is re-verified against the locked `linked_user_id`;
- quote ownership (belongs to this draft), state (approvable), and
  `clock_timestamp() < expires_at` — an authoritative wall-clock read taken
  **after** the blocking locks are held, not the transaction-start `now()` /
  `CURRENT_TIMESTAMP`, which stays fixed while the transaction waits on a lock;
- **the quote's `delivery_input_fingerprint`** still equals a fresh canonical
  fingerprint over the current draft inputs (recipient, contact,
  `destination_point`, access note, window, cargo lines `{category, quantity,
  unit}`) **and** the freshly-resolved, **locked** `pickup_snapshot`; a mismatch
  is `QUOTE_STALE`;
- cargo policy over the **whole** cargo category set (`resolveCargoDeliveryPolicy`);
- an ACTIVE, unambiguous pickup `merchant_location` **whose `merchant_id == M`**.

Both race orders resolve fail-closed:

- **approval first** — the approval transaction holds the locks; a concurrent
  ADMIN-revoke / merchant-suspend / membership-revoke / default-switch /
  location-edit blocks on the membership row or `merchants(M)` (or the specific
  row) until the approval transaction commits or rolls back, then proceeds — it
  cannot un-commit an order the approval already created against the state it saw
  under the locks;
- **revocation / edit first** — that mutation holds the membership row and/or
  `merchants(M)` (via its own `lockMerchantById` or the guard trigger); the
  approval transaction's step-2 `lockActiveMerchantMembership` / step-3
  `lockMerchantById` waits, then re-reads and sees the committed negative state
  (`MERCHANT_INOPERABLE` / `MERCHANT_MEMBERSHIP_REQUIRED` /
  `MERCHANT_ACTOR_UNAUTHORIZED`), or — for a pickup edit caught in the creation
  branch — a `QUOTE_STALE` fingerprint or `MERCHANT_LOCATION_REQUIRED` — no order.

Neither half of a creation may exist without the other:

- no `APPROVED` `delivery_draft` without exactly one `delivery_order`;
- no `delivery_order` without its `APPROVED` source draft;
- a failure at any **creation-branch** re-validation step rolls that transaction
  back — the draft stays `QUOTED`, no order and no recipient snapshot are written.

The **recovery** branch and every **step-4 no-order rejection** are zero-write:
each returns and leaves the draft in the state it was entered in — recovery
leaves an `APPROVED` draft as-is (its existing order is the record of record); a
step-4 rejection leaves an `OPEN` or terminal draft untouched. There is no shared
"draft stays `OPEN`" rule across the branches.

## Target entity: `delivery_draft`

A **persisted** server-side row capturing one requested delivery. Persisted is
**not** authoritative: WhatsApp/Peach/manual intake may create or augment a
`delivery_draft`, and it is the durable anchor for quoting, expiry, dedupe, and
recovery after a lost confirmation response — but only an
`AUTHORIZED_MERCHANT_ACTOR` approval turns a `draft + quote` pair into a
`delivery_order` (invariant 6).

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `merchant_id` | FK to `merchants(id)`; the resolved merchant context. |
| `origin_channel` | `WHATSAPP | SMS | SESSION` — provenance of the intake, not authority. |
| `origin_namespace` | Bounded adapter/provider namespace — provider account / business-number scope, mirroring 01A's `subject_namespace` — set **only** from trusted adapter context, never from message content. **Mandatory whenever `adapter_dedupe_token` is set.** |
| `origin_ref` | Bounded provider/message/session provenance label. |
| `adapter_dedupe_token` | Nullable bounded provider/adapter dedupe key for **intake idempotency only** (see Idempotency); scoped by `(merchant_id, origin_channel, origin_namespace)`; never a key for order creation. |
| `recipient_name` | Bounded string (mutable draft intent). |
| `recipient_contact` | Bounded normalized recipient phone (reuses the auth phone canonicalizer); recipient is not a `users` row. |
| `destination_text` | Bounded human destination as stated (mutable draft intent). |
| `destination_point` | Nullable canonical **resolved** destination — coordinates plus a stable provider/place id and provenance — resolved by Quote Authority **before** the quote is computed. Null while unresolved (`DELIVERY_DESTINATION_UNRESOLVED` on approval). |
| `destination_access_note` | Nullable bounded entrance/floor/door note. |
| `requested_pickup_location_id` | Nullable FK to `merchant_locations(id)`; **when set it must name a location whose `merchant_id` equals this draft's `merchant_id`** (invariant 4); null means "resolve default". The resolved pickup location (explicit or default) must carry coordinates before a quote can attach — a null-coordinate location is `DELIVERY_PICKUP_UNRESOLVED` (invariant 4). |
| `requested_window` | Nullable bounded requested delivery time window. |
| `cargo` | Non-empty **list of cargo lines**, each `{ category_code, quantity, unit }`, canonically normalized (fixed `unit` vocabulary, bounded `quantity`). The **category set** drives deliverability (invariant 5); `quantity` / `unit` are carried through the fingerprint and the order snapshot for quote binding, vehicle-capacity selection, handling, and proof of what was approved — capacity and transport-condition checks themselves stay downstream. |
| `status` | `OPEN | QUOTED | APPROVED | ABANDONED | EXPIRED`. |
| `created_at` / `updated_at` | Server timestamps. |

Rules:

- a draft authorizes nothing and never dispatches a driver;
- draft recipient / contact / `destination_text` / `destination_point` / access
  note / window / cargo lines (category, quantity, unit) are mutable **intent**
  while the draft is `OPEN`; they are frozen into order-owned snapshots at
  approval;
- `OPEN -> QUOTED` when a quote is attached. Preconditions Quote Authority
  enforces before a quote may attach — the **creation branch re-checks each one
  under the draft lock** (defence in depth): the mandatory recipient fields
  `recipient_contact` and `destination_text` are present
  (`DELIVERY_RECIPIENT_INCOMPLETE` otherwise); `destination_point` is resolved
  (`DELIVERY_DESTINATION_UNRESOLVED` otherwise); the resolved pickup location
  carries coordinates (`DELIVERY_PICKUP_UNRESOLVED` otherwise). A quote binds to
  the exact delivery inputs it priced (see **Quote boundary contract**);
- **any mutation of those intent fields on a `QUOTED` draft — including a change
  to `destination_point` or a cargo line's `quantity`/`unit` — or any change to
  the canonical content of the resolved pickup location (address edit, coordinate
  change, default flip, archive, even with the same `merchant_location_id`) drops
  the draft `QUOTED -> OPEN` and stales the attached quote**; a fresh quote must
  be computed against the new inputs before approval. Re-geocoding that would
  change `destination_point` follows the same rule — it can never silently alter
  a confirmed delivery;
- `-> APPROVED` happens **only** inside the single transaction that creates the
  `delivery_order` (invariant 6), and only from `QUOTED`;
- `ABANDONED` / `EXPIRED` are terminal for the draft; a new request is a new draft;
- `APPROVED` is terminal for the draft: it is never re-quoted, never re-approved,
  and its one `delivery_order` — in **any** state, including `CANCELED` — is the
  record of record. A delivery after a cancellation is a **new draft**.

## Target entity: `delivery_order`

The single authoritative record for one approved delivery.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `draft_id` | `NOT NULL` FK to `delivery_draft(id)`; the intent it was approved from. Part of the composite FK `(draft_id, merchant_id) -> delivery_draft (id, merchant_id)` (invariant 4). |
| `merchant_id` | `NOT NULL` FK to `merchants(id)`; **equal to `delivery_draft.merchant_id`**, enforced by the composite FK / trigger above — never two independent single-column FKs. |
| `approved_by_user_id` | FK to `users(id)`; the actor the write-txn gate resolved. |
| `approved_membership_id` | FK to `merchant_memberships(id)`; the membership that authorized it. |
| `approval_channel` | `SESSION | WHATSAPP | SMS`; how the actor was gated. |
| `approval_provenance` | Bounded server-owned provenance (procedure + adapter ref). |
| `quote_id` | FK to the approved quote row (owned by Quote Authority). |
| `quote_amount` / `quote_currency` | Snapshot of the approved quote. |
| `quote_state` | Snapshot of the quote's approvable state as of approval. |
| `quote_computed_at` / `quote_expires_at` | Snapshot of the approved quote's validity window. |
| `pickup_location_id` | FK to `merchant_locations(id)` resolved at approval (ACTIVE); its `merchant_id` **equals this order's `merchant_id`** (invariant 4), enforced by a composite FK / trigger, not a plain cross-table `CHECK`. |
| `pickup_snapshot` | Canonical content of the resolved pickup at approval — location id, label, address text, **non-null resolved coordinates**, bounded pickup instructions, default flag — not just the id. A null-coordinate pickup never reaches this snapshot (invariant 4). |
| `delivery_input_fingerprint` | Canonical fingerprint over the confirmed delivery inputs the approved quote priced — recipient snapshot, resolved `destination_point`, the cargo lines `{ category, quantity, unit }`, and `pickup_snapshot`; equals the quote's stored fingerprint. |
| `cargo` | Immutable snapshot of the approved cargo **lines** `{ category_code, quantity, unit }` (every category `DELIVERABLE` at approval). |
| `cargo_policy_version` | The `resolveCargoDeliveryPolicy` version that cleared this cargo category set. |
| `status` | `PENDING_DISPATCH | CANCELED | <downstream states>`. |
| `canceled_at` / `cancel_reason` | Null unless canceled; server-stamped. |
| `created_at` / `updated_at` | Server timestamps. |

Recipient and destination are **not** columns on `delivery_order` — they are a
1:1 immutable child row, `delivery_order_recipient_snapshot` (below).

Immutability:

- the order's core (draft/merchant/actor/quote/pickup/cargo snapshots) is
  immutable after creation, enforced by a `delivery_order`-owned
  `BEFORE UPDATE OR DELETE` guard trigger (the `rides_freeze_terminal` /
  notification-outbox pattern), not by convention;
- **`delivery_order_recipient_snapshot` carries its own
  `BEFORE UPDATE OR DELETE` guard trigger** — a trigger on the parent
  `delivery_order` does **not** fire on direct DML against the child, so a
  repository, backfill, or integrity fault could otherwise rewrite the approved
  recipient/destination while the order and its stored fingerprint stay
  untouched. The child guard rejects every `UPDATE` and every `DELETE`; the row
  lives and dies only with its order (which is never hard-deleted);
- only `delivery_order` lifecycle fields (`status`, `canceled_at`,
  `cancel_reason`, downstream timestamps) may advance, and only forward;
- an order is never hard-deleted; provenance is preserved.

Downstream states (`SEARCHING_DRIVER`, `DRIVER_ASSIGNED`, `PICKED_UP`,
`DELIVERED`, `FAILED`, ...) are named here only for the boundary; their
transitions, guards, and timestamps are owned by
`BD-MERCHANT-DELIVERY-DISPATCH-01A` / `BD-MERCHANT-DELIVERY-EXECUTION-01A`.

## Target entity: `delivery_order_recipient_snapshot`

Exactly one row per `delivery_order`, written in the **same transaction** that
creates the order and immutable thereafter.

| Field | Meaning |
| --- | --- |
| `delivery_order_id` | PK **and** FK to `delivery_order(id)`; strict 1:1. |
| `recipient_name` | Bounded string, frozen from the draft at approval. |
| `recipient_contact` | Bounded normalized recipient phone (auth phone canonicalizer); the recipient is not a `users` row. |
| `destination_text` | Bounded human destination as stated, frozen from the draft. |
| `destination_point` | Canonical **resolved** destination — coordinates plus stable provider/place id and provenance — frozen from the draft's `destination_point`; it is part of the `delivery_input_fingerprint`, so downstream routing uses this authoritative point and never re-geocodes into a different one. |
| `destination_access_note` | Nullable bounded entrance/floor/door note. |
| `requested_window` | Nullable bounded requested delivery window. |
| `created_at` | Server timestamp (= order creation time). |

This is a per-order PII capsule, never a reusable recipient directory: it has no
identity of its own beyond the order FK, is never updated, and is the single
place a narrow driver-facing projection reads recipient data from (that
projection never reads merchant identity/contact tables). A recipient address
book remains an explicit non-goal (01A invariant 3).

Immutability is enforced by this table's **own** `BEFORE UPDATE OR DELETE` guard
trigger, not by the parent `delivery_order` trigger (which does not fire on
direct child DML). Every `UPDATE` and every `DELETE` against
`delivery_order_recipient_snapshot` is rejected; the only lawful writes are the
single `INSERT` inside the creation transaction (invariant 6). `destination_point`
here is part of the `delivery_input_fingerprint`, so a silently mutated snapshot
would also break fingerprint verifiability — the guard closes that path.

## Order-creation authority

An approval request names an exact `(draft_id, quote_id)` pair and runs as one
server transaction that, in order (lock order and tenant binding: see **invariant
6 → Transaction locking**):

1. **Lock the draft.** `SELECT ... FOR UPDATE` the `delivery_draft`; set
   `M := delivery_draft.merchant_id`.
2. **Tenant-bound access check (always — recovery and creation).** For a channel
   actor, first do the **non-authoritative discovery** read (canonical identity →
   candidate `U`); a session actor already holds an authoritative `U`. Then take
   the authority-row locks in the fixed order — the actor's `(M, U)`
   `merchant_memberships` row, then `merchants(M)`, then (channel) the identity
   and binding rows — and re-resolve the actor gate for **this `M`** to a single
   `AUTHORIZED_MERCHANT_ACTOR(U, M)` (Approver parity, below), re-verifying every
   discovered fact under its lock. `M` comes from the locked draft, never the
   request or the actor's independently-resolved merchant; an actor gate that
   resolves a different merchant, or a channel actor whose locked
   `linked_user_id` no longer equals the discovery `U`, →
   `MERCHANT_ACTOR_UNAUTHORIZED`. A result computed before the transaction is not
   accepted. A caller who cannot pass this gets a `MERCHANT_*` code whether or not
   an order already exists. Pickup, expiry, fingerprint, and cargo policy are
   **not** checked here — only on creation (step 5).
3. **Recovery / integrity branch — read the single `delivery_order` for this
   `draft_id`** (`UNIQUE (draft_id)` ⇒ zero or one row), under the locks, then
   split strictly on **whether that order exists**. The existing-order field
   checks live **only** in the ORDER PRESENT branch; they are never applied when
   no order was read.
   a. **ORDER ABSENT** (no `delivery_order` for `draft_id`): if the locked
      `delivery_draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`
      (`APPROVED` is terminal for the draft and must carry exactly one order;
      integrity fault; alert; **zero writes**); **otherwise → step 4** (the
      ordered failure priority; a `QUOTED` draft with its current, non-superseded
      quote proceeds to creation).
   b. **ORDER PRESENT** (exactly one `delivery_order` for `draft_id`), evaluated
      in this exact order — integrity **before** the `quote_id` comparison so
      corruption never returns as a normal client response: (i) `order.merchant_id
      != M` **or** the locked `delivery_draft.status != APPROVED` →
      `DELIVERY_ORDER_STATE_INCONSISTENT` (backfill / trigger-bypass / corruption;
      alert; **zero writes**; never a client-retry outcome) — an exact
      `(draft_id, quote_id)` match does **not** override this; (ii) else
      `order.quote_id` equals the presented `quote_id` → **recovery**: return that
      order with **zero writes**, in **any** lifecycle state **including
      `CANCELED` / terminal** (`DELIVERY_ORDER_ALREADY_EXISTS`); quote expiry /
      supersession / staleness / cargo policy / pickup are **not** re-evaluated;
      (iii) else (`order.quote_id` differs) → `DELIVERY_APPROVAL_QUOTE_CONFLICT`,
      zero writes.
4. **ORDER ABSENT and the draft is not `APPROVED` — an ordered failure priority,
   applied in this exact sequence** (reached only from step 3a's "otherwise").
   Every outcome below is **zero-write** and leaves the draft in the state it was
   entered in.
   a. **Terminal draft** (`ABANDONED` / `EXPIRED`) → `DELIVERY_DRAFT_NOT_APPROVABLE`.
   b. **Superseded quote** — the presented `quote_id` is a quote of this draft,
      but a **newer quote exists for the draft** (whether the draft is `OPEN` or
      `QUOTED`) → `QUOTE_SUPERSEDED`. Checked **before** staleness: a quote that
      is both stale and superseded returns `QUOTE_SUPERSEDED`.
   c. **Stale quote** — the draft is `OPEN`; the presented `quote_id` is a quote
      of this draft; it was **invalidated by a confirmed-input or resolved-pickup
      change after it was priced**; and (b) did not fire (it is **not**
      superseded) → `QUOTE_STALE`. A fresh quote must be computed against the
      current inputs.
   d. **Any other non-creatable state** — a plain `OPEN` draft with no own
      approvable quote, or the presented `quote_id` does not exist / is not a
      quote of this draft, or the draft is not `QUOTED` against a current
      non-superseded quote → `DELIVERY_DRAFT_NOT_APPROVABLE`.
   e. Otherwise the draft is `QUOTED` with its current, non-superseded quote and
      has no order → proceed to the **creation branch** (step 5).
5. **Creation branch — only from a `QUOTED` draft with its current,
   non-superseded quote** (step 4e) and no order:
   a. **(creation branch only)** resolve and **lock** the pickup
      `merchant_locations` row (`lockMerchantLocationById`; the merchant-default
      boundary is already held via the `merchants(M)` lock taken in step 2) — the
      draft's explicit `requested_pickup_location_id`, or the ACTIVE default. The
      row must be `ACTIVE`, `merchant_id == M`, **and carry non-null
      coordinates**; `MERCHANT_LOCATION_REQUIRED` on ambiguity, none, a non-ACTIVE
      row, or a cross-merchant row, and `DELIVERY_PICKUP_UNRESOLVED` on a
      null-coordinate row (no approval-time geocode). The pickup row is never
      locked on the recovery path;
   b. **re-check the mandatory delivery inputs under the draft lock** —
      `recipient_contact` and `destination_text` present
      (`DELIVERY_RECIPIENT_INCOMPLETE`), `destination_point` resolved
      (`DELIVERY_DESTINATION_UNRESOLVED`). These are Quote Authority preconditions
      (a quote must not attach without them); re-checking here means a
      malformed/partial draft that reached `QUOTED` cannot become an authoritative
      but undeliverable order;
   c. re-confirm the named quote against step 4 — `QUOTE_SUPERSEDED` (a newer
      quote appeared concurrently), `QUOTE_EXPIRED` (`clock_timestamp() >=
      expires_at`, read now that all blocking locks are held);
   d. recompute the canonical `delivery_input_fingerprint` over the **current**
      draft inputs (recipient, contact, `destination_point`, access note, window,
      cargo lines `{category, quantity, unit}`) and the freshly-resolved,
      **locked** `pickup_snapshot` (incl. its resolved coordinates); `QUOTE_STALE`
      if it does not equal the quote's stored fingerprint — this also catches a
      pickup-content edit that reached approval before the draft revert propagated
      (non-retryable — a fresh quote is required);
   e. `resolveCargoDeliveryPolicy` over the whole cargo category set against the
      **replica-active** constant (Policy-version activation); `CARGO_CATEGORY_UNKNOWN`
      / `CARGO_NOT_DELIVERABLE` fail closed;
   f. `INSERT` exactly one `delivery_order` and its
      `delivery_order_recipient_snapshot`, and flip the draft `QUOTED ->
      APPROVED`, all in this transaction (invariant 6). The order `INSERT`'s
      implicit `FOR KEY SHARE` FK locks on `delivery_draft` / `merchants(M)` /
      `merchant_memberships` / `merchant_locations` are already subsumed by the
      `FOR UPDATE` locks this transaction holds on those same rows.

The acting user, membership, grantor, verifier, and provenance are all
server-resolved. A request body never chooses the approver, the merchant, the
quote amount, the fingerprint, or the cargo deliverability.

## Approver parity: same right, independent proof

An authenticated **session** actor and a **verified channel** actor have the
**same** order-approval right; they do not share a proof path.

**Pre-lock discovery (channel actor only, authorizes nothing).** Before any lock,
a non-authoritative read of the canonical `external_contact_identities` row for
`(channel, subject_namespace, canonical_subject_key)` yields a *candidate* `U =
linked_user_id`. Its only use is to choose the `(M, U)` `merchant_memberships`
row to lock. Every fact it surfaced — identity status, `channel_proof`,
`linked_user_id`, `linked_at`, the binding — is re-checked under `FOR UPDATE`
below; a locked value that differs from the candidate fails the gate. A session
actor derives `U` authoritatively from the session and skips discovery.

`M` is fixed to the **locked `delivery_draft.merchant_id`**; every row below is
read `FOR UPDATE` in the invariant-6 lock order (**membership before
`merchants(M)`**; the pickup row is not read here), for that `M`:

```text
M := locked delivery_draft.merchant_id

session actor:
  server-resolved users.id = U     (from the session, never the request body)
  -> locked ACTIVE merchant_membership(U, M)
  -> locked merchants(M).status = ACTIVE
  -> membership_role in { ADMIN, OPERATOR }
  => AUTHORIZED_MERCHANT_ACTOR(U, M)

channel actor:
  candidate U := non-authoritative linked_user_id from discovery
  -> locked ACTIVE merchant_membership(U, M)
  -> locked merchants(M).status = ACTIVE
  -> locked external_contact_identity.status = ACTIVE
     AND channel_proof = VERIFIED
     AND linked_user_id = U           (locked value re-checked against candidate)
     AND linked_at IS NOT NULL
  -> locked ACTIVE merchant_contact_binding(identity, M)
  -> membership_role in { ADMIN, OPERATOR }
  => AUTHORIZED_MERCHANT_ACTOR(U, M)
```

Both normalize to one internal `AUTHORIZED_MERCHANT_ACTOR(U, M)` result and both
are re-resolved, under the locks, inside the order-creation transaction
(invariant 6). If the actor gate can only resolve some **other** merchant (e.g.
the caller's sole operable merchant), that is a mismatch against the locked
draft's `M` → `MERCHANT_ACTOR_UNAUTHORIZED`, before recovery or creation. A
channel actor whose **locked** `linked_user_id` differs from the discovery
candidate `U` fails the same way — the discovery value never stands in for the
locked identity. Delivery approval permits `membership_role in { ADMIN, OPERATOR
}`. A downstream operation contract may require `ADMIN` for a stronger action, but
may not widen this set and may not accept contact binding or resolved context
alone.

## Idempotency and recovery

- **`delivery_order` carries an unconditional `UNIQUE (draft_id)`** — a hard
  database invariant, not just a service-path convention: a draft has **at most
  one `delivery_order`, ever**, and it holds against secondary writers, backfills,
  and integrity faults. `UNIQUE (draft_id, quote_id)` alone would let two rows
  for one draft with different `quote_id`s coexist, contradicting this. The
  `UNIQUE (draft_id)` persists after the order is `CANCELED` (it is never
  hard-deleted). A separate index on `(draft_id, quote_id)` serves the exact-pair
  recovery lookup.
- **Recovery** (an approval naming the exact `(draft_id, quote_id)` of an
  existing order) is the guard for the "transaction committed, the confirmation
  response was lost, WhatsApp/Peach redelivered the approval" case. After the
  **tenant-bound access check and the invariant-6 authority locks** (which run
  for recovery too), the branch reads the **single** `delivery_order` for this
  `draft_id` (`UNIQUE (draft_id)`) and applies `## Order-creation authority`
  step 3, **split on whether that order exists**:
  - **order absent:** locked `delivery_draft.status == APPROVED` →
    `DELIVERY_ORDER_STATE_INCONSISTENT` (`APPROVED` must carry exactly one order;
    integrity fault; alert; zero writes); otherwise → **step 4** (a `QUOTED` draft
    with its current, non-superseded quote proceeds to creation). No existing-order
    field is inspected in this case;
  - **order present:** integrity **before** the `quote_id` match —
    `order.merchant_id != M` **or** the locked `delivery_draft.status != APPROVED`
    → `DELIVERY_ORDER_STATE_INCONSISTENT` even on an exact `(draft_id, quote_id)`
    match (backfill / trigger-bypass / corruption; alert; zero writes); else
    `order.quote_id` equal to the presented `quote_id` → **recovery**: the
    existing `delivery_order` is returned with **zero writes**, in **any**
    lifecycle state **including `CANCELED` / terminal** — no re-check of pickup /
    quote expiry / supersession / staleness / cargo policy
    (`DELIVERY_ORDER_ALREADY_EXISTS`); else (`order.quote_id` differs) →
    `DELIVERY_APPROVAL_QUOTE_CONFLICT`. Zero writes.
- **New creation is reached only from a `QUOTED` draft with its current,
  non-superseded quote and no order.** For any other order-absent state,
  `## Order-creation authority` step 4 applies a **fixed priority**, all
  zero-write and entry-state-preserving: terminal draft →
  `DELIVERY_DRAFT_NOT_APPROVABLE`; presented own quote **superseded** (`OPEN` or
  `QUOTED`) → `QUOTE_SUPERSEDED`; `OPEN` with the presented own quote
  **invalidated and not superseded** → `QUOTE_STALE`; any other `OPEN` →
  `DELIVERY_DRAFT_NOT_APPROVABLE`.
- After a `delivery_order` is `CANCELED`, the draft stays `APPROVED`; a further
  delivery is a **new draft + new quote + new order**, never a re-approval of the
  old draft.
- **Draft ingestion** is separately idempotent per
  `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` — the
  `origin_namespace` (provider account / adapter namespace, from trusted adapter
  context) is **required** whenever a dedupe token is present, so the same
  message id arriving through two different provider accounts of one merchant
  produces **two** drafts, never a silently merged or dropped delivery. This is
  an intake dedupe key **only**, never a second, competing key for authoritative
  order creation, which keys on the draft as above.

## Cancellation

Merchant cancellation through Delivery Order Authority is **itself an authority
action** and runs as one transaction with the **same shared lock order** as
approval — never a separate `order -> authority` chain (which would invert the
prefix and could deadlock with approval / repricing / the dispatch claim). The
order row is the **last** lock, exactly as pickup is last in the creation branch.

1. **Non-authoritative hint read.** Read `order.draft_id` and `order.merchant_id`
   as *candidates* (authorizes nothing); a channel actor also runs the discovery
   read for a *candidate* `U`. These only choose which rows to lock.
2. **Take the shared authority prefix, in the fixed order:** `FOR UPDATE` the
   `delivery_draft` named by the hint's `draft_id`; set `M :=
   delivery_draft.merchant_id`; then the actor's `(M, U)` `merchant_memberships`
   row → `merchants(M)` → (channel) `external_contact_identities` row → ACTIVE
   `merchant_contact_bindings` row.
3. **Re-resolve `AUTHORIZED_MERCHANT_ACTOR(U, M)`** from those locked rows
   (Approver parity); `membership_role in { ADMIN, OPERATOR }`. A gate that
   resolves any other merchant, or a channel `linked_user_id` that no longer
   equals the discovery `U`, → `MERCHANT_ACTOR_UNAUTHORIZED`. A read-side check
   from before the transaction is not accepted.
4. **`FOR UPDATE` the `delivery_order` row (last).** Re-verify
   `order.draft_id ==` the locked draft's `id` **and** `order.merchant_id == M`
   (the composite `(draft_id, merchant_id)` FK guarantees these agree at rest;
   the check is defence in depth) → `DELIVERY_ORDER_STATE_INCONSISTENT` on
   mismatch.
5. **Status gate.** `order.status == PENDING_DISPATCH` → perform the terminal
   `PENDING_DISPATCH -> CANCELED` transition, server-stamped and
   `cancel_reason`-coded, never a hard delete. Any other status →
   `DELIVERY_ORDER_NOT_CANCELABLE`, zero writes.

- The instant `BD-MERCHANT-DELIVERY-DISPATCH-01A` atomically moves the order out
  of `PENDING_DISPATCH` (into `SEARCHING_DRIVER`), direct merchant-cancel through
  Order Authority is **forbidden** (`DELIVERY_ORDER_NOT_CANCELABLE`). Any later
  cancellation or abort runs through the Dispatch/Execution **compensation
  flow**, which owns driver/recipient-initiated cancellation, refund/settlement
  effects, and in-flight-cargo handling.
- `PENDING_DISPATCH -> CANCELED` and `PENDING_DISPATCH -> SEARCHING_DRIVER`
  serialize on the order row; exactly one wins (race-matrix row 19), the loser
  gets `DELIVERY_ORDER_NOT_CANCELABLE` or a no-op. Because both cancellation and
  approval take `delivery_draft` before the order row, and the dispatch claim
  takes only the order row, no pair of these transactions crosses lock order.
- A concurrent membership/merchant revocation is fail-closed the same way as for
  approval: it blocks on the membership row or `merchants(M)` behind step 2, or
  step 3's re-resolve reads the committed negative state
  (`MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_INOPERABLE` /
  `MERCHANT_ACTOR_UNAUTHORIZED`) — the cancel does not go through on stale
  authority (race rows 25–26).
- Abandoning a draft (`ABANDONED`) before any order exists is always allowed to
  the same actors and creates no order.

## Quote boundary contract

Quote computation, reprice, surge, `expires_at` duration, and the fingerprint
algorithm are entirely `BD-MERCHANT-QUOTE-AUTHORITY-01A`. Delivery Order
Authority defines only the boundary it consumes:

- **Quote lifecycle writes serialize on the `delivery_draft` lock.** Every Quote
  Authority write that **creates, supersedes, or invalidates** a quote for a
  draft MUST first `SELECT ... FOR UPDATE` that `delivery_draft` row and hold it
  **through commit** — the draft row is the per-draft quote-serialization point
  (no separate current-quote column is required). This makes race-matrix row 5
  (`QUOTE_SUPERSEDED`) and the staleness checks **guaranteed rather than
  timing-dependent**:
  - *reprice/supersede first* — it commits its new current quote under the draft
    lock; the approval transaction then acquires the same lock, reads the newer
    quote as current, and rejects the presented one (`QUOTE_SUPERSEDED`);
  - *approval first* — it holds the draft lock through commit and flips the draft
    to `APPROVED`; a reprice that arrives next sees a terminal (`APPROVED`) draft
    and **refuses** to publish/supersede — the order already snapshots the exact
    approved quote, and no supersession can slip in between step 5c re-confirm and
    commit.
- **The resolved destination point is fixed before pricing.** Quote Authority
  resolves `delivery_draft.destination_point` (coordinates + stable
  provider/place id + provenance) **before** it computes a quote; a quote can
  only attach to a draft whose `destination_point` is resolved. A later change to
  `destination_text` / `destination_point` — including a re-geocode that would
  move the point — invalidates the quote and drops the draft `QUOTED -> OPEN`;
  approval never silently retargets a confirmed delivery.
- **The resolved pickup point is fixed before pricing.** The pickup
  `merchant_locations` row the quote priced against must carry non-null
  coordinates; a null-coordinate location cannot be priced or approved
  (`DELIVERY_PICKUP_UNRESOLVED`, invariant 4). Pickup geocoding happens in intake
  / Quote Authority, never at approval; the resolved pickup point is part of the
  `pickup_snapshot` and the fingerprint.
- **Mandatory recipient fields are a quote precondition.** A quote can only
  attach to a draft whose `recipient_contact` and `destination_text` are present
  (and `destination_point` resolved). The creation branch re-checks these under
  the draft lock (`DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`),
  so a partial draft that reached `QUOTED` — Quote Authority bug, partial intake —
  never becomes an authoritative-but-undeliverable order.
- **Every quote binds to the exact delivery inputs it priced.** Quote Authority
  stores, on the quote, a canonical `delivery_input_fingerprint` over: the
  recipient snapshot (name, contact, `destination_text`, **resolved
  `destination_point`**, access note, window), the canonically-ordered cargo
  **lines** `{ category_code, quantity, unit }`, and the resolved
  `pickup_snapshot` — the pickup `merchant_location` id **plus** its canonical
  content (label, address text, coordinates, pickup instructions, default flag).
  A bare `pickup_location_id` is **not** sufficient (a merchant can edit a store's
  address under the same id); a bare category set is **not** sufficient (2 kg and
  200 kg of `LIVE_CRAYFISH` must not fingerprint alike).
- **Required at approval (creation branch):** a `quote_id` that is the current
  quote for the draft, in an approvable state, with `clock_timestamp() <
  expires_at` (an authoritative wall-clock read taken **after** the blocking
  locks are held — a transaction-start `now()` stays fixed while the transaction
  waits on a lock and would accept an already-expired quote), whose
  `delivery_input_fingerprint` still equals a fresh fingerprint over the current
  draft inputs, resolved destination point, cargo lines, and resolved pickup.
- **Snapshotted onto the order** (immutable): `quote_id`, `quote_amount`,
  `quote_currency`, `quote_state`, `quote_computed_at`, `quote_expires_at`,
  `delivery_input_fingerprint`.
- Approval-time quote rejections — all zero-write, non-retryable (the fix is a
  fresh quote, not a retry), and **none is re-evaluated on a recovery** (exact
  `(draft_id, quote_id)` match): `QUOTE_SUPERSEDED` (a newer quote exists for the
  draft — checked for `OPEN` and `QUOTED` alike, and **before** `QUOTE_STALE`),
  `QUOTE_STALE` (the presented quote was invalidated by a confirmed-input /
  destination / cargo-quantity / resolved-pickup change and is **not**
  superseded), `QUOTE_EXPIRED` (`clock_timestamp() >= expires_at` after locks).
  The exact ordered priority is fixed in **`## Order-creation authority`** step 4.
- A reprice creates a new quote; it never mutates an already-created order. The
  order's own lifecycle is not bounded by `quote_expires_at` — an approved order
  does not "expire".
- Delivery Order Authority stores no quote line items, pricing inputs, or
  computation state — only the snapshot fields above.

## Concurrency and race matrix

Every fail-closed outcome below depends on the approval transaction **holding the
invariant-6 locks** — `delivery_draft` → the actor's `(M, U)`
`merchant_memberships` row → `merchants(M)` → (channel) external identity →
binding, `FOR UPDATE`, in that fixed order; the pickup `merchant_locations` row is
locked **only in the creation branch (step 5a)**, after `merchants(M)` — before it
re-reads authority state. **Membership before `merchants(M)`** is the order 01B's
last-ACTIVE-ADMIN revoke already follows (implicit membership row lock, then
`SELECT … merchants … FOR UPDATE` in the guard trigger), and it is the only 01B
write that locks both; every other 01B write is a single statement that locks at
most one of the two. So the approval transaction is deadlock-free against every
**confirmed single-mutation 01B path** below. It is **not** a universal
deadlock-impossibility claim: a composite future caller that locks `merchants(M)`
before a membership row (row 22) must adopt the shared *lock every affected
membership in ascending-`id` order, then the merchant* protocol (invariant 6 →
*Whole-transaction lock protocol*). Each row is stated for both directions.

The **`delivery_draft` lock (step 1) is also the per-draft serialization point
for quote lifecycle writes** (publish / supersede / invalidate — Quote boundary
contract) and the **first lock of the cancellation transaction** (Cancellation).
Approval, recovery, cancellation, and quote-lifecycle writes all take
`delivery_draft` first; the dispatch claim takes only the `delivery_order` row;
the `delivery_order` row is the **last** lock wherever it is taken. No pair of
these transactions crosses lock order.

| # | Race | Required outcome (both directions) |
| --- | --- | --- |
| 1 | Two concurrent **creation** approvals of one `QUOTED` draft | Serialize on the `delivery_draft` lock; `UNIQUE (draft_id)` backstops. Exactly one `delivery_order`; the loser recovers the same row (`DELIVERY_ORDER_ALREADY_EXISTS`). |
| 2 | Approval vs. merchant `SUSPENDED`/`CLOSED` | **Approval first:** the suspend waits on `merchants(M)` until approval commits/rolls back. **Suspend first:** approval's `lockMerchantById(M)` waits, then reads `SUSPENDED` → `MERCHANT_INOPERABLE`, no order. Applies to recovery and creation. |
| 3 | Approval vs. membership `REVOKED` (incl. last-ADMIN revoke, whose guard trigger locks `merchants(M)` **after** the membership row) | **Approval first:** the revoke of the actor's own row waits on the step-2 membership lock; any other revoke waits on `merchants(M)`. **Revoke first:** approval's `lockActiveMerchantMembership` finds no ACTIVE row (or re-reads it `REVOKED`) → `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`, no order. Applies to recovery and creation. |
| 4 | **Creation** vs. quote `expires_at` crossed while waiting on locks | Expiry is read with `clock_timestamp()` **after** the locks are held (not transaction-start `now()`); `clock_timestamp() >= expires_at` → `QUOTE_EXPIRED`; no order. |
| 5 | Approval of a quote for which a **newer quote exists** for the draft — draft `OPEN` **or** `QUOTED` | `QUOTE_SUPERSEDED` (step 4b); checked **before** `QUOTE_STALE`; approval must name the current quote. Guaranteed, not timing-dependent: quote publish/supersede takes the `delivery_draft` lock, so it cannot land between step 5c re-confirm and commit (row 23). |
| 6 | **Creation** vs. pickup `merchant_location` edit / `ARCHIVED` / default switch | The pickup row is locked in step 5a; its merchant-default boundary is already covered by the step-2 `merchants(M)` lock. **Approval first:** the edit waits. **Edit first:** step 5a re-reads under lock — non-ACTIVE / gone → `MERCHANT_LOCATION_REQUIRED`; changed content → step 5d fingerprint mismatch → `QUOTE_STALE`. No order against a stale pickup. |
| 7 | A confirmed draft input change (recipient/contact/`destination_point`/access note/window/cargo qty/unit) on a `QUOTED` draft, then approval of that quote (no newer quote) | Change drops the draft `QUOTED -> OPEN` and invalidates the quote; approval resolves at **step 4c** → `QUOTE_STALE`, zero writes, draft stays `OPEN`; no order until a fresh quote is approved. |
| 8 | The resolved pickup location's canonical content edited (same `merchant_location_id`) so close to approval that the draft revert has not propagated | Draft still `QUOTED` → **creation branch** step 5d recomputes the fingerprint over the fresh **locked** `pickup_snapshot`, sees the mismatch → `QUOTE_STALE`; no order. |
| 9 | **Creation** vs. cargo policy change (category becomes non-deliverable) between quote and approval | Re-check against current policy; `CARGO_NOT_DELIVERABLE`; no order. |
| 10 | Actor whose gate resolves merchant **A** presents a `(draft_id, quote_id)` whose locked `delivery_draft.merchant_id = B` | `M` is taken from the **locked draft** (`= B`); the gate for `A` mismatches → `MERCHANT_ACTOR_UNAUTHORIZED`, **before recovery**; no read or write of `B`'s order. |
| 11 | Explicit `requested_pickup_location_id` names an ACTIVE location owned by **another** merchant | Step 5a requires `merchant_locations.merchant_id == M` (and a composite FK / trigger backstops); mismatch → `MERCHANT_LOCATION_REQUIRED`; no order, no cross-tenant pickup. |
| 12 | The same adapter message id arrives through two different provider accounts / namespaces of one merchant | Intake dedupe keys on `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` → **two distinct drafts**; neither delivery is dropped or merged. |
| 13 | A secondary writer / backfill tries to insert a second `delivery_order` for a `draft_id` | `UNIQUE (draft_id)` rejects it — the one-order-per-draft invariant is a DB constraint, not only a service-path property. |
| 14 | Retry naming the exact `(draft_id, quote_id)` of an existing order, after that quote has since expired / been superseded | **Recovery** (after the tenant-bound gate + authority locks): return the existing order, zero writes; expiry/supersession/staleness are not re-checked. |
| 15 | Retry naming the exact `(draft_id, quote_id)` of an order that was `CANCELED` | **Recovery**: return the `CANCELED` order, zero writes; never a new order, never resurrection. |
| 16 | Second approval of an `APPROVED` draft naming a **different** `quote_id` | `DELIVERY_APPROVAL_QUOTE_CONFLICT`; no order. |
| 17 | Approval of a draft that is `APPROVED` with **no** `delivery_order` | `DELIVERY_ORDER_STATE_INCONSISTENT` (integrity fault); no write. |
| 18 | Adapter redelivery of the same inbound approval | Recovery by exact `(draft_id, quote_id)`; returns the same order, zero writes. |
| 19 | Merchant cancel vs. `PENDING_DISPATCH -> SEARCHING_DRIVER` | Serialize on the order row; exactly one of {`CANCELED`, `SEARCHING_DRIVER`} wins; the loser gets `DELIVERY_ORDER_NOT_CANCELABLE` or a no-op. After `SEARCHING_DRIVER`, merchant-cancel via Order Authority is refused. |
| 20 | Creation transaction rolls back mid-way | No `APPROVED` draft and no `delivery_order`/recipient snapshot are left behind (invariant 6). |
| 21 | All FK links (draft, merchant, membership, quote, pickup location) | Target existing canonical rows; `RESTRICT` on delete of a referenced parent; the pickup FK is composite on `(pickup_location_id, merchant_id)`; the order↔draft FK is composite on `(draft_id, merchant_id)` (row 24). |
| 22 | A **composite** future mutation (`close merchant` + `revoke membership` in one tx; atomic ADMIN replacement `grant` + `revoke`) that locks `merchants(M)` before a `merchant_memberships` row | Out of 01B scope — no such composite primitive exists at `7ddb3971` (repositories are single-statement; the identity/contact service is read-only). A future composite caller **must** `FOR UPDATE` every affected existing `merchant_memberships` row in ascending-`id` order, then `lockMerchantById(M)`, before mutating — the same protocol the approval transaction follows (invariant 6 → *Whole-transaction lock protocol*). Stated here as a forward obligation, **not** a property guaranteed by 01B primitives. |
| 23 | Quote Authority **supersedes / invalidates** the named quote between step 5c re-confirm and the approval commit | Quote lifecycle writes take the `delivery_draft` lock (Quote boundary contract). **Reprice (new quote) first:** it commits the new current quote; approval re-reads it → `QUOTE_SUPERSEDED`, no order. **Invalidation with no newer quote first:** it commits `QUOTED -> OPEN` under the draft lock; approval then resolves at step 4c (or, if it had already reached the creation branch, at the step 5d fingerprint recompute) → `QUOTE_STALE`, no order (same outcome as race row 7). **Approval first:** it holds the draft lock through commit and flips `-> APPROVED`; the reprice/invalidation then sees a terminal draft and refuses — the order snapshots the exact approved quote. No window remains. |
| 24 | A secondary writer / backfill inserts a `delivery_order` whose `draft_id` belongs to merchant B but `merchant_id` is A | The composite FK `(draft_id, merchant_id) -> delivery_draft (id, merchant_id)` (or guard trigger) rejects it (invariant 4). Two independent single-column FKs would both pass; recovery would then authorize against B from the locked draft while returning an A-provenance order. |
| 25 | Merchant **cancel** vs. membership/contact-binding `REVOKED` | The cancel transaction takes the shared authority prefix (`delivery_draft` → membership → `merchants(M)` → identity → binding) **before** the order row. **Cancel first:** the revoke blocks behind it. **Revoke first:** step 3's `AUTHORIZED_MERCHANT_ACTOR` re-resolve reads the committed negative state → `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`; no `CANCELED`. |
| 26 | Actor whose gate resolves merchant **A** presents merchant **B**'s pending `delivery_order` id to cancel | The hint read yields candidate `(draft_id, merchant_id = B)`; step 2 locks `d_B` and sets `M := B`; step 3 re-resolves the gate for `B` — `A`'s actor has no ACTIVE `B` membership → `MERCHANT_ACTOR_UNAUTHORIZED`. `B`'s order is never transitioned under `A`'s authority. |
| 27 | Direct `UPDATE` / `DELETE` against `delivery_order_recipient_snapshot` (repository bug, backfill, integrity fault) | Rejected by the child table's **own** `BEFORE UPDATE OR DELETE` guard trigger — a parent `delivery_order` trigger does not fire on direct child DML. The approved recipient/destination and the fingerprint stay verifiable. |
| 28 | Approval where the resolved pickup `merchant_locations` row is `ACTIVE` and same-merchant but has `lat`/`lng` both null (`0009` permits this) | Step 5a rejects it → `DELIVERY_PICKUP_UNRESOLVED`; no approval-time geocode, no order. A routable pickup point must be resolved before pricing (invariant 4, Quote boundary contract). |
| 29 | A `QUOTED` draft reaches the creation branch missing `recipient_contact` or `destination_text` (Quote Authority precondition bug / partial intake) | Step 5b re-checks the mandatory recipient fields under the draft lock → `DELIVERY_RECIPIENT_INCOMPLETE` (or `DELIVERY_DESTINATION_UNRESOLVED`); zero writes, no undeliverable authoritative order. |
| 30 | Exact `(draft_id, quote_id)` order exists, but the locked source `delivery_draft.status` is `OPEN` / `QUOTED` / terminal (partial backfill, trigger-disabled writer, corruption) | Step 3 **ORDER PRESENT** branch — `locked draft.status != APPROVED` is checked **before** the `quote_id` match — returns `DELIVERY_ORDER_STATE_INCONSISTENT` (alert), zero writes. Corruption is never returned as a successful recovery. (When **no** order exists for the `draft_id`, the ORDER ABSENT branch runs instead: a non-`APPROVED` draft simply proceeds to step 4 — see Example R.) |
| 31 | A cargo category becomes non-deliverable while replicas run different policy constants during a rolling deploy | Not an ordinary deploy: a coordinated **Policy-version activation** halts creation-branch approvals on all writers (`CARGO_POLICY_TRANSITION`, retryable), drains in-flight, confirms no old-constant replica remains, activates, resumes. No approval straddles two constants; if a step is unconfirmed, creation stays blocked. Recovery does not re-check cargo policy. |

Exact indexes, constraints, the shared lock order, and DDL are owned by the
schema slice that follows this contract; it must implement these outcomes — and
the invariant-6 lock order — not reinterpret them.

## Privacy and data-minimization boundary

- Recipient `name`, `contact`, `destination_text`, `destination_access_note`, and
  `requested_window` are bounded per-order operational data. They exist to
  execute one delivery. A recipient address book, recipient message history as
  profile data, and inferred recipient relationship graphs are explicit
  non-goals (01A invariant 3).
- Retention/erasure implementation is deferred, but the contract fixes that
  recipient PII is scoped to its `delivery_order` and its downstream execution
  records, not copied into merchant identity/contact tables.
- Operational logging/metrics follow the notification-outbox / 01A boundary:
  stable outcome/error codes, request/correlation IDs, low-cardinality labels
  (channel, cargo-class, error code). Never log raw recipient phone/name,
  destination text, access notes, cargo free-text, quote amounts joined to
  identity, merchant/member/draft/order UUIDs as free text, provider payloads, or
  message bodies.
- Driver-facing projection (built by the Dispatch/Execution slices) receives only
  what a driver needs to pick up and deliver: pickup label/address, masked
  recipient contact, destination, access note, cargo-handling class. It never
  reads `merchants` / `merchant_memberships` / `external_contact_identities` /
  `merchant_contact_bindings` to discover PII.
- Public feeds and passenger-facing surfaces never serialize any Delivery Order,
  recipient, quote, or merchant contact field.
- Repository fixtures and worked examples use only synthetic/masked data — no
  live customer/merchant phone numbers, addresses, door codes, or provider
  payloads.

## Error taxonomy for future runtime

Reuses the 01A `MERCHANT_*` actor-gate codes (`MERCHANT_NOT_FOUND`,
`MERCHANT_INOPERABLE`, `MERCHANT_MEMBERSHIP_REQUIRED`,
`MERCHANT_ACTOR_UNAUTHORIZED`, `EXTERNAL_CONTACT_UNKNOWN`,
`EXTERNAL_CONTACT_IDENTITY_CONFLICT`, `MERCHANT_CONTEXT_AMBIGUOUS`,
`MERCHANT_LOCATION_REQUIRED`, `CONTACT_CHANNEL_PROOF_REQUIRED`,
`CONTACT_USER_LINK_REQUIRED`) and adds:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `DELIVERY_DRAFT_NOT_FOUND` | Referenced draft does not exist. | false |
| `DELIVERY_DRAFT_NOT_APPROVABLE` | Draft is terminal (`ABANDONED`/`EXPIRED`) — step 4a; or a non-creatable `OPEN` state with no own approvable quote, or a presented `quote_id` that does not exist / is not a quote of this draft — step 4d. | false |
| `DELIVERY_RECIPIENT_INCOMPLETE` | Missing `recipient_contact` or `destination_text`. A Quote Authority precondition; **re-checked in the creation branch under the draft lock** (step 5b) so a partial `QUOTED` draft cannot become an authoritative order. | false |
| `DELIVERY_DESTINATION_UNRESOLVED` | No canonical `destination_point` (coordinates + provider/place provenance) could be resolved before quoting; a quote cannot attach until it is; re-checked at step 5b. | false |
| `DELIVERY_PICKUP_UNRESOLVED` | The resolved / explicit pickup `merchant_locations` row is ACTIVE and same-merchant but carries null coordinates (`0009` permits this). A delivery pickup needs a routable point fixed before pricing; no approval-time geocode. Step 5a. | false |
| `DELIVERY_CARGO_LINE_INVALID` | A cargo line's `quantity` / `unit` fails canonical normalization or bounds. | false |
| `MERCHANT_ACTOR_UNAUTHORIZED` (01A) | Also raised here when the actor gate resolves a merchant other than the locked `delivery_draft.merchant_id` — checked before recovery. | false |
| `MERCHANT_LOCATION_REQUIRED` (01A) | Also raised here when the resolved / explicit pickup is non-ACTIVE, ambiguous, or belongs to a merchant other than the draft's. | false |
| `QUOTE_REQUIRED` | The approval request named no `quote_id` (request-shape error). | false |
| `QUOTE_SUPERSEDED` | A newer quote exists for the draft; **approval** must name the current quote. Checked for `OPEN` and `QUOTED` drafts alike, and **before** `QUOTE_STALE` — step 4b. | false |
| `QUOTE_EXPIRED` | `clock_timestamp() >= quote.expires_at`, read **after** the blocking locks are held; obtain a fresh quote. | false |
| `QUOTE_STALE` | The presented quote for this draft was invalidated by a confirmed-input / destination-point / cargo-quantity / resolved-pickup change after it was priced **and is not superseded** — step 4c, or the creation-branch fingerprint recompute (step 5d). Obtain a fresh quote. | false |
| `CARGO_CATEGORY_UNKNOWN` | A cargo category code is not in the server policy vocabulary. | false |
| `CARGO_NOT_DELIVERABLE` | Cargo category set contains a non-deliverable category (e.g. `ALCOHOL`). | false |
| `DELIVERY_ORDER_ALREADY_EXISTS` | Recovery replay; resolves to the existing order (any state, incl. `CANCELED`). | false |
| `DELIVERY_APPROVAL_QUOTE_CONFLICT` | Draft is `APPROVED`, `order.merchant_id == M`, but its order is for a different `quote_id` than the one presented. | false |
| `DELIVERY_ORDER_STATE_INCONSISTENT` | A draft/order integrity fault, never a client-retry condition (alert): draft `APPROVED` with **no** order; an order whose locked source `delivery_draft.status != APPROVED`; or an order whose `merchant_id` / `draft_id` disagree with the locked draft. | false |
| `DELIVERY_ORDER_NOT_CANCELABLE` | Order is not `PENDING_DISPATCH` (past the merchant-cancel boundary, or already terminal). | false |
| `CARGO_POLICY_TRANSITION` | Creation-branch approvals are temporarily halted for a coordinated cargo-policy-version activation (invariant 5). Retry after activation completes. | true |
| `DELIVERY_ORDER_DEPENDENCY_FAILED` | Authoritative persistence/dependency failed. | true |

Downstream Dispatch/Execution contracts may define stronger operation-specific
codes; they may not downgrade the order-creation gate to a context lookup.

## Downstream boundary

| Slice | Owns |
| --- | --- |
| `BD-MERCHANT-QUOTE-AUTHORITY-01A` | Quote computation, reprice, surge, `expires_at` duration, quote lifecycle. This contract consumes only the approved-quote snapshot fields listed under **Quote boundary contract**, and imposes two boundary obligations on Quote Authority: (1) every quote **publish / supersede / invalidate** write takes the `delivery_draft` `FOR UPDATE` lock and holds it through commit (per-draft serialization); (2) a quote may attach only to a draft with resolved `destination_point`, a coordinate-bearing resolved pickup, and present mandatory recipient fields. |
| `BD-MERCHANT-WHATSAPP-INTAKE-01A` | Mapping an inbound provider message into a (persisted) `delivery_draft` — recipient/cargo/pickup intent — without becoming authority. |
| `BD-MERCHANT-DELIVERY-DISPATCH-01A` | Driver eligibility + offer using existing Driver/Vehicle/Shift/Compliance authorities; the atomic `PENDING_DISPATCH -> SEARCHING_DRIVER` claim; the multi-stop **delivery route/batch** entity over N `delivery_order`s; the compensation flow for cancellation after `PENDING_DISPATCH`. |
| `BD-MERCHANT-DELIVERY-EXECUTION-01A` | `SEARCHING_DRIVER -> DRIVER_ASSIGNED -> PICKED_UP -> DELIVERED -> terminal`; live-cargo (`LIVE_CRAYFISH`) time/temperature handling; recipient/driver-initiated cancellation and failure. |

## Worked examples (synthetic)

### Example A: cooked crayfish, single recipient, channel approval

```text
WhatsApp contact A (ACTIVE, VERIFIED, linked_user_id = U) for Merchant M ("Морской Разливной")
message: "Deliver 2 kg cooked crayfish to Recipient R, +7***, Destination D, 3rd floor no lift, 18:00-19:00"
```

1. Contact resolves to Merchant M (01A contact resolution).
2. `delivery_draft` d1: recipient R / +7*** / `destination_text` D /
   `destination_point` resolved to (lat,lng)+place-id / access note / window /
   `cargo = [ { COOKED_CRAYFISH, quantity: 2, unit: KG } ]` / pickup = M's default
   location. Status `OPEN`.
3. Quote Authority resolves `destination_point`, then computes quote q1 (amount,
   `expires_at`, `delivery_input_fingerprint` over recipient + point + the cargo
   line + pickup content). d1 -> `QUOTED`.
4. Contact A approves `(d1, q1)`. Order-creation txn does the non-authoritative
   discovery (candidate `U`), then locks d1, the ACTIVE `(M, U)` membership,
   `merchants(M)`, and the identity + binding (`FOR UPDATE`, in that order); `M`
   is taken from the locked d1. Re-resolves `AUTHORIZED_MERCHANT_ACTOR(U, M)`
   under the locks (locked `linked_user_id == U`). In the creation branch it then
   locks the default pickup location (step 5a), checks `clock_timestamp() <
   q1.expires_at`, the fingerprint matches, and `COOKED_CRAYFISH` = `DELIVERABLE`.
5. One `delivery_order` o1 (`PENDING_DISPATCH`) with all snapshots (incl. the 2-KG
   cargo line and the resolved `destination_point`); d1 -> `APPROVED`.
6. Dispatch is a separate slice.

### Example B: bottled alcohol is never dispatched

```text
message: "Add 1 bottle of wine to that delivery"
```

- The draft may record `cargo = { COOKED_CRAYFISH, ALCOHOL }` as stated intent.
- Order creation is rejected `CARGO_NOT_DELIVERABLE`. No `delivery_order`.
- Correct merchant action: split — one deliverable order for the crayfish, wine
  stays `IN_STORE_ONLY`. BazarDrive does not dispatch a driver for alcohol.

### Example C: live crayfish is deliverable

```text
cargo = { LIVE_CRAYFISH }
```

- Order creation succeeds (`LIVE_CRAYFISH` = `DELIVERABLE`).
- Time/temperature handling constraints are enforced by the Execution slice, not
  by rejecting the order here.

### Example D: two recipients = two orders

```text
message: "Same order to Recipient R1 at D1 and Recipient R2 at D2"
```

- Two drafts d1 (R1/D1), d2 (R2/D2); two quotes; two approvals; two
  `delivery_order`s.
- If a driver later carries both, that is a **delivery route/batch** referencing
  o1 and o2, created by the Dispatch slice — not a second recipient on one order.

### Example E: approval after the quote expired (no order yet)

```text
q1.expires_at < now ; no delivery_order exists for (d1, q1)
```

- **Creation branch**: `QUOTE_EXPIRED`, no order. An `AUTHORIZED_MERCHANT_ACTOR`
  obtains a fresh quote q2 and approves q2; the resulting order snapshots q2.

### Example F: membership revoked between quote and approval

```text
membership(U, M) REVOKED after q1 was computed
```

- The in-transaction actor re-resolve fails
  (`MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`). No order.
  A stale pre-transaction "actor OK" snapshot does not create the order.

### Example G: retried approval (recovery by exact pair)

```text
adapter redelivers the same approval message; user double-taps approve;
a delivery_order already exists for (d1, q1)
```

- **Recovery branch** on the exact `(d1, q1)` pair: after the access check, the
  existing `delivery_order` is returned with zero writes. No second order.

### Example I: response lost, then the quote expired

```text
creation for (d1, q1) COMMITs; the confirmation response is lost;
provider redelivers the approval AFTER q1.expires_at
```

- **Recovery branch**: the exact `(d1, q1)` order is found and returned, zero
  writes. Expiry is **not** re-checked on recovery — the order already exists.

### Example J: destination edited on a QUOTED draft

```text
q1 priced for destination A ; merchant edits d1 to destination B ; approves (d1, q1)
```

- Editing a confirmed input on the `QUOTED` draft drops d1 `QUOTED -> OPEN` and
  invalidates q1. Approving `(d1, q1)` — no order for the pair, d1 not terminal,
  q1 not superseded (no newer quote exists) → **step 4c** → `QUOTE_STALE`, zero
  writes, d1 stays `OPEN`. A fresh q2 priced for B must be computed and approved;
  the order then snapshots B and q2.

### Example M: an invalidated quote that has also been superseded

```text
q1 priced for address A ; edit -> B (q1 invalidated, d1 -> OPEN) ;
q2 priced (d1 -> QUOTED, q1 now superseded) ; edit -> C (d1 -> OPEN) ;
approval of the old (d1, q1) arrives
```

- No order exists for `(d1, q1)`. Step 4 priority: d1 is not terminal (4a); q1 is
  a quote of d1 and a **newer quote (q2) exists** → **step 4b** fires →
  `QUOTE_SUPERSEDED`, zero writes, d1 stays `OPEN`. Staleness (step 4c) is **not**
  reached even though q1 is also input-stale. The merchant must approve the
  current quote — here q2 is itself now input-stale for address C, so a fresh q3
  priced for C is required.

### Example K: store address edited between quote and approval (race)

```text
q1 priced against pickup location L (address X) ; merchant edits L's address to Y,
same merchant_location_id ; approves (d1, q1) before the draft revert propagates
```

- The draft is still `QUOTED` with q1 its current, non-superseded quote (step 4e),
  so the **creation branch** runs. Step 5d recomputes the fingerprint over the
  freshly-resolved `pickup_snapshot` (address Y) — it no longer equals q1's
  stored fingerprint (address X) → `QUOTE_STALE`, no order. A fresh quote against
  address Y is required. (Once the `QUOTED -> OPEN` revert from the pickup edit
  has propagated, the same approval instead resolves at **step 4c** — same
  `QUOTE_STALE` outcome, provided no newer quote has appeared.)

### Example L: order was CANCELED, merchant asks to "redo it"

```text
o1 (from d1, q1) is CANCELED ; merchant sends "please redo that delivery"
```

- d1 stays `APPROVED`; o1 is terminal. Re-approving `(d1, q1)` → **recovery**
  returns the `CANCELED` o1, zero writes. Re-approving `(d1, q2)` →
  `DELIVERY_APPROVAL_QUOTE_CONFLICT`. The correct path is a **new draft d2**, a
  new quote, and a new order.

### Example N: actor for merchant A, draft of merchant B (tenant binding)

```text
actor U is an ACTIVE OPERATOR of merchant A only ;
U presents a leaked (d_B, q_B) whose delivery_draft.merchant_id = B
```

- Step 1 locks `d_B`; `M := d_B.merchant_id = B`. Step 2 takes the authority
  locks for `B` and re-resolves the gate — `U` has no ACTIVE membership for `B`
  (the gate would otherwise resolve `A`, U's sole operable merchant) →
  `MERCHANT_ACTOR_UNAUTHORIZED`, **before recovery**. `B`'s order is never read or
  written under `A`'s authority.

### Example O: same message id, two provider accounts

```text
Merchant M is reachable via WhatsApp Business account P1 and account P2 ;
both forward an inbound with the same provider message id X
```

- Intake keys on `(M, WHATSAPP, origin_namespace, X)`. P1 → `origin_namespace =
  ns_P1`, P2 → `ns_P2`. Two distinct `delivery_draft`s are created; neither
  delivery is silently dropped or merged onto the other.

### Example P: quote not expired at start, expired after the lock wait

```text
q1.expires_at is 5 s away ; the approval txn starts, then blocks ~30 s on
merchants(M) behind a concurrent default-pickup switch ; the switch commits
```

- The approval txn acquires the locks, then step 5c reads `clock_timestamp()`
  (not the fixed transaction-start `now()`): `clock_timestamp() >= q1.expires_at`
  → `QUOTE_EXPIRED`, no order. A transaction-start timestamp would have wrongly
  accepted the expired quote. (Step 5d would also catch it if the default switch
  changed the resolved pickup — `QUOTE_STALE`.)

### Example Q: 2 kg vs 200 kg

```text
two drafts, identical except cargo line quantity: 2 KG vs 200 KG LIVE_CRAYFISH
```

- The cargo lines differ, so the two `delivery_input_fingerprint`s differ and the
  two quotes differ; each order snapshots its own `{ LIVE_CRAYFISH, quantity,
  unit }`. Vehicle-capacity and handling selection (downstream) can read the
  real quantity from the immutable order snapshot.

### Example R: the normal first approval (QUOTED draft, no order yet)

```text
authorized actor ; d1 is QUOTED ; q1 is d1's current, non-superseded, unexpired quote ;
no delivery_order exists for d1
```

- Step 3 reads no order for `d1` → **ORDER ABSENT**. `d1.status` is `QUOTED`, not
  `APPROVED`, so it is **not** an integrity fault — control passes to **step 4**.
  Step 4: `d1` is not terminal (4a), `q1` is not superseded (4b) and not stale
  (4c), and `d1` is `QUOTED` with its current quote → **step 4e → creation branch
  (step 5)**. With 5a–5e satisfied (coordinate-bearing same-merchant pickup,
  mandatory recipient fields present, `clock_timestamp() < q1.expires_at`,
  fingerprint matches, cargo `DELIVERABLE`), step 5f inserts one `delivery_order`
  and flips `d1 -> APPROVED`. Creation is still reached **only** from a `QUOTED`
  draft.

### Example H: end-to-end ("Морской Разливной")

```text
WhatsApp message
    -> persisted delivery_draft            (non-authoritative)
    -> Quote Authority
    -> QUOTED
    -> AUTHORIZED_MERCHANT_ACTOR confirms (draft_id, quote_id)
    -> [ single transaction ]
         (channel actor) non-authoritative discovery: canonical identity -> candidate U
         lock: delivery_draft -> merchant_membership(M,U) -> merchants(M)
               -> ext identity -> binding   (FOR UPDATE, fixed order; M := locked draft.merchant_id)
         tenant-bound access check (recovery + creation): AUTHORIZED_MERCHANT_ACTOR(U, M)
               re-verified under the locks (locked linked_user_id == candidate U)
               ; gate resolves another merchant / U mismatch -> MERCHANT_ACTOR_UNAUTHORIZED
         step 3: read the single order for draft_id (UNIQUE (draft_id)); split on order existence:
           ORDER ABSENT:
             draft.status == APPROVED  -> DELIVERY_ORDER_STATE_INCONSISTENT
             else                      -> step 4        (no existing-order field is inspected here)
           ORDER PRESENT (integrity BEFORE quote match):
             order.merchant_id != M  OR  locked draft.status != APPROVED
                                       -> DELIVERY_ORDER_STATE_INCONSISTENT   (even on exact-pair match)
             else order.quote_id == presented quote_id
                                       -> recovery: return it, 0 writes (any state incl CANCELED)
             else                      -> DELIVERY_APPROVAL_QUOTE_CONFLICT
         step 4 (ORDER ABSENT, draft not APPROVED) ordered priority (all 0 writes):
           terminal draft                       -> DELIVERY_DRAFT_NOT_APPROVABLE
           own quote superseded (OPEN|QUOTED)    -> QUOTE_SUPERSEDED
           OPEN + own quote invalidated, !super  -> QUOTE_STALE
           other OPEN / non-matching quote       -> DELIVERY_DRAFT_NOT_APPROVABLE
           QUOTED + current non-superseded quote -> creation branch:
             5a lock pickup merchant_locations row (after merchants(M); creation only)
                pickup ACTIVE, merchant_id == M, coords present
                (else MERCHANT_LOCATION_REQUIRED / DELIVERY_PICKUP_UNRESOLVED)
             5b re-check recipient_contact + destination_text + destination_point under draft lock
                (else DELIVERY_RECIPIENT_INCOMPLETE / DELIVERY_DESTINATION_UNRESOLVED)
             5c clock_timestamp() < quote.expires_at  (post-lock; else QUOTE_EXPIRED)
             5d recompute delivery_input_fingerprint == quote's  (recipient + destination_point
                + cargo lines {cat,qty,unit} + locked pickup content incl coords ; else QUOTE_STALE)
             5e cargo policy over category set, replica-active constant (cooked + live crayfish DELIVERABLE)
             5f draft QUOTED -> APPROVED  +  INSERT delivery_order (+ recipient snapshot)
    -> PENDING_DISPATCH
    -> Dispatch Authority: PENDING_DISPATCH -> SEARCHING_DRIVER -> DRIVER_ASSIGNED
    -> Execution Authority: PICKED_UP -> DELIVERED

separate guard:
    ALCOHOL present in the cargo set
        -> resolveCargoDeliveryPolicy fails closed
        -> CARGO_NOT_DELIVERABLE
        -> NO delivery_order, draft stays QUOTED
```

## 01A acceptance criteria

`BD-MERCHANT-DELIVERY-ORDER-AUTHORITY-01A` is complete when docs-only review
freezes all of the following:

- Draft, quote, and order are three distinct concepts; a message/draft is never
  the order; a `delivery_draft` is a persisted **non-authoritative** row.
- An order is created only by a single `AUTHORIZED_MERCHANT_ACTOR` result
  (session or verified channel — Approver parity), re-resolved **under
  `FOR UPDATE` locks** inside the write transaction, in a fixed lock order
  (`delivery_draft` → actor's `(M, U)` `merchant_memberships` row → `merchants(M)`
  → external identity → binding; the pickup `merchant_locations` row is locked
  only in the creation branch, step 5a). A channel actor's `U` comes from a
  **non-authoritative pre-lock discovery** read that authorizes nothing and is
  re-verified under the locks. `membership_role in { ADMIN, OPERATOR }`. `M` is
  taken from the **locked `delivery_draft.merchant_id`**; a gate that resolves any
  other merchant, or a channel `linked_user_id` that no longer equals the
  discovery `U`, → `MERCHANT_ACTOR_UNAUTHORIZED`, before recovery. The approval
  transaction is deadlock-free against every **confirmed single-mutation 01B
  path**; composite / future mutation callers must adopt the shared
  *lock-every-affected-membership-in-`id`-order-then-`merchants(M)`* protocol —
  a forward obligation, not a universal deadlock-impossibility claim.
- `delivery_draft: QUOTED -> APPROVED` and the `delivery_order` (+ its 1:1
  `delivery_order_recipient_snapshot`) insert are **one atomic transaction**
  (invariant 6) holding all locks: no `APPROVED` draft without an order, no order
  without an `APPROVED` draft, full rollback on any re-validation failure.
- A `delivery_order` has exactly one recipient and one destination — including a
  canonical **resolved `destination_point`** (coordinates + provider/place
  provenance) — held in a 1:1 immutable snapshot child, not columns and not an
  address book; the point is in the fingerprint, so re-geocoding cannot retarget
  a confirmed delivery. Multi-stop batching is a separate downstream entity.
- `delivery_order_recipient_snapshot` immutability is enforced by **its own**
  `BEFORE UPDATE OR DELETE` guard trigger, not the parent `delivery_order`
  trigger (which does not fire on direct child DML); every `UPDATE` / `DELETE`
  against it is rejected.
- `delivery_order.draft_id` and `delivery_order.merchant_id` are both `NOT NULL`
  and bound by a **composite FK `(draft_id, merchant_id) -> delivery_draft (id,
  merchant_id)`** (or guard trigger), so a persisted order's merchant can never
  diverge from its source draft's — not two independent single-column FKs.
- Pickup resolves from an ACTIVE `merchant_locations` row **owned by the draft's
  merchant and carrying non-null coordinates** (approval query + composite FK /
  trigger, not a plain cross-table `CHECK`), **locked in the creation branch
  (step 5a) and held through commit**; it is never locked on the recovery path;
  a null-coordinate location is `DELIVERY_PICKUP_UNRESOLVED` (no approval-time
  geocode); recipient/destination data is never written to merchant identity
  tables and never used as pickup.
- The creation branch re-checks the mandatory recipient fields
  (`recipient_contact`, `destination_text`, resolved `destination_point`) under
  the draft lock (step 5b); a partial `QUOTED` draft →
  `DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`, never an
  authoritative-but-undeliverable order.
- Cargo is a list of **lines `{ category_code, quantity, unit }`**; deliverability
  is decided over the category set, `quantity`/`unit` are carried into the draft,
  the fingerprint, and the immutable order snapshot (2 kg ≠ 200 kg); capacity /
  transport-condition checks stay downstream and do not extend
  `resolveCargoDeliveryPolicy`.
- `COOKED_CRAYFISH` and `LIVE_CRAYFISH` are `DELIVERABLE`; `ALCOHOL` is
  `NOT_DELIVERABLE` / `IN_STORE_ONLY` (BazarDrive product policy, not a legal
  claim) and blocks order creation.
- Cargo deliverability is a **server-owned versioned constant** behind
  `resolveCargoDeliveryPolicy`, evaluated over the whole set against the
  **replica-active** constant; unknown categories fail closed; `policy_version` is
  recorded on the order **for audit only**. A policy-class / vocabulary change is
  a **coordinated activation** (halt creation-branch approvals on all writers —
  `CARGO_POLICY_TRANSITION` — drain in-flight, confirm no old-constant replica
  remains, activate, resume); an unconfirmed step leaves creation blocked.
- A quote binds to **all** confirmed delivery inputs — recipient, contact,
  `destination_text`, **resolved `destination_point`**, access note, window,
  **cargo lines `{ category, quantity, unit }`** — **and** the canonical
  `pickup_snapshot` (location id plus its content, incl. resolved coordinates),
  via a `delivery_input_fingerprint` on the quote. Mutating any of those on a
  `QUOTED` draft, or editing the resolved pickup content (even with the same id),
  drops the draft to `OPEN` and stales the quote; a mismatch at creation is
  `QUOTE_STALE` and forces a fresh quote + re-approval.
- **Quote lifecycle writes (publish / supersede / invalidate) take the
  `delivery_draft` `FOR UPDATE` lock and hold it through commit**, so
  `QUOTE_SUPERSEDED` / staleness are guaranteed, not timing-dependent: no
  supersession can land between the step-5c re-confirm and commit, and a reprice
  arriving after `-> APPROVED` sees a terminal draft and refuses.
- Approving an expired, superseded, or stale quote does not create an order; the
  order snapshots only the boundary quote fields (incl. the fingerprint), never
  quote computation state. Expiry is evaluated with `clock_timestamp()` **after**
  the blocking locks are held, never a transaction-start timestamp.
- `delivery_order` carries an **unconditional `UNIQUE (draft_id)`** — a DB
  invariant that survives cancellation and holds for secondary writers /
  backfills, not just the service path; a `(draft_id, quote_id)` index serves
  exact-pair recovery; concurrent creations yield exactly one order.
- **Recovery** reads the single order for `draft_id` after the **tenant-bound
  access check and authority locks** (which run for recovery too) and **splits on
  whether that order exists**. *Order absent:* locked `draft.status == APPROVED` →
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert); otherwise → step 4 (a `QUOTED`
  draft with its current quote proceeds to creation) — no existing-order field is
  inspected. *Order present:* integrity **before** the `quote_id` match —
  `order.merchant_id != M` **or** locked `draft.status != APPROVED` →
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert) **even on an exact-pair match**;
  else `order.quote_id` equal to the presented `quote_id` → **recovery** (returned
  in **any** state, incl. `CANCELED`, **zero writes**, no re-check of pickup /
  expiry / supersession / staleness / cargo policy); else →
  `DELIVERY_APPROVAL_QUOTE_CONFLICT`. New creation is reached only from a `QUOTED`
  draft that is not `APPROVED` and has no order.
- Intake dedupe keys on `(merchant_id, origin_channel, origin_namespace,
  adapter_dedupe_token)`; `origin_namespace` is from trusted adapter context and
  mandatory whenever a dedupe token is present — the same message id from two
  provider accounts of one merchant makes two drafts, not one.
- The `## Order-creation authority` dispatch is `lock → always-on access check →
  step-3 recovery/integrity → step-4 no-order priority → step-5 creation`. **Step
  3 reads the single order for `draft_id` and splits on order existence.** *Order
  absent:* locked `draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`;
  otherwise → step 4 — no existing-order field is inspected. *Order present*
  (integrity **before** the `quote_id` match): `order.merchant_id != M` **or**
  locked `draft.status != APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT` even on
  an exact-pair match; else exact `quote_id` → **recovery** (zero writes, any
  state incl. `CANCELED`); else → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. The
  **step-4 priority** (order absent, draft not `APPROVED`) is fixed and applied in
  sequence: (a) terminal
  draft → `DELIVERY_DRAFT_NOT_APPROVABLE`; (b) presented own quote **superseded**
  (`OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`, **before** staleness; (c) `OPEN`
  with the presented own quote **invalidated and not superseded** →
  `QUOTE_STALE`; (d) any other `OPEN` / non-matching quote →
  `DELIVERY_DRAFT_NOT_APPROVABLE`; (e) a `QUOTED` draft with its current
  non-superseded quote → creation. Every rejection is **zero-write** and
  preserves the entry state. Step 5 additionally re-checks, under the draft lock,
  a coordinate-bearing same-merchant pickup (5a, `DELIVERY_PICKUP_UNRESOLVED` /
  `MERCHANT_LOCATION_REQUIRED`) and the mandatory recipient fields (5b,
  `DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`); the
  creation-branch fingerprint recompute (step 5d) also yields `QUOTE_STALE` for a
  pickup-content edit that reached approval before the draft revert propagated.
- A `CANCELED` `delivery_order` is never re-created or resurrected from the same
  draft; a further delivery is a **new draft + new quote + new order**.
- Merchant cancellation via Order Authority is allowed **only in
  `PENDING_DISPATCH`** and is itself an authority action: **one transaction** that
  takes the shared authority prefix (`delivery_draft` → membership → `merchants(M)`
  → identity → binding), re-resolves `AUTHORIZED_MERCHANT_ACTOR(U, M)` with `M`
  from the locked draft, then `FOR UPDATE`s the `delivery_order` row **last** and
  performs `PENDING_DISPATCH -> CANCELED`. A read-side actor check or a
  client-named order id is never trusted. Once Dispatch atomically claims the
  order (`SEARCHING_DRIVER`), cancellation runs through the Dispatch/Execution
  compensation flow.
- The concurrency/race matrix outcomes are fixed.
- Recipient PII is bounded per-order operational data; operational logs carry
  codes and correlation IDs, not raw payloads.
- Passenger `orders`/`rides`/`matching`, driver authorities, notification
  boundaries, and auth enums remain unchanged.
- This slice adds no route, migration, UI behavior, provider automation, quote
  computation, dispatch, or execution runtime.

## Explicit non-goals

- Quote computation / reprice / surge / expiry-duration policy.
- WhatsApp message extraction / AI parsing / Peach automation.
- Driver eligibility, offer dispatch, and the delivery route/batch entity.
- Delivery execution state machine and live-cargo handling enforcement.
- Recipient address book / recipient profiles.
- Merchant billing / settlement / payment capture.
- Regulated-goods licensing and age-verification flows for `ALCOHOL`
  (it is simply not deliverable here).
- Merchant admin UI and merchant delivery settings.
- A coordinated / distributed cargo-policy **store** (the interim mechanism is the
  process-local versioned constant plus the coordinated activation procedure in
  invariant 5 → *Policy-version activation*).
- Retention/erasure implementation for recipient PII.

## Settled architectural decisions

The eight items raised during initial drafting are resolved as follows and are
load-bearing for the contract above. (The Codex review-round refinements below
them — *Additional load-bearing invariants (rounds 1 & 2)* and the *Review-round
P1 resolutions* tables — are **proposed, pending independent re-audit**. **17
review threads are open across two Codex rounds** — the 9 active P1s (1 carried
from round 1 plus the 8 from review `5143028868` on head `0ad9e10`) and 8 round-1
threads now `outdated` by later commits; none is resolved.)

1. **Draft persistence.** `delivery_draft` is a **persisted** server-side entity.
   Persisted is not authoritative: WhatsApp/Peach/manual intake may create or
   augment it, and it is the durable anchor for quoting, expiry, dedupe, and
   recovery after a lost confirmation response — but only an
   `AUTHORIZED_MERCHANT_ACTOR` approval turns `draft + quote` into a
   `delivery_order`.
2. **Quote ownership split.** Confirmed. Quote computation, reprice, surge, and
   `expires_at` duration stay entirely in `BD-MERCHANT-QUOTE-AUTHORITY-01A`. This
   contract owns only the **Quote boundary contract**: the `quote_id`, state,
   expiry check, and the fixed set of immutable snapshot fields the order carries
   — **plus two boundary obligations on Quote Authority**: every quote publish /
   supersede / invalidate write takes the `delivery_draft` `FOR UPDATE` lock
   through commit (per-draft serialization, so supersession/staleness are not
   timing-dependent), and a quote may attach only to a draft with resolved
   `destination_point`, a coordinate-bearing resolved pickup, and present
   mandatory recipient fields.
3. **Recipient shape.** Recipient/destination is a **1:1 immutable child row**,
   `delivery_order_recipient_snapshot`, one per `delivery_order`, written in the
   creation transaction and never updated — a per-order PII capsule, explicitly
   not a reusable recipient address book. Immutability is enforced by the child
   table's **own** `BEFORE UPDATE OR DELETE` guard trigger, not the parent
   `delivery_order` trigger (which does not fire on direct child DML).
4. **Cargo cardinality & detail.** A **list of cargo lines**
   `{ category_code, quantity, unit }` per order. Cooked + live crayfish for one
   recipient at one stop is one order. **Deliverability** is decided over the
   category set — `resolveCargoDeliveryPolicy` fails closed on the first
   non-deliverable/unknown category; any `ALCOHOL` blocks the whole order.
   `quantity`/`unit` (canonically normalized) are carried through the draft, the
   fingerprint, and the immutable order snapshot so 2 kg and 200 kg are distinct;
   capacity and transport-condition checks stay downstream and do **not** extend
   `resolveCargoDeliveryPolicy`.
5. **Cancel/dispatch cutover.** Merchant cancel via Order Authority ends
   **strictly at `PENDING_DISPATCH`**, and is **itself an authority transaction**:
   it takes the shared authority prefix (`delivery_draft` → membership →
   `merchants(M)` → identity → binding, `M` from the locked draft), re-resolves
   `AUTHORIZED_MERCHANT_ACTOR(U, M)` under those locks, then `FOR UPDATE`s the
   `delivery_order` row **last** — never a separate `order -> authority` chain,
   never a trusted read-side check or client-named order id. Once Dispatch
   atomically claims the order (`SEARCHING_DRIVER`), direct merchant-cancel is
   refused (`DELIVERY_ORDER_NOT_CANCELABLE`); later cancellation runs through the
   Dispatch/Execution compensation flow.
6. **Session vs. channel approver parity.** Both are in scope, with **parity of
   right, not of proof**. Session: server-resolved user → ACTIVE membership →
   allowed role. Channel: VERIFIED external identity → linked user → ACTIVE
   binding → ACTIVE merchant → ACTIVE membership → allowed role. Both normalize to
   one `AUTHORIZED_MERCHANT_ACTOR(U, M)`, re-resolved in the write transaction;
   allowed `membership_role in { ADMIN, OPERATOR }`.
7. **Deliverability policy storage.** A **server-owned, versioned constant** in
   the initial runtime, behind `resolveCargoDeliveryPolicy(...)` — not a mutable
   admin-editable table. Initial constant: `COOKED_CRAYFISH` / `LIVE_CRAYFISH`
   deliverable, `ALCOHOL` not deliverable. It is BazarDrive merchant-delivery
   product policy, not a universal legal statement. Because the constant is
   process-local, a policy-class / vocabulary change is a **coordinated
   activation**, not an ordinary rolling deploy: halt creation-branch approvals on
   all writers (`CARGO_POLICY_TRANSITION`), drain in-flight approval transactions,
   confirm no replica still runs the old constant, activate everywhere, resume. An
   unconfirmed step leaves creation blocked (fail-closed); `cargo_policy_version`
   on the order is audit, not the coordination mechanism.
8. **Idempotency key.** `delivery_order` carries an **unconditional `UNIQUE
   (draft_id)`** — a hard DB invariant that survives `CANCELED` (the row is never
   hard-deleted) and holds against secondary writers and backfills, not only the
   service path. `UNIQUE (draft_id, quote_id)` alone is insufficient (it would
   let two rows for one draft with different `quote_id`s coexist); a **separate
   non-unique index on `(draft_id, quote_id)`** serves the exact-pair recovery
   lookup. `draft_id` and `merchant_id` are both `NOT NULL` and bound by a
   **composite FK `(draft_id, merchant_id) -> delivery_draft (id, merchant_id)`**
   (or guard trigger), so the persisted order's merchant can never diverge from
   its source draft's. Because `APPROVED` is terminal for the draft, a draft
   yields **at most one `delivery_order`, ever**. After the tenant-bound access
   check and the invariant-6 authority locks, the branch reads the single order
   for `draft_id` and **splits on whether that order exists**. *Order absent:*
   locked `draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`
   (alert); otherwise → step 4 (a `QUOTED` draft with its current quote proceeds
   to creation) — **no existing-order field is inspected**. *Order present,
   integrity before the `quote_id` match:* `order.merchant_id != M` or locked
   `draft.status != APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT` **even on an
   exact-pair match**; else `order.quote_id` equal to the presented `quote_id` →
   **recovery**, the order returned in **any** state including `CANCELED`, with
   **zero writes**, re-checking nothing else; else (`order.quote_id` differs) →
   `DELIVERY_APPROVAL_QUOTE_CONFLICT`. A canceled order is never resurrected — a
   further delivery is a **new draft**. The provider/adapter dedupe token applies
   to **draft ingestion only** and is never a second competing key for order
   creation.

Additional load-bearing invariants proposed in review **round 1** (pending
independent re-audit):

- **Quote ↔ input binding (P1).** A quote carries a `delivery_input_fingerprint`
  over recipient, contact, `destination_text`, the **resolved `destination_point`**
  (coordinates + provider/place provenance), access note, window, the **cargo
  lines `{ category, quantity, unit }`**, and the resolved `pickup_snapshot` (id
  **plus** content). Mutating any of those on a `QUOTED` draft, or editing the
  resolved pickup content with the same `merchant_location_id`, drops the draft
  `QUOTED -> OPEN` and stales the quote; a creation-branch fingerprint mismatch is
  `QUOTE_STALE`.
- **Recovery / creation split (P2).** `## Order-creation authority` runs a lock +
  always-on access check, then **step 3 (recovery / integrity), split on order
  existence**: read the single order for `draft_id`. *Order absent:* locked
  `draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`; otherwise →
  step 4 (no existing-order field is inspected). *Order present, integrity before
  the `quote_id` match:* `order.merchant_id != M` or locked `draft.status !=
  APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT` even on an exact-pair match;
  else exact `quote_id` → return existing order, zero writes, incl. `CANCELED`;
  else → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. Then the **step-4 ordered priority**
  (order absent, draft not `APPROVED`): (a) terminal
  draft → `DELIVERY_DRAFT_NOT_APPROVABLE`; (b) presented own quote **superseded**
  (`OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`; (c) `OPEN` with the presented own
  quote invalidated and **not** superseded → `QUOTE_STALE`; (d) any other `OPEN`
  / non-matching quote → `DELIVERY_DRAFT_NOT_APPROVABLE`; (e) a `QUOTED` draft
  with its current non-superseded quote → **creation** (step 5: pickup incl.
  coordinates + mandatory recipient fields + quote re-confirm + fingerprint +
  cargo policy → atomic `INSERT` + `QUOTED -> APPROVED`). Every rejection is
  zero-write and preserves the entry state — there is no shared "draft stays
  `OPEN`" rule.
- **invariant 6** governs only the creation branch — `QUOTED -> APPROVED` and the
  `delivery_order` (+ recipient snapshot) `INSERT` are one atomic DB transaction,
  **holding the invariant-6 locks**, after in-transaction re-validation of the
  tenant-bound actor, quote ownership/state/`clock_timestamp()` expiry,
  `delivery_input_fingerprint`, cargo policy, and same-merchant pickup
  eligibility; neither an `APPROVED` draft without its order nor an order without
  an `APPROVED` draft may exist.

Additional load-bearing invariants proposed in review **round 2** (Codex review
`5143028868`, head `0ad9e10`; pending independent re-audit):

- **Quote-lifecycle serialization (P1 — 3958973785).** Every Quote Authority
  write that publishes / supersedes / invalidates a quote takes the
  `delivery_draft` `FOR UPDATE` lock and holds it through commit; the draft row is
  the per-draft quote-serialization point. `QUOTE_SUPERSEDED` / staleness are then
  guaranteed, not timing-dependent (race row 23).
- **Cancellation is a locked authority transaction (P1 — 3958973798, condition
  1).** Merchant cancel takes the shared authority prefix (`delivery_draft` →
  membership → `merchants(M)` → identity → binding, `M` from the locked draft),
  re-resolves `AUTHORIZED_MERCHANT_ACTOR(U, M)`, then `FOR UPDATE`s the
  `delivery_order` row **last**, then gates on `PENDING_DISPATCH`. Never a
  separate `order -> authority` chain; reconciled with approval / repricing /
  dispatch claim (§ *Concurrency and race matrix* preamble; race rows 25–26).
- **Row-level order↔draft merchant binding (P1 — 3958973811).** `NOT NULL`
  `draft_id` / `merchant_id` + composite FK `(draft_id, merchant_id) ->
  delivery_draft (id, merchant_id)` (redundant additive `UNIQUE (id, merchant_id)`
  on `delivery_draft`), or a guard trigger — not two independent single-column FKs
  (invariant 4; race row 24). Distinct from round 1's *actor-gate* tenant binding
  (`M := locked draft.merchant_id`): this is the **persisted** order's provenance.
- **Recipient snapshot own guard (P1 — 3958973823).** `BEFORE UPDATE OR DELETE`
  guard trigger on `delivery_order_recipient_snapshot` itself; the parent
  `delivery_order` trigger does not fire on direct child DML (decision 3; race
  row 27).
- **Resolved pickup point before approval (P1 — 3958973840, condition on
  invariant 4).** The resolved / explicit pickup `merchant_locations` row must
  carry non-null coordinates (`0009` permits null); null → `DELIVERY_PICKUP_UNRESOLVED`
  at step 5a, no approval-time geocode (invariant 4, Quote boundary; race row 28).
- **Recipient completeness re-check (P1 — 3958973863).** Step 5b re-checks
  `recipient_contact` / `destination_text` / `destination_point` under the draft
  lock; missing → `DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`
  (Quote boundary precondition + creation-branch defence in depth; race row 29).
- **Recovery integrity before the quote match (P1 — 3958973879, condition 2;
  order-existence P2 — CORRECTED6).** Step 3 **splits on whether an order exists**.
  *Order absent:* locked `draft.status == APPROVED` →
  `DELIVERY_ORDER_STATE_INCONSISTENT`; otherwise → step 4 — the existing-order
  field checks are **never** applied when no order was read, so a `QUOTED` draft
  with no order proceeds to normal creation. *Order present:* `order.merchant_id
  == M` **and** locked `draft.status == APPROVED` are checked **before**
  `quote_id`; a mismatch is `DELIVERY_ORDER_STATE_INCONSISTENT` (alert), never a
  successful recovery — but a valid `APPROVED` draft with a `CANCELED` order still
  recovers with zero writes (decision 8; race row 30; Example R).
- **Coordinated cargo-policy activation (P1 on a policy change — 3958973893,
  condition 3).** A policy-class / vocabulary change halts creation-branch
  approvals on all writers (`CARGO_POLICY_TRANSITION`), drains in-flight, confirms
  no old-constant replica remains, activates, resumes; an unconfirmed step leaves
  creation blocked. The versioned constant stays; `cargo_policy_version` is audit
  (invariant 5 → *Policy-version activation*; decision 7; race row 31).

## Review-round 1 P1 resolutions (Codex review 5140252744, head `7e58744`)

**Status: proposed docs-only resolutions, pending independent re-audit.** No
change to the frozen `BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY` authority or to
merged 01B runtime is required. The downstream dependencies are additive /
forward and flagged for the schema slice, not performed here: a redundant
`merchant_locations (id, merchant_id)` unique index to back the composite pickup
FK; a `lockActiveMerchantContactBinding` primitive; and — as a **forward
obligation on future mutation callers, not an 01B guarantee** — the deterministic
*lock-every-affected-membership-then-`merchants(M)`* protocol for composite
authority mutations (invariant 6 → *Whole-transaction lock protocol*, race row
22).

| P1 | Fixing section(s) | Verifiable scenario |
| --- | --- | --- |
| Hold locks for actor revalidation | invariant 6 → *Transaction locking* (membership → `merchants(M)`; pre-lock discovery is non-authoritative); Order-creation step 2; race rows 2–3 | Example N; race rows 2–3 (serialize on the membership row / `merchants(M)`). |
| Lock the selected pickup before fingerprinting | invariant 6 → *Transaction locking* (creation-branch-only pickup lock); Order-creation step 5a; race rows 6, 8 | Example K / P; race rows 6, 8. |
| Scope intake dedupe by provider namespace | `delivery_draft.origin_namespace`; Idempotency and recovery; taxonomy note | Example O; race row 12. |
| Enforce one-order-per-draft as a DB invariant | Idempotency and recovery (`UNIQUE (draft_id)`); race row 13 | Race row 13 (secondary writer rejected). |
| Bind the actor gate to the locked draft merchant | Order-creation step 1–2 (`M := locked draft.merchant_id`); Approver parity; race row 10 | Example N; race row 10. |
| Preserve cargo quantities in the snapshot | `delivery_draft.cargo` / `delivery_order.cargo` as lines `{category, quantity, unit}`; invariant 5; Quote boundary; fingerprint | Example A, Example Q. |
| Snapshot the resolved destination point | `delivery_draft.destination_point`; `delivery_order_recipient_snapshot.destination_point`; invariant 4; Quote boundary (resolved before pricing, in the fingerprint) | Example A; `DELIVERY_DESTINATION_UNRESOLVED`. |
| Constrain explicit pickups to the draft merchant | `delivery_draft.requested_pickup_location_id` rule; invariant 4 (composite FK / trigger); Order-creation step 5a; race row 11 | Race row 11. |
| Evaluate expiry using post-lock wall-clock time | invariant 6 (`clock_timestamp()` after locks); Order-creation step 5c; Quote boundary; race row 4; `QUOTE_EXPIRED` taxonomy | Example P; race row 4. |

Of these round-1 threads, `3956662399` (**Bind the actor gate to the locked
draft merchant**) is the one that is not `outdated` by later commits; it is
substantively covered by Order-creation steps 1–2 (`M := locked
delivery_draft.merchant_id`, actor re-resolved for that `M`). Round 2's
`3958973811` is a **different** guarantee — the *persisted* order's `merchant_id`
bound to its draft's at the DB-constraint level (below).

## Review-round 2 P1 resolutions (Codex review 5143028868, head `0ad9e10`)

**Status: proposed docs-only resolutions, pending independent re-audit; all 8
threads open.** Docs-only, still no change to frozen 01A/01B authority or merged
01B runtime. New additive schema-slice dependencies (flagged, not performed
here): a `BEFORE UPDATE OR DELETE` guard trigger on
`delivery_order_recipient_snapshot`; a redundant `UNIQUE (id, merchant_id)` on
`delivery_draft` to back the composite `delivery_order (draft_id, merchant_id)`
FK; a non-null-coordinates constraint on a pickup at approval; and a coordinated
cargo-policy-version **activation procedure** (a deployment contract, not a
schema object).

| P1 (thread) | Fixing section(s) | Verifiable scenario |
| --- | --- | --- |
| Serialize repricing with the approval transaction (`3958973785`) | Quote boundary contract (*Quote lifecycle writes serialize on the `delivery_draft` lock*); race-matrix preamble; Settled decision 2 | Race row 23 (no window between step 5c re-confirm and commit). |
| Revalidate cancellation authority inside the state transaction (`3958973798`) | Cancellation (5-step locked transaction); race-matrix preamble; Settled decision 5 | Race rows 25–26 (revoke / cross-tenant cancel both fail closed). |
| Bind each order's merchant to its source draft (`3958973811`) | invariant 4 (composite `(draft_id, merchant_id)` FK); `delivery_order` field table; Idempotency and recovery; Settled decision 8 | Race row 24 (secondary writer / backfill rejected). |
| Guard the recipient snapshot table against mutation (`3958973823`) | `delivery_order` *Immutability*; `delivery_order_recipient_snapshot` (own `BEFORE UPDATE OR DELETE` guard); Settled decision 3 | Race row 27 (direct child `UPDATE`/`DELETE` rejected). |
| Require a resolved pickup point before approval (`3958973840`) | invariant 4 (non-null pickup coordinates); `delivery_draft` rules; Order-creation step 5a; Quote boundary; `DELIVERY_PICKUP_UNRESOLVED` taxonomy | Race row 28 (null-coordinate ACTIVE pickup blocked). |
| Reject incomplete recipients in the creation branch (`3958973863`) | Order-creation step 5b; `delivery_draft` `OPEN -> QUOTED` preconditions; Quote boundary; `DELIVERY_RECIPIENT_INCOMPLETE` taxonomy | Race row 29 (partial `QUOTED` draft rejected). |
| Reject recovery rows whose draft was never approved (`3958973879`) — with the CORRECTED6 order-existence split so the check applies **only when an order exists** | Order-creation step 3 (ORDER ABSENT / ORDER PRESENT split; integrity before `quote_id` match in the PRESENT branch); Idempotency and recovery; Settled decision 8; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy | Race row 30 (exact-pair order on a non-`APPROVED` draft → integrity fault); Example R (`QUOTED` + no order → step 4 → creation). |
| Coordinate cargo-policy activation across replicas (`3958973893`) | invariant 5 → *Policy-version activation*; Order-creation step 5e; Settled decision 7; `CARGO_POLICY_TRANSITION` taxonomy | Race row 31 (coordinated halt/drain/activate; unconfirmed step ⇒ creation blocked). |

## Expected next slices

1. `BD-MERCHANT-QUOTE-AUTHORITY-01A` — server quote, expiry, reprice, merchant
   approval semantics feeding this order gate.
2. `BD-MERCHANT-WHATSAPP-INTAKE-01A` — provider adapter maps inbound messages
   into a `delivery_draft` without becoming authority.
3. `BD-MERCHANT-DELIVERY-DISPATCH-01A` — driver eligibility + offer dispatch
   using existing Driver/Vehicle/Shift/Compliance authorities; the multi-stop
   delivery route/batch entity.
4. `BD-MERCHANT-DELIVERY-EXECUTION-01A` — pickup -> picked-up -> recipient
   delivery -> terminal lifecycle; live-cargo handling constraints.
5. Schema slice (`-01B`-equivalent) — PostgreSQL tables; **per-table**
   `BEFORE UPDATE OR DELETE` immutability triggers (`delivery_order` **and**
   `delivery_order_recipient_snapshot`); the unconditional `UNIQUE (draft_id)`
   plus the `(draft_id, quote_id)` recovery index; the composite FKs
   `delivery_order (pickup_location_id, merchant_id) -> merchant_locations` and
   `delivery_order (draft_id, merchant_id) -> delivery_draft` with their redundant
   `UNIQUE (id, merchant_id)` parent keys; non-null pickup coordinates at
   approval; `resolveCargoDeliveryPolicy` versioned constant **plus the
   coordinated policy-version activation procedure**; a
   `lockActiveMerchantContactBinding` primitive; FK `RESTRICT`; readiness /
   concurrency / privacy tests; dark service seam, no public route unless
   separately approved.
