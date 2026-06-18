---
id: BD-DOCS-037
docType: decision-record
title: "Phase 6: Safety & Compliance — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-06-18
effectiveFrom: 2026-06-18
reviewAfter: 2026-12-18
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/screens/active_ride_passenger_sheets.js
    - public/src/screens/order_detail.js
    - public/src/state.js
    - public/src/ride_state.js
    - public/src/screens/active_ride_driver_noshow.js
  issues: []
  prs: []
tags: [decision-record, adr, safety, compliance, moderation, risk, target, phase-6]
slug: /decisions/safety-compliance
---

# Phase 6: Safety & Compliance — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This is
> **Phase 6** of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (service #7 Safety & Compliance). It builds on
> [Phase 1 shared source of truth (BD-DOCS-030)](shared-source-of-truth.md) and
> the [Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md),
> [Auth & Identity (BD-DOCS-032)](auth-identity.md),
> [Phase 5 Notification Service (BD-DOCS-036)](notification-service.md), and the
> existing Ride State Machine (service #5). BazarDrive **today** is a backless
> PWA; nothing here is built.

## Context

Safety and compliance today are **trust on trust** — the UI exists, but nothing
is recorded, verified, or enforced.

- **In-ride safety report** (`active_ride_passenger_sheets.js`, BD-RIDE-P-07): a
  "Центр безопасности" sheet with five categories (route deviation, rude,
  car mismatch, unsafe driving, other). Submit is a **no-op** — a session toast
  with a hardcoded `№RPT-4821`; nothing persists. Call / share / support / SOS
  are demo stubs (no real 112 dispatch).
- **Order report** (`order_detail.js`, BD-MOD-01, `data-action="report-order"`):
  an inert modal with preset reasons (fraud, insults, spam, other). Submit only
  flips a local view to `submitted`; the copy itself says moderation comes "после
  подключения backend". No persistence.
- **Driver compliance** (`public/src/state.js`): documents
  (`driverLicense` / `taxiOsago` / `taxiRegistry` / `waybill` / `medicalCheck`)
  are **local status enums** (`uploaded` / `review_required` / `expired` /
  `missing` / `draft`) and `documentsReady` / `waybillOpen` /
  `medicalCheckPassed` are **client booleans**. `isDriverLineReady()` gates going
  online on them, but **nothing is uploaded or verified** — a client can set
  itself ready.
- **No-show** (`ride_state.js` `NO_SHOW`; `active_ride_driver_noshow.js`,
  BD-RIDE-D-NOSHOW-01): a real terminal status the driver triggers from
  `WAITING_PASSENGER`, persisted to `localStorage` with **demo** compensation —
  no auto-detection, no money, no backend.
- **Cancellations** (BD-RIDE-P-06 / BD-RIDE-D-07): record `cancel.by` +
  `cancel.reason` + `canceledAt` locally; no penalty or pattern detection.
- **Blocks / risk / fraud: none exist.** Ratings are stored and displayed
  (`ride_history.js`) but **never** gate access or eligibility.

There is no report destination, no document verification, no risk signal, and no
audit trail. A fleet cannot run on this.

## Decision

Introduce a server-side **Safety & Compliance service** (#7):

1. **Reports become server-persisted moderation cases.** The in-ride safety
   report (BD-RIDE-P-07) and the order report (BD-MOD-01) submit to a real
   **case backend** — a report keyed to identity + ride/order, entering a
   moderation queue. The fake `№RPT-4821` becomes a real **server case id**. The
   shipped UI stays; only the submit gains a backend.
2. **Compliance becomes server-verified, not self-asserted.** Documents move
   server-side as **verified records** (real upload → object storage per
   BD-DOCS-023; status set by **verification**, not the client).
   `isDriverLineReady()` becomes a **server gate** — it already drives Phase 2
   presence revalidation (BD-DOCS-033) — so a client can no longer mark itself
   ready.
3. **No-show and cancellations become recorded compliance signals.** The ride
   state machine (#5) stays the canon for `NO_SHOW` / `CANCELED`; the server
   records each with **actor + reason** and accrues them into per-user compliance
   signals (penalties, pattern detection). Auto-detection of no-show (time /
   location) becomes possible once Phase 4 geo lands.
4. **Risk, blocks, and trust become real and enforced.** Introduce **risk
   scoring, blocks/bans, and trust gates** keyed to identity (BD-DOCS-032),
   enforced at the points that already gate behavior: going **online**
   (Phase 2 presence), **accepting / assigning** (Phase 3 dispatch), and placing
   an order. Ratings become an **input to trust**, not just a display string.
5. **Safety/compliance decisions are auditable.** Every report outcome, block,
   penalty, and verification is **logged** as an audit event — the live ops view
   is the Monitoring & Audit concern (#9, Phase 7); this ADR establishes that the
   decisions are server-authoritative and recorded.
6. **Preserve the shipped safety UX — wire it, don't reroute it.** Per CLAUDE.md,
   the BD-RIDE-P-07 safety sheet behavior is preserved and **not** rerouted to a
   generic `/report`; SOS / emergency stays its own surface. Phase 6 connects the
   existing CTAs to the backend; it does not restructure the safety UI.

This ADR decides **that reports become server-persisted moderation cases,
compliance becomes server-verified, no-show/cancellation become recorded
compliance signals, and risk/blocks/trust become real and enforced at the
existing gates — all keyed to identity and auditable**. The penalty / risk-scoring
model, the document-verification (KYC) provider, the moderation workflow / SLA,
and the live audit dashboard (Phase 7) are deferred (see Follow-ups).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — UI stubs, local flags | No backend | Reports vanish; compliance self-asserted; no trust | Unsafe; not operable as a fleet |
| Reports only (no compliance/risk) | Quick moderation inbox | Drivers still self-certify; no blocks | Half a safety system; trust still unenforced |
| Client-side risk/rating gates | No backend | Forgeable; no audit; privacy of PII on device | Trust decisions must be server-authoritative |
| **Server Safety & Compliance service (chosen)** | Verified compliance; real reports; enforced trust; auditable | Needs moderation backend, KYC, audit infra | — |

## Consequences

- **Positive:**
  - Reports reach a real queue; the safety UX finally does something.
  - Compliance is verified, not self-asserted — drivers cannot fake readiness.
  - Trust is enforced at the gates that already exist (presence, dispatch),
    reusing them rather than adding new ones.
  - Ratings, no-show, and cancellations become meaningful compliance inputs.
- **Negative / trade-offs:**
  - Document verification is a **KYC / PII** surface — object storage, privacy,
    and legal obligations (retention, access control).
  - Moderation needs a **human workflow** (queue, SLA, appeals); risk scoring can
    produce **false positives** that require an appeal path.
  - Penalties can touch **money** (cancellation fees, no-show comp) — ties to a
    future payments phase and must be scoped carefully.
  - **SOS / emergency** carries duty-of-care and legal implications; it stays a
    demo surface until a real emergency integration is decided.
- **Follow-ups:**
  - Penalty / risk-scoring model and how ratings feed it.
  - Document verification (KYC) provider and document lifecycle (expiry, renewal).
  - Moderation workflow — queue, SLA, actions, appeals.
  - Audit trail / live ops dashboard — the Monitoring & Audit concern (Phase 7).
  - Real emergency (112) integration — its own legal/ops decision.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(service #7) for the target architecture,
[Auth & Identity (BD-DOCS-032)](auth-identity.md) for the identity that risk,
blocks, and verification are keyed to, and
[Phase 5 Notification Service (BD-DOCS-036)](notification-service.md) for how
moderation outcomes and safety alerts reach users.
