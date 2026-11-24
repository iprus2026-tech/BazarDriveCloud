# BD-DRIVER-TELEMETRY-CONTRACT-01 — Driver Telemetry Backend/Data Contract

**Status:** docs-only draft, proposed; **not implemented**.

**Baseline:** `main@559ee628d8449863e78cbbab8c107688e1de8b61`.

**Layers:** Driver App / PWA / Geo / Driver Availability / Ride State / Backend API /
PostgreSQL / Cache / Monitoring / Safety & Compliance.

**Reference contracts:** `docs/driver-shift-authority-contract.md`,
`docs/driver-work-context-contract.md`, `docs/map-dual-experience-contract.md`,
`docs-site/docs/decisions/presence-heartbeat.md` (draft),
`docs-site/docs/decisions/map-provider-maplibre-pmtiles-osrm.md` (draft).

**Non-goals:** No JavaScript/TypeScript changes, no API registration, no SQL
migration, no GPS request, no Redis/config changes, no CSP/SW, no new receipts,
no synthetic real coordinates, no GitHub Actions/cloud deployment, no Gate C1.

## A. Facts and authority boundary

- PWA `/driver-map` currently renders a `MapShell` placeholder, not live GPS;
  `geolocation_service.js` is a stub. `driverOnline` is a local boolean, **not**
  durable server shift or presence evidence.
- Existing `driver_shift` row: `id`, `driver_id`, `vehicle_id`,
  `assignment_id`, `status ∈ {OPEN,CLOSED}`, `opened_at`, `closed_at`,
  `close_reason`, `updated_at`. The lifecycle is enforced in SQL: a composite
  FK pins `(assignment_id, driver_id, vehicle_id)`, and a CHECK ties
  `OPEN ⇔ (closed_at IS NULL AND close_reason IS NULL)`. `NONE` is the absence
  of a row — the column never stores it. Existing transaction authority is dark
  and route-less, not a live route.
- Existing server rides/events/receipts can be authoritative **only for
  server-created rides**. Do not equate PWA mock ride history with server data.
- `geo_point.js` owns geographic provenance and `capturedAt` in epoch-ms;
  speed/heading belong to a proposed `VehiclePosition` projection, not the
  immutable geographic-point shape.

### Who writes / reads / stores

| Datum | Writer / authority | Persistence | Reader / disclosure |
|---|---|---|---|
| Shift `OPEN/CLOSED` | Server transactional shift authority | `driver_shift` in PostgreSQL | Driver self work-context; authorized operations |
| Online/free/busy | Future Presence service, based on heartbeat + eligibility | Redis TTL / optional audit events | Matching and coarse passenger projections |
| Raw location fix | Browser sensor → validated, authenticated server ingress | Proposed append-only PostgreSQL | Driver self and tightly authorized internal processing |
| Last live position | Future Presence service, driven by the durable publication intent (§C3) | PostgreSQL `driver_location_publication` + Redis cache (fenced by `grant_version`, ordered by `publication_seq`) | Role/ride-gated live projection only; denied at read time if consent or eligibility fails (§F.1) |
| Ride/busy intervals | Server ride-state transitions | Existing `rides`, `ride_events` | Participant-gated backend services |
| Fare/commission/net | Authorized server receipt lifecycle | Existing `receipts` | Driver self / finance; not GPS-derived |
| Shift metrics | Future aggregation, with coverage and quality flags | Proposed aggregates table | Driver self and role-limited operations |

## B. Independent state machines

```text
Shift (existing contract): NONE --open--> OPEN --close--> CLOSED
Never CLOSED --> OPEN. Opening another shift creates a new row/ID.

Presence (proposed, separate):
  OFFLINE --eligible OPEN shift + fresh heartbeat--> ONLINE_FREE
  ONLINE_FREE --server-assigned live ride--> ONLINE_BUSY
  ONLINE_BUSY --ride terminal / free decision--> ONLINE_FREE
  ONLINE_* --TTL expiry / explicit offline / eligibility loss--> STALE or OFFLINE
  STALE --new eligible heartbeat--> ONLINE_FREE or ONLINE_BUSY
  CLOSED shift --> OFFLINE (after permitted ride/closure transaction rules)

GPS (quality, NOT a shift state): UNAVAILABLE / GOOD / COARSE / STALE /
GAP / REJECTED.
```

`OPEN shift` does not imply ONLINE, and `ONLINE_*` requires an eligible OPEN
shift. `GAP` does not close a shift or complete a ride. A concurrent ride must
preserve the existing ride-state contract and any close-deferred rule. Presence
is an *ephemeral* availability projection, not the source of ride identity.

**Ingress order (canonical — deduplication comes *before* eligibility):**

1. authenticate the session;
2. validate shape, batch size and enum membership (`400` on failure);
3. **authoritative consent check** (§F.1) — a revocation denies here, before any
   replay result is returned (§D.2 I4);
4. canonicalise the sample and compute `content_digest`;
5. **idempotency lookup** on `(driver_id, sample_id)` — a hit resolves the
   request as `duplicate` or `conflict` and **stops**; no shift, ride, freshness
   or eligibility rule is evaluated for it;
6. *only for unseen ids*: resolve the covering shift and its pinned vehicle
   (§C rule 2), the covering ride / unprovable-interval test (§C rules 3–4), the
   freshness window, and classify the sample into §C1 rows 1–5;
7. persist inside one transaction, re-reading consent (and its version) under
   the driver/grant lock before commit (§F.1);
8. enqueue a live-publication intent **only** when the class is `LIVE` and only
   on the first accepted insert.

R3 had eligibility ahead of deduplication, which let a replay in a closed shift
return `409` instead of the required `duplicate`; step 5 now precedes step 6 for
exactly that reason.

### B.1 Active-ride boundary (reused, not reinvented)

This boundary governs **live eligibility only**, never historical binding. A
ride that is **past acceptance and not yet terminal** is the only kind that may
be published live; a ride that has since become terminal still owns its past
interval and still binds historical samples (§C rule 3). Conflating the two is
what makes a completed ride lose its own measurements. The live predicate
already exists in the server and is reused verbatim — this contract adds no
second ride-state machine:

```js
// server/src/repositories/rides.js — the authoritative boundary (quoted, not added)
const PRE_ACCEPT_RIDE_STATUSES = new Set([
  'NEW_ORDER', 'CONFIRMATION_PENDING', 'CONFIRMED', 'CHAT_STARTED',
]);
const ACTIVE_RIDE_STATUSES = new Set(
  Object.values(RIDE_STATUS).filter(s =>
    !TERMINAL_RIDE_STATUSES.has(s) && !PRE_ACCEPT_RIDE_STATUSES.has(s)),
);
// => ACCEPTED, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP,
//    WAITING_PASSENGER, IN_PROGRESS
```

Consequences the ingest must respect:

- **This set decides LIVE, not membership.** `ACTIVE_RIDE_STATUSES` answers "may
  this ride publish a live position now?"; §C rule 3 answers "which ride covered
  this instant?". A ride outside this set can still be the correct **historical**
  binding.
- Pre-accept statuses (`NEW_ORDER`, `CONFIRMATION_PENDING`, `CONFIRMED`,
  `CHAT_STARTED`) never bind a sample at all: the driver is not yet on the ride,
  and the acceptance-to-terminal interval has not opened.
- Terminal statuses (`COMPLETED`, `CANCELED`, `NO_SHOW`) never **publish**: they are
  excluded from `LIVE` (terminal-freeze makes the ride final). They still own their
  historical interval, so a capture inside `[accepted_at, terminal_at)` **binds to
  that ride** (§C rule 3, §C1 row 2). One rule, both halves: *terminal forbids LIVE,
  never history.*
- The predicate is derived by filtering the shared enum, so a future status is
  swept into the active set by default (over-blocking) rather than silently
  falling out of it (under-blocking). The telemetry contract inherits that
  fail-safe direction; it does not enumerate its own list.

**Multiple matching rides — never pick one.** `findActiveRideForDriver()`
uses `LIMIT 1` for the shift-blocking read, justified there by the matching flow
guaranteeing one non-terminal ride per driver. Telemetry write binding has a
stricter requirement because a wrong binding corrupts a measurement permanently:
the resolver returns the **set** (index `idx_rides_driver_status`), and

| rows returned | action |
| --- | --- |
| exactly 1 | bind `ride_id` + `trip_id` to it |
| 0 | idle sample: both columns `NULL` (legal, see §C) |
| **> 1** | **fail closed** — reject the sample (`reason = 'ambiguous_ride'`), persist nothing, log the invariant violation, and never choose by `ORDER BY`, recency, distance or any other heuristic |

"Arbitrary choice" is thus unrepresentable in the contract: there is no
tie-break rule to get wrong. Resolving the set also means a duplicate/ambiguous
data state surfaces as a rejected sample instead of silently mis-attributed
distance and earnings.

## C. Candidate measurement schema (DDL shape only, NOT a migration)

