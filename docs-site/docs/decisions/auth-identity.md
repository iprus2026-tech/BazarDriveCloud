---
id: BD-DOCS-032
docType: decision-record
title: "Auth & Identity — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-09-24
effectiveFrom: 2026-06-18
reviewAfter: 2026-12-18
visibleFor: [developer, dispatcher, product]
sourceOfTruth: docs-site
related:
  routes: []
  files:
    - public/src/state.js
    - public/src/garage.js
    - public/src/auth_token.js
    - server/src/services/auth/index.js
    - docs/first-login-authority-contract.md
  issues: [585, 824, 829, 830]
  prs: [788, 799]
tags: [decision-record, adr, auth, identity, target, phase-1]
slug: /decisions/auth-identity
---

# Auth & Identity — Decision Record

> **Partially implemented; full authority cutover remains target (`status: draft`).**
> Reconciled against `main@1af6af0a860b117124c1bd63ad88d687f511bb1b`.
> The in-repo backend has DB-backed OTP and session endpoints (#788); onboarding
> has a guarded real-OTP/bearer path (#799). The PWA backend path remains OFF by
> default. Boot reconciliation, pilot session lifecycle and granted-role/readiness
> enforcement are not established by those merges. See
> [Backend Spine Inspector, BD-DOCS-042](../processes/backend-spine-inspector.md)
> for repository implementation status, distinct from deployment readiness.

[First-login authority contract, BD-FIRST-LOGIN-AUTHORITY-01A](https://github.com/iprus2026-tech/BazarDriveCloud/blob/main/docs/first-login-authority-contract.md)
specializes this ADR with the audited flow, target states, session reconciliation
and acceptance cases. It is a contract-only draft, not a runtime cutover.

## Context

The PWA still holds a local prototype/profile model in `bazardrive.user.v1`
(`public/src/state.js`), separate from the backend identity:

- **Role** — `role: 'passenger' | 'driver' | 'guest'` (a field, not an account).
- **Phone** — `phone` and a `phoneVerified` boolean already exist (v9,
  BD-PROFILE-01 phone-verification surface) — but `phoneVerified` is a
  **client-set flag**. The backend also has a verified-phone fact; the local flag
  is not yet a reconciled projection of it.
- **Compliance** — driver documents (`driverLicense`, `taxiOsago`,
  `taxiRegistry`, `waybill`, `medicalCheck`) and the derived gates
  `computeDocumentsReady` / `isDriverLineReady`, all computed **client-side**.
- **Vehicles** — the driver garage collection (v11, BD-PROFILE-D-05F; resolver in
  `public/src/garage.js`) is nested inside `user.v1`.

Backend OTP verification now resolves a durable account by phone and issues a
bearer session. The guarded client path stores it in `bazardrive.auth.v1`.
However, the local profile is not automatically reconciled on boot, and selecting
a local role does not grant it on the server. A new OTP account may have empty
grants while onboarding writes a local passenger/driver role. The target below
closes that authority split; it is not a description of completed enforcement.

## Decision

Target **server-side identity and authentication** (partially implemented):

1. **One account, a roles set plus an active role.** A single identity carries
   `roles` (the set of granted roles, e.g. `[passenger, driver]`) plus
   `activeRole` (the backend session choice, constrained by current grants).
   The runtime's **scalar `role`** in `user.v1` is intent/cache and must project
   that confirmed choice; selecting it locally never grants a role. A passenger
   who also drives uses one account. Legacy account role fields must not compete
   with the session choice; compatibility policy remains under #830.
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

This ADR decides **identity model, auth method, and session boundary**. Opaque
bearer issuance and hashed session storage exist. Production OTP delivery/abuse
controls remain under #824; pilot transport, lifetime, rotation and logout/revoke
remain under #829; granted-role and readiness enforcement remain under #830.

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
  - OTP delivery/hardening (#824), session lifecycle and reconciliation (#829),
    and server role/readiness policy (#830), per the first-login contract.
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
