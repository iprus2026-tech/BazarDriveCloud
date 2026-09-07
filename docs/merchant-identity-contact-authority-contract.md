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
- `server/src/services/auth/phone.js`
  - owns the existing BazarDrive phone canonicalization used when a channel's canonical subject is a phone number.
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
- `server/src/repositories/notification_outbox.js` and its frozen contract
  - establish the pattern that server-owned audience/provenance facts are not chosen by the client and that operational logs do not emit raw user payloads.

No existing global identity role is widened by 01A.

## Problem

A merchant delivery channel introduces relationships the passenger/driver model cannot represent correctly:

1. One authenticated BazarDrive user may act for one or more merchants.
2. One merchant may have several human operators.
3. A merchant may be contacted through several external channels such as WhatsApp and SMS.
4. Two external contact channels associated with the same merchant are not proof that they belong to the same human.
5. A delivery recipient supplied inside a merchant conversation is not a merchant operator and is not automatically a BazarDrive user.
6. A merchant may have one or more persistent pickup locations, while recipient addresses are per-delivery data.
7. WhatsApp/Peach is a transport channel and must not become the authority for merchant identity, membership, pickup location, quote approval, dispatch, or delivery lifecycle.
8. Resolving a contact to a merchant context is not enough to authorize an economically binding action on behalf of that merchant.
9. Revoked/suspended/closed state in one layer must not be bypassed by stale ACTIVE state in another.
10. External identity lookup must have one canonical key, not an ambiguous provider-subject-or-phone heuristic.

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
- `external_contact_identity` = one canonical channel-scoped external identity.
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

Lifecycle:

```text
ACTIVE <-> SUSPENDED
ACTIVE|SUSPENDED -> CLOSED
CLOSED = terminal
```

`ACTIVE` is the only state operable for merchant delivery intake/authorization. `SUSPENDED` preserves the account for investigation/recovery but is fail-closed for merchant operational writes. `CLOSED` is terminal.

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
| `revoked_at` | Null while ACTIVE; stamped on revoke. |
| `created_at` | Row creation time. |
| `updated_at` | Last lifecycle write. |

Rules:

- one user may belong to several merchants;
- one merchant may have several members;
- membership never changes the global passenger/driver role set;
- the server derives the acting `user_id` from the authenticated session;
- the client never supplies an authoritative identity for itself;
- `ACTIVE -> REVOKED` is terminal for a membership row;
- a later re-grant is a new row, not resurrection of the revoked row.

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
- only ACTIVE locations are eligible for pickup/default resolution;
- recipient delivery addresses are never inserted into `merchant_locations`;
- if no unambiguous pickup location can be resolved, downstream delivery creation fails closed or asks for an explicit location instead of guessing;
- ARCHIVED-location reactivation policy is deferred and cannot be inferred from incoming delivery data.

## Target entity: `external_contact_identities`

One row is one identity on one external communication channel. It is not automatically a BazarDrive user.

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID PK. |
| `channel` | Initially `WHATSAPP | SMS`; extensible only by ordered contract change. |
| `subject_namespace` | Adapter-defined namespace for the stable channel subject, including provider/account/business-number scope where needed. |
| `canonical_subject_key` | The one canonical subject used for identity lookup inside that namespace. |
| `phone_e164` | Nullable normalized phone attribute when legitimately exposed; not a second identity key unless that channel contract defines the phone itself as the canonical subject. |
| `display_name` | Nullable mutable presentation label; never an identity key. |
| `status` | `ACTIVE | REVOKED`. |
| `channel_proof` | `OBSERVED | VERIFIED`; proves only the channel subject under the adapter/provider contract. |
| `linked_user_id` | Nullable FK to `users(id)`, set only after separate proof that this external identity belongs to that BazarDrive user. |
| `linked_at` | Nullable server timestamp; non-null iff `linked_user_id` is non-null. |
| `created_at` | First server observation. |
| `updated_at` | Last metadata/lifecycle write. |

Lifecycle:

```text
ACTIVE -> REVOKED
REVOKED = terminal for that canonical channel identity row
```

A revoked row cannot be revived merely because another inbound message arrives.

### Canonical external-identity key

Every channel adapter MUST map an inbound sender to exactly one canonical tuple:

```text
(channel, subject_namespace, canonical_subject_key)
```

There is no ambiguous `provider subject OR normalized phone` lookup.

For a channel whose authoritative subject is a phone number, for example a plain SMS adapter, the adapter reuses BazarDrive's existing canonicalization semantics in `server/src/services/auth/phone.js`: strip non-digits, restore one leading `+`, then validate the canonical `+digits` form. Merchant Identity must not invent another phone-normalization algorithm.

For a channel with a stable provider subject, that provider subject is the canonical key and `phone_e164` is metadata unless a separately reviewed adapter contract says otherwise.

A future provider-key migration/alias mechanism is an ordered follow-up. Runtime code must never silently rewrite a canonical subject, fall back from one namespace to another, or merge identities because two identifiers look related.

Logical uniqueness is exactly one `external_contact_identity` per canonical tuple. If provider/migration facts resolve to conflicting canonical identities, the result is `EXTERNAL_CONTACT_IDENTITY_CONFLICT`; the server does not auto-merge or choose one by recency.

### Channel proof is not BazarDrive-user proof

`channel_proof == VERIFIED` means only that the adapter's trusted verification procedure has established the channel subject according to that provider's contract.

It does NOT mean:

```text
this external identity is a BazarDrive user
this external identity is a merchant member
this external identity may approve money or dispatch
```

Those are separate facts composed below.

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
| `revoked_at` | Null while ACTIVE; stamped on revoke. |
| `provenance` | Bounded server-owned provenance label. |
| `created_at` | Row creation time. |
| `updated_at` | Last lifecycle write. |

Lifecycle:

```text
ACTIVE -> REVOKED
REVOKED = terminal
```

A later legitimate re-bind is a new row.

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

A contact-to-user link requires explicit evidence owned by an approved server identity-verification procedure, for example verified control of the same canonical phone/account under a reviewed flow.

If two external contact identities are later proven to belong to one BazarDrive user, they remain separate channel identities and may share the same `linked_user_id`; provenance is not destroyed by a destructive merge.

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
- BazarDrive user linking;
- quote approval;
- delivery-order lifecycle;
- driver assignment.

Provider objects may be referenced as provenance, but BazarDriveCloud PostgreSQL owns canonical merchant/contact state once runtime lands.

This contract is provider-agnostic and does not depend on Peach Core pipelines or automations.

## Effective lifecycle predicates

Future runtime code acts on effective state, not one row in isolation.

```text
merchantOperable(M) =
  merchant.status == ACTIVE

contactResolvable(C, M) =
  external_contact_identity.status == ACTIVE
  AND merchant_contact_binding.status == ACTIVE
  AND merchantOperable(M)

membershipUsable(U, M) =
  merchant_membership.status == ACTIVE
  AND merchantOperable(M)
```

Confirmed negative state wins. A `REVOKED` identity/binding/membership or a `SUSPENDED|CLOSED` merchant cannot be made operational by stale ACTIVE state elsewhere in the graph.

No ordinary update/upsert may resurrect a terminal external identity, binding, membership, or CLOSED merchant.

## Contact resolution contract

A future inbound adapter resolves a message in this order:

```text
adapter-owned canonical subject tuple
(channel, subject_namespace, canonical_subject_key)
        |
        v
external_contact_identity.status == ACTIVE
        |
        v
ACTIVE merchant_contact_bindings
        |
        v
merchant.status == ACTIVE
        |
        +-- 0 merchants  -> EXTERNAL_CONTACT_UNKNOWN / MERCHANT_INOPERABLE
        +-- 1 merchant   -> merchant context resolved
        +-- 2+ merchants -> MERCHANT_CONTEXT_AMBIGUOUS
```

Fail-closed rules:

- unknown contact does not silently become a merchant;
- identity-key conflict is `EXTERNAL_CONTACT_IDENTITY_CONFLICT`, never a heuristic merge;
- revoked external identity is not resolvable for merchant delivery intake;
- suspended/closed merchant is not operable even if an ACTIVE binding remains;
- ambiguous context does not choose the newest, closest, or most-used merchant;
- if one external contact legitimately operates several merchants, downstream intake must carry or request explicit merchant/location context.

Context resolution is not authorization to confirm a quote, create a confirmed delivery, dispatch a driver, change merchant data, or administer membership.

## Membership resolution contract

For an authenticated BazarDrive request:

```text
session token
  |
  v
users.id = U
  |
  v
merchant.status == ACTIVE
  |
  v
ACTIVE merchant_membership(U, M)
```

The server derives the acting user from the session. A client-supplied member or actor id is never authorization proof.

## External channel actor authorization

Resolving a WhatsApp/SMS contact to a merchant answers only which merchant context the message belongs to. It does not authorize an economically or operationally binding action.

A future external-channel action that confirms a quote, creates a confirmed delivery, dispatches a driver, changes merchant data, or performs another merchant-authorized write must compose all of these facts:

```text
external_contact_identity.status == ACTIVE
AND external_contact_identity.channel_proof == VERIFIED
AND external_contact_identity.linked_user_id == U
AND ACTIVE merchant_contact_binding(identity, M)
AND merchant.status == ACTIVE
AND ACTIVE merchant_membership(U, M)
AND membership_role permits the requested operation
        |
        v
AUTHORIZED_MERCHANT_ACTOR(U, M)
```

`CONTACT`/`OPERATOR` on the binding is descriptive merchant context, not authorization by itself.

A future Delivery Draft contract may permit a policy-limited unlinked or merely OBSERVED contact to contribute input to a non-authoritative draft. Such a draft may not cross into quote approval, confirmed order, money, dispatch, or merchant-administration state until the actor gate above passes.

Downstream operation contracts may require `ADMIN` for stronger actions and must never downgrade this gate to contact binding alone.

## Contact-to-user linking contract

`external_contact_identities.linked_user_id` is nullable by design.

A channel identity can be useful before it is linked to an authenticated BazarDrive account. Linking later requires explicit user-control proof and is a server-side transition.

`channel_proof == VERIFIED` is not sufficient on its own: it proves the channel subject according to the provider adapter, while `linked_user_id` proves the separate BazarDrive-account relationship.

A verified user link may look like:

```text
external_contact_identity A --+
                              +--> linked_user_id = U
external_contact_identity B --+
```

A and B remain distinct channel identities.

A proven `linked_user_id` cannot be overwritten with a different user by an ordinary update. Relink requires explicit revoke/relink recovery semantics and audit provenance.

## Mutation and bootstrap authority

Audit provenance records who/what caused a change; it is not itself permission to cause the change.

The future runtime must enforce these minimum write-authority rules:

| Mutation | Minimum authority |
| --- | --- |
| Create a merchant + first `ADMIN` membership | Trusted server onboarding/Ops/bootstrap procedure. An arbitrary authenticated user cannot self-claim a merchant or mint themselves first ADMIN. |
| Grant/revoke a merchant membership | Existing ACTIVE merchant `ADMIN` under server policy, or trusted Ops authority. Actor identity is session/service-derived. |
| Revoke the last ACTIVE `ADMIN` | Rejected unless a replacement ADMIN is established atomically, the merchant is being closed under authorized policy, or trusted Ops performs explicit recovery/override. |
| Create/revoke a merchant contact binding | ACTIVE merchant `ADMIN` or trusted integration/bootstrap procedure; never message-content inference alone. |
| Set `channel_proof = VERIFIED` | Trusted channel/provider verification procedure. Merchant admins cannot self-assert provider verification. |
| Set/change `linked_user_id` | Identity-verification procedure proving control of the BazarDrive account and external subject. Merchant admins cannot assign an arbitrary `users(id)`. |
| Suspend/close merchant | Explicit merchant-admin/Ops policy in a later runtime contract; never an external contact binding alone. |

