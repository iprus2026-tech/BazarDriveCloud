---
id: BD-DOCS-038
docType: decision-record
title: "Phase 7: Monitoring & Audit — Decision Record"
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
    - scripts/check.mjs
    - scripts/dispatcher.mjs
    - public/src/ride_state.js
    - public/src/ride_history.js
    - public/src/app_error_overlay.js
  issues: []
  prs: []
tags: [decision-record, adr, monitoring, audit, observability, target, phase-7]
slug: /decisions/monitoring-audit
---

# Phase 7: Monitoring & Audit — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This is
> **Phase 7** — the capstone of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (concern #9 Monitoring & Audit). It observes everything the earlier phases
> introduce — [Presence (BD-DOCS-033)](presence-heartbeat.md),
> [Dispatch & Matching (BD-DOCS-034)](dispatch-matching.md),
> [Notifications (BD-DOCS-036)](notification-service.md), and
> [Safety & Compliance (BD-DOCS-037)](safety-compliance.md) — and is keyed to
> [Auth & Identity (BD-DOCS-032)](auth-identity.md), persisting through the
> [Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md).
> BazarDrive **today** is a backless PWA; nothing here is built.

## Context

Today monitoring is **build/CI-time only — there is zero runtime observability**.

- `scripts/check.mjs` runs ~56 **static** checks (CSP invariants, manifest, SW
  precache, `node --check` syntax, active-ride contracts, plus 55 smoke imports)
  and prints "All checks passed". Node-only; no browser, DOM, or network.
- `scripts/dispatcher.mjs` is a **local developer routine** that runs those
  checks, validates the design registry for **drift**, routes tasks by role, and
  writes `docs/dispatcher-report.md` (node card · checks run · failures · error
  tails · design drift · merge gate `READY_CLEAN` / `READY_DIRTY` /
  `NEEDS_ROLES`). "Debug 56/56" = `check.mjs` + 55 smoke files. Fully local — no
  network, no API calls.
- The 55 `scripts/smoke-*.mjs` files are **static-analysis pins** — they
  `readFileSync` source and assert contracts (exports, routes, imports,
  patterns). Each states "No browser, no DOM, no network". The docs-site
  validators are likewise build-time governance.

In the **shipped app** there is **no** `window.onerror`, no error/event
listener, no `console.error`, no analytics, no telemetry. The only runtime
pieces are an **opt-in** localStorage debug trail (`order_map_draft.js`, never
sent anywhere) and a **UI-only** global error overlay (`app_error_overlay.js` —
shows offline/error states, no storage, no backend).

There is **no audit log and no event timeline**. `active_ride.v1`
(`ride_state.js`) holds only the **current** status — no record of when or why it
changed; `ride_history.v1` (`ride_history.js`) is a **post-hoc completed-ride
snapshot**, not a who/what/when log. The data layer's "ride events (timeline)"
(BD-DOCS-031) is a future concept. A live fleet cannot be operated, audited, or
debugged from this.

## Decision

Introduce a runtime **Monitoring & Audit** layer (#9) — distinct from, and
**alongside**, the build-time guards:

1. **Build-time and runtime monitoring are separate layers — both kept.**
   `check.mjs` / `dispatcher.mjs` / smoke pins keep guarding the **code** at
   CI-time; Phase 7 adds a **runtime** layer that observes the **running
   system**. The build-time tooling is **not** repurposed into runtime
   monitoring.
2. **Domain events become an append-only, identity-keyed audit trail.** The ride
   state machine (#5) and the other services emit **events (who / what / when /
   why)** into an append-only log — the data layer's "ride events (timeline)"
   (BD-DOCS-031). The **terminal-status freeze stays**; the audit trail is
   **additive**, never mutated. This is the single source for both audit and the
   live dashboard.
3. **A live ops / fleet-view dashboard.** A privileged surface showing live
   orders / drivers / rides (consuming Phase 2 presence + Phase 3 dispatch
   state), plus the operational views the governance doc lists: alerts & errors,
   performance (ETA / response time), financial (revenue / payouts), and
   availability (uptime / health).
4. **Runtime error & performance telemetry.** Clients and services report
   **errors and performance metrics**; the existing global error overlay
   (`app_error_overlay.js`) becomes a **reporting** surface, not just a UI state.
   The telemetry endpoint needs a **CSP** allowance and the **service worker must
   never cache** telemetry/metrics traffic (sw-offline-agent scope).
5. **Audit is identity-keyed and access-controlled.** Events are attributable to
   the authenticated identity (BD-DOCS-032); the audit log and dashboard are
   **privileged** (dispatcher / admin / ops), not user-facing. This trail is also
   what the Safety & Compliance service (#7) writes to — every block / penalty /
   verification is an audit event (BD-DOCS-037).

This ADR decides **that Phase 7 adds a runtime observability layer — an
append-only identity-keyed audit trail of domain events, a live ops/fleet
dashboard over presence + dispatch state, and runtime error/performance
telemetry — alongside (not replacing) the existing build-time guards**. The
telemetry/metrics stack, the dashboard surface and roles, alerting rules / SLOs,
and log retention / privacy policy are deferred (see Follow-ups).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — build-time checks only | Guards the code; zero infra | Blind to the running system; no audit; no live view | Cannot operate or audit a fleet |
| Extend `dispatcher.mjs` into a runtime monitor | Reuses a known tool | It is a static, local, code-time routine — wrong layer | Build-time and runtime are different concerns |
| Dashboard only (no audit trail) | Quick operational view | No who/what/when history; safety/disputes unprovable | Compliance & disputes need an audit log |
| **Runtime observability layer + audit trail (chosen)** | Live fleet view; attributable audit; reuses event sources | Telemetry/audit infra; privacy & retention work | — |

## Consequences

- **Positive:**
  - A fleet you can **see and operate** — live orders/drivers/rides, alerts,
    health.
  - An **audit trail** that backs Safety & Compliance decisions, disputes, and
    debugging.
  - Reuses presence (#2), dispatch (#3), and the ride state machine (#5) as event
    sources rather than inventing new ones.
  - Build-time guards keep guarding the code while the runtime layer watches the
    running system.
- **Negative / trade-offs:**
  - Telemetry is a **privacy / PII + CSP / SW** surface; the SW must never cache
    it.
  - An append-only audit log carries **storage, retention, and legal** obligations
    (how long, who can read).
  - Dashboards need **access control** (privileged roles); alerting needs **SLOs**
    to avoid noise.
  - Observability infra (metrics / logs / traces) is real, ongoing **ops cost**.
- **Follow-ups:**
  - Telemetry / metrics stack and provider.
  - Dashboard surface, roles, and what each panel shows.
  - Alerting rules / SLOs / on-call.
  - Audit-log retention and privacy policy.
  - Whether the `dispatcher.mjs` report shape (node card / checks / drift / merge
    gate) informs the runtime health view.

With this capstone, every Mini-Yonder service (#1–#9) has a target decision
record. See
[Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(concern #9) for the architecture,
[Safety & Compliance (BD-DOCS-037)](safety-compliance.md) for the decisions that
write to this audit trail, and the
[Data Layer Contract (BD-DOCS-031)](../design/data-layer-contract.md) for where
the event timeline persists.
