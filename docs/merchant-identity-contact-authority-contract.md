# BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01A

Status: contract-first / docs-only

Issue: #975

Baseline: `main@0d129ad4ea654623d2ec9bfa99bb6eb582f1fb29`

Architecture: Merchant / Identity & Auth / External Messaging / Backend API / PostgreSQL / Privacy

## Purpose

Freeze the minimum server-authoritative identity and contact model required for a business merchant to use BazarDrive delivery without turning `merchant` into a new global `users.role`, without treating an external WhatsApp/SMS contact as a BazarDrive user, and without conflating merchant contacts with delivery recipients.

This slice is contract-only. It adds no migration, repository runtime, route, PWA behavior, Peach automation, webhook, contact mutation, pricing runtime, delivery order, driver dispatch, or delivery execution state machine.

## Existing anchors

This contract composes with the current BazarDriveCloud backend instead of creating a parallel identity space.

- `server/migrations/0001_phase1_init.sql`
  - `users(id)` is the shared FK anchor.
  - `orders.passenger_id` and `rides.passenger_user_id` are passenger-specific and must not be repurposed as merchant identity.
- `server/migrations/0002_auth.sql`
  - phone is the current BazarDrive account identity key.
  - `users.roles` is intentionally limited to granted `passenger|driver` roles.
  - `auth_session.active_role` is intentionally limited to `passenger|driver|NULL`.
- `server/src/repositories/users.js`
  - remains the SQL seam for the current BazarDrive `users` identity row.
- `server/src/services/orders/index.js`
  - currently creates authenticated passenger-owned ride orders.
- `server/src/services/matching/index.js`
  - currently models driver offers and passenger selection.
- `server/src/services/route-price/index.js`
  - remains a dark service seam.
- `server/src/services/availability/index.js`
  - remains a dark presence seam.
- `server/src/repositories/notification_outbox.js`
  - establishes the existing pattern that server-owned event and audience facts are not chosen by the client.

No existing global identity role is widened by 01A.

## Problem

A merchant delivery channel introduces relationships the passenger/driver model cannot represent correctly:

1. One authenticated BazarDrive user may act for one or more merchants.
2. One merchant may have several human operators.
3. A merchant may be contacted through several external channels such as WhatsApp and SMS.
4. Two external contact channels associated with the same merchant are not proof that they belong to the same human.
5. A delivery recipient supplied inside a merchant conversation is not a merchant operator and is not automatically a BazarDrive user.
6. A merchant may have one or more persistent pickup locations, while recipient addresses are per-delivery data.
7. WhatsApp/Peach is a transport channel and must not become the authority for merchant identity, membership, pickup location, or delivery lifecycle.

## Source of truth

The target authority chain is:

```text
users
  |
  | authenticated BazarDrive person
  v
merchant_memberships
  |
  v
merchants -------------------+
  |                           |
  v                           v
merchant_locations      merchant_contact_bindings
                              |
                              v
                     external_contact_identities
                     (WhatsApp / SMS / future channels)
```

The concepts are distinct:

- `users` = authenticated BazarDrive person.
- `merchants` = business account / operating entity inside BazarDrive.
- `merchant_membership` = an authenticated BazarDrive person is authorized to act for a merchant.
- `merchant_location` = persistent merchant pickup/business location.
- `external_contact_identity` = channel-scoped external identity observed or verified through WhatsApp, SMS, or a future provider.
- `merchant_contact_binding` = an external contact is associated with a merchant context.
- delivery recipient = future Delivery Order data, not part of merchant identity.

`merchant_membership` is NOT a new value in `users.roles` or `auth_session.active_role`.

## Authority invariant 1: merchant is not a global user role

The existing global auth contract remains unchanged:

```text
users.roles subset_of { passenger, driver }
auth_session.active_role in { passenger, driver, NULL }
```

Merchant authorization is additive and relational:

```text
isMerchantMember(userId, merchantId)
```

not:

```text
users.active_role == merchant
```

A person may therefore be a driver, passenger, merchant operator, or any combination without opening a second user account or widening the passenger/driver session-role enum.

## Target entity: `merchants`

One row represents one BazarDrive merchant account.

Minimum logical fields for the future 01B schema:

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `display_name` | Human-readable business name. |
| `status` | `ACTIVE | SUSPENDED | CLOSED`. |
| `created_at` | Server creation time. |
| `updated_at` | Last server-owned lifecycle write. |

Not in 01A: legal/tax identity, settlement data, regulated-goods licensing, merchant pricing policy, delivery-order settings, and retention-policy implementation.

## Target entity: `merchant_memberships`