```sql
-- CONCEPTUAL ONLY. Do not apply to a live database.
CREATE TABLE driver_location_sample (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id      uuid NOT NULL,
  driver_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  vehicle_id     uuid NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  shift_id       uuid NOT NULL REFERENCES driver_shift(id) ON DELETE RESTRICT,
  -- rides.id is UUID; rides.trip_id is TEXT UNIQUE. Both are carried, mirroring
  -- ride_events (uuid FK + denormalised business key) so a sample survives the
  -- same lookups the timeline uses and the type can never drift from 0001.
  ride_id        uuid NULL REFERENCES rides(id) ON DELETE RESTRICT,
  trip_id        text NULL,
  -- device/sensor time (geo_point capturedAt, epoch-ms -> timestamptz)
  captured_at    timestamptz(6) NOT NULL,
  -- server clock at ingestion. NEVER a substitute for captured_at.
  received_at    timestamptz(6) NOT NULL DEFAULT now(),
  -- the consent grant the sample is covered by; re-checked at commit (§F)
  consent_version bigint NOT NULL CHECK (consent_version > 0),
  -- collision hash over the canonical content fields; the idempotency witness (§D.2)
  content_digest bytea NOT NULL CHECK (octet_length(content_digest) = 32),
  -- Range checks also exclude NaN and +/-Infinity in PostgreSQL: NaN sorts above
  -- every number, so a NaN fails "<= 90"/"< 360" and is rejected.
  latitude       double precision NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision NULL CHECK (longitude BETWEEN -180 AND 180),
  -- Nonnegativity alone is NOT enough: 'NaN'::real >= 0 is TRUE in PostgreSQL
  -- (NaN is treated as greater than all numbers) and 'Infinity'::real >= 0 is
  -- TRUE too. Adding "< 'Infinity'" rejects both, because NaN < Infinity is
  -- FALSE. Same idiom for speed — R3's CHECK left this hole open.
  accuracy_m     real NULL CHECK (accuracy_m >= 0 AND accuracy_m < 'Infinity'::real),
  speed_mps      real NULL CHECK (speed_mps >= 0 AND speed_mps < 'Infinity'::real),
  heading_deg    real NULL CHECK (heading_deg >= 0 AND heading_deg < 360),
  -- Server-assigned, never taken from the request. Single-valued today: no
  -- user_pin / geocode_point / mock_hash / simulation sample may be stored here.
  source         text NOT NULL CHECK (source IN ('device_fix')),
  -- Persisted quality only. REJECTED is a per-sample response and UNAVAILABLE is
  -- the absence of a row, so neither is a storable value (ADR §4 Location).
  quality        text NOT NULL CHECK (quality IN ('GOOD', 'COARSE', 'STALE', 'GAP')),
  -- v1 reason vocabulary. Not free text: adding a value is a reviewed migration,
  -- exactly like the OPEN|CLOSED and close_reason vocabularies in 0006.
  reason         text NULL CHECK (reason IS NULL OR reason IN (
                   'stale_delayed',     -- received beyond the freshness window
                   'no_fix',            -- sensor produced no usable fix (GAP)
                   'shift_closed',      -- covering shift no longer OPEN (STALE)
                   'permission_revoked',-- OS/browser permission withdrawn
                   'consent_revoked',   -- service consent withdrawn (REJECTED)
                   'implausible_jump',  -- failed the consistency/time check
                   'ambiguous_ride',    -- >1 ride interval matched / unprovable row
                   'ambiguous_shift',   -- >1 shift interval covered the capture
                   'out_of_shift',      -- captured outside any covering shift
                   'retention_exceeded',-- older than the retention window
                   'context_unavailable'-- authoritative context could not be read
                 )),
  UNIQUE(driver_id, sample_id),
  -- quality, coordinates, accuracy and reason form ONE consistent tuple:
  --   GOOD / COARSE  -> real coordinates + measured accuracy, reason optional
  --   STALE          -> real coordinates + accuracy, reason REQUIRED (why stale)
  --   GAP            -> no coordinates at all, reason REQUIRED
  -- A coordinate without its accuracy is not a measurement, so accuracy is
  -- required wherever coordinates are. The old, weaker
  -- "(lat IS NULL) = (lng IS NULL)" check is subsumed here.
  CHECK (
    (quality IN ('GOOD', 'COARSE')
       AND latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy_m IS NOT NULL)
    OR
    (quality = 'STALE'
       AND latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy_m IS NOT NULL
       AND reason IS NOT NULL)
    OR
    (quality = 'GAP'
       AND latitude IS NULL AND longitude IS NULL AND reason IS NOT NULL)
  ),
  -- ride binding is all-or-nothing: either the sample is unbound (idle driver,
  -- both NULL) or fully bound to one ride (both set, and the pair must agree).
  CHECK ((ride_id IS NULL) = (trip_id IS NULL))
);
```

If this shape ever becomes a real migration, the next free number on the
baseline is `0017` (migrations `0001`–`0016` are taken; `0008` is absent and stays
absent). No migration is created or reserved by this draft.

Additional constraints **must** be reviewed against live table types and the
retention plan. `id`, `sample_id` and `captured_at` are not independently
trusted merely because they parse. Store server `received_at` and reject
out-of-order/future or implausible timestamps with an explicit error or quality
result. Do not use `(driver_id,captured_at)` as the only idempotency key: two
legitimate sensor readings may share a timestamp. Never accept `driver_id`,
`vehicle_id`, `shift_id`, `ride_id` or `trip_id` from the request as authoritative.

**Binding is resolved by the server from `captured_at`, in one rule.**

Two different questions are deliberately kept apart — R3 conflated them and
therefore could not bind a completed ride:

- **Live eligibility** asks *"is this ride the driver's ride right now?"* and uses
  the **current** active set (§B.1).
- **Historical binding** asks *"which ride covered this instant?"* and uses the
  ride's **acceptance-to-terminal half-open interval**, whatever its status is
  today. A ride that ended at 10:10 still covered 10:04.

1. The request carries **no** ride identifier at all (§D — not `rideId`, not
   `tripId`), and **no `receivedAt`**: the server stamps receipt itself.
2. **Covering shift.** The shift whose interval contains `captured_at`:
   `opened_at <= captured_at AND (closed_at IS NULL OR captured_at < closed_at)`.
   A retained **closed** shift is a legitimate history interval; being closed
   removes live eligibility, not the ability to store. Exactly one shift interval
   must cover `captured_at`; **two overlapping shifts are rejected**
   (`ambiguous_shift`) rather than resolved by recency. Its pinned `vehicle_id`
   is used as-is (never re-derived from "the vehicle today").
3. **Covering ride** — the historical interval, driven by status, with an
   **open upper end for active rides** and an **exclusive upper bound for
   terminal ones**:

   ```sql
   -- provable coverage of :captured for :driver (one row per covering ride)
   SELECT r.id, r.trip_id
     FROM rides r
    WHERE r.driver_user_id = :driver
      AND r.accepted_at IS NOT NULL
      AND r.accepted_at <= :captured
      AND (
           -- ACTIVE: open upper end, must have no terminal stamp at all
           (r.status IN ('ACCEPTED','DRIVER_EN_ROUTE','DRIVER_APPROACHING_PICKUP',
                         'WAITING_PASSENGER','IN_PROGRESS')
              AND r.completed_at IS NULL AND r.canceled_at IS NULL)
           -- COMPLETED: exclusive upper bound on completed_at
        OR (r.status = 'COMPLETED' AND r.completed_at IS NOT NULL
              AND :captured < r.completed_at)
           -- CANCELED / NO_SHOW: exclusive upper bound on canceled_at
        OR (r.status IN ('CANCELED','NO_SHOW') AND r.canceled_at IS NOT NULL
              AND :captured < r.canceled_at)
      );
   ```

   Why the branches, and why `COALESCE` is wrong: for an ordinary active ride
   both terminal columns are `NULL`, so `captured_at < COALESCE(completed_at,
   canceled_at)` evaluates to `NULL` and the `WHERE` **silently drops the ride**
   — the defect the R4 review reproduced on `IN_PROGRESS` with both timestamps
   `NULL`. The interval is half-open at the terminal end: a fix exactly at
   `completed_at`/`canceled_at` belongs to the **next** state, not to the ended
   ride. `completed_at` covers `COMPLETED`; `canceled_at` covers `CANCELED` and
   `NO_SHOW` (migration `0001` semantics).
