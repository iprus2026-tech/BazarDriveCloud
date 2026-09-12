---
id: BD-DOCS-051
docType: decision-record
title: "WhatsApp Business Account Adapter — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-09-12
effectiveFrom: 2026-09-08
reviewAfter: 2027-03-08
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/webhooks/whatsapp
  files:
    - server/src/config.js
    - server/src/routes/webhooks/whatsapp.js
    - server/src/server.js
    - server/src/repositories/external_contact_identities.js
    - server/src/services/merchant-identity-contact-authority/index.js
    - docs/merchant-identity-contact-authority-contract.md
  issues: []
  prs:
    - 981
tags: [decision-record, adr, whatsapp, merchant, adapter, webhook, target]
slug: /decisions/whatsapp-business-account-adapter
---

# WhatsApp Business Account Adapter — Decision Record

> **Contract-first / docs-only (`status: draft`).** This ADR freezes the design
> of the WhatsApp Business Account (WABA) adapter configuration and webhook seam.
> The GET subscription-verification handler and **dark 501** POST handler are
> now **merged through PR #981** at
> `main@5633cf61e3633e3f6f0e664f9baf6d09a07ce5aa`.
> This establishes repository implementation only; server deployment, a Meta
> webhook subscription, and production readiness are **not established by this
> merge**. This documentation update makes no runtime, migration, or PWA change;
> see BD-DOCS-042 for the current repository-state entry.

The ADR, sidebar, and candidate-route matrix were merged separately in PR #984
(`579dca7e826c980d2ead25e41511b444802b2d4a`). References to the reviewed
"candidate" in the unchanged contract obligations and review provenance below
retain their historical wording; the same four runtime/test file blobs from
`000f267f2fc494bc93574e246c05e7f7e2be385a` are now on `main` through #981.
Those references do not imply that the runtime is still unmerged or that any
future POST obligation was implemented or tested by the merge.

## Context

`BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01A` (frozen contract,
`docs/merchant-identity-contact-authority-contract.md`, issue #975) and
`BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B` (migration `0009_merchant_identity_contact_authority.sql`,
repositories, and the `resolveMerchantContext` / `resolveAuthorizedMerchantActor` seam,
PR #978) established the server-authoritative merchant identity model.

The model includes `external_contact_identities` with `channel IN ('WHATSAPP',
'SMS')` and a canonical triple:

```text
(channel, subject_namespace, canonical_subject_key)
```

That contract defined WhatsApp as a transport channel and explicitly deferred
WABA configuration, webhook setup, and message processing as non-goals of 01A/01B.

This ADR freezes how a BazarDriveCloud server instance is scoped to exactly
one WhatsApp Business Account, how that scoping maps into the
`external_contact_identities` namespace, and what the live / dark surface of
the webhook endpoint looks like.

## Authority chain

```text
Meta WhatsApp Business API
        |
        | (webhook POST — dark)
        v
/api/v1/webhooks/whatsapp  ← this ADR's seam
        |
        v
external_contact_identities
(channel=WHATSAPP, subject_namespace=waba:{wabaId}:phone:{phoneNumberId})
        |
        v
merchant_contact_bindings → resolveMerchantContext (01B dark seam)
        = non-authoritative merchant context for this inbound message
```

Authoritative operations (quote approval, a confirmed order, dispatch, merchant
administration) do **not** continue down this inbound chain. They compose
`resolveAuthorizedMerchantActor` (01B dark seam) on a **separate branch**,
required by and owned by that operation's own downstream contract — never
inline in inbound message handling.

`resolveMerchantContext` requires ACTIVE `external_contact_identity` + ACTIVE
`merchant_contact_binding` + ACTIVE `merchant`, and is fail-closed on an
unknown, ambiguous, conflicting, or revoked identity/binding/merchant, exactly
as the frozen contract's *Contact resolution contract* defines. Its result is
a read of current state, **never a portable authorization token**: context
resolution does not authorize quote approval, a confirmed order, money,
dispatch, or merchant administration. A later mutating operation must
independently re-derive `AUTHORIZED_MERCHANT_ACTOR(U, M)` — composing ACTIVE
identity + `channel_proof = VERIFIED` + `linked_user_id` + ACTIVE binding +
ACTIVE merchant + ACTIVE membership + role — inside its **own**
transaction/lock boundary, per the frozen contract's *External channel actor
authorization*; it may not accept a previously-resolved context as proof. A
future Delivery Draft contract may permit a policy-limited unlinked or merely
`OBSERVED` contact to contribute input to a non-authoritative draft — **this
ADR does not activate that policy**; it only names the frozen contract's
existing shape.

Message processing, contact creation/update, merchant context resolution, and
delivery draft intake are each a separately authorized downstream slice.

## WABA credential scoping

A BazarDriveCloud server deployment is scoped to exactly one WABA (WhatsApp
Business Account) and one registered business phone number. All five WABA
credentials are read from environment variables and are **dark** in the config
(no runtime consumer, no health check, no required-in-production assertion)
except `WABA_WEBHOOK_VERIFY_TOKEN`, which is consumed by the live GET
verification handler.

| Env var | Purpose | Live / Dark |
| --- | --- | --- |
| `WABA_ID` | Meta WABA ID (numeric string) | Dark |
| `WABA_PHONE_NUMBER_ID` | Meta Phone Number ID for this business phone | Dark |
| `WABA_ACCESS_TOKEN` | System User access token for Cloud API send/read | Dark |
| `WABA_WEBHOOK_VERIFY_TOKEN` | Arbitrary token verified in the GET challenge | Live (GET only) |
| `WABA_APP_SECRET` | Meta App Secret for HMAC-SHA256 signature verification | Dark |

No WABA credential is required at startup, and none blocks route registration
— the GET handler registers regardless of configuration. A **successful**
verification additionally requires a `WABA_WEBHOOK_VERIFY_TOKEN` that is both
configured and equal to the supplied `hub.verify_token`; an empty or
unconfigured token returns 403 rather than crashing the process or refusing
to register the route.

Credentials are never logged, never emitted in metrics, never returned in API
responses, and never written to any database table.

**Future POST activation prerequisite.** This dark/optional configuration is
correct for the current candidate — no WABA credential is required at
startup, and none of the five env vars blocks the GET verification handler.
Before the POST handler is promoted to live, however, **`WABA_ID` and
`WABA_PHONE_NUMBER_ID` become mandatory, non-empty, valid strings, alongside a
configured `WABA_APP_SECRET`** (see *Signature verification*, below); a
missing or invalid namespace ID must block intake activation. The adapter
must never build a `subject_namespace` with an empty component — a value like
`waba::phone:` (an empty `WABA_ID` or `WABA_PHONE_NUMBER_ID`) is never
constructed, guessed, or defaulted. Both IDs are carried as opaque strings; no
numeric coercion and no synthesized fallback.

## subject_namespace format

Every inbound WhatsApp message is scoped to the WABA's registered business
phone. The `subject_namespace` recorded in `external_contact_identities` encodes
both the WABA ID and the Phone Number ID:

```text
subject_namespace = "waba:{WABA_ID}:phone:{WABA_PHONE_NUMBER_ID}"
```

Example:

```text
channel            = "WHATSAPP"
subject_namespace  = "waba:123456789012345:phone:987654321098765"
canonical_subject_key = "+79001234567"
```

The `canonical_subject_key` is the sender's WhatsApp phone number in canonical
E.164 format, normalized using the existing
`server/src/services/auth/phone.js` canonicalization. The sender value comes
from each individual message's own `messages[i].from` field, **not** from
`contacts[0].wa_id` or any other batch-level field — see *Sender identity is
derived per message, then validated*, below, for the exact source and the
mandatory validation sequence before this key is looked up or written.

The full canonical triple is therefore:

```text
(WHATSAPP, waba:{wabaId}:phone:{phoneNumberId}, +<E.164 phone>)
```

This triple is globally unique per sender per business phone number. Two
business phones on the same WABA are different namespaces. Two WABAs on the
same phone number are also different namespaces (the WABA ID differs).

### Namespace must match the receiving endpoint (future POST prerequisite)

Meta's webhook payload is a batch: `entry[]` (one per WABA) containing
`changes[]`, each `value.metadata` naming the **receiving** business phone
(`value.metadata.phone_number_id`). This deployment is scoped to exactly one
WABA and one phone number, so **the future intake handler must reconcile both
namespace components against the configured identity — after signature
verification and before any contact resolution, upsert, or draft write** —
never assign the configured `WABA_PHONE_NUMBER_ID` unconditionally:

- the batch entry's `entry.id` (the WABA ID) must equal the configured
  `WABA_ID`;
- **for every** processed `changes[].value` (not only the batch's first
  element), its `metadata.phone_number_id` must equal the configured
  `WABA_PHONE_NUMBER_ID`.

A missing, malformed, or mismatched value on either check is **not** admitted
to intake and triggers no contact/identity/draft write — an event for a
different WABA or a different business phone is rejected, never relabeled
under this deployment's configured IDs. This is a same-deployment identity
check only: it does not add multi-WABA or multi-phone-number routing, and it
does not introduce a new HTTP error taxonomy beyond the POST handler's
existing dark/live shape.

### Sender identity is derived per message, then validated (future POST prerequisite)

Meta's webhook batch nests multiple messages under one or more `changes[]`
entries, and `value.contacts[]` is a batch-level array that is **not**
positionally aligned with `value.messages[]`. The future intake handler MUST
NOT read `contacts[0].wa_id`, the first message, or any contacts-array index
as a shared sender for the batch — doing so mis-attributes every message
after the first (or every message, if the arrays disagree) to the wrong
sender.

The authoritative sender for **each** message is that message's own
`messages[i].from`, read within its own entry/change. Before any canonical
lookup or domain write, the future handler MUST apply this exact sequence to
that value:

1. **Type/provider-form check** — `messages[i].from` must be a string
   containing only ASCII digits with an optional single leading `+`; no
   letters, separators, whitespace, objects, arrays, or numeric coercion are
   accepted. Anything else is rejected before normalization.
2. **Normalize** — apply the existing `server/src/services/auth/phone.js`
   `normalizePhone()` unchanged.
3. **Validate** — require `isValidPhone(normalized) === true` (existing
   validator, unchanged) before the result is used for any canonical lookup
   or write.

A value that fails any step is rejected with no contact/identity/draft
effect; normalization MUST NOT "fix" alphabetic or malformed input into a
different, coincidentally-valid number. Passing this format check is **not**
proof of number ownership or of any link to a BazarDriveCloud user account —
it only gates *shape*, not identity; ownership is established separately, per
the frozen Identity/Contact contract's *External channel actor authorization*.

`value.contacts[]` metadata (e.g. a WhatsApp display name) is optional and
never replaces `messages[i].from`. If contact metadata is used at all, it
must be unambiguously matched to the specific sender it describes, pass the
same format check and `isValidPhone` validation, and agree with that
message's `from`. The mere presence of other senders' contact metadata
elsewhere in the same batch is not itself a conflict — it must never be
substituted into a different message's processing. A missing or invalid
`from` is never recovered from `contacts[]`, a display name, or a
neighboring message in the batch; it is rejected outright. Sender, provider
message ID (see *Idempotent processing*, below), namespace, and the
persisted processing result are all bound specifically to the message being
processed — never shared across messages in the same batch.

## Webhook endpoint surface

```text
GET  /api/v1/webhooks/whatsapp  — Meta subscription verification (live)
POST /api/v1/webhooks/whatsapp  — Inbound message event (dark, 501)
```

> **Where this lives.** On
> `main@5633cf61e3633e3f6f0e664f9baf6d09a07ce5aa`, merged PR #981 registers
> both routes: **GET LIVE** means registered and implemented subscription
> verification; **POST DARK** still returns `501 NOT_IMPLEMENTED`.
> The implementation is in `server/src/config.js` (the existing optional WABA
> block), `server/src/server.js` (registration under `/api/v1/webhooks`), and
> `server/src/routes/webhooks/whatsapp.js` (the handlers), verified by
> `server/test/whatsapp-webhook.test.mjs` (hermetic, DB-independent).
> Neither handler performs database I/O or drives PWA activation. LIVE here
> describes repository code, not an observed server deployment or Meta subscription.

### GET — subscription verification

Meta verifies the webhook subscription by sending:

```text
GET /api/v1/webhooks/whatsapp
  ?hub.mode=subscribe
  &hub.verify_token=<WABA_WEBHOOK_VERIFY_TOKEN>
  &hub.challenge=<random string>
```

The handler:

1. Rejects non-`subscribe` `hub.mode` with 400.
2. Returns 403 if `WABA_WEBHOOK_VERIFY_TOKEN` is not configured or does not
   match the supplied `hub.verify_token`.
3. Returns the raw `hub.challenge` as `text/plain` with 200 on match.

This endpoint is intentionally unauthenticated (Meta calls it with no
BazarDrive session). It carries no BazarDrive user data.

### POST — inbound message (dark)

The POST handler returns 501 `NOT_IMPLEMENTED` until the message-processing
intake slice is separately authorized. Meta retries failed webhooks; the 501
is acceptable during the dark period because BazarDrive will not have a live
webhook subscription configured in the Meta Developer Console until the intake
slice ships.

### Signature verification (dark)

Meta signs every POST body with HMAC-SHA256 using the App Secret:

```text
X-Hub-Signature-256: sha256=<hex digest>
```

Signature verification using `WABA_APP_SECRET` is dark in this slice and MUST
be implemented before the POST handler is promoted to live. Accepting unsigned
payloads in production is not permitted. Once implemented, the check must:

- compute the HMAC-SHA256 over the **exact raw request-body bytes captured
  before JSON parsing** — never over the parsed object, a re-serialization of
  it, or any whitespace/Unicode-normalized form, any of which can change the
  byte sequence Meta actually signed and make a legitimate signature fail;
- complete **before** contact resolution, identity upsert, or any domain
  write, rejecting a missing, malformed, or mismatched `X-Hub-Signature-256`
  with no such write;
- compare two well-formed digests using a **constant-time** comparison
  primitive, not a plain equality check.

These are **future POST-activation obligations** — the current candidate's
POST handler is dark (`501`) and implements none of this; it is not covered by
`server/test/whatsapp-webhook.test.mjs`, whose coverage is limited to the GET
verification endpoint and the dark POST stub (see *Acceptance criteria*,
below).

### Idempotent processing (future POST prerequisite)

Meta retries webhook deliveries; a promoted-to-live POST handler MUST NOT
create duplicate contact/identity/draft effects from a retried or
re-batched delivery of the same message.

- Every admitted message requires its own non-empty, valid provider message
  ID — `messages[i].id` — carried as an opaque string; it is never derived,
  guessed, or substituted.
- After signature verification, namespace reconciliation, and sender
  validation (above), and **before** any contact/identity/draft mutation,
  the handler transactionally claims a persistent, database-unique key
  `(WHATSAPP, subject_namespace, provider_message_id)` — all three
  components mandatory, no NULL fallback for WhatsApp.
- The claim record and every contact/identity/draft effect of that message
  commit, or roll back, atomically together.
- Two concurrent deliveries of the same key produce at most one committed
  effect-set: a competitor observing an in-flight (uncommitted) claim is not
  itself looking at success; it must wait for the committed result or retry
  after rollback.
- Replay of an already-committed message returns a successful acknowledgment
  with **no** repeated domain writes: no intent change, no deadline
  extension, and no resurrection of a terminal draft.
- A lost response after COMMIT never causes repeated effects (the claim
  record makes the retry a no-op replay); a crash before COMMIT leaves
  neither a completed claim marker nor any partial contact/identity/draft
  effect.
- Deduplication is per-message: a provider message ID repeated within one
  batch, and the same message re-delivered inside a differently-packaged
  retry batch, both dedupe to one committed effect-set. A duplicate MUST NOT
  suppress processing of other, genuinely new messages carried in the same
  request.
- Dedupe identity must survive process restart and any future
  cleanup/retention pass: deleting, mutating the key of, or expiring a claim
  record by TTL must never cause an old message to be reprocessed as "new".
  This ADR specifies only that survival property — the concrete
  retention/erasure/TTL mechanism for claim records is out of scope here
  (see *Explicit non-goals*, below).
- A missing or invalid provider message ID is never admitted to intake
  writes; the handler MUST NOT substitute a hash of the whole webhook body, a
  random value, or an in-memory-only cache entry for the provider message ID.
- Replay always resolves to the original committed result; a later change to
  the current merchant binding for the same sender MUST NOT redirect an
  already-committed message's replay to a different merchant or draft.

**Relationship to the proposed PR #980 draft-intake tuple.** PR #980 (not yet
merged; not declared frozen or implemented by this ADR) proposes a
draft-level dedupe tuple for authoritative order creation. If that tuple is
later adopted by the downstream intake contract, the WhatsApp adapter's
contribution to it would be `origin_channel = WHATSAPP`, `origin_namespace =`
the validated `subject_namespace` above, and `adapter_dedupe_token =
provider_message_id` — with **no NULL fallback** for the WhatsApp channel.
This ADR does not modify PR #980, its intake key semantics, or its `UNIQUE`
constraint; the draft-level tuple does not substitute for the per-message
claim key above, which protects contact/identity effects independently, and
this key is never substituted for authoritative order-creation's own
idempotency key.

## Authority invariants

- WABA credentials are transport configuration, not merchant identity.
  Possessing the webhook verify token does not grant access to any merchant
  account, user session, or authoritative write path.
- The canonical triple `(channel, subject_namespace, canonical_subject_key)` is
  the ONLY allowed lookup key; no phone-number heuristic or display-name
  inference may substitute.
- An inbound message that cannot be resolved to a canonical triple is
  `EXTERNAL_CONTACT_UNKNOWN`; it must not create a merchant identity row by
  inference.
- WABA is transport. It is not the authority for merchant status, membership,
  quote approval, dispatch, or delivery lifecycle (per the frozen Identity/Contact
  contract's *Authority invariant 4* — provider is transport, BazarDriveCloud is
  authority).

## Explicit non-goals of this ADR

- Inbound message parsing, extraction, or AI processing.
- Contact creation or update in `external_contact_identities`.
- Merchant context resolution or delivery draft intake.
- Outbound message sending via the Cloud API.
- Peach pipeline, automation, template, or broadcast configuration.
- Webhook signature verification runtime (deferred to POST live slice).
- Multi-WABA or multi-phone-number support.
- Staging deployment or production activation.
- Concrete retention/erasure/TTL mechanism for idempotency claim records
  (only the identity-survival property is specified, in *Idempotent
  processing*, above).
- A new HTTP error taxonomy, an inbox/outbox schema, or a full intake
  runtime beyond the specific obligations named above.

## Expected next slices

1. **`BD-MERCHANT-WHATSAPP-INTAKE-01A`** — the established slice name from the
   frozen Identity/Contact contract's own *Expected next slices* (#4): the
   provider adapter maps an inbound message into a Delivery Draft without
   becoming authority. That contract owns 01A's scope and freeze status; this
   ADR does not (re)freeze it, redefine its scope, or claim it is already
   frozen — it is named here only for cross-reference.
2. **`BD-MERCHANT-WHATSAPP-INTAKE-01B`** (proposed) — a live POST handler with
   HMAC signature verification, per-message sender validation, persisted
   idempotency claiming, contact upsert, and draft intake, **if** a separate
   implementation slice is needed beyond 01A. Proposed only: it requires its
   own separate scope/contract agreement before being treated as authorized.
3. **BD-WHATSAPP-SEND-01A** — outbound message sending via the Cloud API.

### Future verification scenarios (not yet implemented)

These are **future-implementation requirements** for the obligations above —
none is fulfilled by `server/test/whatsapp-webhook.test.mjs` today; the
current candidate remains GET-verification/POST-501 only:

- Two concurrent deliveries of the same provider message ID commit exactly
  one effect-set.
- The response is lost after COMMIT; the retry replays the committed result
  with no repeated effects.
- A crash/rollback occurs between a contact effect and the draft write; no
  partial effect and no completed claim marker remain.
- One batch contains both a duplicate provider message ID and a genuinely
  new message; the duplicate is a no-op and the new message is still
  processed.
- The same provider message ID appears under two different, independently
  validated namespaces (different WABA or phone number); each namespace
  dedupes independently.
- A malformed sender is rejected before any effect — including a too-short
  numeric string and a purely alphabetic string.
- A batch carries multiple senders with reordered or mismatched
  `contacts[]` metadata; each message's effect is bound to its own
  `messages[i].from`, never to another message's contact entry.
- Replay of a message whose draft is already terminal, or whose sender's
  merchant binding has since changed, resolves to the original committed
  result rather than mutating a new target.

## Acceptance criteria for this ADR (docs-only)

- `status: draft` is retained. This document records the WABA adapter design
  and implementation provenance; only the GET-verification/POST-501 seam is
  merged through PR #981 at
  `main@5633cf61e3633e3f6f0e664f9baf6d09a07ce5aa`.
  This documentation slice changes no runtime, migration, or PWA behavior and
  asserts no server deployment, Meta subscription, or production readiness.
- The BD-DOCS-042 current-state matrix records **GET LIVE** subscription
  verification and **POST DARK 501** at that full `main` SHA, while retaining
  `7ddb3971f078da93193b5cf22413ddb3aabf40ae` and the pre-merge candidate
  `000f267f2fc494bc93574e246c05e7f7e2be385a` as explicitly historical snapshots.
  LIVE means registered and implemented in the repository; it does not assert
  deployment or activation of inbound processing.
- **Actually covered by `server/test/whatsapp-webhook.test.mjs`** (hermetic,
  DB-independent): GET returns the raw `hub.challenge` as `text/plain` with 200 on
  a matching token, 400 on a non-`subscribe` `hub.mode`, and 403 on a token
  mismatch, an empty configured token, a missing token, or a repeated
  `hub.verify_token` parameter; the verify token never reaches request logs (with
  request logging left enabled in the test); POST returns 501 `NOT_IMPLEMENTED`.
- **Contract obligations the candidate also carries but those tests do not
  assert:** the WABA config block stays structured-but-dark in
  `server/src/config.js`; no WABA credential is logged, emitted in metrics,
  returned in a response, or written to any database table; no existing
  Mini-Yonder service, auth contract, passenger/driver route, or PWA behaviour is
  changed. **HMAC-SHA256 signature verification with `WABA_APP_SECRET` is a
  mandatory prerequisite for any future POST activation — it is neither
  implemented nor tested in this candidate.**
- **Proposed corrections for Codex review `5172646963`** (findings
  `3983839917` / `3983839924` / `3983839927` / `3983839934` / `3983839940`) —
  a review with remarks, not a freeze or an approval; all **future
  POST-activation prerequisites, none implemented or tested in this
  candidate**: the Authority chain routes inbound context resolution only
  through `resolveMerchantContext`, never `resolveAuthorizedMerchantActor`,
  which is reserved for a separate authoritative-operation branch owned by
  that operation's own downstream contract; the intake follow-up is the
  established `BD-MERCHANT-WHATSAPP-INTAKE-01A` (not refrozen here), with a
  proposed `-01B` implementation slice; `WABA_ID` / `WABA_PHONE_NUMBER_ID` /
  `WABA_APP_SECRET` become mandatory before POST activation, and a namespace
  is never built with an empty component; every processed webhook
  entry/change has its WABA ID and receiving phone reconciled against the
  configured identity before any domain write; and HMAC-SHA256 verification
  runs over the raw pre-parse request bytes, completes before any domain
  write, and is compared constant-time.
- **Proposed corrections for Codex review `5175458358`** (findings
  `3986374461` / `3986374469` / `3986374470`) — likewise a review with
  remarks, not a freeze or an approval; all **future POST-activation
  prerequisites, none implemented or tested in this candidate**: a
  persistent, database-unique `(WHATSAPP, subject_namespace,
  provider_message_id)` claim is required before any contact/identity/draft
  mutation, committing or rolling back atomically with that mutation's
  effects, so that retries and re-batched redeliveries never duplicate
  effects (see *Idempotent processing*, above); the authoritative sender for
  each message is validated via type/provider-form check →
  `normalizePhone()` → `isValidPhone()` before any canonical lookup or write
  (see *Sender identity is derived per message, then validated*, above); and
  that sender is read from each message's own `messages[i].from`, never from
  `contacts[0].wa_id` or any other shared/batch-level field (same
  subsection).
- `cd docs-site && npm run check`, `node scripts/check.mjs`, and
  `node scripts/dispatcher.mjs` pass.