One row associates an authenticated BazarDrive `users(id)` identity with a merchant.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `merchant_id` | FK to `merchants(id)`. |
| `user_id` | FK to `users(id)`. |
| `membership_role` | Merchant-scoped authorization, initially `ADMIN | OPERATOR`. |
| `status` | `ACTIVE | REVOKED`. |
| `granted_at` | Server time. |
| `revoked_at` | Null while active; stamped on revoke. |
| `created_at` | Row creation time. |
| `updated_at` | Last lifecycle write. |

Rules:

- one user may belong to several merchants;
- one merchant may have several members;
- membership never changes the global passenger/driver role set;
- the server derives the acting `user_id` from the authenticated session;
- the client never supplies an authoritative identity for itself.

`ADMIN` means BazarDrive merchant-account administration. It is not a legal-ownership claim about the underlying business.

## Target entity: `merchant_locations`

One row represents a persistent business/pickup location belonging to a merchant.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `merchant_id` | FK to `merchants(id)`. |
| `label` | Store/location label. |
| `address_text` | Human-readable business address. |
| `lat` / `lng` | Nullable typed coordinates once authoritative geocoding exists. |
| `pickup_instructions` | Nullable bounded pickup note. |
| `is_default_pickup` | Whether this is the default pickup location. |
| `status` | `ACTIVE | ARCHIVED`. |
| `created_at` | Server time. |
| `updated_at` | Last write. |

Invariants:

- at most one ACTIVE default pickup location per merchant;
- recipient delivery addresses are never inserted into `merchant_locations`;
- if no unambiguous pickup location can be resolved, downstream delivery creation fails closed or asks for an explicit location instead of guessing.

## Target entity: `external_contact_identities`

One row is one identity on one external communication channel. It is not automatically a BazarDrive user.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `channel` | Initially `WHATSAPP | SMS`; extensible only by ordered contract change. |
| `channel_subject_key` | Opaque channel-scoped stable identifier when available. |
| `phone_e164` | Nullable normalized phone when the channel legitimately exposes it. |
| `display_name` | Nullable mutable presentation label; never an identity key. |
| `linked_user_id` | Nullable FK to `users(id)`, set only after proof that the external identity belongs to that user. |
| `verification_state` | `OBSERVED | VERIFIED | REVOKED`. |
| `created_at` | First server observation. |
| `updated_at` | Last metadata/lifecycle write. |

Identity uniqueness is channel-scoped. A display name, avatar, message wording, common merchant association, or similar-looking phone is never sufficient to merge identities.

If two channel identities are later proven to belong to one BazarDrive user, the records remain separate channel identities and may share the same `linked_user_id`. Their channel provenance is not destroyed by a destructive merge.

## Target entity: `merchant_contact_bindings`

One row associates an external contact identity with a merchant context.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `merchant_id` | FK to `merchants(id)`. |
| `external_contact_identity_id` | FK to `external_contact_identities(id)`. |
| `relationship` | Initially `CONTACT | OPERATOR`. |
| `status` | `ACTIVE | REVOKED`. |
| `bound_at` | Server time. |
| `revoked_at` | Null while active; stamped on revoke. |
| `provenance` | Bounded server-owned provenance label. |
| `created_at` | Row creation time. |
| `updated_at` | Last lifecycle write. |

A binding answers only:

```text
this channel identity is associated with this merchant
```

It does not by itself prove:

```text
this is the same human as another contact
this external contact is an authenticated BazarDrive user
this contact may authorize money, dispatch, refunds, or account administration
```

Those facts require separate authorization or verification.

## Authority invariant 2: no inferred person merge

The server must never merge or cross-link external identities based only on:

- same merchant;
- same display name;
- same avatar;
- conversation style;
- contact-book label;
- recipient data seen inside a message;
- AI inference;
- spatial proximity;
- repeated appearance in merchant conversations.

A contact-to-user link requires explicit evidence owned by an approved server procedure, for example verified phone ownership or an equivalent future provider-authenticated flow.

## Authority invariant 3: recipient is not merchant identity

A recipient sent inside a merchant conversation is delivery data.

Example with masked/synthetic data:

```text
merchant contact:
  "New delivery: Recipient R, +7***, Destination D"

merchant context:
  Merchant M

future delivery recipient:
  Recipient R
  phone +7***
  destination D

NOT merchant member
NOT merchant external contact
NOT BazarDrive user automatically
```

Recipient name, phone, destination, entrance/floor/door code, and requested delivery time belong to the future Merchant Delivery Order contract and must not be promoted into merchant identity tables by this slice.

## Authority invariant 4: provider is transport, BazarDriveCloud is authority

WhatsApp, Peach, SMS, and future providers may carry messages. They do not own:

