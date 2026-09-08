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
  **recovery**: it returns that order — in any state, including `CANCELED` — with
  zero writes, after the access check only (see **Idempotency and recovery**).

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
  (default, or an explicit location supplied with the draft/approval). If no
  unambiguous ACTIVE pickup location resolves, order creation fails closed with
  `MERCHANT_LOCATION_REQUIRED` (01A code); it never guesses and never uses
  recipient data as pickup.
- The destination is recipient-supplied per-delivery data. It is never inserted
  into `merchant_locations` and never promoted to merchant identity.
- The order stores a pickup **snapshot** (location id + label + address text +
  bounded pickup instructions as they were at approval) so later location edits
  do not rewrite a created order.

## Authority invariant 5: cargo deliverability is server-owned policy

Every `delivery_order` carries a non-empty **set** of cargo category codes. Each
code maps, via a server-owned policy, to a deliverability class:

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
- order creation re-checks deliverability against the **current** policy, so a
  category that becomes non-deliverable between quote and approval blocks the
  approval; the resolved `policy_version` is recorded on the order for audit;
- the policy vocabulary is extended only by an ordered contract change, like the
  01A channel enum.

This is the **BazarDrive merchant-delivery product policy**, not a universal
legal statement about any category. `ALCOHOL = IN_STORE_ONLY / NOT_DELIVERABLE`
means only that BazarDrive does not dispatch a driver for it in this product —
nothing more.

## Authority invariant 6: approval and order creation are one atomic transaction

Invariant 6 governs the **creation** branch of the approval transaction (a
**recovery** performs the access check and returns the existing order with zero
writes — see **Order-creation authority**).

In the creation branch, `delivery_draft: QUOTED -> APPROVED` and the `INSERT` of
the `delivery_order` (with its `delivery_order_recipient_snapshot`) occur in
**one** database transaction, after that same transaction has re-validated, in
order:

- the merchant actor — `AUTHORIZED_MERCHANT_ACTOR(U, M)` re-resolved here, never
  carried in from a pre-transaction check;
- quote ownership (belongs to this draft), state (approvable), and
  `now < expires_at`;
- **the quote's `delivery_input_fingerprint`** still equals a fresh canonical
  fingerprint over the current draft inputs (recipient, contact, destination,
  access note, window, cargo set) **and** the freshly-resolved `pickup_snapshot`;
  a mismatch is `QUOTE_STALE`;
- cargo policy over the **whole** cargo set (`resolveCargoDeliveryPolicy`);
- an ACTIVE, unambiguous pickup `merchant_location`.

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
| `origin_ref` | Bounded provider/message/session provenance label. |
| `adapter_dedupe_token` | Nullable bounded provider/adapter dedupe key for **intake idempotency only** (see Idempotency); never a key for order creation. |
| `recipient_name` | Bounded string (mutable draft intent). |
| `recipient_contact` | Bounded normalized recipient phone (reuses the auth phone canonicalizer); recipient is not a `users` row. |
| `destination_text` | Bounded human destination (mutable draft intent). |
| `destination_access_note` | Nullable bounded entrance/floor/door note. |
| `requested_pickup_location_id` | Nullable FK to `merchant_locations(id)`; null means "resolve default". |
| `requested_window` | Nullable bounded requested delivery time window. |
| `cargo` | Non-empty set of cargo category codes. |
| `status` | `OPEN | QUOTED | APPROVED | ABANDONED | EXPIRED`. |
| `created_at` / `updated_at` | Server timestamps. |

Rules:

- a draft authorizes nothing and never dispatches a driver;
- draft recipient / contact / destination / access note / window / cargo fields
  are mutable **intent** while the draft is `OPEN`; they are frozen into
  order-owned snapshots at approval;
- `OPEN -> QUOTED` when a quote is attached; a quote binds to the exact delivery
  inputs it priced (see **Quote boundary contract**);
