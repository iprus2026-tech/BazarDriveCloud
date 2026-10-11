---
id: BD-DOCS-036
docType: decision-record
title: "Phase 5: Notification Service — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-09-02
effectiveFrom: 2026-06-18
reviewAfter: 2026-12-18
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/screens/inbox.js
    - public/src/mock_api.js
    - public/src/state.js
    - public/sw.js
    - public/src/screens/profile.js
    - server/src/services/notifications/index.js
    - server/src/services/ride-state/index.js
    - server/src/repositories/ride_events.js
    - server/src/repositories/notification_outbox.js
    - server/src/infra/bus.js
  issues: [589, 941, 943, 948]
  prs: [942, 944]
tags: [decision-record, adr, notifications, push, real-time, target, phase-5]
slug: /decisions/notification-service
---

# Phase 5: Notification Service — Decision Record

> **Target service remains DARK; durable source foundation is now implemented
> (`status: draft`).** This is **Phase 5** of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (service #6 Notification Service). The backend spine and authoritative Ride
> event path exist. BD-DOCS-050 froze the first durable source boundary, and PR
> #944 implemented that source as a transactional `notification_outbox` row for
> accepted Ride status changes. The Notification service route, worker, Inbox
> projection and delivery channels are still not implemented or activated.

## Context

Today there is **no notification delivery**, but there is now a durable source
ledger from which delivery can safely grow.

The PWA `/inbox` hub (`public/src/screens/inbox.js`, BD-NOTIF-01) still renders a
tabbed list (Все / Отклики / Сообщения / Поездки) from a **static mock seed**
(`INBOX_ITEMS_V1` in `public/src/mock_api.js`) with per-item `unread` flags and
an unread badge. The push prompt is **UI-only**: its disclaimer says
"Демо-режим — реальные push не отправляются", and tapping "Включить" merely sets
`user.notificationsEnabled = true`. There is no
`Notification.requestPermission()` call.

`notificationsEnabled` lives in `bazardrive.user.v1` (`public/src/state.js`,
default `true`) and is **purely cosmetic**. Both notification entry points just
navigate to `/inbox`; there is no separate `/notifications` route.

The service worker (`public/sw.js`) is pure precache + offline fallback: no
`push` listener, no `notificationclick` handler and no `showNotification()`.
The live backend Ride poll exposes one Ride's participant-only timeline; it is
not a user notification feed.

What changed in September 2026 is the **source side**. PR #944 implemented the
BD-DOCS-050 contract inside the authoritative Ride transition transaction:

```text
Ride status mutation
  → ride_events.status_change
  → notification_outbox / ride.status_changed.v1
  → commit
```

The outbox stores frozen server-owned actor/audience/source identity atomically
with the Ride transition. There is still no worker that claims the row, no
consumer ledger, no Inbox projection, and no channel provider.

## Current implementation split

| Layer | State | Notes |
|---|---|---|
| Ride event source | **LIVE** | Authoritative Ride transition + append-only `ride_events`. |
| Transactional notification source outbox | **LIVE dark foundation** | #944 / BD-DOCS-050; no fan-out side effects. |
| Notification service route | **DARK** | `server/src/services/notifications/index.js` remains `501 NOT_IMPLEMENTED`. |
| Worker claim/lease/retry | **Not implemented** | Contract-first next step #948. |
| Server Inbox feed/read state | **Not implemented** | PWA still uses mock seed/unread state. |
| Web Push / Telegram / SMS-email | **Not implemented** | Provider/channel tracks remain future. |
| Notification activation | **Not implemented** | No staging/production delivery cutover. |

This split is intentional. The durable source foundation must not be mistaken
for a shipped Notification Service. Under the Project #1 Design State rules,
service #6 remains **Designed (ADR)** until real service/fan-out behavior is live.

## Decision

Introduce a server-side **Notification Service** (#6) as an event fan-out hub,
built incrementally from the durable source ledger:

1. **Events are server-emitted, not mock-seeded.** Domain events from the other
   services (dispatch #1, Ride State #5, chat) flow into a durable source and
   then a **per-user notification feed**. `/inbox` eventually renders that feed
   instead of `INBOX_ITEMS_V1`. The first Ride status source is already frozen
   by BD-DOCS-050 and implemented by #944; other producer event types require
   their own authority/schema review.
2. **Before fan-out, add a dark worker contract/runtime.** The next stateful step
   is #948: freeze exactly what worker state is stored, who writes/reads it,
   claim/lease/retry/crash transitions, late-commit-safe discovery and
   observability. Only after that contract is reviewed may a separate dark
   worker runtime be proposed.
3. **Real-time delivery uses channel fan-out.** One durable source event can be
   consumed for the channels a user has enabled. In-app real-time uses the
   transport selected for the fleet architecture; out-of-app delivery uses Web
   Push, Telegram and SMS/email.
4. **Delivery may later respect presence.** Once Phase 2 presence exists, an
   online session can prefer in-app delivery while offline users can fall back
   to external channels. This is a later delivery-policy decision and must not
   rewrite the frozen source audience.
5. **The service worker gains real push capability only in a dedicated safety
   slice.** `sw.js` would add `push`, `showNotification()` and
   `notificationclick` behavior plus subscription handling. That work touches
   SW/CSP/manifest boundaries and must remain separate from the outbox worker.
6. **`notificationsEnabled` becomes real per-channel preference data.** OS
   permission and server preference are distinct. The current cosmetic boolean
   cannot be used as delivery authority.
7. **One identity-owned hub remains the target.** `/inbox` stays the in-app hub
   unless a later route audit changes that decision. Feed and read/unread state
   become server-owned and consistent across devices.

This ADR decides the target shape, not one large implementation PR. The runtime
must continue to move by narrow slices:

```text
source contract
  → source runtime (#944)
  → worker contract (#948)
  → dark worker runtime
  → consumer/feed contract
  → Inbox projection/runtime
  → channel contracts/runtimes
  → activation
```

## Alternatives considered

| Option | Pros | Cons | Rejected because |
|---|---|---|---|
| Status quo — mock seed + read-on-open | No backend | No delivery; events never reach the user unless they open a screen | Not a notification system |
| Client polling only (no push) | Simple; no SW push | No out-of-app reach; battery cost; misses backgrounded users | Drivers/passengers must eventually be reachable when the app is closed |
| Push-only (no in-app real-time) | Reaches closed apps | Clunky for an open connected client; OS-permission-gated | An open client should update from server state, not rely on OS toasts |
| Publish only to in-process bus | Minimal implementation | Loses events on process crash and is outside the domain commit | Not a durable source |
| **Durable source → worker → feed/channel fan-out (chosen)** | Crash-safe source, incremental contracts, multiple consumers | More explicit persistence/ops work | Matches backend source-of-truth and audit requirements |

## Consequences

- **Positive:**
  - Accepted Ride transitions already have a durable notification source.
  - Worker/feed/channel work can now be separated from the Ride transaction.
  - Frozen source audience prevents later assignment drift from rewriting who
    the event originally concerned.
  - `/inbox` can later become consistent across a user's devices.
- **Negative / trade-offs:**
  - A crash-safe worker needs explicit leases, retries, idempotency and
    late-commit discovery; a simple `last_seen_seq` loop is insufficient.
  - Service worker push + CSP + provider credentials remain separate security
    surfaces.
  - Real read state and preferences require additional server persistence.
  - Presence-aware channel selection depends on future Availability work.
- **Follow-ups:**
  - [x] [Notification Outbox Source Contract (BD-DOCS-050)](notification-outbox-contract.md)
    plus source runtime #944.
  - [ ] #948 — worker claim/lease/retry contract.
  - [ ] Dark worker runtime after #948.
  - [ ] Server Inbox projection + per-consumer/read-state contract.
  - [ ] Transport/presence integration.
  - [ ] Web Push/VAPID, Telegram and SMS/email provider slices.
  - [ ] Notification taxonomy, batching/coalescing and quiet hours.

## Boundaries

This ADR and the shipped source foundation do not authorize:

- turning `server/src/services/notifications/index.js` live;
- a worker implementation before #948 is reviewed;
- PWA Inbox cutover;
- Push permission prompts or subscriptions;
- service-worker/CSP/manifest edits;
- Telegram/SMS/email provider credentials;
- Safety automation or moderation;
- staging/production notification activation.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
for the synchronized service map,
[Notification Outbox Source Contract (BD-DOCS-050)](notification-outbox-contract.md)
for the durable source invariants, and #948 for the next contract-first slice.