- merchant identity;
- merchant membership;
- pickup location;
- contact-to-merchant binding;
- quote approval;
- delivery-order lifecycle;
- driver assignment.

Provider objects may be referenced as provenance, but BazarDriveCloud PostgreSQL owns canonical merchant/contact state once runtime lands.

This contract is provider-agnostic and does not depend on Peach Core pipelines or automations.

## Contact resolution contract

A future inbound adapter resolves a message in this order:

```text
(channel, channel_subject_key / normalized phone)
        |
        v
external_contact_identity
        |
        v
ACTIVE merchant_contact_bindings
        |
        +-- 0 merchants  -> EXTERNAL_CONTACT_UNKNOWN
        +-- 1 merchant   -> merchant context resolved
        +-- 2+ merchants -> MERCHANT_CONTEXT_AMBIGUOUS
```

Fail-closed rules:

- unknown contact does not silently become a merchant;
- ambiguous context does not choose the newest, closest, or most-used merchant;
- if one external contact legitimately operates several merchants, downstream intake must carry or request explicit merchant/location context.

## Membership resolution contract

For an authenticated BazarDrive request:

```text
session token
  |
  v
users.id
  |
  v
ACTIVE merchant_membership for requested merchant
```

The server derives the acting user from the session. A client-supplied member or actor id is not authorization proof.

## Contact-to-user linking contract

`external_contact_identities.linked_user_id` is nullable by design.

A channel identity can be useful before it is linked to an authenticated BazarDrive account. Linking later requires explicit proof and is a server-side transition.

A verified link may look like:

```text
external_contact_identity A --+
                              +--> linked_user_id = U
external_contact_identity B --+
```

A and B remain distinct channel identities.

## Write provenance and auditability

Every future write that creates/revokes membership, verifies/revokes an external contact identity, or creates/revokes a merchant contact binding must have server-owned provenance sufficient to answer:

- what changed;
- when;
- through which trusted procedure;
- which authenticated/admin/service actor caused it, where applicable.

The exact audit-ledger schema is deferred to 01B/01C. Runtime code must not rely on free-form client provenance.

## Privacy and data minimization boundary

Allowed identity/contact data is limited to what is required to authenticate a BazarDrive person, associate an external channel identity with a merchant, route merchant communication, and resolve a persistent merchant pickup location.

01A does not authorize permanent storage of:

- recipient door codes;
- recipient apartment/entrance/floor data as profile data;
- recipient message history as profile data;
- unnecessary precise location history;
- payment-card data;
- passport/document data;
- inferred relationship graphs;
- AI-generated personal profiles.

The public repository contract and test fixtures must never contain real customer/merchant phone numbers, private addresses, door codes, chat exports, or other live PII. Worked examples must be synthetic or masked.

## Error taxonomy for future runtime

| Code | Meaning | Retryable |
| --- | --- | --- |
| `MERCHANT_NOT_FOUND` | Requested merchant does not exist or is not active for this operation. | false |
| `MERCHANT_MEMBERSHIP_REQUIRED` | Authenticated user is not an active member of the merchant. | false |
| `EXTERNAL_CONTACT_UNKNOWN` | No external identity/binding resolved. | false |
| `MERCHANT_CONTEXT_AMBIGUOUS` | Contact is bound to more than one possible merchant context. | false |
| `MERCHANT_LOCATION_REQUIRED` | No unique/default pickup location can be resolved. | false |
| `CONTACT_IDENTITY_UNVERIFIED` | Operation requires stronger channel identity proof. | false |
| `CONTACT_LINK_CONFLICT` | Attempt would relink a proven contact identity to a different user without an explicit revoke/relink procedure. | false |
| `MERCHANT_IDENTITY_DEPENDENCY_FAILED` | Authoritative persistence/dependency failed. | true |

## Concurrency and uniqueness invariants for 01B

The future PostgreSQL layer must serialize or constrain at least:

1. one canonical `external_contact_identity` per channel-scoped identity key;
2. no duplicate active `(merchant_id, external_contact_identity_id)` binding;
3. no duplicate active `(merchant_id, user_id)` membership;
4. at most one active default pickup location per merchant;
5. a proven `linked_user_id` cannot be silently overwritten by a different user;
6. revocation timestamps and terminal states are server-stamped;
7. all FK links target existing canonical rows.

Exact indexes, constraints, and lock order are owned by 01B.

## Read boundaries

Safe projections must not expose raw contact PII merely because it exists in the database.

- merchant admin surfaces may show masked contact data according to authorization;
- driver-facing delivery cards must not read merchant identity tables to discover recipient PII;
- public feeds must never serialize merchant phone numbers or external channel IDs;
- a provider adapter receives only routing data required for its operation.