All authoritative actor/service IDs are resolved by the server. A request body cannot choose the grantor, verifier, bootstrap principal, or acting user.

## Write provenance and auditability

Every future write that creates/revokes membership, changes merchant lifecycle, verifies/revokes an external channel identity, changes `linked_user_id`, or creates/revokes a merchant contact binding must have server-owned provenance sufficient to answer:

- what changed;
- when;
- through which trusted procedure;
- which authenticated/admin/service actor caused it, where applicable.

The exact audit-ledger schema is deferred to 01B/01C. Runtime code must not rely on free-form client provenance.

## Privacy and data minimization boundary

Allowed identity/contact data is limited to what is required to authenticate a BazarDrive person, associate an external channel identity with a merchant, route merchant communication, and resolve a persistent merchant pickup location.

01A does not authorize permanent profile storage of:

- recipient door codes;
- recipient apartment/entrance/floor data;
- recipient message history as profile data;
- unnecessary precise location history;
- payment-card data;
- passport/document data;
- inferred relationship graphs;
- AI-generated personal profiles.

The public repository contract and test fixtures must never contain real customer/merchant phone numbers, private addresses, door codes, chat exports, provider payloads, or other live PII. Worked examples must be synthetic or masked.

Operational logging/metrics follow the same privacy boundary as the existing notification-outbox contract: use stable outcome/error codes, request/correlation IDs, and low-cardinality labels; do not emit raw `phone_e164`, `canonical_subject_key`, provider identifiers, display names, linked user IDs, merchant/member IDs, message bodies, pickup addresses/instructions, contact-binding evidence, or other contact payloads.

Raw provider payloads may be processed only inside the trusted adapter boundary required for the operation and are not general application-log fields.

## Error taxonomy for future runtime

| Code | Meaning | Retryable |
| --- | --- | --- |
| `MERCHANT_NOT_FOUND` | Requested merchant does not exist. | false |
| `MERCHANT_INOPERABLE` | Merchant exists but is `SUSPENDED` or `CLOSED` for this operation. | false |
| `MERCHANT_MEMBERSHIP_REQUIRED` | Authenticated/linked user is not an ACTIVE member of the merchant. | false |
| `MERCHANT_ACTOR_UNAUTHORIZED` | Membership exists but does not authorize the requested operation, or an external action did not satisfy the composed actor gate. | false |
| `EXTERNAL_CONTACT_UNKNOWN` | No canonical external identity/binding resolved. | false |
| `EXTERNAL_CONTACT_IDENTITY_CONFLICT` | Provider/identity facts resolve to conflicting canonical external identities. | false |
| `MERCHANT_CONTEXT_AMBIGUOUS` | Contact is bound to more than one possible merchant context. | false |
| `MERCHANT_LOCATION_REQUIRED` | No unique/default pickup location can be resolved. | false |
| `CONTACT_CHANNEL_PROOF_REQUIRED` | Operation requires `channel_proof == VERIFIED`. | false |
| `CONTACT_USER_LINK_REQUIRED` | Operation requires a proven `linked_user_id`. | false |
| `CONTACT_LINK_CONFLICT` | Attempt would relink a proven contact identity to a different user without explicit recovery semantics. | false |
| `MERCHANT_IDENTITY_DEPENDENCY_FAILED` | Authoritative persistence/dependency failed. | true |

Downstream delivery contracts may define stronger operation-specific codes.

## Concurrency and uniqueness invariants for 01B

The future PostgreSQL layer must serialize or constrain at least:

1. one canonical `external_contact_identity` per `(channel, subject_namespace, canonical_subject_key)` tuple;
2. no duplicate active `(merchant_id, external_contact_identity_id)` binding;
3. no duplicate active `(merchant_id, user_id)` membership;
4. at most one active default pickup location per merchant;
5. a proven `linked_user_id` cannot be silently overwritten by a different user;
6. channel-verification/user-link transitions cannot be lost or overwritten by concurrent weaker writes;
7. revocation timestamps and terminal states are server-stamped and terminal rows cannot be revived by ordinary update/upsert;
8. last-ADMIN revocation cannot orphan an ACTIVE merchant except through the explicit replacement/close/recovery rule;
9. all FK links target existing canonical rows.