- **any mutation of those intent fields on a `QUOTED` draft, or any change to the
  canonical content of the resolved pickup location — address edit, coordinate
  change, default flip, archive, even with the same `merchant_location_id` —
  drops the draft `QUOTED -> OPEN` and stales the attached quote**; a fresh quote
  must be computed against the new inputs before approval;
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
| `draft_id` | FK to `delivery_draft(id)`; the intent it was approved from. |
| `merchant_id` | FK to `merchants(id)`. |
| `approved_by_user_id` | FK to `users(id)`; the actor the write-txn gate resolved. |
| `approved_membership_id` | FK to `merchant_memberships(id)`; the membership that authorized it. |
| `approval_channel` | `SESSION | WHATSAPP | SMS`; how the actor was gated. |
| `approval_provenance` | Bounded server-owned provenance (procedure + adapter ref). |
| `quote_id` | FK to the approved quote row (owned by Quote Authority). |
| `quote_amount` / `quote_currency` | Snapshot of the approved quote. |
| `quote_state` | Snapshot of the quote's approvable state as of approval. |
| `quote_computed_at` / `quote_expires_at` | Snapshot of the approved quote's validity window. |
| `pickup_location_id` | FK to `merchant_locations(id)` resolved at approval (ACTIVE). |
| `pickup_snapshot` | Canonical content of the resolved pickup at approval — location id, label, address text, coordinates, bounded pickup instructions, default flag — not just the id. |
| `delivery_input_fingerprint` | Canonical fingerprint over the confirmed delivery inputs (recipient snapshot + cargo set + `pickup_snapshot`) the approved quote priced; equals the quote's stored fingerprint. |
| `cargo` | Snapshot of the approved cargo category set (every member `DELIVERABLE` at approval). |
| `cargo_policy_version` | The `resolveCargoDeliveryPolicy` version that cleared this cargo set. |
| `status` | `PENDING_DISPATCH | CANCELED | <downstream states>`. |
| `canceled_at` / `cancel_reason` | Null unless canceled; server-stamped. |
| `created_at` / `updated_at` | Server timestamps. |

Recipient and destination are **not** columns on `delivery_order` — they are a
1:1 immutable child row, `delivery_order_recipient_snapshot` (below).

Immutability:

- the order's core (draft/merchant/actor/quote/pickup/cargo snapshots and its
  recipient snapshot row) is immutable after creation, enforced by a
  `delivery_order`-owned guard trigger (the `rides_freeze_terminal` /
  notification-outbox pattern), not by convention;
- only lifecycle fields (`status`, `canceled_at`, `cancel_reason`, downstream
  timestamps) may advance, and only forward;
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
| `destination_text` | Bounded human destination, frozen from the draft. |
| `destination_access_note` | Nullable bounded entrance/floor/door note. |
| `requested_window` | Nullable bounded requested delivery window. |
| `created_at` | Server timestamp (= order creation time). |

This is a per-order PII capsule, never a reusable recipient directory: it has no
identity of its own beyond the order FK, is never updated, and is the single
place a narrow driver-facing projection reads recipient data from (that
projection never reads merchant identity/contact tables). A recipient address
book remains an explicit non-goal (01A invariant 3).

## Order-creation authority

An approval request names an exact `(draft_id, quote_id)` pair and runs as one
server transaction that, in order:

1. **Lock.** `SELECT ... FOR UPDATE` the `delivery_draft`.
2. **Access check (always).** Re-resolve the actor gate **inside this
   transaction** to a single `AUTHORIZED_MERCHANT_ACTOR(U, M)` (Approver parity,
   below); a result computed before the transaction is not accepted. This check
   applies to recovery **and** creation — a caller who cannot pass it gets a
   `MERCHANT_*` code whether or not an order already exists.
3. **Recovery branch — keyed strictly on the exact `(draft_id, quote_id)`
   pair:**
   - an existing `delivery_order` for that exact pair is found → **return it with
     zero writes**, in whatever lifecycle state it is, **including `CANCELED` /
     terminal**. No new order, no resurrection. `DELIVERY_ORDER_ALREADY_EXISTS`
     resolves to that row. Quote expiry / supersession / staleness / cargo policy
     are **not** re-evaluated on recovery.
   - the draft is `APPROVED` but its `delivery_order` is for a **different**
     `quote_id` than the one presented → `DELIVERY_APPROVAL_QUOTE_CONFLICT`. No
     write.
   - the draft is `APPROVED` but **no** `delivery_order` exists for it →
     `DELIVERY_ORDER_STATE_INCONSISTENT` (data-integrity fault; alert, never a
     client retry outcome). No write.
