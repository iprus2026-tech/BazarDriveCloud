---
id: BD-DOCS-054
docType: decision-record
title: "Driver telemetry: foreground GPS, shift authority and privacy — Decision Record"
owner: docs-contract-agent
status: draft
revision: 2026-11-23
effectiveFrom: 2026-11-23
reviewAfter: 2027-02-23
visibleFor: [developer, dispatcher, product, qa, driver]
sourceOfTruth: docs-site
related:
  routes:
    - /driver-map
    - /active-ride
  files:
    - public/src/screens/driver_map.js
    - public/src/mapbox/geolocation_service.js
    - public/src/geo_point.js
    - public/src/state.js
    - server/src/services/driver-shift-authority/index.js
    - server/src/services/index.js
    - server/src/repositories/rides.js
    - docs/driver-shift-authority-contract.md
    - docs/driver-work-context-contract.md
    - docs/map-dual-experience-contract.md
    - docs/driver-telemetry-contract.md
    - server/src/routes/metrics.js
    - docs-site/docs/decisions/monitoring-audit.md
  issues: []
  prs: []
tags: [decision-record, adr, driver, telemetry, geolocation, privacy, shift, target]
slug: /decisions/driver-telemetry
---

# Driver telemetry: foreground GPS, shift authority and privacy

> **Proposed contract / docs-only (`status: draft`), not shipped.** This decision
> neither enables location collection nor creates a backend API, table, Redis key,
> data retention job, route, consent dialog, or MapLibre map. The passport ID
> `BD-DOCS-054` was verified free on the baseline below: 38 governed documents
> existed before this one (highest in use `BD-DOCS-053`, no duplicate ids), so
> this document makes 39.
>
> Baseline: BazarDriveCloud `main@559ee628d8449863e78cbbab8c107688e1de8b61`.
> Input: read-only `BD-DRIVER-MAP-TELEMETRY-AUDIT-01`, independently reviewed
> against the relevant repository files. No runtime or live-device smoke was run
> for this ADR.

## 1. Context: what works today

- `/driver-map` uses the `createMapShell()` placeholder. Its car and nearby
  orders are not device GPS positions; driver-order acceptance is still local
  for the mock flow (`public/src/screens/driver_map.js`).
- `geolocation_service.js` returns `null`/`unknown`, and invokes no
  `navigator.geolocation` call. `geo_point.js` already defines device-fix
  provenance, timestamp and accuracy expectations but does not implement
  capture or a VehiclePosition model.
- `driverOnline` is local browser state without an authoritative timestamp.
  PostgreSQL `driver_shift` exists (migration `0006`), but its transaction
  service is a **dark** backend seam without live driver HTTP routes.
- Server-side ride state/events and receipts exist for server-originated rides;
  they do not prove that PWA mock rides or all driver activity are persisted.
- `BD-DOCS-033` (Presence & Heartbeat) is a **draft**. Redis-backed presence,
  active driver location, shift aggregates and location samples are absent.
- `BD-DOCS-053` selects MapLibre + self-hosted PMTiles + OSRM as the target map
  provider. This is **not** evidence that `/driver-map` has a live renderer,
  tiles or routing today.
- The ingestion dependency does not exist yet either: `availability` is a
  `darkService` skeleton (catch-all `501 NOT_IMPLEMENTED` at
  `/api/v1/availability/*`), and **no Redis is provisioned** — `docker-compose`
  states redis/minio arrive with their own phases (BD-DOCS-033 / BD-DOCS-037).
- `GET /metrics` is registered at the repository root (no `/api/v1` prefix) and
  returns `501`, explicitly reserved for the monitoring phase. It is an operator
  pull endpoint, not a location-ingress path.

## 2. Decision boundaries

1. **PostgreSQL/backend is the authority.** Driver identity derives from the
   authenticated session; work vehicle and shift are sourced from the current
   server-authoritative `OPEN driver_shift`, never from caller-supplied IDs or
   localStorage. Ride binding is checked against the authenticated driver and
   the server's Ride State Machine.
