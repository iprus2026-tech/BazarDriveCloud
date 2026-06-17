---
id: BD-DOCS-033
docType: decision-record
title: "Phase 2: Presence & Heartbeat — Decision Record"
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
    - public/src/screens/driver_map.js
  issues: []
  prs: []
tags: [decision-record, adr, presence, heartbeat, target, phase-2]
slug: /decisions/presence-heartbeat
---

# Phase 2: Presence & Heartbeat — Decision Record

> **Proposed / target decision — not implemented (`status: draft`).** This is
> **Phase 2** of the growth path in
> [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
> (service #2, Driver Availability). It builds on
> [Phase 1 shared source of truth (BD-DOCS-030)](shared-source-of-truth.md) and
> [Auth & Identity (BD-DOCS-032)](auth-identity.md). BazarDrive **today** is a
> backless PWA; nothing here is built.

## Context

A driver's availability today is **client-only state** in `bazardrive.user.v1`
(`public/src/state.js`):

- `driverOnline: false` (v3, BD-PROFILE-01) — a local boolean.
- `shiftOpen`, `shiftDocsReady`, `medicalCheckPassed` — shift readiness.
- `isDriverLineReady(u)` is the **gate** to go online, enforced in
  `public/src/screens/driver_map.js` (e.g. lines 525, 577).

There is **no server presence**: no heartbeat, no liveness/TTL, no location, no
online/free/busy a dispatcher could query. So Phase 3 (dispatch + matching) has
nothing to match against — it cannot know which drivers are online, free, or
nearby. Presence is the **prerequisite** for matching, and it only becomes
meaningful once a shared truth (Phase 1) and a real identity (BD-DOCS-032)
exist to key it to.

## Decision

Introduce a **server-side presence service driven by client heartbeats**:

1. **Presence is keyed to the authenticated driver identity** (BD-DOCS-032) and
   the **active vehicle** (the garage vehicle in use). Not to a device, not to
   `user.v1`.
2. **Heartbeat with TTL.** The client periodically reports liveness (and, once
   Phase 4 maps land, location). The server tracks presence with an **expiry**,
   so a dropped/closed session **automatically goes offline** — no stale "online"
   drivers.
3. **`driverOnline` becomes a local mirror of server presence**, not the
   authority. Going online is **server-validated**: the server re-checks role +
   compliance (`isDriverLineReady` equivalent) per BD-DOCS-032 before accepting
   the driver as available. The client gate stays as a UX hint.
4. **Presence states:** `offline` / `online_free` / `online_busy`. `online_busy`
   is **derived from the active ride** (a non-terminal `RIDE_STATUS`), reusing
   the existing ride state machine rather than a second flag.
5. **A cache tier holds the available-driver set** (Redis, per BD-DOCS-023) so
   Phase 3 matching can query "nearby free drivers" cheaply.

This ADR decides **what presence is, what it is keyed to, and that it is
heartbeat/TTL-driven**. Transport, heartbeat interval, and location accuracy are
deferred (see Open questions).

## Alternatives considered

| Option | Pros | Cons | Rejected because |
| --- | --- | --- | --- |
| Status quo — client `driverOnline` flag | No backend | Per-device; no liveness; invisible to a dispatcher | Matching cannot see drivers |
| Server flag toggled on/off (no TTL) | Simple | A crashed/closed client stays "online" forever | Stale presence breaks matching & ETA |
| DB-only presence polled per dispatch | No cache infra | Slow at fleet scale; no real-time | Phase 3 needs cheap "nearby free" lookups |
| **Heartbeat + TTL + cache (chosen)** | Self-healing liveness; fast available-set queries | Heartbeat transport + cache to run; battery/location cost | — |

## Consequences

- **Positive:**
  - Gives Phase 3 (dispatch + matching) a real, live set of available drivers.
  - Self-healing: presence expires without an explicit "go offline".
  - Reuses `RIDE_STATUS` for busy/free — no parallel state to drift.
- **Negative / trade-offs:**
  - A **real-time transport** (WebSocket / SSE) or frequent polling: **CSP** must
    allow it and the **service worker** must **never cache** presence / socket
    traffic (sw-offline-agent scope).
  - **Battery & location** cost; location ties into the existing
    `/location-permission` flow and is a privacy surface.
  - Offline: a backgrounded/offline client must let its presence **expire**
    rather than appear falsely available.
- **Follow-ups:**
  - Transport choice (WS vs SSE vs poll), heartbeat interval, TTL.
  - Location accuracy / privacy / battery policy (with Phase 4 maps).
  - Phase 3 matching consumes the available-driver set this defines.

See [Mini-Yonder Background Services](../governance/mini-yonder-background-services.md)
(service #2) for the target architecture, and
[Auth & Identity (BD-DOCS-032)](auth-identity.md) for the identity presence is
keyed to.
