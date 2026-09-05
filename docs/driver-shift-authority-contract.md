# BD-DRIVER-SHIFT-AUTHORITY-01A

Status: contract-first / docs-only, audit + draft

Issue: none yet — this slice is intentionally pre-Issue (see "Process boundary" below)

Architecture: Driver Availability / Backend API / DB / Safety & Compliance / (future) Presence & Dispatcher prerequisite

## Process boundary

This document is the **audit + contract draft** for `BD-DRIVER-SHIFT-AUTHORITY-01A`. It is produced entirely inside a local, detached worktree pinned to `main@354a41eda3eb53b7a33301ea0b25f32347045a8e` — no commit, no push, no branch, no Issue, no PR, no GitHub metadata write happens as part of producing this draft. A tracking Issue, branch, and Draft PR are created only in a **separate, later gate**, after this draft itself passes its own contract-review round (mirroring exactly how `BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01A` was hardened before Issue #959 / PR #960 existed).

## Existing anchors and audit

### What already exists and is frozen

- `docs/driver-vehicle-assignment-authority-contract.md` (Issue #959, PR #960, merged `main@0bcc417e…`) — freezes **ownership ≠ entitlement ≠ selection ≠ working**, and already contains a "Downstream contract — driver shift" section that fixes the parts Vehicle Assignment Authority depends on: the opening-transaction pseudocode, the minimal `driver_shift` shape (`id`, `driver_id`, `vehicle_id`, `assignment_id`, `status OPEN|CLOSED`, `close_reason`, `opened_at`, `closed_at`), the mid-shift invalidation policy, and three audit-event names (`DRIVER_SHIFT_ASSIGNMENT_INVALIDATED`, `DRIVER_SHIFT_CLOSE_DEFERRED_FOR_ACTIVE_RIDE`, `DRIVER_SHIFT_FORCED_CLOSED_ASSIGNMENT_UNUSABLE`). **This document extends that section — it does not contradict or restate it as new.** Every quote below marked "frozen by 01A (Assignment Authority)" is carried forward verbatim, not reinvented.
- `server/migrations/0005_driver_vehicle_assignment_authority.sql`, `server/src/repositories/vehicle_driver_assignments.js`, `server/src/repositories/driver_active_vehicle.js`, `server/src/services/driver-vehicle-assignment-authority/index.js` (Issue #961, PR #962, merged `main@354a41e…`) — the real `vehicle_driver_assignments` + `driver_active_vehicle` tables and their repository primitives, including `lockDriverAuthority(driverId)` (locks `users(id)`, not `driver_active_vehicle`) and the per-driver → assignment → vehicle lock order. Shift Authority's opening sequence reuses this exact lock, not a new one.
- `server/src/domain/ride-status.js` (server mirror of `public/src/ride_state.js`) — `RIDE_STATUS`, `TERMINAL_RIDE_STATUSES = {COMPLETED, CANCELED, NO_SHOW}`, the terminal-freeze rule. Shift Authority reuses this set verbatim for "non-terminal ride" — **it does not define a second ride-state machine.**
- `docs/driver-document-compliance-contract.md` (Issue #953, PR #954, merged `main@a3a8367…`) — **already** defines the compliance evaluation context as `{ driverId, activeVehicleId, shiftId }`, already requires `shiftId` to identify a shift that is `OPEN` and linked to the exact `driverId` **and** `activeVehicleId`, and already states the fail-closed rule: "evaluating with no server-authoritative OPEN shift can never yield `complianceReady: true`." This is a strong forward-compatibility signal — the compliance contract was written expecting exactly the `driver_shift` entity this document now specifies.
- `docs-site/docs/decisions/presence-heartbeat.md` (BD-DOCS-033, `status: draft`, **not implemented**) — proposes a server-side heartbeat+TTL presence service keyed to "the authenticated driver identity … and the active vehicle (the garage vehicle in use)", with `driverOnline` becoming "a local mirror of server presence, not the authority", states `online_busy` is derived from the active ride (non-terminal `RIDE_STATUS`), and gates going online on `isDriverLineReady` (`documentsReady` + `waybillOpen` + `medicalCheckPassed` + profile completeness — all **profile-level, non-shift-scoped** client booleans).
- `public/src/state.js` — legacy client-only fields: `driverOnline: false` (v3), `shiftOpen: false` / `waybillOpen: false` / `medicalCheckPassed: false` (v4), `documentsReady` / `shiftDocsReady` (v5, derived from `driverDocuments`), `driverGarage: { activeVehicleId, vehicles }` (v11). None of these are read or written by any server code today — they are pure `bazardrive.user.v1` PWA state.
- `docs-site/docs/audits/schema-column-audit-0001-0003.md` — `rides.driver_shift_duration` is an existing, **unrelated**, display-only `TEXT NULL` column (from the legacy client `ride.driver.shiftDuration` label, e.g. "3ч 20мин"), `NOT_IMPLEMENTED` server-side. It is a naming-adjacency risk only — flagged below, not touched.

### Audit matrix

| Concept | Current source | Current authority | Target authority | Drift / conflict |
| --- | --- | --- | --- | --- |
| Ownership | `vehicles.owner_user_id` | Server (PostgreSQL, since 0001) | unchanged | none |
| Entitlement | `vehicle_driver_assignments` | Server (PostgreSQL, since 0005) | unchanged | none |
| Selection (pre-shift preference) | `driver_active_vehicle` | Server (PostgreSQL, since 0005) | unchanged | none |
| "Active vehicle" (client concept) | `driverGarage.activeVehicleId` (`public/src/state.js`) | **Client** — `bazardrive.user.v1`, never read by server | must become **display-only**, never authority | Presence ADR (draft) still says presence keys to "the active vehicle (the garage vehicle in use)" — ambiguous language predating the ownership≠entitlement≠selection split; needs eventual docs-sync, not resolved here |
| Working / occupancy | none (no `driver_shift` table exists) | **absent** | `OPEN driver_shift.vehicle_id` (this document) | this is the gap this slice closes |
| `driverOnline` | `public/src/state.js` (client boolean) | **Client only** | eventually a local mirror of a server Presence verdict (per BD-DOCS-033, not built) | Presence ADR already anticipates this; genuinely out of scope for 01A (no Presence runtime exists to be authoritative over) |
| `shiftOpen` / `waybillOpen` / `medicalCheckPassed` / `shiftDocsReady` | `public/src/state.js` (client booleans, profile-scoped, not shift-instance-scoped) | **Client only** | superseded by (a) `OPEN driver_shift` existence for "shift open", (b) shift-scoped `WAYBILL`/`MEDICAL_CHECK` compliance evidence (`docs/driver-document-compliance-contract.md`) for the rest | direct naming collision with this document's `driver_shift` and with the compliance contract's shift-scoped documents — these client fields describe a **pre-authority, profile-level** approximation and must not be read as satisfying the new server contracts; reconciling `public/src/state.js` is explicitly out of scope for 01A |
| `online_busy` | Presence ADR proposal (draft, not built) | n/a (not implemented) | derived from non-terminal `RIDE_STATUS`, per `server/src/domain/ride-status.js` | none — the ADR's own design already matches this document's Invariant (busy state is never a shift field); carried forward |
| Compliance context | `docs/driver-document-compliance-contract.md` | Server (contract frozen, no schema yet) | consumes `shiftId` from this document's `driver_shift` | already forward-compatible; that contract's `activeVehicleId` wording ("the driver's server-owned active assignment (Availability/garage)") is slightly stale relative to the now-precise "sourced from the OPEN driver_shift row's pinned vehicle_id" wording already frozen in the Assignment Authority contract — a documentation-sync opportunity, not a live contradiction; **not edited in this gate** |
| `rides.driver_shift_duration` | `server/migrations/0001_phase1_init.sql` | Server column, `NOT_IMPLEMENTED` writer/reader | unrelated — a free-text ride-display label | naming-adjacency only; no schema or semantic collision, flagged for awareness |

No existing doc or code required editing to resolve a direct contradiction — every touch point above is either already forward-compatible or explicitly pre-authority/client-only and out of scope. No file other than this new one is modified.

## Core separation (frozen, extends Assignment Authority's ownership≠entitlement≠selection≠working)

```
ownership            vehicles.owner_user_id
entitlement          vehicle_driver_assignments (status ACTIVE | ENDED | REVOKED)
selection            driver_active_vehicle                    — mutable pre-shift preference
working              OPEN driver_shift                         — current working identity (THIS document)
presence             ONLINE / OFFLINE                          — liveness / dispatch availability (BD-DOCS-033, not built)
ride occupancy       non-terminal ride (RIDE_STATUS)            — current busy/free state
```

None of these six concepts collapses into another, and none collapses into a single boolean:

- `vehicles.is_active` remains legacy/derived only (unchanged from Assignment Authority) — no decision in this document reads it.
- `driver_active_vehicle` is **not** working state — it feeds shift-open, nothing more.
- `driverOnline` is **not** shift authority — it is, at most, a future *mirror* of a server Presence verdict.
- An `OPEN driver_shift` does **not** by itself mean `ONLINE`. A driver may have an `OPEN` shift while temporarily `OFFLINE` (see "Presence boundary").
- `ONLINE` must eventually require an `OPEN` authoritative shift (target invariant, not enforced here — no Presence runtime exists yet).
- `online_busy` is derived from ride state (`RIDE_STATUS`, non-terminal), **never** a `driver_shift` status value.
- Going `OFFLINE` does **not** automatically close the shift, unless a separate, later Availability close-policy explicitly says so (open question, deferred — see "Unresolved architecture questions").

## Data contract — `driver_shift` (new — target entity, not created by 01A)

One row = one instance of a driver actually working a specific vehicle under a specific entitlement, from open to close.

**The fields below are the minimum required authoritative schema, not an exhaustive or closed list.** 01B may add purely operational/non-authoritative metadata (e.g. an internal index-support column) if needed. Any field that would introduce a **new persisted lifecycle state, a pending/intent state, an authority decision, or an additional state transition** — including any mechanism for the deferred-cleanup trigger discussed under "Server-forced close" — requires a contract review/amendment first, not a silent schema addition. This is what keeps `driver_shift` from silently regrowing the `BUSY`/`ONLINE`/compliance fields this document explicitly rejected above: a reviewer checks new columns against *this* rule, not against convenience.

**Immutable at creation, never rewritten (pinned identity):**

| Field | Meaning |
| --- | --- |
| `id` | Surrogate PK (server-generated UUID). The shift identity. |
| `driver_id` | FK → `users(id)`. The working driver. |
| `vehicle_id` | FK → `vehicles(id)`. Pinned from the re-read selection's assignment at open time — never client-supplied. |
| `assignment_id` | FK → `vehicle_driver_assignments(id)`. The entitlement this shift was opened under. |
| `opened_at` | Server/database clock. Never a browser timestamp. **Always non-null** — a row cannot exist without having been opened; 01B should express this as a plain `NOT NULL`, not a conditional CHECK. |

Once written, `driver_id` + `vehicle_id` + `assignment_id` never change for the life of the row — not on close, not on any later assignment-usability transition. A "retained pinned tuple preserves identity and audit context only" (Assignment Authority's own formulation, carried forward exactly) — it does not imply the assignment is still usable.

**Referential integrity — the pinned tuple MUST be DB-representable, not application-asserted alone.** `driver_id` + `vehicle_id` + `assignment_id` denormalizes a fact that already lives inside `vehicle_driver_assignments` (its own `driver_id` and `vehicle_id` columns) — exactly the situation Assignment Authority's own contract warns about for a hypothetical denormalized `vehicle_id` on `driver_active_vehicle`: such a column "must be covered by a **three-column** composite FK … never an application-level assert." `driver_shift` denormalizes the identical pair (`driver_id`, `vehicle_id`) alongside `assignment_id`, so the same discipline applies here, and today it is not DB-representable: `vehicle_driver_assignments` (migration 0005, already merged) carries only `CONSTRAINT vehicle_driver_assignments_id_driver_uq UNIQUE (id, driver_id)` — a two-column key, insufficient as a target for a `(assignment_id, driver_id, vehicle_id)` composite FK. This document therefore freezes the DB direction for 01B:

- 01B **MUST** add `CONSTRAINT vehicle_driver_assignments_id_driver_vehicle_uq UNIQUE (id, driver_id, vehicle_id)` to `vehicle_driver_assignments`. This is intentionally redundant with the table's own primary key for uniqueness alone (`id` is already globally unique, so `id`+anything is trivially unique too) — its purpose is not to add a new uniqueness fact, but to exist as a **composite FK target** that lets `driver_shift` prove its pinned pair belongs to that exact assignment row. Because it is redundant-for-uniqueness, adding it is a zero-risk, purely additive migration at any time — before or after 01B ships — with no possible existing-data violation.
- `driver_shift` **MUST** declare `FOREIGN KEY (assignment_id, driver_id, vehicle_id) REFERENCES vehicle_driver_assignments (id, driver_id, vehicle_id)`. This makes "a pinned tuple whose `vehicle_id` does not match its own `assignment_id`'s true vehicle" **unrepresentable at the DB layer** — not just prevented by the opening transaction's own derive-and-assert step. Application-level validation (deriving `vehicle_id` from the locked assignment row at open time, per "Opening a shift") is still required for authorization/usability — the composite FK does not replace it — but it must not be the *only* protection against an internally inconsistent pinned tuple.
- `driver_shift` also keeps its direct FKs to `users(id)` and `vehicles(id)` for referential clarity (a plain foreign key naming the working driver / vehicle independent of the assignment path) — the composite FK above is additional, not a replacement for these.
- All of `driver_shift`'s FKs — direct and composite — use `ON DELETE RESTRICT` (or an equivalent stricter, history-preserving policy). **No cascade may erase a historical shift row.**

**Server-mutable lifecycle fields:**

| Field | Meaning |
| --- | --- |
| `status` | `OPEN` \| `CLOSED`. No third value (see "State machine"). |
| `closed_at` | `NULL` while `OPEN`; the exact server transition time on `OPEN → CLOSED`. Once set, **must be `>= opened_at`** (see "Lifecycle state invariants", below). |
| `close_reason` | `NULL` while `OPEN`. **Mandatory iff `CLOSED`** — a `CLOSED` row with a `NULL` reason is not a valid state. See "close_reason vocabulary". |
| `updated_at` | Last lifecycle write (server time). |

### Lifecycle state invariants

Frozen per-state requirements, for 01B to express as explicit PostgreSQL `CHECK` constraints (mirroring `vehicle_driver_assignments_active_iff_not_terminated` and `vehicle_driver_assignments_window_check`):

```text
status = OPEN   =>  opened_at IS NOT NULL
                AND closed_at IS NULL
                AND close_reason IS NULL

status = CLOSED =>  opened_at IS NOT NULL
                AND closed_at IS NOT NULL
                AND close_reason IS NOT NULL
                AND closed_at >= opened_at
```

`closed_at >= opened_at` is the one temporal invariant this document freezes: close time can never precede open time. This document does **not** require a strictly-positive duration (`closed_at > opened_at`) — nothing audited rules out an immediately-opened-and-closed shift (e.g. a driver who opens, then instantly changes their mind), and inventing a minimum-duration rule here would be scope creep into a future Availability/UX policy, not a correctness invariant. `>=` is the correctness floor; a product-level minimum-shift-duration rule, if one is ever wanted, belongs to a later, separate policy layer, not this schema-level CHECK.

Reaffirmed, not reopened: `CLOSED` cannot transition back to `OPEN` (Invariant 7); the pinned identity (`driver_id`/`vehicle_id`/`assignment_id`) cannot mutate after creation (this section + Invariant 8); `opened_at`/`closed_at` are server/database-clock values, never browser timestamps (unchanged from "Server time and immutable history", below).

## State machine

```
NONE ──▶ OPEN ──▶ CLOSED
```

- `NONE` is the absence of a row for that shift instance (a driver simply has none in progress) — not a stored value.
- `OPEN → CLOSED` is the only transition. **No `CLOSED → OPEN` reopen.** A driver who wants to work again after closing opens a **new** `driver_shift` row (new `id`), exactly mirroring "renewing an entitlement creates a new assignment row" in Assignment Authority — the same append-mostly, no-reopen pattern.
- No `BUSY`, `ONLINE`, `OFFLINE`, or compliance state is added to `driver_shift`. Each is fully derivable from elsewhere without a stored column: busy/free from `RIDE_STATUS` (existing ride-state authority), online/offline from a future Presence verdict (BD-DOCS-033, not this slice), compliance readiness from `docs/driver-document-compliance-contract.md`'s own projection keyed by this shift's `id`. Storing any of them on `driver_shift` would create a second, driftable copy of state another layer already owns — explicitly rejected.
- No `PAUSED` state: nothing in the audited sources (Presence ADR, compliance contract, Assignment Authority) requires an intra-shift pause distinct from `OPEN` (still working, still pinned) or a ride's own waiting states (already modeled in `RIDE_STATUS`, e.g. `WAITING_PASSENGER`). If a future product need for "on shift but temporarily unavailable" appears, that is a **Presence** state (`online_busy` / a new `online_paused`), not a `driver_shift` state — shift only answers "is this driver currently pinned to this vehicle under this entitlement," never "are they accepting work right now."

## Exclusivity

At most one `OPEN driver_shift` per `driver_id`, **and** at most one `OPEN driver_shift` per `vehicle_id` — this, not the selection layer, is what makes "one working driver per vehicle" true (Assignment Authority Invariant 5, carried forward exactly). Entitlement and selection remain deliberately non-exclusive (several drivers may be entitled to, or have selected, the same vehicle).

**PostgreSQL enforcement (for 01B):** two `PARTIAL UNIQUE INDEX`es over rows `WHERE status = 'OPEN'`, named `driver_shift_one_open_per_driver_uq (driver_id)` and `driver_shift_one_open_per_vehicle_uq (vehicle_id)`, are sufficient for this — unlike Assignment Authority's non-overlap rule (a *time-range* invariant that a `now()`-independent partial index structurally cannot express), "at most one `OPEN` row" is a **static row-count** invariant over a **static predicate** (`status = 'OPEN'`, not a function of the clock) — exactly what a partial unique index is designed for, and it is safe under concurrent `INSERT`s (PostgreSQL enforces uniqueness constraints, including partial ones, atomically at commit/statement time). These two named indexes are the **final DB correctness backstop** — they hold even if a future caller skips every application-level pre-check below.

**Uniqueness-violation → domain-conflict translation (frozen).** When the final `INSERT` loses a concurrency race despite the in-transaction pre-check (below), the resulting PostgreSQL error is `23505 unique_violation` on one of the two named indexes, not a generic 500. 01B **MUST** catch this and translate it into the same domain-level conflict the pre-check itself returns for the common-path race — never let a raw, unclassified PostgreSQL error escape to a caller:

```text
violates driver_shift_one_open_per_driver_uq   ->  domain DRIVER_SHIFT_ALREADY_OPEN
violates driver_shift_one_open_per_vehicle_uq  ->  domain VEHICLE_SHIFT_ALREADY_OPEN
```

Both are expected business conflicts (the same two outcomes preconditions #10/#11 already describe), reached by two different roads — the pre-check catches the common case cleanly; the unique-violation translation is the backstop for the residual race window between the pre-check and the `INSERT`.

**Lock roles, kept distinct — three different concerns, not one:**

1. **The per-driver authority lock** (`lockDriverAuthority(driverId)`) serializes **one driver's own** selection/shift operations against each other (Race A). It does **not** serialize Driver A against Driver B — they hold different locks, on different `users` rows, and neither ever blocks the other by taking it.
2. **The vehicle-row lock** (`lock the vehicle row`, already present in the opening-transaction sequence) is what gives **two different drivers** racing on the **same vehicle** a shared serialization point: whichever driver's transaction locks `vehicles` row X first proceeds to its own "no `OPEN` shift for this `vehicle_id`" check and `INSERT`; the second driver blocks on that same row lock until the first commits, then re-reads and correctly observes the vehicle is already taken. This is what turns the cross-driver race into a **deterministic, ordered outcome** (whoever locks first wins) rather than "whoever's `INSERT` happens to reach the index first" — a real but strictly worse experience (an unordered violation, not a predictable conflict). The vehicle-row lock is for **deterministic business-conflict handling and lock-order-based deadlock avoidance** (every transaction, for every driver, takes locks in the same global order — per-driver lock → assignment → vehicle — so no two transactions can ever hold-and-wait on each other's locks in reverse order, cross-driver or not); it is not needed for **DB integrity**, which the partial unique index already guarantees unconditionally on its own.
3. **The partial unique index** is the **DB-integrity backstop**, independent of either lock — it holds even against a hypothetical future caller that skips the vehicle-row lock entirely (a bug, a maintenance script, a different service).

The desired application lock order remains exactly what "Opening a shift" already specifies: `per-driver lock → assignment lock → vehicle lock → OPEN-shift check → INSERT`. **The vehicle lock does not make the unique index unnecessary, and the unique index does not make the vehicle lock optional** — the lock gives a predictable, translatable conflict on the common path; the index guarantees correctness even when something bypasses the lock.

## Opening a shift — the transaction

One server transaction, in exactly this order (inherited and extended from Assignment Authority's own "Opening a shift" section):

```text
db.tx
  -> stable per-driver authority lock            -- lockDriverAuthority(driverId): users(id) FOR UPDATE
                                                  --   (or advisory(driverId)) — the SAME lock Assignment
                                                  --   Authority's select/switch/clear already use
  -> re-read driver_active_vehicle UNDER the lock -- never a value cached earlier in the request
  -> assert a selection still exists (state is not NONE)
  -> lock the selected vehicle_driver_assignments row  -- lockAssignmentForEntitlementCheck (existing primitive)
  -> derive/pin vehicle_id from THAT locked assignment row -- never a client-supplied vehicle_id
  -> lock the vehicle row / required dependent authority
  -> assert assignmentUsabilityDecision(serverTime) == USABLE   -- UNUSABLE or UNKNOWN both abort
  -> assert the selected assignment belongs to this exact driver
  -> assert no OPEN driver_shift for this driver_id              -- re-check under lock, not trust the unique index alone
  -> assert no OPEN driver_shift for this vehicle_id             -- re-check under lock, not trust the unique index alone
  -> assert no non-terminal ride for this driver that blocks a shift change
  -> insert OPEN driver_shift  pinning  driver_id + vehicle_id + assignment_id
                                        taken from the re-read selection
```

The shift-open path **must not trust**: a request-cached `assignment_id`, a client-supplied `vehicle_id`, a client-supplied owner identity, a `driver_active_vehicle` value read before the lock, `vehicles.is_active`, or any browser `localStorage` state. The server's own re-read under the lock is the only authority — this is a direct restatement of the "no request-cached selection" rule Assignment Authority already froze for `select`/`switch`, extended to shift-open because both share the same lock.

Explicit re-check note: the partial unique index is what makes the exclusivity guarantee **hold under any concurrency**, but the transaction still performs its own `SELECT ... FOR UPDATE`-style re-check under the per-driver lock before `INSERT`, so the *first* observable failure for an ordinary racing pair is a clean, application-level `409`, not a raw constraint-violation surfaced to the caller; the index is the backstop that makes this true even if a future caller skips the pre-check, not the primary UX path.

## Shift-open preconditions — explicit per-case outcomes

| # | Case | Outcome |
| --- | --- | --- |
| 1 | No current selection (`driver_active_vehicle` absent) | Reject — retryable, "no selection" error. Not a shift-authority failure; the client should select first. |
| 2 | Selected assignment belongs to another driver | Cannot occur if the composite FK (Assignment Authority, `vehicle_driver_assignments_id_driver_uq`) holds — defensive re-assert anyway; reject, terminal (data-integrity class, not retryable). |
| 3 | Assignment `ENDED` | `UNUSABLE` → reject, retryable only after a **new** assignment/selection exists. |
| 4 | Assignment `REVOKED` | `UNUSABLE` → reject, same as above. |
| 5 | Assignment `starts_at` in the future | `UNUSABLE` (not yet entitled) → reject, retryable once `starts_at` is reached. |
| 6 | Assignment `ends_at` exactly `now()` | The half-open window `[starts_at, ends_at)` excludes the instant `t == ends_at` (Assignment Authority's `t < ends_at`) → `UNUSABLE` → reject. No special-casing; this is the same boundary already proven by Assignment Authority's adversarial review. |
| 7 | Vehicle `archived` | `UNUSABLE` → reject, terminal for this vehicle (a new assignment on a different vehicle is the only path forward). |
| 8 | Vehicle block state `BLOCKED` | `UNUSABLE` (confirmed negative) → reject. |
| 9 | Vehicle block state `UNKNOWN` | `UNKNOWN` → reject, **retryable fail-closed**, no durable shift transition (no partial `OPEN` row is ever created on `UNKNOWN`). |
| 10 | Driver already has an `OPEN` shift | Reject — `409`-class, "already working" (a driver cannot pin two vehicles at once). The existing shift is untouched. |
| 11 | Vehicle already has another driver's `OPEN` shift | Reject — `409 VEHICLE_ALREADY_IN_OPEN_SHIFT` (identical code/semantics to Assignment Authority's own selection-vs-shift race outcome). The losing driver's `driver_active_vehicle` selection is left intact — a preference that simply cannot become a shift right now, never cleared or flagged stale (Assignment Authority Invariant 5, unchanged). |
| 12 | Driver has a non-terminal active ride | Reject — fail closed. (Whether a *different* shift could still be opened for a *different* vehicle while a ride is in progress is not a real scenario: a driver can only have one ride in progress as the assigned driver of that ride, and that ride is tied to whichever shift/vehicle accepted it once shift-authority is live — so this precondition is a hard reject, not a per-vehicle nuance.) |
| 13 | Selection changes concurrently with shift-open | Cannot produce an inconsistent pin: both the concurrent selection mutation and this shift-open take the **same** per-driver lock first (Invariant, below) — whichever transaction commits second observes the first's committed result. The shift is pinned from **its own** re-read under the lock, never a value read before it. |

Baseline semantics (inherited from Assignment Authority, restated for shift-open specifically):

```text
USABLE   -> shift-open may proceed
UNUSABLE -> shift-open rejected, terminal for this exact assignment
UNKNOWN  -> shift-open rejected, retryable fail-closed, no durable transition
```

Confirmed local `UNUSABLE` dominates an external block-source `UNKNOWN` exactly as Assignment Authority already froze (confirmed negative > `UNKNOWN` > positive) — a `REVOKED`/`ENDED`/expired/archived assignment is `UNUSABLE` for shift-open purposes regardless of whether the block source is reachable.

## Invariants

1. **Exclusivity is row-count, not time-range.** At most one `OPEN` row per `driver_id`; at most one `OPEN` row per `vehicle_id`. Enforced by two partial unique indexes (see "Exclusivity"), independent of `now()`.
2. **One stable per-driver lock serializes selection *and* shift.** Every `driver_active_vehicle` mutation (`select`/`switch`/`clear`, Assignment Authority) **and** every `driver_shift` open/close runs inside one `db.tx` that acquires `lockDriverAuthority(driverId)` first — the identical primitive, not a parallel lock. Global lock order: per-driver lock → assignment → vehicle/dependent rows → shift row → mutation. No new lock primitive is introduced by this slice.
3. **The shift-open re-read is authority.** The pinned tuple is taken from `driver_active_vehicle` re-read **under** the lock, never from a value cached earlier in the request, never from client input.
4. **Confirmed `UNUSABLE` dominates `UNKNOWN` for shift-open**, identically to Assignment Authority's own precedence rule.
5. **No driver-initiated selection change during an `OPEN` shift** (Assignment Authority Invariant 7, unchanged) — the only actor that may move the selection while a shift is open is the server, inside the shift-close/cleanup transaction.
6. **A non-terminal ride freezes both selection and shift-open** (extends Assignment Authority Invariant 8 to shift-open: the same ride-state definition — `ACCEPTED` through `IN_PROGRESS`, excluding pre-accept and terminal states — blocks a *new* shift-open exactly as it blocks a selection change).
7. **`CLOSED` is terminal for the row.** No `CLOSED → OPEN`; a renewed working session is a new row.
8. **Pinned identity is immutable audit context**, retained regardless of later assignment lifecycle changes — a retained pinned tuple never implies the assignment is still usable (Assignment Authority's formulation, unchanged).

## Active-ride boundary

Terminal ride states are exactly `server/src/domain/ride-status.js`'s `TERMINAL_RIDE_STATUSES = {COMPLETED, CANCELED, NO_SHOW}` — **no second ride-state machine is introduced.** "Non-terminal active ride" for shift purposes is defined identically to Assignment Authority Invariant 8: a `rides` row for the driver whose status is past `ACCEPTED` and not terminal.

- **Opening** a new shift while the same driver already has a non-terminal active ride fails closed (precondition #12, above).
- **Driver-requested close** while a non-terminal ride exists is **rejected outright** (`ACTIVE_RIDE_PRESENT`, no shift mutation, no persisted state) — never orphaning or aborting the ride, and never silently deferred either; see "Closing a shift" below.
- **Server-forced close** (confirmed assignment `UNUSABLE`) while a non-terminal ride exists follows the identical deferred-close policy Assignment Authority already froze in full (see "Server-forced close", below — carried forward, not reinvented). Unlike the driver-requested case above, this path genuinely *is* deferred (the shift stays `OPEN` and self-closes later) rather than rejected, precisely because it is driven by a fact — the assignment's own confirmed terminal status — that is already durable, not by a request that would otherwise need its own storage.

## Closing a shift

Two categories, matching STEP 8's split exactly.

### Driver-requested / normal close

One transaction:

```text
db.tx
  -> stable per-driver authority lock (same lockDriverAuthority(driverId))
  -> locate the exact OPEN shift for this driver_id (re-read under the lock)
  -> if a non-terminal ride exists for this driver:
       REJECT — no shift mutation, no persisted close-request state at all;
       error domain: ACTIVE_RIDE_PRESENT; the caller may retry the SAME
       closeDriverShift call after the ride reaches a terminal state, at
       which point this same branch simply no longer applies
  -> else:
       stamp closed_at = server time
       status = CLOSED
       close_reason = DRIVER_REQUESTED
       apply the selection-cleanup policy (see below)
```

This is a **rejected operation, not a hidden state transition** — there is no `close_requested_at`, no `PENDING_CLOSE` value, no row anywhere recording that a close was asked for. The `driver_shift` row is completely untouched by a rejected `ACTIVE_RIDE_PRESENT` close; the ride simply has to finish before this exact call can succeed. This is deliberately the simpler of the two options weighed for this contract (reject-and-let-the-caller-retry vs. server-records-an-obligation-and-self-completes-later) — it needs no new persisted state and no background trigger for the *driver-requested* path specifically. The **server-forced** path (below) is different — it self-completes without a client retry, because it is driven by a fact (the assignment's own confirmed terminal status) that is *already* durably recorded elsewhere, not by a remembered request.

- Locking discipline matches shift-open exactly — same lock, same order.
- The `CLOSED` row is retained as history; never deleted.
- The pinned `driver_id + vehicle_id + assignment_id` is never rewritten on close.
- **Selection cleanup policy, frozen, not a 01B choice:** a `DRIVER_REQUESTED` normal close **MUST NOT** clear `driver_active_vehicle`. `driver_active_vehicle` is the driver's mutable pre-shift *preference*, and finishing a normal shift does not make that preference stale — it is very likely still the exact same, still-usable assignment the driver just finished working, and the same one they will want to select again for their next shift. Closing a shift releases Assignment Authority Invariant 7's freeze (the driver may now select/switch/clear again) — it does **not**, by itself, trigger a write to `driver_active_vehicle` at all. Selection reset happens **only** under the already-frozen confirmed-assignment-`UNUSABLE` cleanup path ("Server-forced close", below) — never as a side effect of an ordinary `DRIVER_REQUESTED` close. Stated as the two outcomes side by side:

```text
DRIVER_REQUESTED close             confirmed ASSIGNMENT_UNUSABLE cleanup
  -> close shift                     -> close shift (when policy permits)
  -> preserve selection               -> reset the now-stale selection
     (driver_active_vehicle
      untouched by this operation)
```

This mirrors Assignment Authority's own staleness rule ("An `OPEN` shift exists — the mutable `driver_active_vehicle` row is no longer consulted as authority … the stale selection is reset to `NONE` inside the shift-close transaction if the assignment is still unusable at that point") — staleness, not shift-closure, is what triggers a reset, and a normal close is not a staleness event.

### Server-forced close (assignment invalidation)

This is **entirely inherited from Assignment Authority's already-frozen "An assignment becomes unusable during an `OPEN` shift" policy** — this document does not redefine it, only confirms the shift entity implements exactly what that section already specifies:

**Confirmed pinned-assignment `UNUSABLE`, no active ride:**
```text
block new work immediately
-> close shift (close_reason = ASSIGNMENT_UNUSABLE)
-> driver must not remain dispatch-eligible (OFFLINE, once Presence exists)
-> reset the stale driver_active_vehicle selection to NONE, as part of the
   same coordinated cleanup transaction — not a separate, racy follow-up write
```

**Confirmed pinned-assignment `UNUSABLE`, non-terminal active ride in progress:**
```text
block new work immediately
-> do NOT auto-abort the passenger ride
-> keep the OPEN shift / pinned tuple as ride identity + audit context
   (a retained pinned tuple does not imply the assignment is still usable)
-> after the ride reaches a terminal state (COMPLETED / CANCELED / NO_SHOW):
     close shift (close_reason = ASSIGNMENT_UNUSABLE)
     ensure OFFLINE / non-dispatchable
     reset the stale selection
   -- all three happen together, before the driver can re-enter matching/dispatch
```
Emergency interruption of an in-flight ride (e.g. a stolen-vehicle or acute-safety `REVOKED`) remains a **separate Safety policy** decision, out of scope here exactly as Assignment Authority already states — Shift Authority never, by itself, drops a passenger ride in progress.

**The eventual-cleanup trigger is a later runtime mechanism, not a new `driver_shift` state.** "After the ride reaches a terminal state" above describes an *outcome*, not a storage decision: whatever later mechanism actually notices the ride went terminal and performs the close+cleanup — a ride-status-transition event handler, a reconciliation worker, or a terminal-ride hook — is a **01B-or-later runtime choice**, explicitly **not** represented by any additional `driver_shift` column or lifecycle value in this contract (see the Data contract's "minimum schema" rule, above). The trigger can re-derive everything it needs from already-durable facts at the moment the ride terminates: the assignment's own confirmed `status`/`terminated_at` (already persisted, from Assignment Authority) and the ride's own terminal status (already persisted, from the existing ride-state chokepoint) — no memory of "a cleanup was scheduled" needs to be stored anywhere in between. If a future implementation instead wants a persistent, queryable "pending cleanup" marker (e.g. for an operator dashboard), that is a **new authority decision** and requires its own contract amendment, not a silent schema addition under this one.

**Pinned assignment `UNKNOWN` (transient):**
```text
fail closed for NEW work only
BUT do NOT close the shift
BUT do NOT reset the selection
BUT do NOT force a durable OFFLINE transition solely because of UNKNOWN
```
This is a direct restatement of Assignment Authority's `UNKNOWN` vs. confirmed `UNUSABLE` distinction, applied to the shift layer: `UNKNOWN` refuses forward progress but drives no durable shift-state change. Only a transition to a **confirmed** `UNUSABLE` triggers the policies above.

## `close_reason` vocabulary

Canonical set frozen by this document:

```text
DRIVER_REQUESTED      -- the driver asked to stop working (normal close)
ASSIGNMENT_UNUSABLE   -- server-forced close, the pinned assignment reached confirmed UNUSABLE
```

`close_reason` is **mandatory iff `status = CLOSED`** (a `CLOSED` row with `NULL` reason is invalid — a future DB-layer `CHECK (status = 'CLOSED') = (close_reason IS NOT NULL)`, mirroring Assignment Authority's own `active_iff_not_terminated` pattern).

**Not added in this slice, pending a concrete authoritative trigger:**

- `OPS_FORCED` — no existing frozen contract defines a direct Ops/safety force-close action distinct from an assignment reaching `REVOKED` (which already routes through `ASSIGNMENT_UNUSABLE`). If a future Safety policy needs to force-close a shift *without* first revoking the assignment, that policy must name its own reason and justify it there — not invented speculatively here.
- `COMPLIANCE_UNUSABLE` — the compliance contract's fail-closed rule governs **dispatch/ONLINE eligibility**, not shift closure; nothing audited requires compliance loss to close an otherwise-valid shift. If a future compliance policy decides otherwise, it must justify and add this reason explicitly.

The vocabulary is intentionally extensible (a `TEXT` column with a small, named set in 01B, not a hardcoded two-value enum) — new reasons may be added by a later, explicitly-scoped slice, never invented for UI convenience.

## Server time and immutable history

- `opened_at` and `closed_at` both come from the server/database clock — never a browser timestamp, never client-supplied.
- `CLOSED` is terminal; no row transitions back to `OPEN` (Invariant 7).
- The pinned `driver_id` / `vehicle_id` / `assignment_id` remain readable as historical audit context after the referenced assignment later `ENDED`/`REVOKED`s, or (per Assignment Authority) even after a hypothetical future vehicle/driver lifecycle change — this requires `ON DELETE RESTRICT` (not `CASCADE`) on **every** FK in the future 01B schema (the direct `driver_id`/`vehicle_id`/`assignment_id` references **and** the composite `(assignment_id, driver_id, vehicle_id)` FK — see "Referential integrity", above), mirroring `vehicle_driver_assignments`'s own choice of `RESTRICT` for the identical audit-integrity reason. **No cascading delete may erase shift history.**

## Presence boundary

The current Presence ADR (BD-DOCS-033) is `status: draft`, **not implemented**, and predates this authority chain — it is not edited here (explicitly out of scope: "Do not implement or rewrite Presence runtime in this slice").

This document supersedes the ADR's ambiguous "active vehicle" language with a precise definition, for future Presence work to consume:

```text
workingVehicleId = OPEN driver_shift.vehicle_id
```

Target invariants for a **future** Presence slice to enforce (not enforced here — no Presence runtime exists):

- `ONLINE => exactly one OPEN driver_shift` for that driver.
- `OPEN driver_shift != ONLINE` — a driver may hold an `OPEN` shift while temporarily `OFFLINE` (e.g. between location-permission hiccups, app backgrounded, heartbeat lapsed) without that alone closing the shift.
- Presence TTL expiry (per the ADR's own heartbeat design) may flip a driver to `OFFLINE`, but **must not implicitly mutate `driver_shift` history** — no auto-close, no `close_reason` synthesis — unless a later, explicitly-scoped Availability policy defines that behavior and names its own trigger/reason. This is an **open question**, deliberately deferred (see below), not resolved by silence.
- `online_busy` remains derived from `RIDE_STATUS` (non-terminal), exactly as the ADR already proposes — never a `driver_shift` field.

**Follow-up docs-sync note (not performed in this gate):** the Presence ADR's Context section ("Presence is keyed to … the active vehicle (the garage vehicle in use)") should eventually be revised to say "the `OPEN driver_shift`'s pinned vehicle" once a Presence implementation slice is scoped — flagged here, left untouched now, per this gate's explicit boundary.

## Compliance boundary

Critical for the eventual rebuild of Draft PR #956 (`BD-DRIVER-DOCUMENT-COMPLIANCE-01B`, superseded, per Assignment Authority's own PR-956 relationship note).

Ordering, frozen:

```text
shift-open        does NOT require a pre-existing shift-bound WAYBILL/MEDICAL_CHECK
                    (nothing can be shift-bound before a shift_id exists)
     │
     ▼
OPEN driver_shift  creates the authoritative shift identity (this document)
     │
     ▼
shift-specific     WAYBILL / MEDICAL_CHECK evidence can now bind to a REAL
compliance         shift_id — the exact context shape docs/driver-document-
evidence           compliance-contract.md already expects: { driverId,
                    activeVehicleId, shiftId }
     │
     ▼
ONLINE /           MAY later require a compliance verdict for THIS OPEN shift
dispatch           (compliance contract's own fail-closed rule already states
eligibility        this: no OPEN shift => never complianceReady: true)
```

Long-lived driver/vehicle prerequisites that are already authoritative independent of any specific shift (e.g. a vehicle's registration documents, a driver's license) may still be checked separately and are not blocked by this ordering — only **shift-scoped** evidence (`WAYBILL`, `MEDICAL_CHECK`, per the compliance contract's subject-scope table) is what cannot exist before `shift_id` does.

**Explicit conflict call-out, per instruction:** the legacy client fields `shiftOpen` / `waybillOpen` / `medicalCheckPassed` / `shiftDocsReady` (`public/src/state.js`) are **profile-level, not shift-instance-scoped** — a single boolean per driver, not per `shift_id`. They predate both this contract and the compliance contract's shift-scoped model, and must never be read as satisfying either. Reconciling or retiring them is explicitly **out of scope for 01A** (no PWA change, per non-goals) and is left as follow-up docs/PWA-sync work, not resolved by silence.

## Dispatcher boundary

No Matching/Dispatcher runtime in this slice. The following **future invariant** is frozen for later consumption only:

A driver is eligible for new matching only if **all** of the following hold:

```text
OPEN authoritative shift
+ the shift's pinned assignment remains USABLE
+ Presence ONLINE / free
+ compliance ready (for this exact shift_id)
+ no non-terminal ride (or an availability policy explicitly permitting queued work)
```

The pinned assignment is re-checked at the same two points Assignment Authority already froze — reused verbatim, not redefined:

- before the driver is added to a matching candidate set;
- immediately before a final order is assigned.

## Data / source-of-truth table

| Data / state | Stored where | Writer | Reader | Authority |
| --- | --- | --- | --- | --- |
| Shift identity (`id`) | PostgreSQL `driver_shift` (future 01B) | Backend API, at shift-open, server-generated | Driver App (own shift), Safety & Compliance, Dispatcher, Ops | Server |
| Shift status (`OPEN`/`CLOSED`) | PostgreSQL `driver_shift` | Backend API, transactionally (open/close) | same as above | Server |
| Pinned `driver_id` | PostgreSQL `driver_shift` | Backend API, at open, from the authenticated session | Safety & Compliance, Dispatcher, Ops | Server |
| Pinned `vehicle_id` | PostgreSQL `driver_shift` | Backend API, at open, derived from the locked assignment | same as above | Server |
| Pinned `assignment_id` | PostgreSQL `driver_shift` | Backend API, at open, from the re-read selection under lock | same as above | Server |
| `opened_at` | PostgreSQL `driver_shift` | Backend API, server clock | Driver App, Ops, audit | Server |
| `closed_at` | PostgreSQL `driver_shift` | Backend API, server clock | same as above | Server |
| `close_reason` | PostgreSQL `driver_shift` | Backend API, at close (driver-requested or server-forced) | Driver App, Ops, audit | Server |
| Current selection | PostgreSQL `driver_active_vehicle` (existing, 0005) | Backend API, driver's own request | Driver App, shift-open | Server |
| Assignment usability | Computed (`vehicle_driver_assignments` + future block-state source) | n/a (derived) | shift-open, mid-shift invalidation, matching, dispatch | Server |
| Presence ONLINE/OFFLINE | Future cache tier (BD-DOCS-033, not built) | Future heartbeat service | Dispatcher, Ops (future) | Server, once built — **not this slice** |
| Ride busy/free | `rides.status` (existing, `RIDE_STATUS`) | Ride-state chokepoint (existing) | Shift/Presence/Dispatcher (derivation only) | Server (existing, unchanged) |
| Compliance readiness | Future compliance projection, keyed by `shiftId` (`docs/driver-document-compliance-contract.md`) | Future compliance service | Dispatcher, Ops (future) | Server, once built — **not this slice** |

## Operations contract (conceptual — no HTTP route committed)

### `openDriverShift(driverId)`

- **Authenticated principal:** the driver themselves, resolved server-side (`plugins/auth.js` `resolveUser()`), never a request parameter.
- **Authoritative inputs:** none beyond the authenticated `driverId` — everything else (selection, assignment, vehicle) is server-re-read under the lock.
- **Ignored/untrusted client fields:** `vehicleId`, `assignmentId`, any cached selection, `vehicles.is_active`, any `localStorage` mirror.
- **Locks:** `lockDriverAuthority(driverId)` → the selected assignment row → the vehicle row, in that order.
- **Reads:** `driver_active_vehicle` (under lock), the locked assignment's usability, any `OPEN` shift for this driver or this vehicle, the driver's non-terminal-ride state.
- **Writes:** one `INSERT` into `driver_shift` (`OPEN`).
- **State transition:** `NONE → OPEN`.
- **Idempotency/conflict:** re-issuing the same request while already `OPEN` on the same pinned tuple is a no-op success (return the existing shift); a genuinely conflicting concurrent request (different assignment/vehicle) loses to whichever committed first, surfaced as a `409`-class error, not a silent overwrite.
- **Error classes — `UNUSABLE` and `UNKNOWN` are never one class.** Grouping them under a shared "retryable" description (as an earlier draft of this contract did) collapses a genuine dependency-outage retry with a settled business-authority denial — exactly the confusion this section exists to prevent. Three distinct classes, not two:
  - `400`-class for "no selection".
  - `403`/data-integrity class for "assignment belongs to another driver" (should be unreachable given the FK).
  - `409`-class for "already OPEN" / `DRIVER_SHIFT_ALREADY_OPEN` / `VEHICLE_SHIFT_ALREADY_OPEN` / "non-terminal ride blocks this" (`ACTIVE_RIDE_PRESENT`) — business/authority conflicts, not dependency failures.
  - `503`-class, genuinely retryable, for `ASSIGNMENT_STATE_UNKNOWN` — the authoritative dependency (the block-state source) could not be determined; retrying the identical call later may succeed once that dependency answers. Fails closed for forward progress in the meantime; drives no durable shift mutation on its own (Invariant, "UNKNOWN policy").
  - `409`-class, `ASSIGNMENT_UNUSABLE(reason)`, for a **confirmed** authoritative negative — never a dependency-UNKNOWN failure, and never grouped with one. `reason` is **not** uniformly retryable:
    - **non-retryable as-is for this exact assignment** — `ENDED`, `REVOKED`, elapsed `ends_at`, `ARCHIVED`. The identical call will never succeed for this `assignment_id`; the caller needs a different, usable entitlement/selection, not a retry loop.
    - **reason-specific future eligibility, not an immediate generic retry** — `BEFORE_START` (may become usable once `starts_at` is reached — a specific future instant, not "try again now"), `BLOCKED` (may become usable only after the authoritative block state changes — an event, not a timer). Both are confirmed negatives *right now*; neither is describable as "just retry."
- **Retryable vs terminal, precisely:** genuinely retryable = `ASSIGNMENT_STATE_UNKNOWN` and lock-contention outcomes only. Terminal-for-this-assignment (a new entitlement/selection is required, not a retry of the same call) = `ENDED`/`REVOKED`/elapsed/`ARCHIVED`. Reason-specific-future-eligibility (neither "retry now" nor "terminal forever") = `BEFORE_START`/`BLOCKED`. A future 01B service must preserve this three-way split in whatever HTTP/error shape it picks — the exact codes above are illustrative, the three-way distinction is frozen.

### `closeDriverShift(driverId)`

- **Authenticated principal:** the driver themselves (driver-requested path) — a server-forced close is initiated by the invalidation policy, not a driver-facing call, and carries its own internal actor (the pinned-assignment invalidation trigger, not a request principal).
- **Authoritative inputs:** none beyond `driverId` — the exact `OPEN` shift is located server-side, not passed by the client.
- **Ignored/untrusted client fields:** any client-supplied `shiftId`, `closeReason`, or timestamp.
- **Locks:** `lockDriverAuthority(driverId)` → the shift row.
- **Reads:** the driver's `OPEN` shift, the driver's non-terminal-ride state.
- **Writes:** for a `DRIVER_REQUESTED` close, one `UPDATE` on `driver_shift` (`status`, `closed_at`, `close_reason`) — `driver_active_vehicle` is **never** written by this path (see "Selection cleanup policy, frozen"). Zero writes for a rejected `ACTIVE_RIDE_PRESENT` call — the row is untouched.
- **State transition:** `OPEN → CLOSED`, or **no transition at all** (`ACTIVE_RIDE_PRESENT` rejection) — there is no third, in-between persisted state.
- **Idempotency/conflict:** closing an already-`CLOSED` shift is a no-op (matches the `terminateAssignment` "double-terminate is a no-op" convention already established for `vehicle_driver_assignments`). Calling close twice while a ride is non-terminal returns the same `ACTIVE_RIDE_PRESENT` rejection both times — also idempotent, just idempotently rejected.
- **Error classes:** `404`-class `NO_OPEN_SHIFT` if no `OPEN` shift exists for this driver; `409`-class `ACTIVE_RIDE_PRESENT` if a non-terminal ride blocks the close.
- **Retryable vs terminal:** `ACTIVE_RIDE_PRESENT` **is** retryable — but only meaningfully after the ride terminates (retrying immediately just returns the identical rejection); it is not a dependency-UNKNOWN-style "try again soon", it is "this exact precondition will stop holding at a specific future event." `NO_OPEN_SHIFT` is terminal for the call (there is nothing to close).

### `getOpenDriverShift(driverId)`

- **Authenticated principal:** the driver (own shift) or an Ops/Safety/Dispatcher principal (any driver's shift, for their own authorized purposes — authorization model for the latter is a 01C-or-later concern).
- **Reads only:** no lock required for a plain read (a caller about to *act* on the result takes its own lock via `openDriverShift`/`closeDriverShift`).
- **Returns:** the `OPEN` row if one exists, else an explicit "no open shift" result — never inferred from `driver_active_vehicle` or `vehicles.is_active`.

## `BD-DRIVER-SHIFT-AUTHORITY-01B` — expected next runtime slice

Scope only (not implemented now):

1. PostgreSQL `driver_shift` schema — the table; a new `UNIQUE (id, driver_id, vehicle_id)` on `vehicle_driver_assignments` (additive, zero-risk given the existing PK); `driver_shift`'s composite FK `(assignment_id, driver_id, vehicle_id) → vehicle_driver_assignments (id, driver_id, vehicle_id)` plus its direct `users`/`vehicles` FKs, all `RESTRICT`; the two named partial unique indexes (`driver_shift_one_open_per_driver_uq` / `driver_shift_one_open_per_vehicle_uq`, `WHERE status = 'OPEN'`); the lifecycle CHECK from "Lifecycle state invariants" (`OPEN`⇒timestamps/reason-null, `CLOSED`⇒timestamps/reason-set **and** `closed_at >= opened_at`); `updated_at` trigger.
2. Repository primitives — `openShift` / `closeShift` / `getOpenShiftForDriver` / `getOpenShiftForVehicle`, composing the existing `lockDriverAuthority` + `vehicle_driver_assignments` primitives exactly per the opening/closing transactions above.
3. Transactional open/close service primitives, or a dark seam mirroring `services/driver-vehicle-assignment-authority/index.js`'s own pattern (plain re-export, not a Fastify plugin, not wired into `SERVICES`) — **no public/live Driver App route unless separately authorized.**
4. Readiness/schema assertions in `infra/db.js` and `server-ci.yml`, following the exact structural (not just `to_regclass`) pattern Assignment Authority already established.
5. Real PostgreSQL concurrency tests — the exclusivity partial-unique-index race (two drivers, one vehicle, concurrent open), the per-driver-lock serialization test (reusing the exact test shape already proven for `lockDriverAuthority`), and the deferred-close-vs-active-ride interaction.

## 01A non-goals

This slice does not add:

- DB migration (no `driver_shift` table is created here)
- backend route / runtime / API
- shift runtime of any kind
- Presence runtime, heartbeat, cache/Redis
- Driver App change
- Passenger App change
- Matching / Dispatcher runtime
- Driver Document Compliance runtime
- upload / storage
- Telegram / push
- Service Worker change
- CSP change
- Mapbox
- payment
- any Project metadata change
- any edit to `docs/driver-vehicle-assignment-authority-contract.md`, `docs/driver-document-compliance-contract.md`, or `docs-site/docs/decisions/presence-heartbeat.md` (no contradiction was found requiring one — see audit matrix)

## Concurrency / race matrix

| Race | Scenario | Expected outcome | Mechanism |
| --- | --- | --- | --- |
| A | Driver switches selection while shift-open begins | Same stable per-driver lock serializes both; the shift pins whichever selection is current **after** the lock is acquired, from its own re-read | `lockDriverAuthority` shared by both operations (Invariant 2) |
| B | Two drivers with valid entitlement select the same vehicle and open shift concurrently | Only one `OPEN` shift wins vehicle exclusivity, deterministically (whoever locks the vehicle row first); the loser gets domain `VEHICLE_SHIFT_ALREADY_OPEN`, selection left intact | The **vehicle-row lock** is the actual cross-driver serialization point (the two drivers' per-driver locks are on different rows and never serialize against each other — see "Exclusivity — Lock roles, kept distinct"); `driver_shift_one_open_per_vehicle_uq` (partial unique index) is the DB-integrity backstop and the source of the `VEHICLE_SHIFT_ALREADY_OPEN` translation if the race window is ever hit despite the lock |
| C | Assignment is revoked during shift-open | Locking/recheck ordering cannot create a shift from stale usable state — the assignment-row lock (`lockAssignmentForEntitlementCheck`) is held before the usability assert; whichever of {shift-open, revoke} locks the row first wins, the other observes the committed result | Row-level lock on `vehicle_driver_assignments`, independent of the per-driver lock (empirically proven in the #962 independent review's adversarial test #11: a concurrent revoke genuinely blocks on a held assignment-row lock and unblocks correctly after release) |
| D | Driver requests close while ride is non-terminal | Ride is not orphaned or auto-aborted — the close call is **rejected** (`ACTIVE_RIDE_PRESENT`, zero writes, no persisted pending state); the shift stays `OPEN` and fully authoritative; the caller retries the same call after the ride terminates | Reject-and-retry policy ("Closing a shift — Driver-requested"), deliberately not a server-recorded obligation |
| E | Assignment becomes `UNUSABLE` during an active ride | No new orders; current ride preserved; deferred close after the ride reaches a terminal state | Server-forced close policy (identical to Assignment Authority's mid-shift invalidation, non-terminal-ride branch) |
| F | Vehicle-block source becomes `UNKNOWN` | No new forward progress (shift-open refused, matching/dispatch exclude the driver) but no durable close/reset solely from `UNKNOWN` | `UNKNOWN` vs. confirmed `UNUSABLE` distinction, applied identically to the shift layer |
| G | Presence TTL expires while shift is `OPEN` | Presence may go `OFFLINE`; shift lifecycle does not silently mutate — no auto-close, no reason synthesis | Presence boundary (explicit open question, deferred to a future Availability policy) |
| H | Shift opens, then `WAYBILL`/`MEDICAL_CHECK` evidence is created | Documents bind to the newly-created real `shift_id`; no circular prerequisite, since shift-open never required pre-existing shift-bound evidence | Compliance boundary ordering (shift authority precedes shift-bound compliance) |

## Unresolved architecture questions (explicitly deferred, not resolved by silence)

1. **Presence-TTL-expiry-vs-shift-close policy** (Race G): does a *prolonged* `OFFLINE` (analogous to Assignment Authority's own deferred "prolonged `UNKNOWN` escalation" open question) ever force-close a shift, and if so, after how long, and under whose authority (Availability, Ops)? Not decided here — a future Availability policy slice must define its own trigger and its own `close_reason` if it decides yes.
2. **Eventual-cleanup trigger mechanism (server-forced path only).** This document fixes the *outcome* — after a non-terminal ride tied to a confirmed-`UNUSABLE` pinned assignment reaches a terminal state, the shift must close and the selection must reset (see "Server-forced close") — but not *which runtime component* notices the ride went terminal and performs that close (an event handler, a reconciliation worker, or a terminal-ride hook are all compatible; the trigger re-derives everything it needs from already-durable facts, no new `driver_shift` state is implied — see "The eventual-cleanup trigger is a later runtime mechanism", above). This is genuinely safe to defer: it re-derives from data that already exists. **Resolved, not deferred:** the driver-requested close during an active ride is no longer an open question in this document — it is a plain rejection (`ACTIVE_RIDE_PRESENT`, no persisted state, client retries), settled above.
3. **Authorization model for Ops/Safety reading or acting on another driver's shift** (`getOpenDriverShift` for a non-owner principal) — flagged in the operations contract, not specified here; likely inherited from whatever Ops-authority model Assignment Authority's "Who may create an assignment" table implies, but not restated as frozen.
4. **`OPS_FORCED` / `COMPLIANCE_UNUSABLE` close reasons** — explicitly not added pending a concrete authoritative trigger (see "`close_reason` vocabulary").