4. **Unprovable intervals.** A ride of that driver whose interval *cannot be
   evaluated* at `captured_at` while the row existed then is **not** silently
   ignored and is **not** treated as absent. It is unprovable when any of these
   holds:

   ```sql
   -- unprovable candidates (any row matching this could have covered :captured)
   SELECT r.id
     FROM rides r
    WHERE r.driver_user_id = :driver
      AND r.status NOT IN ('NEW_ORDER','CONFIRMATION_PENDING','CONFIRMED','CHAT_STARTED')
      AND COALESCE(r.accepted_at, r.created_at) <= :captured
      AND (
           r.accepted_at IS NULL                                   -- no lower bound
        OR (r.status = 'COMPLETED'   AND r.completed_at IS NULL)   -- terminal, no upper bound
        OR (r.status IN ('CANCELED','NO_SHOW') AND r.canceled_at IS NULL)
        OR (r.status IN ('ACCEPTED','DRIVER_EN_ROUTE','DRIVER_APPROACHING_PICKUP',
                         'WAITING_PASSENGER','IN_PROGRESS')
              AND (r.completed_at IS NOT NULL OR r.canceled_at IS NOT NULL))  -- active + terminal stamp
      );
   ```

   The four pre-accept states in §B.1 have no ride interval yet. A row in
   one of those states contributes to neither count, including when its
   `created_at` precedes capture. An active or terminal ride that needs an
   acceptance boundary and lacks it still counts as unprovable.

   **A missing required terminal timestamp must never be read as "the ride did
   not cover this instant".** It means the opposite: coverage cannot be decided,
   so the sample is rejected (`ambiguous_ride`) rather than promoted to idle.
5. **Resolution table (binding only):**

   | covering rides | unprovable rows | binding |
   | --- | --- | --- |
   | exactly 1 | 0 | `ride_id = rides.id` (UUID) + `trip_id = rides.trip_id` (TEXT), both from the **same row** |
   | exactly 1 | > 0 | **reject** (`ambiguous_ride`): a row that cannot be evaluated could cover the same instant, so uniqueness is not proven |
   | 0 | 0 | **affirmative idle**: both columns `NULL` — proven absence of ride coverage |
   | 0 | > 0 | **reject** (`ambiguous_ride`): an unprovable interval could have covered the instant |
   | > 1 | any | **reject** (`ambiguous_ride`): overlapping intervals are an invariant violation |

   The rule is uniform: **a binding is accepted only when exactly one ride
   provably covers the instant and nothing else could.**

6. **What live publication additionally requires** (§C1): the bound ride is in
   the current active set **and** its shift is still `OPEN` **and** the capture
   is within the freshness window **and** consent is valid at capture and at
   commit. Failing any of these makes the sample historical or stale — it never
   changes which ride the sample *belongs to*.
7. **No tie-break.** No `ORDER BY`, recency, distance or "closest ride"
   heuristic exists in this contract; a multi-match is an invariant violation,
   not a ranking problem (see §B.1).
8. A foreign or stale identifier can therefore never enter the row: identity
   comes from the session, binding from the captured-time interval, and both
   `ride_id` and `trip_id` are copied from that one row.

**What the DB does and does not enforce for the ride pair.** As written, the
DDL enforces only (a) the FK on `ride_id`, and (b) co-presence of the two
columns. It does **not** prove that `trip_id` belongs to `ride_id` — a row with
ride A's UUID and ride B's `trip_id` passes both checks. That is intentional and
bounded: **the server assigns both values from the same row** (§C rule 5), and
the API accepts neither from the client (§D), so the pair cannot be forged from
outside. If the DB-level invariant is wanted too, it is a `UNIQUE (id, trip_id)`
on `rides` plus a composite FK `(ride_id, trip_id) → rides (id, trip_id)` — the
same pattern `0005`/`0006` already use for their pinned tuples. It is listed as
optional because it is defence-in-depth on top of the server rule, not a
replacement for it; the validation split table below records this honestly
instead of claiming the DB already guarantees it.

**Shift coverage vs an OPEN shift — two separate gates.**

| Gate | Requires | Applies to |
| --- | --- | --- |
| Coverage | *some* shift interval of the driver contains `captured_at` (OPEN **or** retained CLOSED) | **storage** — every persisted sample |
| Liveness | the covering shift is still `OPEN` at commit **and** the ride is currently active | **live publication only** |

So:

- A fix captured at 10:19 while shift A covers it, received at 10:22 after A
  closed and even after B opened, is **stored as history under A** — never
  rejected for being late, never rebound to B, never published live. The same
  outcome holds whether B is open or there is no successor: **a successor shift
  never inherits an earlier capture.**
- A fix whose `captured_at` lies outside **every** covering interval of the
  driver is rejected (`out_of_shift`) — there is no honest `shift_id` to store.
- A fresh sample captured **before** closure but received **after** it is the
  boundary case and is resolved by the table above: storage yes, live no. The
  freshness window decides `LIVE` vs `STALE`; closure only removes `LIVE`.
- If no OPEN shift exists at receipt, **do not silently create** one from a
  location POST. Pre-shift collection (a capture before the first `OPEN`
  interval) remains an OWNER/security question and the default is fail-closed.

`quality`, `reason` and `source` are strict enumerations enforced by SQL CHECK
constraints, and **all three are server-assigned** — none is a request field
(§D). The v1 `reason` vocabulary (`stale_delayed`, `no_fix`, `shift_closed`,
`permission_revoked`, `consent_revoked`, `implausible_jump`, `ambiguous_ride`,
`ambiguous_shift`, `out_of_shift`, `retention_exceeded`, `context_unavailable`)
is frozen by this constraint; adding a value is a reviewed migration, the same rule
`0006` applies to `close_reason`.

Validation is split deliberately, and the split is part of the contract:

| Layer | Enforces | Does **not** enforce |
| --- | --- | --- |
| DB CHECK | the quality↔coordinates↔reason triple; the vocabularies; **the FK on `ride_id` and the `ride_id`/`trip_id` co-presence** (not that the two values belong to the same ride); the shift/vehicle FKs; numeric finiteness | freshness thresholds, plausibility limits, consent state, idempotency, **that `trip_id` is the trip of `ride_id`** |
| Server | **copies `ride_id` and `trip_id` from the same `rides` row** (§C rule 5) and accepts neither from the client (§D) — the only guarantee that the pair agrees; the optional composite FK in §C would add DB-level proof | — |
| API validation | shape, batch size, enum membership (`400`), **numeric finiteness** (`Number.isFinite` on every lat/lng/accuracy/speed/heading: JSON has no NaN literal, but `1e999` parses to `Infinity`, so the check is mandatory), consent and eligibility gates, duplicate/conflict resolution, out-of-order and staleness classification | durable truth — the DB still re-checks its own constraints |

A missing fix is not a zero coordinate or the last-known position; it is a
reason-coded `GAP` row (no coordinates, reason required) or an absent row, never
a fabricated position.

**Parity invariant:** every `reason` the classifier can emit must be a member of
this CHECK, so a classification outcome can never be unstorable.

Two consequences, both enforced by the executable model:

- **A coordinate-free outcome always carries a reason.** Wherever a stored row can
  be `GAP` — `HISTORICAL` (row 2), `STALE` (row 3) or `IDLE` (row 5) — the row is
  written with `reason = 'no_fix'`. A `GAP` without a reason would violate the
  coordinate/quality tuple, so "storable" and "has a reason" are the same
  statement, not two.
- **The vocabulary is read from the database, not from a list in the test.** The
  model extracts the allowed values from the live `CHECK` constraint
  (`pg_get_constraintdef`) and asserts that every reason the classifier actually
  emitted is present, raising an error — and therefore a non-zero exit — on any
  mismatch. A deliberately unknown reason is injected as a negative control to
  prove the assertion can fail.

`shift_id` is declared `NOT NULL` on purpose: every persisted sample belongs
to the **one shift that covers its `captured_at`** — an OPEN shift for a live
sample, or a retained CLOSED shift for a historical one (§C rule 2). "OPEN at
receipt" is **not** a storage requirement; it is a liveness requirement (§C1
row 4). A capture that no shift interval covers is rejected (`out_of_shift`),
and the server never invents a shift, never opens one from a POST, and never
rebinds an earlier capture to the current shift. If OWNER later approves
pre-shift sampling, that becomes a reviewed migration (nullable column or a
second table), not an implicit allowance.

`vehicle_id` is `NOT NULL` for the same reason, and it is **not** a free choice:
an `OPEN driver_shift` always has a pinned `vehicle_id` (`NOT NULL` in migration
`0006`), so a sample whose vehicle is unknown would contradict its own parent
shift. The row is denormalised for querying, not independently authoritative:
the inserting transaction must assert that the sample's `vehicle_id` equals the
locked shift's `vehicle_id`. That drift is made **unrepresentable** at the DB
layer with the same composite-FK pattern `0006` already uses:

```sql
-- companion DDL, not applied
ALTER TABLE driver_shift ADD CONSTRAINT driver_shift_id_vehicle_uk UNIQUE (id, vehicle_id);
ALTER TABLE driver_location_sample
  ADD CONSTRAINT driver_location_sample_shift_vehicle_fkey
  FOREIGN KEY (shift_id, vehicle_id) REFERENCES driver_shift (id, vehicle_id)
  ON DELETE RESTRICT;
```

Without that companion constraint, `vehicle_id` would be a second, driftable
copy of a fact the shift already owns.

## C1. Canonical disposition table — LIVE / HISTORICAL / IDLE / STALE / REJECTED

One table, evaluated **top to bottom**; the first matching row decides. This is
the single source of truth for "what happens to a sample"; §C2 and §D.2 are
consequences of it, and an implementation must not invent a sixth outcome.