## Relationship to existing Ride/Order model

This contract deliberately does NOT:

- add `merchant` to `users.roles`;
- add `merchant_id` to the current passenger `orders` table;
- write merchants into `orders.passenger_id`;
- write merchants into `rides.passenger_user_id`;
- reuse passenger `matching/offers` semantics for merchant-approved delivery pricing;
- model delivery recipients as BazarDrive passengers;
- create a delivery state machine.

Those are separate slices.

## Relationship to WhatsApp / Peach

```text
WhatsApp / Peach adapter
        |
        | inbound channel identity + message
        v
BazarDriveCloud contact resolver
        |
        +--> merchant context
        +--> later: Merchant Delivery Draft intake
```

The adapter may read/send messages according to provider rules, but it never writes canonical merchant identity by inference from message content.

01A performs no Peach contact mutation and creates no Peach automation, pipeline, broadcast, template, or AI agent.

## Worked examples

### Example A: two channels for one merchant, same human unknown

```text
Merchant M
  +-- WhatsApp contact A
  +-- SMS contact B
```

Known: A and B are both associated with Merchant M.

Unknown: whether A and B are the same human.

Correct storage:

```text
external_contact_identity A
external_contact_identity B
merchant_contact_binding(M, A)
merchant_contact_binding(M, B)
```

No shared `linked_user_id` until independently proven.

### Example B: both channels later prove the same BazarDrive user

```text
external_contact_identity A.linked_user_id = U
external_contact_identity B.linked_user_id = U
```

A and B remain separate channel identities.

### Example C: recipient appears in chat

Merchant contact A sends:

```text
"Delivery to Recipient R, +7***, Destination D"
```

01A creates no merchant identity row for R. The future Delivery Order slice may create a delivery draft with R as recipient.

### Example D: one operator handles two merchants

External contact A has ACTIVE bindings to Merchant M1 and Merchant M2.

An inbound message without explicit context returns `MERCHANT_CONTEXT_AMBIGUOUS`; the server does not choose one by recency.

## 01A acceptance criteria

`BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01A` is complete when docs-only review freezes all of the following:

- Merchant is a separate domain entity, not a new `users.role`.
- Membership is merchant-scoped and references existing `users(id)`.
- Merchant location is distinct from recipient address.
- External contact identity is distinct from BazarDrive `users`.
- Contact-to-merchant binding is explicit and server-owned.
- Two contact channels are never inferred to be one human.
- Recipient data is never auto-promoted to merchant identity.
- WhatsApp/Peach is transport, not business-state authority.
- Unknown/ambiguous contact resolution fails closed.
- Public docs/tests contain no live PII.
- Existing passenger orders, matching, rides, driver authorities, and auth enums remain unchanged.
- 01A adds no route, migration, UI behavior, provider automation, or runtime write.

## Explicit non-goals

- Merchant Delivery Order schema/runtime.
- Recipient address book.
- Route/price implementation.
- Driver availability implementation.
- Delivery dispatch and assignment.
- Delivery execution state machine.
- WhatsApp message extraction / AI parsing.
- Peach pipeline/automation configuration.
- Merchant billing/settlement.
- Legal entity / tax / regulated-goods compliance.
- Merchant admin UI.

## Expected next slices

1. `BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B`
   - PostgreSQL schema for merchants, memberships, locations, external identities, and bindings;
   - repository primitives;
   - readiness/schema/concurrency tests;
   - dark service seam, no public route unless separately approved.

2. `BD-MERCHANT-DELIVERY-ORDER-AUTHORITY-01A`
   - Delivery Draft / recipient / cargo / pickup/dropoff / merchant approval contract.

3. `BD-MERCHANT-QUOTE-AUTHORITY-01A`
   - server quote, expiry, repricing, and merchant approval.

4. `BD-MERCHANT-WHATSAPP-INTAKE-01A`
   - provider adapter maps inbound messages into a Delivery Draft without becoming authority.

5. `BD-MERCHANT-DELIVERY-DISPATCH-01A`
   - driver eligibility + offer dispatch using existing Driver/Vehicle/Shift/Compliance authorities.

6. `BD-MERCHANT-DELIVERY-EXECUTION-01A`
   - pickup -> picked-up -> recipient delivery -> terminal lifecycle.

## Proposed 01B dependency rule

01B may add schema/repositories only after 01A is reviewed and frozen.

It must preserve:

```text
users identity
    +
merchant-scoped authorization
    +
channel-scoped external identity
    +
explicit contact binding
```

without widening passenger/driver auth semantics or writing live PII into repository fixtures.
