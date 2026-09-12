---
id: BD-DOCS-050
docType: decision-record
title: "Notification Outbox Source Contract — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-09-02
effectiveFrom: 2026-09-01
reviewAfter: 2027-03-01
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes:
    - /api/v1/ride-state/rides/:tripId/status
  files:
    - server/migrations/0004_notification_outbox.sql
    - server/src/services/ride-state/index.js
    - server/src/repositories/ride_events.js
    - server/src/repositories/notification_outbox.js
    - server/src/services/notifications/index.js
    - server/src/infra/bus.js
    - public/src/screens/inbox.js
    - public/src/mock_api.js
  issues: ["#941", "#943", "#948"]
  prs: ["#942", "#944"]
tags: [decision-record, adr, notifications, outbox, transactional, target]
slug: /decisions/notification-outbox-contract
---

# Notification Outbox Source Contract — Decision Record

> **Source runtime shipped; Notification delivery remains dark (`status: draft`).**
> `BD-NOTIF-OUTBOX-CONTRACT-01A` froze the durable source boundary in #942.
> `BD-NOTIF-OUTBOX-RUNTIME-01B` then implemented that source boundary in #944:
> migration `0004_notification_outbox.sql`, one repository, and the same-transaction
> Ride producer. This still does **not** add a worker, Inbox API, delivery channel,
> activation flag or deployment. The Notification and Safety service routes remain
> `DARK`.

## Context

The repository now has the first durable notification source, but it still does
not have a Notification delivery runtime:

- `PATCH /api/v1/ride-state/rides/:tripId/status` is the authoritative Ride
  status write path. Inside one `app.db.tx` it locks the Ride row, applies an
  accepted non-idempotent status transition, appends one immutable
  `ride_events.type = 'status_change'` row, and inserts the matching durable
  `notification_outbox` source row before commit.
- A same-status retry is a true no-op; an invalid, forbidden or terminally
  blocked transition produces neither a Ride event nor an outbox source row.
- The outbox event uses the already-created `ride_events.id` as source identity
  and preserves the source event's PostgreSQL timestamp precision.
- `server/src/services/notifications/index.js` is still a dark `501
  NOT_IMPLEMENTED` skeleton. `server/src/infra/bus.js` is an unused in-process
  `EventEmitter`, explicitly marked `DARK`; it is neither durable nor a commit
  boundary.
- The PWA `/inbox` screen still reads `INBOX_ITEMS_V1` from `mock_api.js`. No
  server feed, Push, Telegram, SMS/email or notification read state exists.

The existing Ride polling cursor cannot be reused as a global outbox cursor.
`ride_events.at_cursor` is deliberately safe only for the lock-serialized
timeline of one Ride. PostgreSQL stores microseconds, while `node-pg` parses a
timestamp into a JavaScript `Date` with millisecond precision. A notification
source also needs a stable order across different Rides and must tolerate a
transaction that allocates a sequence number before another transaction but
commits after it.

This ADR is subordinate to the target Notification Service decision
[BD-DOCS-036](notification-service.md). It freezes the source contract that #944
now implements. The next stateful step is no longer the source producer; it is
the separately scoped claim/lease/retry contract tracked by #948.

## Implementation status — 2026-09-02

| Slice | State | Evidence / boundary |
| --- | --- | --- |
| `BD-NOTIF-OUTBOX-CONTRACT-01A` | **Shipped docs contract** | #942 / BD-DOCS-050 |
| `BD-NOTIF-OUTBOX-RUNTIME-01B` | **Shipped dark source runtime** | #944: migration 0004, repository, Ride transaction producer, PostgreSQL flow tests |
| Worker claim/lease/retry | **Not implemented** | Contract-first follow-up #948 |
| Inbox projection / read state | **Not implemented** | separate future contract/runtime |
| Push / Telegram / SMS-email | **Not implemented** | separate channel/provider tracks |
| Notification route activation | **DARK** | `server/src/services/notifications/index.js` remains `501 NOT_IMPLEMENTED` |

The outbox source runtime is a **foundation inside service #6**, not evidence that
the complete Notification Service is shipped. Project #1 should keep service #6
at `Designed (ADR)` until real service/fan-out behavior is live.

## Decision

### 1. First event and source identity

The first and only producer in the initial runtime slice is the authoritative
Ride status command.