The class is **derived at ingest and never stored** — the same rule migration
`0006` applies to `ONLINE`/`BUSY` (a stored copy of a derivable state drifts).
What is stored is the measurement: coordinates, accuracy, the `quality`
vocabulary, the `reason`, the shift and the ride binding.

| # | Class | Deterministic condition (first match wins) | Stored | `ride_id`/`trip_id` | stored `quality` | Published live | In aggregates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **REJECTED** | any hard gate fails: consent absent/revoked at capture **or** at commit (version mismatch); **no** shift interval covers `captured_at`; **>1** shift interval covers it; `captured_at` in the future beyond tolerance; `captured_at` older than retention; **>1** covering ride; **any** unprovable interval that could cover the instant — which also means *absence of coverage cannot be proven* (competing undefined intervals); non-finite coordinates/accuracy/speed | **no** | — | — | no | no |
| 2 | **HISTORICAL** | exactly one covering ride, and that ride is **terminal** now (`COMPLETED` → `completed_at`; `CANCELED`/`NO_SHOW` → `canceled_at`) | yes | bound to **that** ride | `GOOD`/`COARSE`/`STALE`, or `GAP` **with `reason = 'no_fix'`** | **no** — may not be shown as anyone's live position | yes, with class + coverage flags |
| 3 | **STALE** | exactly one covering ride, ride **still active**, but the sample is **not live-eligible**: `received_at - captured_at` beyond the freshness window, **or** the covering shift is no longer `OPEN`, **or** the measurement is `GAP` (no coordinates, so it can never be a live position) | yes | bound to **that** ride | `STALE` + reason, **or** `GAP` + reason (`no_fix`) | **no** | yes, with coverage flags |
| 4 | **LIVE** | exactly one covering ride, ride in the **current** active set (§B.1), covering shift still `OPEN`, `captured_at` within the freshness window, consent valid at capture and at commit | yes | bound to **that** ride | `GOOD`/`COARSE` (by accuracy) | **yes** — the only class that may publish | yes |
| 5 | **IDLE** | **0** covering rides and **0** unprovable intervals (affirmative idle), `captured_at` inside a covering shift, consent valid — **regardless of freshness** (a delayed idle sample is still idle) | yes | **NULL** / NULL | `GOOD`/`COARSE`, or `GAP` **with `reason = 'no_fix'`** | **no** (an idle position is not a ride position) | idle-distance only |

Notes that close the R3 ambiguities:

- **Terminal is not disqualifying.** Row 2 binds a *completed* ride; the active
  set governs only row 4 (liveness). This is why a delayed fix from ride A can
  still be stored under A (§C2 N1) and why "0 matches" is no longer the whole
  story.
- **Post-closure is row 2/3, never row 1.** A capture that a retained closed
  shift covers is storable; only liveness is lost. A capture outside *every*
  covering interval is row 1.
- **Idle must be proven.** Row 5 requires that no unprovable interval could have
  covered the instant; otherwise row 1 (`ambiguous_ride`). Silence is not proof.
- **`GAP` never publishes.** A gap row carries no coordinates, so it can only be
  row 2 (bound, ride terminal), **row 3 (bound, ride still active — disposition
  `STALE`, stored quality `GAP`, reason `no_fix`)**, or row 5 (unbound). Row 4
  requires `GOOD`/`COARSE`, which is also why the SQL tuple check can never
  conflict with the class: a fresh `GAP` under an active ride is deliberately not
  `LIVE`.
- **Only row 4 enqueues a live update, and only on the first accepted insert**
  (`§D.2`): duplicates never publish, and a historical or stale row never
  reaches the live projection.
- **Rejections persist nothing** — no row, no publication intent, no cache
  write. The reason is returned to the client per sample (`§D`).

## C2. Delayed samples: capture time decides, receipt time never does

A sample is **delayed** when `received_at - captured_at` exceeds the freshness
window (proposed 60 s; **OWNER must freeze the number** — it is not implied by
any existing constant). The distinction matters because a PWA loses
connectivity mid-ride and replays its queue later, possibly during a *different*
ride.

**Hard rules**

1. Binding is computed from `captured_at` only (§C rules 2–3). "The ride that is
   current at receipt" is never an input to the binding, and a ride that has
   since become terminal still owns its interval.
2. A delayed sample is stored as **HISTORICAL**, **STALE** or **IDLE**
   (§C1 rows 2, 3, 5) — never `LIVE` — and only when all of these hold:
   - `captured_at` lies inside a covering shift interval (open, or a retained
     closed one);
   - exactly one covering ride interval matches, **or** none does with no
     unprovable interval present (affirmative idle);
   - consent was granted at `captured_at` **and** is still valid at commit
     (§F — a revocation wins);
   - the sample is within the retention window.
3. A stored delayed sample keeps its **measurement** quality and only changes
   class: `STALE` quality for a coordinate-bearing fix bound to a still active
   ride (row 3); `GAP` quality — coordinates absent, **`reason = 'no_fix'`** —
   when the gap itself is what is being recorded, whether it is bound to a still
   active ride (row 3), bound to a ride that has since ended (row 2), or unbound
   in a proven free interval (row 5); the unchanged measurement quality when the
   ride has ended (row 2); or unbound `IDLE` (row 5) when the capture falls in a
   proven free interval. **Every `GAP` disposition carries `no_fix`** — the
   reason is part of what makes the row storable, not an optional annotation. **Freshness never rewrites `GAP` into `STALE`** — that would
   violate the coordinate/quality tuple in §C. Freshness also does not change
   the class of an idle sample: §C1 row 5 applies whether the packet arrived in
   a second or an hour. In every case the sample is **excluded from live
   projection** and may feed aggregates (§E) only.
4. A delayed or ambiguous fix is **never** published as a live position — not of
   its own ride and, above all, not of the ride that happens to be active on
   arrival.
5. Any uncertainty about the interval mapping fails closed: reject, persist
   nothing, return the reason. There is no "best guess" path.

**Contract negative scenarios (A → offline queue → B)**

Ride A ends while the device is offline; the driver accepts ride B; the queue
then replays samples captured during A.

| # | Situation on replay | Required outcome |
| --- | --- | --- |
| N1 | `captured_at` inside A's interval, A still identifiable, A terminal by now | stored as **HISTORICAL** (row 2), bound to **A**, `trip_id = A.trip_id`, measurement quality, not live — terminal status does **not** disqualify the historical interval |
| N2 | Same, but the client also sends modern samples captured during B | A-samples bind to A; B-samples bind to B; **no cross-contamination** in either direction |
| N3 | A's interval cannot be reconstructed (row inaccessible/purged) | **reject** (`ambiguous_ride` — an unprovable interval, §C rule 4); never fall back to B |
| N4 | `captured_at` matches no ride interval, **no** unprovable interval exists, and it is inside the shift — **fresh or delayed** | **IDLE** (row 5): `ride_id`/`trip_id` **NULL**; if the driver is on B, it is still **not** bound to B |
| N5 | `captured_at` matches two ride intervals | reject (`ambiguous_ride`), persist nothing |
| N6 | `captured_at` before shift open or after shift close | reject (`out_of_shift`) |
| N7 | `captured_at` in the future beyond tolerance | reject (`implausible_jump`) |
| N8 | Consent revoked before the replay commits | `403`, nothing persisted, live projection unchanged (§F) |
| N9 | Replay of a sample already accepted (`sample_id` seen) | idempotent duplicate result, row and live projection unchanged (§D.2) |

The table is the acceptance test for the future implementation slice: each row
is a negative test that must fail closed, not a behaviour to be tuned.

## C3. Candidate durable publication intent (DDL shape only, NOT a migration)

The live projection needs a record that survives a crash between the PostgreSQL
commit and the Redis write. Redis cannot be a transaction participant, so the
intent is durable in PostgreSQL and the cache write is a retryable follow-up
(§F.1 rules 2–4).

```sql
-- CONCEPTUAL ONLY. Do not apply to a live database.
CREATE TABLE driver_location_publication (
  publication_seq bigserial PRIMARY KEY,           -- ordering / fencing token
  -- the sample ROW's PK. Deliberately not named `sample_id`: that name is the
  -- client idempotency key on driver_location_sample, a different thing.
  sample_row_id   uuid NOT NULL UNIQUE
                    REFERENCES driver_location_sample(id) ON DELETE RESTRICT,
  driver_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  grant_version   bigint NOT NULL CHECK (grant_version > 0),
  fresh_through   timestamptz(6) NOT NULL CHECK (isfinite(fresh_through)), -- capture deadline (§C2)
  state           text NOT NULL DEFAULT 'pending'
                    CHECK (state IN ('pending', 'published', 'discarded')),
  attempts        integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at      timestamptz(6) NOT NULL DEFAULT now(),
  published_at    timestamptz(6) NULL,
  CHECK ((state = 'published') = (published_at IS NOT NULL))
);

-- Durable revocation fence ("tombstone"): survives cache deletion and races.
CREATE TABLE driver_telemetry_revocation_fence (
  driver_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  revoked_grant_version bigint NOT NULL,
  revoked_at            timestamptz(6) NOT NULL DEFAULT now()
);
```