4. **No existing order for the pair — an ordered failure priority, applied in
   this exact sequence.** Every outcome below is **zero-write** and leaves the
   draft in the state it was entered in.
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
   a. resolve the pickup `merchant_locations` row (ACTIVE; default or the draft's
      explicit `requested_pickup_location_id`); `MERCHANT_LOCATION_REQUIRED` on
      ambiguity/none;
   b. re-confirm the named quote against step 4 — `QUOTE_SUPERSEDED` (a newer
      quote appeared concurrently), `QUOTE_EXPIRED` (`now >= expires_at`);
   c. recompute the canonical `delivery_input_fingerprint` over the **current**
      draft inputs (recipient, contact, destination, access note, window, cargo
      set) and the freshly-resolved `pickup_snapshot`; `QUOTE_STALE` if it does
      not equal the quote's stored fingerprint — this catches a pickup-content
      edit that reached the approval before the draft revert propagated
      (non-retryable — a fresh quote is required);
   d. `resolveCargoDeliveryPolicy` over the whole cargo set;
      `CARGO_CATEGORY_UNKNOWN` / `CARGO_NOT_DELIVERABLE` fail closed;
   e. `INSERT` exactly one `delivery_order` and its
      `delivery_order_recipient_snapshot`, and flip the draft `QUOTED ->
      APPROVED`, all in this transaction (invariant 6).

The acting user, membership, grantor, verifier, and provenance are all
server-resolved. A request body never chooses the approver, the merchant, the
quote amount, the fingerprint, or the cargo deliverability.

## Approver parity: same right, independent proof

An authenticated **session** actor and a **verified channel** actor have the
**same** order-approval right; they do not share a proof path.

```text
session actor:
  server-resolved users.id = U     (from the session, never the request body)
  -> ACTIVE merchant_membership(U, M)
  -> membership_role in { ADMIN, OPERATOR }
  => AUTHORIZED_MERCHANT_ACTOR(U, M)

channel actor:
  external_contact_identity.status = ACTIVE
  AND channel_proof = VERIFIED
  AND linked_user_id = U
  AND ACTIVE merchant_contact_binding(identity, M)
  AND merchant.status = ACTIVE
  AND ACTIVE merchant_membership(U, M)
  AND membership_role in { ADMIN, OPERATOR }
  => AUTHORIZED_MERCHANT_ACTOR(U, M)
```

Both normalize to one internal `AUTHORIZED_MERCHANT_ACTOR(U, M)` result and both
are re-resolved inside the order-creation transaction (invariant 6). Delivery
approval permits `membership_role in { ADMIN, OPERATOR }`. A downstream operation
contract may require `ADMIN` for a stronger action, but may not widen this set
and may not accept contact binding or resolved context alone.

## Idempotency and recovery

- **Authoritative order creation/recovery keys strictly on
  `UNIQUE (draft_id, quote_id)`** — a hard authority invariant. A draft
  transitions `QUOTED -> APPROVED` exactly once and `APPROVED` is terminal for
  the draft, so **a draft has at most one `delivery_order`, ever.**
- **Recovery** (an approval naming the exact `(draft_id, quote_id)` of an
  existing order) is the guard for the "transaction committed, the confirmation
  response was lost, WhatsApp/Peach redelivered the approval" case. After the
  in-transaction access check, the existing `delivery_order` is returned with
  **zero writes**, in **any** lifecycle state **including `CANCELED` /
  terminal**. A retry never creates a second order, never resurrects a canceled
  one, and never re-checks quote expiry / supersession / staleness / cargo
  policy. `DELIVERY_ORDER_ALREADY_EXISTS` resolves to that row.
- Draft `APPROVED`, order exists for a **different** `quote_id` →
  `DELIVERY_APPROVAL_QUOTE_CONFLICT`. No write.
- Draft `APPROVED`, **no** order → `DELIVERY_ORDER_STATE_INCONSISTENT`
  (data-integrity fault). No write.