| Field | Frozen contract |
| --- | --- |
| Event type | `ride.status_changed.v1` |
| Schema version | `1` |
| Event ID | exactly the already-inserted `ride_events.id` |
| Producer | `ride-state` |
| Aggregate | `{ type: 'ride', id: rides.id, key: rides.trip_id }` |
| Domain time | exactly the PostgreSQL `ride_events.at` value |
| Payload | `{ fromStatus, toStatus }` from the accepted transition |

One accepted, non-idempotent transition creates exactly one source Ride event
and one matching outbox event. A same-status replay, invalid status, forbidden
caller or rejected terminal transition creates neither.

`occurredAt` must be copied database-to-database from the inserted Ride event
(for example through one SQL CTE or `INSERT ... SELECT`), without a `node-pg`
JavaScript `Date` round trip that truncates PostgreSQL microseconds. Its wire
form is UTC `YYYY-MM-DDTHH:mm:ss.ffffffZ` with exactly six fractional digits.
It is domain time, not a polling cursor or delivery timestamp.

### 2. One transaction owns Ride, timeline and outbox

The runtime producer extends the existing `app.db.tx` boundary:

1. lock the Ride row;
2. validate and apply the status transition;
3. insert the append-only `ride_events` row;
4. insert one `notification_outbox` row keyed by that Ride event;
5. commit all three mutations together.

An outbox insert failure rolls back the Ride mutation and the Ride event. An
outbox insert after the Ride transaction commits is forbidden because it can
lose the notification source between the two commits.

### 3. Immutable envelope

The logical read envelope is:

```json
{
  "eventId": "<ride_events.id>",
  "eventSeq": "<outbox_seq as a decimal string>",
  "eventType": "ride.status_changed.v1",
  "schemaVersion": 1,
  "producer": "ride-state",
  "aggregate": {
    "type": "ride",
    "id": "<rides.id>",
    "key": "<rides.trip_id>"
  },
  "occurredAt": "<ride_events.at with PostgreSQL microseconds>",
  "actor": {
    "userId": "<authenticated participant>",
    "role": "passenger|driver"
  },
  "audience": {
    "policyVersion": 1,
    "userIds": ["<producer-frozen participant IDs>"]
  },
  "payload": {
    "fromStatus": "<previous RIDE_STATUS>",
    "toStatus": "<accepted RIDE_STATUS>"
  }
}
```

`eventSeq` is a persistence field assigned by PostgreSQL; it is not included in
the immutable-content collision hash. Worker lease, retry, completion and
channel-delivery metadata are also mutable operational state outside the
domain envelope.

### 4. Actor and audience are server-owned

- `actor.userId` and `actor.role` come from the authenticated participant gate,
  never from request body/query values.
- `audience.userIds` is the sorted, deduplicated set of the locked Ride's
  non-null `passenger_user_id` and `driver_user_id` values.
- The producer stores that set with `policyVersion: 1`. A later consumer must
  not recompute recipients from the Ride's current assignment or participant
  linkage.
- Actor identity stays separate from audience. Suppressing a self-notification
  for a particular external channel is a later delivery-policy decision; it
  must not rewrite the durable source audience.
- For this participant-only producer, the frozen audience must be non-empty and
  must contain the authenticated actor. Empty audience or an actor absent from
  the locked Ride participant IDs is an invariant violation that rolls back the
  producer transaction.
- A legacy/demo Ride with no linked participant cannot pass the existing
  participant gate and therefore cannot create this event. A future system
  actor requires a separate event schema/audience-policy version.

The client cannot choose a recipient, audience policy, channel or provider.

### 5. Global sequence and late commits

The target outbox has an immutable, unique, database-generated
`BIGSERIAL outbox_seq`.

`outbox_seq` is an ordering/tie-break token among rows currently visible to a
transaction; it is not a completeness cursor or commit order:

- gaps are valid after rollbacks;
- two transactions may allocate `10` and `11` but commit `11` before `10`;
- `occurredAt` and `created_at` are timestamps, not substitutes for the
  sequence;
- observing or completing `MAX(outbox_seq)` must never prove that every lower
  sequence has committed or been processed.

A later worker therefore discovers eligible pending rows by durable row state
(or an equivalent `NOT EXISTS` obligation), not by a correctness watermark of
`outbox_seq > last_seen`. A lower-sequence row that commits late must remain
discoverable.

### 6. Idempotency and collision policy

`notification_outbox.source_event_id` is unique.

- UUID strings in the immutable envelope are lowercase, audience IDs are sorted
  and deduplicated, and `occurredAt` uses the exact six-digit UTC wire form
  above. The collision digest is SHA-256 over the RFC 8785 JSON Canonicalization
  Scheme (JCS) representation of the immutable envelope.