**Protocol — nine rules, all mandatory:**

1. **Creation is `LIVE`-only and first-insert-only.** The intent is inserted in
   the **same PostgreSQL transaction** as the sample, and only when the
   classification is `LIVE` (§C1 row 4) **and** this is the first accepted
   insert of that `(driver_id, sample_id)` (§D.3). Historical, stale, idle and
   duplicate rows never create one. The server records the sample's immutable
   `fresh_through = captured_at + freshness_window` on that intent. The same
   absolute instant applies at ingress, on retries and on live reads. The
   measurement is fresh through that instant, inclusive (§C2).
2. **One name.** The token is `publication_seq` everywhere; there is no
   `sample_seq` alias.
3. **Discovery is a pending scan, never a cursor.** The publisher selects
   `WHERE state = 'pending' ORDER BY publication_seq` (`FOR UPDATE SKIP LOCKED`
   for parallel publishers). A watermark `publication_seq > $last` is
   **forbidden**: `BIGSERIAL` allocation order is not commit order, so a lower
   sequence can become visible after a higher one was already processed — a
   cursor would skip it permanently, while a pending scan still finds it.
4. **The Redis publication must be ONE script, not a read-then-write pair.**
   A `GET fence → deciders → SET` sequence is **not** atomic: a revocation can
   commit between the read and the write and the stale value survives. The
   publication decision and the cache mutation are therefore a single atomic
   Redis script (Lua), executed as one unit by Redis:

   ```lua
   -- KEYS[1] = position key, KEYS[2] = fence key
   -- ARGV = grant_version, publication_seq, payload, fresh_through_us (UTC epoch microseconds)
   local fence = redis.call('GET', KEYS[2])
   if fence and tonumber(fence) >= tonumber(ARGV[1]) then return 'fenced' end
   local deadline = tonumber(ARGV[4])
   if not deadline or not ARGV[4]:match('^%d+$') or deadline > 9007199254740991 then
     return 'expired'  -- require an exactly representable epoch-microsecond integer
   end
   local t = redis.call('TIME')
   local now_us = tonumber(t[1]) * 1000000 + tonumber(t[2])
   if now_us > deadline then return 'expired' end
   -- the position is a HASH: a plain GET would be WRONGTYPE and would
   -- silently skip the CAS. Existence must be tested with EXISTS.
   if redis.call('EXISTS', KEYS[1]) == 1 then
     local v = redis.call('HMGET', KEYS[1], 'grant_version', 'publication_seq')
     if tonumber(v[1]) > tonumber(ARGV[1])
        or (tonumber(v[1]) == tonumber(ARGV[1]) and tonumber(v[2]) >= tonumber(ARGV[2])) then
       return 'stale_ignored'
     end
   end
   redis.call('HSET', KEYS[1], 'grant_version', ARGV[1], 'publication_seq', ARGV[2],
              'payload', ARGV[3], 'fresh_through_us', ARGV[4])
   return 'published'
   ```

   The fence and deadline checks, the pair comparison and the write are one
   uninterruptible unit; two publishers racing with inverted order cannot both win.
5. **PostgreSQL commits before Redis.** The script runs only after the sample
   transaction commits; a crash in between leaves the intent `pending` and
   retryable. Writing before commit is forbidden.
6. **Revocation is also ONE script, and the fence is a separate key.**
   `SET fence <new_version>` **and** `DEL position` are a single Redis script,
   so the tombstone cannot be lost by the deletion it accompanies. The fence key
   is **never** deleted by position cleanup, TTL sweeps or logout; it may only be
   superseded by a *newer* fence, and its TTL (if any) must be ≥ the position's.
   A publisher whose `grant_version <= fence` returns `fenced`;
   `driver_telemetry_revocation_fence` in PostgreSQL is the durable mirror of
   that value for recovery after a Redis flush.

   **What this does and does not give you.** Redis-side atomicity of each script
   is real. Atomicity *across* PostgreSQL and Redis is **not** claimed and must
   not be implemented as if it existed: a revocation can commit in PostgreSQL
   before the Redis script runs. That window is closed by the **read path**, not
   by the cache — every read denies on the authoritative PostgreSQL consent row
   and fails closed if it cannot be read (§F.1 rules 1 and 5). The fence bounds
   how long a revoked value can linger in the cache; it is not the authorization
   guarantee.
7. **Re-check binding and capture freshness on every attempt.** If the current
   server time exceeds the intent's `fresh_through`, set its state to
   `discarded` and stop retrying, even during a Redis outage. With the
   pending row locked, use the current server time for `:attempt_at`:

   ```sql
   -- discard an expired pending publication
   UPDATE driver_location_publication
      SET state = 'discarded'
    WHERE publication_seq = :seq AND state = 'pending'
      AND fresh_through < :attempt_at
   RETURNING publication_seq;
   ```

   If this returns a row, skip Redis. Otherwise pass the still-pending
   intent's original deadline to the script. Its clock check also covers time spent
   waiting between the PostgreSQL check and the Redis write. The publisher
   re-reads the sample's own `shift_id`, `vehicle_id`, `ride_id`, `trip_id` and verifies that
   its covering shift is still `OPEN` and that its bound ride is still that
   driver's current active ride. If either moved, the intent is `discarded`: a
   position is never published under a different shift or ride than the one it
   was bound to.
8. **Ride PATCH ordering, or fail closed.** `PATCH
   /api/v1/ride-state/rides/:tripId/status` locks the `rides` row
   (`FOR UPDATE`). Ingest must therefore take a compatible lock (`FOR SHARE` on
   the ride, the same pattern chat already uses) so the final classification
   cannot be invalidated before commit — or, if that ordering is not proven,
   the sample must not be `LIVE`. Publishing `LIVE` without proven ordering is
   forbidden.
9. **Failure and retry have a defined outcome.** A Redis error, timeout or
   `503` leaves the row `pending` with `attempts = attempts + 1` and is retried
   with backoff while the intent is fresh. `published` sets `published_at`.
   The results `expired`, `fenced` and `stale_ignored`
   set `discarded` and are **not** retried. Retrying is safe because the script
   is idempotent: a repeat of an already-published `(grant_version,
   publication_seq)` returns `stale_ignored`, and a repeat after a revocation
   returns `fenced`. No failure mode can resurrect an older position, and no
   failure mode can publish a position that PostgreSQL never committed.

This mirrors `notification_outbox` (migration `0004`): a durable ledger plus a
retryable publisher, never an "in-process event after commit" that can be lost.

**Regression cases for these rules** (an authorized reader and an open shift):

| Fixture | Expected outcome |
| --- | --- |
| Each §B.1 pre-accept status at capture, no other ride | `IDLE`, both ride identifiers NULL |
| Same fixture plus one provably covering active ride and a fresh fix | `LIVE` with that ride's exact identifiers |
| A competing active ride is missing its required `accepted_at` | Reject with `ambiguous_ride` |
| Redis recovers after the capture deadline while the same shift and ride are active | Discard pending intent, zero cache writes |
| Dispatch before the deadline, script execution after it | Script returns `expired`, existing position and fence unchanged |
| Authorized cache hit or PostgreSQL fallback, just at and just after the deadline | Visible at equality, empty one microsecond later, including if the key still exists |

## D. Candidate API (NOT registered, names need frozen-shift-contract check)

Routing facts verified on the baseline (do not contradict them):

- The **service** routes are mounted at `/api/v1/<service>`, one prefix per
  entry of `SERVICES` in `server/src/services/index.js`. That registry holds
  **ten** entries: `auth`, `orders`, `availability`, `matching`, `route-price`,
  `ride-state`, `notifications`, `safety`, `history`, **`drivers`**. (The inline
  comment in `server/src/server.js` still says "9 service plugins" — that comment
  is stale; the array is authoritative.)
- **Other route groups are mounted separately and are not services.** R3 said
  "every product route uses a registered service"; that was too broad and is
  corrected here. Verified mounts: `chat` (`/api/v1/chat`), `webhooks`
  (`/api/v1/webhooks`), the public places catalog
  (`server/src/routes/places.js` → `GET /api/v1/places`, registered at the
  `/api/v1` prefix in `server.js`), health (`GET /api/v1/health`,
  `GET /api/v1/readyz`), and the operator `GET /metrics` at the repository root.
  So a new route needs *a mount decision*, not merely "pick a service name".
- **`drivers` IS a registered service** (correction of an earlier draft claim):
  `{ name: 'drivers', plugin: driverEnrollmentService }`, mounted at
  `/api/v1/drivers`, serving `POST /api/v1/drivers/enrollment` and
  `GET /api/v1/drivers/enrollment` — authenticated, database-backed driver
  enrollment/readiness. So `/api/v1/drivers/*` is a real namespace and a
  location route there would not 404.
