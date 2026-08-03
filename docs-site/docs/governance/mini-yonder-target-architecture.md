---
id: BD-DOCS-046
docType: process
title: "BazarDriveCloud — Mini-Yonder Target Architecture"
owner: docs-contract-agent
status: draft
revision: 2026-08-03
effectiveFrom: 2026-08-03
reviewAfter: 2027-02-03
visibleFor: [developer, designer, dispatcher, product, qa]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - docs-site/docs/governance/mini-yonder-background-services.md
    - docs-site/docs/decisions/backend-home-and-stack.md
    - docs-site/docs/decisions/shared-source-of-truth.md
    - docs-site/docs/design/data-layer-contract.md
    - docs-site/docs/decisions/auth-identity.md
    - docs-site/docs/decisions/presence-heartbeat.md
    - docs-site/docs/decisions/dispatch-matching.md
    - docs-site/docs/decisions/route-price-map.md
    - docs-site/docs/decisions/notification-service.md
    - docs-site/docs/decisions/safety-compliance.md
    - docs-site/docs/decisions/monitoring-audit.md
    - public/src/ride_state.js
    - server/src/domain/ride-status.js
    - server/src/infra/bus.js
  issues: []
  prs: []
tags: [governance, mini-yonder, architecture, target, diagram]
slug: /governance/mini-yonder-target-architecture
---

# BazarDriveCloud — Mini-Yonder Target Architecture

> **TARGET ARCHITECTURE — PROPOSED — NOT DEPLOYED (`status: draft`).** Nothing on
> this page is running. It is a text-based, versioned successor to a visual
> architecture-diagram artifact reviewed against PR #842 (BD-DOCS-045, the
> schema-column audit): verdict **"PASS as a visual concept, BLOCKED as the
> canonical architecture diagram."** Per that review, the diagram artifact was
> kept **out of** #842 (a schema audit and an architecture diagram are different
> concerns) and is not committed to the repo as an image; this page is the
> corrected, docs-only slice instead. Any illustrative vehicle in a future
> rendered diagram (e.g. a Prius) is an example car only, not an integration.
> This page has no dedicated tracking Issue yet (`related.issues: []`) — one is
> opened once PR #842's own gate clears, per the review sequencing; it is not
> #842 itself, which is a separate schema-audit PR this page must not be mixed
> into.

## Why this page exists

[Mini-Yonder Background Services (BD-DOCS-023)](mini-yonder-background-services.md)
already names the 8 target background services and the growth path. The
reviewed diagram tried to draw that same target as boxes and arrows and picked
up real presentation gaps along the way — some of them corrections to this
page's own wording, one of them a genuine decision gap the ADRs below leave
open. This page:

- **Does not re-decide anything already decided.** Where BD-DOCS-023/030–038/
  041/044 already settled a question, this page points at that ADR instead of
  repeating or re-litigating it.
- **Fixes the presentation-level gaps** the review found (missing edge tier,
  ambiguous Dispatcher/State-Machine split, imprecise external-service arrows,
  a typo, an untitled diagram).