2. **An open shift does not imply online status.** Shift lifecycle remains
   `NONE → OPEN → CLOSED`, and `CLOSED` never reopens. Presence is separate and
   expires through a TTL. Telemetry location quality is a third, independent
   dimension, not an alternative shift or ride status.
3. **Explicit foreground collection only for the first GPS slice.** Request
   user-level geolocation permission only in the foreground and under a
   separately explained and recorded service consent. Stop watching when the
   driver revokes consent, signs out, goes offline, or the page becomes hidden.
   A PWA must never promise continuous background location on Android/iOS.
4. **Location records are append-only measurements, not route truth.** Preserve
   device provenance, accuracy, timestamps and rejection/gap reasons; exclude
   stale, implausible and low-quality data from mileage and live visibility.
   No fabricated positions and no fallback to demo coordinates.
5. **Separate privacy views.** The driver sees their own fixes; an assigned
   passenger can receive a purpose-limited, authorized live projection during
   allowed ride states; public nearby searches receive only coarse aggregated
   availability. Raw telemetry must not enter public API, ordinary logs,
   analytics events or mock fixtures.
6. **No independent GPS-to-finance inference.** Income derives from authorized
   receipts and completed server rides. Distances and online/free/busy durations
   derive from reliable shift, presence and GPS intervals with data-quality
   flags and explicit exclusions for gaps.
