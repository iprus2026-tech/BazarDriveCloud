---
id: BD-DOCS-032
docType: decision-record
title: "Auth & Identity — Decision Record"
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
    - public/src/state.js
    - public/src/garage.js
  issues: []
  prs: []
tags: [decision-record, adr, auth, identity, target, phase-1]
slug: /decisions/auth-identity
---

# Auth & Identity — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** Both
> [ADR BD-DOCS-030](shared-source-of-truth.md) and the
> [Data Layer Contract BD-DOCS-031](../design/data-layer-contract.md) deliberately
> deferred identity/auth to *this* ADR. BazarDrive **today** is a backless vanilla
> PWA; there is no server, no real authentication. Nothing here is built yet.

## Context

Identity today lives entirely in the client `bazardrive.user.v1` store
(`public/src/state.js`):

- **Role** — `role: 'passenger' | 'driver' | 'guest'` (a field, not an account).
- **Phone** — `phone` and a `phoneVerified` boolean already exist (v9,
  BD-PROFILE-01 phone-verification surface) — but `phoneVerified` is a
  **client-set flag**, not a server-verified fact.
- **Compliance** — driver documents (`driverLicense`, `taxiOsago`,
  `taxiRegistry`, `waybill`, `medicalCheck`) and the derived gates
  `computeDocumentsReady` / `isDriverLineReady`, all computed **client-side**.
- **Vehicles** — the driver garage collection (v11, BD-PROFILE-D-05F; resolver in
  `public/src/garage.js`) is nested inside `user.v1`.

Because identity is per-client, there is **no durable account**: the same person
on another device is a different `user.v1`. ADR-030's shared source of truth
cannot attribute orders, offers, rides or compliance to a real actor without a
server identity. This is a **prerequisite** for the data-layer migration to be
meaningful.

## Decision

Introduce **server-side identity and authentication**:

1. **One account, a roles set plus an active role.** A single identity carries
   `roles` (the set of granted roles, e.g. `[passenger, driver]`) plus
   `activeRole` (the currently selected one). The runtime's **scalar `role`** in
   `user.v1` (`state.js:46`) maps to `activeRole`, so a passenger who also drives
   is representable without overwriting. No separate passenger/driver accounts.
   *(This refines the scalar `users.role` sketched in BD-DOCS-031 into
   `roles` + `activeRole`; reconciling that field is a follow-up below.)*
2. **Phone + OTP is the auth method.** It matches the surface already in the
   runtime (`phone`, `phoneVerified`). Verification moves from a client flag to a
   **server-issued, verified session** — `phoneVerified` becomes a server fact.
3. **`user.v1` becomes a local cache of the authenticated session**, not the
   authority. It holds the current session/profile snapshot for UX; the server
   owns identity, role, and compliance.
4. **Authorization is server-validated.** `isDriverLineReady` and the document
   gates stay in the client as a **UX hint**, but the server re-validates role +
   compliance before any driver action (going online, accepting an order).
5. **Compliance & vehicles bind to the identity.** Driver documents become a
   server-owned compliance record; the driver garage maps to the server
   **vehicles** entity (BD-DOCS-031), keyed by the driver identity.

This ADR decides **identity model, auth method, and session boundary**. Token
format, OTP provider, and session lifetime are deferred (see Open questions).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — client-only `user.v1` | No backend | No durable account; identity per-device | Cannot attribute shared orders/rides to an actor |
| Anonymous device-id only | No login friction | No real person behind a device; no recovery; weak for compliance/safety | Driver compliance & safety (Phase 6) need a real identity |
| Third-party OAuth (Google/Apple) | Offloads auth | Adds external dependency/origins; no phone link, which dispatch/SMS need | Phone is already the surface and is needed for ride comms |
| **Phone + OTP (chosen)** | Matches existing `phone`/`phoneVerified`; phone needed anyway | Build OTP delivery + session infra | — |

## Consequences

- **Positive:**
  - Durable, cross-device account; orders/offers/rides attributable to a real
    actor — unblocks the meaning of ADR-030's shared truth.
  - `phoneVerified` becomes trustworthy; compliance gates become enforceable
    server-side, not just client UX.
  - Gives the **vehicles** split (BD-DOCS-031 open question) an owner to bind to.
- **Negative / trade-offs:**
  - New infra: OTP delivery, session/token issuance, refresh, revocation.
  - **CSP** must allow the auth origin; the **service worker** must **never
    cache** auth tokens or identity responses and must handle `401`/refresh — a
    safety-boundary change (sw-offline-agent scope).
  - Offline: a cached session must degrade safely when the token is stale.
- **Follow-ups:**
  - Token format / OTP provider / session lifetime design.
  - Vehicles split out of the driver garage into the server **vehicles** entity
    (BD-DOCS-031 follow-up).
  - Phase 2 presence (BD-DOCS-023) keys heartbeat to the authenticated driver
    identity.
  - Reconcile the **`users.role`** field in BD-DOCS-031 (scalar) into
    `roles` + `activeRole` to match this decision.

See [ADR BD-DOCS-030](shared-source-of-truth.md) for the shared-source-of-truth
decision this supports, and the
[Data Layer Contract BD-DOCS-031](../design/data-layer-contract.md) for the
entity model that defers `users`/identity here.