- **Why `availability` still owns location ingress.** Enrollment is a
  *one-time application state* about a driver's readiness; location samples are
  *continuous operational presence* — TTL, freshness, eligibility and the
  work-context projection all belong to Presence (Phase 2, BD-DOCS-033), whose
  registered namespace is `availability`. Putting telemetry under `drivers`
  would couple a high-frequency ingest to an enrollment mutation path and give
  the identity/enrollment service authority over live presence. The same service
  already owns the only *proposed* working-context read
  (`GET /api/v1/availability/work-context`), so one owner covers read + write.
  The alternative `POST /api/v1/drivers/location/samples` is therefore rejected
  **on ownership grounds, not on existence**.
- **Registered is not live.** No location endpoint exists in any of the ten
  services today: `/api/v1/availability/*` is still a `darkService` catch-all
  answering `501 NOT_IMPLEMENTED` until Phase 2, and `drivers` serves only
  enrollment. The candidate below is a *proposal*, not a description of the
  running API.
- `GET /metrics` (repository root, no `/api/v1`) returns `501` and is reserved
  for the monitoring phase. It is an operator pull endpoint; it is **not** an
  ingest path and must not be repurposed as one.
- Do not allocate shift-write paths until `driver-shift-authority` route
  ownership is approved; that service has no HTTP routes today.

Recommended candidate (dark until implemented, OWNER to confirm):

```http
POST /api/v1/availability/driver-location/samples
Authorization: Bearer <driver-session>
Content-Type: application/json

{
  "samples": [
    {
      "sampleId": "UUID",
      "capturedAt": 1795400000000,
      "latitude": 55.75,
      "longitude": 37.61,
      "accuracyMeters": 18,
      "speedMps": null,
      "headingDegrees": null
    }
  ]
}
```

Values are **illustrative only**, not collected GPS or a real driver's route.
The body explicitly excludes `driverId`, `vehicleId`, `shiftId`, `rideId`,
`tripId`, `quality`, `reason`, `source` **and `receivedAt`**. The backend sources
identity from the authenticated work context, the ride from the **captured-time
interval** (§C rule 2, never from the ride active at receipt), the receipt
timestamp from its own clock, and the provenance/quality verdicts from its own
validation.

`source` is deliberately **not** a request field: the DDL stores it as a
server-assigned value (`CHECK (source IN ('device_fix'))`), and this endpoint
only ever accepts a device fix. A client-supplied provenance string would let a
caller self-declare a trusted origin — the exact spoofing the DDL constraint is
meant to prevent. If a future transport needs a participant-declared origin
(e.g. a manual pin), it requires its own field, its own vocabulary and an
explicit OWNER decision — it must not reuse `source`.

Candidate responses:

Every sample in a batch gets its own outcome; the transport status is the
**worst** outcome in the batch, in this precedence:
`400` (shape) → `401` → `403` → `409` → `429` → `202`.

| HTTP | Meaning | Per-sample outcomes |
| --- | --- | --- |
| `202` | batch processed | `accepted` + `class` (`live`/`historical`/`stale`/`idle`), `duplicate`, `rejected` + `reason` |
| `400` | malformed coordinates/shape, oversized batch, unknown enum, non-finite number | none persisted |
| `401` | missing/invalid session | none persisted |
| `403` | identity/role denied, consent revoked or version mismatch | none persisted |
| `409` | at least one sample conflicts (same `sampleId`, different `content_digest`); **other samples in the batch may still be accepted** | `conflict` for the offending id, normal outcomes for the rest |
| `429` | authenticated rate limit | none persisted; back off and retry |
| `503` | server/storage unavailable | none persisted; bounded retry, no unencrypted durable queue of precise positions |

Notes:

- **Quality and classification are never transport errors.** A stale, historical,
  idle or rejected sample is a per-sample outcome inside a `202`, not a `422`.
  There is no "soft failure" status to disambiguate at the transport layer.
