# BD-DAILY-COMM-01 — Daily Communication Contract

## Архитектурный слой

Этот срез двигает **Passenger App / Driver App / Store / Notification Service / Backend API contract / Smoke**.

Runtime-реализация остаётся локальным PWA-прототипом. Backend, DB, Redis, dispatcher, реальные push/SMS/Telegram и ride/order lifecycle не меняются.

## Назначение

Daily Communication — единый операционный канал для ежедневной связи пассажира, водителя и поддержки. Он нужен, чтобы быстро подтверждать подачу, уточнять точку встречи, фиксировать сообщения по активной поездке и видеть темы, требующие реакции.

## Target backend contract

В целевой Mini-Yonder модели backend является source of truth.

### `communication_threads`

- `id`
- `orderId`
- `rideId`
- `channel`
- `status`
- `priority`
- `participantRoles`
- `unreadForRoles`
- `lastMessageAt`
- `createdAt`
- `updatedAt`

### `communication_messages`

- `id`
- `threadId`
- `authorRole`
- `type`
- `body`
- `requiresAck`
- `createdAt`
- `deliveredAt`
- `acknowledgedAt`

## State machine

```text
OPEN
  → ACK_REQUIRED     when a message requires acknowledgement
  → NEEDS_ACTION     when an operational issue needs a decision
  → RESOLVED         when the topic is closed

ACK_REQUIRED
  → ACKNOWLEDGED     when the user presses “Принять”
  → NEEDS_ACTION     when the issue escalates
  → RESOLVED         when the topic is closed

NEEDS_ACTION
  → ACKNOWLEDGED     when the issue is accepted into work
  → RESOLVED         when the topic is closed

ACKNOWLEDGED
  → OPEN             when a new message arrives
  → RESOLVED         when the topic is closed

RESOLVED
  → OPEN             when a new message arrives
```

## Current runtime prototype

The current PWA has no backend. `BD-DAILY-COMM-01` therefore stores the prototype inside the existing audited `bazardrive.chat.v1` localStorage key under a reserved namespace:

```text
__daily_communication_threads__
```

This prevents a new orphan storage key from appearing before the data-layer migration, and the existing auth boundary already clears `bazardrive.chat.v1` on local logout/reset.

## Writers and readers

### Writers

- `daily_communication_store.js`
  - seeds demo threads
  - sends local messages
  - acknowledges a thread
  - resolves a thread

### Readers

- `screens/daily_communication.js`
  - lists threads
  - filters by tab
  - renders selected thread history
  - opens linked chat, ride, driver map, inbox or rules screens

## Isolation rules

Daily Communication does **not** mutate:

- orders
- active rides
- driver assignment
- driver availability
- route / price
- receipts
- ride history
- ratings

It only writes communication state. CTAs navigate to existing screens.

## Smoke coverage

`smoke-inbox.mjs` now pins the route, store, screen hooks, CSS link and Service Worker precache entries for the Daily Communication slice.