- **New creation is reached only from a `QUOTED` draft with its current,
  non-superseded quote and no order.** For any other "no existing order" state,
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
  `(merchant_id, origin_channel, adapter_dedupe_token)` — an intake dedupe key
  **only**, never a second, competing key for authoritative order creation, which
  keys strictly on `(draft_id, quote_id)`.

## Cancellation

- Direct merchant cancellation through Delivery Order Authority is allowed **only
  while the order is `PENDING_DISPATCH`**. An `AUTHORIZED_MERCHANT_ACTOR`
  (`ADMIN|OPERATOR`) performs a terminal `PENDING_DISPATCH -> CANCELED`
  transition, server-stamped and `cancel_reason`-coded, never a hard delete.
- The instant `BD-MERCHANT-DELIVERY-DISPATCH-01A` atomically moves the order out
  of `PENDING_DISPATCH` (into `SEARCHING_DRIVER`), direct merchant-cancel through
  Order Authority is **forbidden** (`DELIVERY_ORDER_NOT_CANCELABLE`). Any later
  cancellation or abort runs through the Dispatch/Execution **compensation
  flow**, which owns driver/recipient-initiated cancellation, refund/settlement
  effects, and in-flight-cargo handling.
- `PENDING_DISPATCH -> CANCELED` and `PENDING_DISPATCH -> SEARCHING_DRIVER`
  serialize on the order row; exactly one wins (race-matrix row 15), the loser
  gets `DELIVERY_ORDER_NOT_CANCELABLE` or a no-op.
- Abandoning a draft (`ABANDONED`) before any order exists is always allowed to
  the same actors and creates no order.

## Quote boundary contract

Quote computation, reprice, surge, `expires_at` duration, and the fingerprint
algorithm are entirely `BD-MERCHANT-QUOTE-AUTHORITY-01A`. Delivery Order
Authority defines only the boundary it consumes:

- **Every quote binds to the exact delivery inputs it priced.** Quote Authority
  stores, on the quote, a canonical `delivery_input_fingerprint` over: the
  recipient snapshot (name, contact, destination, access note, window), the
  canonically-ordered cargo set, and the resolved `pickup_snapshot` — the pickup
  `merchant_location` id **plus** its canonical content (label, address text,
  coordinates, pickup instructions, default flag). A bare `pickup_location_id` is
  **not** sufficient: a merchant can edit a store's address while keeping the
  same id.
- **Required at approval (creation branch):** a `quote_id` that is the current
  quote for the draft, in an approvable state, with `now < expires_at`, whose
  `delivery_input_fingerprint` still equals a fresh fingerprint over the current
  draft inputs and resolved pickup.
- **Snapshotted onto the order** (immutable): `quote_id`, `quote_amount`,
  `quote_currency`, `quote_state`, `quote_computed_at`, `quote_expires_at`,
  `delivery_input_fingerprint`.
- Approval-time quote rejections — all zero-write, non-retryable (the fix is a
  fresh quote, not a retry), and **none is re-evaluated on a recovery** (exact
  `(draft_id, quote_id)` match): `QUOTE_SUPERSEDED` (a newer quote exists for the
  draft — checked for `OPEN` and `QUOTED` alike, and **before** `QUOTE_STALE`),
  `QUOTE_STALE` (the presented quote was invalidated by a confirmed-input /
  resolved-pickup change and is **not** superseded), `QUOTE_EXPIRED`
  (`now >= expires_at`). The exact ordered priority is fixed in
  **`## Order-creation authority`** step 4.
- A reprice creates a new quote; it never mutates an already-created order. The
  order's own lifecycle is not bounded by `quote_expires_at` — an approved order
  does not "expire".
- Delivery Order Authority stores no quote line items, pricing inputs, or
  computation state — only the snapshot fields above.

## Concurrency and race matrix

The future PostgreSQL layer must serialize or constrain at least:

| # | Race | Required outcome |
| --- | --- | --- |
| 1 | Two concurrent **creation** approvals of one `QUOTED` draft | Exactly one `delivery_order`; the loser recovers the same row (`DELIVERY_ORDER_ALREADY_EXISTS`). |
| 2 | Approval vs. merchant `SUSPENDED`/`CLOSED` | Fail closed (`MERCHANT_INOPERABLE`); the in-txn actor re-resolve sees the negative state — applies to recovery and creation. |
| 3 | Approval vs. membership `REVOKED` | Fail closed (`MERCHANT_MEMBERSHIP_REQUIRED` / `MERCHANT_ACTOR_UNAUTHORIZED`) — applies to recovery and creation. |
| 4 | **Creation** vs. quote crossing `expires_at` | `QUOTE_EXPIRED`; no order. |
| 5 | Approval of a quote for which a **newer quote exists** for the draft — draft `OPEN` **or** `QUOTED` | `QUOTE_SUPERSEDED` (step 4b); checked **before** `QUOTE_STALE`; approval must name the current quote. |
| 6 | **Creation** vs. pickup `merchant_location` `ARCHIVED` | `MERCHANT_LOCATION_REQUIRED`; re-resolve, no stale pickup. |
| 7 | A confirmed draft input change (recipient/contact/destination/access note/window/cargo) on a `QUOTED` draft, then approval of that quote (no newer quote) | Change drops the draft `QUOTED -> OPEN` and invalidates the quote; approval resolves at **step 4c** → `QUOTE_STALE`, zero writes, draft stays `OPEN`; no order until a fresh quote is approved. |
| 8 | The resolved pickup location's canonical content edited (same `merchant_location_id`) so close to approval that the draft revert has not propagated | Draft still `QUOTED` → **creation branch** step 5c recomputes the fingerprint over the fresh `pickup_snapshot`, sees the mismatch → `QUOTE_STALE`; no order. |
| 9 | **Creation** vs. cargo policy change (category becomes non-deliverable) between quote and approval | Re-check against current policy; `CARGO_NOT_DELIVERABLE`; no order. |
| 10 | Retry naming the exact `(draft_id, quote_id)` of an existing order, after that quote has since expired / been superseded | **Recovery**: return the existing order, zero writes; expiry/supersession/staleness are not re-checked. |
| 11 | Retry naming the exact `(draft_id, quote_id)` of an order that was `CANCELED` | **Recovery**: return the `CANCELED` order, zero writes; never a new order, never resurrection. |
| 12 | Second approval of an `APPROVED` draft naming a **different** `quote_id` | `DELIVERY_APPROVAL_QUOTE_CONFLICT`; no order. |
| 13 | Approval of a draft that is `APPROVED` with **no** `delivery_order` | `DELIVERY_ORDER_STATE_INCONSISTENT` (integrity fault); no write. |
| 14 | Adapter redelivery of the same inbound approval | Recovery by exact `(draft_id, quote_id)`; returns the same order, zero writes. |
| 15 | Merchant cancel vs. `PENDING_DISPATCH -> SEARCHING_DRIVER` | Serialize on the order row; exactly one of {`CANCELED`, `SEARCHING_DRIVER`} wins; the loser gets `DELIVERY_ORDER_NOT_CANCELABLE` or a no-op. After `SEARCHING_DRIVER`, merchant-cancel via Order Authority is refused. |
| 16 | Creation transaction rolls back mid-way | No `APPROVED` draft and no `delivery_order`/recipient snapshot are left behind (invariant 6). |
| 17 | All FK links (draft, merchant, membership, quote, pickup location) | Target existing canonical rows; `RESTRICT` on delete of a referenced parent. |