7. **Domain telemetry is not runtime observability.** This ADR covers *driver
   location measurements* — domain data with a privacy lifecycle. It does **not**
   design the observability stack: Phase 7 Monitoring & Audit (issue #591,
   BD-DOCS-038) and pilot observability (issue #827, BD-OBS-PILOT-01) own
   metrics, traces, structured logs, alerting and SLOs. `GET /metrics` — the
   root-path `501` stub reserved for that phase — stays an operator pull
   endpoint and must never become the location-ingress path. Conversely, driver
   coordinates must never be emitted as observability events, log fields, trace
   attributes or analytics dimensions (see §5).
8. **CSP and service worker are untouched.** BD-DOCS-038 flags that any future
   telemetry endpoint needs a CSP allowance and that the service worker must
   never cache telemetry traffic. This slice changes neither: no CSP directive,
   no `public/sw.js`, no precache entry. Those changes, when they happen, belong
   to a separate slice under the sw-offline-agent / security review.
9. **Active-ride boundary is reused, not reinvented — and it governs LIVE only.**
   A ride may **publish a live position** only while it is *past acceptance and
   not yet terminal* — exactly the predicate
   `server/src/repositories/rides.js` already derives
   (`ACTIVE_RIDE_STATUSES` = all `RIDE_STATUS` minus `{NEW_ORDER,
   CONFIRMATION_PENDING, CONFIRMED, CHAT_STARTED}` minus `{COMPLETED, CANCELED,
   NO_SHOW}`, i.e. `ACCEPTED`, `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`,
   `WAITING_PASSENGER`, `IN_PROGRESS`). **Terminal status forbids LIVE; terminal
   status never forbids history** — a capture inside `[accepted_at, terminal_at)`
   still binds to that ride (contract §C rule 3, §C1 row 2), and the terminal
   boundary is exclusive. **Terminal status forbids LIVE; it never
   invalidates a proven historical binding.** This ADR adds **no** ride state
   machine. If more than one ride of the driver matches, the contract forbids
   picking one: it fails closed (legacy contract §B.1, §C rule 5).
10. **Capture time — not receipt time — binds a sample.** `capturedAt` (device
    sensor time, epoch ms) and `receivedAt` (server clock at ingestion) are
    different facts and are stored separately. Binding is resolved from the
    **server-authoritative intervals that contain `capturedAt`**
    (`driver_shift.opened_at/closed_at`, `rides.accepted_at` plus
    `completed_at`/`canceled_at`), never from "whichever ride is current when the
    packet arrives".
    *Liveness and history are separate questions:* the current active set
    (boundary 9) decides whether a sample may be **published live**, while the
    ride's **acceptance-to-terminal half-open interval** decides which ride it
    **belongs to** — so a fix captured during a ride that has since completed is
    still that ride's measurement, not an idle one.
    **The interval must be evaluated per status, not with a `COALESCE`:** an
    active ride has a valid **open upper end** (`completed_at` and `canceled_at`
    both `NULL`), a `COMPLETED` ride has an **exclusive** upper bound on
    `completed_at`, and `CANCELED`/`NO_SHOW` on `canceled_at`. Comparing against
    `COALESCE(completed_at, canceled_at)` evaluates to `NULL` for an ordinary
    active ride and silently drops it — the R4 defect.
    A **retained closed shift** still covers its own interval: a capture inside
    it is storable history, never a rejection, and a successor shift never
    inherits an earlier capture. Only a capture outside **every** covering
    interval is refused. Where the mapping is unprovable or overlapping — or a
    required terminal timestamp is missing, which is *not* proof of "no ride" —
    the sample fails closed; "idle" is an affirmative result, never a default,
    and freshness never turns an idle capture into a ride binding.
    The five outcomes (`LIVE`, `HISTORICAL`, `IDLE`, `STALE`, `REJECTED`) are
    frozen as one ordered table in the legacy contract §C1. A **`GAP`** is never
    `LIVE`: a row without coordinates can never be a live position. Its class is
    `STALE` when the bound ride is still active, `HISTORICAL` when the bound ride
    has ended, and `IDLE` when the capture falls in a proven free interval — and
    in **all three** the row is stored with quality `GAP` **and
    `reason = 'no_fix'`**, because the coordinate/quality tuple requires a reason
    for a coordinate-free row. **Freshness does not convert a `GAP` into
    `STALE` quality** and does not change the class of an idle sample.
11. **Consent revocation is a synchronous read-deny with a serialized commit.**
    Revoking service consent denies every subsequent read of that driver's
    precise position **immediately**, regardless of any Redis TTL and any cached
    last-known position. Ingest and revocation serialize on the **same**
    authoritative driver/grant lock; the sample and a **durable publication
    intent** commit together in one PostgreSQL transaction, and the intent is
    created **only for a `LIVE` sample and only on the first accepted insert** —
    historical, stale, idle and duplicate rows create none. Redis is written
    only **after** commit, by a **pending-state scan** (never a cursor), and the
    whole publication decision — fence check, `(grant_version, publication_seq)`
    comparison and write — is **one atomic Redis script**. A read-then-write
    sequence is forbidden: a concurrent revocation can be lost inside it. The
    sample's exact `shift_id`/`vehicle_id`/`ride_id`/`trip_id` are re-checked
    before publishing.
    Revocation is likewise **one atomic script** (`SET fence` + `DEL position`),
    so the tombstone cannot be lost by the deletion it accompanies; the fence is
    a separate key that position cleanup never deletes and is mirrored durably in
    PostgreSQL. A stale `SET` cannot resurrect a revoked position.
    Ingest must also order itself
    against the Ride status write (`FOR SHARE` on the ride, or decline `LIVE`)
    — otherwise the classification can be stale at commit. Reads re-check
    consent, cache version, session, shift and ride eligibility **for the exact
    cached binding**, and **fail closed if authorization cannot be evaluated**.
    **Redis and PostgreSQL are not in one transaction, and the ADR does not
    claim they are.** A revocation can commit before the Redis script runs; that
    window is closed by the **read path**, which denies on the authoritative
    PostgreSQL consent row and fails closed when it cannot evaluate it — never by
    the cache. Two guarantees stay separate: **authoritative read-deny is
    synchronous and PostgreSQL-backed; cache cleanup and the fence are eventual
    and retried.** Sign-out, shift closure and ride terminality are separate
    gates, not consent events.
12. **No runtime authorization from an ADR.** Every API, migration, Redis, UI,
   MapLibre or OSRM change requires its own narrow implementation gate, review,
   tests and separate OWNER authorization. Gate C0/C1 #862 / PR #1231 remain
   unrelated and unchanged.

## 3. Proposed data flow (not implemented)

```text
Driver PWA foreground
  -> explicit consent + browser permission
  -> geolocation_service (device fix, no fabricated fallback)
  -> geo_point provenance + VehiclePosition (speed, heading)
  -> bounded, in-memory retry queue
  -> authenticated backend endpoint (candidate contract, not live)
     -> driverId = session
     -> shiftId/vehicleId = the shift covering capturedAt (OPEN, or a
        retained CLOSED one for history), with its pinned vehicle
     -> tripId = server ride participant check
     -> validation, dedup, gap filtering, rate limit
     -> append-only PostgreSQL samples
     -> durable publication intent in the same transaction — ONLY for a LIVE
        sample's first insert (§C3 shape)
     -> after commit: pending-scan publisher, atomic (grant version, seq) CAS
        and a durable revocation fence; no Redis is provisioned yet (BD-DOCS-033)
     -> quality-aware aggregates and privacy projections
```

The provider-neutral MapLibre renderer is a **consumer** of a driver location
projection, not the authority that creates it. OSRM is an optional comparator
for routing and sanity checks, not a substitute for measured distance.

## 4. Proposed operational state model

Keep independent server-side dimensions, rather than one overloaded `online`:

| Dimension | Suggested states | Source / transition |
|---|---|---|
| Shift | `NONE`, `OPEN`, `CLOSED` | Existing driver-shift contract; `CLOSED` final. `NONE` is the **absence of a row**, not a stored value: `driver_shift.status` is `TEXT` with `CHECK (status IN ('OPEN','CLOSED'))` (migration `0006`) |
| Presence | `OFFLINE`, `ONLINE_FREE`, `ONLINE_BUSY`, `STALE` | Proposed by BD-DOCS-033 (draft, no Redis); future heartbeat/TTL + matching eligibility; server decides |
| Location | `UNAVAILABLE`, `GOOD`, `COARSE`, `STALE`, `GAP`, `REJECTED` | Timestamp, accuracy, consistency checks. Only `GOOD`/`COARSE`/`STALE`/`GAP` become stored rows: `REJECTED` is a per-sample response and `UNAVAILABLE` is the absence of a row. **`GOOD`/`COARSE` are the only qualities that can be `LIVE`**; a `GAP` takes the `STALE` disposition (see legacy contract §C1 row 3) |
| Ride | Existing server Ride State Machine | Never invent a new ride status for telemetry |

The per-sample outcome is not a fourth dimension: it is one ordered table —
`LIVE`, `HISTORICAL`, `IDLE`, `STALE`, `REJECTED` — frozen in the legacy
contract §C1, with liveness depending on this table's Ride row and history
depending on the ride's own interval.

Target invariant: `presence ONLINE_* ⇒ exactly one eligible OPEN shift`.
`OPEN shift ⇏ ONLINE`. A lost GPS fix alone is not evidence that a shift closed.
Define whether location-unavailable drivers remain eligible for dispatch in the
future Availability contract; default to fail-closed for **location-dependent
matching**, without silently ending an existing ride.

## 5. Consent, access, retention: decision points for OWNER

- Browser permission is **not** sufficient as service consent. Record purpose,
  consent version, actor and grant/revocation timestamps on the server before
  any location upload. Graceful denial and revocation must be testable.
- Driver self-view may access their own precise points; passenger projections
  require active assignment and appropriate ride state, limit precision,
  timing and retention. No unrestricted dispatcher/admin raw-location access.
- Proposed raw sample retention **30 days** and shift aggregates **24 months**
  are **not approved**. Determine legal basis, data minimization, regional
  requirements, operational need and actual deletion semantics before database
  work. Signed payment and audit records may have different retention duties.
- Error logs, tracing, crash reports and QA evidence must redact coordinates,
  precise routes, bearer tokens and identifiable location sequences. Detect
  indirect leakage through URL parameters and structured nested objects.
- The retention strategy must account for backups, pending queues, cache TTLs,
  account-deletion requests and legal holds separately. Do not equate a
  PostgreSQL foreign-key cascade with a complete privacy deletion process.

## 6. Questions not resolved by this ADR draft

1. What is the OWNER-approved data purpose, consent text and privacy policy?
2. What are the lawful raw/aggregate retention periods and deletion deadlines?
3. What are the production heartbeat frequency, TTL, accuracy thresholds and
   low-battery behavior? The audit's 5 s / 15 s / 60 s are **proposals**, not
   fixed production contracts.
4. Should trips continue with degraded GPS and how should driver availability
   be represented during network loss or foreground suspension?
5. What constitutes trustworthy distance and quality-based driver earnings
   reporting, especially in partly sampled shifts?
6. What server endpoints for shift opening/closing are already reserved by the
   frozen shift contracts? Avoid creating conflicting route names. **Known so
   far:** no shift HTTP route exists (the shift authority is a route-less,
   dark transaction service), exactly one work-context read path is *proposed*
   (`GET /api/v1/availability/work-context`), `/api/v1/availability/*` is a
   dark `501` catch-all today, and **`drivers` *is* a registered service**
   (`services/index.js`, mounted at `/api/v1/drivers`, currently serving
   enrollment only: `POST|GET /api/v1/drivers/enrollment`). A registered
   namespace is **not** a live telemetry endpoint: no location route exists in
   any service. Location ingest still belongs under `availability` (presence,
   work-context, dispatch eligibility), not under driver enrollment — see the
   legacy contract §D for the ownership argument.

## 7. Dependencies and release gates

1. **Audit acceptance:** accept findings as code-reading baseline only; mark
   real-device operation and main-baseline tests `NOT_VERIFIED`.
2. **Contract review:** approve the model/API, ownership and shift/ride
   transitions; independently review privacy, retention and failure behavior.
3. **Driver map smoke:** verify current placeholder/guard/offline/readiness and
   active-ride return on the exact base SHA, without collection.
4. **Foreground GPS prototype:** device permission + stop rules, no server
   upload; explicit OWNER approval and real-device acceptance.
5. **Presence and shift authority:** separate server API/Redis integration,
   fail-closed auth and TTL tests.
6. **Sample persistence:** migration/API/quality checks and privacy deletion.
7. **Metric aggregation:** quality-aware driver shift dashboard, separately
   validated against authoritative rides/receipts.

Each gate must be reviewed and accepted before its dependent runtime slice.
See the repository file `docs/driver-telemetry-contract.md` for candidate
API/SQL shapes (not live endpoints).

### Docs-only verification recorded for this draft

The archived R5 producer record lists 20/20 consistency-matrix cases,
10/10 stored-quality and finiteness constraints, 2/2 idempotency cases and
6/6 publication and Ride-PATCH race models. Those checks cover the earlier
`COALESCE` null-drop and missing `GAP` disposition findings.

The R8 producer ran the isolated SQL evidence suite twice on PostgreSQL
16.16 and twice on 18.7. Each pass evaluated 23 matrix scenarios (15
persisted rows and eight expected rejections), four parity assertions
including two negative controls, two matrix controls, 14 constraints and
14 concurrency assertions. The concurrency results included all six T5
cases and the exact `deny` persisted after the authoritative-read fault was
rolled back. The Lua model passed 18 assertions using a mock Redis API.

The R7 package records the docs-site gate for the earlier candidate at
`main@559ee628`. The registry measurements were 61 unaccounted legacy
documents without the generated `docs/dispatcher-report.md` and 62 with it.
The earlier dispatcher result was `READY_DIRTY` (`128/128 PASS`, drift
`CLEAN`). Independent R8 QA replayed the four-path patch on the pinned baseline and
ran the docs-site gate. It found that a printed verdict could disagree
with the supervisor exit and that the revoked-consent case also had a
stale grant. R9 checks the published rows in each pass and isolates the
revoked-consent and version-mismatch fixtures. The final archive is
identified by a separate receipt. Redis integration, live authorization,
performance and real-device behavior remain `NOT_VERIFIED`.