Exact indexes, constraints, transaction/lock order, and audit-ledger DDL are owned by 01B/01C, but they must implement these invariants rather than reinterpret them.

## Read boundaries

Safe projections must not expose raw contact PII merely because it exists in the database.

- merchant admin surfaces may show masked contact data according to authorization;
- driver-facing delivery cards must not read merchant identity tables to discover recipient PII;
- public feeds must never serialize merchant phone numbers or external channel IDs;
- a provider adapter receives only routing data required for its operation;
- contact/member lookup APIs must not become directory/enumeration endpoints for arbitrary authenticated users.

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
        | inbound canonical channel identity + message
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

### Example E: contact resolves, but actor authorization does not

```text
external identity A = ACTIVE + VERIFIED
binding(A, M) = ACTIVE
linked_user_id = NULL
merchant M = ACTIVE
```

The server may resolve merchant context M, but A cannot confirm a quote or dispatch a driver because `CONTACT_USER_LINK_REQUIRED` blocks the composed actor gate.

### Example F: linked user has revoked merchant membership

```text
A.linked_user_id = U
binding(A, M) = ACTIVE
membership(U, M) = REVOKED
merchant M = ACTIVE
```

Merchant context may be known historically, but an authoritative merchant operation fails with `MERCHANT_MEMBERSHIP_REQUIRED`. The stale ACTIVE binding cannot revive the revoked membership.

### Example G: canonical subject conflict

A provider migration supplies two identity facts that resolve to different canonical external identities. The server returns `EXTERNAL_CONTACT_IDENTITY_CONFLICT`; it does not merge rows, trust a display name, or choose the most recently used identity.

## 01A acceptance criteria

`BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01A` is complete when docs-only review freezes all of the following:

- Merchant is a separate domain entity, not a new `users.role`.
- Membership is merchant-scoped and references existing `users(id)`.
- Merchant location is distinct from recipient address.
- External contact identity is distinct from BazarDrive `users`.
- Contact-to-merchant binding is explicit and server-owned.
- Canonical external identity is one adapter-owned `(channel, namespace, subject)` tuple.
- Phone normalization reuses the existing auth canonicalizer where phone is the canonical subject.
- Channel proof, BazarDrive user link, merchant binding, and merchant membership are separate facts.
- Authoritative external actions require the composed `AUTHORIZED_MERCHANT_ACTOR` gate.
- Effective lifecycle predicates make revoked/suspended/closed state fail closed across the graph.
- Bootstrap/membership/binding/link mutations have server-owned minimum authority and cannot be self-claimed from request data.
- Last-ADMIN revocation cannot silently orphan an ACTIVE merchant.
- Two contact channels are never inferred to be one human.
- Recipient data is never auto-promoted to merchant identity.
- WhatsApp/Peach is transport, not business-state authority.
- Unknown/ambiguous/conflicting contact resolution fails closed.
- Public docs/tests contain no live PII.
- Operational logs/metrics do not emit raw contact/provider identifiers or payloads.
- Existing passenger orders, matching, rides, driver authorities, notification boundaries, and auth enums remain unchanged.
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
- Provider-key alias/migration runtime.

## Expected next slices

1. `BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B`
   - PostgreSQL schema for merchants, memberships, locations, canonical external identities, and bindings;
   - repository primitives for effective lifecycle, canonical contact resolution, user linking, and authorization composition;
   - readiness/schema/concurrency/privacy tests;
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
channel-scoped canonical external identity
    +
explicit contact binding
    +
separate channel proof and user-link proof
```

without widening passenger/driver auth semantics, treating channel verification as user/merchant authorization, reviving terminal identity/binding/membership state, letting contact bindings authorize money/dispatch, or writing live PII into repository fixtures or operational logs.