Exact indexes, constraints, lock order, and DDL are owned by the schema slice
that follows this contract; it must implement these outcomes, not reinterpret
them.

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
| `DELIVERY_RECIPIENT_INCOMPLETE` | Missing recipient contact or destination. | false |
| `DELIVERY_DESTINATION_UNRESOLVED` | Destination text cannot be accepted as a deliverable point. | false |
| `QUOTE_REQUIRED` | The approval request named no `quote_id` (request-shape error). | false |
| `QUOTE_SUPERSEDED` | A newer quote exists for the draft; **approval** must name the current quote. Checked for `OPEN` and `QUOTED` drafts alike, and **before** `QUOTE_STALE` — step 4b. | false |
| `QUOTE_EXPIRED` | `now >= quote.expires_at` at approval; obtain a fresh quote. | false |
| `QUOTE_STALE` | The presented quote for this draft was invalidated by a confirmed-input / resolved-pickup change after it was priced **and is not superseded** — step 4c, or the creation-branch fingerprint recompute (step 5c). Obtain a fresh quote. | false |
| `CARGO_CATEGORY_UNKNOWN` | A cargo code is not in the server policy vocabulary. | false |
| `CARGO_NOT_DELIVERABLE` | Cargo set contains a non-deliverable category (e.g. `ALCOHOL`). | false |
| `DELIVERY_ORDER_ALREADY_EXISTS` | Recovery replay; resolves to the existing order (any state, incl. `CANCELED`). | false |
| `DELIVERY_APPROVAL_QUOTE_CONFLICT` | Draft is `APPROVED` for a different `quote_id` than the one presented. | false |
| `DELIVERY_ORDER_STATE_INCONSISTENT` | Draft is `APPROVED` but no `delivery_order` exists — a data-integrity fault, not a client-retry condition. | false |
| `DELIVERY_ORDER_NOT_CANCELABLE` | Order is past the merchant-cancel boundary. | false |
| `DELIVERY_ORDER_DEPENDENCY_FAILED` | Authoritative persistence/dependency failed. | true |

Downstream Dispatch/Execution contracts may define stronger operation-specific
codes; they may not downgrade the order-creation gate to a context lookup.

## Downstream boundary

| Slice | Owns |
| --- | --- |
| `BD-MERCHANT-QUOTE-AUTHORITY-01A` | Quote computation, reprice, surge, `expires_at` duration, quote lifecycle. This contract consumes only the approved-quote snapshot fields listed under **Quote boundary contract**. |
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
2. `delivery_draft` d1: recipient R / +7*** / D / access note / window /
   `cargo = { COOKED_CRAYFISH }` / pickup = M's default location. Status `OPEN`.
3. Quote Authority computes quote q1 (amount, `expires_at = now + T`).
   d1 -> `QUOTED`.
4. Contact A approves q1. Order-creation txn re-resolves
   `AUTHORIZED_MERCHANT_ACTOR(U, M)`, resolves M's ACTIVE default pickup,
   validates q1 unexpired/current, `COOKED_CRAYFISH` = `DELIVERABLE`.
5. One `delivery_order` o1 (`PENDING_DISPATCH`) with all snapshots; d1 -> `APPROVED`.
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
  so the **creation branch** runs. Step 5c recomputes the fingerprint over the
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

### Example H: end-to-end ("Морской Разливной")

