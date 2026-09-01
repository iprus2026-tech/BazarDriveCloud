---
id: BD-DOCS-036
docType: decision-record
title: "Phase 5: Notification Service — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-09-01
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
    - server/src/infra/bus.js
  issues: []
  prs: []
tags: [decision-record, adr, notifications, push, real-time, target, phase-5]
slug: /decisions/notification-service
---

# Phase 5: Notification Service — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This is
> **Phase 5** of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (service #6 Notification Service). It builds on
> [Phase 1 shared source of truth (BD-DOCS-030)](shared-source-of-truth.md) and
> the [Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md),
> [Phase 2 Presence & Heartbeat (BD-DOCS-033)](presence-heartbeat.md),
> [Phase 3 Dispatch & Matching (BD-DOCS-034)](dispatch-matching.md), and
> [Auth & Identity (BD-DOCS-032)](auth-identity.md). The backend spine and
> authoritative Ride event path now exist, but the Notification service itself
> remains a dark `501 NOT_IMPLEMENTED` skeleton. The first source boundary is
> specified separately by the contract-only
> [Notification Outbox Source Contract (BD-DOCS-050)](notification-outbox-contract.md);
> no outbox or delivery runtime is implemented.

## Context

Today there is **no notification delivery**. The backend has authoritative Ride
state and participant-only polling for the append-only Ride timeline, but there
is no durable notification outbox, fan-out worker or per-user notification feed.
The `/inbox` hub (`public/src/screens/inbox.js`, BD-NOTIF-01) still renders a
tabbed list (Все / Отклики / Сообщения / Поездки) from a **static mock seed**
(`INBOX_ITEMS_V1` in `public/src/mock_api.js`) with per-item `unread` flags and
an unread badge. The push prompt is **UI-only**: its own disclaimer reads
"Демо-режим — реальные push не отправляются", and tapping "Включить" merely sets
`user.notificationsEnabled = true`. There is **no** `Notification.requestPermission()`
call.

`notificationsEnabled` lives in `bazardrive.user.v1` (`public/src/state.js`,
default `true`) and is **purely cosmetic** — it controls only whether the inbox
prompt shows; **no code path gates any delivery** on it. Both notification entry
points just navigate to the hub: the passenger bell `#pfp-notif-btn` and the
driver action `#pf2-act-notif` (`public/src/screens/profile.js`) both
`go('/inbox')`. Only `/inbox` is registered (`public/src/app.js`); there is no
`/notifications` route.

The **service worker** (`public/sw.js`) is pure precache + offline fallback: **no
`push` listener, no `notificationclick` handler, no `showNotification()`** — zero
push capability. The live backend polling seam exposes a Ride's participant-only
timeline; it is not a notification feed and does not fan out to user channels.
A passenger still only "finds out" about a mock/local response by **opening**
`/responses` or `/inbox`, which read `localStorage`/mock synchronously on
navigation. The server now produces authoritative Ride `status_change` events,
but nothing persists or delivers them as notifications.

## Decision

Introduce a server-side **Notification Service** (#6) — an event fan-out hub:

1. **Events become server-emitted, not mock-seeded.** Domain events from the
   other services (dispatch #1, ride state #5, chat) — new response, offer,
   assignment, ride-status change, message — flow into a **per-user notification
   feed**. `/inbox` renders that feed instead of the static `INBOX_ITEMS_V1`
   seed. The first durable source boundary is frozen by
   [BD-DOCS-050](notification-outbox-contract.md); that contract does not itself
   implement the outbox, feed or delivery runtime.
2. **Real-time delivery via channel fan-out.** The service is the **fan-out
   hub**: one event → the channels a user has enabled. **In-app real-time** uses
   the same transport decided for Phase 2/3 (WebSocket or polling); **out-of-app**
   uses **Web Push** (via the service worker), **Telegram**, and **SMS/email**.
3. **Delivery respects presence (Phase 2).** Route in-app real-time to **online**
   sessions; fall back to push / Telegram / SMS when the user is **offline** — so
   an actively-connected client is not double-notified.
4. **The service worker gains real push capability.** `sw.js` adds a `push`
   listener + `showNotification()` + a `notificationclick` handler that opens the
   right route, plus a push subscription (e.g. VAPID). This is a **safety-boundary
   touch** (`public/sw.js`, `public/index.html` CSP, `public/manifest.webmanifest`),
   sw-offline-agent scope.
5. **`notificationsEnabled` becomes real, per-channel preferences.** The single
   cosmetic boolean is replaced by **server-stored** preferences (per channel:
   in-app / push / Telegram / SMS, and per category), and the prompt actually
   calls `Notification.requestPermission()` and registers a push subscription.
   The OS permission state and the server preference are **distinct** and both
   honored.
6. **One hub, keyed to identity — `/inbox` is not orphaned.** Per CLAUDE.md,
   `/inbox` stays the single in-app hub (no split `/notifications` without an
   audit). The feed and its **read/unread state are server-owned**, keyed to the
   authenticated identity (BD-DOCS-032), so the same notifications and read state
   are consistent **across a user's devices** — replacing the per-seed `unread`
   flag.

This ADR decides **that notifications become a server-side event fan-out hub
delivering domain events over real-time + push/Telegram/SMS, keyed to identity,
with server-owned read state and real per-channel preferences, and that `/inbox`
stays the single in-app hub**. The transport (shared with Phase 2/3), channel
providers (Web Push/VAPID, Telegram bot, SMS), and notification taxonomy /
batching are deferred (see Follow-ups).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — mock seed + read-on-open | No backend | No delivery; events never reach the user unless they open a screen | Not a notification system |
| Client polling only (no push) | Simple; no SW push | No out-of-app reach; battery cost; misses backgrounded users | Drivers/passengers must be reachable when the app is closed |
| Push-only (no in-app real-time) | Reaches closed apps | Clunky for an open, connected client; OS-permission-gated | An open client should update live, not via OS toast |
| **Event fan-out hub: real-time + push/Telegram/SMS (chosen)** | Reaches users in any state; presence-aware; one hub | Needs SW push, providers, preference storage | — |

## Consequences

- **Positive:**
  - Real delivery — events reach users without opening a screen; ends the
    read-on-navigation model.
  - Server-owned read/unread state is consistent across a user's devices.
  - Reuses Phase 2 presence to pick the right channel (in-app vs out-of-app).
  - Keeps one hub (`/inbox`), avoiding an orphaned-route split.
- **Negative / trade-offs:**
  - **Service worker push + CSP + manifest** changes (safety boundary,
    sw-offline-agent scope); the SW must still **never cache** push/event traffic.
  - Provider integrations (Web Push/VAPID keys, Telegram bot, SMS/email) — each a
    cost, ops, and deliverability surface.
  - The always-on demo prompt becomes a **real OS permission** that can be
    **denied**; the UX must degrade gracefully to other channels.
  - Per-channel preferences and the feed need persistence (Phase 1 data layer).
- **Follow-ups:**
  - [Notification Outbox Source Contract (BD-DOCS-050)](notification-outbox-contract.md)
    — freeze event identity, producer-frozen audience, same-transaction
    Ride/timeline/outbox atomicity and late-commit-safe sequence semantics before
    the first outbox runtime slice.
  - Transport — shared with the Phase 2/3 real-time decision (WebSocket vs poll).
  - Channel providers — Web Push/VAPID, Telegram bot, SMS/email; deliverability.
  - Notification taxonomy — categories, batching/coalescing, quiet hours.
  - **Docs drift (separate fix):** CLAUDE.md states `#pf2-act-notif` toggles
    `notificationsEnabled`, but it now navigates to `/inbox`; update in a
    docs-contract task, not here.
  - `/inbox` vs a future `/notifications` split stays deferred pending the
    CLAUDE.md audit rule.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(service #6) for the target architecture,
[Phase 2 Presence & Heartbeat (BD-DOCS-033)](presence-heartbeat.md) for the
presence signal that picks the delivery channel, and
[Phase 3 Dispatch & Matching (BD-DOCS-034)](dispatch-matching.md) for the events
this service delivers, and the
[Notification Outbox Source Contract (BD-DOCS-050)](notification-outbox-contract.md)
for the contract-only first durable source boundary.