- `202` is the recommended success status (the request is accepted, not the
  measurement's later use). Choosing `200` instead is an OWNER decision at
  freeze time and must then be applied uniformly.
- **A duplicate is success, not an error** — a client retrying after a lost
  response must not receive `409` merely because the shift has since closed;
  that is exactly the ordering bug §D.2 I3 fixes.

Choose an exact batch limit and capacity policy in the implementation SPEC. One
request must not permit one sample to update another driver's current position.
Transactional boundaries between persisted samples and Redis projection must be
documented, including repair on partial failure.

### D.2 Idempotency (per sample, not per request)

The idempotency key is `(driver_id, sample_id)` — already a UNIQUE constraint in
§C — and the **witness of "the same sample" is `content_digest`**, a 32-byte
hash over the canonical content: `captured_at`, `latitude`, `longitude`,
`accuracy_m`, `speed_mps`, `heading_deg`. Identity fields (`driver_id`,
`vehicle_id`, `shift_id`, `ride_id`, `trip_id`, `quality`, `reason`,
`source`) and `received_at` are **not** in the digest: they are server-derived,
so a replay cannot change them, and including them would make a legitimate retry
look like a different sample.

| # | Input | Required outcome |
| --- | --- | --- |
| I1 | same `sample_id`, **same** content | stable **duplicate** result (`duplicate`), HTTP success; the row is not rewritten and the live projection is not touched |
| I2 | same `sample_id`, **different** content | **conflict** (`409`, per-sample `conflict`), nothing written; the digest mismatch is the evidence |
| I3 | repeat of an already-accepted sample that also looks out-of-order | **duplicate wins**: the idempotency check runs **before** the out-of-order/staleness check for an already-accepted sample, so a retry is never reclassified as a rejection |
| I4 | repeat arriving after consent revocation | denied (`403`) — consent is checked before the result is returned; a duplicate is not a bypass (§F) |
| I5 | repeat with a different `shift_id`/`ride_id` because the server's binding changed since | still **I1**: the digest matches, so it is a duplicate; the stored row keeps its original binding and is **not** re-bound to the new shift/ride |

Consequences:

- A duplicate is **not** an error and must not create a second row, a second
  event, or a second live-projection update.
- The historical row is immutable: a retry never updates `captured_at`, the
  binding, the quality or the reason.
- `(driver_id, captured_at)` is **not** an idempotency key — two legitimate
  readings may share a timestamp, which is exactly why `sample_id` is
  client-supplied while its content is digest-verified.
- A duplicate result is still subject to the consent gate (I4); idempotency
  never overrides a revocation.

### D.3 Replays, concurrency and mixed batches

**Ordering.** The deduplication lookup runs **after** authentication, shape
validation, canonicalisation and the consent check, and **before** every
eligibility rule (shift coverage, ride binding, freshness, classification). This
is the order in §B step 5/6 and it is normative: an already-accepted sample is
never re-judged against today's shift or ride, because the answer was fixed when
it was first accepted. R3 checked eligibility first, which is why a replay in a
closed shift could wrongly return `409`.

**Concurrent retries.** Two requests carrying the same `sample_id` may race.
Resolution is by the unique constraint, not by a pre-check:

1. both compute the digest and find no row;
2. both attempt the insert; exactly one wins `UNIQUE(driver_id, sample_id)`;
3. the loser resolves the race **without reading inside an aborted
   transaction**, using one of exactly two documented forms:
   - **preferred — `ON CONFLICT … DO NOTHING RETURNING`**: the loser's insert
     returns zero rows, so no error is raised and the transaction stays usable;
     it then reads the winning row and compares `content_digest`;
   - **alternative — explicit `SAVEPOINT`**: the insert runs inside a savepoint,
     the `23505` is caught, `ROLLBACK TO SAVEPOINT` restores a usable
     transaction, and only then is the winning row read.
     A plain `SELECT` after an unhandled `23505` fails with `25P02` ("current
     transaction is aborted") — that is the trap this rule closes.
4. the loser then compares the winning `content_digest`:
   - equal → return the winning row's result as `duplicate`;
   - different → `conflict` (`409`);
5. the loser never inserts, never updates and never enqueues a publication.

A pre-check alone is therefore not sufficient — it is an optimisation, and the
constraint is the authority. This mirrors the repository's existing pattern on
`notification_outbox.source_event_id` (migration `0004`).

**Mixed batches.** A batch can legitimately contain a live sample, a historical
one, a duplicate and a conflict. Each sample is resolved independently and keeps
its own outcome; `409` does not roll back the accepted ones. The client must
reconcile from the per-sample outcomes, and a failed sample must be retried with
the **same** `sampleId` and content — a new id for retried content would defeat
the whole mechanism.

**Only the first accepted insert enqueues a live update.** The publication
intent (§F.1) is written in the same transaction as the winning insert, and only
when the class is `LIVE` (§C1 row 4). Duplicates, historical and stale rows
never enqueue, and a duplicate never re-publishes a position that is already
live.

## E. Proposed metrics and trust levels

| Metric | Source of truth / rule | Missing-data policy |
|---|---|---|
| Shift elapsed | Server `OPEN/CLOSED` timestamps | Do not equate duration of open shift with online time |
| Online/free/busy seconds | Intervalized server presence + server ride state | Missing heartbeat creates `STALE`, not fabricated online time |
| Pick-up travel distance | Validated GPS intervals linked to pre-pickup ride state | Exclude jumps and gaps; coverage ratio required |
| Passenger distance | Validated GPS intervals linked to in-progress ride | Never use client display distance string as measured km |
| Idle distance | Validated eligible shift intervals outside loaded/pickup ride windows | Do not infer through unobserved background periods |
| Waiting for passenger | Server ride `arrived_at` → `started_at` | Only if both timestamps authoritative |
| Completed rides / cancellation | Server ride events/history | Exclude mock-only state |
| Shift income | Authorized receipts linked to shift (explicit FK or approved join policy) | Do not label an approximate time join as exact |
| RUB/hour, RUB/km | Receipt values over *measured* denominators | Display `insufficient coverage` rather than false precision |
| GPS coverage | valid duration or fixes / observable elapsed period | Include sample count, stale/gap rate, confidence flag |

Define a strict ride-to-shift linkage and no double counting across overlapping
intervals before deploying aggregates. OSRM may provide independent comparison;
it must not be presented as actual GPS distance without labeling.

## F. Permission, privacy, threat model

**Explicit preconditions:** service-specific driver consent (purpose, version,
grant and revocation timestamps) **and** browser/OS permission **and**
eligible server work context. The permission screen's present local boolean is
not such evidence. Default: no collection if either is absent.

**Threats / required controls:**

- Client forges `driverId`, `shiftId`, `rideId`/`tripId` or `capturedAt`, or tries
  to self-declare provenance (`source`) or quality → identity and provenance are
  **not request fields**, so they are rejected by shape (`400`), never trusted;
  `capturedAt` is validated as a sensor time and a sample is never taken on
  trust. Rate-limit and inspect impossible speed jumps.
- Unassigned passenger requests raw GPS → deny; publish only role/ride-gated,
  purpose-limited projections with revocation on trip end.
- Leaks via `req.log`, query strings, crash reports, tracing, mock data, support
  artifacts → recursive coordinate redaction and negative tests.
- Stale Redis position after sign-out, shift closure, consent revocation or
  expiry → these are **four different gates**, not one: consent revocation is
  denied by the consent rule (§F.1 rule 1), while sign-out, shift closure and
  ride terminality are **session/shift/ride eligibility** checks that can leave
  the grant perfectly valid. A read must evaluate all applicable gates over the
  authoritative rows; a still-cached position satisfies none of them.
- Network unavailable / PWA backgrounded → stop foreground watcher, don't
  promise continuous coverage, don't use persistent unencrypted local queues.
- S3/OSRM/MapLibre do not implicitly gain access to raw driver telemetry;
  data sharing and egress require an independent authorization decision.

### F.1 Consent revocation is a synchronous deny, not a TTL

Consent is a server row, not a client flag: `(driver_id, consent_version,
granted_at, revoked_at, purpose)`. `driver_location_sample.consent_version`
(§C) records the grant each sample was accepted under. Four rules, all mandatory:

1. **Immediate read-deny.** Once `revoked_at` is set, every read of that
   driver's precise position is denied **at the moment of the read** — `403`
   (or an empty projection for the passenger view), independent of any Redis TTL
   and independent of a still-cached last-known position. A cache hit is never
   an authorization.
2. **Serialized commit on one authoritative lock.** Ingest and revocation MUST
   take the **same** lock for the same driver before deciding anything: the
   repository already provides `lockDriverAuthority(driverId)` (a `SELECT … FOR
   UPDATE` on `users(id)`, used by the shift-authority sequences), so both paths
   serialize on it. Inside that lock, in **one** PostgreSQL transaction
   (`app.db.tx`):

   1. re-read the consent row `(granted_at, revoked_at, consent_version)`;
   2. abort if absent, revoked, or the version differs from the one seen at
      ingest start;
   3. insert the sample row (§C);
   4. **only if the classification is `LIVE` (§C1 row 4) and this is the first
      accepted insert of `(driver_id, sample_id)` (§D.3)**, insert a **durable
      publication intent** — a `pending` row carrying `driver_id`,
      `sample_id`, `grant_version` — in the same transaction. Historical,
      stale, idle and duplicate samples insert **no intent**;
   5. commit.

   The intent, not Redis, is the durable record that "this sample may become a
   live position". An ordinary non-locking `SELECT` is **not** sufficient: it
   lets a concurrent revocation commit between the read and the insert (the R3
   hole).

3. **Publication is after commit, fenced atomically in Redis, retried and
   idempotent.** Redis is a cache, never a transaction participant — there is no
   distributed commit, and the contract does not pretend there is.

   - A publisher drains `pending` intents **after** the PostgreSQL commit by
     scanning `WHERE state = 'pending' ORDER BY publication_seq` — never by a
     cursor (§C3 rule 3).
   - The **entire** cache decision (fence, freshness, pair comparison and write)
     is **one atomic Redis script** (§C3 rule 4). A `GET`/decide/`SET` sequence is
     explicitly forbidden: it is not atomic and a concurrent revocation can be
     lost inside it.
   - Before running the script, the publisher re-checks the **exact** `shift_id`,
     `vehicle_id`, `ride_id` and `trip_id` of the sample and that its shift is
     still `OPEN`, its ride still current and the capture still fresh (§C3 rule 7). A moved binding
     discards the intent: a position is never published under a different shift
     or ride.
   - Revocation is enforced by **two** things, with different strength: the
     durable PostgreSQL fence `driver_telemetry_revocation_fence(...)` (survives
     a Redis flush, used to rebuild cache state) and the Redis fence key, written
     in the same atomic script that deletes the position (§C3 rule 6). The
     tombstone — not the key's absence — is what survives a delete, a race, or a
     replica still serving the old value.
   - A transient failure leaves a fresh intent `pending` with `attempts + 1`.
     Retries use the original capture deadline. An expired intent or a script
     result of `expired`, `fenced` or `stale_ignored` ends in `discarded`.
     The cache being down degrades live presence (reads fall back to the
     authoritative durable row or deny); it never loses the sample.

4. **Both commit orders are specified and safe.**

   | Order | What happens | Outcome |
   | --- | --- | --- |
   | revocation commits **first** | ingest later acquires the lock, re-reads consent, sees `revoked_at` or a newer version | insert aborts (`403`); no row, no intent |
   | ingest commits **first**, revocation **next** | revocation bumps the version and deletes the cache key; the pending intent is fenced by version | sample stays as history; publication is skipped; reads deny |

   In neither order can a live position survive a revocation, and in neither
   order can a revocation be "undone" by a queued publication.

   **The honest boundary.** PostgreSQL and Redis are not in one transaction, so
   there is a window in which a revocation has committed in PostgreSQL while the
   Redis key still holds the old value. That window **never authorizes a read**:
   rule 1 denies on the authoritative consent row, and rule 5 fails closed when
   it cannot evaluate it. The window only bounds how long a revoked position sits
   in a cache that nobody is allowed to read. Calling this "atomic revocation"
   would be false, and the contract does not call it that.

5. **Reads evaluate authorization at read time, over authoritative rows.**
   Every precise read MUST: (a) check the current consent row, (b) compare the
   cached value's `grant_version` with the authoritative one and reject a stale
   cache, (c) re-check session, shift and ride eligibility **for the exact
   `shift_id`/`ride_id` of the cached sample**, and (d) **fail closed if
   authorization cannot be evaluated** — a database error is a `503` or an
   empty projection, never "serve what the cache has". Reading "the driver's
   current ride is valid, so the cached point is valid" is forbidden: a point
   captured on ride A must not be served as a position on ride B.

   For a **live** projection, also evaluate the following predicate at the
   moment of serving, after authorization. Use trusted current server time
   and the published sample's deadline, from the same cache entry or the
   matching PostgreSQL intent on fallback. A missing, malformed or expired
   deadline yields an empty live projection. Cache TTL, a new heartbeat and
   a retry cannot extend this deadline. Authorized history follows its
   separate retention and access rules.

   ```sql
   -- live-read freshness predicate (UTC instants)
   SELECT COALESCE(isfinite(:fresh_through) AND :read_at <= :fresh_through, false) AS fresh;
   ```

5b. **Ride PATCH ordering (or fail closed).** `PATCH
   /api/v1/ride-state/rides/:tripId/status` takes `FOR UPDATE` on the `rides`
   row. Ingest's final classification must either take a compatible `FOR SHARE`
   lock on that ride (the pattern chat already uses) so a concurrent status write
   cannot invalidate it before commit, or decline to classify the sample as
   `LIVE` when that ordering is not proven. Without one of these, a `LIVE`
   decision can be stale by the time it commits — the race the R4 review
   reproduced.

6. **Two different guarantees, kept apart on purpose.**

   | Guarantee | Mechanism | Synchronous? | If it fails |
   | --- | --- | --- | --- |
   | **Authoritative read-deny** | PostgreSQL consent row + eligibility read on every precise read; fail-closed | **yes** — effective before the read returns | the read is denied (`503`/empty), never downgraded to the cache |
   | **Cache cleanup / fence** | atomic Redis revocation script (`SET fence` + `DEL position`) + PostgreSQL fence mirror | **no** — eventual, retried | a revoked position may remain in cache, but nobody may read it (row 1) and the fence blocks any later publication |

   Deleting the Redis key is required hygiene, not the protection. A test must
   prove denial **with the cache deliberately left populated** and **with the
   Redis cleanup never run** — that is the negative test that keeps TTL and
   eviction from being mistaken for authorization.

Consistency with history: revocation stops *new* collection and *all* live
reads. It does not silently delete already-accepted samples — erasure is the
retention/deletion decision below, owned by OWNER, and must be proven separately
(§H).

**Retention is unresolved:** the audit suggests 30-day raw samples / 24-month
aggregates but **OWNER has not approved either**. Before any migration,
review applicable privacy law, actual business purpose, access/export/deletion
requests, downstream copies, backups and possible legal preservation duties.

## G. Sequencing / acceptance gates

| Gate | Scope | Exit evidence |
|---|---|---|
| G0 | This contract-first docs draft | Source references, no runtime touched, exact baseline |
| G1 | Independent contract/security/privacy review | Signed data ownership, consent, retention, ID types, status rules |
| G2 | Baseline DriverMap smoke, no collection | Driver role/guard/offline/active ride and error states verified |
| G3 | Foreground-only GPS prototype, no backend | Explicit permission, visible-only, stop/revoke, real-device smoke |
| G4 | Shift + Presence server contract implementation | OPEN-shift authority, TTL, eligibility and Redis smoke |
| G5 | Telemetry storage/API | SQL/migrations, rate limits, and the negative suite: disposition table §C1 rows 1–5, delayed/replay §C2 N1–N9, idempotency §D.2 I1–I5 + concurrency §D.3, consent-revocation §F.1 (both commit orders **and** "deny with a populated cache") |
| G6 | Aggregation/UI | Coverage-aware kilometers, time and receipts matched |

No later runtime gate starts merely because this draft exists. Each is a
separate small PR, assigned and reviewed under repository governance.

## H. Unresolved OWNER decisions

1. Raw samples/aggregate retention and erasure exceptions.
2. Text/purpose/version of service consent and where it is recorded.
3. Rate, TTL, battery policy and acceptable GPS coverage/accuracy.
4. Behavior while backgrounded/airplane-mode/permission denied.
5. Approved exact shift API endpoint names and role model.
6. Billing/finance semantics of per-shift earnings.
7. Access to precise positions for dispatcher and incident response.

## I. Evidence / test boundary

The R7 package records the original docs-site gate against the
`main@559ee628` candidate. R8 verified a four-file patch against the
baseline slice recovered from that package. The complete worktree and
the docs-site gate were outside the R8 producer run. Independent R8 QA later
replayed the four files on the full pinned baseline and ran the docs-site gate.

| R8 producer evidence | Coverage | Result per pass |
| --- | --- | --- |
| Real SQL on PostgreSQL 16.16 and 18.7 | Two passes on each version. 23 matrix scenarios included 15 persisted rows and 8 expected rejections. C22 and C23 persisted coordinate-free `GAP` with `reason = 'no_fix'`. | 23/23 |
| SQL assertions and controls | Four reason-parity assertions including two negative controls, with 14 reason-bearing results, 10 distinct reasons and 11 permitted CHECK entries. Two matrix controls and 14 constraint cases with exact rejection SQLSTATE checks. | 4/4 parity, 2/2 matrix controls, 14/14 constraints |
| Concurrency and authoritative read | Separate PostgreSQL sessions with observed transaction locks. Six T5 results include the exact `deny` recorded after rolling back the authoritative-read fault. | 14/14 |
| Lua model with mock Redis API | The publication body is from §C3 rule 4. The revocation fixture models the prose in §C3 rule 6. L7 requires the exact WRONGTYPE diagnostic. L8 and L9 detect broken `DEL` and a CAS-less publisher. | 18/18 |

The R7 independent report records PostgreSQL 16.16 and 18.7 and 13
concurrency results per pass, with the authoritative-read row lost at
rollback. The R8 producer results above include that row. At the end of
each pass, 12 lock-trace rows remain in the disposable database. The second
pass resets them with the schema, and cluster teardown removes the final
12. Redis integration, live application authorization, load/performance and
real-device GPS remain `NOT_VERIFIED`.

**R9 evidence gate.** The supervisor reads the SQL and Lua verdict fields
actually printed in both passes before issuing overall success. Each pass
must contain the complete inventory. The matrix control may describe an
expected failure in its detail column. T5.3 uses revoked consent with a
matching grant version. T5.4 uses active consent with a different version.
The test package records the PostgreSQL session that wrote the T5.6 result
after rollback and the session that read the committed result.

**Archived R5 producer model evidence.** The R5 record describes a throwaway
PostgreSQL run of the disposition table, binding predicate and publication
protocol. Its recorded counts are historical.

| Suite | Cases | Result |
| --- | --- | --- |
| Consistency matrix (§C1): active ride with NULL terminals, completed/canceled/no-show history, terminal boundary, open/closed shift, delayed idle, GOOD/COARSE/STALE/GAP, overlap, unprovable interval, no consent, no context, retention, future, multiple covering shifts | 20 | **20/20** |
| Stored-quality tuple + numeric finiteness (`NaN`/`±Infinity` rejected, `GAP` rules, half-bound pair) | 10 | **10/10** |
| Idempotency (`ON CONFLICT DO NOTHING RETURNING` duplicate/conflict; `25P02` trap and savepoint recovery) | 2 (+1 trap demo) | **2/2** |
| Publication model: out-of-order CAS, pending-scan vs cursor, revocation fence, fence after cache delete, newer grant, Ride PATCH race | 6 | **6/6** |

Two defects were found *by* running the matrix rather than by reading it — the
`COALESCE` null-drop (§C rule 3) and the missing `GAP` disposition (§C1 row 3) —
which is why this evidence is part of the contract, not an appendix.

**R4/R3 regression check.** The four registry cells were re-measured after the R5
edits and are **unchanged** — the R5 rework adds no document and no registry
entry (61 without the generated report, 62 with it; 8→9 registered).

Registry numbers, measured in one environment rather than estimated:

| Environment | Legacy files | Registered | UNACCOUNTED (warn-only) |
| --- | --- | --- | --- |
| baseline checkout, no generated report | 69 | 8 | 61 |
| baseline + generated `docs/dispatcher-report.md` | 70 | 8 | 62 |
| this slice, no generated report | 70 | 9 | **61** |
| this slice + generated report | 71 | 9 | **62** |

The slice adds one document **and** one registry entry, so it is net-neutral on
warnings. `docs/dispatcher-report.md` is generated, gitignored and untracked;
its presence changes the count by one and must not be quoted as a fixed number.
The validator's `⚠ N UNACCOUNTED_DOCUMENT` summary line is not a document.
- The archived R7 gate records `node scripts/check.mjs` as passing (`All checks passed`).
- The archived R7 gate records `node scripts/dispatcher.mjs` as `READY_DIRTY` with `128/128 PASS` and
  `Drift: CLEAN`. `READY_DIRTY` is the expected verdict for an uncommitted
  docs-only working tree (the dispatcher reports *green node + uncommitted
  tracked changes*), not a failing gate.
- The candidate SQL remains **illustrative and unapplied**: no migration, no
  database, no runtime change was made. Real-device GPS behaviour is
  `NOT_VERIFIED` by design.

Runtime facts cited above were read from the baseline tree (migrations `0001`,
`0006`; `server/src/server.js`; `server/src/services/availability/index.js`;
`server/src/routes/metrics.js`; `public/src/mapbox/geolocation_service.js`;
`public/src/geo_point.js`; `public/src/state.js`), not from memory.

## J. Boundary vs the observability stack

This contract is **domain location telemetry**, not runtime observability. The
two must not be merged:

| Concern | Owner | Relationship to this contract |
|---|---|---|
| Metrics, traces, structured logs, alerting, SLOs | Phase 7 Monitoring & Audit (issue #591, BD-DOCS-038); pilot observability issue #827 | Observes services; must **not** receive driver coordinates |
| `GET /metrics` (root path, `501`) | monitoring phase (BD-DOCS-038) | Operator pull endpoint; never the ingest path |
| CSP allowance for a telemetry endpoint | security/owner + BD-DOCS-038 | Out of scope here — this slice changes no CSP |
| Service worker caching policy | sw-offline-agent + BD-DOCS-038 | Out of scope here — `public/sw.js` and precache untouched; telemetry traffic must never be cached |
| Driver location samples, presence projection | this contract (future slices) | Domain data with a privacy lifecycle |

Consequences: no coordinate may appear in logs, trace attributes, metrics
labels, analytics events or mock fixtures (§F); and a dashboard or alert is not
an audit trail for location access — access to precise positions stays the
role/ride-gated projection described in §F.
