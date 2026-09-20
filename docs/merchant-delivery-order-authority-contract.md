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
    invalidate must serialize on the same per-draft lock the approval takes, and
    every successful publication must atomically record its winning `quote_id` on
    the draft; otherwise "approve only the current quote" is timing-dependent or
    cannot be reconstructed when timestamps tie / move non-monotonically. Every
    successfully published quote row is retained: a later publication may move
    the draft marker and lifecycle eligibility, but may never hard-delete, re-key
    or reuse an earlier published quote identity.
12. **Row-level tenant and provenance binding.** A persisted `delivery_order`'s
    `merchant_id` must equal its source draft's, its pickup must belong to that
    merchant, and its recipient snapshot must be immutable — each enforced by a
    DB constraint / its own guard trigger, not only by the approval query.
13. **Resolved-point and policy-activation edges.** A pickup `merchant_locations`
    row may legitimately lack coordinates (`0009` permits `lat`/`lng` both null),
    and even a coordinate-bearing row carries **no provider/place provenance
    store** — `0009` has only `lat`/`lng`, address and labels — yet a delivery
    needs a routable, provenance-bearing pickup point fixed before pricing; and a
    process-local cargo-policy constant needs a coordinated activation across
    replicas, not an after-the-fact `policy_version` note.
14. **Draft-level DB invariants.** A `delivery_draft` is the tenant, quoting,
    dedupe and recovery anchor, so three of its properties must be **database
    invariants**, not service-path habits: it always carries a concrete
    `merchant_id` (a tenantless draft breaks every downstream authority, privacy
    and dedupe assumption); an unapproved draft ages out on a bounded deadline
    (a stated terminal `EXPIRED` with no timestamp or transition rule invites
    incompatible cleanup behaviour); and `delivery_draft.status == APPROVED`
    holds **iff** exactly one `delivery_order` exists for it — a coupling that
    the recovery/cancellation integrity check alone cannot enforce, because
    ordinary dispatch never calls it. The order's point-in-time `quote_state`
    snapshot is likewise a DB-constrained value, not a copied request field.
15. **Lifecycle and policy guards must be DB-enforced, not just algorithmic.**
    The deferred coupling above accepts an order in *any* state; separately, a
    persisted order must be born in `PENDING_DISPATCH`, its cargo set must clear a
    **recorded historical policy decision** (not merely pass a shape check, and
    not `resolveCargoDeliveryPolicy` in the canonical quote fingerprint), and a
    draft must obey a **legal state-transition graph** so a backfill cannot
    resurrect `ABANDONED` / `EXPIRED`. And a cross-tenant *approval* probe must be
    externally indistinguishable from an unknown draft, mirroring cancellation.
16. **The `INSERT` boundary itself must re-prove time, authority and source, not
    only structure.** Structural backstops (FKs, fingerprint equality, coupling)
    accept a row whose referenced quote or draft *deadline* has already passed,
    whose approval membership / channel gate is *currently* `REVOKED`, or whose
    `CANCELED` status carries a null merchant-cancellation tuple that
    `Existing-order integrity` then reads as "legitimate compensation" — because
    recovery-time checks deliberately never re-evaluate current time or current
    eligibility. So the trusted creation / transition boundary must, at write
    time: take one fresh server `clock_timestamp()` and stamp an immutable,
    non-backdatable `delivery_order.created_at` that precedes both the draft and
    the quote deadline; verify the actor gate is *currently* eligible for every
    new order (while later recovery keeps its historical, no-recheck behaviour);
    require a fresh due-time and stamp `expired_at` on every `-> EXPIRED`; and
    record an explicit, write-once cancellation *source* discriminator. Intake
    idempotency and explicit-pickup tenancy must likewise be real DB constraints,
    not service-path habits.

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
- Approving a **superseded** quote (a retained, successfully published own quote
  whose id differs from the draft's durable `latest_published_quote_id`) is
  rejected (`QUOTE_SUPERSEDED`); approval must name that exact marker value.
  Mere addressability of a same-draft candidate whose publication never committed
  is not supersession and reaches step 4d. Publication order is never inferred
  from a quote timestamp, UUID ordering, or price.
- A later reprice creates a new quote; it never mutates an already-created order.
  Every successfully published quote is retained as the same immutable
  `(quote_id, draft_id)` identity with immutable owner, payload, fingerprint and
  publication timestamps. A quote-owned guard rejects hard-delete even after a
  later quote replaces it as the marker; the existing controlled lifecycle
  eligibility/state transitions remain Quote Authority-owned. No ledger,
  tombstone or replacement row substitutes for the retained quote.
- The order snapshots the approved quote's boundary fields, including its
  `delivery_input_fingerprint` (see **Quote boundary contract**), so it is
  readable without walking back into quote history.
- A retry that names the exact `(draft_id, quote_id)` of an existing order is a
  **recovery**: after the access check and **Existing-order integrity** (including
  recipient snapshot, quote ownership and approval membership tuple), it returns that order —
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
  (default, or an explicit location persisted on the draft **before quoting**) **whose
  `merchant_id` equals the draft's `merchant_id`**. If no unambiguous ACTIVE
  same-merchant pickup location resolves, order creation fails closed with
  `MERCHANT_LOCATION_REQUIRED` (01A code); it never guesses and never uses
  recipient data as pickup.
- Approval names only the already-quoted draft/quote pair; it cannot supply or
  override pickup selection. Changing `requested_pickup_location_id` is a draft
  edit that invalidates the quote and requires a new quote before approval.
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
- **The resolved pickup location must carry a stored resolved point with
  provenance.** `0009` permits an ACTIVE `merchant_locations` row with `lat` and
  `lng` both null, **and stores no provider/place identifier or provenance at
  all** — only `lat`/`lng`, address and labels. A *delivery* pickup additionally
  requires a canonical **resolved pickup point** — coordinates, a real
  provider/place id and provenance, and the source address/coordinates it was
  resolved from — fixed before quoting exactly like the resolved
  `destination_point`. The schema slice adds a **nullable
  `merchant_locations.resolved_pickup_point`** (or a dedicated pre-quote pickup
  snapshot entity) to hold it; a **trusted resolver-persist procedure** writes it
  from an external resolver's result **before pricing**, after re-reading the
  source address/coordinates under the existing `draft -> [authority prefix] ->
  merchant -> location` locks — never a `location -> draft` lock inversion, and
  never fabricated from bare coordinates. Any edit to the location's
  address/coordinates **clears or invalidates** a now-stale `resolved_pickup_point`,
  forcing re-resolution. A legacy row may leave it null; a resolved / explicit
  pickup whose coordinates **or** `resolved_pickup_point` are null is unusable →
  `DELIVERY_PICKUP_UNRESOLVED` (no guess, no approval-time geocode). The full
  stored point (coordinates + provenance + source binding) is carried into
  `pickup_snapshot` and the fingerprint, so later routing never re-geocodes into
  a different one, and **Existing-order integrity** verifies only that frozen
  copy — never against the location's current `resolved_pickup_point`, and with
  no new pickup lock on the recovery path. This is a future **schema + writer
  dependency**, flagged for the slice, not performed here.
- The destination is recipient-supplied per-delivery data. It is never inserted
  into `merchant_locations` and never promoted to merchant identity. Its
  **resolved point** is the full destination-specific source-bound shape —
  coordinates + provider/place provenance + versioned `source_text_binding`
  matching the canonical `destination_text` it was resolved from — fixed before
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

- **Validate cargo shape before policy.** Quote publication and order creation
  use the same canonical `validateDeliveryCargoLines` contract: a non-empty,
  bounded list of lines; every line has a category code, a finite positive
  quantity within the canonical bounds/precision, and a unit from the fixed
  vocabulary. Null/missing lines, an empty list, zero/negative/non-finite or
  out-of-bounds quantities, and missing/unsupported units fail closed with
  `DELIVERY_CARGO_LINE_INVALID`. The Quote/schema slice fixes the concrete
  bounds, precision and unit vocabulary in one shared definition before runtime
  activation; neither consumer invents a fallback. Creation re-checks that the
  stored lines are already canonical under the draft lock, before fingerprint
  comparison and `resolveCargoDeliveryPolicy`; it never silently rewrites them.
  The future order schema also enforces non-empty, valid canonical cargo against
  secondary writers (row constraints or an equivalent immutable-shape guard).
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
  becomes non-deliverable between quote and approval blocks the approval;
- **the order carries the policy decision as immutable data, and a DB validator
  re-derives and re-checks it at `INSERT`.** `cargo_policy_version` and a new
  `cargo_policy_decision` are `NOT NULL` and immutable. A **trusted `INSERT`
  validator** (future schema, from the *same immutable policy definition* the
  server resolver uses — still a versioned constant, **not** a mutable/admin
  policy store) derives the category set from the row's actual `NEW.cargo`,
  evaluates it under the **activated** policy version, and confirms the stored
  `cargo_policy_version` / `cargo_policy_decision` match that evaluation. A
  backfilled `DELIVERABLE` decision, or a stored older permissive
  `cargo_policy_version` that does not actually clear the row's categories, does
  **not** bypass the check. `resolveCargoDeliveryPolicy` and the policy decision
  are **not** part of the canonical quote-input fingerprint;
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
activation**, not an ordinary deploy, and it spans **both the application
resolver and the DB `INSERT` validator** (which read the same immutable policy
definition) plus **every `delivery_order` writer**:

1. stop admitting new **creation-branch** approvals — and any other new
   `delivery_order` `INSERT` — on **all** writers (`CARGO_POLICY_TRANSITION`,
   retryable);
2. **drain to COMMIT or ROLLBACK every already-started order-creation
   transaction** — approval **and** every other `delivery_order` `INSERT` path,
   including secondary writers and backfill jobs — so that no transaction which
   evaluated cargo under the old constant is still open;
3. confirm no replica — application resolver **or** DB validator — still running
   the old constant remains, **and** that the step-2 drain is complete;
4. activate the new constant everywhere (resolver and validator together);
5. resume admitting creation-branch approvals / order inserts.

Until steps 2–3 are **confirmed**, the new version is **not** activated and new
inserts are **not** resumed. If any step cannot be confirmed, creation **stays
blocked** (fail-closed) and new `delivery_order` inserts are refused — a stalled
activation never silently falls back to mixed constants, and never switches while
an old-constant creation transaction is still in flight. **Recovery** does not re-check cargo policy against the
*current* constant, so an order already approved under the old constant stands
unchanged; **Existing-order integrity** does re-check the order's *stored*
`cargo_policy_decision` against its immutable `cargo` and that decision's own
version (old version definitions are retained). This keeps the versioned-constant
model (no mutable policy store) while making the cross-replica transition honest;
a future move to a coordinated policy store is still an ordered follow-up
(Explicit non-goals).

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
invariant-6 locks and the step-5a pickup lock** — has re-validated all of the
following. This list names the obligations; the numbered Order-creation
authority algorithm defines their execution and error priority (in particular,
step 5b validates cargo shape before step 5c checks quote state and expiry):

- the merchant actor — `AUTHORIZED_MERCHANT_ACTOR(U, M)` re-resolved from the
  **locked** authority rows for the **locked draft's** `M`, never carried in from
  a pre-transaction check; a channel actor's candidate `U` from pre-lock
  discovery is re-verified against the locked `linked_user_id`. The trusted
  creation procedure verifies this gate is **currently eligible** (merchant
  `ACTIVE`, membership ACTIVE + allowed role, channel identity `VERIFIED` +
  binding) at insert time and writes provenance from that re-checked result — for
  **every** new order, backfills included (see *The creation transaction*);
- quote ownership (belongs to this draft), state (approvable), and
  `clock_timestamp() < expires_at` — an authoritative wall-clock read taken
  **after** the blocking locks are held, not the transaction-start `now()` /
  `CURRENT_TIMESTAMP`, which stays fixed while the transaction waits on a lock —
  re-checked once more at step 5f against the single fresh `t` that also stamps
  the immutable `delivery_order.created_at`, together with the draft's
  `expires_at`;
- non-empty canonical cargo-line shape (invariant 5), before fingerprinting;
- **the quote's `delivery_input_fingerprint`** still equals a fresh canonical
  fingerprint over the current draft inputs (recipient, contact,
  `destination_text`, `destination_point`, access note, window, cargo lines `{category, quantity,
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

**This coupling is also a DB invariant, not only a service-path property.**
`Existing-order integrity` catches a non-`APPROVED` source draft, but it runs
**only** on the recovery and cancellation paths — a secondary writer or backfill
could still insert a structurally valid `PENDING_DISPATCH` order for a `QUOTED`
draft, or flip a draft to `APPROVED` with no order, and every documented FK and
uniqueness constraint would pass, after which the dispatch claim (which never
calls that check) could carry the malformed order forward. The schema slice
therefore adds a **deferred (at-commit) constraint-trigger pair — one on
`delivery_draft`, one on `delivery_order`** — that inspects the **final committed
rows** (never an intermediate `NEW.status`): at commit, a `delivery_draft` whose
`status == APPROVED` must have **exactly one** `delivery_order` for its
`draft_id` in **any** lifecycle state (including `CANCELED`), and a draft in any
other status must have **zero**. Because it checks end-of-transaction state, the
lawful in-order sequence `INSERT delivery_order -> INSERT
delivery_order_recipient_snapshot -> flip draft QUOTED -> APPROVED` in one
transaction still commits cleanly, and a later `PENDING_DISPATCH -> CANCELED` or
`-> SEARCHING_DRIVER` transition keeps the pair intact (draft still `APPROVED`,
still exactly one order). The `delivery_order`-side trigger performs a
**non-locking** read of its draft row (no `FOR UPDATE`), so it adds **no** late
`delivery_draft` lock to an ordinary dispatch/cancellation `UPDATE` and does not
disturb draft-first serialization. This is a future schema dependency, flagged
for the slice, not performed here.

**Every new `delivery_order` is created through one trusted transactional
creation procedure — including secondary writers and backfills.** Ordinary
writer roles are **not** granted a direct `INSERT` on `delivery_order`
(the DB `GRANT`s are a future schema dependency); the only path in is the
procedure, which holds the invariant-6 lock order
(`draft -> membership -> merchant -> identity -> binding -> pickup`) through
`COMMIT`/`ROLLBACK` and, at write time:

- **re-proves the actor gate is *currently* eligible** — it derives `M` from the
  **locked** draft, is handed a *trusted* actor context (never request-supplied
  IDs or a "verified" flag), and re-checks the merchant is `ACTIVE`, the
  `(M, U)` membership is ACTIVE with an allowed role, and (channel) the identity
  `channel_proof = VERIFIED` / `linked_at` / binding are all currently valid.
  `approved_by_user_id` / `approved_membership_id` / **`approval_channel`** / the
  channel identity-binding pair / `approval_provenance` are written **from that
  re-checked result** — `approval_channel` is the trusted-proof path that
  actually passed (`SESSION` for a session actor, `WHATSAPP` / `SMS` for the
  verified channel), `NOT NULL`, never inferred from the pair's null-ness or
  defaulted. A tuple-correct but `REVOKED` membership, or a revoked/unverified
  channel identity or binding, fails here — so no order becomes authoritative
  without an actor authorized *at insertion time*. (Later **recovery** is
  unchanged: it keeps the historical tuple checks and never re-evaluates the
  original approver's current eligibility.);
- **re-proves both deadlines against one fresh server clock** (Finding-1 rule
  below): after the locks it takes a single `t := clock_timestamp()`, requires
  `t < delivery_draft.expires_at` (else `DELIVERY_DRAFT_EXPIRED`, `ROLLBACK`,
  no order) then `t < referenced_quote.expires_at` (else `QUOTE_EXPIRED`,
  `ROLLBACK`, no order), and **stamps `delivery_order.created_at := t`** —
  `NOT NULL`, immutable, not backdatable. Both checks are mandatory: between
  step 5c and the `INSERT` either the draft or the quote can lapse. The
  server-defined creation moment is `t`, not `COMMIT`. This applies to **every**
  new `INSERT`, backfills included.

No late reverse capture of authority locks is added inside an `INSERT` trigger —
the locks are the procedure's, taken in the fixed prefix order. **Existing-order
integrity** verifies only the *historical* relations
(`created_at < each immutable deadline`, immutable tuple ownership,
`cancellation_authority` and its references) — never current time or current
eligibility — so a correctly-created order still recovers after both deadlines
have long passed and after every original grant has been revoked. The external
approval-masking of CORRECTED15 (any locked-gate failure → external
`DELIVERY_DRAFT_NOT_FOUND`) is unchanged.

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
| `merchant_id` | **`NOT NULL`** FK to `merchants(id)`; the resolved merchant context `M`. A concrete merchant is resolved **before** the draft `INSERT`, for **every** `origin_channel` (`WHATSAPP` / `SMS` / `SESSION`) and every draft status. Intake that cannot resolve a merchant is **not** persisted as a tenantless `delivery_draft` — it fails/parks upstream. A tenantless draft would break the tenant-bound actor gate, the `(merchant_id, …)` intake dedupe key (nulls compare distinct), and the per-merchant privacy boundary. **Immutable after the `INSERT`:** the same immediate row-local `BEFORE UPDATE` guard that confines `status` also rejects **any** `OLD.merchant_id -> NEW.merchant_id` change — in every status, for every writer / backfill, on each successive intra-transaction `UPDATE` — so the tenant boundary, the actor gate and the intake-dedupe key can never be re-pointed at another merchant. The allowed draft-intent edits (recipient / contact / destination / access note / window / cargo) are unaffected. |
| `origin_channel` | **`NOT NULL`**, closed enum `WHATSAPP | SMS | SESSION` (DB `CHECK` / enum type) — provenance of the intake, not authority. `NOT NULL` is required so the intake dedupe `UNIQUE` cannot be evaded through a `NULL` key component. **Immutable after the `INSERT`** as part of the frozen intake tuple (see `adapter_dedupe_token`). |
| `origin_namespace` | Nullable bounded **canonical, nonblank** adapter/provider namespace — provider account / business-number scope, mirroring 01A's `subject_namespace` — set **only** from trusted adapter context, never from message content. When non-null it is stored only after the shared namespace canonicalizer and must remain nonblank after canonical whitespace handling; DB length/shape checks include `CHECK (origin_namespace IS NULL OR btrim(origin_namespace) <> '')`. **Mandatory whenever `adapter_dedupe_token` is set**, enforced together with `CHECK (adapter_dedupe_token IS NULL OR origin_namespace IS NOT NULL)`. A blank/whitespace namespace is invalid, never a dedupe scope. **Immutable after the `INSERT`** as part of the frozen intake tuple (see `adapter_dedupe_token`). |
| `origin_ref` | Bounded provider/message/session provenance label. |
| `adapter_dedupe_token` | Nullable bounded **canonical, nonblank when present** provider/adapter dedupe key for **intake idempotency only** (see Idempotency); part of the immediate `UNIQUE (merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)`; never a key for order creation. A non-null token is stored only after the shared adapter-token canonicalizer and is rejected if blank/whitespace-only; the DB backstop includes `CHECK (adapter_dedupe_token IS NULL OR btrim(adapter_dedupe_token) <> '')` plus the frozen length/shape bound. `NULL` means **no token** and is preserved as `NULL` — it is not canonicalized into an empty key — so several tokenless manual drafts for one merchant coexist. **The whole intake tuple `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` is immutable after the `INSERT`:** an immediate row-local `BEFORE UPDATE` guard rejects any change to any component under a **null-safe** `OLD`/`NEW` comparison (`IS DISTINCT FROM`), including setting a non-null `adapter_dedupe_token` back to `NULL` — so a token-backed draft's dedupe identity cannot be freed through an `UPDATE`. A **row-local `BEFORE DELETE` guard** additionally rejects a hard-delete of any **token-backed** draft (`adapter_dedupe_token IS NOT NULL`), in **any** status, so the `UNIQUE` row that a later redelivery collides with cannot disappear. Tokenless drafts stay freely creatable by separate repeat `INSERT`s. A future PII-retention / erasure mechanism is **out of scope here** and must, when it lands, preserve this dedupe guarantee (e.g. a redaction that keeps the intake tuple, not a hard delete). |
| `recipient_name` | Bounded string (mutable draft intent). |
| `recipient_contact` | Bounded normalized recipient phone (reuses the auth phone canonicalizer); recipient is not a `users` row. |
| `destination_text` | Bounded human destination as stated (mutable draft intent). |
| `destination_point` | Nullable canonical **resolved** destination — coordinates plus stable provider/place id, provenance, **and a destination-specific `source_text_binding` to the exact canonical `destination_text` that was resolved** — written by the trusted destination-resolver persistence path **before** the quote is computed. The binding is a versioned canonical binding/digest, not a second free-text address copy; Quote Authority freezes its canonicalizer/version before activation. The writer re-reads `destination_text` under the draft lock before persisting the resolver result. A later `destination_text` edit clears/invalidates the stored point; a missing/invalid binding or one that does not match the draft's current canonical `destination_text` is unresolved (`DELIVERY_DESTINATION_UNRESOLVED`), even if coordinates/provider id/provenance look valid. |
| `destination_access_note` | Nullable bounded entrance/floor/door note. |
| `requested_pickup_location_id` | Nullable FK to `merchant_locations(id)`; explicit selection is persisted here **before quoting**, never supplied/overridden by approval. **When set it must name a location whose `merchant_id` equals this draft's `merchant_id`** — enforced at `INSERT`/`UPDATE` by a **draft-level composite FK `(requested_pickup_location_id, merchant_id) -> merchant_locations (id, merchant_id)`** (reusing the same unconditional `merchant_locations (id, merchant_id)` parent key the order-side pickup FK needs), `ON DELETE RESTRICT`, `MATCH SIMPLE` so a `NULL` `requested_pickup_location_id` ("resolve default") is still allowed. A cross-tenant location id can no longer be stored on the draft even transiently. The resolved pickup location (explicit or default) must carry both coordinates **and a valid, source-consistent `resolved_pickup_point`** (coordinates + provider/place id + provenance + source binding) before a quote can attach — a null-coordinate or missing / invalid / source-inconsistent `resolved_pickup_point` location is `DELIVERY_PICKUP_UNRESOLVED` (invariant 4). The FK enforces **ownership** only; the ACTIVE / default / resolved-point checks at quoting and approval stay separate. |
| `requested_window` | Nullable bounded requested delivery time window. |
| `cargo` | Non-empty **list of cargo lines**, each `{ category_code, quantity, unit }`, canonically normalized (fixed `unit` vocabulary, bounded `quantity`). The **category set** drives deliverability (invariant 5); `quantity` / `unit` are carried through the fingerprint and the order snapshot for quote binding, vehicle-capacity selection, handling, and proof of what was approved — capacity and transport-condition checks themselves stay downstream. |
| `latest_published_quote_id` | Nullable durable identity of the **most recently successfully published** quote for this draft. `NULL` before the first successful publication; otherwise protected by composite FK `(latest_published_quote_id, id) -> quote (id, draft_id)` (`MATCH SIMPLE`, `ON DELETE RESTRICT`). Only the trusted Quote Authority publication transaction may replace it, while holding this draft `FOR UPDATE`, atomically with publishing that exact quote and the draft quote state. Failed publication never changes it. Invalidation, `QUOTED -> OPEN`, expiry, abandonment and approval **do not clear or repoint it**: retaining the last winner distinguishes an older superseded quote from the latest-but-now-stale quote. The FK protects the current marker but is **not** the history-retention mechanism: a quote-owned guard rejects hard-delete of every successfully published quote, including an older q1 after q2 becomes the marker, so the actual same-draft row remains available for classification. `QUOTED` / `APPROVED` require the marker non-null; on `APPROVED` it equals the single order's `quote_id`. It is never derived from `computed_at`, `published_at`, UUID order or price. |
| `status` | `OPEN | QUOTED | APPROVED | ABANDONED | EXPIRED`. `EXPIRED` is reached only by the deadline sweep below (from `OPEN` / `QUOTED`), never from `APPROVED`. |
| `expires_at` | **`NOT NULL`, finite, immutable.** Derived with `created_at` at the trusted draft-INSERT boundary below: `expires_at = created_at + TTL`. No caller-supplied timestamp or TTL is accepted. Edits, repricing and dedupe recovery never extend it; it is independent of quote expiry. |
| `expired_at` | Server timestamp of the `-> EXPIRED` transition. **`NULL` on every non-`EXPIRED` draft; `NOT NULL` on every `EXPIRED` draft**, `>= expires_at`, and **immutable once set** (a further `UPDATE` cannot re-stamp it). It is set **atomically by whatever performs the transition** — the deadline sweep, or the row-local transition guard itself — from a fresh server `clock_timestamp()` taken under the row lock, never from a caller-supplied value; a supplied future timestamp does not license an early transition. Enforced by the row-local guard (see Rules): a non-`EXPIRED` row with a non-null `expired_at`, an `EXPIRED` row with a null `expired_at` or one earlier than `expires_at`, or a re-stamp, is rejected. |
| `created_at` / `updated_at` | Both initially set to the same fresh server instant by the trusted draft-INSERT boundary. `created_at` is **`NOT NULL`, finite and immutable**, including on same-status updates. `updated_at` remains server-maintained for lawful later changes; neither field is a client authority input. |

### Trusted draft-INSERT boundary

Every new draft, from manual intake, a channel adapter or a backfill, is created
through one trusted transactional insertion procedure. Ordinary writer roles
have no direct `INSERT` on `delivery_draft`; neither a column default nor an
adapter's claim that a timestamp is server-generated is a substitute. This is a
future schema/procedure/privilege obligation, not an implementation in 01A.

The boundary rejects caller-supplied `created_at`, `updated_at`, `expires_at`,
`expired_at` or TTL, even a plausible value, as `DELIVERY_DRAFT_INPUT_INVALID`.
It also canonicalizes and validates the intake-dedupe components **before the
UNIQUE key can participate in recovery**: every non-null `origin_namespace` and
`adapter_dedupe_token` must already be the bounded canonical form and nonblank;
blank/whitespace-only input is `DELIVERY_DRAFT_INPUT_INVALID`, zero writes.
`adapter_dedupe_token = NULL` remains the distinct tokenless case and does not
get trimmed/coerced to an empty token. The schema backstops the nonblank/bounds
rules, while the trusted writer owns canonicalization; no lookup is performed
under one representation and stored under another.
For a fresh row, after prerequisite reads/locks and immediately at insertion it
takes one finite `t_d := clock_timestamp()`, writes `created_at = updated_at =
t_d`, `expires_at = t_d + TTL`, `expired_at = NULL`,
`latest_published_quote_id = NULL`, and `status = OPEN`.
The fixed positive TTL and its finite maximum are one shared schema/Intake
constant, frozen before intake activation, never an environment-, replica-,
merchant- or caller-selected duration. Missing or divergent definitions block
activation; no fallback duration is used. This correction does not invent a
concrete duration or widen the existing non-authoritative intake actor allowance.

The database independently enforces non-null finite timestamps and the exact
`expires_at = created_at + TTL` relationship with `0 < TTL <= TTL_MAX`, using
that frozen constant, not a client-writable row TTL. Overflow, infinity and
non-positive/out-of-bound durations are rejected. The immediate update guard
rejects changes to either `created_at` or `expires_at` on every update, including
same-status and successive intra-transaction updates. The protected insertion
procedure derives the initial instant itself; direct inserts cannot select a
plausible timestamp pair that merely passes the arithmetic constraint. Ordinary
roles cannot replace that procedure, alter its constants or disable the guards.

A full intake-key collision resolves to the original draft without updating its
identity, timestamps or status; conflict recovery must use a usable transaction
(after rollback/savepoint handling as required), never a failed transaction or
an upsert that refreshes expiry. Changing TTL later requires a separate reviewed
schema/contract change preserving existing deadlines and their original valid
relationship; changing a global constant in place must not invalidate history.

Rules:

- a draft authorizes nothing and never dispatches a driver;
- **every draft is tenant-bound** — `merchant_id` is `NOT NULL` and set before
  the `INSERT`; there is no tenantless draft in any state or channel;
- the exact confirmed-input set — `recipient_name`, `recipient_contact`,
  `destination_text`, the full `destination_point`, `destination_access_note`,
  `requested_pickup_location_id`, `requested_window`, and the full canonical
  `cargo` lines — is mutable **intent** only while the draft is `OPEN`; it is
  frozen into order-owned snapshots at approval. The row guard compares every
  member null-safely (`OLD.x IS DISTINCT FROM NEW.x`), including the full point /
  cargo value, rather than relying on `status` alone;
- `OPEN -> QUOTED` when a quote is attached. Preconditions Quote Authority
  enforces before a quote may attach — the **creation branch re-checks each one
  under the draft lock** (defence in depth): the mandatory recipient fields
  `recipient_contact` and `destination_text` are present
  (`DELIVERY_RECIPIENT_INCOMPLETE` otherwise); `destination_point` is present,
  shape-valid **and its `source_text_binding` matches the current canonical
  `destination_text`** (`DELIVERY_DESTINATION_UNRESOLVED` otherwise); the resolved pickup location
  carries coordinates **and a valid, source-consistent `resolved_pickup_point`**
  (`DELIVERY_PICKUP_UNRESOLVED` otherwise); cargo lines pass
  the shared canonical shape check (`DELIVERY_CARGO_LINE_INVALID` otherwise).
  A quote binds to
  the exact delivery inputs it priced (see **Quote boundary contract**);
- **any mutation of those intent fields on a `QUOTED` draft — including a change
  to `destination_point` or a cargo line's `quantity`/`unit` — must occur through
  the trusted intent-mutation transaction and atomically drop the draft `QUOTED
  -> OPEN` and invalidate the quote named by the retained
  `latest_published_quote_id`**; a same-status `QUOTED -> QUOTED` intent edit is
  rejected. Any change to the canonical content of the resolved pickup location
  (address edit, coordinate change, default flip, archive, even with the same
  `merchant_location_id`) follows its existing separate invalidation path. A
  fresh quote must be computed against the new inputs before approval.
  Re-geocoding that would change `destination_point` follows the same intent rule
  — it can never silently alter a confirmed delivery;
- `-> APPROVED` happens **only** inside the single transaction that creates the
  `delivery_order` (invariant 6), and only from `QUOTED`;
- `ABANDONED` / `EXPIRED` are terminal for the draft; a new request is a new draft.
  Entering `ABANDONED` is permitted only by **Draft abandonment** below, not by
  the state-transition graph or a pre-transaction actor check alone;
- **a legal state-transition graph is enforced by an immediate row-local DB
  guard** (a `BEFORE INSERT OR UPDATE` trigger on `delivery_draft`), **separate
  from and additional to** the deferred draft/order coupling: a new draft
  `INSERT` may only be `OPEN`; `OPEN -> { QUOTED, ABANDONED, EXPIRED }`;
  `QUOTED -> { OPEN, APPROVED, ABANDONED, EXPIRED }`; `APPROVED`, `ABANDONED` and
  `EXPIRED` are **absorbing** — any transition **out** of them to a different
  status is rejected. The guard evaluates every `OLD.status -> NEW.status`,
  including successive UPDATEs inside one transaction (a backfill cannot hop
  `ABANDONED -> QUOTED` even transiently). A same-status UPDATE is **not**
  rejected on status alone, but the same guard additionally enforces confirmed
  intent: an `OPEN` intent edit must leave that statement `OPEN`; a `QUOTED`
  intent edit must be `QUOTED -> OPEN`; and any intent edit whose `OLD.status` is
  `APPROVED`, `ABANDONED` or `EXPIRED` is rejected even if the status is
  unchanged. Successive UPDATEs are checked independently. **Every
  `OPEN`/`QUOTED` -> `EXPIRED` transition, whoever performs it,
  must (under the row lock) take a fresh `t_exp := clock_timestamp()`, require
  `t_exp >= OLD.expires_at`, and set `NEW.expired_at := t_exp`** — the guard
  itself refuses a premature `-> EXPIRED` (deadline not yet reached) and refuses
  a caller-supplied `expired_at` (future or otherwise); a re-`UPDATE` cannot move
  `expired_at`. It also enforces the field's null-ness rule (non-`EXPIRED` ⇒
  `expired_at IS NULL`; `EXPIRED` ⇒ `NOT NULL` and `>= expires_at`). This guard
  does not replace actor authority, the expiry worker's `OPEN`/`QUOTED` +
  no-order + due preconditions and its atomic quote-eligibility invalidation, or
  the deferred coupling, and it adds no cross-table lock;
- **the tenant is immutable after the `INSERT`.** The same immediate row-local
  `BEFORE INSERT OR UPDATE` guard rejects **any** `OLD.merchant_id ->
  NEW.merchant_id` change, in **every** status (`OPEN` / `QUOTED` / `APPROVED` /
  `ABANDONED` / `EXPIRED`), for **every** writer and backfill, evaluating each
  successive `OLD -> NEW` inside one transaction. A secondary writer therefore
  cannot re-tenant an `OPEN` / `QUOTED` draft to another merchant to expose the
  recipient PII to, or let it be re-priced / approved by, that merchant's actor;
  a genuinely different tenant's request is a **new draft**. The allowed
  draft-intent edits are unchanged;
- **the intake identity is durable.** The whole intake tuple `(merchant_id,
  origin_channel, origin_namespace, adapter_dedupe_token)` is immutable after the
  `INSERT` (null-safe `IS DISTINCT FROM` comparison in the same guard — no
  component may change, and a non-null `adapter_dedupe_token` may not be set back
  to `NULL`), and a **`BEFORE DELETE` guard** rejects a hard-delete of any
  **token-backed** draft (`adapter_dedupe_token IS NOT NULL`) in any status. So a
  cleanup job or secondary writer cannot free a token-backed draft's dedupe row —
  through `UPDATE` or `DELETE` — and let a later adapter redelivery of the same
  key insert a fresh `OPEN` draft, reset the deadline, or resurrect an
  `ABANDONED` / `EXPIRED` request into an order. Redelivery of the original key
  keeps colliding with, and resolving to, the original draft in its recorded
  status. Tokenless (`NULL` token) manual drafts stay freely creatable by
  separate repeat `INSERT`s. Concrete retention duration and any PII
  redaction/erasure implementation are **out of scope for this slice**; a future
  erasure mechanism must preserve this dedupe guarantee (retain the intake tuple,
  never hard-delete a token-backed row);
- **draft expiry is a bounded deadline swept by a trusted worker.** `expires_at`
  is `created_at + TTL` (fixed constant, set once, immutable; edits/reprices
  never extend it; independent of quote expiry). A trusted cleanup worker, **under
  the `delivery_draft` `FOR UPDATE` lock**, re-checks that the draft is still
  `OPEN` / `QUOTED`, that **no `delivery_order` exists** for it, and that
  `clock_timestamp() >= expires_at` (authoritative wall clock), then atomically
  moves it `OPEN|QUOTED -> EXPIRED`, sets `expired_at`, and invalidates the quote
  named by `latest_published_quote_id` without clearing that marker. It **never**
  normalizes corruption — a draft that
  is `APPROVED`, or that has an order, is left untouched (flagged, not swept). An
  `APPROVED` draft **never expires**. A due-but-not-yet-swept draft is still
  rejected at approval/publication by the same deadline check (Order-creation
  step 4 / step 5, Quote boundary), so the sweep is a cleanup, not the guard;
- `APPROVED` is terminal for the draft: it is never re-quoted, never re-approved,
  and its one `delivery_order` — in **any** state, including `CANCELED` — is the
  record of record. A delivery after a cancellation is a **new draft**.

### Trusted draft-intent mutation boundary

All writes to the confirmed-input set use one trusted draft-first transaction;
ordinary application, adapter and backfill roles have no direct `UPDATE` grant on
those fields, draft `status`, quote eligibility, or
`latest_published_quote_id`. With the draft locked, an `OPEN` edit changes intent
and remains `OPEN`. A `QUOTED` edit changes the intent, invalidates the quote
currently named by the retained marker, and changes `QUOTED -> OPEN` as one
atomic unit; failure rolls all three effects back. Terminal intent edits are
rejected. The row-local guard never performs cross-table DML itself.

A deferred constraint-trigger backstop records an event **only** when
`OLD.status = QUOTED` and any enumerated confirmed input is null-safely changed;
the event captures the non-null `OLD.latest_published_quote_id`. At commit,
without taking a reverse `FOR UPDATE` lock, it requires **in every case** that
the captured old-marker quote is non-approvable **and** that the final draft is
exactly one of: (a) `OPEN` with the same retained marker; or (b) `QUOTED` with a
different marker installed by a later lawful publication in this transaction.
An ordinary `OPEN -> OPEN` edit creates no such deferred event. Thus a new quote
can never excuse failure to invalidate the pre-edit quote, and a privileged
writer cannot leave changed intent in a false same-marker `QUOTED` state. A later
publication remains free to reprice the edited `OPEN` draft through the normal
Quote Authority path.

## Target entity: `delivery_order`

The single authoritative record for one approved delivery.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `draft_id` | `NOT NULL` FK to `delivery_draft(id)`; the intent it was approved from. Part of the composite FK `(draft_id, merchant_id) -> delivery_draft (id, merchant_id)` (invariant 4). |
| `merchant_id` | `NOT NULL` FK to `merchants(id)`; **equal to `delivery_draft.merchant_id`**, enforced by the composite FK / trigger above — never two independent single-column FKs. |
| `approved_by_user_id` | `NOT NULL` FK to `users(id)`; the actor the write-txn gate resolved, bound to the exact approval membership tuple below. |
| `approved_membership_id` | `NOT NULL`; composite FK `(approved_membership_id, merchant_id, approved_by_user_id) -> merchant_memberships (id, merchant_id, user_id)` (or equivalent guard), identifying the actual historical membership row that authorized approval. |
| `approval_channel` | **`NOT NULL`, immutable**, closed set `SESSION | WHATSAPP | SMS` — a DB **enum**, or a `CHECK` on the value set **together with** `NOT NULL`. It is the mandatory discriminator for how the actor was gated, written from the trusted actor-proof path the creation transaction actually verified at insert time — **never** inferred from whether the `approved_external_contact_identity_id` / `approved_merchant_contact_binding_id` pair is null, and **never** defaulted to `SESSION`. A pair-only `CHECK` evaluates to unknown (and passes) when the channel itself is `NULL`, so this column's own `NOT NULL` + closed set is what guarantees the discriminator exists; **Existing-order integrity** rejects a null / unknown value before it looks at the identity/binding pair. |
| `approved_external_contact_identity_id` / `approved_merchant_contact_binding_id` | **Both `NULL` for `approval_channel = SESSION`; both `NOT NULL` for `WHATSAPP` / `SMS`** — the exact `external_contact_identities` and `merchant_contact_bindings` rows that passed the channel gate. Composite guards: binding `(approved_merchant_contact_binding_id, merchant_id, approved_external_contact_identity_id) -> merchant_contact_bindings (id, merchant_id, external_contact_identity_id)`; identity constrained so `external_contact_identities.linked_user_id == approved_by_user_id` and `external_contact_identities.channel` matches `approval_channel`. A merchant/user pair or an opaque provenance string alone does not name the identity/binding that authorized a channel approval. |
| `approval_provenance` | Bounded server-owned provenance (procedure + adapter ref). |
| `quote_id` | `NOT NULL`; composite FK `(quote_id, draft_id) -> quote (id, draft_id)` (or equivalent guard) to the approved quote row owned by Quote Authority. `quote` here names the future boundary entity, not an existing passenger table. |
| `quote_amount` / `quote_currency` | **NOT NULL** canonical monetary snapshot, valid under **Quote boundary contract / Canonical monetary boundary**, and exactly equal to the referenced quote's immutable published values. Equality does not excuse an invalid amount or currency. DB shape constraints and **Existing-order integrity** enforce both validity and equality. |
| `quote_state` | **`NOT NULL`** point-in-time snapshot of the quote's approvable state **as of approval**, written from the state the creation transaction actually verified at step 5c under the draft/quote serialization — never a request-supplied value. A **DB `CHECK`** restricts it to the closed set of **approvable** snapshot values (the exact vocabulary is fixed in the shared definition before the schema activates and only ever extended in a history-preserving way). It is a historical record: **Existing-order integrity** rejects a null / unknown / non-approvable stored value as `DELIVERY_ORDER_STATE_INCONSISTENT`, but it is **never** re-compared against the quote's mutable live state. |
| `quote_computed_at` / `quote_expires_at` | **`NOT NULL`, finite** snapshot of the approved quote's **server-owned canonical validity window**, equal to the referenced quote's immutable values and valid under **Canonical quote validity-window boundary**. Equality is additional to validity: malformed/future-dated/overlong published windows are corruption even when both copies agree. `quote_expires_at` is never re-evaluated against the current clock on recovery; historical integrity validates only the retained window shape/policy that applied when the quote was published plus copy equality. |
| `pickup_location_id` | **`NOT NULL`** FK to `merchant_locations(id)` resolved at approval (ACTIVE at that time); its `merchant_id` **equals this order's `merchant_id`** (invariant 4), enforced by the composite FK `(pickup_location_id, merchant_id) -> merchant_locations (id, merchant_id)` / trigger, not a plain cross-table `CHECK`. A `NULL` here would make PostgreSQL skip that composite FK entirely, so it is disallowed. |
| `pickup_snapshot` | **`NOT NULL`** canonical content of the resolved pickup at approval — its own `location id` (`== pickup_location_id`), label, address text, **non-null resolved coordinates**, bounded pickup instructions, default flag, **and the full `resolved_pickup_point`: coordinates, provider/place id, provenance, and the source-address binding it was resolved from** — not just the id, and never absent. Shape-constrained: the embedded point's coordinates present and in range, its provider/place id and provenance present, its source binding present. A null-coordinate or null / invalid `resolved_pickup_point` pickup never reaches this snapshot (invariant 4). |
| `delivery_input_fingerprint` | Canonical fingerprint over the confirmed delivery inputs the approved quote priced — the full recipient snapshot (name, contact, `destination_text`, the full resolved `destination_point` **including provider/place id, provenance and `source_text_binding`**, access note, window), the cargo lines `{ category, quantity, unit }`, and the frozen `pickup_snapshot` (id + content + the full `resolved_pickup_point`). It equals the referenced quote's stored fingerprint **and** a fresh recompute over the order's own immutable snapshots (Existing-order integrity); a divergent backfilled snapshot — including a changed destination provider/place id, provenance or source-text binding, or pickup provider/place id/provenance/source binding under otherwise unchanged text — fails that equality. |
| `cargo` | Immutable snapshot of the approved cargo **lines** `{ category_code, quantity, unit }` (every category `DELIVERABLE` at approval). |
| `cargo_policy_version` | **`NOT NULL`, immutable.** The policy version that actually cleared this cargo category set. Not audit-only: a trusted `INSERT` validator re-derives the category set from `cargo` and confirms this version, under the *same immutable policy definition* the server resolver uses, actually clears it. |
| `cargo_policy_decision` | **`NOT NULL`, immutable.** The recorded deliverability result (per-category class + overall `DELIVERABLE`) for `cargo` under `cargo_policy_version`. The `INSERT` validator confirms it matches a fresh evaluation; **Existing-order integrity** re-checks it against the immutable `cargo` and that version's retained definition. A backfilled `DELIVERABLE` does not bypass either check. |
| `status` | `PENDING_DISPATCH | CANCELED | <downstream states>`. **A new `delivery_order` `INSERT` is permitted only with `status = PENDING_DISPATCH`** (`NOT NULL`; a trusted `BEFORE INSERT` DB guard — a column `DEFAULT` is not sufficient, since an explicit value overrides it). It is **not** a permanent `CHECK (status = 'PENDING_DISPATCH')`: lawful downstream `UPDATE`s advance it forward; a **recovery** of an existing order returns that row in **any** state (`PENDING_DISPATCH` / `CANCELED` / `DELIVERED` / …) unchanged, zero writes; and a **merchant-cancellation** request against an order that is not `PENDING_DISPATCH` is **refused with `DELIVERY_ORDER_NOT_CANCELABLE`**, also zero writes — neither is an `INSERT`, so the insert guard never applies to them. The insert guard adds no cross-table lock. |
| `canceled_at` / `cancel_reason` | Both **NULL when `status != CANCELED`**; both **NOT NULL when `status = CANCELED`**. `canceled_at` is a finite server timestamp `>= created_at`; `cancel_reason` is a nonblank bounded canonical reason code allowed for the recorded cancellation source. Both are set atomically by the authorized cancellation operation and immutable once set. See **Cancellation facts integrity**. |
| `canceled_by_user_id` / `canceled_membership_id` | Both non-null exactly for this slice's `MERCHANT` cancellation; otherwise both null. They are the server-derived actor and exact membership row for that action, not copied from the original approver. When present, composite FK `(canceled_membership_id, merchant_id, canceled_by_user_id) -> merchant_memberships (id, merchant_id, user_id)` (or equivalent guard). |
| `canceled_external_contact_identity_id` / `canceled_merchant_contact_binding_id` | Null unless a `MERCHANT` cancellation was gated through a channel (`cancellation_channel in { WHATSAPP, SMS }`), in which case **both `NOT NULL`** — the exact identity/binding rows that passed the cancelling actor's channel gate, composite-guarded the same way as the approval pair (binding ↔ `merchant_id` + identity; identity `linked_user_id == canceled_by_user_id`, `channel == cancellation_channel`). Both null for a `SESSION` cancellation and for every non-`MERCHANT` source. |
| `cancellation_authority` | **`NULL` until cancellation; `NOT NULL` on every transition to `CANCELED`.** Write-once, immutable, closed enum `MERCHANT | DISPATCH_EXECUTION` (DB `CHECK` / enum). It names **which trusted operation** performed the cancellation, and the row's other cancellation fields must match it: `MERCHANT` ⇒ this slice's `PENDING_DISPATCH` merchant-cancel path, with the full verified merchant provenance tuple (`canceled_by_user_id` / `canceled_membership_id` / `cancellation_channel` / `cancellation_provenance`, and the `canceled_*` channel pair per its channel); `DISPATCH_EXECUTION` ⇒ a verifiable downstream-compensation reference tied to this specific `delivery_order` and an authorized compensation operation, with **every merchant-provenance field, including `cancellation_provenance`, null**. The source is set by the trusted operation, never by a request field; an ordinary writer cannot pick `DISPATCH_EXECUTION` to bypass authorization, and until a separate downstream contract and its backstop exist that path stays closed. |
| `cancellation_channel` / `cancellation_provenance` | If `status != CANCELED`, both are **`NULL`**. For `cancellation_authority = MERCHANT`, both are **`NOT NULL` and immutable**: `cancellation_channel` is the closed set `SESSION | WHATSAPP | SMS` (DB enum, or `CHECK` **plus the source-dependent non-null constraint**) and `cancellation_provenance` is the bounded server-owned merchant procedure/adapter reference. For `cancellation_authority = DISPATCH_EXECUTION`, both are **`NULL`**, together with the whole merchant tuple; that source instead carries its separate verifiable compensation reference. The channel is written only from the locked proof path actually used, never accepted from the request, inferred from pair nullness, or defaulted to `SESSION`. A total conditional constraint uses explicit `IS NULL` / `IS NOT NULL` branches and an outer `IS TRUE` / equivalent total form so SQL `UNKNOWN` cannot admit a null/unknown merchant channel or provenance. |
| `created_at` | **`NOT NULL`, immutable.** Set by the trusted creation boundary from **one fresh server `clock_timestamp()`** taken after all its locks/checks (step 5f), never a caller-supplied or backdated value — a column `DEFAULT`, or trusting a passed timestamp, is insufficient. By construction `created_at < delivery_draft.expires_at` **and** `created_at < referenced quote.expires_at` at that instant (step 5f re-checks both after the `check-to-INSERT` gap). This is the **server-defined creation moment**, not `COMMIT` time. **Existing-order integrity** checks only the *historical* relation `created_at < each immutable deadline`, never `created_at` against the current clock. |
| `updated_at` | Server timestamp; advances only with lawful lifecycle `UPDATE`s. |

Recipient and destination are **not** columns on `delivery_order` — they are a
1:1 immutable child row, `delivery_order_recipient_snapshot` (below).

The quote, approval-membership, pickup and channel-authority composite links have
unconditional referenced unique keys: future `quote (id, draft_id)`; additive
`merchant_memberships (id, merchant_id, user_id)`; the invariant-4 pickup key
`merchant_locations (id, merchant_id)`; and, for channel approvals/cancellations,
additive `merchant_contact_bindings (id, merchant_id, external_contact_identity_id)`
plus an `external_contact_identities` guard that ties the stored identity to the
approving/cancelling `user_id` and to `approval_channel` / `cancellation_channel`.
`draft_id`, `merchant_id`, `approved_by_user_id`, `approved_membership_id`,
`approval_channel`, `quote_id`, `pickup_location_id` and `pickup_snapshot` are all
`NOT NULL`; the channel identity/binding pair is `NOT NULL` exactly when
`approval_channel in { WHATSAPP, SMS }` and `NULL` for `SESSION` — the pair's
null-ness is *derived from* the mandatory `approval_channel`, not a substitute for
it. The cancellation constraints independently require a `MERCHANT` source to
carry a non-null closed `cancellation_channel` plus non-null
`cancellation_provenance`, with its
identity/binding pair non-null exactly for `WHATSAPP` / `SMS` and null for
`SESSION`; `DISPATCH_EXECUTION` and non-`CANCELED` rows carry no merchant actor,
membership, channel, provenance or identity/binding pair.
Independent FKs, a merchant/user pair
or an opaque provenance string alone do not bind the named membership, pickup or
identity/binding rows. The current 01B partial ACTIVE indexes are not a
replacement for these historical tuples. Quote `draft_id`, membership
merchant/user ownership, pickup `merchant_id` and binding merchant/identity
ownership are immutable, and referenced parents use `RESTRICT`. These are future
schema dependencies; this docs slice does not modify `0009`.

**Cancellation source tuple (future total DB backstop).** `status` is `NOT NULL`.
Let `compensation_ref` below denote the already-modeled, separate downstream
compensation reference whose concrete column/relation is owned by the future
Dispatch/Execution contract; this is a logical alias, not a new field in 01A.
The source-shape constraint is one exhaustive three-branch predicate, wrapped in
`IS TRUE` (or an equivalent `CASE ... ELSE FALSE`) so PostgreSQL cannot accept
`UNKNOWN`:

- `status IS DISTINCT FROM 'CANCELED'` ⇒ `cancellation_authority`, every merchant
  tuple field, `cancellation_channel`, `cancellation_provenance`, both
  `canceled_*` channel references and `compensation_ref` are explicitly
  `IS NULL`;
- `status = 'CANCELED' AND cancellation_authority = 'MERCHANT'` ⇒ actor and
  membership are `IS NOT NULL`, channel is `IS NOT NULL` and in the closed set,
  `cancellation_provenance IS NOT NULL`, `compensation_ref IS NULL`, and a nested
  total branch requires the channel pair `IS NULL` for `SESSION` or both members
  `IS NOT NULL` for `WHATSAPP` / `SMS`;
- `status = 'CANCELED' AND cancellation_authority = 'DISPATCH_EXECUTION'` ⇒ actor,
  membership, channel, `cancellation_provenance` and both channel-pair members
  are explicitly `IS NULL`, while `compensation_ref IS NOT NULL` and its
  separate FK/trigger backstop proves the reference belongs to this order and an
  authorized compensation operation.

Every other combination is `FALSE`. The independent cancellation-facts checks
below still require the canceled timestamp/reason pair by status and validate
their chronology/shape. Until the downstream reference relation and trusted
transition backstop exist, the `DISPATCH_EXECUTION` branch remains closed.

**Snapshot ↔ quote equality (future DB backstop).** Beyond ownership, the schema
slice should enforce that the order's copied `quote_amount` / `quote_currency` /
`quote_computed_at` / `quote_expires_at` and its `delivery_input_fingerprint`
equal the referenced quote's immutable published values, using a **validation
trigger on `delivery_order`** that reads the referenced `(quote_id, draft_id)`
parent and compares those fields. The fingerprint equality also has to hold
against a fresh recompute over the order's own snapshots, which depends on the
`delivery_order_recipient_snapshot` child, so that portion is a **deferred,
at-commit** check (like the exactly-one-well-formed child constraint) and must
permit the lawful `INSERT order -> INSERT recipient snapshot` sequence in one
transaction. Quote Authority keeps the published quote identity/owner, payload,
fingerprint and publication timestamps **immutable for the life of a `quote_id`**;
a reprice is a **new** retained `quote_id`, never an edit of the referenced one.
A quote-owned hard-delete guard preserves every successfully published row even
when no current-marker or order FK references it, while the already-defined
trusted eligibility/state transitions remain permitted. So this equality and
same-draft identity are well-defined at any later time. Until the DB backstop
lands, **Existing-order integrity** performs the same equality read-side before
recovery / cancellation.

### Cancellation facts integrity

The order guard and explicit status-dependent DB constraints enforce the
`canceled_at` / `cancel_reason` row contract above on every insert/update,
including secondary writers. A SQL NULL/unknown comparison must not pass as a
valid canceled pair. Reason codes and their finite length bound are fixed by
the cancellation-owning contract before its path activates; unsupported, blank,
free-text or oversized values are not silently coerced or defaulted. Historical
code meanings and accepted shape remain available for recovery.

The merchant-cancellation request preflight validates the reason before any
domain I/O; a caller-supplied timestamp is an extra field and fails there as
`DELIVERY_CANCEL_INPUT_INVALID`. On a permitted cancellation the trusted
operation consumes that already-validated canonical reason unchanged, takes one
fresh finite server `t_cancel := clock_timestamp()` after its blocking locks,
and requires `t_cancel >= order.created_at` before writing the entire
cancellation tuple. A server clock that
cannot satisfy the chronology yields `DELIVERY_ORDER_DEPENDENCY_FAILED`, zero
writes, rather than a fabricated future timestamp. Rejected or repeated requests
never restamp the existing pair. The same fact shape is mandatory for a future
Dispatch/Execution cancellation without authorizing that still-closed path.

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
  `cancel_reason`, `cancellation_authority`, the cancellation provenance fields —
  actor, membership, channel, the channel identity/binding pair, procedure —
  downstream timestamps) may advance, and only forward. **Every** transition to
  `CANCELED` must set a non-null `cancellation_authority` **atomically** with
  `status` / `canceled_at` / `cancel_reason` and the provenance that source
  requires — for `MERCHANT`, the whole verified merchant tuple
  (`canceled_by_user_id`, `canceled_membership_id`, the mandatory closed
  `cancellation_channel`,
  `cancellation_provenance`, and — for a channel cancellation —
  `canceled_external_contact_identity_id` / `canceled_merchant_contact_binding_id`,
  both null for `SESSION`); for `DISPATCH_EXECUTION`, the verifiable
  downstream-compensation reference and **null** merchant tuple, explicitly
  including `cancellation_provenance`. They are all null whenever `status !=
  CANCELED`; a `CANCELED` row with `cancellation_authority` null, a `MERCHANT`
  row with a null/unknown channel, null provenance or partial/absent merchant
  tuple, a `DISPATCH_EXECUTION` row with non-null merchant provenance / tuple or
  an unverifiable compensation reference, a non-`CANCELED` row with any
  cancellation provenance, and
  any later change / erasure / re-stamp are rejected by the order guard.
  Rejected/repeated cancellation requests write nothing. Downstream compensation
  owns its own actor semantics, sets `cancellation_authority = DISPATCH_EXECUTION`,
  and must not fabricate a merchant-cancellation tuple for a driver/system
  action;
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
| `delivery_order_id` | PK **and** FK to `delivery_order(id)` enforce at most one child; the deferred existence invariant below additionally requires one child for every order at commit. |
| `recipient_name` | Bounded string, frozen from the draft at approval. |
| `recipient_contact` | **`NOT NULL`**, bounded normalized recipient phone (auth phone canonicalizer), **DB-level shape/format-constrained** (canonical normalized form; not blank/placeholder); the recipient is not a `users` row. |
| `destination_text` | **`NOT NULL`**, bounded human destination as stated, frozen from the draft; **DB-level length/shape-constrained** (not blank). |
| `destination_point` | **`NOT NULL`** canonical **resolved** destination — coordinates plus stable provider/place id, provenance **and `source_text_binding`** — frozen from the draft's `destination_point`. DB shape constraints require coordinates in range, provider/place id and provenance present, the binding present/canonical, **and the binding to match this same snapshot row's frozen canonical `destination_text`**. It is part of the `delivery_input_fingerprint`, so downstream routing uses this authoritative point and never re-geocodes into a different one. Historical validation compares the frozen binding to the frozen text only, never to today's draft or a fresh geocode. |
| `destination_access_note` | Nullable bounded entrance/floor/door note. |
| `requested_window` | Nullable bounded requested delivery window. |
| `created_at` | Server timestamp (= order creation time). |

This is a per-order PII capsule, never a reusable recipient directory: it has no
identity of its own beyond the order FK, is never updated, and is the single
place a narrow driver-facing projection reads recipient data from (that
projection never reads merchant identity/contact tables). A recipient address
book remains an explicit non-goal (01A invariant 3).

**Exactly one well-formed child at commit is a DB invariant.** A deferred
constraint/guard checks that each order has one recipient snapshot when its
transaction commits. It must allow the lawful `INSERT order -> INSERT snapshot`
sequence in one transaction; an immediate parent-insert check would reject that
sequence. Child PK/FK plus UPDATE/DELETE immutability alone cannot reject a
parent created without a child. Beyond existence, `recipient_contact`,
`destination_text` and `destination_point` carry **DB-level `NOT NULL` and
shape/format constraints** — a partial backfill cannot satisfy the invariant with
a null or malformed child. An order-only secondary write must fail at commit; an
existing corrupt order whose child is **missing or malformed** fails the
read-side **Existing-order integrity** check below (`DELIVERY_ORDER_STATE_INCONSISTENT`,
zero writes), never recovery.

Immutability is enforced by this table's **own** `BEFORE UPDATE OR DELETE` guard
trigger, not by the parent `delivery_order` trigger (which does not fire on
direct child DML). Every `UPDATE` and every `DELETE` against
`delivery_order_recipient_snapshot` is rejected; the only lawful writes are the
single `INSERT` inside the creation transaction (invariant 6). `destination_point`
here is part of the `delivery_input_fingerprint`, so a silently mutated snapshot
would also break fingerprint verifiability — the guard closes that path.

## Existing-order integrity

This is the single structural check used by **ORDER PRESENT** recovery and by
merchant cancellation, after authorization of the **current caller**. It is
never applied to ORDER ABSENT. For the existing order, require all of:

- its `draft_id` identifies the locked draft, `merchant_id == M`, and that draft
  is `APPROVED`; the draft's retained `latest_published_quote_id` is non-null and
  equals this order's `quote_id`. This is historical approved-pair identity, not
  a current quote-eligibility or expiry check;
- exactly one `delivery_order_recipient_snapshot` exists for its `id`, **and that
  child is well-formed** — `recipient_contact`, `destination_text` and
  `destination_point` are non-null and shape-valid; the resolved destination's
  provider/place id, provenance and `source_text_binding` are present and the
  binding matches **that same frozen snapshot's canonical `destination_text`**.
  This is historical frozen-data validation only — no current draft read and no
  re-geocode. A null/malformed/source-mismatched historical child is corruption,
  not a deliverable order;
- `pickup_location_id` and `pickup_snapshot` are **both non-null**; the composite
  `(pickup_location_id, merchant_id)` resolves to a `merchant_locations` row whose
  `merchant_id` is immutably `== order.merchant_id`; `pickup_snapshot` is
  well-formed — its own `location id == pickup_location_id`, its stored
  coordinates present and in range, **its frozen `resolved_pickup_point`
  present and shape-valid (coordinates in range, provider/place id, provenance
  and source-address binding all present)**, its content shape valid. This is a
  check of the **frozen snapshot only** — the `resolved_pickup_point` is not
  compared with the location's current value, not re-geocoded, and takes no
  recovery lock;
- its stored quote exists and has immutable `quote.draft_id == order.draft_id`;
- the referenced immutable quote's `computed_at` / **`published_at`** /
  `expires_at` satisfy the **historical Canonical quote validity-window
  boundary**: all are server-owned, non-null and finite,
  `computed_at <= published_at < expires_at`, and the stored duration is within
  the retained bounded rule/version that governed that published quote. The
  durable `published_at` is the historical evidence that a future-dated candidate
  did not pass publication. The order's copied `quote_computed_at` /
  `quote_expires_at` satisfy the same retained shape and equal the quote exactly;
  `published_at` remains quote-owned and immutable rather than a caller/order
  field. This check **never compares any historical timestamp with the current
  clock or today's quote-duration policy**; valid old history remains valid after
  expiry or a later policy revision;
- its `created_at` is non-null and, **as a historical relation**, precedes both
  immutable deadlines: `created_at < order.quote_expires_at` (which equals the
  referenced quote's `expires_at`) **and** `created_at <
  source_draft.expires_at`. A `created_at` that is null, backdated behind neither
  deadline, or `>=` either deadline → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero
  writes. This compares the stored creation moment to the stored/immutable
  deadlines only — **never** `created_at` (or the deadlines) against the current
  clock, so a correctly-created order recovers however long after both deadlines
  have passed;
- its stored `quote_state` is non-null and one of the closed set of **approvable**
  snapshot values (the DB `CHECK` above); a null, unknown, or non-approvable
  stored value is corruption → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes.
  This validates the **stored historical value only**; it is never compared to
  the quote's current live state;
- its `cargo_policy_version` and `cargo_policy_decision` are non-null, and the
  decision matches a re-evaluation of the **immutable `cargo`** category set
  under **that stored version's own retained definition** — every category
  `DELIVERABLE`, overall `DELIVERABLE`. A missing version/decision, a decision
  that its stored version does not actually produce for this `cargo`, or a
  category set that version marks non-deliverable → `DELIVERY_ORDER_STATE_INCONSISTENT`,
  zero writes. This uses the order's **stored historical** version, **not** the
  current active constant (a later policy change never faults a
  correctly-approved historical order);
- **the order's immutable snapshots match the approved quote.** A fresh canonical
  fingerprint recomputed over the order's own frozen snapshots — recipient
  snapshot (`recipient_name`, `recipient_contact`, `destination_text`, the full
  resolved `destination_point` including its provider/place provenance and
  `source_text_binding`, `destination_access_note`, `requested_window`), the cargo
  lines `{ category_code, quantity, unit }`, and the `pickup_snapshot` (id plus
  its frozen content **plus the full `resolved_pickup_point` — coordinates,
  provider/place id, provenance, source binding**) — equals
  `order.delivery_input_fingerprint`, which in turn
  equals the **referenced quote's** stored `delivery_input_fingerprint`:
  `F(immutable order snapshots) == order.delivery_input_fingerprint ==
  quote.delivery_input_fingerprint`. The recompute uses the **same canonical
  algorithm the referenced fingerprint was produced with** (a later evolution of
  that algorithm must not turn a correctly-approved historical order into
  corruption). The order's copied `quote_amount`, `quote_currency`,
  `quote_computed_at` and `quote_expires_at` equal the referenced quote's
  immutable values. Any mismatch, or an inability to canonicalize a corrupted
  historical snapshot, → `DELIVERY_ORDER_STATE_INCONSISTENT` (alert, zero writes),
  before quote-match recovery or a cancellation transition. This is a check
  against the order's **own frozen data and the immutable quote**, not against
  the current draft, current store content, current cargo policy, current time,
  or the quote's mutable live state;
- its stored approval membership exists and has immutable
  `(id, merchant_id, user_id) == (approved_membership_id, order.merchant_id,
  approved_by_user_id)`;
- **approval channel present** — `approval_channel` is non-null and one of the
  closed set `SESSION | WHATSAPP | SMS`. A **null or unknown** value →
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert, zero writes), **before** the
  identity/binding-tuple check below — a legacy or trigger-bypassed order whose
  channel is null must not be recovered without establishing whether session or
  channel proof authorized it. This runs after the current caller's authorization
  and before recovery / cancellation; a since-`REVOKED` identity or binding whose
  channel and immutable tuple still match is valid history and is **not** faulted
  here;
- **approval channel authority tuple** — if `approval_channel in { WHATSAPP, SMS }`, then
  `approved_external_contact_identity_id` and `approved_merchant_contact_binding_id`
  are non-null, the binding's immutable `(id, merchant_id,
  external_contact_identity_id)` matches `(approved_merchant_contact_binding_id,
  order.merchant_id, approved_external_contact_identity_id)`, and the identity's
  immutable `linked_user_id == approved_by_user_id` with `channel ==
  approval_channel`; if `approval_channel = SESSION`, **both are null**;
- **cancellation source** — if `status == CANCELED`, `cancellation_authority` is
  non-null and its references are consistent: `MERCHANT` ⇒ the full merchant
  provenance tuple present and tuple-valid, including a **non-null closed
  `cancellation_channel in { SESSION, WHATSAPP, SMS }`** written from the trusted
  proof path (membership `(id, merchant_id, user_id)`, bounded non-null
  `cancellation_provenance`);
  `DISPATCH_EXECUTION` ⇒ a present, verifiable compensation
  reference tied to this `order.id`, and the merchant tuple entirely `NULL`
  (`canceled_by_user_id` / `canceled_membership_id` / `cancellation_channel` /
  `cancellation_provenance` / the `canceled_*` channel pair). A `CANCELED` order with a **null
  `cancellation_authority`**, or a source whose references do not match (a
  `MERCHANT` cancel missing its tuple/provenance, a `DISPATCH_EXECUTION` with
  non-null merchant provenance/tuple or an unverifiable reference), is corruption →
  `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. A null `cancellation_channel`
  **no longer** implies "legitimate compensation" — the discriminator is checked
  explicitly. If `status != CANCELED`, `cancellation_authority`,
  `cancellation_channel`, `cancellation_provenance`, and every merchant /
  compensation reference are `NULL`;
- **cancellation channel authority tuple** — this check runs only after the source
  and channel discriminator above have passed. For a `MERCHANT` cancellation with
  `cancellation_channel in { WHATSAPP, SMS }`, both
  `canceled_external_contact_identity_id` and
  `canceled_merchant_contact_binding_id` are non-null; the binding's immutable
  owner tuple matches `(order.merchant_id,
  canceled_external_contact_identity_id)`, and the identity has
  `linked_user_id == canceled_by_user_id` and `channel == cancellation_channel`.
  For `SESSION`, both are null. For `DISPATCH_EXECUTION`, a non-`CANCELED` row, or
  any row without a merchant cancellation, both are null. A null / unknown
  merchant channel is rejected by the preceding source check rather than falling
  through these branches; any pair mismatch is
  `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes;
- **cancellation time and reason**: a `CANCELED` row has both facts present,
  a finite valid `canceled_at >= created_at`, and a nonblank bounded canonical
  reason code appropriate to its recorded source. A non-`CANCELED` row has both
  fields NULL. Missing, malformed, pre-creation or source-invalid facts are
  `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes, even when the source
  discriminator and provenance tuple are otherwise valid. This is a historical
  row check, not a comparison to today's clock, grants or cancellation policy;
- **canonical monetary shape**: the referenced quote and copied order money
  independently satisfy **Canonical monetary boundary**, in addition to their
  exact equality. Null/negative/non-finite/out-of-bound amounts, invalid
  precision or unsupported/malformed currencies never recover as valid merely
  because the copies agree. Historical shape definitions are retained; current
  commercial eligibility is not rechecked. Failure is
  `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes;
- none of these required references is null.

Failure is `DELIVERY_ORDER_STATE_INCONSISTENT` (alert, zero writes) **before**
quote-match recovery or a cancellation state transition. The composite FKs,
deferred well-formed-snapshot constraint and immutable ownership guards enforce
these relationships against ordinary secondary writes; this read-side check
also detects pre-existing corruption without normalizing it into success.

These are **historical identity/structure checks** — the order's own frozen data
against the immutable quote/membership/identity/binding/pickup rows — **not**
present-day eligibility checks. The original approval membership may now be
`REVOKED`, the identity or binding may now be `REVOKED`, the pickup location may
now be non-`ACTIVE` / no longer the default / have a different current address or
coordinates, and the quote may now be expired/superseded/non-approvable. Do
**not** re-check their current status, do **not** re-resolve or re-lock the
pickup location, do **not** compare the frozen `pickup_snapshot` (including its
resolved point + provenance) against the location's present content or its
current `resolved_pickup_point`, do **not** re-check cargo policy against the
**current** constant (the order's *stored* `cargo_policy_version` /
`cargo_policy_decision` **is** re-validated, per the bullet above — that is
historical, not current), do **not** re-evaluate `quote_expires_at` against the current
clock, do **not** evaluate the **source draft's `expires_at`** against the
current clock, do **not** compare the order's `created_at` against the current
clock (an `APPROVED` draft never expires, and a valid historical order recovers
regardless of how long ago it or its draft was created — only the *historical*
relation `created_at < each immutable deadline` is checked), do **not**
re-evaluate the original approver's / channel's **current** eligibility (a since-
`REVOKED` membership, identity or binding whose immutable tuple still matches is
valid history — the insertion-time eligibility check is the creation boundary's
job, not recovery's), do **not** compare
the stored `quote_state` against the quote's live state, and do **not** re-derive
the fingerprint from the *current draft* inputs. The mandatory
fingerprint / quote-payload equality above is the opposite direction — it
canonicalizes the order's **own immutable snapshots** and compares them to the
order's stored fingerprint and the immutable quote, and it always runs. Do not
take new late `FOR UPDATE` locks on the historical membership, identity, binding,
pickup or quote: their owner tuples are immutable and deletion is restricted.
Current-caller authority is separately locked/revalidated by the shared authority
prefix, and always passes it independently of any historical revocation. A valid
canceled order still recovers with zero writes; an absent order still follows the
absent branch.

## Order-creation authority

An approval request names an exact `(draft_id, quote_id)` pair. **Step 0 is a
request-shape preflight before any domain transaction, row read or lock**, for
recovery as well as creation. Its ordered outcomes are:

- **0a.** The payload must be a record, not null, an array or a scalar; otherwise
  `DELIVERY_APPROVAL_INPUT_INVALID`.
- **0b.** If `quote_id` is absent, null or a blank string, return `QUOTE_REQUIRED`.
  This wins over other pair-field errors once 0a passed.
- **0c.** Otherwise both IDs must be strings in the UUID `8-4-4-4-12` hex form;
  a missing/malformed `draft_id`, a present non-string/malformed `quote_id`, or
  extra payload fields return `DELIVERY_APPROVAL_INPUT_INVALID`. Do not coerce
  objects, numbers or booleans, derive a quote ID or substitute the latest quote.
  Hex letter case may be normalized without changing identity; no UUID version
  restriction is introduced. Actor context is trusted transport/session context,
  not an additional payload field.

These are zero-write shape results, independent of whether a draft or quote
exists. They grant no authority and make no domain existence lookup. A valid
pair then enters **one server transaction**, in the unchanged order below
(lock order and tenant binding: **invariant 6 / Transaction locking**).
On ORDER ABSENT, a well-shaped `quote_id` naming a nonexistent/foreign quote
is not a `QUOTE_REQUIRED` case. It reaches step 4d only after the locked actor
gate, step 3a integrity, draft expiry and steps 4a/4b/4c all permit it; every
earlier failure keeps its own result. ORDER PRESENT
retains step 3: integrity first, then exact-pair recovery or quote conflict.

1. **Lock the draft.** `SELECT ... FOR UPDATE` the `delivery_draft` named by
   `draft_id`; set `M := delivery_draft.merchant_id`. **No row → the external
   result is `DELIVERY_DRAFT_NOT_FOUND`, zero writes**, before any authority lock.
2. **Tenant-bound access check (always — recovery and creation).** For a channel
   actor, first do the **non-authoritative discovery** read (canonical identity →
   candidate `U`); a session actor already holds an authoritative `U`. Then take
   the authority-row locks in the fixed order — the actor's `(M, U)`
   `merchant_memberships` row, then `merchants(M)`, then (channel) the identity
   and binding rows — and re-resolve the actor gate for **`M` = the locked
   draft's `merchant_id`** to a single `AUTHORIZED_MERCHANT_ACTOR(U, M)` (Approver
   parity, below), re-verifying every discovered fact under its lock. `M` comes
   from the locked draft, never the request or the actor's independently-resolved
   merchant. **Any failure of this locked gate for `M`** — no ACTIVE `(M, U)`
   membership at all, an allowed-role miss, `merchants(M)` not `ACTIVE`, a
   channel actor whose locked `linked_user_id` no longer equals the discovery
   `U`, a revoked/mismatched identity or binding, or the actor gate resolving
   only some other merchant — yields **the same client-facing code,
   `DELIVERY_DRAFT_NOT_FOUND`, zero writes**, identical to a nonexistent
   `draft_id`. The true reason (`MERCHANT_ACTOR_UNAUTHORIZED` /
   `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_INOPERABLE` / a `CONTACT_*` code) is
   **internal only** (logged), so no caller — for `M` or any other merchant — can
   distinguish "this merchant's draft exists" from "no such draft". The frozen
   Identity/Contact resolver is unchanged; only the response mapping at this call
   site is. A result computed before the transaction is not accepted. Pickup,
   expiry, fingerprint, and cargo policy are **not** checked here — only on
   creation (step 5).
3. **Recovery / integrity branch — read the single `delivery_order` for this
   `draft_id`** (`UNIQUE (draft_id)` ⇒ zero or one row), under the locks, then
   split strictly on **whether that order exists**. The existing-order field
   checks live **only** in the ORDER PRESENT branch; they are never applied when
   no order was read.
   a. **ORDER ABSENT** (no `delivery_order` for `draft_id`): if the locked
      `delivery_draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`
      (`APPROVED` is terminal for the draft and must carry exactly one order;
      integrity fault; alert; **zero writes**); **otherwise → step 4** (the
      ordered failure priority; a `QUOTED` draft whose presented `quote_id`
      equals its non-null `latest_published_quote_id` proceeds to creation).
   b. **ORDER PRESENT** (exactly one `delivery_order` for `draft_id`), evaluated
      in this exact order — integrity **before** the `quote_id` comparison so
      corruption never returns as a normal client response: (i) any
      **Existing-order integrity** check fails (draft/merchant/status; well-formed
      recipient snapshot; non-null merchant-owned pickup ID + `pickup_snapshot`;
      quote ownership; historical approval-membership tuple; historical channel
      identity/binding tuple) →
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
   entered in. **Before (a):** if the source draft is already `EXPIRED`, **or**
   its deadline has otherwise passed — `clock_timestamp() >=
   delivery_draft.expires_at`, read on the authoritative wall clock after the
   blocking locks are held, whether or not the deadline sweep has run — →
   `DELIVERY_DRAFT_EXPIRED`, zero writes; a fresh draft is required. This
   precedes (a) and the superseded / stale checks.
   a. **Terminal draft** (`ABANDONED`) → `DELIVERY_DRAFT_NOT_APPROVABLE`.
   b. **Superseded quote** — the presented `quote_id` resolves to a retained,
      successfully published quote of this draft, proved by the trusted-writer
      publication fact `quote.published_at IS NOT NULL`; the draft's retained
      `latest_published_quote_id` is non-null; and the two ids are **not equal**
      (whether the draft is `OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`. The marker is
      the publication winner recorded under the draft lock; no timestamp / UUID /
      price ordering is consulted. The same-draft ownership-and-publication read
      includes retained, non-current published quotes and does not filter those
      rows on current/approvable eligibility, so an older q1 cannot disappear into
      step 4d after q2 is published. Mere same-draft addressability is insufficient:
      a candidate whose publication never committed does not satisfy (b) or (c)
      and falls through to (d). Checked
      **before** staleness: a quote that is both stale and superseded returns
      `QUOTE_SUPERSEDED`.
   c. **Stale quote** — the draft is `OPEN`; the presented `quote_id` is a quote
      of this draft **and equals the retained `latest_published_quote_id`**; it was
      **invalidated by a confirmed-input or resolved-pickup change after it was
      priced**; and (b) did not fire → `QUOTE_STALE`. A fresh quote must be
      computed against the current inputs.
   d. **Any other non-creatable state** — a plain `OPEN` draft with no own
      approvable quote; the presented `quote_id` does not exist / is not a quote of
      this draft; it names an addressable same-draft candidate whose publication
      never committed; or the draft is not `QUOTED` with a non-null marker equal
      to the presented `quote_id` → `DELIVERY_DRAFT_NOT_APPROVABLE`.
   e. Otherwise the draft is `QUOTED`, its non-null
      `latest_published_quote_id == presented quote_id`, and it has no order →
      proceed to the **creation branch** (step 5).
5. **Creation branch — only from a `QUOTED` draft whose retained
   `latest_published_quote_id` equals the presented quote** (step 4e) and no order:
   a. **(creation branch only)** resolve and **lock** the pickup
      `merchant_locations` row (`lockMerchantLocationById`; the merchant-default
      boundary is already held via the `merchants(M)` lock taken in step 2) — the
      draft's explicit `requested_pickup_location_id`, or the ACTIVE default. The
      row must be `ACTIVE`, `merchant_id == M`, carry **non-null coordinates**,
      **and carry a non-null, valid `resolved_pickup_point`** — its coordinates,
      provider/place id, provenance and source-address binding present and
      shape-valid, and **consistent with the row's current address/coordinates**.
      `MERCHANT_LOCATION_REQUIRED` on ambiguity, none, a non-ACTIVE row, or a
      cross-merchant row; `DELIVERY_PICKUP_UNRESOLVED` on a null-coordinate row,
      **or a missing / invalid / source-inconsistent `resolved_pickup_point`**
      (no approval-time geocode, no provenance invented from coordinates). The
      pickup row is never locked on the recovery path;
   b. **re-check the mandatory delivery inputs under the draft lock** —
      `recipient_contact` and `destination_text` present
      (`DELIVERY_RECIPIENT_INCOMPLETE`), `destination_point` present,
      shape-valid and **source-consistent with the current canonical
      `destination_text` via its `source_text_binding`**
      (`DELIVERY_DESTINATION_UNRESOLVED`), then non-empty canonical cargo lines
      via **invariant 5 → Validate cargo shape before policy**
      (`DELIVERY_CARGO_LINE_INVALID`). These are Quote Authority preconditions
      (a quote must not attach without them); re-checking here means a
      malformed/partial draft that reached `QUOTED` cannot become an authoritative
      but undeliverable order;
   c. re-confirm the source draft's deadline and the named quote against step 4
      and, in order, require: `clock_timestamp() < delivery_draft.expires_at`
      (re-read after all blocking locks, so a draft that aged out while the
      transaction waited on a lock is caught → `DELIVERY_DRAFT_EXPIRED`); current
      quote ownership and `presented quote_id == latest_published_quote_id`
      (`QUOTE_SUPERSEDED` retains step-4 priority);
      an explicitly **approvable quote state**; then an unexpired quote validity
      window. A `QUOTED` draft whose marker quote is `INVALIDATED` or otherwise
      non-approvable (including an unknown state) is
      `DELIVERY_ORDER_STATE_INCONSISTENT`, even with a matching fingerprint;
      `clock_timestamp() >= quote.expires_at` is `QUOTE_EXPIRED`, with the clock
      read after all blocking locks. Ordinary invalidation that reverted the
      draft to `OPEN` remains `QUOTE_STALE` at step 4c. The **verified**
      approvable quote state resolved here is the value written to
      `delivery_order.quote_state` at step 5f — never a request-supplied one.
      After those checks, validate the stored quote's **Canonical monetary
      boundary** **and Canonical quote validity-window boundary** before step 5d:
      `computed_at` / immutable `published_at` / `expires_at` are server-owned,
      non-null and finite; `computed_at <= published_at < expires_at`; the
      retained bounded duration rule holds; and `computed_at <=` the fresh
      post-lock wall clock used here. Malformed persisted money or validity shape
      is `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes, not a request to copy
      or repair the bad value. A structurally valid window whose `expires_at` is
      now crossed remains `QUOTE_EXPIRED`. Every rejection is zero-write;
   d. recompute the canonical `delivery_input_fingerprint` over the **current**
      draft inputs (recipient, contact, `destination_text`, the full
      `destination_point` **including provider/place id, provenance and
      `source_text_binding`**, access note, window, cargo lines
      `{category, quantity, unit}`) and the freshly-resolved,
      **locked** `pickup_snapshot` (incl. its resolved coordinates **and the full
      `resolved_pickup_point` — provider/place id, provenance, source binding**);
      `QUOTE_STALE` if it does not equal the quote's stored fingerprint — this
      also catches a pickup-content or `resolved_pickup_point` edit that reached
      approval before the draft revert propagated (non-retryable — a fresh quote
      is required). The authoritative input list is **Quote boundary contract →
      Every quote binds to the exact delivery inputs it priced**; this step uses
      that same canonical definition;
   e. `resolveCargoDeliveryPolicy` over the whole cargo category set against the
      **replica-active** constant (Policy-version activation); `CARGO_CATEGORY_UNKNOWN`
      / `CARGO_NOT_DELIVERABLE` fail closed; the resolved `{ version, decision }`
      is what will be persisted as `cargo_policy_version` / `cargo_policy_decision`
      (invariant 5), where the trusted `INSERT` validator re-derives and confirms it;
   f. **final time gate, then insert.** Take **one fresh `t := clock_timestamp()`**
      (the authoritative server clock, after every lock and check above) and
      require, in order: `t < delivery_draft.expires_at` (else
      `DELIVERY_DRAFT_EXPIRED`, rollback, no order) then
      `t < referenced_quote.expires_at` (else `QUOTE_EXPIRED`, rollback, no
      order) — both are re-checked here because either deadline can lapse in the
      gap between step 5c and this point; the earlier step-5c checks and the
      step-4 priority are unchanged. The still-locked draft must also retain
      `latest_published_quote_id == presented quote_id`; that marker is not
      cleared on approval. Then `INSERT` exactly one `delivery_order` —
      `status = PENDING_DISPATCH` (the row-local `BEFORE INSERT` guard admits no
      other), `created_at := t` (`NOT NULL`, immutable, not backdatable), with
      the step-5c **verified** `quote_state`, the step-5e `cargo_policy_version` /
      `cargo_policy_decision`, and the actor/membership/channel provenance
      written from the *currently re-verified* gate result (invariant 6 → *The
      creation transaction*) — and its `delivery_order_recipient_snapshot`, and
      flip the draft `QUOTED -> APPROVED`, all in this transaction (invariant 6),
      so the final `APPROVED` marker equals the inserted order's `quote_id`.
      The order `INSERT`'s implicit `FOR KEY SHARE` FK locks on `delivery_draft` /
      `merchants(M)` / `merchant_memberships` / `merchant_locations` are already
      subsumed by the `FOR UPDATE` locks this transaction holds on those same
      rows. The deferred draft/order coupling constraint-trigger pair (invariant
      6 → *The creation transaction*) evaluates the **final committed rows**, so
      this `INSERT order -> INSERT snapshot -> flip draft` ordering commits
      cleanly; the `delivery_draft` transition guard passes `QUOTED -> APPROVED`.

The acting user, membership, grantor, verifier, and provenance are all
server-resolved. An approval request body never chooses the approver, the
merchant, pickup selection, quote amount, fingerprint, or cargo deliverability.
An explicit pickup is persisted on the draft before quoting; changing it is a
draft edit followed by a new quote, never an approval-time override.

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
(invariant 6), against **`M` taken from the locked `delivery_draft`**. **Every
way this locked gate can fail** — the actor has no ACTIVE `(M, U)` membership at
all, the gate resolves only some other merchant (e.g. the caller's sole operable
merchant), an allowed-role miss, `merchants(M)` not `ACTIVE`, a channel actor
whose **locked** `linked_user_id` differs from the discovery candidate `U`, or a
revoked/mismatched identity or binding — produces **the same client-facing code,
`DELIVERY_DRAFT_NOT_FOUND`** (identical to a nonexistent `draft_id`), before
recovery or creation; the true internal reason
(`MERCHANT_ACTOR_UNAUTHORIZED` / `MERCHANT_MEMBERSHIP_REQUIRED` /
`MERCHANT_INOPERABLE` / `CONTACT_*`) is logged only. The discovery value never
stands in for the locked identity. Delivery approval permits `membership_role in { ADMIN, OPERATOR
}`. A downstream operation contract may require `ADMIN` for a stronger action, but
may not widen this set and may not accept contact binding or resolved context
alone.

A **channel** approval (or channel cancellation) persists onto the order the
**exact** `external_contact_identities` and `merchant_contact_bindings` rows that
passed its gate — `approved_external_contact_identity_id` /
`approved_merchant_contact_binding_id` (and the `canceled_*` pair for a channel
cancellation) — so the immutable order records which channel identity actually
exercised the right, and **Existing-order integrity** can structurally verify it.
A user may hold several verified identities or bindings for one merchant; storing
only user + membership + an opaque provenance string would lose which one it was.
A `SESSION` approval/cancellation leaves both fields null. This is auditable
history: a later `REVOKED` identity or binding whose immutable tuple still matches
does not break a correct recovery — the current caller re-passes the gate
regardless.

## Idempotency and recovery

- **`delivery_order` carries an unconditional `UNIQUE (draft_id)`** — a hard
  database invariant, not just a service-path convention: a draft has **at most
  one `delivery_order`, ever**, and it holds against secondary writers, backfills,
  and integrity faults. `UNIQUE (draft_id, quote_id)` alone would let two rows
  for one draft with different `quote_id`s coexist, contradicting this. The
  `UNIQUE (draft_id)` persists after the order is `CANCELED` (it is never
  hard-deleted). A separate index on `(draft_id, quote_id)` serves the exact-pair
  recovery lookup.
- **`delivery_draft.status == APPROVED` iff exactly one `delivery_order` exists —
  a deferred (at-commit) constraint-trigger pair, one per table.** `UNIQUE
  (draft_id)` bounds the count at one; it does not tie that count to the draft's
  status. Without the coupling, a secondary writer could insert a
  `PENDING_DISPATCH` order for a `QUOTED` draft, or set a draft `APPROVED` with
  no order, and `Existing-order integrity` — which runs only on recovery /
  cancellation — would never see it. The pair checks **final committed rows**
  (never an intermediate `NEW.status`): at commit, an `APPROVED` draft has
  exactly one order for its `draft_id` in **any** state (including `CANCELED`);
  any other draft status has zero. The lawful `INSERT order -> INSERT recipient
  snapshot -> flip draft APPROVED` sequence passes; the `delivery_order`-side
  trigger reads its draft row **without `FOR UPDATE`**, adding no late
  `delivery_draft` lock to a dispatch / cancellation `UPDATE` and preserving
  draft-first serialization (invariant 6 → *The creation transaction*; race row 49).
  The same final-state schema slice requires every `APPROVED` draft's retained
  `latest_published_quote_id` to equal its single order's `quote_id`; no current
  quote-state or wall-clock check is implied by that historical identity equality.
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
    whose presented quote equals `latest_published_quote_id` proceeds to creation). No existing-order
    field is inspected in this case;
  - **order present:** every **Existing-order integrity** check runs **before**
    the `quote_id` match — including the recompute of `F(immutable order
    snapshots)` and its equality to `order.delivery_input_fingerprint` and the
    referenced `quote.delivery_input_fingerprint`, plus the copied
    amount/currency/computed_at/expires_at equalling the referenced quote's
    immutable values. Any failure → `DELIVERY_ORDER_STATE_INCONSISTENT` even on an
    exact `(draft_id, quote_id)` match (backfill / trigger-bypass / corruption;
    alert; zero writes); else `order.quote_id` equal to the presented `quote_id` →
    **recovery**: the existing `delivery_order` is returned with **zero writes**,
    in **any** lifecycle state **including `CANCELED` / terminal** — no re-check of
    pickup, quote **current** expiry / supersession / staleness / eligibility,
    cargo policy against the current constant, or `quote_state` against the live
    state (`DELIVERY_ORDER_ALREADY_EXISTS`); the snapshot ↔ immutable-quote
    equality is not "current" re-validation and always runs. Else (`order.quote_id`
    differs) → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. Zero writes.
- **New creation is reached only from a `QUOTED` draft with its current,
  non-superseded quote and no order.** On the **ORDER ABSENT** path, after
  step 3a has rejected `APPROVED` without an order as an integrity fault,
  `## Order-creation authority` step 4 applies a **fixed priority**. Rejections
  are zero-write and entry-state-preserving: **first**, a draft already
  `EXPIRED`, or whose deadline has otherwise passed — post-lock authoritative
  `clock_timestamp() >= delivery_draft.expires_at`, whether or not the sweep
  has run — → `DELIVERY_DRAFT_EXPIRED`. This precedes **all** following cases:
  otherwise `ABANDONED` → `DELIVERY_DRAFT_NOT_APPROVABLE`; presented retained,
  successfully published own quote **superseded** (`OPEN` or `QUOTED`) →
  `QUOTE_SUPERSEDED`; `OPEN` with the presented published own quote equal to the
  retained marker but **invalidated** → `QUOTE_STALE`; a same-draft unpublished
  candidate or any other non-creatable state → `DELIVERY_DRAFT_NOT_APPROVABLE`.
  Only the remaining `QUOTED` draft whose marker equals the presented quote proceeds to
  the creation branch and its further checks. Existing-order recovery remains
  on the separate ORDER PRESENT path above.
- After a `delivery_order` is `CANCELED`, the draft stays `APPROVED`; a further
  delivery is a **new draft + new quote + new order**, never a re-approval of the
  old draft.
- **Draft ingestion idempotency is a DB constraint, not a service-path habit.**
  `delivery_draft` carries an **immediate (non-deferred) `UNIQUE (merchant_id,
  origin_channel, origin_namespace, adapter_dedupe_token)`**, with `merchant_id`
  and **`origin_channel` `NOT NULL`** (closed enum) and a
  `CHECK (adapter_dedupe_token IS NULL OR origin_namespace IS NOT NULL)`, plus
  nonblank/bounds checks on both optional text components
  (`origin_namespace IS NULL OR btrim(origin_namespace) <> ''`;
  `adapter_dedupe_token IS NULL OR btrim(adapter_dedupe_token) <> ''`) — so a
  present token cannot slip past the `UNIQUE` through a `NULL`/blank namespace,
  a blank token cannot become a shared dedupe identity, and channel remains
  non-null. The trusted intake boundary stores only the shared canonical forms;
  blank/whitespace input is rejected rather than silently trimmed into a key.
  `origin_namespace` (provider account / adapter namespace, from trusted adapter
  context) being mandatory when a token is present means the same message
  id arriving through two different provider accounts of one merchant produces
  **two** drafts, never a silently merged or dropped delivery. A **`NULL`
  `adapter_dedupe_token`** (no token — manual drafts) is allowed and repeats
  freely: several tokenless drafts for one merchant coexist (`NULL` compares
  distinct in the `UNIQUE`). On a **concurrent redelivery of one full key** the
  `UNIQUE` admits exactly **one** draft; the loser, after the constraint
  violation, reads the existing draft and proceeds from it — it never overwrites
  the recorded intent, extends a deadline, or resurrects an `ABANDONED` /
  `EXPIRED` draft. Different merchant / channel / namespace stay independent.
  This is an intake dedupe key **only**, never a second, competing key for
  authoritative order creation, which keys on the draft as above.
- **The intake identity is durable — it cannot be freed by `UPDATE` or
  `DELETE`.** The `UNIQUE` only rejects a *duplicate*; on its own it lets a
  cleanup job or secondary writer make the recorded key disappear so a later
  redelivery re-inserts a fresh `OPEN` draft (new deadline, terminal status
  forgotten). Two immediate row-local guards close that: (i) the full tuple
  `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` is
  **immutable after the `INSERT`** — the `BEFORE UPDATE` guard rejects any
  component change under a null-safe `IS DISTINCT FROM` comparison, **including
  setting a non-null `adapter_dedupe_token` back to `NULL`**; (ii) a
  `BEFORE DELETE` guard rejects a hard-delete of any **token-backed** draft
  (`adapter_dedupe_token IS NOT NULL`) in **any** status. So a redelivery of the
  original key keeps colliding with, and resolving to, the original draft in its
  recorded status and with its original deadline — an abandoned or expired
  request is never turned back into an order. Legitimate flows are untouched:
  tokenless (`NULL` token) manual drafts are still created by separate repeat
  `INSERT`s, and the allowed intent edits still apply. Concrete retention
  duration and any PII redaction / erasure implementation are **out of scope for
  this slice**; a future erasure mechanism must preserve this guarantee — retain
  the intake tuple (redact PII in place), never hard-delete a token-backed row.

## Cancellation

Merchant cancellation through Delivery Order Authority is **itself an authority
action** and runs as one transaction with the **same shared lock order** as
approval — never a separate `order -> authority` chain (which would invert the
prefix and could deadlock with approval / repricing / the dispatch claim). The
order row is the **last** lock, exactly as pickup is last in the creation branch.

0. **Request-shape preflight — before any domain transaction, read, repository
   lookup or lock.** The payload must be a non-null record containing **exactly**
   `{ order_id, cancel_reason }`; trusted session/channel actor context is
   separate transport context, never a payload field. `order_id` must be a string
   in UUID `8-4-4-4-12` hex form (hex case may be normalized; no UUID-version
   restriction and no coercion). `cancel_reason` must be a present string in the
   bounded canonical merchant-reason vocabulary frozen before this path activates
   — not null, blank, free text, oversized, or unsupported. A null/array/scalar
   payload; a missing, non-string or malformed id/reason; or **any extra field**
   (including caller timestamp, merchant/actor/membership, channel, provenance,
   cancellation source, or proof flag) → `DELIVERY_CANCEL_INPUT_INVALID`, with
   **zero domain reads/lookups/locks/writes**. A valid-shaped unknown UUID is not
   a shape error and continues to step 1.
1. **Non-authoritative hint read.** Read `order.draft_id` and `order.merchant_id`
   as *candidates* (authorizes nothing); a channel actor also runs the discovery
   read for a *candidate* `U`. These only choose which rows to lock. **If no
   `delivery_order` exists for the supplied `order_id`** → `DELIVERY_ORDER_NOT_FOUND`,
   **zero writes**, with no attempt to build the shared authority prefix from
   absent `draft_id` / `merchant_id`. To avoid cross-tenant existence
   disclosure, the **external** response is **identical** for a non-existent
   order and for an order whose merchant the caller has no authority over
   (normally `MERCHANT_ACTOR_UNAUTHORIZED` at step 3, race row 26): both surface
   the same opaque `DELIVERY_ORDER_NOT_FOUND` to the client, while the server
   records the true internal reason (absent vs unauthorized) distinctly. This
   result **does not replace** the post-authorization **Existing-order
   integrity** check — that still runs for every order that exists and whose
   caller passes the gate.
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
   **Existing-order integrity**, including the locked source draft being
   `APPROVED`, order/draft merchant ownership, well-formed recipient snapshot,
   non-null pickup ID + snapshot with immutable merchant ownership, quote
   ownership, the historical approval membership tuple, the historical
   channel identity/binding tuple, and the snapshot ↔ approved-quote equality
   (`F(immutable order snapshots) == order.delivery_input_fingerprint ==
   quote.delivery_input_fingerprint`; copied amount/currency/computed_at/expires_at
   equal the referenced quote). Failure →
   `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes, before the status
   gate. A corrupt `PENDING_DISPATCH` order is never normalized to `CANCELED`.
5. **Status gate.** `order.status == PENDING_DISPATCH` → perform the terminal
   `PENDING_DISPATCH -> CANCELED` transition, never a hard delete. Apply
   **Cancellation facts integrity** before the write: consume the step-0-validated
   canonical reason unchanged and stamp the finite post-lock `t_cancel >=
   created_at`; the request cannot supply a timestamp. In the **same
   write/transaction**,
       set **`cancellation_authority = MERCHANT`** together with
       `canceled_by_user_id`, `canceled_membership_id`, a **non-null
       `cancellation_channel in { SESSION, WHATSAPP, SMS }`**,
       non-null bounded `cancellation_provenance`, and — for a channel cancellation —
   `canceled_external_contact_identity_id` /
   `canceled_merchant_contact_binding_id` (both null for `SESSION`), all from the
   step-3 locked actor/identity/procedure, never from the request, pair nullness,
   a default, or the original approver. The status, source, timestamp/reason and
   the whole provenance tuple
   are written **atomically** and are write-once under the order guard; no later
   retry re-stamps or overwrites any of them. A tuple FK/check uses the
   already-locked cancelling membership and identity/binding, adding no reverse
   authority-lock edge. Any other status → `DELIVERY_ORDER_NOT_CANCELABLE`, zero
   writes.

- The instant `BD-MERCHANT-DELIVERY-DISPATCH-01A` atomically moves the order out
  of `PENDING_DISPATCH` (into `SEARCHING_DRIVER`), direct merchant-cancel through
  Order Authority is **forbidden** (`DELIVERY_ORDER_NOT_CANCELABLE`). Any later
  cancellation or abort runs through the Dispatch/Execution **compensation
  flow**, which owns driver/recipient-initiated cancellation, refund/settlement
  effects, and in-flight-cargo handling. That flow sets
  `cancellation_authority = DISPATCH_EXECUTION` with a verifiable
  compensation reference, **`cancellation_provenance IS NULL`**, and no merchant
  actor/membership/channel/identity-binding tuple. Until that separate
  downstream contract and its own `INSERT`/transition backstop exist, this slice
  admits **only** `cancellation_authority = MERCHANT` from step 5; a
  `DISPATCH_EXECUTION` transition is not a path an ordinary writer can take, and
  the discriminator alone (an enum value) never substitutes for the trusted
  operation that is authorized to set it.
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
- Abandonment is a separate pre-order operation governed by **Draft
  abandonment** below. The same actor kinds may request it, but only that locked
  gate may enter `ABANDONED`; it never cancels an existing order.

## Draft abandonment

`OPEN|QUOTED -> ABANDONED` is irreversible and requires a trusted transactional
operation for the exact draft. It is not licensed by a legal state-transition
edge, a contact binding, an adapter message or a previously successful resolver.
An abandonment request supplies only a UUID `draft_id`; malformed or extra
payload fields are `DELIVERY_DRAFT_INPUT_INVALID`, before domain reads/writes.
The procedure takes trusted session/channel actor context separately.

1. **Lock and derive tenant.** `FOR UPDATE` the named draft, set
   `M := locked delivery_draft.merchant_id`. No row gives the external
   `DELIVERY_DRAFT_NOT_FOUND`, zero writes, before any authority lock.
2. **Revalidate current authority.** For a channel, discover candidate `U`
   non-authoritatively, then lock membership `(M,U)`, `merchants(M)`, identity,
   ACTIVE binding in the invariant-6 order; a session uses its server-resolved
   `U` and skips the channel rows. Recheck **Approver parity**, including ACTIVE
   merchant/membership, role `ADMIN` or `OPERATOR`, and the channel's current
   verified/linked identity and binding. Hold all locks through commit/rollback.
   Every gate failure is externally `DELIVERY_DRAFT_NOT_FOUND`, identical to
   an absent draft; the true `MERCHANT_*` / `CONTACT_*` reason is internal only.
   Authorization runs before state disclosure, including idempotent replay.
   No pickup row or historical order authority row is locked by this operation.
3. **Check coupling, then state, in order.** Read the order count for this draft
   under the draft serialization lock. `APPROVED` with other than exactly one
   order, or any other draft status with an order, is
   `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes; never repair it.
   A consistent `APPROVED` draft returns `DELIVERY_DRAFT_NOT_ABANDONABLE`, zero
   writes, even if its order is canceled. An order-free `ABANDONED` draft returns
   its existing abandoned result idempotently, zero writes, regardless of how
   long ago its deadline passed. An order-free `EXPIRED` draft returns
   `DELIVERY_DRAFT_EXPIRED`, zero writes. Any unrecognized status is an integrity
   fault. Only an order-free `OPEN` or `QUOTED` draft reaches the next step.
4. **Deadline and atomic mutation.** After all blocking locks and checks,
   immediately before mutation read one fresh finite `t_a := clock_timestamp()`.
   If `t_a >= expires_at`, return `DELIVERY_DRAFT_EXPIRED`, zero writes; leave
   expiry to its own worker rather than disguising it as abandonment. Otherwise
   atomically move this draft to `ABANDONED` and invalidate the quote named by
   `latest_published_quote_id` under the same draft lock, **retaining the marker**.
   Quote payload/fingerprint, original deadline and intake identity stay
   unchanged. No order, dispatch, notification or financial action is created. A
   failure rolls back both changes.

**Trusted write boundary.** Ordinary application, adapter and backfill roles
have no direct `UPDATE` privilege on draft `status` or other authority-controlled
columns, including via a broader table-level grant. Only the appropriate trusted
lifecycle procedures may perform those writes. They accept trusted actor context,
not caller-written IDs/proof flags or a settable session marker that purports to
be authorization. The row-local graph guard remains additional defense and
acquires no reverse cross-table authority locks. The schema/privilege slice must
prove an ordinary direct writer cannot enter `ABANDONED` or replace/disable the
procedure/guards before enabling this operation. Existing intent-only intake
allowances do not become abandonment rights.

Approval, quote publication/invalidation, expiry and abandonment serialize on
the same first draft lock. Abandon-first prevents later approval/repricing;
approval-first leaves a valid `APPROVED` draft that cannot be abandoned. A revoke
that commits first is seen by the locked gate; if abandonment owns the relevant
authority locks first, revoke waits for its outcome. A deadline crossed during a
lock wait causes a zero-write expiry refusal. Retry never changes timestamps,
reactivates quote eligibility or resurrects a terminal draft.

## Quote boundary contract

Quote computation, reprice, surge, `expires_at` duration, and the fingerprint
algorithm are entirely `BD-MERCHANT-QUOTE-AUTHORITY-01A`. Delivery Order
Authority defines only the boundary it consumes:

### Canonical monetary boundary

A quote's `amount` and `currency`, and the order's copied `quote_amount` and
`quote_currency`, are mandatory values, not unchecked display text. Quote
Authority and the schema use **one shared immutable monetary-shape definition**:

- `currency` is a nonblank canonical code in the explicitly supported set; no
  case/whitespace coercion or fallback currency substitutes for validation.
- `amount` is a finite exact decimal value with the definition's currency-specific
  canonical scale, never a binary-floating approximation or a locale-formatted
  string. It is non-negative, no greater than that currency's finite maximum,
  and exactly representable at that scale. Null, booleans, containers, NaN,
  infinity, negative values, excess precision and out-of-range values fail.
  Validation happens **before** a cast or storage operation could round/truncate
  an input; no silent rounding, conversion or default amount is permitted.
- The actual code set, scales, maxima, canonical transport/storage encoding and
  treatment of a zero-price quote are frozen by the Quote/schema contract before
  publication/creation activates. Zero is admitted only when that definition
  explicitly permits it; absent policy fails closed. This 01A correction does
  not choose a tariff, currency, numeric bound or free-delivery policy.

The Quote schema and order schema both enforce non-null and monetary shape,
including against secondary writers; copy equality remains an **additional**
invariant. Publication validates an unpublished candidate after the locked input
comparison and before its final time gate: invalid money is
`QUOTE_MONETARY_INVALID`, non-retryable, zero writes. The unchanged-price candidate
must be corrected/recomputed, never silently repaired during publication.
Creation step 5c rejects malformed **persisted** quote money as
`DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes, before fingerprint comparison;
the trusted insert boundary and DB shape backstop validate the exact copied
values as well. Monetary data does not enter the delivery-input fingerprint and
is never computed from cargo by Order Authority.

Recovery validates the historical shape of both the immutable published quote
and its copy, plus their equality, never a present-day pricing/settlement rule.
Accepted historical code meanings, precision and bounds are retained and cannot
be tightened or removed in place. A future incompatible definition requires a
separate history-preserving contract/schema change with an unambiguous rule
binding for every published quote; it cannot invalidate valid old orders merely
because a currency or zero-price offer is no longer commercially available.
Missing shared rules or inconsistent application/DB validators block activation.

### Canonical quote validity-window boundary

Quote Authority owns the concrete quote-duration policy, but every consumer and
future schema writer uses one shared validity-window shape. A published quote's
`computed_at`, **`published_at`**, and `expires_at` are **server-owned, `NOT NULL`,
finite and immutable**. They are never request timestamps. `published_at` is the
durable publication instant stamped by the trusted Quote writer from the same
fresh post-lock `t_publish := clock_timestamp()` that authorizes publication; it
is not a candidate/request field. Before activation the Quote/schema contract
freezes a positive bounded duration rule
(`0 < expires_at - computed_at <= QUOTE_TTL_MAX`, or an equivalent
history-preserving versioned rule); no replica/environment/caller-selected
fallback duration is permitted.

Publication validates this independently of money and copy equality. Static
candidate shape requires finite non-null `computed_at` / `expires_at`,
`computed_at < expires_at` and a duration within the frozen bound. After all
publication locks are held it takes one fresh authoritative `t_publish`:
`computed_at > t_publish` is a malformed/future-dated candidate →
`QUOTE_VALIDITY_INVALID`, zero writes; a structurally valid candidate with
`t_publish >= expires_at` is merely expired → `QUOTE_EXPIRED`, zero writes.
Only after those checks pass does the trusted writer atomically persist
`published_at := t_publish` with the immutable quote payload/fingerprint and
draft quote state. Neither failure is repaired by trimming timestamps or
extending `expires_at`.

The future quote schema/backstop enforces non-null/finite timestamps, the
historically checkable relation
`computed_at <= published_at < expires_at`, and the retained bounded-duration
rule against secondary writers; ordinary writers cannot supply or rewrite
`published_at`. If that policy evolves, the published quote retains an
unambiguous validity-rule/version or equivalent history-preserving definition so
**Existing-order integrity** can validate old windows under the rule that created
them. Recovery validates the durable historical relation
`computed_at <= published_at < expires_at`, the retained duration shape and exact
order↔quote copies only; it never compares an old `expires_at` with today's clock
and never re-applies today's commercial duration policy. Equality of two
malformed timestamps is never sufficient.

### Quote lifecycle and consumption

- **Quote lifecycle writes serialize on the `delivery_draft` lock and record the
  winner durably.** Every Quote Authority write that **creates, supersedes, or
  invalidates** a quote for a draft MUST first `SELECT ... FOR UPDATE` that
  `delivery_draft` row and hold it **through commit**. The draft row is the
  per-draft serialization point; `delivery_draft.latest_published_quote_id` is
  the durable identity of the last successful publication. A successful publish
  atomically makes the previous marker quote non-current, persists the candidate,
  replaces the marker with the candidate's id, and leaves the draft `QUOTED`.
  No failure changes the marker. Invalidation changes eligibility / draft state
  but **retains** the marker. Publication order is never reconstructed from
  `computed_at`, `published_at`, UUID lexical order, amount, or database scan
  order. This makes race-matrix row 5 (`QUOTE_SUPERSEDED`) and the staleness
  checks deterministic even for equal or non-monotonic timestamps:
  - *reprice/supersede first* — it commits the new quote id into the marker under
    the draft lock; approval then acquires the same lock and rejects any other own
    successfully published own quote id as `QUOTE_SUPERSEDED`;
  - *approval first* — it holds the draft lock through commit and flips the draft
    to `APPROVED`; a reprice that arrives next sees a terminal (`APPROVED`) draft
    and **refuses** to publish/supersede — the order already snapshots the exact
    approved quote, and no supersession can slip in between step 5c re-confirm and
    commit.
- **Published quote history is append-only and addressable by identity.** Once a
  publication commits, the quote's `(id, draft_id)`, owner, payload, fingerprint
  and publication timestamps are immutable and its row cannot be hard-deleted.
  Superseded, expired, invalidated and approved quotes remain stored; only the
  already-defined trusted lifecycle eligibility/state transitions may advance.
  Publishing q2 moves the draft marker but leaves q1 as the actual same-draft
  row used by approval classification. The quote table owns a `BEFORE DELETE`
  guard (and denies ordinary direct mutation); `ON DELETE RESTRICT` from the
  current marker or an order is additional, not the retention mechanism. No
  ledger, tombstone, soft-delete flag or replacement identity is introduced.
- **Publication validates the priced pickup under locks.** The draft lock alone
  does not protect `merchant_locations` or default selection. Quote Authority
  may prepare an immutable candidate input snapshot and compute its price
  outside the publication transaction (including external geocoding/pricing).
  Before making that candidate the latest published quote it must:
  1. lock the draft, derive `M`, and reject a terminal draft **or one whose
     deadline has passed** (`clock_timestamp() >= delivery_draft.expires_at`,
     authoritative wall clock) → the quote is not published;
  2. lock `merchants(M)` (the default-selection boundary), then the selected
     pickup row; if the path also authorizes an actor, take the existing full
     authority prefix **before** these locks, never membership after merchant;
  3. re-read `destination_text` and its stored `destination_point` under the
     already-held draft lock and require a non-null, shape-valid resolved point
     whose provider/place id and provenance are present **and whose
     `source_text_binding` matches the current canonical `destination_text`**.
     The trusted destination-resolver persistence path must have stored that
     binding before pricing; publication never geocodes or fabricates one.
     Missing/invalid/source-mismatched destination → `DELIVERY_DESTINATION_UNRESOLVED`,
     nothing published. Then re-resolve explicit/default pickup, same-merchant
     eligibility, non-null coordinates **and a non-null, valid
     `resolved_pickup_point`** — its coordinates, provider/place id, provenance
     and source-address binding present and shape-valid, **and consistent with the
     location's current address/coordinates** (a trusted resolver-persist
     procedure fills it before this step, under these same locks, from an
     external resolver's result — never fabricated from bare coordinates; a
     missing, invalid or source-inconsistent point →
     `DELIVERY_PICKUP_UNRESOLVED`, nothing is published), and re-read every
     canonical delivery input under these locks;
  4. compare these exact inputs — the full destination point **including
     `source_text_binding`** and the full `resolved_pickup_point` included — with
     the immutable candidate used to compute the price. A mismatch publishes
     nothing and requires a fresh computation; never pair an old price with a
     new fingerprint. Then validate the candidate's **Canonical monetary
     boundary** and the static **Canonical quote validity-window boundary**
     (server-owned finite non-null timestamps, `computed_at < expires_at`,
     positive bounded duration). `QUOTE_MONETARY_INVALID` or
     `QUOTE_VALIDITY_INVALID` publishes nothing and changes no draft state. Do
     not round, repair or extend the candidate;
  5. take a single fresh `t_publish := clock_timestamp()` on the authoritative
     wall clock **after all the locks above are held** — not the transaction-start
     time — and apply, in order: **(a)** `t_publish >=
     delivery_draft.expires_at` → the draft aged out while publication waited on
     a lock → `DELIVERY_DRAFT_EXPIRED`, **zero writes**; **(b)**
     `candidate_quote.computed_at > t_publish` → future-dated malformed candidate
     → `QUOTE_VALIDITY_INVALID`, **zero writes**; **(c)** `t_publish >=
     candidate_quote.expires_at` → the otherwise-valid priced candidate expired
     during the wait → `QUOTE_EXPIRED`, **zero writes**. The candidate's
     timestamps are **never** extended to pass these guards; malformed windows
     are corrected/recomputed, expired quotes require a fresh computation.
     No failure publishes the quote/fingerprint, changes the draft quote state,
     or changes `latest_published_quote_id`;
  6. only when **(a)–(c)** all pass **and** the input comparison, canonical
     monetary validation and canonical validity-window validation held, atomically
     persist **`quote.published_at := t_publish`** and publish the
     quote/fingerprint (over the full canonical input set, destination
     `source_text_binding` and `resolved_pickup_point` included), transition any
     previous marker quote out of current/approvable status **without deleting,
     re-keying or reusing that published row**, set
     **`delivery_draft.latest_published_quote_id := quote.id`**, and set the draft
     quote state, holding draft, merchant and pickup locks through commit.
  No external pricing/geocoding call is required while holding those locks. A
  pickup change after publication commits can legitimately stale that quote;
  a change before publication must be caught by the protected comparison.
  Future callers combining pickup edits and quote invalidation must preserve
  `draft -> [authority prefix] -> merchant -> location`: prelock affected drafts
  deterministically, or propagate invalidation in a separate transaction.
  Never hold a location lock while later seeking a draft lock. Existing 01B
  leaf mutations/default switches remain unchanged.
- **The resolved destination point is source-bound before pricing.** A trusted
  destination-resolver persistence path obtains the external resolver result,
  then under the `delivery_draft` row lock re-reads the exact
  `destination_text` and stores `delivery_draft.destination_point` as
  coordinates + stable provider/place id + provenance + a versioned
  **`source_text_binding` to that canonical text**. The binding is destination
  specific (a canonical binding/digest of the recipient-supplied text), not a
  copy of pickup's merchant-address contract and not a second mutable free-text
  address. A quote can attach only when the point is present, shape-valid and the
  binding matches the current canonical `destination_text`; otherwise
  `DELIVERY_DESTINATION_UNRESOLVED`. A later change to `destination_text`, point
  coordinates, provider/place id, provenance or source binding clears/invalidates
  the stored resolved point and, if already `QUOTED`, invalidates the quote and
  drops the draft `QUOTED -> OPEN` while retaining
  `latest_published_quote_id`. Publication and creation re-check the binding
  under the draft lock; neither path geocodes. The full destination point
  including `source_text_binding` is copied to the immutable recipient snapshot
  and included in the canonical fingerprint, so approval never silently
  retargets a confirmed delivery. Recovery checks only the frozen snapshot's
  binding against its own frozen `destination_text`, never today's draft or a
  fresh resolver call.
- **The resolved pickup point is fixed before pricing.** The pickup
  `merchant_locations` row the quote priced against must carry non-null
  coordinates **and a stored `resolved_pickup_point`** — coordinates, a real
  provider/place id and provenance, and the source address/coordinates it was
  resolved from. `0009` stores neither, so this is a future
  **`merchant_locations.resolved_pickup_point`** column (or dedicated pre-quote
  snapshot entity), written by a **trusted resolver-persist procedure before
  pricing** under the `draft -> [authority prefix] -> merchant -> location`
  locks — never a `location -> draft` inversion, never invented from bare
  coordinates. An address/coordinate edit to the location clears or invalidates
  a stale `resolved_pickup_point` and forces re-resolution. A null coordinate, or
  a null / invalid / source-inconsistent `resolved_pickup_point`, cannot be
  priced or approved (`DELIVERY_PICKUP_UNRESOLVED`, invariant 4); creation
  (step 5a) and publication both check the stored point is present, shape-valid
  and consistent with the location's current address/coordinates under the
  existing locks. Pickup geocoding happens in intake / Quote Authority, never at
  approval; the **full** resolved point — coordinates, provider/place id,
  provenance, source binding — is a member of the canonical fingerprint input
  list and is copied into the immutable `pickup_snapshot`, so a provider/place or
  source-binding change with an unchanged address still changes the fingerprint.
  Recovery checks only that frozen copy — never the location's current
  `resolved_pickup_point`, no geocode, no recovery lock.
- **Mandatory recipient fields are a quote precondition.** A quote can only
  attach to a draft whose `recipient_contact` and `destination_text` are present
  (and `destination_point` resolved). The creation branch re-checks these under
  the draft lock (`DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`),
  so a partial draft that reached `QUOTED` — Quote Authority bug, partial intake —
  never becomes an authoritative-but-undeliverable order.
- **Canonical cargo shape is also a publication precondition:** the non-empty
  list and each line's category/quantity/unit must pass invariant 5's shared
  shape contract under the draft lock. Order creation re-checks it at step 5b,
  before fingerprinting and policy; empty cargo never passes vacuously.
- **Quote ownership, identity and published payload are immutable and retained
  for the life of a `quote_id`:** the quote stores its source `draft_id` and exposes an
  unconditional unique `(id, draft_id)` key for the order's composite FK
  `(quote_id, draft_id)`. Its published `amount` / `currency` / `computed_at` /
  **`published_at`** / `expires_at` and its `delivery_input_fingerprint`
  (produced by a **named canonical algorithm version**) do not change once
  published — a reprice is a **new** `quote_id`, never an edit of an existing
  one. A quote-owned guard rejects hard-delete of every successfully published
  row, whether it is current, superseded, expired, invalidated or approved;
  controlled eligibility/state transitions do not permit identity/payload
  mutation or deletion. `published_at` remains quote-owned historical evidence and is not a
  request/order-supplied field. So the order's copied quote fields and
  fingerprint can be compared to the referenced quote at any later time while
  Existing-order integrity also proves `computed_at <= published_at < expires_at`.
  Static ownership **and this payload/fingerprint equality + validity relation**
  are checked on recovery / cancellation; only *mutable* quote eligibility
  (approvable state, expiry-vs-now, supersession) is a creation-only check.
- **Every quote binds to the exact delivery inputs it priced.** Quote Authority
  stores, on the quote, a canonical `delivery_input_fingerprint` over: the
  recipient snapshot (name, contact, `destination_text`, **resolved
  `destination_point`**, access note, window), the canonically-ordered cargo
  **lines** `{ category_code, quantity, unit }`, and the resolved
  `pickup_snapshot` — the pickup `merchant_location` id **plus** its canonical
  content (label, address text, pickup instructions, default flag) **plus the
  full `resolved_pickup_point`: coordinates, provider/place id, provenance and
  the source-address binding it was resolved from**. This list is the single
  authoritative fingerprint input set (step 5d and Existing-order integrity use
  the same definition). A bare `pickup_location_id` is **not** sufficient (a
  merchant can edit a store's address under the same id); bare coordinates are
  **not** sufficient (a provider/place-id or source-binding change with an
  unchanged address and lat/lng must still change the fingerprint); a bare
  category set is **not** sufficient (2 kg and 200 kg of `LIVE_CRAYFISH` must not
  fingerprint alike).
- **Required at approval (creation branch):** a `quote_id` equal to the locked
  draft's non-null `latest_published_quote_id`, in an approvable state, with `clock_timestamp() <
  expires_at` (an authoritative wall-clock read taken **after** the blocking
  locks are held — a transaction-start `now()` stays fixed while the transaction
  waits on a lock and would accept an already-expired quote), whose
  `delivery_input_fingerprint` still equals a fresh fingerprint over the current
  draft inputs, resolved destination point, cargo lines, and resolved pickup.
  At creation step 5c, the marker quote being non-approvable while
  the draft is still `QUOTED` is `DELIVERY_ORDER_STATE_INCONSISTENT`, before the
  expiry/fingerprint checks. This includes `INVALIDATED` and unknown states.
  It does not change ordinary `OPEN` stale-quote handling or valid-order recovery.
- **Snapshotted onto the order** (immutable): `quote_id`, `quote_amount`,
  `quote_currency`, `quote_state`, `quote_computed_at`, `quote_expires_at`,
  `delivery_input_fingerprint`. All except `quote_state` must equal the
  referenced quote's immutable published values; `delivery_input_fingerprint`
  must additionally equal a fresh recompute over the order's own frozen snapshots
  (Existing-order integrity). `quote_state` is a point-in-time record only —
  **`NOT NULL`, DB-`CHECK`ed to the closed set of approvable snapshot values,
  and written from the state the creation transaction actually verified at step
  5c, never a request field**. It is validated for that historical shape by
  Existing-order integrity (null / unknown / non-approvable → integrity fault)
  but is never re-compared against the quote's live state.
- Approval-time quote rejections — all zero-write, non-retryable (the fix is a
  fresh quote, not a retry), and **none is re-evaluated on a recovery** (exact
  `(draft_id, quote_id)` match): `QUOTE_SUPERSEDED` (the presented retained,
  successfully published own quote id differs from the retained
  `latest_published_quote_id` — checked for `OPEN` and `QUOTED` alike, and
  **before** `QUOTE_STALE`), `QUOTE_STALE` (the presented
  quote equals that retained marker but was invalidated by a confirmed-input /
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
| 2 | Approval vs. merchant `SUSPENDED`/`CLOSED` | **Approval first:** the suspend waits on `merchants(M)` until approval commits/rolls back. **Suspend first:** approval's `lockMerchantById(M)` waits, then reads `SUSPENDED`; the locked-gate failure is **`MERCHANT_INOPERABLE` internal only (logged)**, mapped to the **single external `DELIVERY_DRAFT_NOT_FOUND`** (universal masking — rows 10, 58; `DELIVERY_DRAFT_NOT_FOUND` taxonomy). **Zero writes, before recovery or creation** — an existing order is neither read nor transitioned, and no order is created. Applies to recovery and creation; lock order unchanged. |
| 3 | Approval vs. membership `REVOKED` (incl. last-ADMIN revoke, whose guard trigger locks `merchants(M)` **after** the membership row) | **Approval first:** the revoke of the actor's own row waits on the step-2 membership lock; any other revoke waits on `merchants(M)`. **Revoke first:** approval's `lockActiveMerchantMembership` finds no ACTIVE row (or re-reads it `REVOKED`); the locked-gate failure is **`MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED` internal only (logged)**, mapped to the **single external `DELIVERY_DRAFT_NOT_FOUND`** (rows 10, 58). **Zero writes, before recovery or creation.** Applies to recovery and creation; lock order unchanged. |
| 4 | **Creation** vs. quote `expires_at` crossed while waiting on locks | Expiry is read with `clock_timestamp()` **after** the locks are held (not transaction-start `now()`); `clock_timestamp() >= expires_at` → `QUOTE_EXPIRED`; no order. |
| 5 | Approval presents a retained, successfully published own quote id different from the draft's retained `latest_published_quote_id` — draft `OPEN` **or** `QUOTED` | `QUOTE_SUPERSEDED` (step 4b); checked **before** `QUOTE_STALE`. The ownership-and-publication read proves immutable non-null `published_at`, includes retained non-current published rows, and excludes candidates whose publication never committed. Quote publication takes the draft lock and atomically moves the marker without deleting prior rows, so identity is deterministic and no supersession can land between step 5c and commit (rows 23, 84, 88). |
| 6 | **Creation** vs. pickup `merchant_location` edit / `ARCHIVED` / default switch | The pickup row is locked in step 5a; its merchant-default boundary is already covered by the step-2 `merchants(M)` lock. **Approval first:** the edit waits. **Edit first:** step 5a re-reads under lock — non-ACTIVE / gone → `MERCHANT_LOCATION_REQUIRED`; null coordinates or a missing / invalid / source-inconsistent `resolved_pickup_point` (including an address/coordinate edit that cleared or invalidated it) → `DELIVERY_PICKUP_UNRESOLVED`. Only if step 5a and the remaining earlier creation checks pass does changed pickup content reach step 5d's fingerprint mismatch → `QUOTE_STALE`. Any required trusted re-resolution must already have been persisted before approval; no approval-time geocode. No order against a stale pickup. |
| 7 | A confirmed draft input change (recipient/contact/`destination_point`/pickup intent/access note/window/full cargo) on a `QUOTED` draft, then approval of the retained-marker quote | The trusted mutation locks the draft and atomically changes intent + `QUOTED -> OPEN` + marker-quote eligibility; the marker is retained. Approval resolves at **step 4c** → `QUOTE_STALE`, zero writes, draft stays `OPEN`; no order until a fresh quote is published. Direct `QUOTED -> QUOTED` or terminal same-status intent rewrites fail the guard (row 87). |
| 8 | The resolved pickup location's canonical content edited (same `merchant_location_id`) so close to approval that the draft revert has not propagated | Draft still `QUOTED` → **creation branch**: step 5a rejects null coordinates or a missing / invalid / source-inconsistent stored `resolved_pickup_point` → `DELIVERY_PICKUP_UNRESOLVED`. If the stored point is already valid for the edited location and all earlier creation checks pass, step 5d recomputes the fingerprint over the fresh **locked** `pickup_snapshot`, sees the mismatch → `QUOTE_STALE`. A needed trusted re-resolution is persisted before approval, never performed during approval; no order in either rejection case. |
| 9 | **Creation** vs. cargo policy change (category becomes non-deliverable) between quote and approval | Re-check against current policy; `CARGO_NOT_DELIVERABLE`; no order. |
| 10 | Actor whose gate resolves merchant **A** presents a `(draft_id, quote_id)` whose locked `delivery_draft.merchant_id = B` | `M` is taken from the **locked draft** (`= B`); the gate for `B` fails (internally `MERCHANT_ACTOR_UNAUTHORIZED` / `MERCHANT_MEMBERSHIP_REQUIRED`), **before recovery**; the **external code is `DELIVERY_DRAFT_NOT_FOUND`** (same as a missing draft) so `B`'s draft existence is not disclosed; no read or write of `B`'s order (row 58; Example AC). |
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
| 21 | All FK links (draft, merchant, membership, quote, pickup location) | Target existing canonical rows; `RESTRICT` on delete of a referenced parent; quote ownership also uses `RESTRICT` from quote to draft, while a quote-owned hard-delete guard retains every published quote even after no marker/order FK points to it; the pickup FK is composite on `(pickup_location_id, merchant_id)`; the order↔draft FK is composite on `(draft_id, merchant_id)` (row 24). |
| 22 | A **composite** future mutation (`close merchant` + `revoke membership` in one tx; atomic ADMIN replacement `grant` + `revoke`) that locks `merchants(M)` before a `merchant_memberships` row | Out of 01B scope — no such composite primitive exists at `7ddb3971` (repositories are single-statement; the identity/contact service is read-only). A future composite caller **must** `FOR UPDATE` every affected existing `merchant_memberships` row in ascending-`id` order, then `lockMerchantById(M)`, before mutating — the same protocol the approval transaction follows (invariant 6 → *Whole-transaction lock protocol*). Stated here as a forward obligation, **not** a property guaranteed by 01B primitives. |
| 23 | Quote Authority **supersedes / invalidates** the named quote between step 5c re-confirm and the approval commit | Quote lifecycle writes take the `delivery_draft` lock. **Reprice first:** it atomically publishes the new retained quote, moves `latest_published_quote_id` and keeps the older row; approval re-reads the different marker → `QUOTE_SUPERSEDED`, no order. **Invalidation with no later publication first:** it retains the marker and published row, makes that quote ineligible and commits `QUOTED -> OPEN`; approval resolves at step 4c → `QUOTE_STALE`, no order. **Approval first:** it keeps the lock through `-> APPROVED` and order insert, preserving marker = order quote; later reprice/invalidation refuses. |
| 24 | A secondary writer / backfill inserts a `delivery_order` whose `draft_id` belongs to merchant B but `merchant_id` is A | The composite FK `(draft_id, merchant_id) -> delivery_draft (id, merchant_id)` (or guard trigger) rejects it (invariant 4). Two independent single-column FKs would both pass; recovery would then authorize against B from the locked draft while returning an A-provenance order. |
| 25 | Merchant **cancel** vs. membership/contact-binding `REVOKED` | The cancel transaction takes the shared authority prefix (`delivery_draft` → membership → `merchants(M)` → identity → binding) **before** the order row. **Cancel first:** the revoke blocks behind it. **Revoke first:** step 3's `AUTHORIZED_MERCHANT_ACTOR` re-resolve reads the committed negative state → `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`; no `CANCELED`. |
| 26 | Actor whose gate resolves merchant **A** presents merchant **B**'s pending `delivery_order` id to cancel | The hint read yields candidate `(draft_id, merchant_id = B)`; step 2 locks `d_B` and sets `M := B`; step 3 re-resolves the gate for `B` — `A`'s actor has no ACTIVE `B` membership → the authority decision is **unauthorized** (`MERCHANT_ACTOR_UNAUTHORIZED` internally; recorded as the reason). `B`'s order is never transitioned under `A`'s authority. The **client-facing** code is the non-committal `DELIVERY_ORDER_NOT_FOUND`, identical to a nonexistent `order_id` (Cancellation step 1; row 53), so `A` cannot probe `B`'s order existence. |
| 27 | Direct `UPDATE` / `DELETE` against `delivery_order_recipient_snapshot` (repository bug, backfill, integrity fault) | Rejected by the child table's **own** `BEFORE UPDATE OR DELETE` guard trigger — a parent `delivery_order` trigger does not fire on direct child DML. The approved recipient/destination and the fingerprint stay verifiable. |
| 28 | Approval where the resolved pickup `merchant_locations` row is `ACTIVE` and same-merchant but has `lat`/`lng` both null (`0009` permits this) | Step 5a rejects it → `DELIVERY_PICKUP_UNRESOLVED`; no approval-time geocode, no order. A routable pickup point must be resolved before pricing (invariant 4, Quote boundary contract). |
| 29 | A `QUOTED` draft reaches the creation branch missing `recipient_contact` or `destination_text` (Quote Authority precondition bug / partial intake) | Step 5b re-checks the mandatory recipient fields under the draft lock → `DELIVERY_RECIPIENT_INCOMPLETE` (or `DELIVERY_DESTINATION_UNRESOLVED`); zero writes, no undeliverable authoritative order. |
| 30 | Exact `(draft_id, quote_id)` order exists, but the locked source `delivery_draft.status` is `OPEN` / `QUOTED` / terminal (partial backfill, trigger-disabled writer, corruption) | Step 3 **ORDER PRESENT** branch — `locked draft.status != APPROVED` is checked **before** the `quote_id` match — returns `DELIVERY_ORDER_STATE_INCONSISTENT` (alert), zero writes. Corruption is never returned as a successful recovery. (When **no** order exists for the `draft_id`, the ORDER ABSENT branch runs instead: a non-`APPROVED` draft simply proceeds to step 4 — see Example R.) |
| 31 | A cargo category becomes non-deliverable while replicas run different policy constants during a rolling deploy | Not an ordinary deploy: a coordinated **Policy-version activation** halts creation-branch approvals on all writers (`CARGO_POLICY_TRANSITION`, retryable), drains in-flight, confirms no old-constant replica remains, activates, resumes. No approval straddles two constants; if a step is unconfirmed, creation stays blocked. Recovery does not re-check cargo policy. |
| 32 | An otherwise consistent order has **no recipient snapshot, or a snapshot with a null/malformed `recipient_contact` / `destination_text` / `destination_point`** | An ordinary order-only INSERT fails the deferred well-formed-existence constraint at commit; the field `NOT NULL`/shape constraints reject a malformed child write; lawful order + well-formed child insertion commits. Pre-existing corruption (missing **or malformed** child) fails **Existing-order integrity** on recovery/cancellation → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. |
| 33 | Merchant cancel of a `PENDING_DISPATCH` order with a non-`APPROVED` source draft | Cancellation step 4 rejects the structural fault before its status gate; no `CANCELED` transition or provenance writes. |
| 34 | Empty cargo, zero/negative/non-finite/out-of-bounds quantity, or missing/unsupported unit | Quote publication and creation step 5b reject `DELIVERY_CARGO_LINE_INVALID` before fingerprint/policy; no vacuous empty-set approval. Valid canonical 2-KG cargo reaches subsequent checks. |
| 35 | Order for draft D1 references a quote owned by D2 | The non-null composite quote/draft FK rejects the write. If already corrupt, **Existing-order integrity** rejects even an exact presented quote match; never successful recovery or cancellation. |
| 36 | Order names one approver but a membership of another user/merchant | The full membership-ID/merchant/user FK rejects the write; historical identity is checked before recovery. A revoked original membership whose immutable tuple matches remains valid history (Example S). |
| 37 | `QUOTED` draft whose presented `quote_id == latest_published_quote_id`, but that marker quote has `INVALIDATED`/unknown state and an unchanged fingerprint | Creation step 5c returns `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. Ordinary `OPEN` invalidation remains step-4c `QUOTE_STALE`; marker inequality / supersession remains higher priority. |
| 38 | Pickup edit/default switch commits during candidate quote computation | Publication acquires draft/merchant/pickup locks, re-resolves inputs and rejects the old priced candidate on mismatch; no obsolete quote is published. If publication wins first, a subsequent edit can stale the committed quote normally. |
| 39 | Caller supplies a pickup override at approval | Approval does not accept pickup overrides. The caller must edit the draft and obtain a new quote; only the persisted explicit selection or resolved default can enter step 5a. |
| 40 | Only `destination_text` changes, resolved coordinates stay equal | It remains a confirmed-input edit: quote invalidation/fingerprint input includes the text in every consumer; a stale priced candidate cannot publish and an old approval cannot create an order from the mismatched inputs. |
| 41 | Operator B cancels an order approved by operator A; the response is retried | The transaction records B's locked user/membership/channel/procedure with timestamp/reason atomically. The retry is zero-write and cannot replace B with A/the retrying actor or re-stamp provenance (Example T). |
| 42 | Authorized current caller recovers a valid canceled order after original approver revocation and quote expiry | **Existing-order integrity** checks immutable historical links, the well-formed child, and the snapshot ↔ immutable-quote equality (`F(order snapshots) == order.delivery_input_fingerprint == quote.delivery_input_fingerprint`; copied amount/currency/computed_at/expires_at equal the referenced quote) — **not** current eligibility of the original membership/quote, current cargo policy, expiry-vs-now, or live `quote_state`. Exact quote match returns the same canceled order, zero writes (Example S). |
| 43 | A backfill inserts a structurally plausible order with `pickup_location_id = NULL` (so PostgreSQL skips the composite pickup FK), or with a `pickup_snapshot` that is null / mismatched-id / has out-of-range or missing coordinates, or whose `(pickup_location_id, merchant_id)` names another merchant's location | `pickup_location_id` and `pickup_snapshot` are `NOT NULL`; the composite pickup FK and the `pickup_snapshot` shape constraint reject an ordinary bad write. Pre-existing corruption fails **Existing-order integrity** on recovery/cancellation → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. Recovery does **not** re-resolve/re-lock the location or compare the frozen snapshot to its current ACTIVE/default/address/coordinates. |
| 44 | The channel identity/binding provenance of an order is corrupt — `approval_channel in { WHATSAPP, SMS }` with a null `approved_external_contact_identity_id` / `approved_merchant_contact_binding_id`, both set for `SESSION`, a binding not owned by `(order.merchant_id, approved_external_contact_identity_id)`, or an identity whose `linked_user_id != approved_by_user_id` / `channel != approval_channel`; **or a populated `canceled_external_contact_identity_id` / `canceled_merchant_contact_binding_id` on a `SESSION` cancellation, or on an order with no merchant cancellation through this slice** (for a `WHATSAPP`/`SMS` cancellation the mirror non-null/ownership/linkage checks apply to the `canceled_*` pair instead) | The composite binding FK, identity guard and the `NOT NULL`-by-channel / `NULL`-otherwise rule reject an ordinary bad write. Pre-existing corruption fails **Existing-order integrity** on recovery/cancellation → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. A since-`REVOKED` identity/binding whose immutable tuple still matches is valid history and still recovers (Example S). |
| 45 | Order authorized through a channel actor who holds two verified identities/bindings for the same merchant | The authorization step records the **exact** identity + binding that actually passed the gate onto the order, and the order guard makes that pair immutable thereafter — so the stored pair is the one that authorized this order. **Existing-order integrity** verifies null-ness by channel plus ownership/linkage, but cannot by itself distinguish a later swap to *another* structurally-consistent same-merchant/user/channel pair; the exact-choice guarantee rests on the recorded authorization result and subsequent immutability, not on re-detecting a swap. |
| 46 | A secondary writer / backfill inserts a structurally valid order (correct FKs, well-formed recipient snapshot, non-null merchant-owned pickup) whose **snapshot content differs from the referenced quote** — e.g. the cargo lines say 200 kg where the quote priced 2 kg, or the destination point / `pickup_snapshot` content differs | **Existing-order integrity** recomputes `F(immutable order snapshots)` and finds `F != order.delivery_input_fingerprint` (or `order.delivery_input_fingerprint != quote.delivery_input_fingerprint`) → `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes, before recovery or a cancellation transition. The unapproved cargo/destination/pickup is never returned as authoritative. |
| 47 | A secondary writer / backfill inserts an order whose fingerprint and snapshots are consistent but whose **copied `quote_amount` / `quote_currency` / `quote_computed_at` / `quote_expires_at` differ** from the referenced quote's immutable published values | **Existing-order integrity**'s copied-field equality fails → `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes, before recovery or a cancellation transition. An order carrying an unapproved price / validity window is never recovered. |
| 48 | The canonical fingerprint algorithm version is later revised | The historical recompute uses the **algorithm version named on the referenced quote's fingerprint**, so a correctly-approved older order still matches. A recompute under a newer version is not applied to an order whose quote used the older one; algorithm evolution never turns valid history into `DELIVERY_ORDER_STATE_INCONSISTENT`. |
| 49 | A secondary writer / backfill inserts a structurally valid `PENDING_DISPATCH` `delivery_order` for a **`QUOTED`** draft, or sets a draft `APPROVED` with **no** order — every FK and `UNIQUE` passes | The **deferred draft/order coupling constraint-trigger pair** (invariant 6 → *The creation transaction*; Idempotency and recovery) evaluates the **final committed rows** and rejects the transaction: `APPROVED` ⇔ exactly one order (any state, incl. `CANCELED`); any other status ⇔ zero. The lawful `INSERT order -> INSERT snapshot -> flip draft APPROVED` sequence still commits; a `PENDING_DISPATCH -> CANCELED` / `-> SEARCHING_DRIVER` transition keeps the pair intact. The `delivery_order`-side trigger reads the draft **without `FOR UPDATE`**, so a dispatch/cancellation `UPDATE` takes no late `delivery_draft` lock. |
| 50 | Pickup `merchant_locations` row is ACTIVE, same-merchant, has `lat`/`lng` but **no / invalid / source-inconsistent `resolved_pickup_point`** (legacy row, `0009` stores none; or an address edit left a stale point); **or** a backfill swaps only the provider/place id + provenance on a persisted order's `pickup_snapshot`, address and coordinates unchanged | No provenance is invented from bare coordinates. Creation step 5a and Quote publication require a non-null `resolved_pickup_point` that is shape-valid **and consistent with the location's current address/coordinates** → else `DELIVERY_PICKUP_UNRESOLVED`; a trusted resolver-persist procedure fills it before pricing under the existing `draft -> merchant -> location` locks; an address/coordinate edit clears/invalidates a stale point and stales any attached quote via the pickup-content fingerprint rule (rows 6, 8). On a persisted order the **full `resolved_pickup_point` is a canonical fingerprint input**, so the Existing-order integrity recompute catches a provider/place / source-binding swap under an unchanged address → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes (row 46; Example X). |
| 51 | A backfill inserts an order that copies `quote_amount` / `quote_currency` / `quote_computed_at` / `quote_expires_at` and both fingerprints correctly but sets `quote_state` to `INVALIDATED` / an unknown value | **Existing-order integrity**'s stored-`quote_state` check (non-null, in the closed approvable-value set) fails → `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes, before recovery or a cancellation transition. The DB `CHECK` + `NOT NULL` reject the ordinary bad write; `quote_state` is written only from the step-5c verified state, never from the request. |
| 52 | Intake or a secondary writer creates a `delivery_draft` with `merchant_id = NULL` (any channel), and a duplicate arrives | `delivery_draft.merchant_id` is `NOT NULL REFERENCES merchants(id)` → the tenantless write is rejected; intake that cannot resolve a merchant parks upstream, never as a draft row. Because the intake dedupe key `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` then always has a concrete leading component, the duplicate cannot slip past it via null-distinct comparison. |
| 53 | A merchant cancellation names a **nonexistent** `order_id`, **or** another tenant's `order_id` the caller has no authority over | **Nonexistent (ORDER ABSENT):** step 1's hint read finds no row → `DELIVERY_ORDER_NOT_FOUND`, **zero writes, without taking any authority lock**. **Cross-tenant (ORDER PRESENT):** step 2 **does** take the shared authority prefix for the hinted `merchant_id`, step 3's re-resolve fails (`MERCHANT_ACTOR_UNAUTHORIZED` internally, logged), and the client-facing code is **masked to the same `DELIVERY_ORDER_NOT_FOUND`** so existence is not disclosed; no transition, zero writes. For an order that exists and whose caller passes the step-3 gate, the post-authorization **Existing-order integrity** check then the status gate are unchanged (row 26, row 33; Example W, Example T). |
| 54 | An **approval** transaction waits on a blocking lock (e.g. the step-5a pickup row), **or a Quote publication** transaction waits on the `merchants(M)` / selected-pickup lock, until the source draft's `expires_at` deadline passes with the inputs unchanged; separately, the deadline sweep and an approval race | Deadlines are read on the **authoritative wall clock after every blocking lock is held** (like quote expiry): approval's step-4 pre-(a) check and its step-5c re-check, and **publication's post-lock re-read immediately before the atomic publish** (Quote boundary, publication step 5), each yield `DELIVERY_DRAFT_EXPIRED`, zero writes — neither an order nor a published quote/fingerprint/draft-state lands on the aged-out draft. The early step-1 publication check alone is insufficient because the locks are taken after it (Example V). The sweep and approval both take `delivery_draft` `FOR UPDATE`, so they **serialize**: sweep-first → approval sees the `EXPIRED` draft → step 4 pre-(a) → `DELIVERY_DRAFT_EXPIRED`; approval-first → it flips `-> APPROVED` and the sweep then skips it (an `APPROVED` draft never expires). ORDER PRESENT recovery / cancellation never evaluate the deadline against the current clock. |
| 55 | A secondary writer / backfill inserts an order whose quote, fingerprint and snapshots are all internally consistent but whose `cargo` set contains `ALCOHOL` / another non-deliverable category, with `cargo_policy_version` absent, or set to an older permissive version, or `cargo_policy_decision` backfilled `DELIVERABLE`; **and separately, a backfill / secondary-writer order-creation transaction that read cargo under the old constant is still in flight when a policy activation begins** | The trusted `INSERT` validator re-derives the category set from `NEW.cargo`, evaluates it under the **activated** policy version from the same immutable definition the resolver uses, and rejects a stored version/decision that does not actually clear those categories — a backfilled `DELIVERABLE` or a stale permissive version does not pass. A pre-existing such row fails **Existing-order integrity**'s stored-decision re-check (against that version's retained definition) → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. For the interleaving: activation step 2 **drains every already-started order-creation transaction to COMMIT/ROLLBACK — approval, secondary writers and backfills alike — and step 3 confirms the drain** before the version is switched or inserts resume, so no transaction that evaluated cargo under the old constant can commit against the new one (nor vice-versa). Policy is **not** in the canonical quote fingerprint; a later active-policy change never faults a correctly-approved historical order (row 48-style). |
| 56 | A repository bug / backfill sets an `ABANDONED` (or `EXPIRED`) draft back to `QUOTED` before its deadline, then an approval creates an order | The row-local `BEFORE INSERT OR UPDATE` transition guard on `delivery_draft` rejects any transition **out of** `APPROVED` / `ABANDONED` / `EXPIRED`, evaluating every `OLD.status -> NEW.status` including successive UPDATEs in one transaction — the `ABANDONED -> QUOTED` hop never commits, so no order is created from an abandoned delivery. This guard is separate from and additional to the deferred coupling (row 49), which would not catch it (final `APPROVED` draft has exactly one order). |
| 57 | A secondary writer / backfill inserts an otherwise-consistent `delivery_order` directly as `SEARCHING_DRIVER` / `DELIVERED` / another downstream state, with its draft `APPROVED` | The row-local `BEFORE INSERT` guard on `delivery_order` permits a **new** row only with `status = PENDING_DISPATCH` (a `DEFAULT` alone would be overridden by an explicit value). Lawful downstream `UPDATE`s and recovery of existing `CANCELED` / `DELIVERED` rows are unaffected — it is not a permanent `CHECK (status = 'PENDING_DISPATCH')`. No cross-table lock is added. |
| 58 | An actor for merchant A submits a guessed / leaked `draft_id` owned by merchant B — including the case where A's actor has **no membership for B at all** (the gate does not "resolve some other merchant", it simply finds no ACTIVE `(B, U)` membership) | Step 1 locks `d_B` and sets `M := B` **from the locked draft**; step 2 re-resolves the gate **for `B`** and it fails (any of: no ACTIVE `(B, U)` membership, role miss, `merchants(B)` not `ACTIVE`, gate resolving only `A`, channel identity/binding mismatch). The true reason (`MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED` / `MERCHANT_INOPERABLE` / `CONTACT_*`) is internal, logged; the **external code is `DELIVERY_DRAFT_NOT_FOUND`**, the same a nonexistent `draft_id` returns, so `A` cannot distinguish "B's draft exists" from "no such draft" — no own-merchant exception. Zero writes; `B`'s draft/order is never read or written under `A`'s authority (cf. row 10, and cancellation rows 26 / 53). |
| 59 | A quote candidate is priced outside the publication transaction, then publication waits on the `merchants(M)` / pickup lock until the **candidate's own `quote.expires_at`** passes while `delivery_draft.expires_at` is still in the future | Publication step 5 takes one post-lock `t := clock_timestamp()` and checks **both**: `t >= draft.expires_at` → `DELIVERY_DRAFT_EXPIRED`; then `t >= candidate_quote.expires_at` → `QUOTE_EXPIRED`. Either fails zero-write; the candidate is not published and its timestamps are not extended, so no `QUOTED` draft is left carrying an already-expired quote. Historical recovery still never re-checks quote expiry against the current clock. |
| 60 | Between step 5c and the `delivery_order` `INSERT`, the referenced quote's `expires_at`, or the source draft's `expires_at`, passes (slow 5d-5e fingerprint recompute / cargo-policy validation, or a scheduler delay — no new lock is taken after 5c); or a secondary writer / backfill inserts an otherwise-consistent order after either deadline | Step 5f takes **one fresh `t := clock_timestamp()`** after all locks/checks and requires `t < delivery_draft.expires_at` (else `DELIVERY_DRAFT_EXPIRED`) then `t < referenced_quote.expires_at` (else `QUOTE_EXPIRED`), rollback, no order; the same `t` is stamped as `delivery_order.created_at` (`NOT NULL`, immutable, non-backdatable, `< COMMIT`). All new inserts, backfills included, go through this trusted boundary. A pre-existing order whose `created_at` is null / not before both immutable deadlines fails **Existing-order integrity** → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. A correctly-created order still recovers after both deadlines have long passed (historical relation only). |
| 61 | A caller supplies a future `created_at` on the order `INSERT`, or a `DEFAULT` would otherwise apply | The trusted creation boundary sets `created_at` from its own fresh `t` and rejects a caller-supplied value; `created_at` is `NOT NULL` and immutable (order guard). A backdated / future value can neither be inserted nor `UPDATE`d in later. |
| 62 | A repository bug / backfill performs `OPEN`/`QUOTED -> EXPIRED` **before** `expires_at`, or supplies a future `expired_at`, or re-`UPDATE`s `expired_at` | The row-local transition guard, under the row lock, takes a fresh `t_exp`, requires `t_exp >= OLD.expires_at`, and sets `expired_at := t_exp` itself — a premature `-> EXPIRED` and a caller-supplied `expired_at` are rejected; `EXPIRED` is absorbing and `expired_at` is immutable, so a still-valid draft is never permanently killed and the timestamp is never moved. The trusted sweep (with its no-order + due checks and atomic quote-eligibility invalidation) is unchanged; no cross-table lock is added (rows 49, 56). |
| 63 | Intake or a secondary writer stores merchant B's `merchant_locations` id in `delivery_draft.requested_pickup_location_id` on merchant A's draft | The draft-level composite FK `(requested_pickup_location_id, merchant_id) -> merchant_locations (id, merchant_id)` (`MATCH SIMPLE`, `RESTRICT`) rejects the cross-tenant reference at `INSERT`/`UPDATE` — the tenant-corrupt draft is never persisted, even transiently. `NULL` (resolve default) is still allowed. ACTIVE / default / resolved-point checks at quoting and approval stay separate (rows 11, 50). |
| 64 | An adapter concurrently redelivers one full intake key `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)`; or a token is stored with a null `origin_namespace` / null `origin_channel` | The immediate `UNIQUE` over the four fields, with `origin_channel` `NOT NULL` and `CHECK (adapter_dedupe_token IS NULL OR origin_namespace IS NOT NULL)`, admits exactly **one** draft; the loser reads the existing draft and proceeds from it — no overwrite of intent, no deadline extension, no resurrection of a terminal draft. A null namespace/channel can no longer evade the key. Tokenless (`NULL` token) manual drafts still repeat freely; different merchant / channel / namespace stay independent (row 12; Example O). |
| 65 | A secondary writer / backfill references a tuple-correct but **currently `REVOKED`** approval membership (or revoked/unverified channel identity + binding) on a new order; separately, a revocation races the creation transaction | The trusted creation procedure re-checks the merchant / membership+role / channel identity-proof / binding are **currently eligible** at insert time under the fixed lock prefix, writing provenance from that re-checked result — a `REVOKED` tuple fails, `ROLLBACK`, no order. Revocation-first: the procedure's locks wait, then it reads the committed negative state (`MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_INOPERABLE` / `MERCHANT_ACTOR_UNAUTHORIZED`, internal; external `DELIVERY_DRAFT_NOT_FOUND` per CORRECTED15 masking). Creation-first: it holds the locks through commit; the revoke waits and then sees the committed order. Later **recovery** keeps the historical tuple checks and never re-evaluates the original approver's current eligibility (Example S). |
| 66 | A secondary writer sets an order to `CANCELED` with `cancellation_authority` null; `MERCHANT` with a null/unknown `cancellation_channel`, null `cancellation_provenance` or absent/partial merchant tuple; `DISPATCH_EXECUTION` with non-null merchant provenance/tuple or an unverifiable compensation reference; or a non-`CANCELED` row with non-null cancellation provenance | Step 5 sets `MERCHANT` atomically with a non-null closed channel and non-null provenance in the full verified merchant tuple, write-once. `DISPATCH_EXECUTION` is closed here and requires null merchant provenance/tuple plus its separate verified reference. The total DB partition rejects every malformed shape; pre-existing corruption → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes (rows 33, 41, 86, 89; Examples T, AG). |
| 67 | A secondary writer / backfill `UPDATE`s `delivery_draft.merchant_id` to another valid merchant on an `OPEN` / `QUOTED` draft that has no explicit pickup (so the draft-pickup FK, the state-transition guard and the draft/order coupling are all still satisfied) | The immediate row-local `BEFORE INSERT OR UPDATE` guard rejects **any** `OLD.merchant_id -> NEW.merchant_id` change, in every status and on each intra-transaction `UPDATE`. The tenant, the actor-gate boundary and the intake-dedupe key stay fixed, so the other merchant's actor never passes the tenant gate for this draft, never reads its recipient PII, and never re-prices / approves it. A different tenant's request is a **new draft** (`delivery_draft` field table + rules; decision 1; acceptance criteria). |
| 68 | Cleanup or a secondary writer hard-`DELETE`s a token-backed `OPEN` / `ABANDONED` / `EXPIRED` `delivery_draft` that has no referencing order; the adapter then redelivers the same intake key | The row-local `BEFORE DELETE` guard rejects the hard-delete of any draft with `adapter_dedupe_token IS NOT NULL`, in any status — the `UNIQUE` row cannot vanish. The redelivery's `INSERT` collides with the still-present key and the loser resolves to the **original** draft in its recorded status, with its **original** deadline — an abandoned / expired request is not turned back into a fresh `OPEN` draft or an order. A non-token draft has no dedupe-specific retention, but deletion is allowed only when no independent FK or published-quote retention invariant forbids it; quote ownership is `ON DELETE RESTRICT`, never cascade (`delivery_draft` field table + rules; Idempotency and recovery; rows 21, 64; Example O). |
| 69 | A writer `UPDATE`s one component of the intake tuple on an existing draft — a different `origin_namespace`, or **`adapter_dedupe_token` set from a value back to `NULL`** to "free" the key — then a redelivery of the old key arrives | The same guard rejects any change to `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` under a null-safe `IS DISTINCT FROM` comparison, so the token cannot be nulled and no component can be swapped. The old key still resolves to this draft on redelivery. **Legitimate, still allowed:** a separate fresh `INSERT` of a tokenless manual draft for the same merchant (`NULL` token repeats freely), and the ordinary intent edits (recipient / contact / destination / access note / window / cargo) on this draft while `OPEN` (`delivery_draft` field table + rules; Idempotency and recovery; rows 12, 64). |
| 70 | Recovery / cancellation of an order whose `approval_channel` is `NULL` (legacy row, or a trigger-bypassed backfill) with both `approved_external_contact_identity_id` / `approved_merchant_contact_binding_id` also null | **Existing-order integrity**'s **approval-channel-present** check runs first: a null / unknown `approval_channel` → `DELIVERY_ORDER_STATE_INCONSISTENT` (alert, zero writes), **before** the identity/binding-tuple check — the order is not recovered without establishing session-vs-channel proof. Positive controls: a `SESSION` order (`approval_channel = SESSION`, pair `NULL`) and a `WHATSAPP` / `SMS` order (`approval_channel` set, pair `NOT NULL` + owned) both pass, and a since-`REVOKED` identity/binding whose channel + tuple still match is valid history and still recovers (`delivery_order` field table; Existing-order integrity; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; Example S). |
| 71 | Abandon vs approval/reprice | Both take the draft lock first. Abandon-first leaves an order-free absorbing draft and invalid quote eligibility; later approval/reprice cannot create/publish. Approval-first leaves APPROVED plus one order; abandonment refuses DELIVERY_DRAFT_NOT_ABANDONABLE, zero writes. Rollback exposes neither half of abandonment. |
| 72 | Abandon vs revocation; foreign/missing draft; direct writer | The tenant-derived locked actor gate runs even for replay. Revoke-first or no rights gives masked DELIVERY_DRAFT_NOT_FOUND; abandon-first holds the authority prefix until commit/rollback. An ordinary direct status UPDATE is denied. No pickup/late reverse lock is introduced. |
| 73 | Abandon retry, expiry and corrupt coupling | Authorized replay of ABANDONED with no order is zero-write even after its deadline. EXPIRED or due OPEN/QUOTED returns DELIVERY_DRAFT_EXPIRED. APPROVED without an order, or non-APPROVED with an order, fails integrity before state success. A consistent APPROVED draft cannot be abandoned; existing order cancellation is unchanged. |
| 74 | CANCELED history has valid provenance but missing/bad time or reason | Null/non-finite/malformed/pre-creation canceled_at, blank/oversized/invalid-source reason or either cancellation fact on a non-CANCELED row fails DB shape and historical integrity. Recovery returns DELIVERY_ORDER_STATE_INCONSISTENT, never a repaired row. |
| 75 | Valid cancellation and later replay/recovery | A valid reason plus server t_cancel >= created_at is written atomically and once with provenance. Repeat cancel remains zero-write DELIVERY_ORDER_NOT_CANCELABLE; exact-pair recovery of valid canceled history remains zero-write after original grants/quote deadlines expire. |
| 76 | Invalid candidate or copied monetary values | Null/negative/non-finite/out-of-bound money, excess precision, invalid currency or zero without explicit permission fails before rounding/copying: candidate publication QUOTE_MONETARY_INVALID; persisted quote/order corruption DELIVERY_ORDER_STATE_INCONSISTENT on creation/recovery. Copy equality alone never passes invalid values. |
| 77 | Valid monetary boundary and historical commercial change | An exact amount within frozen bounds/scale and an allowed currency, with all other gates passing, can be copied unchanged. Later commercial restrictions do not invalidate its retained historical shape or exact-pair recovery; incomplete shared definitions block initial activation. |
| 78 | Missing quote_id and malformed pair preflight | Step 0a rejects a non-record; 0b returns QUOTE_REQUIRED for absent/null/blank quote_id even if draft_id is also bad; 0c rejects malformed/present non-string IDs and extra fields. No domain query or lock. A valid pair passes to the existing masked tenant gate: on ORDER ABSENT, a well-shaped missing/foreign quote ID is not QUOTE_REQUIRED and reaches step 4d only after the locked actor gate, step 3a integrity, draft expiry and 4a/4b/4c all permit it. With an authorized caller, a well-shaped nonexistent quote ID and no order: APPROVED returns DELIVERY_ORDER_STATE_INCONSISTENT at 3a; expired OPEN/QUOTED returns DELIVERY_DRAFT_EXPIRED before 4a; unexpired ABANDONED returns DELIVERY_DRAFT_NOT_APPROVABLE at 4a; unexpired OPEN returns DELIVERY_DRAFT_NOT_APPROVABLE at 4d only after the earlier checks pass. ORDER PRESENT uses step 3 integrity then exact quote match/conflict. |
| 79 | Initial draft timestamps/TTL forged or misconfigured | Caller timestamps or TTL are rejected; no ordinary direct INSERT. Trusted boundary derives one t_d and expires_at = t_d + frozen TTL. DB rejects null/non-finite/mismatched/overflowed values and non-positive/out-of-bound TTL; missing/shared-rule drift blocks activation. |
| 80 | Fresh draft versus dedupe replay and later updates | Fresh accepted input creates OPEN with created_at = updated_at = t_d and fixed expiry. A duplicate full key returns the original draft without refreshing timestamps; edits/repricing and successive UPDATEs cannot change created_at or expires_at. OBSERVED-contact intent intake is not promoted to order/abandonment authority. |
| 81 | Destination text changes from A to B while a stale resolver result for A is about to be persisted/published; coordinates/provider id are otherwise valid | Trusted destination persistence re-reads B under the draft lock and rejects/invalidates the A-bound result. Publication and creation require `destination_point.source_text_binding == binding(canonical destination_text)` under the draft lock; mismatch → `DELIVERY_DESTINATION_UNRESOLVED`, zero writes/no order. Positive control: a point resolved from the same canonical text is fingerprinted including the binding, copied to the recipient snapshot, and later recovery validates only the frozen snapshot text↔binding pair. |
| 82 | Intake supplies `adapter_dedupe_token = ''` / whitespace, or a present token with blank/whitespace `origin_namespace`; separate provider accounts reuse the same message id | Trusted intake canonicalization rejects the blank component as `DELIVERY_DRAFT_INPUT_INVALID` before the UNIQUE key. DB nonblank/bounds checks backstop secondary writers. Positive controls: a canonical nonblank full key dedupes exactly once; `adapter_dedupe_token = NULL` remains tokenless and repeatable; two canonical namespaces remain independent. |
| 83 | Quote publication receives null/infinite timestamps, `computed_at >= expires_at`, a future-dated `computed_at`, an overlong duration, or a valid window that merely expires while waiting on locks | Malformed/future/overlong candidates fail `QUOTE_VALIDITY_INVALID`; an otherwise valid window crossed by the fresh post-lock clock fails `QUOTE_EXPIRED`. Positive control: server-owned finite non-null timestamps with `computed_at <= t_publish < expires_at` and bounded positive duration publish with immutable **`published_at := t_publish`**. Historical recovery later verifies `computed_at <= published_at < expires_at`, the retained duration rule and exact copy equality only, never expiry against today's clock. |
| 84 | Two reprices publish serially for one draft, but their timestamps are equal or non-monotonic | Both take the draft lock. Each successful publication atomically moves `latest_published_quote_id`; the second lock winner's quote id is the final marker regardless of timestamps/UUID/price. Both published rows remain addressable and the first is not deleted. Approval of the first returns `QUOTE_SUPERSEDED`; approval of the marker quote may proceed subject to all other gates. Failed publication leaves the prior marker unchanged. |
| 85 | Cancellation payload is null/scalar, has a malformed/non-string UUID, bad/missing reason, or carries extra actor/channel/provenance/timestamp fields | Step 0 returns `DELIVERY_CANCEL_INPUT_INVALID` before any domain lookup, lock or write. Positive controls: a well-shaped unknown UUID reaches step 1 and returns masked `DELIVERY_ORDER_NOT_FOUND`; a well-shaped foreign UUID reaches the locked gate and yields the same external code; an owned pending order continues normally. |
| 86 | A `MERCHANT`-canceled row has `cancellation_channel = NULL` / unknown, or a channel/pair combination that does not match `SESSION`, `WHATSAPP`, or `SMS` | The total source-dependent DB constraint rejects an ordinary bad write. Existing-order integrity checks the non-null closed merchant channel **before** branching on the identity/binding pair; pre-existing corruption returns `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. Positive controls: `SESSION` + non-null merchant provenance + null pair; channel + non-null provenance + owned non-null pair; and `DISPATCH_EXECUTION` + verified compensation reference + null channel, provenance and remaining merchant tuple. |
| 87 | A secondary writer edits confirmed intent while leaving a draft `QUOTED`, or edits intent on an `APPROVED` / `ABANDONED` / `EXPIRED` row; separately, a trusted `QUOTED` edit fails mid-transaction | Null-safe row-guard comparisons reject same-status `QUOTED` and all terminal intent edits. The trusted path commits intent + `QUOTED -> OPEN` + old marker-quote invalidation atomically; its deferred final-state backstop rejects any false quoted state. Failure rolls all effects back. Positive controls: an `OPEN -> OPEN` edit and a later fresh publication with a new marker are allowed. |
| 88 | Publish q1, then publish q2 for the same active, unexpired, order-free draft; cleanup attempts to hard-delete q1; approval then names q1 | The quote-owned guard rejects q1 deletion. q1 remains a retained same-draft published row, q2 remains `latest_published_quote_id`, and step 4b deterministically returns `QUOTE_SUPERSEDED`, zero writes. An addressable same-draft candidate whose publication never committed (`published_at IS NULL`), a random/missing id, and a foreign id each remain step-4d `DELIVERY_DRAFT_NOT_APPROVABLE` controls. No ledger or tombstone is consulted. |
| 89 | A writer stores `MERCHANT` with null `cancellation_provenance`, `DISPATCH_EXECUTION` with non-null `cancellation_provenance`, or any non-`CANCELED` row with non-null `cancellation_provenance` | The exhaustive source-shape constraint, expressed with explicit `IS NULL` / `IS NOT NULL` branches and total `IS TRUE` semantics, rejects each write. Positive controls are `MERCHANT` with non-null merchant provenance and no compensation reference; `DISPATCH_EXECUTION` with null merchant provenance/tuple and a verified separate compensation reference; and a non-`CANCELED` row with all cancellation evidence null. |

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

The existing `DELIVERY_DRAFT_NOT_FOUND` mask also applies to abandonment's
missing draft or any locked actor-gate failure. `DELIVERY_DRAFT_EXPIRED` also
covers abandonment's expired/due refusal, but does not override an authorized
zero-write replay of an already-ABANDONED order-free draft. The same
`DELIVERY_ORDER_STATE_INCONSISTENT` covers abandonment coupling faults and the
new historical cancellation-fact/monetary-shape failures; valid ORDER PRESENT
history still never rechecks current time or original-actor eligibility.

Reuses the 01A `MERCHANT_*` actor-gate codes (`MERCHANT_NOT_FOUND`,
`MERCHANT_INOPERABLE`, `MERCHANT_MEMBERSHIP_REQUIRED`,
`MERCHANT_ACTOR_UNAUTHORIZED`, `EXTERNAL_CONTACT_UNKNOWN`,
`EXTERNAL_CONTACT_IDENTITY_CONFLICT`, `MERCHANT_CONTEXT_AMBIGUOUS`,
`MERCHANT_LOCATION_REQUIRED`, `CONTACT_CHANNEL_PROOF_REQUIRED`,
`CONTACT_USER_LINK_REQUIRED`) and adds:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `DELIVERY_DRAFT_NOT_FOUND` | The client-facing code when an approval's `draft_id` **does not exist**, **and also** — deliberately masked to the same value — for **any** failure of the locked actor gate for the locked draft's `M` (no ACTIVE `(M, U)` membership, allowed-role miss, `merchants(M)` not `ACTIVE`, gate resolving another merchant, channel `linked_user_id` mismatch, revoked/mismatched identity or binding). No caller — for `M` or any other merchant — can distinguish "this merchant's draft exists" from "no such draft"; the true reason (`MERCHANT_ACTOR_UNAUTHORIZED` / `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_INOPERABLE` / `CONTACT_*`) is internal, logged. Mirrors cancellation's `DELIVERY_ORDER_NOT_FOUND` masking. Order-creation steps 1–2. | false |
| `DELIVERY_ORDER_NOT_FOUND` | The client-facing code for a merchant cancellation that cannot act on the named `order_id`, in **two internally distinct** cases: **(ORDER ABSENT)** no `delivery_order` exists — returned at Cancellation step 1, **before any authority lock**, zero writes; **(ORDER PRESENT, unauthorized)** the order exists but step 3's locked authority gate fails (`MERCHANT_ACTOR_UNAUTHORIZED` internally) — the external code is masked to this same value so cross-tenant existence is not disclosed. The internal reason (absent vs unauthorized) is logged separately. Never a substitute for the post-gate **Existing-order integrity** check, which still runs once the gate passes. | false |
| `DELIVERY_DRAFT_NOT_APPROVABLE` | Draft is `ABANDONED` — step 4a; or a non-creatable `OPEN` state with no own approvable quote; or a presented `quote_id` that does not exist, is foreign, or names an addressable same-draft candidate whose publication never committed — step 4d. | false |
| `DELIVERY_DRAFT_EXPIRED` | The source draft is `EXPIRED`, or its server-assigned `expires_at` deadline has otherwise passed (`clock_timestamp() >= expires_at`, read after the blocking locks) whether or not the deadline sweep has run. Checked at Order-creation step 4 **before (a)** and before superseded / stale, re-checked at step 5c, **again at step 5f against the one fresh `t` that stamps `created_at`** (closing the check-to-INSERT gap), and at Quote publication. A fresh draft is required. Never evaluated on ORDER PRESENT recovery / cancellation; an `APPROVED` draft never expires. | false |
| `DELIVERY_RECIPIENT_INCOMPLETE` | Missing `recipient_contact` or `destination_text`. A Quote Authority precondition; **re-checked in the creation branch under the draft lock** (step 5b) so a partial `QUOTED` draft cannot become an authoritative order. | false |
| `DELIVERY_DESTINATION_UNRESOLVED` | No canonical resolved `destination_point` is available **or** its coordinates/provider-place id/provenance/`source_text_binding` are missing/invalid **or the binding does not match the current canonical `destination_text`**. Quote publication and creation step 5b re-check this under the draft lock; neither path geocodes. A quote cannot attach until a trusted resolver result is persisted against the exact source text. | false |
| `DELIVERY_PICKUP_UNRESOLVED` | The resolved / explicit pickup `merchant_locations` row is ACTIVE and same-merchant but carries **null coordinates** (`0009` permits this), **or a null / invalid / source-inconsistent `resolved_pickup_point`** (missing coordinates / provider-place id / provenance / source binding, or a stored point that no longer matches the row's current address/coordinates). A delivery pickup needs a routable, provenance-bearing point fixed before pricing; no approval-time geocode, no provenance invented from coordinates. Step 5a and Quote publication. | false |
| `DELIVERY_CARGO_LINE_INVALID` | Cargo is missing/empty/not a bounded canonical list, or a line's shape/quantity/unit fails invariant 5's shared validation. Checked before quote publication and at creation step 5b, before fingerprint/policy; never revalidated on recovery. | false |
| `MERCHANT_ACTOR_UNAUTHORIZED` (01A) | On the approval path this is an **internal-only** reason (logged) for a locked-actor-gate failure against the locked `delivery_draft.merchant_id` — the **external** code is always masked to `DELIVERY_DRAFT_NOT_FOUND` (no own-merchant exception). It is still surfaced as itself by the 01A resolver contract in contexts with no tenant-existence disclosure. | false |
| `MERCHANT_LOCATION_REQUIRED` (01A) | Also raised here when the resolved / explicit pickup is non-ACTIVE, ambiguous, or belongs to a merchant other than the draft's. | false |
| `QUOTE_REQUIRED` | Approval step 0b: the record payload has an absent, null or blank-string `quote_id`. Returned before any domain transaction/read/lock, including a recovery request. Present malformed/non-string IDs use `DELIVERY_APPROVAL_INPUT_INVALID`; on ORDER ABSENT a well-shaped missing/foreign quote ID is not `QUOTE_REQUIRED` and reaches step 4d only after the locked actor gate, step 3a integrity, draft expiry and steps 4a/4b/4c permit it, with every earlier failure retaining its result, while ORDER PRESENT retains step 3 integrity and quote-match/conflict handling. | false |
| `QUOTE_SUPERSEDED` | The presented retained same-draft **successfully published** quote id (proved by immutable non-null `published_at`) differs from the draft's non-null `latest_published_quote_id`; **approval** must name that marker value. Mere addressability of a same-draft unpublished candidate is insufficient and reaches step 4d. Checked for `OPEN` and `QUOTED` drafts alike and before `QUOTE_STALE` — step 4b. The winner is never inferred from timestamps, UUIDs or price. Published quote retention guarantees that an older q1 remains an actual same-draft row after q2, so cleanup cannot turn this result into `DELIVERY_DRAFT_NOT_APPROVABLE`; no ledger/tombstone lookup is used. | false |
| `QUOTE_VALIDITY_INVALID` | An **unpublished** candidate fails Canonical quote validity-window shape/publication checks: caller-owned/null/infinite timestamps, `computed_at >= expires_at`, non-positive/overlong duration, or `computed_at` later than the fresh publication clock. Nothing is published or repaired. A malformed already-persisted quote/order window is `DELIVERY_ORDER_STATE_INCONSISTENT`, not this candidate-input outcome. | false |
| `QUOTE_EXPIRED` | A quote with an otherwise valid canonical validity window has crossed `expires_at` on the fresh authoritative wall clock; obtain a fresh quote. Checked at Order-creation step 5c and **again at step 5f against the one fresh `t` that stamps `created_at`** (the quote can lapse in the check-to-INSERT gap). Also raised at **Quote publication** after static/future-window validation when the candidate expires while publication waits on locks. Timestamps are never extended. | false |
| `QUOTE_STALE` | The presented quote for this draft was invalidated by a confirmed-input / destination-point / cargo-quantity / resolved-pickup change after it was priced **and is not superseded** — step 4c, or the creation-branch fingerprint recompute (step 5d). Obtain a fresh quote. | false |
| `CARGO_CATEGORY_UNKNOWN` | A cargo category code is not in the server policy vocabulary. | false |
| `CARGO_NOT_DELIVERABLE` | Cargo category set contains a non-deliverable category (e.g. `ALCOHOL`). | false |
| `DELIVERY_ORDER_ALREADY_EXISTS` | Recovery replay; resolves to the existing order (any state, incl. `CANCELED`). | false |
| `DELIVERY_APPROVAL_QUOTE_CONFLICT` | Draft is `APPROVED`, `order.merchant_id == M`, but its order is for a different `quote_id` than the one presented. | false |
| `DELIVERY_ORDER_STATE_INCONSISTENT` | An integrity fault (alert, zero writes): `APPROVED` draft with no order; any **Existing-order integrity** failure on recovery/cancellation (source draft/status/tenant; an `APPROVED` draft whose retained `latest_published_quote_id` is null or differs from the order's `quote_id`; missing **or malformed** recipient snapshot; null/mismatched pickup ID or `pickup_snapshot`, or a pickup not owned by the order's merchant; cross-draft quote; invalid historical approval-membership tuple; a null/unknown approval channel; an invalid historical channel identity/binding tuple; a `MERCHANT` cancellation with a null/unknown channel, null `cancellation_provenance`, or a cancellation pair null when its channel requires it, non-null when its channel/source requires null, or not owned by the stored merchant/user/channel; **or the order's snapshots / copied quote fields not matching the referenced quote — `F(immutable order snapshots) != order.delivery_input_fingerprint`, `order.delivery_input_fingerprint != quote.delivery_input_fingerprint`, a copied `quote_amount` / `quote_currency` / `quote_computed_at` / `quote_expires_at` `!=` the referenced quote's immutable value, or an uncanonicalizable corrupted historical snapshot**); a **null / unknown / non-approvable stored `quote_state`** (a historical-value check, never a live-state comparison); a **missing or mismatched `cargo_policy_version` / `cargo_policy_decision`** — the stored decision not reproducible from the immutable `cargo` under that stored version's own retained definition, or a category set that version marks non-deliverable (a backfilled `DELIVERABLE` does not pass); a **secondary-writer `delivery_order` whose existence contradicts its source draft's status** (`APPROVED` ⇔ exactly one order — rejected at commit by the deferred coupling constraint-trigger pair, and surfaced here if pre-existing); a **`created_at`** that is null or does **not** historically precede both immutable deadlines (`order.quote_expires_at`, `source_draft.expires_at`); a **`CANCELED` order with a null `cancellation_authority`**, or one whose `MERCHANT` / `DISPATCH_EXECUTION` source does not match its references (a `MERCHANT` cancel missing its non-null closed channel, non-null provenance or verified tuple; a `DISPATCH_EXECUTION` with non-null merchant provenance/tuple or an unverifiable compensation reference); or a non-`CANCELED` row with non-null cancellation evidence; or a `QUOTED` draft whose marker quote is non-approvable at creation step 5c. (Separately, at INSERT / transition time: a new `delivery_order` not in `PENDING_DISPATCH`, an illegal `delivery_draft` state transition, a confirmed-intent edit that leaves the draft `QUOTED` on the same marker or changes terminal intent, a premature or mis-stamped `-> EXPIRED`, a backdated `created_at`, an intake-dedupe `UNIQUE` collision, a cross-tenant `requested_pickup_location_id`, a rewrite of `delivery_draft.merchant_id` or of any intake-tuple component (`adapter_dedupe_token` nulling included), a hard-`DELETE` of a token-backed `delivery_draft`, and an update/re-key/hard-delete of a successfully published quote are rejected by their own row-local/deferred DB guards / constraints — not this recovery-time code.) Existing-order field/relationship checks never run against ORDER ABSENT, and no current quote/membership/identity/pickup eligibility — current status, current cargo policy, expiry-vs-now, or live `quote_state` — is rechecked on recovery; the approved marker/order identity and snapshot ↔ immutable-quote equality above are historical checks and always run. | false |
| `DELIVERY_ORDER_NOT_CANCELABLE` | Order is not `PENDING_DISPATCH` (past the merchant-cancel boundary, or already terminal). | false |
| `CARGO_POLICY_TRANSITION` | Creation-branch approvals are temporarily halted for a coordinated cargo-policy-version activation (invariant 5). Retry after activation completes. | true |
| `DELIVERY_APPROVAL_INPUT_INVALID` | Approval preflight 0a/0c: non-record payload, malformed required pair or extra payload fields. Priority is 0a, then missing-quote 0b, then remaining-shape 0c. No domain lookup, lock or writes. | false |
| `DELIVERY_DRAFT_INPUT_INVALID` | Caller timestamps/TTL at draft insertion, **blank/whitespace or non-canonical bounded intake-dedupe components when present**, or malformed/extra abandonment payload fields. Rejected before domain writes; `NULL` dedupe token remains the permitted tokenless case; no authority is conferred. | false |
| `DELIVERY_DRAFT_NOT_ABANDONABLE` | After the locked actor gate and coupling check, the draft is consistently APPROVED with its order. Abandonment cannot cancel that order. Zero writes. | false |
| `DELIVERY_CANCEL_INPUT_INVALID` | Cancellation step 0: non-record payload; missing/non-string/malformed UUID `order_id`; missing/null/non-string/blank/oversized/unsupported canonical `cancel_reason`; or any extra timestamp/actor/merchant/channel/provenance/source field. Rejected before any domain lookup, lock or write. A well-shaped unknown/foreign UUID retains the opaque `DELIVERY_ORDER_NOT_FOUND` flow; stored-row corruption instead fails Existing-order integrity. | false |
| `QUOTE_MONETARY_INVALID` | Unpublished quote candidate fails Canonical monetary boundary. Nothing is published or silently rounded. Malformed already-persisted quote/order money is an integrity fault, not this candidate-input outcome. | false |
| `DELIVERY_ORDER_DEPENDENCY_FAILED` | Authoritative persistence/dependency failed. | true |

Downstream Dispatch/Execution contracts may define stronger operation-specific
codes; they may not downgrade the order-creation gate to a context lookup.

## Downstream boundary

| Slice | Owns |
| --- | --- |
| `BD-MERCHANT-QUOTE-AUTHORITY-01A` | Quote computation, reprice, surge, `expires_at` duration, quote lifecycle. Owns the canonical input definition consumed here. Must satisfy **Quote boundary contract**, including immutable quote/draft ownership, shared draft serialization, atomic maintenance of `delivery_draft.latest_published_quote_id`, trusted immutable `published_at` evidence that lets approval distinguish successfully published history from unpublished candidates, retention and hard-delete protection of every successfully published same-draft quote row without a ledger/tombstone, locked publication-time candidate validation against merchant/default/pickup inputs, and recipient/resolved-point/canonical-cargo preconditions. No external computation is required under DB locks. |
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

- The draft may record canonical cargo lines whose **category projection** is
  `{ COOKED_CRAYFISH, ALCOHOL }` as stated intent. Each line has a valid positive
  quantity and a unit from the shared configured vocabulary; the category
  projection shown here is not the stored cargo representation.
- Given otherwise valid creation inputs, cargo shape passes step 5b, then the
  policy rejects the mixed set with `CARGO_NOT_DELIVERABLE`. No `delivery_order`.
- Correct merchant action: split — one deliverable order for the crayfish, wine
  stays `IN_STORE_ONLY`. BazarDrive does not dispatch a driver for alcohol.

### Example C: live crayfish is deliverable

```text
cargo = [ { category_code: LIVE_CRAYFISH, quantity: 2, unit: KG } ]
```

- Given otherwise valid creation inputs and a canonical 2-KG line, order
  creation succeeds (`LIVE_CRAYFISH` = `DELIVERABLE`).
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

- The trusted edit transaction null-safely detects the confirmed-input change,
  atomically drops d1 `QUOTED -> OPEN` and invalidates q1 while retaining
  `latest_published_quote_id = q1`. A direct `QUOTED -> QUOTED` edit is rejected.
  Approving `(d1, q1)` — no order, marker still q1 — reaches **step 4c** →
  `QUOTE_STALE`, zero writes. A fresh q2 publication atomically moves the marker;
  the order then snapshots B and q2.

### Example M: an invalidated quote that has also been superseded

```text
q1 priced for address A ; edit -> B (q1 invalidated, d1 -> OPEN) ;
q2 priced (d1 -> QUOTED, q1 now superseded) ; cleanup tries to hard-delete q1 ;
delete rejected ; edit -> C (d1 -> OPEN) ;
approval of the old (d1, q1) arrives
```

- q1 and q2 remain retained same-draft published rows; the quote-owned guard
  rejects cleanup's hard-delete even though q2 has replaced q1 as the marker.
  No order exists for `(d1, q1)`. Step 4 priority: d1 is not terminal (4a);
  `latest_published_quote_id = q2`, so q1 is an own quote different from the
  durable publication winner → **step 4b** fires →
  `QUOTE_SUPERSEDED`, zero writes, d1 stays `OPEN`. Staleness (step 4c) is **not**
  reached even though q1 is also input-stale. The merchant must approve the
  marker quote — here q2 is itself now input-stale for address C, so a fresh q3
  priced for C is required.

### Example K: store address edited between quote and approval (race)

```text
q1 priced against pickup location L (address X) ; merchant edits L's address to Y,
same merchant_location_id ; approves (d1, q1) before the draft revert propagates
```

- Assume the actor/tenant and step-4 gates have passed (in particular, the
  draft is not expired). The draft is still `QUOTED` with q1 its current,
  non-superseded quote, so the **creation branch** runs. The address edit clears
  or invalidates the old source-bound `resolved_pickup_point` (invariant 4).
  **Without a valid point for Y already persisted, step 5a returns
  `DELIVERY_PICKUP_UNRESOLVED`** before fingerprint comparison; no order.
- **If a trusted resolver has already persisted a valid, source-consistent
  point for Y before approval**, and the draft is still `QUOTED` as in the
  trace, step 5a may pass. With the other earlier creation checks also passing,
  step 5d recomputes the fingerprint over the **stored, locked**
  `pickup_snapshot` (address Y + its resolved point) — it no longer equals q1's
  fingerprint (address X) → `QUOTE_STALE`, no order. Approval never geocodes
  or invents provenance; the resolver-persist procedure is a separate prior
  operation under the existing lock protocol. A fresh quote against the valid
  resolved pickup for Y is required.
- Once the `QUOTED -> OPEN` revert has propagated, the same approval resolves
  at **step 4c** → `QUOTE_STALE` without entering step 5a, provided the earlier
  gates pass and q1 still equals `latest_published_quote_id`. The expiry pre-gate
  still wins for a due draft; if the draft is not due but the marker differs from
  q1, step 4b wins.
  These are the established step-4 priorities, not alternative pickup checks.

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
  locks for `B` and re-resolves the gate **for `B`** — `U` has no ACTIVE
  membership for `B` (the gate resolving `A`, U's sole operable merchant, is just
  one of the ways it can fail for `B`). Internally that is
  `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`, **before
  recovery**; the **client-facing code is `DELIVERY_DRAFT_NOT_FOUND`** (the same a
  nonexistent `draft_id` returns), so `U` cannot probe whether `B`'s draft
  exists. `B`'s draft and order are never read or written under `U`'s authority
  (Example AC; race rows 10, 58).

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
authorized actor ; d1 is QUOTED ; latest_published_quote_id = q1 ; q1 approvable + unexpired ;
no delivery_order exists for d1
```

- Step 3 reads no order for `d1` → **ORDER ABSENT**. `d1.status` is `QUOTED`, not
  `APPROVED`, so it is **not** an integrity fault — control passes to **step 4**.
  Step 4: `d1` is not terminal (4a), `q1` is not superseded (4b) and not stale
  (4c), and `d1` is `QUOTED` with marker q1 → **step 4e → creation branch
  (step 5)**. With 5a–5e satisfied (coordinate-bearing same-merchant pickup,
  mandatory recipient fields present, `clock_timestamp() < q1.expires_at`,
  quote state approvable, cargo shape valid, fingerprint matches, cargo
  `DELIVERABLE`), step 5f inserts one `delivery_order`
  and flips `d1 -> APPROVED`. Creation is still reached **only** from a `QUOTED`
  draft.

### Example S: recovery preserves valid historical authority

- Draft d1 is `APPROVED`; o1 has its one **well-formed** recipient snapshot, a
  non-null pickup ID + `pickup_snapshot` owned by the stored merchant, and a
  quote whose immutable owner is d1. It was approved through a channel actor, so
  it also carries the exact `approved_external_contact_identity_id` /
  `approved_merchant_contact_binding_id`. `F(o1's immutable snapshots)` equals
  `o1.delivery_input_fingerprint` equals the referenced quote's stored
  fingerprint, and o1's copied amount/currency/computed_at/expires_at equal the
  referenced quote's immutable values. Its historical approval membership,
  identity and binding all belong to the stored merchant/user but are now
  `REVOKED`; the pickup location has since been `ARCHIVED` and its address
  edited; the quote has expired and the current cargo policy has changed. o1 is
  `CANCELED` with its cancellation provenance preserved.
- A currently authorized caller passes the normal tenant-bound authority gate.
  ORDER PRESENT passes **Existing-order integrity** (immutable historical links,
  pickup ownership, well-formed child, **and the snapshot ↔ immutable-quote
  fingerprint / copied-field equality**) and the presented quote matches. Return
  o1, zero writes, without original-membership/identity/binding status, pickup
  re-resolution, snapshot-vs-**current**-location comparison, current quote
  eligibility, expiry-vs-now, current cargo policy, or live-`quote_state`
  re-validation.
- If the child is missing or malformed, `pickup_location_id` / `pickup_snapshot`
  is null or names another merchant's location, the quote belongs to d2, the
  stored approval membership belongs to another user/merchant, the stored
  channel identity/binding does not belong to the stored merchant/user/channel,
  **or a recompute of `F(o1's snapshots)` no longer matches
  `o1.delivery_input_fingerprint` / the referenced quote's fingerprint, or a
  copied quote amount/currency/computed_at/expires_at differs from the referenced
  quote** — the same request returns `DELIVERY_ORDER_STATE_INCONSISTENT` before
  quote-match recovery; zero writes.

### Example T: a different operator cancels

- Operator A approved o1. Operator B is currently authorized for its merchant.
  o1 is `PENDING_DISPATCH`, its source draft is `APPROVED`, and its structural
  integrity passes.
- B's cancellation first passes the zero-I/O closed `{order_id, cancel_reason}`
  preflight, then locks the common authority prefix and o1, validates
  **Existing-order integrity**, and changes o1 to `CANCELED` with B's user,
  exact membership, mandatory closed channel and — for a channel cancellation —
  the exact identity/binding, and bounded procedure/reference, together with the server
  timestamp and reason. A remains the immutable original approver.
- Repeating the cancellation returns `DELIVERY_ORDER_NOT_CANCELABLE` and writes
  nothing; changing the retrying actor cannot replace or re-stamp B's record.
  A non-`APPROVED` source draft instead fails integrity before any transition.

### Example U: an unapproved draft ages out on its deadline

```text
d1 is QUOTED with latest_published_quote_id = q1 ; d1.expires_at is reached ; no delivery_order exists
```

- **Positive (sweep):** the trusted cleanup worker takes `d1` `FOR UPDATE`,
  confirms `d1` is still `QUOTED`, that no order exists for it, and
  `clock_timestamp() >= d1.expires_at`, then atomically sets `d1 -> EXPIRED`,
  `expired_at = clock_timestamp()`, and invalidates `q1`'s eligibility. A later
  approval of `(d1, q1)` hits step 4's pre-(a) deadline check (the draft is
  `EXPIRED`) → `DELIVERY_DRAFT_EXPIRED`, zero writes.
- **Negative (due but not yet swept):** an approval of `(d1, q1)` arrives before
  the worker runs. After the locks, step 4's pre-(a) deadline check sees
  `clock_timestamp() >= d1.expires_at` → `DELIVERY_DRAFT_EXPIRED`, zero writes,
  **before** (a) and the superseded / stale checks (the same code the swept
  case returns). A fresh draft d2 is required; a quote reprice on d1 would
  **not** have extended the deadline.

### Example V: a lock wait crosses the draft deadline (approval and publication)

```text
d1 QUOTED ; d1.expires_at is 5 s away ; a blocking lock is held elsewhere for ~30 s ;
the delivery inputs do not change during the wait
```

- **Approval (creation branch):** the transaction blocks ~30 s on the step-5a
  pickup `merchant_locations` lock behind a concurrent default switch, acquires
  it, then step 5c re-reads `clock_timestamp()` (not the fixed transaction-start
  time): `clock_timestamp() >= d1.expires_at` → `DELIVERY_DRAFT_EXPIRED`, zero
  writes, no order. A transaction-start timestamp would have wrongly created the
  order from an aged-out draft.
- **Quote publication:** a candidate quote for `d1` was priced with 5 s to the
  deadline; publication then blocks ~30 s on the `merchants(M)` / selected-pickup
  lock. It acquires the locks, re-resolves the pickup and `resolved_pickup_point`,
  and the priced-candidate comparison **passes** (inputs unchanged) — but its
  step-5 post-lock `clock_timestamp()` re-read sees `clock_timestamp() >=
  d1.expires_at` → `DELIVERY_DRAFT_EXPIRED`, **zero writes**: neither the
  quote/fingerprint nor the draft quote state is published on the aged-out draft.
  This is why the early step-1 deadline check is not enough (race row 54).
- (Had `d1` already been `APPROVED` with its order, it would never have been
  swept, and a recovery of that order ignores the draft deadline entirely —
  Example S.)

### Example W: cancellation of an unknown or cross-tenant order

```text
(1) actor cancels order_id that names no delivery_order
(2) actor for merchant A cancels merchant B's real, pending order_id
```

- **(1) ORDER ABSENT:** step 1's hint read finds no row → **early
  `DELIVERY_ORDER_NOT_FOUND`, zero writes, without taking any authority lock** —
  there is no `draft_id` / `merchant_id` to build a prefix from.
- **(2) ORDER PRESENT, caller unauthorized:** the hint read yields candidate
  `(draft_id, merchant_id = B)`; step 2 **does** take the shared authority prefix
  (`d_B` → membership → `merchants(B)` → …); step 3 re-resolves the gate for `B`,
  `A`'s actor has no ACTIVE `B` membership → the internal decision is
  **unauthorized** (recorded as the reason), and the **client-facing** code is
  the same `DELIVERY_ORDER_NOT_FOUND` so `A` cannot probe `B`'s order existence.
  No transition, zero writes.
- **Gate passed:** an order that exists and whose caller passes the step-3 gate
  runs the full post-authorization **Existing-order integrity** check, then the
  status gate (Example T).

### Example X: legacy / stale / swapped resolved pickup point

```text
L is ACTIVE, merchant_id == M, has lat/lng
(a) L.resolved_pickup_point IS NULL
(b) L.resolved_pickup_point present but its source binding no longer matches L's current address
(c) a backfill leaves address + lat/lng equal but swaps the provider/place id + provenance
```

- **(a) / (b):** a quote cannot attach and approval/publication cannot proceed —
  step 5a and Quote publication check the stored `resolved_pickup_point` is
  present, shape-valid **and consistent with L's current address/coordinates** →
  `DELIVERY_PICKUP_UNRESOLVED`. No provenance is guessed from L's bare
  coordinates. The trusted resolver-persist procedure runs first — under the
  `draft -> [authority prefix] -> merchant -> location` locks — writes
  `L.resolved_pickup_point` (coordinates + provider/place id + provenance + the
  source address it resolved from), and quoting then proceeds. If M later edits
  L's address, the stale point is cleared/invalidated and any attached quote
  stales via the pickup-content fingerprint rule (Example K).
- **(c) on a persisted order:** the full `resolved_pickup_point` is a member of
  the canonical fingerprint input list, so the recompute in **Existing-order
  integrity** yields `F(order snapshots) != order.delivery_input_fingerprint`
  (or `!= quote.delivery_input_fingerprint`) → `DELIVERY_ORDER_STATE_INCONSISTENT`,
  zero writes — a provider/place or source-binding swap is not invisible even
  with an unchanged address and lat/lng.

### Example Y: backfilled order contradicts its draft or its quote state

```text
(1) a writer inserts a PENDING_DISPATCH delivery_order for a still-QUOTED draft
(2) a writer inserts an order that copies every quote field + both fingerprints
    correctly but sets quote_state = INVALIDATED
```

- (1) The deferred draft/order coupling constraint-trigger pair rejects the
  transaction at commit (`APPROVED` ⇔ exactly one order). Had it somehow
  pre-existed, recovery / cancellation would fail **Existing-order integrity** →
  `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes.
- (2) The `quote_state` `NOT NULL` + `CHECK` rejects the write; a pre-existing
  such row fails the Existing-order integrity stored-`quote_state` check →
  `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. A correctly-approved
  historical order — valid `quote_state`, matching fingerprints and copied quote
  fields — still recovers with zero writes (Example S).

### Example Z: backfilled alcohol order, a mid-activation backfill, and a later policy change

```text
(1) a writer inserts a consistent order whose cargo set is { COOKED_CRAYFISH, ALCOHOL },
    cargo_policy_decision = DELIVERABLE, cargo_policy_version = <some activated version>
(2) a backfill order-creation transaction that evaluated cargo under version vN is still
    OPEN when an activation to vN+1 begins
(3) after a correct historical order was approved, the active cargo policy later changes
```

- **(1)** The trusted `INSERT` validator derives `{ COOKED_CRAYFISH, ALCOHOL }`
  from `NEW.cargo`, evaluates it under the activated version's definition, gets
  `NOT_DELIVERABLE`, and rejects the row — the backfilled `DELIVERABLE` decision
  does not bypass it. A pre-existing such row fails **Existing-order integrity**'s
  stored-decision re-check → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes.
  Alcohol never reaches an authoritative order (invariant 5).
- **(2)** Activation step 1 has already stopped admitting new inserts; step 2
  **drains that open backfill transaction to COMMIT or ROLLBACK** (backfills are
  in scope, not just approvals), and step 3 confirms the drain before `vN+1` is
  switched on and inserts resume. So the backfill either commits fully under
  `vN` (and is then a normal historical row, re-checkable against `vN`'s retained
  definition) or rolls back — it can never straddle `vN` / `vN+1`.
- **(3)** Recovery of the earlier correct order re-checks its **stored**
  `cargo_policy_version` / `cargo_policy_decision` against that version's retained
  definition — which still says `DELIVERABLE` — so it recovers unchanged; the
  new active policy is not applied to it (cf. Example S; race rows 48, 55).

### Example AA: abandoned draft cannot be resurrected

```text
d1 is ABANDONED (well before its deadline) ; a repository bug UPDATEs d1.status back to QUOTED ;
an authorized actor then approves (d1, q1)
```

- The row-local `delivery_draft` transition guard rejects `ABANDONED -> QUOTED`
  (an absorbing state), evaluating the `OLD -> NEW` pair even mid-transaction, so
  the resurrecting `UPDATE` never commits and no order is created. The deferred
  coupling (race row 49) would **not** have caught this — a hypothetical
  `APPROVED` d1 with its one order satisfies it. A genuinely new delivery is a
  **new draft**.

### Example AB: order cannot be born past `PENDING_DISPATCH`

```text
a backfill inserts a consistent delivery_order directly as status = SEARCHING_DRIVER,
and flips its draft to APPROVED
```

- The row-local `BEFORE INSERT` guard on `delivery_order` permits a new row only
  in `PENDING_DISPATCH`, so the insert is rejected. Dispatch's lawful
  `PENDING_DISPATCH -> SEARCHING_DRIVER` `UPDATE` on an already-created order, and
  recovery of an existing `CANCELED` / `DELIVERED` order, are unaffected — the
  guard fires only on `INSERT`, adds no cross-table lock, and is not a permanent
  `CHECK`.

### Example AC: cross-tenant approval probe is masked

```text
actor U is an ACTIVE OPERATOR of merchant A only ;
(1) U approves a random / nonexistent draft_id ;
(2) U approves a leaked (d_B, q_B) whose delivery_draft.merchant_id = B, and U has
    no membership for B at all (the gate does not "resolve some other merchant" —
    it simply finds no ACTIVE (B, U) membership)
```

- **(1)** Step 1 finds no row → external `DELIVERY_DRAFT_NOT_FOUND`, zero writes,
  before any authority lock.
- **(2)** Step 1 locks `d_B` and sets `M := B` **from the locked draft**; step 2
  re-resolves the actor gate **for `B`** and finds no ACTIVE `(B, U)` membership —
  the gate fails. Internally that is `MERCHANT_MEMBERSHIP_REQUIRED` (logged); the
  external code is the **same `DELIVERY_DRAFT_NOT_FOUND`** returned in (1), so `U`
  cannot tell (1) from (2). Any other locked-gate failure for `B` (role miss,
  `merchants(B)` not `ACTIVE`, gate resolving only `A`, channel identity/binding
  mismatch) is masked identically. `B`'s draft and any order are never read or
  written under `U`'s authority. Mirrors cancellation Example W.

### Example AD: quote expires during the publication lock wait

```text
candidate quote q priced for d1 with 5 s to q.expires_at ; d1.expires_at is 20 min away ;
publication blocks ~30 s on the merchants(M) / pickup lock ; inputs unchanged
```

- Publication acquires the locks, re-resolves pickup + `resolved_pickup_point`,
  the priced-candidate comparison **passes**. Step 5 then takes one post-lock
  `t = clock_timestamp()`: `t < d1.expires_at` (draft still valid) but
  `t >= q.expires_at` → **`QUOTE_EXPIRED`, zero writes** — q is not published, its
  `expires_at` is not extended. The draft stays `OPEN`/`QUOTED` as it was; a
  fresh candidate must be priced. Without step 5b, `d1` would go `QUOTED` with an
  already-expired q and every immediate approval would fail `QUOTE_EXPIRED`.

### Example AE: creation-time deadline, backdating, and a much later recovery

```text
d1 QUOTED, latest_published_quote_id = q1 ; at step 5c q1.expires_at is ~10 s away and
d1.expires_at ~40 s away ; after 5c the creation txn spends ~30 s in fingerprint
recompute + cargo-policy validation (5d-5e) before the final step-5f clock read ;
no new lock is taken after 5c ; inputs unchanged
```

- **Only the quote lapses in the compute gap** (`q1.expires_at` passed, `d1`
  still in the future): step 5f takes one fresh `t = clock_timestamp()`;
  `t < d1.expires_at` passes, then `t >= q1.expires_at` → **`QUOTE_EXPIRED`,
  rollback, no order**. Nothing is written; `q1`'s / `d1`'s timestamps are not
  extended.
- **Both deadlines lapse in the compute gap** (variant — `d1.expires_at` also
  near, or a longer 5d-5e gap): step 5f checks the draft first —
  `t >= d1.expires_at` → **`DELIVERY_DRAFT_EXPIRED`, rollback, no order** (the
  draft check precedes the quote check, so it reports first even though `q1` is
  also past). Nothing is written.
- **Both deadlines still in the future:** step 5f stamps
  `o1.created_at := t` (`t < q1.expires_at` and `t < d1.expires_at`), inserts
  `o1` as `PENDING_DISPATCH`, flips `d1 -> APPROVED`.
- **Backfill after expiry:** a writer inserts a structurally consistent `o2` for
  another draft **after** its quote expired, with a plausible `created_at`. If it
  reaches the DB at all it goes through the trusted boundary and fails the fresh
  `t < deadline` check; a pre-existing such row fails **Existing-order
  integrity**'s historical `created_at < each immutable deadline` check →
  `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes. A supplied future
  `created_at` is rejected by the boundary and is immutable thereafter.
- **Much later recovery of `o1`:** months on, both `q1.expires_at` and
  `d1.expires_at` are long past and the original approval membership is
  `REVOKED`. Recovery re-runs Existing-order integrity: the **historical**
  relation `o1.created_at < each immutable deadline` still holds, the immutable
  tuples still match — so `o1` recovers with zero writes. Current time and the
  approver's current eligibility are **not** consulted (Example S).

### Example AF: only the trusted boundary creates an order; revoked actor blocked

```text
a batch/backfill job has an INSERT-capable connection and tries to write a
delivery_order directly, referencing a tuple-correct but REVOKED (M, U) membership
```

- **No direct `INSERT` path.** Ordinary writer roles hold **no** `INSERT` on
  `delivery_order`; the only path is the trusted transactional creation procedure
  (a future schema `GRANT` dependency). Called with a *trusted* actor context, it
  derives `M` from the locked draft and re-checks the merchant `ACTIVE`,
  `(M, U)` membership ACTIVE + allowed role, and (channel) identity `VERIFIED` +
  binding, writing provenance from that re-checked result — never from passed IDs
  or a "verified" flag.
- **Statically `REVOKED` tuple:** the re-check finds the `(M, U)` membership
  `REVOKED` (or the channel identity / binding revoked / unverified) →
  `ROLLBACK`, no order.
- **Revoke-first race:** the revocation `UPDATE` commits *before* the procedure
  acquires the prefix locks. The procedure then waits on the membership row lock,
  and its step-2/3 reads observe the committed negative state → `ROLLBACK`, no
  order (internal `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_INOPERABLE` /
  `MERCHANT_ACTOR_UNAUTHORIZED`; external `DELIVERY_DRAFT_NOT_FOUND` per
  CORRECTED15 masking).
- **Creation-first race:** the procedure already holds the prefix locks and its
  re-check still sees the grant valid; it stamps `created_at := t`, inserts the
  order as `PENDING_DISPATCH`, flips the draft `-> APPROVED`, and commits. The
  revocation `UPDATE` was blocked on the membership row lock and commits only
  afterwards, against the now-existing order. That order is authoritative and
  later recovers on the **historical no-recheck** path — recovery never
  re-evaluates the original approver's current eligibility (Example S).

### Example AG: cancellation source is explicit

```text
(1) a secondary writer sets o1.status = CANCELED, leaving the merchant tuple null
(2) it sets cancellation_authority = DISPATCH_EXECUTION with no verifiable reference,
    or with cancellation_provenance non-null
(3) it leaves status non-CANCELED but writes cancellation_provenance
(4) a legitimate merchant cancel through step 5
```

- **(1)** `cancellation_authority` is `NULL` on a `CANCELED` row → **Existing-order
  integrity** cancellation-source check fails → `DELIVERY_ORDER_STATE_INCONSISTENT`,
  zero writes. A null `cancellation_channel` no longer reads as "legitimate
  compensation".
- **(2)** `DISPATCH_EXECUTION` with no present, verifiable compensation reference
  tied to `o1.id`, or with non-null merchant-only `cancellation_provenance`, fails
  the same check; and this slice offers no path for an
  ordinary writer to set that source — the downstream contract and its backstop
  do not exist yet.
- **(3)** A non-`CANCELED` row must carry no cancellation evidence; the total
  source-shape constraint rejects the stray provenance rather than relying on a
  nullable equality.
- **(4)** Step 5 sets `cancellation_authority = MERCHANT` atomically with the
  full verified merchant provenance tuple, including a non-null
  `SESSION`/`WHATSAPP`/`SMS` discriminator and non-null bounded
  `cancellation_provenance` from the locked proof path, write-once;
  recovery of the `CANCELED` `o1` then passes the source/channel check (Example T).

### Example H: end-to-end ("Морской Разливной")

```text
WhatsApp message
    -> persisted delivery_draft            (non-authoritative)
    -> Quote Authority
    -> QUOTED
    -> AUTHORIZED_MERCHANT_ACTOR confirms (draft_id, quote_id)
    -> step 0: validate the record and required pair, no domain read/lock
         absent/null/blank quote_id -> QUOTE_REQUIRED; other bad shape -> DELIVERY_APPROVAL_INPUT_INVALID
    -> [ single transaction ]
         (channel actor) non-authoritative discovery: canonical identity -> candidate U
         lock: delivery_draft -> merchant_membership(M,U) -> merchants(M)
               -> ext identity -> binding   (FOR UPDATE, fixed order; M := locked draft.merchant_id)
         tenant-bound access check (recovery + creation): AUTHORIZED_MERCHANT_ACTOR(U, M)
               re-verified under the locks (locked linked_user_id == candidate U)
               ; ANY locked-gate failure for M (no membership / role / merchants(M) /
                 another-merchant / identity-binding) -> external DELIVERY_DRAFT_NOT_FOUND
                 (true MERCHANT_*/CONTACT_* reason internal only); missing draft -> same code
         step 3: read the single order for draft_id (UNIQUE (draft_id)); split on order existence:
           ORDER ABSENT:
             draft.status == APPROVED  -> DELIVERY_ORDER_STATE_INCONSISTENT
             else                      -> step 4        (no existing-order field is inspected here)
           ORDER PRESENT (integrity BEFORE quote match):
             Existing-order integrity fails (source, snapshot, quote owner, approval tuple)
                                       -> DELIVERY_ORDER_STATE_INCONSISTENT   (even on exact-pair match)
             else order.quote_id == presented quote_id
                                       -> recovery: return it, 0 writes (any state incl CANCELED)
             else                      -> DELIVERY_APPROVAL_QUOTE_CONFLICT
         step 4 (ORDER ABSENT, draft not APPROVED) ordered priority (all 0 writes):
           draft.expires_at passed (post-lock clock) -> DELIVERY_DRAFT_EXPIRED   (before a/b)
           terminal draft                       -> DELIVERY_DRAFT_NOT_APPROVABLE
           successfully published own quote_id != latest marker -> QUOTE_SUPERSEDED
           OPEN + published own quote_id == marker, invalid     -> QUOTE_STALE
           same-draft unpublished candidate / other non-match   -> DELIVERY_DRAFT_NOT_APPROVABLE
           QUOTED + quote_id == latest marker    -> creation branch:
             5a lock pickup merchant_locations row (after merchants(M); creation only)
                pickup ACTIVE, merchant_id == M, coords + resolved_pickup_point present
                (else MERCHANT_LOCATION_REQUIRED / DELIVERY_PICKUP_UNRESOLVED)
             5b re-check recipient_contact + destination_text + destination_point + canonical cargo
                (else DELIVERY_RECIPIENT_INCOMPLETE / DELIVERY_DESTINATION_UNRESOLVED /
                 DELIVERY_CARGO_LINE_INVALID)
             5c draft.expires_at re-check (post-lock; else DELIVERY_DRAFT_EXPIRED),
                quote_id == latest_published_quote_id and quote explicitly approvable
                (else QUOTE_SUPERSEDED / DELIVERY_ORDER_STATE_INCONSISTENT);
                snapshot the verified quote_state;
                then clock_timestamp() < quote.expires_at (post-lock; else QUOTE_EXPIRED)
                then canonical monetary shape (else DELIVERY_ORDER_STATE_INCONSISTENT)
             5d recompute delivery_input_fingerprint == quote's (recipient + destination_text + destination_point
                + cargo lines {cat,qty,unit} + locked pickup content incl coords ; else QUOTE_STALE)
             5e cargo policy over category set, replica-active constant (cooked + live crayfish DELIVERABLE)
                -> persist { cargo_policy_version, cargo_policy_decision }; INSERT validator re-derives + confirms
             5f trusted boundary re-checks current actor eligibility on the already-locked prefix rows
                (merchant ACTIVE / membership ACTIVE + role / identity VERIFIED + binding ; else ROLLBACK, no order)
                then one fresh t = clock_timestamp():  t < draft.expires_at (else DELIVERY_DRAFT_EXPIRED)
                                                       t < quote.expires_at (else QUOTE_EXPIRED)
                draft QUOTED -> APPROVED  +  INSERT delivery_order (status = PENDING_DISPATCH, created_at := t,
                                                                    provenance from re-checked gate) (+ recipient snapshot)
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

- **Scoped correction acceptance (review comments 3998885019, 3998885020,
  3998885023, 3998885024, 3998885025):** the following are future verification
  obligations, not executed runtime tests or resolved GitHub threads.
  - Abandonment has a draft-first tenant-derived locked actor gate and protected
    write procedure; coupling/state/deadline ordering, zero-write replay and
    quote invalidation are defined. Races 71-73 and direct-writer denial pass
    before activation; no existing order is canceled by abandonment.
  - Canceled timestamps/reasons are null by status, finite/chronological/bounded
    when present, atomically set and write-once. Legacy malformed history is
    rejected; valid later recovery is unchanged (rows 74-75).
  - Quote and order money have the same non-null canonical shape validation,
    separate from copy equality, at publication/creation/DB/recovery boundaries.
    Concrete shared parameters remain an activation prerequisite, with valid
    historical definitions preserved (rows 76-77).
  - Step 0 produces deterministic request-shape outcomes without domain queries:
    missing quote is QUOTE_REQUIRED, malformed pair is a shape error, and a valid
    pair still enters the existing authorization/recovery algorithm (row 78).
  - Every fresh draft gets one trusted creation instant and a DB-enforced bounded
    fixed TTL. Supplied values and direct-writer bypass fail; dedupe/edits never
    move created_at or expiry. Intake remains non-authoritative (rows 79-80).

- **Fresh scoped correction acceptance (Codex review on `091a07bb`, comments
  4052770519 / 4052770524 / 4052770526):** these are future contract/schema
  verification obligations, not runtime implementation or resolved GitHub threads.
  - Destination resolution is bound to the exact canonical `destination_text`:
    stale/mismatched resolver results cannot publish or create an order; the
    binding is frozen into the recipient snapshot and canonical fingerprint, and
    historical recovery checks only that frozen text↔binding relation (row 81).
  - Intake dedupe components are canonical/bounded/nonblank when present;
    whitespace keys are rejected before uniqueness, secondary writers are DB
    backstopped, canonical nonblank keys dedupe, and `NULL` token remains the
    freely-repeatable tokenless case (row 82).
  - Quote validity windows are server-owned, finite/non-null, positive/bounded
    and publication-time coherent; successful publication durably stamps immutable
    `published_at := t_publish`, malformed/future/overlong candidates fail
    separately from a valid-but-expired quote, and historical recovery verifies
    `computed_at <= published_at < expires_at` plus retained shape/equality
    without today's clock/policy re-evaluation (row 83).

- **Fresh scoped correction acceptance (Codex review on `b3067baf`, comments
  4054046297 / 4054046302 / 4054046306 / 4054046309):** these are future
  contract/schema verification obligations, not runtime implementation or
  resolved GitHub threads.
  - Every successful quote publication atomically moves the draft's durable
    `latest_published_quote_id`; failure/invalidation does not. Equal or
    non-monotonic timestamps cannot change the winner. Approval first proves
    retained same-draft successful publication from immutable non-null
    `published_at`, then classifies that published row as superseded-versus-stale
    from the retained marker; an addressable same-draft candidate whose
    publication never committed reaches step 4d. Every successfully published
    quote row is retained behind a quote-owned hard-delete guard, so q1 remains
    same-draft history after q2 and approval of q1 returns `QUOTE_SUPERSEDED`; no
    ledger/tombstone is introduced (rows 84, 88).
  - Cancellation step 0 accepts exactly `{ order_id, cancel_reason }`, validates
    UUID/reason shape before PostgreSQL/domain I/O, rejects extra authority /
    provenance / timestamp fields, and preserves not-found masking for valid
    unknown/foreign UUIDs (row 85).
  - A `MERCHANT` cancellation has a non-null immutable closed
    `SESSION`/`WHATSAPP`/`SMS` channel and non-null
    `cancellation_provenance` from its locked proof path; `DISPATCH_EXECUTION`
    and non-canceled rows require that merchant provenance null. Source/channel /
    provenance and pair constraints are explicit total branches, with source
    checked before the pair (rows 86, 89).
  - Null-safe intent comparisons reject same-status `QUOTED` and every terminal
    intent rewrite; the trusted path atomically edits + returns to `OPEN` +
    invalidates the retained-marker quote, with a deferred final-state backstop
    and rollback safety (row 87).

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
  taken from the **locked `delivery_draft.merchant_id`**; **any** failure of the
  gate for that `M` (no ACTIVE `(M, U)` membership, role miss, `merchants(M)` not
  `ACTIVE`, a gate that resolves any other merchant, a channel `linked_user_id`
  that no longer equals the discovery `U`, an identity/binding mismatch) yields
  the external code `DELIVERY_DRAFT_NOT_FOUND` — the same a missing draft returns,
  the true `MERCHANT_*` / `CONTACT_*` reason internal only — before recovery. The
  approval transaction is deadlock-free against every **confirmed single-mutation
  01B path**; composite / future mutation callers must adopt the shared
  *lock-every-affected-membership-in-`id`-order-then-`merchants(M)`* protocol —
  a forward obligation, not a universal deadlock-impossibility claim.
- `delivery_draft: QUOTED -> APPROVED` and the `delivery_order` (+ its 1:1
  `delivery_order_recipient_snapshot`) insert are **one atomic transaction**
  (invariant 6) holding all locks: no `APPROVED` draft without an order, no order
  without an `APPROVED` draft, full rollback on any re-validation failure.
- A `delivery_order` has exactly one recipient and one destination — including a
  canonical **resolved `destination_point`** (coordinates + provider/place
  provenance + destination-specific `source_text_binding`) whose binding matches
  the frozen canonical `destination_text` — held in a 1:1 immutable snapshot
  child, not columns and not an address book; the full point is in the
  fingerprint, so stale resolver output or re-geocoding cannot retarget a
  confirmed delivery. Multi-stop batching is a separate downstream entity.
- `delivery_order_recipient_snapshot` immutability is enforced by **its own**
  `BEFORE UPDATE OR DELETE` guard trigger, not the parent `delivery_order`
  trigger (which does not fire on direct child DML); every `UPDATE` / `DELETE`
  against it is rejected. Its **well-formed** existence for every order is
  separately enforced at commit by a deferred constraint plus DB-level `NOT NULL`
  and shape/format constraints on `recipient_contact` / `destination_text` /
  `destination_point`; parent-only or malformed-child insertion fails, while the
  lawful parent-plus-well-formed-child transaction succeeds. A missing **or
  malformed** historical child fails **Existing-order integrity** →
  `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes.
- `delivery_order.draft_id` and `delivery_order.merchant_id` are both `NOT NULL`
  and bound by a **composite FK `(draft_id, merchant_id) -> delivery_draft (id,
  merchant_id)`** (or guard trigger), so a persisted order's merchant can never
  diverge from its source draft's — not two independent single-column FKs.
- The order's quote/draft, approval-membership-ID/merchant/user, pickup
  ID/merchant and — for channel approvals/cancellations — identity/binding tuples
  are bound by the non-null composite links in **Target entity: delivery_order**
  (`pickup_location_id`, `pickup_snapshot` and the channel identity/binding pair
  are `NOT NULL` per their rules; the pair is null for `SESSION`).
  **`approval_channel` is itself `NOT NULL`, immutable, closed to
  `SESSION | WHATSAPP | SMS`** (DB enum or `CHECK` + `NOT NULL`), written from the
  trusted proof path actually verified at insert — never inferred from the pair's
  null-ness, never defaulted. **Existing-order integrity** rejects a null /
  unknown `approval_channel` as `DELIVERY_ORDER_STATE_INCONSISTENT` **before** it
  checks the identity/binding tuple; `cancellation_channel` is independently
  source-dependent: `MERCHANT` requires
  a non-null closed `SESSION | WHATSAPP | SMS` discriminator before its pair is
  checked and non-null `cancellation_provenance`; `DISPATCH_EXECUTION` and
  non-canceled rows require channel, provenance and the remaining merchant tuple
  null.
  Recovery/cancellation run **Existing-order integrity** before success, checking
  these historical links, the pickup relationship, the well-formed child, **and
  that the order's immutable snapshots and copied quote fields match the
  referenced quote** — `F(immutable order snapshots) ==
  order.delivery_input_fingerprint == quote.delivery_input_fingerprint` and the
  copied `quote_amount` / `quote_currency` / `quote_computed_at` /
  `quote_expires_at` equal the referenced quote's immutable published values
  (the quote identity/owner, payload, fingerprint and publication timestamps are
  immutable and the published row is not hard-deleted for the life of a
  `quote_id`; a reprice appends a new retained `quote_id`; the recompute uses the
  algorithm version named on the referenced fingerprint) — without requiring current eligibility of the
  original approval membership, identity/binding, pickup location or quote,
  without re-resolving or re-locking the pickup, and without re-checking current
  status / cargo policy / expiry-vs-now / live `quote_state`. A future DB
  backstop enforces the same equalities, with the snapshot-dependent fingerprint
  check **deferred to commit** so the lawful `INSERT order -> INSERT recipient
  snapshot` sequence still succeeds.
- Pickup resolves from an ACTIVE `merchant_locations` row **owned by the draft's
  merchant, carrying non-null coordinates and a non-null stored
  `resolved_pickup_point`** (coordinates + provider/place provenance + source
  binding; a future nullable `merchant_locations.resolved_pickup_point` column or
  pre-quote snapshot entity, filled by a trusted resolver-persist procedure
  before pricing under the existing `draft -> merchant -> location` locks, never
  a `location -> draft` inversion, never invented from bare coordinates, cleared
  or invalidated by an address/coordinate edit) — approval query + composite FK /
  trigger, not a plain cross-table `CHECK`, **locked in the creation branch (step
  5a) and held through commit**; it is never locked on the recovery path; a null
  coordinate **or** null `resolved_pickup_point` is `DELIVERY_PICKUP_UNRESOLVED`
  (no approval-time geocode); `delivery_order.pickup_location_id` and
  `pickup_snapshot` (carrying the full resolved point + provenance) are both
  `NOT NULL` on the persisted order so no order can be recovered/canceled without
  a merchant-owned pickup, and recovery checks only that frozen copy — never the
  location's current `resolved_pickup_point`; recipient/destination data is never
  written to merchant identity tables and never used as pickup.
- A `delivery_draft` is **always tenant-bound and its tenant is immutable**:
  `merchant_id` is `NOT NULL REFERENCES merchants(id)`, resolved before the
  `INSERT` for every channel and state; intake that cannot resolve a merchant is
  never persisted as a tenantless draft, so the tenant-bound gate and the
  `(merchant_id, …)` intake dedupe key always have a concrete merchant. An
  immediate row-local `BEFORE INSERT OR UPDATE` guard rejects **any**
  `OLD.merchant_id -> NEW.merchant_id` change in every status, for every
  writer/backfill, on each intra-transaction `UPDATE`, so a draft cannot be
  re-tenanted to expose its recipient PII to, or be approved by, another
  merchant's actor.
- The **intake identity of a token-backed `delivery_draft` is durable**: the full
  tuple `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` is
  immutable after `INSERT` (null-safe guard — no component change, no
  `adapter_dedupe_token -> NULL`), and a `BEFORE DELETE` guard rejects a
  hard-delete of any draft with a non-null `adapter_dedupe_token` in any status,
  so a redelivery of the original key always resolves to the original draft in
  its recorded status and cannot resurrect an `ABANDONED` / `EXPIRED` request.
  Tokenless manual drafts stay freely creatable by separate `INSERT`s. Retention
  duration and PII erasure implementation are out of scope; a future erasure
  mechanism must preserve this dedupe guarantee.
- A `delivery_draft` **ages out on a bounded server deadline**: an immutable
  server-derived `expires_at = created_at + TTL` from **Trusted draft-INSERT
  boundary**, with immutable created_at and the exact bounded TTL relationship
  enforced by the database (fixed before intake activation; edits/reprices never
  extend it; independent of quote expiry), and a nullable `expired_at` set only by a trusted sweep worker
  that, under the draft lock, moves a due `OPEN`/`QUOTED` draft with no order to
  `EXPIRED` and invalidates the retained-marker quote's eligibility without
  clearing that marker (never normalizing
  corruption). A due-but-unswept draft is rejected at Order-creation step 4
  (before superseded/stale), re-checked at step 5c, and at Quote publication —
  all on the post-lock authoritative wall clock → `DELIVERY_DRAFT_EXPIRED`. An
  `APPROVED` draft never expires; ORDER PRESENT recovery/cancellation never
  evaluate the deadline.
- **`delivery_draft.status == APPROVED` iff exactly one `delivery_order` exists**
  is a **DB invariant** — a deferred (at-commit) constraint-trigger pair, one on
  each table, checking the final committed rows (never an intermediate
  `NEW.status`): `APPROVED` ⇔ exactly one order in any state (incl. `CANCELED`),
  any other status ⇔ zero. It preserves the lawful `INSERT order -> INSERT
  snapshot -> flip draft APPROVED` sequence and adds no late `delivery_draft`
  lock to a dispatch/cancellation `UPDATE` (non-locking draft read). This closes
  the gap that `Existing-order integrity` — recovery/cancellation only — cannot.
- `delivery_order.quote_state` is **`NOT NULL`**, DB-`CHECK`ed to a closed set of
  approvable snapshot values, and written from the state the creation transaction
  verified at step 5c — never a request field. **Existing-order integrity**
  rejects a null/unknown/non-approvable stored value as
  `DELIVERY_ORDER_STATE_INCONSISTENT`; it is never compared to the quote's live
  state.
- A **legal `delivery_draft` state-transition graph** is enforced by an immediate
  row-local DB guard (separate from and additional to the deferred coupling):
  new `INSERT` only `OPEN`; `OPEN -> { QUOTED, ABANDONED, EXPIRED }`;
  `QUOTED -> { OPEN, APPROVED, ABANDONED, EXPIRED }`; `APPROVED` / `ABANDONED` /
  `EXPIRED` absorbing. It checks every `OLD -> NEW` including successive
  in-transaction UPDATEs, so `ABANDONED` / `EXPIRED` cannot be resurrected. It
  does not replace actor authority, the expiry worker's conditions, or the
  deferred coupling. The same guard compares the exact confirmed-input set
  null-safely: `OPEN` edits remain `OPEN`; `QUOTED` edits must be `QUOTED -> OPEN`;
  terminal intent edits and same-status `QUOTED` edits fail. The trusted
  draft-first mutation transaction also invalidates the retained-marker quote,
  and a deferred cross-table final-state backstop prevents a false quoted state.
- A **new `delivery_order` is born only in `PENDING_DISPATCH`** — a row-local
  `BEFORE INSERT` DB guard (`NOT NULL`; a column `DEFAULT` is insufficient). It is
  **not** a permanent `CHECK (status = 'PENDING_DISPATCH')`: lawful downstream
  `UPDATE`s and recovery of existing `CANCELED` / `DELIVERED` rows are preserved;
  no cross-table lock is added.
- The order carries **immutable, non-null `cargo_policy_version` and
  `cargo_policy_decision`**, and a **trusted `INSERT` validator** (from the same
  immutable policy definition the server resolver uses — still a versioned
  constant, no admin store) re-derives the category set from `NEW.cargo`,
  evaluates it under the **activated** version, and rejects a stored
  version/decision that does not actually clear those categories (a backfilled
  `DELIVERABLE` does not pass). **Existing-order integrity** re-checks the stored
  decision against that version's **retained** definition — historical, not the
  current constant. `resolveCargoDeliveryPolicy` / the decision are **not** in
  the canonical quote-input fingerprint. The coordinated policy-version
  activation spans resolver **and** validator and all order writers, and its
  drain step covers **every already-started order-creation transaction —
  approval, secondary writers and backfills** — to COMMIT/ROLLBACK: the version
  is not switched, and new inserts are not resumed, until that drain and its
  confirmation are done.
- On approval, **any** failure of the step-2 locked actor gate for the locked
  draft's `M` — no ACTIVE `(M, U)` membership, role miss, `merchants(M)` not
  `ACTIVE`, gate resolving another merchant, channel identity/binding mismatch —
  and a **nonexistent `draft_id`** both return the **same external code
  `DELIVERY_DRAFT_NOT_FOUND`**, zero writes, so no caller (for `M` or any other
  merchant) can probe draft existence — **no own-merchant exception**. The true
  reason (`MERCHANT_ACTOR_UNAUTHORIZED` / `MERCHANT_MEMBERSHIP_REQUIRED` /
  `MERCHANT_INOPERABLE` / `CONTACT_*`) is internal, logged. Tenant derivation from
  the locked draft and the authority locks (run before recovery/creation) are
  unchanged; the frozen Identity/Contact resolver is not modified — only the
  response mapping at this call site.
- **Quote publication** enforces the full Canonical quote validity-window
  boundary. After static finite/non-null/order/bounded-duration validation it
  takes one post-lock `t_publish = clock_timestamp()` immediately before the
  atomic publish: draft deadline crossed → `DELIVERY_DRAFT_EXPIRED`;
  `candidate_quote.computed_at > t_publish` → `QUOTE_VALIDITY_INVALID`; otherwise
  `t_publish >= candidate_quote.expires_at` → `QUOTE_EXPIRED`. Success atomically
  stamps immutable **`quote.published_at := t_publish`** with the quote payload and
  draft quote state. Publication is zero-write on failure and never repairs or
  extends candidate timestamps; historical recovery verifies
  `computed_at <= published_at < expires_at` under the retained rule/version and
  never re-checks expiry against the current clock.
- **Order creation stamps an immutable, non-backdatable `created_at` from one
  fresh server `clock_timestamp()` `t`** (step 5f), and requires
  `t < delivery_draft.expires_at` (`DELIVERY_DRAFT_EXPIRED`) then
  `t < referenced_quote.expires_at` (`QUOTE_EXPIRED`) — both re-checked here
  because either can lapse between step 5c and the `INSERT`. `t` is the
  server-defined creation moment, not `COMMIT`; the rule applies to every new
  `INSERT`, backfills included. **Existing-order integrity** checks only the
  *historical* relation `created_at < each immutable deadline`, never against the
  current clock, so a correctly-created order recovers however long after both
  deadlines have passed.
- **Every new `delivery_order` is created through one trusted transactional
  creation procedure** (ordinary writer roles get no direct `INSERT` — a future
  `GRANT` dependency; backfills use the procedure too). Under the fixed lock
  prefix it **re-checks the actor gate is currently eligible at insert time** —
  merchant `ACTIVE`, `(M, U)` membership ACTIVE + allowed role, channel identity
  `VERIFIED` + binding — from a *trusted* actor context (never passed IDs or a
  "verified" flag), and writes provenance from that re-checked result; a
  tuple-correct but `REVOKED` membership / identity / binding fails, no order. No
  late reverse capture of authority locks inside an `INSERT` trigger. Later
  **recovery** is unchanged: it keeps the historical tuple checks and never
  re-evaluates the original approver's current eligibility.
- **`delivery_draft.expired_at` is enforced, not advisory.** Every
  `OPEN`/`QUOTED` -> `EXPIRED` transition — sweep or otherwise — takes a fresh
  `t_exp` under the row lock, requires `t_exp >= OLD.expires_at`, and sets
  `expired_at := t_exp` itself; a premature `-> EXPIRED` and a caller-supplied
  `expired_at` are rejected, `expired_at` is `NOT NULL` on `EXPIRED` /
  `NULL` otherwise / `>= expires_at` / immutable. The trusted sweep's no-order +
  due checks and atomic quote-eligibility invalidation are unchanged; no
  cross-table lock is added.
- **`delivery_draft.requested_pickup_location_id` has a draft-level composite FK**
  `(requested_pickup_location_id, merchant_id) -> merchant_locations (id,
  merchant_id)` (`MATCH SIMPLE` so `NULL` = resolve-default is allowed;
  `RESTRICT`), so a cross-tenant location id can never be stored on a draft even
  transiently. Ownership only — ACTIVE / default / resolved-point checks stay
  separate.
- **Intake idempotency is a DB constraint:** an immediate
  `UNIQUE (merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)`
  with `origin_channel` `NOT NULL` (closed enum), namespace-required-when-token
  `CHECK`, and DB bounds/nonblank backstops for every non-null
  `origin_namespace` / `adapter_dedupe_token`. The trusted intake boundary stores
  only the shared canonical forms and rejects blank/whitespace components before
  uniqueness. A concurrent redelivery of one canonical full key yields exactly
  one draft (the loser reads the existing draft, no overwrite / no deadline
  extension / no terminal resurrection); tokenless (`NULL`) manual drafts repeat
  freely and distinct canonical namespaces stay independent.
- **`delivery_order.cancellation_authority` (`MERCHANT | DISPATCH_EXECUTION`)** is
  `NULL` until cancellation and `NOT NULL`, write-once and immutable on every
  transition to `CANCELED`, set atomically with `status` / timestamp / reason and
  the provenance that source requires — `MERCHANT` with the full verified merchant
  tuple, `DISPATCH_EXECUTION` with a verifiable compensation reference and **no**
  merchant tuple. This slice admits only `MERCHANT` (step 5); `DISPATCH_EXECUTION`
  stays closed until a downstream contract + backstop exist, and the enum value
  alone never substitutes for the trusted operation. **Existing-order integrity**
  checks the source and its references. `MERCHANT` additionally requires a
  non-null immutable `cancellation_channel` in the closed
  `SESSION`/`WHATSAPP`/`SMS` set and non-null `cancellation_provenance` before
  the pair check; `DISPATCH_EXECUTION` requires the whole merchant tuple,
  including channel and provenance, null while retaining its separate verified
  compensation reference; non-canceled rows require all cancellation evidence
  null. The DB source-shape partition uses explicit `IS NULL` / `IS NOT NULL`
  predicates and total `IS TRUE` / equivalent semantics. A null
  `cancellation_authority` on a `CANCELED` row is corruption, and a null
  `cancellation_channel` no longer implies "legitimate compensation". The
  allowed-transition graph is unchanged.
- Merchant cancellation resolves the named `order_id` in two internally distinct
  cases with **one external code, `DELIVERY_ORDER_NOT_FOUND`, zero writes**:
  **ORDER ABSENT** → returned at step 1 **before any authority lock**;
  **ORDER PRESENT but the caller fails the step-3 locked authority gate**
  (`MERCHANT_ACTOR_UNAUTHORIZED` internally, logged) → the external code is masked
  to the same value so cross-tenant existence is not disclosed. Only once the
  step-3 gate passes do **Existing-order integrity** and then the status gate
  run.
- The creation branch re-checks the mandatory recipient fields
  (`recipient_contact`, `destination_text`, resolved `destination_point`) under
  the draft lock (step 5b); a partial `QUOTED` draft →
  `DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`, never an
  authoritative-but-undeliverable order.
- Cargo is a list of **lines `{ category_code, quantity, unit }`**; deliverability
  is decided over the category set, `quantity`/`unit` are carried into the draft,
  the fingerprint, and the immutable order snapshot (2 kg ≠ 200 kg); capacity /
  transport-condition checks stay downstream and do not extend
  `resolveCargoDeliveryPolicy`. Quote publication and creation step 5b first
  enforce invariant 5's non-empty canonical shape/quantity/unit validation;
  failures return `DELIVERY_CARGO_LINE_INVALID` before fingerprint/policy.
- `COOKED_CRAYFISH` and `LIVE_CRAYFISH` are `DELIVERABLE`; `ALCOHOL` is
  `NOT_DELIVERABLE` / `IN_STORE_ONLY` (BazarDrive product policy, not a legal
  claim) and blocks order creation.
- Cargo deliverability is a **server-owned versioned constant** behind
  `resolveCargoDeliveryPolicy`, evaluated over the whole set against the
  **replica-active** constant; unknown categories fail closed. The order records
  the decision as **immutable, non-null `cargo_policy_version` /
  `cargo_policy_decision`** (not audit-only), re-derived and re-checked by a
  trusted `INSERT` validator and re-checked historically by **Existing-order
  integrity** against that version's retained definition. A policy-class /
  vocabulary change is a **coordinated activation** spanning the resolver, the DB
  validator and all order writers (halt creation-branch approvals **and new order
  inserts** — `CARGO_POLICY_TRANSITION` — **drain every already-started
  order-creation transaction, approval / secondary-writer / backfill, to
  COMMIT/ROLLBACK**, confirm the drain and that no old-constant replica remains,
  only then activate resolver+validator together, resume); until the drain and
  confirmation are done the version is not switched and inserts are not resumed;
  an unconfirmed step leaves creation blocked.
- A quote binds to **all** confirmed delivery inputs — recipient, contact,
  `destination_text`, **resolved `destination_point`**, access note, window,
  **cargo lines `{ category, quantity, unit }`** — **and** the canonical
  `pickup_snapshot` (location id plus its content, incl. resolved coordinates),
  via a `delivery_input_fingerprint` on the quote. Mutating any of those on a
  `QUOTED` draft, or editing the resolved pickup content (even with the same id),
  drops the draft to `OPEN` and stales the quote; a mismatch at creation is
  `QUOTE_STALE` and forces a fresh quote + re-approval.
- **Quote lifecycle writes (publish / supersede / invalidate) take the
  `delivery_draft` `FOR UPDATE` lock and hold it through commit; each successful
  publication atomically replaces `latest_published_quote_id`, while failure /
  invalidation leaves the marker unchanged**, so `QUOTE_SUPERSEDED` / staleness
  are deterministic without timestamp ordering: no
  supersession can land between the step-5c re-confirm and commit, and a reprice
  arriving after `-> APPROVED` sees a terminal draft and refuses. Publication
  additionally validates the candidate priced inputs under the merchant/default
  and selected-pickup locks, as specified in the Quote boundary; a mismatch
  publishes nothing. Every successful publication is retained behind the
  quote-owned hard-delete guard: q2 moves the marker but cannot remove q1, and
  the approval ownership-and-publication read includes that non-current
  successfully published row while excluding any candidate whose publication
  never committed. External computation may precede the transaction; no
  ledger/tombstone is introduced.
- Approving an expired, superseded, or stale quote does not create an order; the
  order snapshots only the boundary quote fields (incl. the fingerprint), never
  quote computation state. Expiry is evaluated with `clock_timestamp()` **after**
  the blocking locks are held, never a transaction-start timestamp.
- A current non-approvable quote on a `QUOTED` draft is explicitly rejected by
  creation step 5c as `DELIVERY_ORDER_STATE_INCONSISTENT` before expiry/fingerprint.
  Step-4 terminal/superseded/stale priority and valid-order recovery are preserved.
- `delivery_order` carries an **unconditional `UNIQUE (draft_id)`** — a DB
  invariant that survives cancellation and holds for secondary writers /
  backfills, not just the service path; a `(draft_id, quote_id)` index serves
  exact-pair recovery; concurrent creations yield exactly one order.
- **Recovery** reads the single order for `draft_id` after the **tenant-bound
  access check and authority locks** (which run for recovery too) and **splits on
  whether that order exists**. *Order absent:* locked `draft.status == APPROVED` →
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert); otherwise → step 4 (a `QUOTED`
  draft whose marker equals the presented quote proceeds to creation) — no existing-order field is
  inspected. *Order present:* **Existing-order integrity** before the `quote_id`
  match — including the recompute `F(immutable order snapshots) ==
  order.delivery_input_fingerprint == quote.delivery_input_fingerprint` and the
  copied amount/currency/computed_at/expires_at equalling the referenced quote's
  immutable values. Any failed structural or equality check →
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert) **even on an exact-pair match**;
  else `order.quote_id` equal to the presented `quote_id` → **recovery** (returned
  in **any** state, incl. `CANCELED`, **zero writes**, no re-check of pickup, the
  quote's **current** expiry / supersession / staleness / eligibility, cargo
  policy against the current constant, or live `quote_state`); else →
  `DELIVERY_APPROVAL_QUOTE_CONFLICT`. New creation is reached only from a `QUOTED`
  draft that is not `APPROVED` and has no order.
- Intake dedupe keys on `(merchant_id, origin_channel, origin_namespace,
  adapter_dedupe_token)`; `origin_namespace` is from trusted adapter context and
  mandatory whenever a dedupe token is present — the same message id from two
  provider accounts of one merchant makes two drafts, not one.
- The `## Order-creation authority` dispatch starts with the zero-I/O **step 0
  request-shape preflight**, then `lock → always-on access check →
  step-3 recovery/integrity → step-4 no-order priority → step-5 creation`. **Step
  3 reads the single order for `draft_id` and splits on order existence.** *Order
  absent:* locked `draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`;
  otherwise → step 4 — no existing-order field is inspected. *Order present*
  (all **Existing-order integrity** checks **before** the `quote_id` match,
  including `F(immutable order snapshots) == order.delivery_input_fingerprint ==
  quote.delivery_input_fingerprint` and the copied
  amount/currency/computed_at/expires_at equalling the referenced quote):
  a failed check → `DELIVERY_ORDER_STATE_INCONSISTENT` even on
  an exact-pair match; else exact `quote_id` → **recovery** (zero writes, any
  state incl. `CANCELED`); else → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. The
  **step-4 priority** (order absent, draft not `APPROVED`) is fixed and applied in
  sequence: a **pre-(a) deadline check** — the source draft's `expires_at` has
  passed (post-lock authoritative wall clock, whether or not the sweep ran) →
  `DELIVERY_DRAFT_EXPIRED`, **before** superseded / stale; (a) terminal
  draft → `DELIVERY_DRAFT_NOT_APPROVABLE`; (b) presented retained, successfully
  published own quote **superseded** (`OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`,
  **before** staleness; (c) `OPEN` with the presented published own quote
  **invalidated and not superseded** → `QUOTE_STALE`; (d) an unpublished
  same-draft candidate or any other `OPEN` / non-matching quote →
  `DELIVERY_DRAFT_NOT_APPROVABLE`; (e) a `QUOTED` draft with its current
  non-superseded quote → creation. Every rejection is **zero-write** and
  preserves the entry state. Step 5 additionally re-checks, under the draft lock,
  a coordinate- and `resolved_pickup_point`-bearing same-merchant pickup (5a,
  `DELIVERY_PICKUP_UNRESOLVED` /
  `MERCHANT_LOCATION_REQUIRED`) and the mandatory recipient fields (5b,
  `DELIVERY_RECIPIENT_INCOMPLETE` / `DELIVERY_DESTINATION_UNRESOLVED`), canonical
  cargo shape (5b, `DELIVERY_CARGO_LINE_INVALID`), the draft deadline again and
  approvable quote state (5c, `DELIVERY_DRAFT_EXPIRED` /
  `DELIVERY_ORDER_STATE_INCONSISTENT`);
  the
  creation-branch fingerprint recompute (step 5d) also yields `QUOTE_STALE` for a
  pickup-content edit that reached approval before the draft revert propagated.
- A `CANCELED` `delivery_order` is never re-created or resurrected from the same
  draft; a further delivery is a **new draft + new quote + new order**.
- Merchant cancellation via Order Authority is allowed **only in
  `PENDING_DISPATCH`** and is itself an authority action. Before any domain I/O,
  step 0 validates an exact `{ order_id, cancel_reason }` record and rejects bad
  UUID/reason shape or extra actor/channel/provenance/timestamp fields as
  `DELIVERY_CANCEL_INPUT_INVALID`. A valid request enters **one transaction** that
  takes the shared authority prefix (`delivery_draft` → membership → `merchants(M)`
  → identity → binding), re-resolves `AUTHORIZED_MERCHANT_ACTOR(U, M)` with `M`
  from the locked draft, then `FOR UPDATE`s the `delivery_order` row **last** and
  validates **Existing-order integrity** before `PENDING_DISPATCH -> CANCELED`.
  That transition atomically records the cancelling actor's exact membership,
  **non-null closed channel from the locked proof path**, — for a channel
  cancellation — identity/binding, and bounded
  provenance, timestamp and reason, once; retry/rejection never rewrites it. A
  read-side actor check or a client-named order id is never trusted. Once
  Dispatch atomically claims the order (`SEARCHING_DRIVER`), cancellation runs
  through the Dispatch/Execution compensation flow.
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
load-bearing for the contract above. Review refinements remain **proposed,
pending independent re-audit on the published correction**. At this correction's
baseline `c6e9130` (`1fc6682`/CORRECTED15 plus the published `c6e9130`/CORRECTED17
commit — CORRECTED16's four round-8 fixes and CORRECTED17's worked-example
alignment), **56 threads across nine Codex reviews are open**: 40 are outdated and
16 non-outdated, **0 resolved** — the pre-`c6e9130` non-outdated threads are
already covered by earlier corrections' content, and review `5162786689` on
`c6e9130` adds **4 inline comments = 4 distinct findings (2 P1 + 2 P2)**, no
duplicates: make the draft tenant immutable (`3975577838`, P1), preserve the
intake dedupe key against `DELETE` / `UPDATE` (`3975577846`, P1), align race-matrix
rows 2–3 with the universal `DELIVERY_DRAFT_NOT_FOUND` masking (`3975577842`, P2),
and a mandatory `NOT NULL` `approval_channel` discriminator (`3975577858`, P2) —
all addressed by this round. Anchor movement is not resolution; no thread is
closed by this document or by local verification.

For the five scoped follow-up corrections, decisions 1, 2, 5 and 8 additionally
apply **Trusted draft-INSERT boundary**, **Draft abandonment**, **Cancellation
facts integrity**, **Canonical monetary boundary**, and approval **step 0**.
These narrow refinements do not redefine the original snapshot's review counts
or claim that any thread has been resolved. Historical review records below are
retained as prior snapshots, not evidence that these new obligations ran.
The fresh `b3067baf` correction further refines decisions 1, 2, 5 and 6 with a
durable quote-winner marker, cancellation preflight + channel totality, and
row/deferred enforcement of the already-settled intent-mutation rule; it does not
introduce a new business-policy vocabulary.

1. **Draft persistence.** `delivery_draft` is a **persisted** server-side entity.
   Persisted is not authoritative: WhatsApp/Peach/manual intake may create or
   augment it, and it is the durable anchor for quoting, expiry, dedupe, and
   recovery after a lost confirmation response — but only an
   `AUTHORIZED_MERCHANT_ACTOR` approval turns `draft + quote` into a
   `delivery_order`. Several of its properties are **DB invariants**, not
   service-path habits: `merchant_id` is `NOT NULL` (no tenantless draft, any
   channel/state) **and immutable after `INSERT`** — an immediate row-local guard
   rejects any `OLD.merchant_id -> NEW.merchant_id` change in every status, so a
   draft cannot be re-tenanted to another merchant; an unapproved draft ages out
   on an immutable server
   `expires_at = created_at + TTL` (bounded constant; edits/reprices never
   extend it; a trusted sweep worker sets `expired_at` and moves due
   `OPEN`/`QUOTED` drafts with no order to `EXPIRED`; an `APPROVED` draft never
   expires); and `status == APPROVED` holds **iff** exactly one `delivery_order`
   exists (deferred at-commit coupling constraint-trigger pair — see decision 8).
   Additionally, an immediate **row-local transition guard** confines `status` to
   a legal graph — new `INSERT` `OPEN`; `OPEN -> { QUOTED, ABANDONED, EXPIRED }`;
   `QUOTED -> { OPEN, APPROVED, ABANDONED, EXPIRED }`; `APPROVED` / `ABANDONED` /
   `EXPIRED` absorbing — checked on every `OLD -> NEW` including intra-transaction
   UPDATEs, so a backfill cannot resurrect a terminal draft; and **every**
   `-> EXPIRED` (sweep or otherwise) must, under the row lock, take a fresh
   `t_exp`, require `t_exp >= OLD.expires_at`, and stamp `expired_at := t_exp`
   itself (`NULL` on non-`EXPIRED`, `NOT NULL` `>= expires_at` and immutable on
   `EXPIRED`) — a premature or mis-stamped `-> EXPIRED` is rejected. It is
   separate from the deferred coupling and does not replace actor authority or
   the expiry worker's preconditions. For the exact confirmed-input set, null-safe
   comparisons additionally permit `OPEN -> OPEN`, require a `QUOTED` edit to
   become `OPEN`, and reject all terminal / same-status `QUOTED` intent edits. A
   trusted draft-first mutation invalidates the retained-marker quote atomically;
   a deferred final-state backstop prevents changed intent from remaining falsely
   quoted. Intake idempotency is a real DB constraint
   — an immediate `UNIQUE (merchant_id, origin_channel, origin_namespace,
   adapter_dedupe_token)` with `origin_channel` `NOT NULL`, namespace-required
   when a token is present, and DB bounded/nonblank checks for every non-null
   namespace/token; the trusted intake boundary stores only canonical forms and
   rejects blank/whitespace components before uniqueness — and the recorded
   intake identity is **durable**: the full tuple is immutable after
   `INSERT` (null-safe guard, `adapter_dedupe_token -> NULL` included) and a
   `BEFORE DELETE` guard rejects a hard-delete of any token-backed draft in any
   status, so a redelivery of the original key always resolves to the original
   draft and cannot resurrect a terminal one (retention/erasure is a separate,
   later mechanism that must keep this guarantee). `requested_pickup_location_id`
   carries a draft-level composite FK to `merchant_locations (id, merchant_id)` so
   a cross-tenant pickup id cannot be stored on a draft.
2. **Quote ownership split.** Confirmed. Quote computation, reprice, surge, and
   concrete validity duration stay entirely in
   `BD-MERCHANT-QUOTE-AUTHORITY-01A`. This contract owns the **Quote boundary
   contract**: `quote_id`, state, canonical validity-window consumption and the
   fixed immutable snapshot fields the order carries — plus immutable quote
   ownership **and immutable published payload/fingerprint/`published_at` for the
   life of a `quote_id`**. Every successful quote row is retained behind a
   quote-owned hard-delete guard; a reprice appends a new retained `quote_id` and
   only moves the draft marker / lifecycle eligibility. No ledger/tombstone
   substitutes for the actual same-draft rows. This combines with shared draft
   serialization plus atomic maintenance of the durable
   `delivery_draft.latest_published_quote_id` publication winner, locked publication-time comparison of the priced candidate with
   current draft/pickup inputs, and mandatory recipient/resolved-point/canonical
   cargo preconditions. Publication validates finite non-null timestamps and the
   bounded duration, takes one fresh post-lock `t_publish`, rejects future-dated
   `computed_at` / already-expired windows, then atomically stamps
   `published_at := t_publish`; future schema guards preserve
   `computed_at <= published_at < expires_at`. Creation explicitly checks
   *current* quote state and writes the **verified** state into
   `delivery_order.quote_state` (`NOT NULL`, DB-`CHECK`ed to a closed
   approvable-value set, never a request field). Recovery checks historical
   ownership, **the retained validity relation/rule, the order's snapshot ↔
   immutable-quote fingerprint / copied-field equality**, and that the **stored**
   `quote_state` is a valid approvable value — never the quote's live state or
   today's clock/policy. For a retained, successfully published same-draft quote,
   supersession is marker inequality, not timestamp / UUID / price ordering;
   mere unpublished-candidate ownership is insufficient. Invalidation retains
   the marker so the marker quote can be classified stale while older published
   own quotes remain superseded.
3. **Recipient shape.** Recipient/destination is a **1:1 immutable child row**,
   `delivery_order_recipient_snapshot`, one per `delivery_order`, written in the
   creation transaction and never updated — a per-order PII capsule, explicitly
   not a reusable recipient address book. Immutability is enforced by the child
   table's **own** `BEFORE UPDATE OR DELETE` guard trigger, not the parent
   `delivery_order` trigger (which does not fire on direct child DML). A separate
   deferred existence constraint enforces exactly one child at commit, and
   DB-level `NOT NULL` + shape/format constraints on `recipient_contact`,
   `destination_text` and `destination_point` enforce that it is **well-formed**;
   recovery and cancellation reject missing-**or-malformed**-child corruption
   through **Existing-order integrity**.
4. **Cargo cardinality & detail.** A **list of cargo lines**
   `{ category_code, quantity, unit }` per order. Cooked + live crayfish for one
   recipient at one stop is one order. **Deliverability** is decided over the
   category set — `resolveCargoDeliveryPolicy` fails closed on the first
   non-deliverable/unknown category; any `ALCOHOL` blocks the whole order.
   `quantity`/`unit` (canonically normalized) are carried through the draft, the
   fingerprint, and the immutable order snapshot so 2 kg and 200 kg are distinct;
   capacity and transport-condition checks stay downstream and do **not** extend
   `resolveCargoDeliveryPolicy`. Invariant 5's shared canonical line validation
   runs before publication and at creation step 5b, before fingerprint/policy;
   empty/invalid lines fail `DELIVERY_CARGO_LINE_INVALID`.
5. **Cancel/dispatch cutover.** Merchant cancel via Order Authority ends
   **strictly at `PENDING_DISPATCH`**. A zero-I/O step 0 first accepts exactly
   `{ order_id, cancel_reason }`, validates UUID/reason shape and rejects every
   extra actor/channel/provenance/timestamp field as
   `DELIVERY_CANCEL_INPUT_INVALID`. Only then is it **an authority transaction**:
   it takes the shared authority prefix (`delivery_draft` → membership →
   `merchants(M)` → identity → binding, `M` from the locked draft), re-resolves
   `AUTHORIZED_MERCHANT_ACTOR(U, M)` under those locks, then `FOR UPDATE`s the
   `delivery_order` row **last** — never a separate `order -> authority` chain,
   never a trusted read-side check or client-named order id. When the step-1 hint
   read finds **no** `delivery_order`, it returns `DELIVERY_ORDER_NOT_FOUND`,
   zero writes, **before any authority lock**; when the order **exists** but the
   caller fails the step-3 locked authority gate, the same external
   `DELIVERY_ORDER_NOT_FOUND` is returned (internally `MERCHANT_ACTOR_UNAUTHORIZED`,
   logged) so existence is not disclosed. Neither is a substitute for the
   post-gate integrity check. Once the gate passes it checks
   **Existing-order integrity**, including an `APPROVED` source draft, well-formed
   recipient snapshot, non-null merchant-owned pickup, the historical
   membership and channel identity/binding tuples, and the snapshot ↔
   approved-quote fingerprint / copied-field equality, before transitioning, and
   writes **`cancellation_authority = MERCHANT`** with the cancelling
   actor/membership/**non-null closed channel**/identity-binding/procedure and the timestamp/reason
   atomically and once (Cancellation, Example T). Every transition to `CANCELED`
   carries a non-null write-once `cancellation_authority` (`MERCHANT` |
   `DISPATCH_EXECUTION`); `DISPATCH_EXECUTION` requires a verifiable downstream
   compensation reference and no merchant tuple and stays closed until a
   downstream contract + backstop exist. **Existing-order integrity** checks the
   source and its references; a `MERCHANT` channel must be one of `SESSION`,
   `WHATSAPP`, `SMS` and carries non-null `cancellation_provenance`, checked
   before the pair, while `DISPATCH_EXECUTION` has no merchant channel or
   provenance. A null channel no longer implies
   "legitimate compensation".
   Once Dispatch
   atomically claims the order (`SEARCHING_DRIVER`), direct merchant-cancel is
   refused (`DELIVERY_ORDER_NOT_CANCELABLE`); later cancellation runs through the
   Dispatch/Execution compensation flow.
6. **Session vs. channel approver parity.** Both are in scope, with **parity of
   right, not of proof**. Session: server-resolved user → ACTIVE membership →
   allowed role. Channel: VERIFIED external identity → linked user → ACTIVE
   binding → ACTIVE merchant → ACTIVE membership → allowed role. Both normalize to
   one `AUTHORIZED_MERCHANT_ACTOR(U, M)`, re-resolved in the write transaction;
   allowed `membership_role in { ADMIN, OPERATOR }`. A **channel** approval (and
   channel cancellation) persists the **exact** identity + binding row that
   passed the gate onto the order (`approved_external_contact_identity_id` /
   `approved_merchant_contact_binding_id`, and the `canceled_*` pair), `NOT NULL`
   for `WHATSAPP` / `SMS` and null for `SESSION`, so **Existing-order integrity**
   can structurally verify which identity exercised the right even when a user
   holds several verified identities/bindings for one merchant. The same channel
   vocabulary is mandatory and non-null for a `MERCHANT` cancellation, recorded
   from its actual locked proof path together with non-null
   `cancellation_provenance`; `DISPATCH_EXECUTION` has no merchant channel,
   provenance or pair.
   `delivery_order.approval_channel` is itself the mandatory discriminator —
   `NOT NULL`, immutable, closed to `SESSION | WHATSAPP | SMS` (DB enum or `CHECK`
   **with** `NOT NULL`) — written from the proof path actually verified at insert,
   never inferred from the identity/binding pair's null-ness and never defaulted
   to `SESSION`. A legacy / trigger-bypassed order with a null channel fails
   **Existing-order integrity** (checked before the tuple) and is not recovered.
7. **Deliverability policy storage.** A **server-owned, versioned constant** in
   the initial runtime, behind `resolveCargoDeliveryPolicy(...)` — not a mutable
   admin-editable table. Initial constant: `COOKED_CRAYFISH` / `LIVE_CRAYFISH`
   deliverable, `ALCOHOL` not deliverable. It is BazarDrive merchant-delivery
   product policy, not a universal legal statement. Because the constant is
   process-local, a policy-class / vocabulary change is a **coordinated
   activation**, not an ordinary rolling deploy: halt creation-branch approvals
   **and new `delivery_order` inserts** on all writers (`CARGO_POLICY_TRANSITION`),
   **drain to COMMIT/ROLLBACK every already-started order-creation transaction —
   approval and every other `INSERT` path, secondary writers and backfills
   included** — confirm no replica (application resolver **or** DB `INSERT`
   validator) still runs the old constant **and** the drain is complete, only
   then activate resolver and validator together everywhere, then resume. Until
   the drain and confirmation are done the version is **not** switched and
   inserts are **not** resumed; any unconfirmed step leaves creation blocked
   (fail-closed). The order records **immutable, non-null
   `cargo_policy_version` and `cargo_policy_decision`**: a trusted `INSERT`
   validator (from the same immutable policy definition, still a versioned
   constant — no admin store) re-derives the category set from `cargo` and
   confirms them; **Existing-order integrity** re-checks the stored decision
   against that version's retained definition; a backfilled `DELIVERABLE` does not
   bypass either. The decision is **not** part of the canonical quote-input
   fingerprint.
8. **Idempotency key.** `delivery_order` carries an **unconditional `UNIQUE
   (draft_id)`** — a hard DB invariant that survives `CANCELED` (the row is never
   hard-deleted) and holds against secondary writers and backfills, not only the
   service path. `UNIQUE (draft_id, quote_id)` alone is insufficient (it would
   let two rows for one draft with different `quote_id`s coexist); a **separate
   non-unique index on `(draft_id, quote_id)`** serves the exact-pair recovery
   lookup. **Draft ingestion has its own DB idempotency** — an immediate
   `UNIQUE (merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)`
   with `origin_channel` `NOT NULL` (closed enum), namespace-required-when-token
   plus DB bounded/nonblank checks for each non-null namespace/token; the trusted
   intake writer canonicalizes them and rejects blank/whitespace input before
   uniqueness. A concurrent redelivery of one canonical full key produces exactly
   one draft (the loser reads it, no overwrite / no deadline extension / no
   terminal resurrection), while tokenless (`NULL`) manual drafts repeat freely —
   never a competing key
   for order creation. The `UNIQUE` only blocks a *duplicate*; the recorded
   identity is also made **durable** so it cannot be *freed*: the full intake
   tuple is immutable after `INSERT` (null-safe row-local guard — no component
   change, `adapter_dedupe_token -> NULL` included) and a `BEFORE DELETE` guard
   rejects a hard-delete of any token-backed draft in any status, so a later
   redelivery of that key still collides with, and resolves to, the original
   draft in its recorded status. A future PII retention / erasure mechanism is
   out of scope here and must preserve this guarantee. `draft_id` and `merchant_id` are both `NOT NULL` and bound by a
   **composite FK `(draft_id, merchant_id) -> delivery_draft (id, merchant_id)`**
   (or guard trigger), so the persisted order's merchant can never diverge from
   its source draft's. Because `APPROVED` is terminal for the draft, a draft
   yields **at most one `delivery_order`, ever**. `UNIQUE (draft_id)` bounds the
   count but does not tie it to the draft's status; a **deferred (at-commit)
   coupling constraint-trigger pair — one on `delivery_draft`, one on
   `delivery_order`** — additionally enforces, over the **final committed rows**
   (never an intermediate `NEW.status`), that `status == APPROVED` has exactly
   one order in any state (incl. `CANCELED`) and every other status has zero,
   without breaking the lawful `INSERT order -> INSERT snapshot -> flip draft
   APPROVED` sequence and without adding a late `delivery_draft` lock to a
   dispatch/cancellation `UPDATE` (its draft read is non-locking). This closes
   the gap left by `Existing-order integrity` running only on
   recovery/cancellation. After the tenant-bound access
   check and the invariant-6 authority locks, the branch reads the single order
   for `draft_id` and **splits on whether that order exists**. *Order absent:*
   locked `draft.status == APPROVED` → `DELIVERY_ORDER_STATE_INCONSISTENT`
   (alert); otherwise → step 4 (a `QUOTED` draft whose marker equals the presented quote proceeds
   to creation) — **no existing-order field is inspected**. *Order present,
   **Existing-order integrity** before the `quote_id` match:* a failed structural
   **or snapshot ↔ immutable-quote equality** check (`F(immutable order
   snapshots) == order.delivery_input_fingerprint ==
   quote.delivery_input_fingerprint`; copied amount/currency/computed_at/expires_at
   equal the referenced quote) → `DELIVERY_ORDER_STATE_INCONSISTENT` **even on an
   exact-pair match**; else `order.quote_id` equal to the presented `quote_id` →
   **recovery**, the order returned in **any** state including `CANCELED`, with
   **zero writes**, re-checking no *current* eligibility; else (`order.quote_id`
   differs) → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. A canceled order is never resurrected — a
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
  the `quote_id` match:* any **Existing-order integrity** failure →
  `DELIVERY_ORDER_STATE_INCONSISTENT` even on an exact-pair match;
  else exact `quote_id` → return existing order, zero writes, incl. `CANCELED`;
  else → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. Then the **step-4 ordered priority**
  (order absent, draft not `APPROVED`): a **pre-(a) deadline check** —
  `clock_timestamp() >= delivery_draft.expires_at` (post-lock) →
  `DELIVERY_DRAFT_EXPIRED`, before superseded / stale; (a) terminal
  draft → `DELIVERY_DRAFT_NOT_APPROVABLE`; (b) presented retained, successfully
  published own quote **superseded** (`OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`;
  (c) `OPEN` with the presented published own quote invalidated and **not**
  superseded → `QUOTE_STALE`; (d) an unpublished same-draft candidate or any
  other `OPEN` / non-matching quote → `DELIVERY_DRAFT_NOT_APPROVABLE`; (e) a
  `QUOTED` draft whose marker equals the presented quote → **creation** (step 5: pickup incl.
  coordinates + `resolved_pickup_point` + mandatory recipient/canonical cargo
  checks + draft-deadline re-check + quote state/expiry + fingerprint +
  cargo policy → atomic `INSERT` (with the verified `quote_state`) + `QUOTED ->
  APPROVED`). Every rejection is
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
  the per-draft quote-serialization point. The fresh `b3067baf` correction
  strengthens this historical rule: each successful publication atomically moves
  `latest_published_quote_id`, which durably records the lock winner without
  timestamp ordering; invalidation retains it, and the quote-owned hard-delete
  guard retains every prior published same-draft row after the marker moves.
  `QUOTE_SUPERSEDED` / staleness are therefore deterministic (race rows 23, 84,
  88).
- **Cancellation is a locked authority transaction (P1 — 3958973798, condition
  1).** Merchant cancel takes the shared authority prefix (`delivery_draft` →
  membership → `merchants(M)` → identity → binding, `M` from the locked draft),
  re-resolves `AUTHORIZED_MERCHANT_ACTOR(U, M)`, then `FOR UPDATE`s the
  `delivery_order` row **last**, then gates on `PENDING_DISPATCH`. Never a
  transition before **Existing-order integrity**; cancellation provenance is
  recorded atomically and once as specified by **Cancellation**. Never a
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
  with no order proceeds to normal creation. *Order present:* all
  **Existing-order integrity** checks run **before** `quote_id`; a failure is
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert), never a
  successful recovery — but a valid `APPROVED` draft with a `CANCELED` order still
  recovers with zero writes (decision 8; race row 30; Example R).
- **Coordinated cargo-policy activation (P1 on a policy change — 3958973893,
  condition 3).** A policy-class / vocabulary change halts creation-branch
  approvals on all writers (`CARGO_POLICY_TRANSITION`), drains in-flight, confirms
  no old-constant replica remains, activates, resumes; an unconfirmed step leaves
  creation blocked. The versioned constant stays; `cargo_policy_version` is audit
  (invariant 5 → *Policy-version activation*; decision 7; race row 31).

Additional load-bearing invariants proposed in review **round 6** (Codex review
`5153567112`, head `1e19302`; pending independent re-audit):

- **Draft/order state coupling is a DB invariant (P1 — `3967777206`).** A
  deferred (at-commit) constraint-trigger pair — one on `delivery_draft`, one on
  `delivery_order` — checks the **final committed rows** (never an intermediate
  `NEW.status`): `delivery_draft.status == APPROVED` ⇔ exactly one
  `delivery_order` for its `draft_id` in any state (incl. `CANCELED`); every
  other status ⇔ zero. It preserves the lawful `INSERT order -> INSERT recipient
  snapshot -> flip draft APPROVED` sequence and adds no late `delivery_draft`
  lock to a dispatch/cancellation `UPDATE` (non-locking draft read). Closes the
  gap left by `Existing-order integrity` running only on recovery/cancellation
  (invariant 6 → *The creation transaction*; Idempotency and recovery; decision
  8; race row 49; Example Y).
- **Stored resolved pickup point + provenance (P1 — `3967777246`).** `0009`
  `merchant_locations` has only `lat`/`lng`, address, labels — no provider/place
  identifier. A future nullable `merchant_locations.resolved_pickup_point` (or
  pre-quote pickup snapshot entity) holds coordinates + real provider/place
  provenance + the source address/coordinates it was resolved from; a trusted
  resolver-persist procedure writes it **before pricing** under the existing
  `draft -> [authority prefix] -> merchant -> location` locks, never a
  `location -> draft` inversion, never fabricated from bare coordinates. An
  address/coordinate edit clears/invalidates a stale value. The full point —
  coordinates, provider/place id, provenance, source binding — is a member of
  the **canonical fingerprint input list** and of the `pickup_snapshot` shape
  contract; **step 5a and Quote publication** require it present, shape-valid and
  **consistent with the location's current address/coordinates** (else
  `DELIVERY_PICKUP_UNRESOLVED`), and step 5d recomputes over it — so a
  provider/place / source-binding swap under an unchanged address still changes
  the fingerprint. Recovery checks only that frozen copy, no comparison to the
  current value, no geocode, no new pickup lock (invariant 4; `delivery_draft`
  prerequisites; Quote boundary contract — canonical input list, *resolved
  pickup point before pricing*, *publication validates the priced pickup*;
  Order-creation steps 5a/5d; `pickup_snapshot` / `delivery_input_fingerprint`
  fields; Existing-order integrity; `DELIVERY_PICKUP_UNRESOLVED` taxonomy;
  acceptance criteria; race rows 50, 46; Examples X, K; schema + writer dependency).
- **Historical `quote_state` validation (P2 — `3967777214`).**
  `delivery_order.quote_state` is `NOT NULL`, DB-`CHECK`ed to a closed set of
  approvable snapshot values (fixed before schema activation, history-preserving),
  and written from the state the creation transaction **verified** at step 5c —
  never a request field. `Existing-order integrity` rejects a null / unknown /
  non-approvable stored value → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes;
  it is still never compared to the quote's live state (`delivery_order` field
  table; Quote boundary contract; decision 2; `DELIVERY_ORDER_STATE_INCONSISTENT`
  taxonomy; race row 51; Example Y).
- **Tenant-bound draft (P2 — `3967777226`).** `delivery_draft.merchant_id` is
  `NOT NULL REFERENCES merchants(id)` for every channel and state; a concrete
  merchant is resolved before the `INSERT`; unresolved intake is never persisted
  as a tenantless draft. Keeps the tenant gate, the `(merchant_id, …)` intake
  dedupe key (no null-distinct evasion), and the privacy boundary well-defined
  (`delivery_draft` field table + rules; Idempotency and recovery; decision 1;
  race row 52).
- **Order-not-found at cancellation (P2 — `3967777236`).** Two internally
  distinct cases share **one external code**, `DELIVERY_ORDER_NOT_FOUND`, zero
  writes: **ORDER ABSENT** → returned at step 1 **before any authority lock**;
  **ORDER PRESENT but the caller fails the step-3 locked authority gate**
  (`MERCHANT_ACTOR_UNAUTHORIZED` internally, logged) → the external code is masked
  to the same value so cross-tenant existence is not disclosed. Neither replaces
  the post-gate integrity check; once the gate passes, **Existing-order
  integrity** then the status gate run (Cancellation steps 1–5; decision 5;
  `DELIVERY_ORDER_NOT_FOUND` taxonomy; race rows 26, 53; Example W).
- **Bounded draft expiry (P2 — `3967777252`).** `delivery_draft` gains an
  immutable server `expires_at = created_at + TTL` (positive bounded constant
  fixed before intake activation; edits/reprices never extend it; independent of
  quote expiry) and a nullable `expired_at`. A trusted sweep worker, under the
  draft lock, moves a due `OPEN`/`QUOTED` draft with no order to `EXPIRED`, sets
  `expired_at`, and invalidates quote eligibility — never normalizing corruption.
  Approval (step 4 pre-(a), re-checked step 5c) rejects a due-but-unswept draft
  on the post-lock authoritative wall clock → `DELIVERY_DRAFT_EXPIRED`. **Quote
  publication** keeps its early step-1 deadline check **and** re-reads
  `clock_timestamp()` at publication step 5, **after every merchant/pickup lock
  is held, immediately before the atomic publish** — a lock wait that crosses
  the deadline with unchanged inputs still yields `DELIVERY_DRAFT_EXPIRED`, zero
  writes (neither quote/fingerprint nor draft quote state published). An
  `APPROVED` draft never expires; ORDER PRESENT recovery/cancellation never
  evaluate the deadline (`delivery_draft` field
  table + rules; Order-creation steps 4–5; Quote boundary contract — publication
  steps 1 & 5; Existing-order integrity; `DELIVERY_DRAFT_EXPIRED` taxonomy; race row 54;
  Examples U, V).

Additional load-bearing invariants proposed in review **round 7** (Codex review
`5156335628`, head `f539027`; pending independent re-audit):

- **Cargo policy enforced on persisted orders (P1 — `3970113008`).** Immutable,
  non-null `cargo_policy_version` **and** `cargo_policy_decision`. A trusted
  `INSERT` validator — from the same immutable policy definition the server
  resolver uses (still a versioned constant, no admin store) — re-derives the
  category set from `NEW.cargo`, evaluates it under the **activated** version, and
  rejects a stored version/decision that does not actually clear those categories
  (a backfilled `DELIVERABLE`, or a stale permissive version, does not pass).
  Existing-order integrity re-checks the stored decision against that version's
  **retained** definition (historical, not the current constant). The coordinated
  policy-version activation now spans resolver **and** validator and every order
  writer, and its drain step (2) covers **every already-started order-creation
  transaction — approval, secondary writers and backfills alike**: the version is
  not switched, and inserts are not resumed, until that drain to COMMIT/ROLLBACK
  and its confirmation (step 3) are done, so no transaction that evaluated cargo
  under the old constant can commit against the new one. The policy decision is
  **not** part of the canonical quote-input fingerprint (invariant 5;
  Policy-version activation; `delivery_order` field table; Existing-order
  integrity; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; decision 7; race row
  55; Example Z; acceptance criteria; next-slice deps).
- **Draft state-transition guard (P1 — `3970113024`).** An immediate row-local
  `BEFORE INSERT OR UPDATE` guard on `delivery_draft` — separate from and
  additional to the deferred coupling — confines `status` to a legal graph: new
  `INSERT` `OPEN`; `OPEN -> { QUOTED, ABANDONED, EXPIRED }`;
  `QUOTED -> { OPEN, APPROVED, ABANDONED, EXPIRED }`; `APPROVED` / `ABANDONED` /
  `EXPIRED` absorbing. It evaluates every `OLD.status -> NEW.status`, including
  successive in-transaction UPDATEs, so a repository bug / backfill cannot
  resurrect a terminal draft. A same-status UPDATE is judged by the existing
  intent / repricing / immutability rules; the guard does not replace actor
  authority, the expiry worker's preconditions, or the deferred coupling
  (`delivery_draft` rules; decision 1; race rows 49, 56; Example AA; acceptance
  criteria; next-slice deps).
- **New orders start `PENDING_DISPATCH` (P1 — `3970113036`).** A row-local
  `BEFORE INSERT` guard on `delivery_order` permits a **new** row only with
  `status = PENDING_DISPATCH` (`NOT NULL`; a column `DEFAULT` is insufficient
  since an explicit value overrides it). It is **not** a permanent
  `CHECK (status = 'PENDING_DISPATCH')`: lawful downstream `UPDATE`s and recovery
  of existing `CANCELED` / `DELIVERED` rows are preserved; no cross-table lock is
  added (`delivery_order` field table; invariant 6; race row 57; Example AB;
  acceptance criteria; next-slice deps).
- **Approval cross-tenant masking (P2 — `3970113014`).** A nonexistent `draft_id`
  **and any failure of the locked step-2 actor gate for the locked draft's `M`**
  (no ACTIVE `(M, U)` membership, role miss, `merchants(M)` not `ACTIVE`, gate
  resolving another merchant, channel identity/binding mismatch) return the
  **same external code `DELIVERY_DRAFT_NOT_FOUND`**, zero writes — **no
  own-merchant exception** — so no caller can probe draft existence, mirroring
  cancellation's not-found masking. The true reason
  (`MERCHANT_ACTOR_UNAUTHORIZED` / `MERCHANT_MEMBERSHIP_REQUIRED` /
  `MERCHANT_INOPERABLE` / `CONTACT_*`) is internal, logged. The gate is always
  resolved for `M` **taken from the locked draft**. Tenant derivation and the
  authority locks (before recovery/creation) are unchanged; the frozen
  Identity/Contact resolver is not modified — only the response mapping at this
  call site (Order-creation steps 1–2; Approver parity;
  `DELIVERY_DRAFT_NOT_FOUND` / `MERCHANT_ACTOR_UNAUTHORIZED` taxonomy; race rows
  10, 58; Example AC; acceptance criteria).
- **Publication rejects malformed/future/expired quote windows (P2 —
  `3970113030`, strengthened by fresh review `4052770526`).** Before publication,
  the candidate must satisfy the shared Canonical quote validity-window shape:
  server-owned finite non-null `computed_at` / `expires_at`,
  `computed_at < expires_at`, and the retained positive bounded duration rule.
  Immediately before the atomic publish, after all blocking locks, publication
  takes one fresh `t_publish = clock_timestamp()` and applies the full ordered
  gate: `t_publish >= delivery_draft.expires_at` →
  `DELIVERY_DRAFT_EXPIRED`; `candidate_quote.computed_at > t_publish` →
  `QUOTE_VALIDITY_INVALID`; otherwise `t_publish >=
  candidate_quote.expires_at` → `QUOTE_EXPIRED`. Success atomically stamps the
  quote-owned immutable `published_at := t_publish` with the quote payload and
  draft quote state; failure is zero-write and never repairs or extends candidate
  timestamps. The schema/history backstop preserves
  `computed_at <= published_at < expires_at` plus the retained duration rule.
  Historical recovery checks that stored relation and exact quote/order copies
  only — never expiry against the current clock or today's duration policy
  (Quote boundary contract; Existing-order integrity; race rows 54, 59, 83;
  Example AD; acceptance criteria).

Additional load-bearing invariants proposed in review **round 8** (Codex review
`5159806482`, head `1fc6682`; pending independent re-audit):

- **Order-creation time gate + non-backdatable `created_at` (P1 — `3972970725` /
  `3972970754`).** The trusted `INSERT` boundary, after every lock/check, takes
  **one** fresh server `t := clock_timestamp()` and requires `t <
  delivery_draft.expires_at` (`DELIVERY_DRAFT_EXPIRED`) then `t <
  referenced_quote.expires_at` (`QUOTE_EXPIRED`) — both mandatory, since either
  can lapse in the check-to-`INSERT` gap — then stamps `delivery_order.created_at
  := t` (`NOT NULL`, immutable, not backdatable; a `DEFAULT` or a trusted-passed
  timestamp is insufficient). Applies to **every** new `INSERT`, backfills
  included. `t` is the server-defined creation moment, not `COMMIT`.
  **Existing-order integrity** checks only the *historical* relation `created_at
  < each immutable deadline`, never against the current clock; a correct order
  recovers however long after both deadlines pass (invariant 6 → *The creation
  transaction*; Order-creation step 5f; `delivery_order` field table;
  Existing-order integrity; `DELIVERY_DRAFT_EXPIRED` / `QUOTE_EXPIRED` /
  `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; race rows 60, 61; Example AE;
  acceptance criteria; next-slice deps).
- **Deadline-enforced `-> EXPIRED` + stamped `expired_at` (P1 — `3972970734` /
  `3972970759`).** The row-local `delivery_draft` transition guard — for **every**
  `OPEN`/`QUOTED` -> `EXPIRED`, sweep or not — takes a fresh `t_exp` under the
  row lock, requires `t_exp >= OLD.expires_at`, and sets `expired_at := t_exp`
  itself. `expired_at` is `NULL` on non-`EXPIRED`, `NOT NULL` `>= expires_at` and
  immutable on `EXPIRED`; a premature `-> EXPIRED`, a caller-supplied future
  `expired_at`, and a re-stamp are all rejected — a still-valid draft is never
  permanently killed. The trusted sweep's no-order + due checks and atomic
  quote-eligibility invalidation are unchanged; no cross-table lock is added
  (`delivery_draft` field table + rules; decision 1; race rows 56, 62; Example
  AA; acceptance criteria; next-slice deps).
- **Draft-level explicit-pickup tenancy FK (P2 — `3972970742` / `3972970764`).**
  A draft-level composite FK `(requested_pickup_location_id, merchant_id) ->
  merchant_locations (id, merchant_id)` (`MATCH SIMPLE` so `NULL` = resolve
  default is allowed; `RESTRICT`), reusing the unconditional
  `merchant_locations (id, merchant_id)` parent key — so a cross-tenant location
  id can never be stored on a draft, even transiently. Ownership only; ACTIVE /
  default / resolved-point checks at quoting/approval stay separate
  (`delivery_draft` field table; invariant 4; race rows 11, 63; acceptance
  criteria; next-slice deps).
- **DB intake idempotency (P1 — `3972970769`, strengthened by fresh
  review `4052770524`).** An immediate `UNIQUE (merchant_id, origin_channel,
  origin_namespace, adapter_dedupe_token)` is paired with `origin_channel`
  `NOT NULL` (closed enum), namespace-required-when-token, and DB
  bounded/nonblank checks for every non-null canonical `origin_namespace` and
  `adapter_dedupe_token`. The trusted intake boundary canonicalizes these
  components **before** dedupe lookup/storage and rejects blank/whitespace-only
  values as `DELIVERY_DRAFT_INPUT_INVALID`; it never trims them into a shared
  empty key. A present token therefore cannot evade/collapse the key through a
  null/blank namespace, and an empty token is never a valid immutable dedupe
  identity. Concurrent redelivery of one canonical full key → exactly one draft
  (loser reads it; no overwrite / deadline extension / terminal resurrection);
  tokenless (`NULL`) manual drafts remain freely repeatable, and distinct
  canonical merchant/channel/namespace scopes remain independent
  (`delivery_draft` field table; Idempotency and recovery; decision 8; race rows
  12, 64, 82; Example O; acceptance criteria; next-slice deps).
- **Current actor eligibility on every order `INSERT` (P1 — `3972970775`).** All
  new `delivery_order` rows go through one trusted transactional creation
  procedure (ordinary roles get no direct `INSERT` — a future `GRANT`
  dependency). Under the fixed lock prefix
  (`draft -> membership -> merchant -> identity -> binding -> pickup`, held to
  `COMMIT`/`ROLLBACK`) it re-checks the merchant / membership+role / channel
  identity-proof / binding are **currently** eligible from a *trusted* actor
  context (never passed IDs or a "verified" flag) and writes provenance from
  that re-checked result — a `REVOKED` tuple fails, no order. No late reverse
  authority-lock capture in an `INSERT` trigger. Later **recovery** keeps its
  historical tuple checks and never re-evaluates current eligibility; CORRECTED15
  external masking is unchanged (invariant 6 → *The creation transaction*;
  Order-creation authority; Existing-order integrity ("do not re-check current");
  race rows 3, 65; Examples S, AF; acceptance criteria; next-slice deps).
- **Write-once cancellation-source discriminator (P1 — `3972970785`).** New
  `delivery_order.cancellation_authority` (`MERCHANT | DISPATCH_EXECUTION`) —
  `NULL` until cancellation, `NOT NULL`, write-once and immutable on **every**
  transition to `CANCELED`, set atomically with `status` / timestamp / reason and
  the provenance the source requires: `MERCHANT` with the full verified merchant
  tuple including non-null `cancellation_provenance`, `DISPATCH_EXECUTION` with a
  verifiable compensation reference tied to the order and **no** merchant tuple,
  including null `cancellation_provenance`. Non-canceled rows carry neither.
  This slice admits only `MERCHANT` (step
  5); `DISPATCH_EXECUTION` stays closed until a downstream contract + backstop
  exist, and the enum alone never substitutes for the trusted operation.
  **Existing-order integrity** checks the source and its references; a null
  `cancellation_channel` no longer implies "legitimate compensation"; the
  allowed-transition graph is unchanged (`delivery_order` field table +
  Immutability; Cancellation step 5; Existing-order integrity;
  `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; decision 5; race rows 33, 66;
  Examples T, AG; acceptance criteria; next-slice deps).

Additional load-bearing invariants proposed in review **round 9** (Codex review
`5162786689`, head `c6e9130`; pending independent re-audit):

- **Immutable draft tenant (P1 — `3975577838`).** The same immediate row-local
  `BEFORE INSERT OR UPDATE` guard that confines `delivery_draft.status` also
  rejects **any** `OLD.merchant_id -> NEW.merchant_id` change — in every status,
  for every writer / backfill, on each successive intra-transaction `UPDATE`. A
  secondary writer cannot re-tenant an `OPEN` / `QUOTED` draft (which otherwise
  passes the pickup FK, the transition guard and the draft/order coupling) to
  another merchant whose actor would then read the recipient PII or re-price /
  approve it. The allowed draft-intent edits are unchanged (`delivery_draft`
  field table + rules; decision 1; race row 67; `DELIVERY_ORDER_STATE_INCONSISTENT`
  taxonomy (INSERT-time list); acceptance criteria; next-slice deps).
- **Durable intake identity (P1 — `3975577846`).** The `UNIQUE` blocks a
  duplicate but not a *freed* key. Two immediate row-local guards close it: the
  full intake tuple `(merchant_id, origin_channel, origin_namespace,
  adapter_dedupe_token)` is **immutable after `INSERT`** (null-safe
  `IS DISTINCT FROM` comparison — no component change, `adapter_dedupe_token ->
  NULL` included), and a `BEFORE DELETE` guard rejects a hard-delete of any
  **token-backed** draft (`adapter_dedupe_token IS NOT NULL`) in any status. A
  redelivery of the original key always resolves to the original draft in its
  recorded status and deadline; an `ABANDONED` / `EXPIRED` request cannot be
  turned back into a fresh `OPEN` draft or an order. Tokenless manual drafts stay
  freely creatable by separate `INSERT`s. Concrete retention duration and PII
  redaction/erasure are **out of scope here**; a later erasure mechanism must
  keep this guarantee — retain the intake tuple, never hard-delete a token-backed
  row (`delivery_draft` field table + rules; Idempotency and recovery; decision 1,
  decision 8; race rows 68, 69; acceptance criteria; next-slice deps).
- **Race-matrix masking alignment (P2 — `3975577842`).** Race-matrix rows 2 and 3
  now separate the **internal, logged** reason (`MERCHANT_INOPERABLE`,
  `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`) from the
  **single external `DELIVERY_DRAFT_NOT_FOUND`** the universal masking rule
  (rows 10, 58; `DELIVERY_DRAFT_NOT_FOUND` taxonomy) already requires — zero
  writes, before recovery or creation, both race directions and the lock order
  unchanged. The matrix no longer reads as licensing the internal code as the
  client outcome (Concurrency and race matrix rows 2, 3; Order-creation authority
  step 2; acceptance criteria).
- **Mandatory approval discriminator (P2 — `3975577858`).**
  `delivery_order.approval_channel` is **`NOT NULL`, immutable**, closed to
  `SESSION | WHATSAPP | SMS` (DB enum, or `CHECK` on the value set **with**
  `NOT NULL` — a pair-only `CHECK` passes on a `NULL` channel), written from the
  trusted proof path actually verified at insert, never inferred from the
  identity/binding pair's null-ness and never defaulted to `SESSION`.
  **Existing-order integrity** rejects a null / unknown `approval_channel` →
  `DELIVERY_ORDER_STATE_INCONSISTENT` (alert, zero writes) **before** the
  identity/binding-tuple check, after the current caller's authorization and
  before recovery / cancellation; a since-`REVOKED` identity/binding whose channel
  and tuple still match is valid history and is not faulted. The separate
  NULL-rules for the `cancellation_channel` / `canceled_*` fields were unchanged
  in round 9; the fresh `b3067baf` correction below strengthens the merchant
  channel discriminator
  (`delivery_order` field table + the `NOT NULL` list; The creation transaction;
  Existing-order integrity; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy;
  decision 6; race row 70; Example S; acceptance criteria; next-slice deps).

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

## Review-round 3 proposed resolutions (Codex review 5147469506, head `d55af7c`)

**Status: proposed docs-only correction; all 28 threads remain open.** The 11
new comments describe 10 distinct concerns (the membership-tuple comments are
duplicates). No migration, runtime, PR metadata or review-thread change is made
by this contract. The schema dependencies below are additive: the exact existing
membership ID is preserved across revocation/re-grant; `0009` is unchanged.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 missing recipient snapshot `3962663966` | Deferred exactly-one-at-commit invariant; **Existing-order integrity** before recovery/cancellation | Rows 32, 42; Example S |
| P1 source draft before cancellation `3962663972` | Cancellation step 4 requires structural integrity, including `APPROVED` source | Row 33; Example T |
| P1 cargo-line shape `3962663989` | Shared shape check before publication and creation fingerprint/policy; DB shape backstop; expanded error | Row 34; valid Example R |
| P1 quote/draft binding `3962663996` | Non-null composite quote/draft FK, immutable owner; static integrity read | Row 35; Example S |
| P1 current quote state `3962664023` | Step 5c explicitly rejects a non-approvable current quote on a `QUOTED` draft as integrity fault | Row 37; valid Example R |
| P2 pickup while quoting `3962663980` | Immutable priced candidate, then locked draft/merchant/pickup comparison before atomic publication; no remote computation under locks required | Row 38 |
| P2 approval membership tuple `3962664002`, duplicate `3962664017` | Non-null membership-ID/merchant/user composite FK; historical identity check without ACTIVE recheck | Rows 36, 42; Example S |
| P2 approval-time pickup `3962664010` | Explicit pickup persisted before quoting; approval cannot override it | Row 39 |
| P2 destination text fingerprint `3962664032` | One canonical input definition; explicit text in step 5d, invariant 6 and Example H | Row 40 |
| P2 cancellation provenance `3962664037` | Atomic write-once cancel actor/membership/channel/procedure, protected by order guard | Row 41; Example T |

The old row-23 parenthetical about invalidation committing after approval had
already reached creation is removed: shared draft locking makes that
interleaving impossible. Delayed pickup-content propagation remains covered by
row 8's creation fingerprint check; it is a different case.

## Review-round 4 proposed resolutions (Codex review 5147978460, head `4875827`)

**Status: proposed docs-only correction; all 31 threads remain open** (9
non-outdated: 4 P1 + 5 P2). The 6 pre-`4875827` non-outdated threads are already
covered by CORRECTED7's content and are not re-worked here. Review `5147978460`
adds 3 concerns (2 P1 + 1 P2), all resolved docs-only below. No migration,
runtime, PR metadata or review-thread change is made by this contract. New
additive schema-slice dependencies (flagged, not performed here): `NOT NULL` on
`delivery_order.pickup_location_id` and `pickup_snapshot`; DB `NOT NULL` + shape
constraints on `delivery_order_recipient_snapshot.recipient_contact` /
`destination_text` / `destination_point`; `delivery_order`
`approved_external_contact_identity_id` / `approved_merchant_contact_binding_id`
(and the `canceled_*` pair), `NOT NULL`-by-channel, with an additive
unconditional `merchant_contact_bindings (id, merchant_id,
external_contact_identity_id)` unique key and an `external_contact_identities`
linked-user/channel guard.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 pickup provenance non-null `3963114283` | `delivery_order.pickup_location_id` + `pickup_snapshot` `NOT NULL`; **Existing-order integrity** adds the pickup relation (non-null, ID match, immutable merchant ownership, well-formed snapshot incl. stored coordinates) and **explicitly does not** re-resolve/re-lock the location or compare the frozen snapshot to its current ACTIVE/default/address/coordinates; no late pickup lock in recovery. invariant 4; `delivery_order` field table; Cancellation step 4; taxonomy; acceptance criteria; schema-slice deps. | Row 43; Example S |
| P1 recipient snapshot fields `3963114288` | DB `NOT NULL` + shape/format constraints on `recipient_contact` / `destination_text` / `destination_point`; deferred exactly-one-at-commit becomes exactly-one-**well-formed**; **Existing-order integrity** rejects a missing **or malformed** historical child → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes; lawful parent → child INSERT preserved. Recipient-snapshot entity; decision 3; taxonomy; acceptance criteria; schema-slice deps. | Rows 32, 44; Example S |
| P2 channel authority tuple `3963114295` | `delivery_order` gains `approved_external_contact_identity_id` / `approved_merchant_contact_binding_id` (and `canceled_*`): both null for `SESSION` (and, for the `canceled_*` pair, when there has been no merchant cancellation through this slice), both `NOT NULL` for `WHATSAPP` / `SMS`; a populated pair where it must be null is corruption. Composite guards bind binding ↔ `(merchant_id, identity)` and identity ↔ approving/cancelling `user_id` + channel. The authorization step records the exact pair that passed; Cancellation records the cancelling pair; the order guard makes both immutable; **Existing-order integrity** verifies null-ness-by-channel plus ownership/linkage as immutable history — it does not re-detect a swap to another structurally-consistent same-merchant/user/channel pair; a since-`REVOKED` but tuple-consistent pair still recovers, the current caller re-passes the gate regardless. Approver parity; Cancellation step 5; decisions 5–6; taxonomy; acceptance criteria; schema-slice deps. | Rows 44, 45; Examples S, T |

## Review-round 5 proposed resolutions (Codex review 5149452382, head `35ab6c1`)

**Status: proposed docs-only correction; all 32 threads remain open** (7
non-outdated: 3 P1 + 4 P2). Review `5149452382` on `35ab6c1` adds 1 P1
(`3964389173`), resolved docs-only below. No migration, runtime, PR metadata or
review-thread change is made by this contract. New additive schema-slice
dependency (flagged, not performed here): an equality backstop tying the order's
copied `quote_amount` / `quote_currency` / `quote_computed_at` /
`quote_expires_at` and `delivery_input_fingerprint` to the referenced
`(quote_id, draft_id)` parent's immutable published values, with the
snapshot-dependent fingerprint recompute **deferred to commit** so the lawful
`INSERT order -> INSERT recipient snapshot` sequence still succeeds; and a Quote
Authority obligation that a published quote's identity/owner, payload,
fingerprint and publication timestamps are immutable, that its row cannot be
hard-deleted for the life of a `quote_id` (a reprice appends a new retained
`quote_id`), and that the fingerprint carries its canonical-algorithm version.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 bind recovered snapshots to the approved quote `3964389173` | **Existing-order integrity** (ORDER PRESENT only) adds: `F(immutable order snapshots) == order.delivery_input_fingerprint == referenced quote.delivery_input_fingerprint`, recomputed over the full canonical Quote-boundary input set (recipient name/contact/`destination_text`/resolved `destination_point`/access note/window, cargo lines, frozen `pickup_snapshot`) with the algorithm version named on the referenced fingerprint; plus equality of the copied `quote_amount` / `quote_currency` / `quote_computed_at` / `quote_expires_at` to the referenced quote's immutable values. Mismatch or an uncanonicalizable corrupted historical snapshot → `DELIVERY_ORDER_STATE_INCONSISTENT`, alert, zero writes, before recovery or a cancellation transition. Historical recovery is otherwise unchanged — no comparison with the current draft/store content, no current quote eligibility / cargo policy / expiry-vs-now / live-`quote_state` re-check, no late historical locks. `delivery_order` field table; composite-links (*Snapshot ↔ quote equality* backstop); Quote boundary contract (immutable payload/fingerprint; recovery equality); `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; Idempotency and recovery; acceptance criteria; decisions 2 & 8; Example S; schema-slice deps. | Rows 42, 46, 47, 48; Example S |

## Review-round 6 proposed resolutions (Codex review 5153567112, head `1e19302`)

**Status: proposed docs-only correction; all 38 threads remain open** (13
non-outdated: 5 P1 + 8 P2). The 7 pre-`1e19302` non-outdated threads are already
covered by earlier corrections' content and are not re-worked here. Review
`5153567112` on `1e19302` adds 6 concerns (2 P1 + 4 P2), all resolved docs-only
below. No migration, runtime, PR metadata or review-thread change is made by this
contract. New additive schema-slice / writer dependencies (flagged, not performed
here): a deferred at-commit **draft/order coupling constraint-trigger pair**; a
nullable **`merchant_locations.resolved_pickup_point`** (or pre-quote pickup
snapshot entity) plus a **trusted resolver-persist procedure**;
**`delivery_order.quote_state` `NOT NULL` + `CHECK`**; **`delivery_draft.merchant_id`
`NOT NULL REFERENCES merchants(id)`**; **`delivery_draft.expires_at` (`NOT NULL`,
immutable) + `expired_at`**, a bounded TTL constant, and a trusted deadline-sweep
worker.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 draft/order state coupling `3967777206` | Deferred (at-commit) constraint-trigger pair on **both** tables checking final committed rows (never `NEW.status`): `APPROVED` ⇔ exactly one order (any state, incl. `CANCELED`); other status ⇔ zero. Preserves `INSERT order -> INSERT snapshot -> flip draft APPROVED`; the `delivery_order`-side trigger reads its draft **without `FOR UPDATE`**, so dispatch/cancellation take no late draft lock; draft-first serialization intact. Closes the gap that `Existing-order integrity` (recovery/cancellation only) leaves. invariant 6 → *The creation transaction*; Idempotency and recovery; Order-creation step 5f; decisions 1 & 8; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; acceptance criteria; schema-slice deps. | Row 49; Example Y |
| P1 stored pickup point + provenance `3967777246` | Future nullable `merchant_locations.resolved_pickup_point` (coordinates + real provider/place id + provenance + source-address binding) or pre-quote snapshot entity, written by a **trusted resolver-persist procedure before pricing** under the existing `draft -> [authority prefix] -> merchant -> location` locks (no `location -> draft` inversion, no fabrication from bare coordinates); an address/coordinate edit clears/invalidates it. The **full point is a member of the canonical fingerprint input list** and of the `pickup_snapshot` shape contract; **step 5a, step 5d and Quote publication** require it present, shape-valid and consistent with the location's current address/coordinates → else `DELIVERY_PICKUP_UNRESOLVED`; a provider/place / source-binding swap under an unchanged address changes the fingerprint (row 46). Recovery checks only the frozen copy — no comparison to the current value, no geocode, no new pickup lock. invariant 4; `delivery_draft` prerequisites; Quote boundary contract (canonical input list; *resolved pickup point before pricing*; *publication validates the priced pickup*); Order-creation steps 5a/5d; `pickup_snapshot` / `delivery_input_fingerprint` fields; Existing-order integrity; `DELIVERY_PICKUP_UNRESOLVED` taxonomy; acceptance criteria; schema + writer deps. | Rows 50, 46; Examples X, K |
| P2 historical quote_state `3967777214` | `delivery_order.quote_state` `NOT NULL` + DB `CHECK` to a closed approvable-value set (fixed before schema activation; history-preserving). Written at INSERT from the step-5c **verified** quote state under the draft/quote serialization, never a request value. `Existing-order integrity` rejects null/unknown/non-approvable stored value → `DELIVERY_ORDER_STATE_INCONSISTENT`, zero writes; never compared to the quote's live state. `delivery_order` field table; Existing-order integrity; Quote boundary contract (*Snapshotted onto the order*); Order-creation steps 5c/5f; decision 2; taxonomy; acceptance criteria; schema-slice deps. | Row 51; Example Y |
| P2 tenant draft `3967777226` | `delivery_draft.merchant_id` `NOT NULL REFERENCES merchants(id)`, every channel/state; concrete merchant resolved before `INSERT`; unresolved intake never persisted as a tenantless draft. Protects the tenant-bound gate, the `(merchant_id, …)` intake dedupe key (nulls compare distinct), and the per-merchant privacy boundary. `delivery_draft` field table + rules; Idempotency and recovery; decision 1; acceptance criteria; schema-slice deps. | Row 52 |
| P2 unknown order at cancellation `3967777236` | **ORDER ABSENT** → early `DELIVERY_ORDER_NOT_FOUND` at step 1, zero writes, **no authority lock taken**. **ORDER PRESENT, caller unauthorized** → step 2 takes the shared authority prefix for the hinted `merchant_id`, step 3's gate fails (`MERCHANT_ACTOR_UNAUTHORIZED` internally, logged), external code **masked** to the same `DELIVERY_ORDER_NOT_FOUND` (no existence disclosure), zero writes. Gate passed → `Existing-order integrity` then the status gate, unchanged. Cancellation steps 1–5; decision 5; `DELIVERY_ORDER_NOT_FOUND` taxonomy; race rows 26 & 53; acceptance criteria. | Rows 26, 53; Example W |
| P2 draft expiry `3967777252` | `delivery_draft` gains immutable server `expires_at = created_at + TTL` (positive bounded constant fixed before intake activation; edits/reprices never extend it; independent of quote expiry) + nullable `expired_at`. Trusted sweep worker, under the draft lock, moves a due `OPEN`/`QUOTED` draft with no order to `EXPIRED`, sets `expired_at`, invalidates quote eligibility — never normalizes corruption. Approval step 4 (before superseded/stale), re-checked step 5c, reject a due-but-unswept draft on the post-lock authoritative wall clock → `DELIVERY_DRAFT_EXPIRED`. **Quote publication** keeps its early step-1 check **and re-reads `clock_timestamp()` at publication step 5, after every merchant/pickup lock is held, immediately before the atomic publish** — a lock wait that crosses the deadline with unchanged inputs still yields `DELIVERY_DRAFT_EXPIRED`, zero writes (nothing published). `APPROVED` draft never expires; ORDER PRESENT recovery/cancellation never evaluate the deadline. `delivery_draft` field table + rules; Order-creation steps 4–5; Quote boundary contract (publication steps 1 & 5); Existing-order integrity; `DELIVERY_DRAFT_EXPIRED` taxonomy; decision 1; acceptance criteria; schema-slice deps. | Row 54; Examples U, V (approval + publication) |

## Review-round 7 proposed resolutions (Codex review 5156335628, head `f539027`)

**Status: proposed docs-only correction; all 43 threads remain open** (13
non-outdated: 7 P1 + 6 P2). The 8 pre-`f539027` non-outdated threads are already
covered by earlier corrections' content and are not re-worked here. Review
`5156335628` on `f539027` adds 5 concerns (3 P1 + 2 P2), all resolved docs-only
below. No migration, runtime, PR metadata or review-thread change is made by this
contract. New additive schema-slice / writer dependencies (flagged, not performed
here): immutable non-null `cargo_policy_version` + **`cargo_policy_decision`** and
a **trusted `INSERT` cargo-policy validator** from the same immutable policy
definition; a row-local **`delivery_draft` state-transition guard**; a row-local
**`delivery_order` initial-status guard** (`PENDING_DISPATCH` only on `INSERT`);
external not-found **masking of cross-tenant approval lookups**; and a
**candidate-quote expiry re-check** in publication step 5.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 enforce cargo policy on persisted orders `3970113008` | Immutable non-null `cargo_policy_version` + `cargo_policy_decision`; trusted `INSERT` validator re-derives categories from `NEW.cargo` and checks them + the stored decision under the **activated** version (from the same immutable definition as the resolver — versioned constant, no admin store); a backfilled `DELIVERABLE` / stale permissive version does not bypass. Existing-order integrity re-checks the stored decision against that version's **retained** definition (historical, not current). Coordinated activation spans resolver + validator + all order writers, and its drain step (2) covers **every already-started order-creation transaction — approval, secondary writers and backfills** — to COMMIT/ROLLBACK; the version is not switched and inserts do not resume until that drain and its confirmation (3) are done. Policy is **not** in the canonical quote fingerprint. invariant 5; Policy-version activation; `delivery_order` field table; Existing-order integrity; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; decision 7; acceptance criteria; next-slice deps. | Row 55; Example Z |
| P1 back terminal draft states with a transition guard `3970113024` | Immediate row-local `BEFORE INSERT OR UPDATE` guard on `delivery_draft`: new `INSERT` `OPEN`; `OPEN -> { QUOTED, ABANDONED, EXPIRED }`; `QUOTED -> { OPEN, APPROVED, ABANDONED, EXPIRED }`; `APPROVED` / `ABANDONED` / `EXPIRED` absorbing; every `OLD -> NEW` incl. intra-transaction UPDATEs. Separate from the deferred coupling; does not replace actor authority / expiry-worker conditions; same-status UPDATE judged by existing intent/repricing/immutability rules. `delivery_draft` rules; decision 1; acceptance criteria; next-slice deps. | Rows 49, 56; Example AA |
| P1 require new orders to start pending dispatch `3970113036` | Row-local `BEFORE INSERT` guard on `delivery_order` permits a **new** row only with `status = PENDING_DISPATCH` (`NOT NULL`; `DEFAULT` insufficient). Not a permanent `CHECK`: lawful downstream `UPDATE`s and recovery of existing `CANCELED` / `DELIVERED` rows preserved; no cross-table lock. `delivery_order` field table; invariant 6; acceptance criteria; next-slice deps. | Row 57; Example AB |
| P2 mask cross-tenant approval lookups `3970113014` | A nonexistent `draft_id` **and any failure of the locked step-2 actor gate for `M` = the locked draft's merchant** (no ACTIVE `(M, U)` membership, role miss, `merchants(M)` not `ACTIVE`, gate resolving another merchant, identity/binding mismatch) → **the same external `DELIVERY_DRAFT_NOT_FOUND`**, zero writes; **no own-merchant exception**. True `MERCHANT_*` / `CONTACT_*` reason internal, logged. Gate always resolved for `M` from the locked draft. Tenant derivation + authority locks before recovery/creation unchanged; frozen Identity/Contact resolver unchanged — only the response mapping. Mirrors cancellation. Order-creation steps 1–2; Approver parity; `DELIVERY_DRAFT_NOT_FOUND` / `MERCHANT_ACTOR_UNAUTHORIZED` taxonomy; race rows 10, 58; acceptance criteria. | Row 58; Example AC |
| P2 reject expired quote candidates before publication `3970113030` | Publication step 5, one post-lock `t = clock_timestamp()`: `t >= draft.expires_at` → `DELIVERY_DRAFT_EXPIRED`; then `t >= candidate_quote.expires_at` → `QUOTE_EXPIRED`; publish only if both pass; zero-write on failure; no timestamp extension. Historical recovery still never re-checks quote expiry vs the current clock. Quote boundary contract — publication step 5; `QUOTE_EXPIRED` taxonomy; race rows 54, 59; acceptance criteria. | Row 59; Example AD |

## Review-round 8 proposed resolutions (Codex review 5159806482, head `1fc6682`)

**Status: proposed docs-only correction; all 52 threads remain open** (17
non-outdated). The 8 pre-`1fc6682` non-outdated threads are already covered by
earlier corrections' content and are not re-worked here. Review `5159806482` on
`1fc6682` adds **9 inline comments = 6 distinct findings (5 P1 + 1 P2)** — three
findings were posted twice (`3972970725`/`3972970754`,
`3972970734`/`3972970759`, `3972970742`/`3972970764`) — all resolved docs-only
below. No migration, runtime, PR metadata or review-thread change is made by this
contract. New additive schema / writer dependencies (flagged, not performed
here): a fresh-`t` two-deadline gate + `NOT NULL` immutable non-backdatable
`delivery_order.created_at`; a deadline-enforced `-> EXPIRED` guard that stamps
`expired_at`; a draft-level composite pickup FK; an immediate intake-dedupe
`UNIQUE` + `CHECK` + `origin_channel NOT NULL`; a trusted transactional creation
procedure (with restricted direct-`INSERT` `GRANT`s) that re-checks current actor
eligibility; and a write-once `delivery_order.cancellation_authority`
discriminator.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 reject expired quotes in the order INSERT guard `3972970725` / `3972970754` | Trusted `INSERT` boundary takes one fresh `t = clock_timestamp()` after all locks/checks: `t < draft.expires_at` (`DELIVERY_DRAFT_EXPIRED`) then `t < referenced_quote.expires_at` (`QUOTE_EXPIRED`), rollback / no order; stamps `created_at := t` (`NOT NULL`, immutable, non-backdatable). All new inserts incl. backfills. Existing-order integrity checks the **historical** relation `created_at < each immutable deadline`, never current time. invariant 6 → *The creation transaction*; Order-creation step 5f; `delivery_order` field table; Existing-order integrity; `DELIVERY_DRAFT_EXPIRED` / `QUOTE_EXPIRED` / `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; decision 8; acceptance criteria; next-slice deps. | Rows 60, 61; Example AE |
| P1 enforce the deadline on transitions to EXPIRED `3972970734` / `3972970759` | Row-local `delivery_draft` transition guard: every `OPEN`/`QUOTED` -> `EXPIRED` (sweep or not) takes a fresh `t_exp` under the row lock, requires `t_exp >= OLD.expires_at`, sets `expired_at := t_exp`; `expired_at` `NULL`/`NOT NULL` by status, `>= expires_at`, immutable; premature / supplied-future / re-stamp rejected. Sweep's no-order + due + quote-invalidation unchanged; no cross-table lock. `delivery_draft` field table + rules; decision 1; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; acceptance criteria; next-slice deps. | Rows 56, 62; Example AA |
| P2 bind explicit draft pickups to the draft merchant `3972970742` / `3972970764` | Draft-level composite FK `(requested_pickup_location_id, merchant_id) -> merchant_locations (id, merchant_id)` (`MATCH SIMPLE`, `RESTRICT`), reusing the unconditional parent key — cross-tenant pickup id never storable on a draft. Ownership only; ACTIVE / default / resolved-point checks stay separate. `delivery_draft` field table; invariant 4; acceptance criteria; next-slice deps. | Rows 11, 63 |
| P1 enforce intake idempotency in the database `3972970769` | Immediate `UNIQUE (merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` + `origin_channel NOT NULL` (closed enum) + `CHECK (adapter_dedupe_token IS NULL OR origin_namespace IS NOT NULL)`. Concurrent full-key redelivery → one draft (loser reads it, no overwrite / deadline extension / terminal resurrection); tokenless `NULL` drafts repeat freely; merchant/channel/namespace independent. `delivery_draft` field table; Idempotency and recovery; decision 8; acceptance criteria; next-slice deps. | Rows 12, 64; Example O |
| P1 validate actor eligibility on every order insert `3972970775` | All new `delivery_order` rows go through one trusted transactional creation procedure (no ordinary direct `INSERT` — future `GRANT` dep); under the fixed lock prefix held to COMMIT/ROLLBACK it re-checks merchant / membership+role / channel identity-proof / binding are **currently** eligible from a trusted actor context and writes provenance from that result — a `REVOKED` tuple fails, no order. No late reverse authority-lock capture in an `INSERT` trigger. Recovery keeps historical tuple checks, never current eligibility; CORRECTED15 external masking unchanged. invariant 6 → *The creation transaction*; Order-creation authority; Existing-order integrity; race rows 3, 65; acceptance criteria; next-slice deps. | Rows 3, 65; Examples S, AF |
| P1 distinguish compensation from unaudited merchant cancellation `3972970785` | New write-once `delivery_order.cancellation_authority` (`MERCHANT | DISPATCH_EXECUTION`), `NULL` until cancellation, `NOT NULL` on every transition to `CANCELED`, set atomically with the evidence that source needs (`MERCHANT`: full verified merchant tuple including non-null `cancellation_provenance`; `DISPATCH_EXECUTION`: separate verifiable compensation reference, with null merchant tuple/provenance). Non-canceled rows carry neither. This slice admits only `MERCHANT` (step 5); `DISPATCH_EXECUTION` closed until a downstream contract + backstop exist; the enum alone never substitutes for the trusted operation. Existing-order integrity checks source + references; a null `cancellation_channel` no longer implies compensation; transition graph unchanged. `delivery_order` field table + Immutability; Cancellation step 5; Existing-order integrity; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; decision 5; acceptance criteria; next-slice deps. | Rows 33, 66, 89; Examples T, AG |

## Review-round 9 proposed resolutions (Codex review 5162786689, head `c6e9130`)

**Status: proposed docs-only correction; all 56 threads remain open** (baseline
`c6e9130`: **9 Codex reviews, 56 threads, 40 outdated, 16 non-outdated, 0
resolved**). The pre-`c6e9130` non-outdated threads are already covered by
earlier corrections' content and are not re-worked here, and no thread is closed
by anchor movement alone. Review `5162786689` on `c6e9130` adds **4 inline
comments = 4 distinct findings (2 P1 + 2 P2)** — no duplicates — all resolved
docs-only below. No migration, runtime, PR metadata or review-thread change is
made by this contract. New additive schema / writer dependencies (flagged, not
performed here): an immediate row-local `delivery_draft` guard extended to reject
any `merchant_id` change and any intake-tuple change; a `BEFORE DELETE` guard on
`delivery_draft` rejecting hard-deletion of a token-backed row; and
`delivery_order.approval_channel` `NOT NULL` + closed enum / `CHECK`. The known
non-blocking **P3 on the Example AF wording** (independent re-audit of round 8) is
**not** in this round's scope.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 make the draft tenant immutable `3975577838` | The immediate row-local `BEFORE INSERT OR UPDATE` guard on `delivery_draft` rejects **any** `OLD.merchant_id -> NEW.merchant_id` change — every status, every writer/backfill, each intra-transaction `UPDATE` — so an `OPEN` / `QUOTED` draft (which otherwise satisfies the pickup FK, transition guard and draft/order coupling) cannot be re-tenanted to another merchant whose actor would then read the recipient PII or re-price / approve it. Allowed draft-intent edits unchanged. `delivery_draft` field table + rules; decision 1; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy (INSERT-time list); acceptance criteria; next-slice deps. | Row 67 |
| P1 preserve the intake dedupe key against `DELETE` / `UPDATE` `3975577846` | The full intake tuple `(merchant_id, origin_channel, origin_namespace, adapter_dedupe_token)` is immutable after `INSERT` (null-safe `IS DISTINCT FROM` guard — no component change, `adapter_dedupe_token -> NULL` included); a `BEFORE DELETE` guard rejects a hard-delete of any token-backed draft (`adapter_dedupe_token IS NOT NULL`) in any status. A redelivery of the original key keeps resolving to the original draft in its recorded status / deadline — no abandoned-or-expired resurrection. Tokenless manual drafts still creatable by separate `INSERT`s. No retention duration or PII-erasure implementation here; a future erasure mechanism must keep the dedupe guarantee (retain the tuple, never hard-delete a token-backed row). `delivery_draft` field table + rules; Idempotency and recovery; decision 1, decision 8; acceptance criteria; next-slice deps. | Rows 68, 69; Example O |
| P2 align the race matrix with the masking rule `3975577842` | Race-matrix rows 2 and 3 now split the **internal, logged** reason (`MERCHANT_INOPERABLE`; `MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`) from the **single external `DELIVERY_DRAFT_NOT_FOUND`** already required by rows 10 / 58 and the `DELIVERY_DRAFT_NOT_FOUND` taxonomy — zero writes, before recovery or creation, both race directions and the lock order preserved, and no "no order" phrasing where an existing order is possible on the recovery path. Concurrency and race matrix rows 2, 3; Order-creation authority step 2; acceptance criteria. | Rows 2, 3 |
| P2 require a non-null approval channel `3975577858` | `delivery_order.approval_channel` is `NOT NULL`, immutable, closed to `SESSION | WHATSAPP | SMS` (DB enum, or `CHECK` on the value set **with** `NOT NULL` — a pair-only `CHECK` passes on `NULL`), written from the trusted proof path actually verified at insert, never inferred from the identity/binding pair or defaulted. **Existing-order integrity** rejects a null / unknown value → `DELIVERY_ORDER_STATE_INCONSISTENT` (alert, zero writes) **before** the identity/binding-tuple check, after current-caller authorization and before recovery / cancellation; historical revocation of a still-matching tuple is not faulted. At this historical round the separate `cancellation_channel` / `canceled_*` NULL-rules were unchanged; the fresh `b3067baf` correction below strengthens the merchant cancellation discriminator. `delivery_order` field table + the `NOT NULL` list; The creation transaction; Existing-order integrity; `DELIVERY_ORDER_STATE_INCONSISTENT` taxonomy; decision 6; acceptance criteria; next-slice deps. | Row 70; Example S |

## Fresh Codex review proposed resolutions (review on `091a07bb`, 2026-09-19)

**Status: proposed docs-only correction; GitHub threads remain unresolved.**
Fresh review on exact published head `091a07bb155bd416507a721fa763d42e44181944`
adds **3 distinct findings: 1 P1 + 2 P2**. This correction is additive/forward:
no migration, runtime, PR metadata, thread resolution, passenger Ride lifecycle,
pricing implementation, WhatsApp runtime, Dispatch or Execution change is made.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 bind resolved destinations to source text `4052770519` | Destination-specific resolved shape now includes versioned `source_text_binding` to canonical `destination_text`; trusted resolver persistence re-reads the text under the draft lock; publication + creation require shape-valid source-consistency; recipient snapshot + fingerprint carry the binding; historical integrity checks frozen text↔binding only. | Race/acceptance row 81 |
| P2 reject blank intake dedupe components `4052770524` | Shared canonicalizers + trusted insert reject blank/whitespace non-null namespace/token; DB nonblank/bounds checks backstop the existing UNIQUE; namespace stays mandatory when token is present; `NULL` token retains repeatable tokenless semantics. | Race/acceptance row 82 |
| P2 validate quote validity window `4052770526` | Canonical validity-window boundary requires server-owned finite non-null immutable `computed_at` / `expires_at` plus durable immutable **`published_at := t_publish`**, positive bounded duration, publication-time coherence and schema/writer backstops; `QUOTE_VALIDITY_INVALID` is distinct from valid-but-expired `QUOTE_EXPIRED`; Existing-order integrity verifies `computed_at <= published_at < expires_at`, retained duration shape + equality without today's clock/policy. | Race/acceptance row 83 |

## Fresh Codex review proposed resolutions (review on `b3067baf`, 2026-09-19)

**Status: proposed docs-only correction; GitHub threads remain unresolved.**
Fresh review on exact published head `b3067baf649c28f3c86e16005c8f0bd1fa277068`
adds **4 distinct findings: 2 P1 + 2 P2**. This correction is additive/forward:
no migration, runtime, PR metadata, thread resolution, review trigger, CI rerun,
passenger Ride lifecycle, pricing implementation, WhatsApp runtime, Dispatch or
Execution change is made.

| Finding / comment | Contract correction | Verification case |
| --- | --- | --- |
| P1 persist an unambiguous current quote identity `4054046297` | Add nullable `delivery_draft.latest_published_quote_id` with same-draft composite FK and restricted writer. Successful publication moves it atomically under the draft lock; failure and invalidation do not. Step 4/5 use exact marker equality, never timestamp/UUID/price order; `APPROVED` marker equals order quote. Round-9 hardening retains every successfully published same-draft row behind a quote-owned hard-delete guard, so q1 remains classifiable after q2 without a ledger/tombstone. Round-10 local audit follow-up requires step 4b to prove successful publication from trusted immutable `published_at`; an addressable same-draft unpublished candidate remains step 4d. | Race/acceptance rows 84, 88 |
| P2 validate cancellation input before lookup `4054046302` | Cancellation step 0 accepts exactly `{ order_id, cancel_reason }`, validates UUID and canonical bounded reason shape before any domain I/O, and rejects extra actor/channel/provenance/timestamp fields as `DELIVERY_CANCEL_INPUT_INVALID`; valid unknown/foreign UUID masking is preserved. | Race/acceptance row 85 |
| P1 constrain merchant cancellation channel `4054046306` | For `cancellation_authority = MERCHANT`, channel and `cancellation_provenance` are non-null, immutable and sourced from the locked proof path; channel is closed to `SESSION`, `WHATSAPP`, `SMS`. `DISPATCH_EXECUTION` and non-canceled rows require merchant provenance null while the separate compensation reference is preserved. Total explicit `IS NULL` / `IS NOT NULL` DB branches and Existing-order integrity check source/channel/provenance before pair branches. | Race/acceptance rows 86, 89 |
| P2 enforce draft intent mutation rules in the row guard `4054046309` | Null-safe comparisons enumerate the confirmed-input set: `OPEN` edit remains `OPEN`; `QUOTED` edit must atomically become `OPEN` and invalidate the retained-marker quote through the trusted draft-first path; same-status `QUOTED` and terminal edits fail. A deferred final-state backstop covers cross-table invalidation. | Race/acceptance row 87 |

## Expected next slices

The same future Quote/Intake/schema slices must implement the five earlier scoped
corrections, the three fresh `091a07bb` corrections, **and the four fresh
`b3067baf` review corrections** before
activation: protected draft INSERT with exact server TTL and immutable
timestamps; protected draft-first abandonment with actor revalidation and atomic
quote invalidation; status-bound cancellation-fact constraints and historical
checks; shared canonical money validation; step-0 pair validation; destination
source-text binding; canonical/nonblank intake-dedupe components; canonical
quote validity-window validation; durable quote-winner identity; cancellation
request preflight and mandatory merchant-channel discriminator; published-quote
retention without a ledger/tombstone; total source-specific cancellation
provenance nullability; and enforced draft-intent mutation/invalidation. The concrete TTL/maximum, monetary domain,
quote-duration bound/version, destination-text binding canonicalizer/version and
source-specific reason bounds/vocabularies must be frozen first. No fallback
values, new endpoints or runtime implementation are authorized by this
correction; no frozen Identity/Contact contract or runtime is modified.

1. `BD-MERCHANT-QUOTE-AUTHORITY-01A` — server quote, expiry, reprice, merchant
   approval semantics feeding this order gate; owns the destination-text binding
   canonicalizer/version and trusted pre-pricing destination resolver persistence,
   plus the server-owned bounded quote validity-window policy/backstop and atomic
   maintenance of `delivery_draft.latest_published_quote_id` under the draft lock;
   each successful publication appends and retains its actual same-draft quote
   row and its immutable `published_at` evidence, approval classification proves
   that evidence before applying marker inequality, and later lifecycle work never
   hard-deletes or reuses the row. Unpublished candidates do not enter published
   history or `QUOTE_SUPERSEDED` classification.
2. `BD-MERCHANT-WHATSAPP-INTAKE-01A` — provider adapter maps inbound messages
   into a `delivery_draft` without becoming authority; owns canonicalization of
   provider namespace/dedupe token before the shared DB nonblank/bounds/UNIQUE
   backstop, preserving `NULL` tokenless semantics.
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
   `UNIQUE (id, merchant_id)` parent keys; `NOT NULL` `pickup_location_id` and
   `pickup_snapshot` with a `pickup_snapshot` shape constraint; the non-null
   quote/draft composite FK and immutable quote owner; nullable
   **`delivery_draft.latest_published_quote_id`** with composite FK
   `(latest_published_quote_id, id) -> quote (id, draft_id)`, restricted direct
   writes, atomic Quote Authority publication maintenance, non-null on `QUOTED` /
   `APPROVED`, and `APPROVED` equality to the order's `quote_id`; quote→draft
   ownership with `ON DELETE RESTRICT`, plus a quote-owned hard-delete guard for
   every successfully published row (including superseded/unreferenced q1),
   immutable identity/owner/payload/fingerprint/publication timestamps, and no
   ledger/tombstone substitute; the approval lookup must positively prove the
   retained same-draft row's successful publication from trusted immutable
   `published_at` before applying marker inequality, while a same-draft candidate
   whose publication never committed falls through to step 4d; the approval and
   cancellation membership-ID/merchant/user composite links backed by additive
   unconditional `merchant_memberships (id, merchant_id, user_id)` uniqueness;
   the approval and cancellation **channel identity/binding** links
   (`approved_/canceled_external_contact_identity_id` +
   `approved_/canceled_merchant_contact_binding_id`, `NOT NULL`-by-channel)
   backed by an additive unconditional `merchant_contact_bindings (id,
   merchant_id, external_contact_identity_id)` unique key and an
   `external_contact_identities` linked-user/channel guard; a total conditional
   cancellation constraint requiring `MERCHANT` to carry non-null immutable
   closed `SESSION | WHATSAPP | SMS` channel + non-null
   `cancellation_provenance`, requiring `DISPATCH_EXECUTION` to carry null
   merchant actor/membership/channel/provenance/pair plus its separate non-null
   verified compensation reference, and requiring non-canceled rows to carry no
   cancellation evidence; every nullable branch uses explicit `IS NULL` /
   `IS NOT NULL` and total `IS TRUE` / `CASE ... ELSE FALSE` semantics;
   deferred
   **well-formed** recipient-snapshot existence at commit plus `NOT NULL` + shape
   constraints on its `recipient_contact` / `destination_text` /
   `destination_point`; an **equality backstop** binding the order's copied
   `quote_amount` / `quote_currency` / `quote_computed_at` / `quote_expires_at`
   and `delivery_input_fingerprint` to the referenced `(quote_id, draft_id)`
   parent's immutable published values, with the snapshot-dependent fingerprint
   recompute **deferred to commit** (permitting `INSERT order -> INSERT recipient
   snapshot`), backed by a Quote Authority guarantee that a published quote's
   identity/owner, payload, fingerprint and publication timestamps are immutable,
   the row is retained for the life of a `quote_id`, and the
   fingerprint carries its canonical-algorithm version; canonical cargo-shape
   enforcement; write-once source-specific cancellation evidence with merchant
   `cancellation_provenance` nullability partitioned from the separate
   compensation reference; non-null pickup coordinates at approval; `resolveCargoDeliveryPolicy`
   versioned constant **plus the coordinated policy-version activation
   procedure**; a `lockActiveMerchantContactBinding` primitive; a **deferred
   at-commit draft/order coupling constraint-trigger pair** (`delivery_draft` and
   `delivery_order`) enforcing `status == APPROVED` ⇔ exactly one order over
   final rows, with a non-locking draft read; a nullable
   **`merchant_locations.resolved_pickup_point`** (or pre-quote pickup snapshot
   entity) — coordinates + provider/place provenance + source-address binding —
   plus a **trusted resolver-persist procedure** that fills it before pricing
   under the existing locks and an invalidate-on-address/coordinate-edit rule;
   **`delivery_order.quote_state` `NOT NULL` + `CHECK`** to a closed approvable
   snapshot-value set; **`delivery_draft.merchant_id` `NOT NULL REFERENCES
   merchants(id)`**; **`delivery_draft.expires_at` (`NOT NULL`, immutable,
   `created_at + TTL`) + nullable `expired_at`**, a positive bounded TTL constant
   fixed before intake activation, and a **trusted deadline-sweep worker**
   (`OPEN`/`QUOTED` + no order + due → `EXPIRED`, under the draft lock, never
   normalizing corruption); immutable non-null **`cargo_policy_version` +
   `cargo_policy_decision`** with a **trusted `INSERT` cargo-policy validator**
   (same immutable policy definition as the resolver; joined into the coordinated
   activation) plus the historical re-check in Existing-order integrity; a
   row-local **`delivery_draft` state-transition/intent guard** (`OPEN` on `INSERT`;
   `OPEN -> QUOTED/ABANDONED/EXPIRED`; `QUOTED -> OPEN/APPROVED/ABANDONED/EXPIRED`;
   terminal states absorbing; every `OLD -> NEW`, intra-transaction included),
   extended with null-safe comparisons of the full confirmed-input set so an
   `OPEN` edit remains `OPEN`, a `QUOTED` edit becomes `OPEN`, and terminal /
   same-status-`QUOTED` edits fail; a restricted trusted draft-first mutation
   procedure plus a deferred draft↔quote final-state constraint trigger emitted
   only for a `QUOTED` confirmed-input edit, capturing its non-null old marker and
   requiring **old quote ineligible AND** either final `OPEN` with the same marker
   or final `QUOTED` with a different lawfully published marker;
   a
   row-local **`delivery_order` `BEFORE INSERT` guard** admitting a new row only
   in `PENDING_DISPATCH` (not a permanent `CHECK`, no cross-table lock); external
   not-found **masking of cross-tenant approval lookups**; the full
   **candidate-quote validity-window backstop** (server-owned finite non-null
   `computed_at` / `expires_at`, positive bounded duration, immutable
   `published_at := t_publish`, and historical
   `computed_at <= published_at < expires_at`) plus its post-lock
   publication-time checks; a **fresh-`t` two-deadline gate at order `INSERT`
   (step 5f)**
   plus **`delivery_order.created_at` `NOT NULL`, immutable, non-backdatable**
   (stamped `:= t`) with the historical `created_at < each immutable deadline`
   re-check in Existing-order integrity; a **deadline-enforced `delivery_draft`
   `-> EXPIRED` guard** that takes a fresh `t_exp >= expires_at` and stamps
   `expired_at` (`NULL`/`NOT NULL` by status, `>= expires_at`, immutable); a
   **draft-level composite FK `(requested_pickup_location_id, merchant_id) ->
   merchant_locations (id, merchant_id)`** (`MATCH SIMPLE`, `RESTRICT`); an
   **immediate `UNIQUE (merchant_id, origin_channel, origin_namespace,
   adapter_dedupe_token)`** with **`origin_channel` `NOT NULL`** (closed enum),
   namespace-required-when-token and bounded/nonblank DB checks for non-null
   canonical namespace/token values; a **trusted transactional
   order-creation procedure** with restricted
   direct-`INSERT` `GRANT`s that re-checks **current** merchant / membership+role
   / channel identity-proof / binding eligibility at insert time; and a
   **write-once `delivery_order.cancellation_authority` (`MERCHANT |
   DISPATCH_EXECUTION`)** discriminator, `NOT NULL` on every `-> CANCELED`, with
   non-null merchant `cancellation_provenance` only for `MERCHANT`, null merchant
   provenance plus the separate verified reference for `DISPATCH_EXECUTION`, all
   cancellation evidence null for non-canceled rows, and the
   `DISPATCH_EXECUTION` path gated on a future
   downstream contract; the row-local `delivery_draft` guard **extended to reject
   any `merchant_id` change and any change to the intake tuple `(merchant_id,
   origin_channel, origin_namespace, adapter_dedupe_token)`** (null-safe, token
   nulling included), plus a **`BEFORE DELETE` guard on `delivery_draft`** that
   rejects a hard-delete of any token-backed row in any status — the concrete
   retention window and PII redaction/erasure are a separate later mechanism that
   must preserve the dedupe guarantee; **`delivery_order.approval_channel`
   `NOT NULL` + closed `SESSION | WHATSAPP | SMS` enum / `CHECK`** written from the
   verified proof path, with the null/unknown re-check in Existing-order
   integrity before the identity/binding tuple; a zero-I/O cancellation request
   preflight for the exact `{ order_id, cancel_reason }` shape and UUID/reason
   validation before any repository call; FK `RESTRICT`; a
   **destination resolved-point shape/backstop with versioned source-text binding**
   (plus trusted resolver persistence and invalidate-on-`destination_text` edit);
   **canonical/nonblank bounded checks for non-null `origin_namespace` and
   `adapter_dedupe_token`** in addition to the existing namespace-required
   relation + UNIQUE; and **quote validity-window schema/writer backstops** for
   server-owned finite non-null immutable `computed_at` / `expires_at`, immutable
   trusted-writer **`published_at := t_publish`**, positive bounded duration,
   `computed_at <= published_at < expires_at`, and retained historical
   validation semantics;
   readiness / concurrency / privacy tests; dark service seam, no public route
   unless separately approved.