- Repeating the same `source_event_id` with the same canonical immutable
  envelope/digest is an idempotent no-op.
- Repeating it with different event type, schema, aggregate, actor, audience,
  producer, occurred time or payload is a hard collision. The producer
  transaction fails and rolls back; the stored event is never overwritten.
- The canonical collision hash excludes `outbox_seq` and all mutable
  lease/retry/delivery fields.

Consumer deduplication is keyed by `eventId`, not by timestamp, recipient count
or localized notification text.

### 7. Privacy boundary

The initial envelope contains only authoritative identifiers, the Ride status
transition, actor/audience linkage and domain time. It must not contain:

- names, phone numbers or profile snapshots;
- route text, coordinates or location traces;
- fare, payment, receipt or payout data;
- chat/message bodies or attachment URLs;
- complaint text, document/object-storage keys or risk scores;
- localized UI copy, channel choice, provider payloads, credentials or tokens.

Operational logs and metrics use normalized outcome/error codes and
low-cardinality labels; they do not emit the immutable payload or user IDs.

## Original 01A non-goals and current boundary

The docs-only 01A contract did not itself authorize a migration, table,
repository, worker or activation. The separately reviewed #944 runtime slice
implemented only the source-side migration/repository/producer portion.
Everything else below remains outside the current runtime boundary:

- bus publication, publisher loop, worker, claim/lease, retry or dead-letter
  behavior;
- a server Inbox projection, feed/read API or unread-count ownership;
- PWA, service-worker, CSP, manifest or permission-prompt changes;
- Web Push, Telegram, SMS/email or provider credentials;
- Safety cases, complaints, fraud/no-show scoring, moderation or automatic
  penalties;
- staging/production activation, backfill, deployment or cutover.

The existing Notification and Safety routes remain `501 NOT_IMPLEMENTED`; the
PWA Inbox remains mock-backed.

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Publish only to the in-process bus | Minimal code | Events disappear on crash/restart and are outside the Ride commit | Not a durable source |
| Insert outbox after Ride commit | Small change to the current transaction | Crash between commits permanently loses the source event | Violates atomicity |
| Use `ride_events.at_cursor` globally | Reuses an existing value | Only same-Ride order is proven; timestamp precision and cross-Ride ordering are unsafe | Can skip or reorder events |
| Use `MAX(outbox_seq)` as a high-water cursor | Efficient forward scan | A lower sequence can commit late after the watermark advances | Can permanently skip a committed event |
| Let consumers derive recipients from current Ride state | Smaller envelope | Assignment/participants can drift after the source event | Rewrites historical audience |
| **Transactional source outbox with frozen audience (chosen)** | Durable, idempotent and replayable; preserves Ride authority | Adds a future table and makes late-commit discovery explicit | — |

## Consequences

- **Positive:**
  - The first producer, identity, transaction owner and privacy boundary are
    fixed and implemented before channel work begins.
  - Later Inbox, Push, Telegram and Safety consumers can share one immutable
    source event without sharing a global delivery ACK.
  - A crash cannot commit a Ride transition without its durable source event.
- **Negative / trade-offs:**
  - The future worker cannot use a simple forward-only high-water scan.
  - Frozen audience can preserve historical recipient IDs after current Ride
    linkage changes; retention/access policy must account for that.
  - The first contract/runtime covers only Ride status changes; other producers
    require separate event schemas and authority reviews.
- **Follow-ups:**
  - [x] `BD-NOTIF-OUTBOX-RUNTIME-01B` — migration, repository, same-transaction
    producer and PostgreSQL rollback/late-commit tests shipped in PR #944.
  - [ ] `BD-NOTIF-OUTBOX-WORKER-01C-A` (#948) — freeze worker claim/lease/retry,
    crash recovery, late-commit discovery and observability contract.
  - [ ] Dark worker runtime — separate implementation slice after #948.
  - [ ] Server Inbox projection and per-consumer ledger — separate contracts and
    runtime slices before any activation.
  - [ ] Push, Telegram, SMS/email and Safety remain independent channel/consumer
    tracks.

## Verification boundary

The original docs-only contract slice required:

```bash
cd docs-site && npm run check
node scripts/check.mjs
node scripts/dispatcher.mjs
git diff --check
```

The shipped #944 runtime slice additionally carries server migration and
PostgreSQL transaction-flow coverage. Future worker work must remain separate
from this source producer and follow the same contract-first discipline.