- **Names one real gap plainly** (Payments & Payouts — [§5](#5-payments--payouts--open-gap-not-in-the-8-services))
  instead of inventing an ADR for it here.

## 1. Client layer — one PWA, two roles, not two apps

The reviewed diagram drew a "Passenger App" box and a "Driver App" box as if
they were two separate client binaries. Per CLAUDE.md's route truth, that is
not what ships or what is planned: BazarDrive is **one static PWA**
(`public/`), and passenger vs. driver is a **role**, not a separate app —
e.g. `/profile` and `/profile?role=driver` share one screen, `/settings` is
one role-aware shell, and `/active-ride?role=passenger|driver` is one route
family. Any target-architecture diagram should draw **one PWA client** with
two role-driven experiences, not two boxes.

The PWA talks to the **backend** over exactly two seams, never anything else:

- The **Backend API** (REST, `/api/v1/...`) for request/response calls.
- The **Realtime Gateway** for server-pushed events (once a transport is
  chosen — see [§2](#2-edge-tier--backend-api--authrbac--realtime-gateway)).

**The PWA never talks to the database or the cache directly** — no direct
Postgres or Redis access from `public/`. Today (`status: draft`, nothing
deployed) the PWA's only persistence is `localStorage` via `mock_api.js`;
[Backend Home & Stack (BD-DOCS-041)](../decisions/backend-home-and-stack.md)
already decides `localStorage` is demoted to an optimistic/offline cache once
a server exists, read through `api_client.js` — the client still never reaches
past the Backend API seam.

**One documented exception: client-side third-party SDKs.** A handful of
vendor integrations run *in the browser* and connect straight to the vendor,
never through the backend at all — this is a distinct category from "talking
to the backend" above, not a violation of it. Today this is already real, not
future: **Mapbox GL JS** is vendored and loaded client-side
(`public/src/mapbox/mapbox_loader.js`, `mapbox_config.js`), and on the
production Pages origin with its committed URL-restricted token, `/map`
renders real Mapbox tiles by calling `api.mapbox.com` **directly from the
browser** (BD-MAP-FOUND-01 / BD-MAP-ACTIVATE) — the CSP allows it, and no
backend call is involved. **Web Push** will be the same shape once
BD-DOCS-036 ships: the browser's push service delivers straight to the
service worker, not through the Realtime Gateway. See
[§7](#7-external-integrations--one-edge-each) for the corrected list of which
integrations are backend-mediated vs. direct-to-browser.

## 2. Edge tier — Backend API / Auth·RBAC / Realtime Gateway

The reviewed diagram jumped straight from the client boxes to the 8 service
boxes, with no edge tier in between. [Backend Home & Stack (BD-DOCS-041)](../decisions/backend-home-and-stack.md)
already decided this tier; the diagram just needs to show it:

| Edge component | What it is | Decided in |
| --- | --- | --- |
| **Backend API** | Fastify 5 process, `/api/v1/...`, JSON-Schema validated per route | BD-DOCS-041 |
| **Auth / RBAC** | `plugins/auth.js` — session resolve → `request.user`; phone + OTP identity, roles | BD-DOCS-041 (stack) · BD-DOCS-032 (identity) |
| **Realtime Gateway** | `plugins/realtime.js` mount point over the `infra/bus.js` hub; transport (WebSocket vs SSE vs poll) is picked by Presence/Dispatch/Notifications, not by this foundation ADR | BD-DOCS-041 (seam) · BD-DOCS-033/034/036 (transport) |

All 8 logical modules in [§4](#4-eight-logical-backend-modules-not-mandatory-microservices)
sit **behind** this tier — a module never receives a client request or push
directly; it always goes through the Backend API / Auth·RBAC / Realtime
Gateway first.

## 3. Orchestration — Event Bus today, Job Queue still open

The reviewed diagram had no place for asynchronous or fan-out work (matching
broadcast, notification delivery, receipt rendering) and, worse, this page
used to call that one box "Event Bus / Job Queue" as if they were the same
seam. They are not, and only one of them is real:

- **Event Bus — real, and it is a plain in-process `EventEmitter`.**
  `server/src/infra/bus.js` (`createBus()`) wraps Node's `EventEmitter`
  (`kind: 'in-proc'`, `publish`/`subscribe`). It has **no persistence, no
  retry, no acknowledgement, no dead-letter handling** — a subscriber that is
  down when an event fires simply misses it. It is decorated as `fastify.bus`
  and structured to become Redis pub/sub once there is more than one server
  instance (BD-DOCS-041), but that swap has not happened. It is the seam
  behind Dispatcher → driver offer fan-out (BD-DOCS-034) and domain events →
  the Notification fan-out hub (BD-DOCS-036), once those publish/subscribe.
- **Job Queue — not decided by any ADR.** Durable background work that must
  survive a process restart or a failed attempt (retryable notification
  delivery, receipt rendering, any at-least-once job) needs a durable queue
  with retry and a worker process — `infra/bus.js` provides none of that.
  No BD-DOCS ADR picks a queue technology, a persistence store, or a worker
  model for this. Track it as its own open gap (see
  [§11](#11-follow-ups-not-done-on-this-page)) — a diagram must not draw one
  box implying both are solved.

## 4. Eight logical backend modules (not mandatory microservices)

Same 8 concerns as BD-DOCS-023 — named here as **logical modules of one
backend process** (`/server/src/services/*`, per BD-DOCS-041), not eight
services that must each be its own deployable microservice. Splitting any of
them into a separate process is a future, separately-justified decision, not
implied by this diagram.

| # | Module | Responsibility | Decided in |
| --- | --- | --- | --- |
| 1 | **Order Dispatcher** | **Orchestrates**: owns the queue, the broadcast/offer fan-out, and the first-accept-wins assignment transaction. | BD-DOCS-034 |
| 2 | **Driver Availability** | Online/free/shift-ready presence + vehicle/compliance status. | BD-DOCS-033 |
| 3 | **Matching & Assignment** | Candidate lookup, scoring, ranking, vehicle-class match. | BD-DOCS-034 |
| 4 | **Route & Price (Map)** | Route/distance/ETA, geocoding, server-authoritative fare. | BD-DOCS-035 |
| 5 | **Ride State Machine** | **Validates**: owns the canonical `RIDE_STATUS` enum and the terminal-freeze check — it does not queue or broadcast. Full transition-sequence validation is **not yet enforced**; see the correction below. | BD-DOCS-041 (authority) · `public/src/ride_state.js` (enum) |
| 6 | **Notification Service** | Event fan-out to push / Telegram / SMS / in-app, presence-aware routing. | BD-DOCS-036 |
| 7 | **Safety & Compliance** | Fraud/no-show rules, document checks, moderation, risk. | BD-DOCS-037 |
| 8 | **History & Receipt** | Ride history read model, receipt data, ratings. | this page, §6 |

**Dispatcher vs. State Machine — the split the reviewed diagram blurred:**
the Dispatcher (#1) **orchestrates** — it decides *when* and *to whom* an
order or a status change is proposed, and drives the workflow forward. The
Ride State Machine (#5) **validates** — it is the single chokepoint every
status change goes through. The Dispatcher calls into the State Machine for
every status change; it never bypasses it, and the State Machine never
initiates a transition on its own. One box orchestrates, one box guards —
they are not the same responsibility drawn as one blob.

**What "validates" actually checks today — corrected.** The shipped
`canTransition(from, to)` (`server/src/domain/ride-status.js`, mirrored from
the client's terminal-freeze rule) is narrower than the phrase "transition
rules" implies:

```js
export function canTransition(from, to) {
  if (TERMINAL_RIDE_STATUSES.has(from) && to !== from) return false;
  return true;
}
```

It enforces **only the terminal freeze** — a record already in `COMPLETED` /
`CANCELED` / `NO_SHOW` cannot move to a different status. It does **not**
check the `NEXT_STATUS` map at all: any non-terminal status may currently
transition to **any** other status, including skipping steps or moving
"backwards" — `NEXT_STATUS` / `getNextStatus()` is only an advance-suggestion
helper, not a guard `canTransition()` consults. **Full transition-sequence
validation is an open gap**, not a shipped property — track it alongside the
other open items in [§11](#11-follow-ups-not-done-on-this-page).

## 5. Payments & Payouts — open gap, not in the 8 services

The reviewed diagram drew an internal "Payments & Payouts" box next to a
"Payment Gateway" box. Checking the decided target against that: **neither
BD-DOCS-023's 8 services nor the BD-DOCS-041 `/server/src/services/*` folder
skeleton (`auth/ orders/ availability/ matching/ route-price/ ride-state/
notifications/ safety/ history/`) includes payments.** "Payment gateway" is
named only once, in BD-DOCS-023's external-services list, explicitly tagged
"future / not integrated."

This page does not invent that decision. Until a dedicated ADR exists:

- Draw **Payment Gateway** as an **external, future** integration only —
  same status as Mapbox/Telegram/SMS today — never as a wired internal
  module.
- Do **not** draw an internal "Payments & Payouts" module; there is no
  service folder, no entity, and no ADR backing one yet.
- Track "Payments & Payouts ADR" as a follow-up (see [§11](#11-follow-ups-not-done-on-this-page)),
  scoped and decided the same way BD-DOCS-032 through BD-DOCS-038 were.

## 6. Data layer — one source of truth, one derived cache

- **Database (PostgreSQL 16)** is the **source of truth** from Phase 1
  onward (BD-DOCS-030, BD-DOCS-041) — users, vehicles, orders, responses,
  offers, assignment, rides, ride events, receipts.
- **Cache (Redis) is never the authority for anything** — but "derived from
  the database" only describes part of it. Two different kinds of non-authority
  live there:
  - **Recomputable caches** — ETA/geo estimates, active-order lookups — can be
    thrown away and rebuilt by recomputing from the database (BD-DOCS-023).
  - **Live liveness signals** — the presence/heartbeat TTL set (BD-DOCS-033)
    — **cannot** be reconstructed from the database at all: "who is online
    right now" is not a fact the database stores. If this Redis data is lost,
    it is rebuilt only by **new heartbeats arriving**, not by a database read;
    until they do, presence is correctly empty (fail-safe "nobody is known
    online"), not restored from history.
- **Object storage** holds documents, media, logs, and **rendered receipt
  artifacts** (PDF/image). The receipt's structured data always lives in the
  database first (BD-RIDE-HISTORY-D-01 is a JSON row, per BD-DOCS-041); object
  storage holds only the file rendered from that row, never the other way
  round.

## 7. External integrations — one edge each

The reviewed diagram left external-service arrows ambiguous (which module
each one actually reaches). Corrected, each external integration has exactly
one internal edge:

| External service | Reaches | Status |
| --- | --- | --- |
| Mapbox GL JS — **map tile rendering only** | Nothing backend-side — direct browser ↔ `api.mapbox.com`, no module involved | **real**, conditionally active on a committed token (BD-MAP-FOUND-01 / BD-MAP-ACTIVATE) |
| Mapbox Directions / **geocoding** (real route, ETA, fare) | Route & Price (#4) only, server-mediated | future (BD-DOCS-035) — not yet called at all, per BD-DOCS-035's own context |
| Telegram bot, SMS / email | Notification Service (#6) only, server-mediated | future (BD-DOCS-036) |
| Web Push | direct browser-push-service ↔ service worker, not through any backend module | future (BD-DOCS-036) |
| Payment gateway | not wired to any internal module yet — see [§5](#5-payments--payouts--open-gap-not-in-the-8-services) | future, unintegrated (BD-DOCS-023) |
| Analytics | Monitoring & Audit (#9) only, server-mediated | future (BD-DOCS-023) |

**Corrected — not every external call is server-mediated.** Every
*backend-mediated* integration reaches exactly one internal module (no
integration fans into two). But two integrations bypass the backend
entirely and talk straight to the browser — Mapbox tile rendering (already
real, see [§1](#1-client-layer--one-pwa-two-roles-not-two-apps)) and Web Push
(future) — that is a deliberate, documented exception, not an oversight.

(Naming fix: **"Geocoding"**, one word — the term is already spelled
correctly in BD-DOCS-035; the reviewed diagram had it as two words.)

## 8. Correctness properties the modules must carry

- **Atomic assignment** — decided: the Dispatcher's first-accept-wins
  assignment is one transactional state change that also revokes competing
  offers (BD-DOCS-034 Decision §3).
- **Idempotency (client-proposed IDs / offline create)** — **not yet
  decided.** BD-DOCS-041 lists this in its own Open Questions
  ("ID strategy / offline create... client-proposed id / idempotency-key
  reconciliation for offline create deferred"). This page does not resolve
  it; a diagram should not imply idempotency exists until that question
  closes.
- **Optimistic locking / row versioning** — **not yet decided anywhere in
  the current ADR set.** Flagged here as an open gap that needs its own
  decision — likely folded into BD-DOCS-041's open questions or its own short
  ADR — before any `assignment` / `rides` write path is implemented against
  concurrent updates.
- **Full ride-status transition-sequence validation** — **not yet enforced.**
  As corrected in [§4](#4-eight-logical-backend-modules-not-mandatory-microservices),
  `canTransition()` today checks only the terminal freeze; it does not check
  that a transition follows `NEXT_STATUS`. A diagram or this page must not
  imply the State Machine already rejects an out-of-sequence, non-terminal
  transition — it currently allows it.

## 9. Corrected ride-state flow

BD-DOCS-023's own simplified diagram already notes CANCELED / NO_SHOW are
terminal; the reviewed diagram flattened them into a single tail after
COMPLETED. Corrected — CANCELED can branch off **any** non-terminal state, and
NO_SHOW off the pre-ride states, with COMPLETED as only one of three terminal
outcomes:

```text
CREATED ──► ACCEPTED ──► EN_ROUTE ──► ARRIVED ──► IN_PROGRESS ──► COMPLETED
   │            │            │            │             │
   ▼            ▼            ▼            ▼             ▼
CANCELED     CANCELED     CANCELED     CANCELED /    CANCELED
                                        NO_SHOW
```

The text above already said CANCELED can branch off **any** non-terminal
state, including `IN_PROGRESS` (an in-progress ride can still be canceled);
the diagram is drawn with that fifth branch so it matches the prose, not just
the four pre-handoff states.

CANCELED and NO_SHOW are terminal — once reached, the state is frozen (the
terminal-freeze rule already shipped client-side in `public/src/ride_state.js`
and mirrored server-side per BD-DOCS-041). This is still the **simplified**
diagram; the shipped `RIDE_STATUS` enum has more granular pre-handoff and
active-ride states — see BD-DOCS-023's own note on the full enum.

## 10. Arrow legend for this page's diagrams

| Style | Meaning |
| --- | --- |
| `──►` solid arrow | Synchronous request/response call |
| `⇢` dashed arrow | Asynchronous event/job fan-out over the Event Bus (§3) — fire-and-forget, no durability today |
| plain box adjacency | Same-process logical module (no network hop) |
| "reaches … only" (prose, §7) | The one external edge a backend-mediated integration is allowed |
| "direct browser ↔ vendor" (prose, §7) | The documented exception: a client-side SDK bypassing the backend entirely |

A scalable, rendered (SVG) version of this diagram with the same legend is a
follow-up asset task — see [§11](#11-follow-ups-not-done-on-this-page).

## 11. Follow-ups (not done on this page)

- **Payments & Payouts ADR** — a dedicated decision record before any
  internal payments module or entity is drawn as wired (§5).
- **Idempotency-key / optimistic-lock ADR** — resolve BD-DOCS-041's open ID
  strategy question and add row-versioning for concurrent writes (§8).
- **Full ride-status transition-sequence validation** — decide and implement
  a real `NEXT_STATUS`-checking guard; today only the terminal freeze is
  enforced (§4, §8).
- **Durable Job Queue** — pick a queue technology, persistence, and worker
  model for retryable background work; `infra/bus.js` is an in-process
  `EventEmitter` and provides none of that (§3).
- **Dedicated tracking Issue** — opened once PR #842's own gate clears, per
  the review sequencing (this page must not be mixed into #842 itself).
- **Rendered SVG diagram** — once the gaps above are decided, commission a
  scalable visual rendering of this page using the corrected boxes, edge
  tier, and arrow legend above; track as its own issue rather than attaching
  an image to a docs-content PR.

## Relation to existing ADRs

This page is a **synthesis, not a new decision**. It draws together:
[Mini-Yonder Background Services (BD-DOCS-023)](mini-yonder-background-services.md),
[Shared Source of Truth (BD-DOCS-030)](../decisions/shared-source-of-truth.md),
[Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md),
[Auth & Identity (BD-DOCS-032)](../decisions/auth-identity.md),
[Presence & Heartbeat (BD-DOCS-033)](../decisions/presence-heartbeat.md),
[Dispatch & Matching (BD-DOCS-034)](../decisions/dispatch-matching.md),
[Route & Price / Map (BD-DOCS-035)](../decisions/route-price-map.md),
[Notification Service (BD-DOCS-036)](../decisions/notification-service.md),
[Safety & Compliance (BD-DOCS-037)](../decisions/safety-compliance.md),
[Monitoring & Audit (BD-DOCS-038)](../decisions/monitoring-audit.md), and
[Backend Home & Stack (BD-DOCS-041)](../decisions/backend-home-and-stack.md).
Where this page and any of those ADRs ever disagree, the ADR wins — flag the
conflict and fix this page, not the other way round.