```text
WhatsApp message
    -> persisted delivery_draft            (non-authoritative)
    -> Quote Authority
    -> QUOTED
    -> AUTHORIZED_MERCHANT_ACTOR confirms (draft_id, quote_id)
    -> [ single transaction ]
         lock draft ; re-resolve actor          (access check — all branches)
         order exists for (draft_id, quote_id)  -> recovery: return it, 0 writes
         no order -> step-4 ordered priority (all 0 writes):
           terminal draft                       -> DELIVERY_DRAFT_NOT_APPROVABLE
           own quote superseded (OPEN|QUOTED)    -> QUOTE_SUPERSEDED
           OPEN + own quote invalidated, !super  -> QUOTE_STALE
           other OPEN / non-matching quote       -> DELIVERY_DRAFT_NOT_APPROVABLE
           QUOTED + current non-superseded quote -> creation branch:
             check quote current / not expired
             recompute delivery_input_fingerprint == quote's  (else QUOTE_STALE)
             check cargo policy (cooked + live crayfish DELIVERABLE)
             check ACTIVE unambiguous pickup location
             draft QUOTED -> APPROVED  +  INSERT delivery_order (+ recipient snapshot)
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
  (session or verified channel — Approver parity), re-resolved inside the write
  transaction; `membership_role in { ADMIN, OPERATOR }`.
- `delivery_draft: QUOTED -> APPROVED` and the `delivery_order` (+ its 1:1
  `delivery_order_recipient_snapshot`) insert are **one atomic transaction**
  (invariant 6): no `APPROVED` draft without an order, no order without an
  `APPROVED` draft, full rollback on any re-validation failure.
- A `delivery_order` has exactly one recipient and one destination, held in a 1:1
  immutable snapshot child, not columns and not an address book; multi-stop
  batching is a separate downstream entity.
- Pickup resolves from ACTIVE `merchant_locations`; recipient/destination data is
  never written to merchant identity tables and never used as pickup.
- `COOKED_CRAYFISH` and `LIVE_CRAYFISH` are `DELIVERABLE`; `ALCOHOL` is
  `NOT_DELIVERABLE` / `IN_STORE_ONLY` (BazarDrive product policy, not a legal
  claim) and blocks order creation.
- Cargo deliverability is a **server-owned versioned constant** behind
  `resolveCargoDeliveryPolicy`, evaluated over the whole set; unknown categories
  fail closed; the policy version is recorded on the order.
- A quote binds to **all** confirmed delivery inputs — recipient, contact,
  destination, access note, window, cargo set — **and** the canonical
  `pickup_snapshot` (location id plus its content), via a
  `delivery_input_fingerprint` on the quote. Mutating any of those on a `QUOTED`
  draft, or editing the resolved pickup content (even with the same id), drops
  the draft to `OPEN` and stales the quote; a mismatch at creation is
  `QUOTE_STALE` and forces a fresh quote + re-approval.
- Approving an expired, superseded, or stale quote does not create an order; the
  order snapshots only the boundary quote fields (incl. the fingerprint), never
  quote computation state.
- Order creation/recovery keys strictly on `UNIQUE (draft_id, quote_id)`; a draft
  has at most one `delivery_order`, ever; the adapter dedupe token is scoped to
  draft ingestion only; concurrent creations yield exactly one order.
- **Recovery** is keyed strictly on the exact `(draft_id, quote_id)`: a matched
  pair returns the existing order — in **any** state, including `CANCELED` — with
  **zero writes**, after the access check only, and does not re-check
  expiry/supersession/staleness/cargo policy. Draft `APPROVED` + different quote →
  `DELIVERY_APPROVAL_QUOTE_CONFLICT`; draft `APPROVED` + no order →
  `DELIVERY_ORDER_STATE_INCONSISTENT`. New creation is reached only from a
  `QUOTED` draft.
- The `## Order-creation authority` dispatch is `lock → always-on access check →
  recovery → step-4 no-order priority → creation`. The **step-4 priority** is
  fixed and applied in sequence: (a) terminal draft →
  `DELIVERY_DRAFT_NOT_APPROVABLE`; (b) presented own quote **superseded**
  (`OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`, **before** staleness; (c) `OPEN`
  with the presented own quote **invalidated and not superseded** →
  `QUOTE_STALE`; (d) any other `OPEN` / non-matching quote →
  `DELIVERY_DRAFT_NOT_APPROVABLE`; (e) a `QUOTED` draft with its current
  non-superseded quote → creation. Every rejection is **zero-write** and
  preserves the entry state. The creation-branch fingerprint recompute (step 5c)
  also yields `QUOTE_STALE` for a pickup-content edit that reached approval
  before the draft revert propagated.
- A `CANCELED` `delivery_order` is never re-created or resurrected from the same
  draft; a further delivery is a **new draft + new quote + new order**.
- Merchant cancellation via Order Authority is allowed **only in
  `PENDING_DISPATCH`**; once Dispatch atomically claims the order
  (`SEARCHING_DRIVER`), cancellation runs through the Dispatch/Execution
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
- Retention/erasure implementation for recipient PII.

## Settled architectural decisions

No open architectural decisions remain. The eight items raised during drafting
are resolved as follows and are load-bearing for the contract above:

1. **Draft persistence.** `delivery_draft` is a **persisted** server-side entity.
   Persisted is not authoritative: WhatsApp/Peach/manual intake may create or
   augment it, and it is the durable anchor for quoting, expiry, dedupe, and
   recovery after a lost confirmation response — but only an
   `AUTHORIZED_MERCHANT_ACTOR` approval turns `draft + quote` into a
   `delivery_order`.
2. **Quote ownership split.** Confirmed. Quote computation, reprice, surge, and
   `expires_at` duration stay entirely in `BD-MERCHANT-QUOTE-AUTHORITY-01A`. This
   contract owns only the **Quote boundary contract**: the `quote_id`, state,
   expiry check, and the fixed set of immutable snapshot fields the order carries.
3. **Recipient shape.** Recipient/destination is a **1:1 immutable child row**,
   `delivery_order_recipient_snapshot`, one per `delivery_order`, written in the
   creation transaction and never updated — a per-order PII capsule, explicitly
   not a reusable recipient address book.
4. **Cargo cardinality.** A **set** of cargo categories per order. Cooked + live
   crayfish for one recipient at one stop is one order. `resolveCargoDeliveryPolicy`
   evaluates the whole set and fails closed on the first non-deliverable/unknown
   member; any `ALCOHOL` blocks the whole order. Incompatible handling
   requirements among deliverable members are a separate Execution policy result,
   not a reason to split one recipient/stop into multiple orders.
5. **Cancel/dispatch cutover.** Merchant cancel via Order Authority ends
   **strictly at `PENDING_DISPATCH`**. Once Dispatch atomically claims the order
   (`SEARCHING_DRIVER`), direct merchant-cancel is refused
   (`DELIVERY_ORDER_NOT_CANCELABLE`); later cancellation runs through the
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
   product policy, not a universal legal statement.
8. **Idempotency key.** Authoritative order creation/recovery keys **strictly on
   `UNIQUE (draft_id, quote_id)`**. Because `APPROVED` is terminal for the draft,
   a draft yields **at most one `delivery_order`, ever**. A retry naming the
   exact `(draft_id, quote_id)` of an existing order is a **recovery** — after
   the access check it returns that order, in **any** state including `CANCELED`,
   with **zero writes**, and re-checks nothing else. `APPROVED` + a different
   `quote_id` → `DELIVERY_APPROVAL_QUOTE_CONFLICT`; `APPROVED` + no order →
   `DELIVERY_ORDER_STATE_INCONSISTENT`. A canceled order is never resurrected —
   a further delivery is a **new draft**. The provider/adapter dedupe token
   applies to **draft ingestion only** and is never a second competing key for
   order creation.

Additional load-bearing invariants fixed in this round:

- **Quote ↔ input binding (P1).** A quote carries a `delivery_input_fingerprint`
  over recipient/contact/destination/access-note/window, the cargo set, and the
  resolved `pickup_snapshot` (id **plus** content). Mutating any of those on a
  `QUOTED` draft, or editing the resolved pickup content with the same
  `merchant_location_id`, drops the draft `QUOTED -> OPEN` and stales the quote;
  a creation-branch fingerprint mismatch is `QUOTE_STALE`.
- **Recovery / creation split (P2).** `## Order-creation authority` runs a lock +
  always-on access check, then: **recovery** (exact `(draft_id, quote_id)` →
  return existing order, zero writes, incl. `CANCELED`); then — for any "no
  existing order" state — the **step-4 ordered priority**: (a) terminal draft →
  `DELIVERY_DRAFT_NOT_APPROVABLE`; (b) presented own quote **superseded**
  (`OPEN` or `QUOTED`) → `QUOTE_SUPERSEDED`; (c) `OPEN` with the presented own
  quote invalidated and **not** superseded → `QUOTE_STALE`; (d) any other `OPEN`
  / non-matching quote → `DELIVERY_DRAFT_NOT_APPROVABLE`; (e) a `QUOTED` draft
  with its current non-superseded quote → **creation** (pickup + quote re-confirm
  + fingerprint + cargo policy → atomic `INSERT` + `QUOTED -> APPROVED`). Every
  rejection is zero-write and preserves the entry state — there is no shared
  "draft stays `OPEN`" rule.
- **invariant 6** governs only the creation branch — `QUOTED -> APPROVED` and the
  `delivery_order` (+ recipient snapshot) `INSERT` are one atomic DB transaction
  after in-transaction re-validation of actor, quote ownership/state/expiry,
  `delivery_input_fingerprint`, cargo policy, and pickup eligibility; neither an
  `APPROVED` draft without its order nor an order without an `APPROVED` draft may
  exist.

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
5. Schema slice (`-01B`-equivalent) — PostgreSQL tables, immutability triggers,
   partial-unique/idempotency indexes, FK `RESTRICT`, cargo policy, readiness /
   concurrency / privacy tests; dark service seam, no public route unless
   separately approved.
