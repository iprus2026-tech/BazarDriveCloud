# BD-DRIVER-VEHICLE-BLOCK-STATE-AUTHORITY-01A

Status: contract-first / docs-only

Issue: #973

Architecture: Safety & Compliance / Driver Availability / Backend authority / DB contract —
prerequisite for: Assignment usability (operational half) → Driver Shift Authority → Live
Shift API → Presence → Dispatcher

## Why this slice exists

This contract was prepared audit-first from exact
`main@10731609a05bfe099fd1ce92e8eb3b161e1209c2`. An untracked working draft was produced
first and passed an independent architectural review (`REVIEW_CLEAN — P0=0, P1=0, P2=0`,
with three P3 hardenings applied before commit); a subsequent freeze gate then created
tracking **Issue #973**, the branch `docs/bd-driver-vehicle-block-state-authority-01a`, the
tracked commit of this file, and **Draft PR #974**. Those Git/GitHub actions are **process
provenance only** — they record how the document was produced and do not change any frozen
architectural decision in it. This mirrors how
`BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01A` (Issue #959 / PR #960) and
`BD-DRIVER-SHIFT-AUTHORITY-01A` (Issue #966 / PR #967) were each hardened as an untracked
draft before their own Issue existed.

This pass is an **independent redo** of an earlier untracked 01A draft
(`.../BazarDriveCloud-block-state-01a-audit/docs/driver-vehicle-block-state-authority-contract.md`,
SHA-256 `11a2e4b8…c09c064`) that an independent review returned **REVIEW_BLOCKED** on. Every
decision below is re-derived from the audited sources; the prior review's **P2-1** and four
**P3** findings are each resolved in the new text (see "Resolution of the prior review" at
the end).

`docs/driver-vehicle-assignment-authority-contract.md` (frozen) defines the *operational
half* of assignment usability as:

```text
vehicleOperationalAt(t) = vehicle.archived == false AND vehicleBlockState(t) == UNBLOCKED
```

with `vehicleBlockState(t)` three-valued (`UNBLOCKED` / `BLOCKED` / `UNKNOWN`) — but it
**explicitly defers storage**:

> "Where the block state is physically stored (a column on `vehicles`, a separate table, an
> external service) is a runtime / DB decision this contract does not fix."
> "A future 'blocked' state (safety hold, ownership dispute, stolen) is a separate flag the
> runtime slice may add; this contract refers to both together as **archived/blocked**."

`docs/driver-shift-authority-contract.md` (frozen) then builds shift-open preconditions
**#8 (`BLOCKED` → `UNUSABLE`)** and **#9 (`UNKNOWN` → retryable fail-closed, zero durable
writes)** directly on that deferred concept, and `server/src/domain/assignment-usability.js`
codes it as an **injected resolver** `resolveVehicleBlockState(vehicleId, client)` whose only
implementation today, `defaultResolveVehicleBlockState`, **always returns `'UNKNOWN'`** — its
header saying, verbatim, "there is no authoritative block-state resolver wired in yet".

**Consequence surfaced by `BD-DRIVER-SHIFT-AUTHORITY-01C-B`** (the Live Shift API, on HOLD at
`6dba8ff`, branch `feat/bd-driver-shift-authority-01c-b`, not merged): with no real resolver,
**every** otherwise-valid shift-open resolves to `ASSIGNMENT_STATE_UNKNOWN` — correct
fail-closed behaviour, but a live-blocking gap. This is an **architectural prerequisite**,
not an HTTP-adapter defect. Dependency chain:

```
selection authority → shift authority → vehicle operational block-state authority (THIS)
                    → Live Shift API → Presence ONLINE → Dispatcher
```

This contract fills exactly the storage/authority gap the Assignment Authority contract
deferred. **It extends the frozen contracts — it does not contradict or restate them.** Every
quote marked "frozen" is carried forward verbatim, not reinvented.

## Existing anchors and audit (independent, read-only)

### Files read in full for this audit

- `server/src/domain/assignment-usability.js`
- `server/src/domain/vehicle-assignment.js`
- `server/src/repositories/vehicles.js`
- `server/src/services/driver-shift-authority/index.js`
- `server/src/services/driver-vehicle-assignment-authority/index.js`
- `server/src/infra/db.js` (`ready()`)
- `docs/driver-vehicle-assignment-authority-contract.md`
- `docs/driver-shift-authority-contract.md`
- `docs/driver-document-compliance-contract.md`
- `server/migrations/0001_phase1_init.sql` (`vehicles`), `0005`, `0006`, `0007`
- `.github/workflows/server-ci.yml`
- `docs-site/docs/decisions/{safety-compliance,presence-heartbeat,dispatch-matching}.md`

### What already exists and is frozen

- **`docs/driver-vehicle-assignment-authority-contract.md`** (Issue #959, PR #960, merged) —
  freezes `ownership ≠ entitlement ≠ selection ≠ working`, the `assignmentUsableAt(t)` /
  `assignmentUsabilityDecision(t)` predicates, the three-value `vehicleBlockState(t)`,
  `vehicleOperationalAt(t)` true **only** for `UNBLOCKED`, the precedence
  **confirmed negative > `UNKNOWN` > positive**, the short-circuit ordering (cheap
  authoritative-local facts first, the block source last), and the "`UNKNOWN` vs. confirmed
  `UNUSABLE`" durable-state rule ("`UNKNOWN` must not, on its own, close a shift, set
  `OFFLINE`, or reset the selection"). It fixes neither where `vehicleBlockState(t)` reads
  from nor who writes it — that is this contract's whole job.
- **`docs/driver-shift-authority-contract.md`** (Issue #966, PR #967, merged) — the
  "Critical usability seam", shift-open precondition **#8** (`BLOCKED` → `UNUSABLE`, terminal
  for this vehicle) and **#9** (`UNKNOWN` → reject, **retryable fail-closed, no partial
  `OPEN` row is ever created on `UNKNOWN`**), Invariant 4 "confirmed `UNUSABLE` dominates
  `UNKNOWN`", the server-forced-close policy that fires only on a **confirmed** `UNUSABLE`
  (never on transient `UNKNOWN`), and `close_reason ∈ {DRIVER_REQUESTED, ASSIGNMENT_UNUSABLE}`
  with `OPS_FORCED` / `COMPLIANCE_UNUSABLE` explicitly deferred "pending a concrete
  authoritative trigger". Its "Unresolved architecture question #2" leaves the
  server-forced-close *eventual-cleanup trigger mechanism* open (an event handler, a
  reconciliation worker, or a terminal-ride hook are all compatible).
- **`server/src/domain/assignment-usability.js`** (merged, BD-DRIVER-SHIFT-AUTHORITY-01C-A) —
  the shared `decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState })`,
  `classifyEntitlementUnusableReason`, and `defaultResolveVehicleBlockState`. **Resolver
  signature, frozen by code:**
  `resolveVehicleBlockState(vehicleId, client) → Promise<'UNBLOCKED' | 'BLOCKED' | 'UNKNOWN'>`.
  Exact flow: entitlement-negative → `UNUSABLE(reason)`; else `vehicle.archived` →
  `UNUSABLE('ARCHIVED')`; else call the resolver — a **throw** is caught ⇒ `blockState =
  'UNKNOWN'`; `'BLOCKED'` ⇒ `UNUSABLE('BLOCKED')`; **any value that is not exactly
  `'UNBLOCKED'`** ⇒ decision `UNKNOWN` (fail closed); `'UNBLOCKED'` ⇒ `USABLE`.
- **`server/src/services/driver-shift-authority/index.js`** — `openDriverShift`,
  `closeDriverShift`, `getOpenDriverShift`, `reconcileAssignmentUnusableShift`. Each mutating
  op runs `db.tx → lockDriverAuthority(driverId) [users(id) FOR UPDATE] → readSelection →
  lockAssignmentForEntitlementCheck → derive vehicle_id from the LOCKED assignment →
  lockVehicleById(vehicleId) [SELECT * FROM vehicles WHERE id=$1 FOR UPDATE] →
  decideAssignmentUsability(client, { …, resolveVehicleBlockState })`. `openDriverShift`
  defaults `resolveVehicleBlockState = defaultResolveVehicleBlockState` when `opts` omits it.
  `reconcileAssignmentUnusableShift` also defaults it, does an **unlocked seed read**
  (`findShiftById`) then re-locks in the global order (driver → assignment → vehicle → shift
  row) and acts only on a **confirmed `UNUSABLE`** (`NOT_CONFIRMED_UNUSABLE` otherwise;
  `DEFERRED_ACTIVE_RIDE_PRESENT` if a non-terminal ride is in flight; else
  `CLOSED_AND_CLEANED` with `close_reason='ASSIGNMENT_UNUSABLE'` + a scoped selection clear).
- **`server/src/services/driver-vehicle-assignment-authority/index.js`** —
  `setDriverSelection` (select / switch) and `clearDriverSelection`. `setDriverSelection`
  runs the same seam under the same lock order; `clear` has **no** usability check and is
  unaffected by block-state. `SELECTED(A) → SELECTED(A)` is a pre-guard no-op that never
  reaches the resolver.
- **`server/src/repositories/vehicles.js`** `lockVehicleById(db, vehicleId)` —
  `SELECT * FROM vehicles WHERE id = $1 FOR UPDATE`; documented as "the shift-open sequence's
  shared cross-driver serialization point". Header states `is_active` must never be read as
  authority and the module "adds no vehicle-runtime primitives beyond the one lock".
- **`server/src/infra/db.js` `ready()`** — a single structural `SELECT` asserting, per
  migration, load-bearing **columns + named constraints + named partial indexes + named
  triggers** (not bare `to_regclass`) for `notification_outbox`, `ride_events`,
  `vehicle_driver_assignments`, `driver_active_vehicle`, `driver_shift`,
  `driver_document_lineages`, `driver_documents`, plus the additive composite keys. Returns
  `rows[0].ok === true`. `/readyz` returns `{status:'degraded', db:'schema-incomplete'}` /
  `503` when it fails.
- **`.github/workflows/server-ci.yml`** — `migrations` job applies `server/migrations/*.sql`
  in sorted order under `ON_ERROR_STOP=1`, **twice** (idempotency), then asserts every
  load-bearing object **by name**; `app` job runs `npm audit --omit=dev --audit-level=high`,
  proves `/readyz` is `schema-incomplete` on 0001–0006 then `ready` after `npm run migrate`,
  runs `npm test`, and a container liveness smoke.
- **`server/migrations/0005` / `0006` / `0007`** — the established conventions a future `01B`
  follows: `gen_random_uuid()` PK; `ON DELETE RESTRICT` on every FK carrying history; **named**
  `CHECK` constraints (`*_lifecycle_check`, `*_active_iff_not_terminated`,
  `*_close_reason_check`); actor-XOR (`(x IS NOT NULL) <> (y IS NOT NULL)`); a
  `GENERATED ALWAYS … STORED` range column + GiST `EXCLUDE` **only** where a time-range
  non-overlap invariant exists (0005's `entitlement_window`); **partial unique indexes for
  static row-count invariants over a static predicate** (0006's
  `driver_shift_one_open_per_{driver,vehicle}_uq WHERE status='OPEN'`); a
  `*_guard_immutability()` `BEFORE UPDATE` trigger whose name sorts before `*_updated_at` so
  it runs first ("terminal cannot reopen / pinned fields cannot mutate"); a `set_updated_at()`
  trigger; idempotent `CREATE … IF NOT EXISTS` + `DROP TRIGGER IF EXISTS` + `DO`-block
  constraint guards; the whole file wrapped in `BEGIN/COMMIT`.
- **`vehicles` table** (`server/migrations/0001_phase1_init.sql`) — `id`,
  `owner_user_id → users(id) ON DELETE CASCADE`, `legacy_id`, `model`, `color`, `plate`,
  `source`, **`archived BOOLEAN NOT NULL DEFAULT FALSE`** (BD-PROFILE-D-05I soft-delete),
  `restored_from_archive`, **`is_active BOOLEAN NOT NULL DEFAULT FALSE`** (+ partial unique
  index `uq_vehicles_one_active ON vehicles(owner_user_id) WHERE is_active`; plus
  `idx_vehicles_owner`, `idx_vehicles_owner_active_list`), `created_at`, `updated_at`,
  trigger `trg_vehicles_updated_at`. **No block-state column of any kind.**
- **`docs/driver-document-compliance-contract.md`** (Issue #953, PR #954, merged) — the
  compliance verdict for `{ driverId, activeVehicleId, shiftId }`; the roll-up
  `documentsReady = ready(DRIVER_LICENSE) && ready(TAXI_OSAGO) && ready(TAXI_REGISTRY)`,
  `shiftReady = ready(WAYBILL) && ready(MEDICAL_CHECK)`,
  `complianceReady = documentsReady && shiftReady`; the one-way invariant
  `driver ONLINE ⇒ server complianceReady == true`. Compliance is a **separate AND-term**
  from vehicle operational block-state (see "Separation from Driver Document Compliance").
- **`docs-site/docs/decisions/safety-compliance.md`** (`id: BD-DOCS-037`, `status: draft`,
  **not implemented**) — §Decision-4 proposes "risk scoring, **blocks/bans**, and trust
  gates **keyed to identity** (BD-DOCS-032)", enforced at going-online / accept-assign /
  order-placement. This is a **per-user identity** block — a different entity from a
  per-vehicle operational block (see "Core separation").
- **`docs-site/docs/decisions/presence-heartbeat.md`** (`BD-DOCS-033`, `status: draft`) —
  keys presence to "the active vehicle (the garage vehicle in use)"; a known stale-wording
  docs-sync item already flagged by the Assignment and Shift contracts. Untouched here.
- **`docs-site/docs/decisions/dispatch-matching.md`** (`BD-DOCS-035`, `status: draft`) —
  candidate-set + final-assignment gates; a future consumer of this verdict. Untouched here.

### Confirmed: the production-default resolver is fail-closed `UNKNOWN`, and there is no physical block-state source

- **`defaultResolveVehicleBlockState(_vehicleId, _client)` always `return 'UNKNOWN'`** —
  a two-line function; no query, no table. Its own header: "The default implementation always
  returns 'UNKNOWN' (there is no authoritative block-state resolver wired in yet)".
- **Both consumer services default to it** — `openDriverShift`, `reconcileAssignmentUnusableShift`,
  and `setDriverSelection` each read `const { resolveVehicleBlockState = defaultResolveVehicleBlockState } = opts`.
  Nothing in `server/src/**` (grep) ever passes a non-default resolver in production; only
  `server/test/*.mjs` inject `async () => 'UNBLOCKED'` / `'BLOCKED'` / `async () => { throw … }`.
- **`server/src/domain/vehicle-assignment.js`** — the pure `assignmentEntitledAt(t)` mirror —
  covers the **entitlement half only**; its header states the operational half "is explicitly
  out of scope for 01B … Composing the full tri-state assignmentUsabilityDecision(t) …
  belongs to a later slice, once a block-state source exists — this file must not be read as
  already implementing it."
- **Grep across `server/**`, `docs/**`, `docs-site/docs/**`** for
  `vehicleBlockState | vehicle[_ -]?block | block[_ -]?state | resolveVehicleBlockState |
  safety[_ -]?hold | stolen | impound | seiz | ownership dispute | blocklist |
  STOLEN_REPORTED | REGULATORY_HOLD | SAFETY_HOLD` returns **only**: the injected-resolver
  plumbing in `assignment-usability.js`, the two consumer services + their tests (stubbing
  `'UNBLOCKED'` / `'BLOCKED'`), `vehicle_driver_assignments.js` / `rides.js` /
  `vehicle-assignment.js` incidental "blocked" prose, `0005`'s header note that
  "vehicleBlockState physical storage" is out of scope, the deferral notes in the
  Assignment / Shift contracts, and `docs-site/docs/decisions/safety-compliance.md:93`
  ("blocks/bans … keyed to identity"). **There is no safety-hold, stolen-vehicle, impound,
  ownership-dispute, or vehicle-block entity anywhere** — no table, no column, no
  repository, no route, no service, no migration, no ADR. Migrations stop at `0007`; there
  is no `0008`.

**Conclusion of fact-finding:** the production `vehicleBlockState(t)` seam is, today,
uniformly fail-closed `UNKNOWN`, and no authoritative operational block-state source exists
in the database or anywhere else in the repository.

### Audit matrix — every block-state-adjacent surface

| Concept | Current source | Current authority | Target authority | Drift / conflict |
| --- | --- | --- | --- | --- |
| Ownership | `vehicles.owner_user_id` | Server (PostgreSQL, since 0001) | unchanged | none |
| Entitlement | `vehicle_driver_assignments` (`status` / `starts_at` / `ends_at`) | Server (PostgreSQL, since 0005) | unchanged | none |
| Selection (pre-shift preference) | `driver_active_vehicle` | Server (PostgreSQL, since 0005) | unchanged | none |
| Working / open shift | `OPEN driver_shift` (pins `driver_id` + `vehicle_id` + `assignment_id`) | Server (PostgreSQL, since 0006) | unchanged | none |
| Vehicle **archived** (withdrawn from use / soft-delete) | `vehicles.archived` | Server (PostgreSQL, since 0001; written by a future garage-CRUD slice) | unchanged — **stays a distinct confirmed-negative, checked *before* the resolver** | none; must **not** be collapsed into block-state, and must **not** be modelled as a value of `vehicleBlockState(t)` (see "The three-value model, precisely") |
| Vehicle **operational block-state** (safety hold / ownership dispute / stolen / regulatory hold) | **none** — `defaultResolveVehicleBlockState()` hard-codes `'UNKNOWN'`; no table, no column, no service, no migration | **absent** | **`vehicle_operational_block` table (this document), read live under the existing `vehicles`-row `FOR UPDATE` lock** | this is the gap this slice closes |
| `vehicles.is_active` | owner-scoped client mirror of `driverGarage.activeVehicleId` (+ `uq_vehicles_one_active`) | **Client** (legacy / derived) | unchanged — **legacy / derived only, never block authority** | naming-adjacency only; frozen out of all backend authority by the Assignment Authority contract |
| Identity trust-block / ban (per-**user**) | none (proposed BD-DOCS-037 §4, `status: draft`, not built), keyed to `users(id)` | **absent** | a **separate** identity-keyed concept — **not** this contract | adjacency only — a *driver/user* block ≠ a *vehicle* operational block; one safety event may trigger both, via different entities / write paths |
| Ride occupancy (busy / free) | `rides.status` (`RIDE_STATUS`, non-terminal) | Server (existing ride-state chokepoint) | unchanged | none — never a `vehicle_operational_block` field |
| Presence `ONLINE` / `OFFLINE` | proposed (BD-DOCS-033, `status: draft`, not built) | absent | future Presence slice; **consumes** this verdict, does not own it | none — Presence ADR predates the authority chain; its "active vehicle" wording is a known docs-sync item, untouched here |
| Matching / dispatch gates | proposed (BD-DOCS-035, `status: draft`, not built) | absent | future consumer of `vehicleBlockState(t)` at the two frozen re-check points | none |
| `vehicleBlockState(t)` reachability model | injected resolver, default `'UNKNOWN'` | fail-closed by default | **co-located PostgreSQL read on the caller's txn client** ⇒ `UNKNOWN` becomes a genuine (rare) DB-error condition, not a routine dependency-down state | resolves the "why is everything `UNKNOWN`" live-blocking gap |

No existing doc or code requires editing to resolve a direct contradiction — every touch
point above is either already forward-compatible (the Assignment / Shift contracts
anticipate exactly this entity) or explicitly client-only / legacy and out of scope.
**No repository file other than this new contract document was created or modified in the
01A audit or its freeze gate.**

### `docs-site` registry validation (CLAUDE.md §B)

`cd docs-site && npm run validate:registry` was run against `main@10731609a` and again at
the freeze gate (`node scripts/validate-document-registry.mjs` directly — `docs-site/node_modules`
is not installed in this worktree; the validator is a dependency-free Node script):

- **Registry structural validation: `✓ Registry OK`, exit 0** — warn-only, non-blocking.
- **Registered legacy documents: 8** (unchanged).
- **`UNACCOUNTED_DOCUMENT` stayed warn-only and non-blocking.** Adding this standalone
  `docs/**` contract raises that diagnostic count by exactly one; the absolute number is not
  pinned here (it also moves with unrelated local build artifacts). Like the sibling
  authority contracts `docs/driver-vehicle-assignment-authority-contract.md`,
  `docs/driver-shift-authority-contract.md`, and
  `docs/driver-document-compliance-contract.md`, this contract is **not** in
  `docs-site/governance/document-registry.json`, and none of them was added to it.
- **The document registry was not changed in 01A.**

## Core separation (frozen — extends the chain, does not restate it)

```
ownership                    vehicles.owner_user_id
entitlement                  vehicle_driver_assignments (ACTIVE | ENDED | REVOKED)
selection                    driver_active_vehicle                      — mutable pre-shift preference
working / open shift         OPEN driver_shift                           — current working identity
vehicle operational block    ≥1 ACTIVE vehicle_operational_block row     — safety hold / dispute / stolen / regulatory (THIS document)
archived                     vehicles.archived                          — owner/garage withdrew the vehicle (soft-delete)
vehicles.is_active           legacy owner-scoped client mirror           — never backend authority
presence                     ONLINE / OFFLINE                            — liveness / dispatch availability (BD-DOCS-033, not built)
ride occupancy               non-terminal ride (RIDE_STATUS)             — current busy/free state
identity trust-block         (future, BD-DOCS-037 §4) keyed to users(id) — gates a PERSON, NOT this document
```

**None collapses into another.** Explicitly, `vehicle operational block-state`:

- is **not `vehicles.archived`.** `archived` is the *owner/garage* saying "this car is
  withdrawn from my fleet" (BD-PROFILE-D-05I); an operational block is *Safety/Ops* saying
  "this car may not be worked, regardless of what the garage wants". Different reason,
  different write path, different lift authority, different audit events. Both independently
  make `vehicleOperationalAt(t) == false` — but `archived` is checked by
  `decideAssignmentUsability` **before the resolver is called at all**; it is **not a value
  of `vehicleBlockState(t)`** (see "The three-value model, precisely").
- is **not `vehicles.is_active`.** Legacy owner-scoped client mirror of
  `driverGarage.activeVehicleId`, frozen out of all backend authority. Nothing here reads or
  writes it.
- is **not entitlement.** A driver can hold a perfectly `ACTIVE`, in-window
  `vehicle_driver_assignments` grant on a vehicle that is `BLOCKED`; the grant row is
  unaffected, the *usability decision* is `UNUSABLE('BLOCKED')`.
- is **not selection or working state.** A `driver_active_vehicle` selection, or even an
  `OPEN driver_shift`, can exist on a vehicle that later becomes `BLOCKED` — the block never
  deletes them; the frozen server-forced-close policy (Shift Authority) handles an `OPEN`
  shift whose pinned assignment reaches confirmed `UNUSABLE`.
- is **not presence, and not ride occupancy.** `ONLINE`/`OFFLINE` is a future Presence
  derivation; busy/free is derived from `RIDE_STATUS`. Neither is a `vehicle_operational_block`
  field.
- is **not an identity trust-block.** BD-DOCS-037 §4's block is keyed to `users(id)` and
  gates a *person*; this is keyed to `vehicles(id)` and gates a *car*. A single safety
  incident may cause both, but they are separate entities with separate lifecycles and write
  paths.
- is **not compliance.** Missing/expired `TAXI_OSAGO`, `TAXI_REGISTRY`, `WAYBILL`, or
  `MEDICAL_CHECK` never, by itself, means `vehicleBlockState(t) == BLOCKED` — see the
  dedicated section.

### Audit matrix — the eight-way distinction, one row per concept

| # | Concept | Keyed to | Written by | `⇒ vehicleOperationalAt(t)==false`? | Where it is checked |
| --- | --- | --- | --- | --- | --- |
| 1 | ownership | `vehicles.owner_user_id` | garage onboarding | no (owner-side authz only) | "who may create a `RENTAL` grant" |
| 2 | entitlement | `vehicle_driver_assignments (id)` | owner / operator / fleet / Ops / server proc | via `assignmentEntitledAt(t)` → the **entitlement half**, not the operational half | `decideAssignmentUsability` step 1 |
| 3 | selection | `driver_active_vehicle (driver_id)` | the authenticated driver | no | feeds shift-open only |
| 4 | working / open shift | `driver_shift (id)`, `status='OPEN'` | shift-open transaction | no | is the working-identity authority once open |
| 5 | **vehicle operational block** | **`vehicle_operational_block (id)`, `status='ACTIVE'`, ≥1 effective row per `vehicle_id`** | **Safety / Ops human or a server safety procedure — never the driver or the owner-as-ordinary-user** | **yes — via `vehicleBlockState(t) == BLOCKED`** | **the resolver call inside `decideAssignmentUsability` step 3** |
| 6 | archived | `vehicles.archived` (boolean) | future garage-CRUD slice, on the owner's action | **yes — but as a distinct confirmed-negative** | `decideAssignmentUsability` step 2 (`vehicle.archived` → `UNUSABLE('ARCHIVED')`), **before** the resolver |
| 7 | `vehicles.is_active` | `vehicles.is_active` (boolean, owner-scoped) | client garage mirror | **no — never read by any backend decision** | nowhere (frozen out) |
| 8 | presence | future Presence store, keyed to driver identity | future heartbeat service | no (a downstream consumer of this verdict) | future Presence / Dispatcher gates |
| — | ride occupancy | `rides.status` (`RIDE_STATUS`) | ride-state chokepoint | no | `findActiveRideForDriver` (freezes selection/shift-open; never a block) |
| — | identity trust-block | future, `users(id)` (BD-DOCS-037 §4) | future Safety & Compliance service | no (gates a person, not `vehicleOperationalAt`) | going-online / accept-assign / order gates |

## Concept & scope

`vehicle_operational_block` records **server-authoritative operational holds on a specific
vehicle**. One `ACTIVE` row = "this vehicle is currently held from being worked, for this
reason, applied by this authority, effective from this server time". **The vehicle is
`BLOCKED` iff at least one such effective `ACTIVE` row exists** — multiple independent holds
may co-exist (see "Data contract" and "Multiple independent simultaneous blocks"). Absence
of any `ACTIVE` row for a vehicle = the vehicle is not operationally blocked.

It is deliberately **narrow**: it answers "blocked / not blocked / can't tell" for the
`vehicleBlockState(t)` seam and nothing else. It does **not** model vehicle maintenance
schedules, inspection due-dates, insurance validity (`TAXI_OSAGO` compliance), registration
validity (`TAXI_REGISTRY` compliance), telematics/fault codes, or driver-identity trust.
Each of those, if it ever lands, is a **separate entity and a separate slice**, never a
reinterpretation of this one.

## Source of truth & storage direction (frozen)

**The authoritative source is a dedicated, co-located PostgreSQL table
`vehicle_operational_block`** — read live, in the **same transaction** and under the **same
`vehicles`-row `FOR UPDATE` lock** that `lockVehicleById` already takes in every
usability-checking operation. It is **not** an external service on the synchronous hot path.

Rationale for co-located PostgreSQL over an external service (each independently re-derived):

1. **Transactional consistency for free, no TOCTOU, no new lock.** Every consumer
   (`openDriverShift`, `setDriverSelection`, `reconcileAssignmentUnusableShift`, the future
   Live Shift API) already runs inside `db.tx` holding
   `SELECT * FROM vehicles WHERE id = $1 FOR UPDATE` on the subject vehicle before the
   resolver runs. A co-located read on that same client is automatically consistent — see
   "Concurrency / race note" for the exact isolation-level argument.
2. **`UNKNOWN` becomes vanishingly rare and genuinely exceptional.** With a co-located read,
   `UNKNOWN` means "the `SELECT` against `vehicle_operational_block` itself threw" — a real
   incident (connection lost mid-transaction, catalog corruption), not a routine "external
   dependency is slow/down". This matches the frozen intent: `UNKNOWN` is fail-closed
   *because it should almost never happen*, not a state the system sits in for minutes at a
   time. An external synchronous source would make fail-closed refusals a normal operating
   condition — the opposite of what the frozen contracts want.
3. **Consistency with every sibling authority.** `vehicle_driver_assignments`, `driver_shift`,
   `driver_active_vehicle`, and the compliance tables are all co-located PostgreSQL, all read
   under row locks, all with the same migration conventions. A block table is the next in the
   same family.
4. **An external feed becomes an ingester, not a hot-path dependency.** If a real external
   safety/regulatory feed (police stolen-vehicle registry, a fleet-ops console, an insurer
   hold API) ever exists, the forward design is: an **asynchronous ingester / reconciler**
   consumes that feed and *writes rows into `vehicle_operational_block`* (via
   `applied_by_service_id`). The synchronous usability path still only reads the co-located
   table. `UNKNOWN` never depends on that external system being reachable at shift-open time.

**`UNKNOWN` classification (frozen):** co-located ⇒ `UNKNOWN` is an **error condition** (the
read threw), **not** a first-class steady state. The frozen fail-closed behaviour still
applies to it verbatim — refuse forward progress, no durable state change — but operationally
a sustained `UNKNOWN` is a paging incident, not business-as-usual.

## Data contract — `vehicle_operational_block` (new — target entity, NOT created by 01A)

One row = one operational block record on one vehicle, from application to lift.
**Append-mostly:** a row's identity and the terms of the block never change; only its
lifecycle status and lift metadata are written after creation. **These fields are the
minimum authoritative schema, not a closed list** — `01B` may add purely operational /
index-support columns, but any field that would introduce a **new persisted lifecycle
state, a pending/intent state, a second authority decision, or an additional transition**
requires a contract amendment first (the same rule the Shift Authority contract froze for
`driver_shift`).

**Immutable at creation, never rewritten:**

| Field | Meaning |
| --- | --- |
| `id` | Surrogate PK (server-generated UUID). The block identity — the unit a lift targets. |
| `vehicle_id` | FK → `vehicles(id)`, `ON DELETE RESTRICT`. The blocked vehicle. |
| `block_reason` | Canonical vocabulary (see below). `TEXT` + named `CHECK`, not a native enum, so a later scoped slice can extend it. Also the independence dimension — see "Multiple independent simultaneous blocks". |
| `applied_by_user_id` | `UUID NULL`, FK → `users(id)` `ON DELETE RESTRICT`. Set when a **human** authority (Ops / Safety officer) applied the block. |
| `applied_by_service_id` | `TEXT NULL`. Set when a **server-owned procedure** (e.g. a stolen-registry ingester, an acute-safety hook) applied it — a service-principal identifier, never a `users` row. |
| `effective_at` | Server/database clock, stamped once at `INSERT`. **Always non-null.** In 01A a block is **immediate** — `effective_at` is the creation time; there is no future-effective / scheduled block (deferred — see below). |
| `applied_reason_note` | `TEXT NULL`. Free-text operator context (case id, dispatcher note). Never parsed; never surfaced to the driver verbatim; length-bounded by `01B`. |
| `created_at` | Row creation (server time). |

Exactly one of `applied_by_user_id` / `applied_by_service_id` is non-null — an actor-XOR
`CHECK`, identical in shape to `vehicle_driver_assignments_actor_xor`. The client sets
neither; the acting authority is always server-resolved. **The client can never write
`vehicle_operational_block` at all.**

**Server-mutable lifecycle fields:**

| Field | Meaning |
| --- | --- |
| `status` | `ACTIVE` \| `LIFTED`. No third value. |
| `lifted_at` | `NULL` while `ACTIVE`; the exact server transition time on `ACTIVE → LIFTED`. Once set, **must be `>= effective_at`**. |
| `lifted_by_user_id` / `lifted_by_service_id` | Actor-XOR, same shape as `applied_by_*`. **Mandatory iff `LIFTED`.** Who cleared this specific block. |
| `lift_reason_note` | `TEXT NULL`. Operator context for the lift; length-bounded by `01B`. |
| `updated_at` | Last lifecycle write (server time). |

### Multiple independent simultaneous blocks (the corrected model)

**A vehicle may carry more than one `ACTIVE` `vehicle_operational_block` row at the same
time**, one per independent authority's hold. Example: police file a `STOLEN_REPORTED` block
while a regulator independently orders the vehicle out of service with a `REGULATORY_HOLD` —
both rows are `ACTIVE`, on the same `vehicle_id`, concurrently.

- **`vehicleBlockState(t) == BLOCKED` iff `≥ 1` effective `ACTIVE` row exists** for the
  vehicle (`status = 'ACTIVE'` AND `effective_at <= t`). It is a set-membership test, not a
  single-row lookup.
- **Uniqueness (the only uniqueness this contract freezes):** at most **one `ACTIVE` row per
  `(vehicle_id, block_reason)`** — a partial unique index
  `vehicle_operational_block_one_active_per_reason_uq ON vehicle_operational_block (vehicle_id, block_reason) WHERE status = 'ACTIVE'`.
  This is a **static row-count invariant over a static predicate** (`status = 'ACTIVE'`, not a
  function of the clock), exactly the shape a partial unique index is designed for — the same
  reasoning `driver_shift_one_open_per_*_uq` uses, and unlike `0005`'s `now()`-dependent
  time-range rule which needed a GiST `EXCLUDE`. `block_reason` is the independence dimension:
  each canonical reason maps to a distinct real-world authority domain (`STOLEN_REPORTED` ≈
  police / owner report, `REGULATORY_HOLD` ≈ a regulator, `SAFETY_HOLD` ≈ internal
  Safety/Ops, `OWNERSHIP_DISPUTE` ≈ a disputes desk), so "one `ACTIVE` hold per reason"
  lets every independent authority hold the vehicle without colliding, while still keeping the
  set bounded and every apply's race outcome deterministic.
- **A same-reason apply race** (two Ops operators both raising `SAFETY_HOLD`) resolves by the
  partial unique index: whichever transaction commits first wins; the loser's `23505` on that
  index is translated by `01B` to an **idempotent "already blocked for this reason"** domain
  result (mirroring `driver_shift`'s `23505 → DRIVER_SHIFT_ALREADY_OPEN` translation) — never
  a raw constraint error, never a second `ACTIVE` row for the same `(vehicle_id, block_reason)`.
- **The lift rule that never releases a hold another authority still owns:** a lift
  **targets one block row by its `id`** and transitions **only that row** `ACTIVE → LIFTED`.
  It is `UPDATE vehicle_operational_block SET status='LIFTED', lifted_at = now(), lifted_by_* = …, lift_reason_note = … WHERE id = $blockId AND status = 'ACTIVE' RETURNING *`.
  **A lift is never scoped by `vehicle_id`** — there is no "clear all blocks on vehicle X"
  primitive, and `01B` must not add one. After a lift, `vehicleBlockState(t)` is recomputed
  from the *remaining* `ACTIVE` rows: lifting the police `STOLEN_REPORTED` row while a
  `REGULATORY_HOLD` row is still `ACTIVE` leaves the vehicle `BLOCKED`. A lift on a row that
  is already `LIFTED` (or absent) matches nothing and is an idempotent no-op (the
  `WHERE status='ACTIVE'` guard, mirroring `closeShift`).
- **Two independent authorities that would use the *same* `block_reason`** (e.g. two
  different regulators, each a `REGULATORY_HOLD`) is **not** representable as two `ACTIVE`
  rows under this contract — the per-`(vehicle_id, block_reason)` uniqueness collapses them.
  This is a **deliberate, explicit deferral**: a finer independence key (a
  `block_case_ref` / `authority_scope` column and `(vehicle_id, block_reason, block_case_ref)`
  uniqueness) is a later contract amendment, added only if a real need appears. 01A freezes
  the per-reason granularity as sufficient for the audited scenarios (the review's own
  worked example is cross-reason: police `STOLEN_REPORTED` + a `REGULATORY_HOLD`).
- **The `vehicleBlockState(t)` seam is unchanged by the multi-row model.** The resolver still
  returns exactly one of `'UNBLOCKED' | 'BLOCKED' | 'UNKNOWN'`; multiple `ACTIVE` rows still
  collapse to the single string `'BLOCKED'`. `server/src/domain/assignment-usability.js` and
  the two consumer services need **no change** — `01B` only swaps the injected default
  resolver. The frozen `decideAssignmentUsability` `reason` for the blocked case stays the
  fixed string `'BLOCKED'` — it does **not** surface *which* `block_reason` applied; a
  driver-facing reason category is a future `01C` projected-read concern.

**Lifecycle state invariants** (for `01B` to express as named `CHECK` constraints, mirroring
`driver_shift_lifecycle_check`):

```text
status = ACTIVE  =>  effective_at IS NOT NULL
                 AND lifted_at IS NULL
                 AND lifted_by_user_id IS NULL AND lifted_by_service_id IS NULL
                 AND lift_reason_note IS NULL

status = LIFTED  =>  effective_at IS NOT NULL
                 AND lifted_at IS NOT NULL
                 AND lifted_at >= effective_at
                 AND (lifted_by_user_id IS NOT NULL) <> (lifted_by_service_id IS NOT NULL)
```

Plus the apply-side actor-XOR, unconditional:
`(applied_by_user_id IS NOT NULL) <> (applied_by_service_id IS NOT NULL)`.

**Immutability guard** (for `01B`, a `BEFORE UPDATE` trigger
`vehicle_operational_block_guard_immutability()`, name sorting before `*_updated_at` so it
runs first): `vehicle_id` / `block_reason` / `applied_by_user_id` / `applied_by_service_id` /
`effective_at` / `created_at` can never be rewritten; `LIFTED` can never transition back to
`ACTIVE`. A renewed block is a **new row** (new `id`) — the append-mostly, no-reopen pattern
of `vehicle_driver_assignments` and `driver_shift`.

**Referential integrity:** every FK — `vehicle_id`, `applied_by_user_id`,
`lifted_by_user_id` — is `ON DELETE RESTRICT`. **No cascade may erase a block record**; it
is safety / audit history.

### `block_reason` vocabulary (frozen canonical set for 01A)

```text
SAFETY_HOLD          -- Safety/Ops applied a hold pending investigation (acute-safety signal, incident review)
OWNERSHIP_DISPUTE    -- contested ownership / unauthorized-use claim; the vehicle may not be worked until resolved
STOLEN_REPORTED      -- the vehicle has been reported stolen (owner report, or a stolen-registry ingester)
REGULATORY_HOLD      -- a regulator / authority has ordered the vehicle out of service
```

Extensible only by a later, explicitly-scoped slice — never invented for UI convenience.

**Deferred (NOT in 01A):**

- `COMPLIANCE_HOLD` — the compliance contract's fail-closed rule governs *dispatch / ONLINE
  eligibility*, not vehicle operational blocking; nothing audited requires a compliance lapse
  to raise an operational block. If a future compliance policy decides otherwise it must
  justify and add this reason. (See "Separation from Driver Document Compliance".)
- `MAINTENANCE_HOLD` — vehicle maintenance is not modelled anywhere yet; if it lands it is
  its own entity, and whether it feeds `vehicleBlockState(t)` is that slice's decision.
- **Scheduled / future-effective blocks** (`effective_at` in the future, mirroring
  `vehicle_driver_assignments.starts_at`) — a safety hold, a stolen report, and a dispute are
  all "now" by nature; inventing a scheduling model here is scope creep. A later amendment
  adds it if a real need appears, and would then also give teeth to the `effective_at <= t`
  half of the `BLOCKED` predicate that 01A leaves trivially true.
- **Any caching / materialization tier** for the block read — 01A is a live co-located read
  every time and owns no staleness contract. A cache is a separate later slice with its own
  invalidation contract.
- **Time-bounded escalation for a *prolonged* `UNKNOWN`** ("block read failing for N minutes
  ⇒ force-close") — a separate Driver Availability / Operations policy, out of scope here,
  exactly the deferral the frozen Assignment / Shift contracts already make for prolonged
  `UNKNOWN`.
- **Identity trust-block / ban** (BD-DOCS-037 §4) — a separate, per-`users(id)` concept.
- **Finer block-independence key** (`block_case_ref` / `authority_scope`) — see "Multiple
  independent simultaneous blocks".

### The three-value model, precisely (frozen — carried from the Assignment Authority contract, P3-1 corrected)

`vehicleBlockState(t)` has **exactly three values**, and its internal precedence is a
strict order **among those three values only**:

```text
BLOCKED  >  UNKNOWN  >  UNBLOCKED
```

| `vehicleBlockState(t)` | Meaning |
| --- | --- |
| **`BLOCKED`** | The authoritative table was queried and **at least one effective, non-lifted** `vehicle_operational_block` row applies at server time `t`: `∃ row. status = 'ACTIVE' AND effective_at <= t`. (In 01A, immediate blocks + terminal `LIFTED` ⇒ this reduces to `∃ ACTIVE row`.) |
| **`UNBLOCKED`** | The authoritative table was **queried successfully and no effective block row applies at `t`**. "Queried and found nothing" is `UNBLOCKED`, **never** `UNKNOWN`. Absence of a row is never `UNKNOWN`. |
| **`UNKNOWN`** | The authoritative read **errored** — the `SELECT` against `vehicle_operational_block` threw (or returned an unrecognized value). It is **not** "found nothing", and **not** a normal state (co-located ⇒ a DB-error incident). An exception must **never** degrade to `UNBLOCKED`. |

**`vehicles.archived` is NOT a value of `vehicleBlockState(t)`.** It is a distinct
confirmed-negative that `decideAssignmentUsability` evaluates **ahead of** the resolver, by
short-circuit:

```text
decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState }):
  step 1  if NOT assignment.entitled_now        -> UNUSABLE(classifyEntitlementUnusableReason)   -- confirmed negative, no resolver call
  step 2  if vehicle.archived                   -> UNUSABLE('ARCHIVED')                            -- confirmed negative, no resolver call
  step 3  blockState = resolveVehicleBlockState(vehicle.id, client)   -- throw is caught -> 'UNKNOWN'
          if blockState == 'BLOCKED'            -> UNUSABLE('BLOCKED')
          if blockState != 'UNBLOCKED'          -> UNKNOWN            -- covers 'UNKNOWN' and any unrecognized value; fail closed
          else                                  -> USABLE
```

So the *overall* precedence an operation sees is:

```text
confirmed entitlement-negative  }  short-circuit AHEAD of the resolver — they "dominate"
vehicle.archived                }  by being checked first, NOT by being a vehicleBlockState value
        >
BLOCKED   (a vehicleBlockState value)
        >
UNKNOWN   (a vehicleBlockState value)
        >
UNBLOCKED (a vehicleBlockState value)
```

A `REVOKED` / `ENDED` / elapsed / `archived` subject is `UNUSABLE` **regardless** of whether
the block read succeeds — a block-read outage can never *mask* an already-known confirmed
negative, and can never *manufacture* one either (a throw is `UNKNOWN`, not `BLOCKED`). This
is exactly what the merged `decideAssignmentUsability` already does; this contract adds only
the real `resolveVehicleBlockState`.

### "Effective at `t`" and freshness semantics (frozen)

- **Server clock only.** `t` is always PostgreSQL `now()` inside the evaluating transaction —
  never a JS `Date`, never a client timestamp. `effective_at` and `lifted_at` are
  DB-stamped.
- **Immediate blocks only in 01A** — a block is effective from the instant it is written
  (`effective_at <= t` is trivially true). Scheduled / future-effective blocks are deferred
  (above).
- **No caching layer** — a live co-located read every time. Any caching / materialization
  tier is a separate later slice and would own its own staleness / invalidation contract; 01A
  explicitly has none.
- **`UNKNOWN` behaviour is identical to the already-frozen fail-closed rule** (carried
  verbatim from `docs/driver-vehicle-assignment-authority-contract.md` "`UNKNOWN` vs.
  confirmed `UNUSABLE`" and `docs/driver-shift-authority-contract.md` precondition #9):
  - `select` / `switch` / shift-open / the Live Shift API `POST …/open` → **refused,
    retryable**, **zero durable writes** (no partial `OPEN` shift row, no selection change);
  - matching candidate inclusion → **prohibited**; final order assignment → **prohibited**;
  - **no shift close, no `OFFLINE`, no `driver_active_vehicle` reset** is driven by `UNKNOWN`
    alone;
  - the server **raises an alert** and retries / reconciles.

## Write authority

| Action | Who may perform it | Notes |
| --- | --- | --- |
| **Apply** a block (`INSERT … status='ACTIVE'`) | an authorized **Safety / Operations** human principal (`applied_by_user_id`), **or** a **server-owned safety procedure** (`applied_by_service_id`) — e.g. a stolen-registry ingester, an acute-safety hook off an in-ride safety report | Never the driver. Never the vehicle owner acting as an ordinary garage user. The exact Ops-authority model (roles, scopes) is inherited from whatever Safety & Operations authorization `BD-DOCS-037` / a future Ops-auth slice defines — **not restated as frozen here**; 01A freezes only that the actor is server-resolved and actor-XOR'd. |
| **Lift** a block (`ACTIVE → LIFTED`, **one row by `id`**) | the Safety / Operations authority **authorized for the authority domain of that specific hold** (`lifted_by_*`) | A `SAFETY_HOLD` / `STOLEN_REPORTED` / `REGULATORY_HOLD` / `OWNERSHIP_DISPUTE` block is **not** something the owner or driver can self-clear. **Addressing a lift by `block_id` (or `vehicle_id`) is not, by itself, an authorization:** a lift is refused **fail-closed** unless the actor is **server-resolved** *and* authorized for the authority domain of that exact hold. A **cross-authority-domain lift is not permitted by default** — e.g. an ordinary Ops role does not get to clear a `STOLEN_REPORTED` (police) or `REGULATORY_HOLD` hold merely by naming its `block_id`, and vice versa. The finer Ops role/scope model (which principal owns which `block_reason` authority domain) is a **separate Ops-auth slice** (inherited from `BD-DOCS-037` / a dedicated Ops-auth slice), **not** defined here and **not** a new field, table, `authority_scope`, or `block_case_ref` in 01A. A lift releases **only the targeted row**; other `ACTIVE` rows on the same vehicle are untouched (see "Multiple independent simultaneous blocks"). (A future slice *may* define a narrower "administrative block the owner applied, owner may lift" — that is a new reason + a new lift rule, contract-amended, not assumed here.) |
| **Re-block** after a lift | the apply authority, as a **new row** | `LIFTED` is terminal for the row (immutability guard). |
| **Mutate** `vehicle_id` / `block_reason` / `applied_by_*` / `effective_at` / `created_at` | **no one** | the immutability guard rejects it outright. |

**Candidate triggers (named, NOT implemented here).** This contract defines the block-state
*entity* only; it wires up **no** integration:

- Assignment Authority's frozen note — `REVOKED` "additionally permits a higher-severity
  safety signal to Driver Availability" — is a candidate source of a `SAFETY_HOLD` /
  `STOLEN_REPORTED` block. The *fate of an in-flight ride* remains the separate Safety-policy
  decision the frozen contracts already carve out; a block never, by itself, drops a
  passenger ride.
- The in-ride safety report sheet (`BD-RIDE-P-07`, `active_ride_passenger_sheets.js`) and
  the order report (`BD-MOD-01`) are candidate human-review inputs an Ops workflow *might*
  escalate into a `SAFETY_HOLD`. Per CLAUDE.md that safety sheet's behaviour is preserved and
  not rerouted; 01A touches none of it.
- An external stolen-vehicle registry / insurer-hold feed is a candidate
  `applied_by_service_id` ingester (see "Source of truth" §4).

## Read authority / consumers

Every consumer reads `vehicleBlockState(t)` **only** through the frozen resolver seam — never
a raw table read hand-rolled per call site.

| Consumer | Status | How it reads |
| --- | --- | --- |
| `openDriverShift` (shift-open) | merged, `services/driver-shift-authority/index.js` | already calls `decideAssignmentUsability(client, { …, resolveVehicleBlockState })` under `lockVehicleById`; `01B` swaps the default resolver for the real one — **no change to this file** |
| `setDriverSelection` (`select` / `switch`) | merged, `services/driver-vehicle-assignment-authority/index.js` | same seam, same lock; `clearDriverSelection` has no usability check and is unaffected |
| `reconcileAssignmentUnusableShift` | merged, `services/driver-shift-authority/index.js` | already re-derives usability under the driver→assignment→vehicle locks and acts only on a **confirmed `UNUSABLE`**; a `BLOCKED` pinned vehicle is exactly such a confirmed `UNUSABLE`. **New trigger input for the `01C-C` discovery scan (P3-3):** in addition to "`OPEN driver_shift` whose pinned assignment has since gone `ENDED`/`REVOKED`/elapsed/`archived`", the scan gains "**`OPEN driver_shift` whose pinned `vehicle_id` has an effective `ACTIVE` `vehicle_operational_block` row**". The reconcile primitive itself is unchanged — it still re-derives the fact under lock; only the *what to scan for* set grows. |
| Live Shift API `POST /api/v1/driver-shift/open` | **HOLD**, `feat/bd-driver-shift-authority-01c-b @ 6dba8ff` (not merged, not touched by this slice) | threads `resolveVehicleBlockState` through `buildApp()`; production passes none ⇒ `defaultResolveVehicleBlockState` ⇒ every `POST /open` currently fails closed. `01B`'s real resolver is what unblocks its happy path. This contract does **not** modify that held branch. |
| Matching candidate inclusion + dispatch final-assignment re-check | future (BD-DOCS-035, not built) | the frozen "two re-check points" on the `OPEN` shift's pinned assignment; a `false` (`UNUSABLE` **or `UNKNOWN`**) excludes the driver |

**The resolver contract, frozen (by `decideAssignmentUsability` in code):**

```text
resolveVehicleBlockState(vehicleId, client) : Promise<'UNBLOCKED' | 'BLOCKED' | 'UNKNOWN'>
```

- **`client`** is the caller's transaction client, which **already holds
  `SELECT * FROM vehicles WHERE id = vehicleId FOR UPDATE`**. The real implementation issues
  its `vehicle_operational_block` read on that same `client` — no new connection, no new
  transaction.
- **Takes NO lock of its own.** The subject vehicle row is already locked by the caller; that
  is the serialization point (see "Concurrency / race note"). The resolver's read of
  `vehicle_operational_block` is a plain `SELECT EXISTS(… WHERE vehicle_id = $1 AND
  status = 'ACTIVE' AND effective_at <= now())` under that umbrella.
- **Return mapping (frozen by `decideAssignmentUsability`):** `EXISTS` true ⇒ `'BLOCKED'`;
  the query succeeded and `EXISTS` false ⇒ `'UNBLOCKED'`; the query **threw** ⇒ let it
  propagate (the caller's `try/catch` maps it to `'UNKNOWN'`), or return `'UNKNOWN'`
  explicitly — the real implementation must **never** swallow a query error into
  `'UNBLOCKED'`.
- **A real implementation replaces `defaultResolveVehicleBlockState` as the production
  default** (in `buildApp()` / the service composition root). `defaultResolveVehicleBlockState`
  (always `'UNKNOWN'`) remains only as the safe fallback when no resolver is injected, and as
  the test seam.
- **The resolver never itself decides policy** — it only reports the three-value fact.

## Relationship to `vehicles.archived`

Both `vehicles.archived == true` and `vehicleBlockState(t) == BLOCKED` independently make
`vehicleOperationalAt(t) == false` and therefore `assignmentUsabilityDecision(t) == UNUSABLE`.
They are **orthogonal** and this contract keeps them so — it does **not** touch `archived`,
`is_active`, or any `vehicles` column.

| | `vehicles.archived` | `vehicle_operational_block` (`ACTIVE`) |
| --- | --- | --- |
| Meaning | owner/garage withdrew the vehicle from use (soft-delete) | Safety/Ops held the vehicle from being worked |
| Written by | a future garage-CRUD slice, on the owner's action (BD-PROFILE-D-05I) | Safety/Ops authority or a server safety procedure — **never** the owner as an ordinary user |
| Lift authority | the owner (un-archive / `restored_from_archive`) | Safety/Ops authority only |
| Reason vocabulary | none (a boolean) | `block_reason` canonical set |
| Cardinality | one boolean per vehicle | ≥ 0 `ACTIVE` rows per vehicle, one per `block_reason` |
| Storage | a column on `vehicles` | a dedicated append-mostly table |
| Audit events | garage-CRUD events | `VEHICLE_OPERATIONAL_BLOCK_APPLIED` / `_LIFTED` |
| Position in `decideAssignmentUsability` | **step 2** — `vehicle.archived` → `UNUSABLE('ARCHIVED')`, **before** the resolver | **step 3** — the resolver call (`'BLOCKED'` → `UNUSABLE('BLOCKED')`) |
| A value of `vehicleBlockState(t)`? | **no** | it *is* what `vehicleBlockState(t)` reads |
| Both true at once? | yes — independent; either alone is sufficient for `UNUSABLE` | yes |

A vehicle that is `archived` **and** `BLOCKED` reports `UNUSABLE('ARCHIVED')` (archived is
checked first); lifting every block does not un-archive it, and un-archiving does not lift
any block. Neither is a substitute for the other.

## Invariants

1. **`vehicleBlockState(t)` reads exactly one authoritative source: the co-located
   `vehicle_operational_block` table**, via the frozen `resolveVehicleBlockState` resolver.
   For the **mutating** authority/usability transactions **already in the existing global
   lock chain** — `select` / `switch` / shift-open / `reconcileAssignmentUnusableShift` —
   that read happens **under the `vehicles`-row `FOR UPDATE` lock the caller already holds**
   (`lockVehicleById`), and taking that lock there is **mandatory** (see the "Concurrency /
   race note"). A future **read-only** Matching / Dispatcher block-state check calls the
   **same** resolver **without** taking that mutating lock — a read-only candidate /
   pre-assignment probe is not a mutation and must not enter the mutation lock chain — and
   stays protected instead by the **fail-closed verdict** (a `false` — `BLOCKED` or
   `UNKNOWN` — excludes the driver) **and** the **mandatory final-assignment re-check**
   immediately before an order is assigned. The existing global mutation lock order is
   unchanged. No consumer hand-rolls a different read; no consumer reads
   `vehicles.is_active`, or infers block-state from `archived`, from `driver_active_vehicle`,
   from `driver_shift`, or from any client input.
2. **Three values, corrected precedence.** `vehicleBlockState(t) ∈ {BLOCKED, UNKNOWN,
   UNBLOCKED}` with the strict order `BLOCKED > UNKNOWN > UNBLOCKED` **among those three
   values**. `vehicles.archived` and a confirmed entitlement-negative are **not**
   `vehicleBlockState(t)` values — they short-circuit *ahead of* the resolver in
   `decideAssignmentUsability` (steps 1–2). `BLOCKED` = queried, ≥ 1 effective `ACTIVE` row;
   `UNBLOCKED` = queried, none effective; `UNKNOWN` = the read errored (never "queried, none
   found"; an exception never degrades to `UNBLOCKED`).
3. **`UNKNOWN` drives no durable state.** A failed block read refuses forward progress
   (retryable, zero writes) but never closes a shift, sets `OFFLINE`, or resets a selection
   on its own — verbatim from the frozen contracts. Only a **confirmed** `UNUSABLE`
   (including `BLOCKED`) drives the durable server-forced-close / stale-selection-reset
   policy.
4. **Multiple independent simultaneous blocks.** A vehicle may hold more than one `ACTIVE`
   block row at once, at most one per `block_reason` (partial unique index
   `WHERE status = 'ACTIVE'` on `(vehicle_id, block_reason)`). `BLOCKED` is a
   set-membership test (`≥ 1` effective `ACTIVE` row). A same-reason apply race loser gets an
   idempotent "already blocked for this reason", never a raw constraint error.
5. **Scoped lift.** A lift transitions **one row, identified by `id`**, `ACTIVE → LIFTED`.
   There is no `vehicle_id`-scoped "clear all" primitive. `vehicleBlockState(t)` recomputes
   from the remaining `ACTIVE` rows — a lift never releases a hold another authority still
   owns.
6. **Append-mostly, no reopen.** `vehicle_id` / `block_reason` / `applied_by_*` /
   `effective_at` / `created_at` are immutable; `LIFTED` is terminal; a re-block is a new
   row. Enforced by a `BEFORE UPDATE` immutability trigger, not application discipline alone.
7. **Server clock only.** `effective_at`, `lifted_at`, and the evaluation `t` are all
   PostgreSQL `now()`. No browser timestamp is ever trusted.
8. **Client is never an actor.** The client cannot apply, lift, or read
   `vehicle_operational_block` directly; `applied_by_*` / `lifted_by_*` are server-resolved
   and actor-XOR'd. The client may, in a future slice, *see* that its selected/pinned
   vehicle is blocked (a projected read), never assert it.
9. **No new lock; no `vehicle → driver` lock edge.** A block write and a usability read
   serialize on the **existing** `vehicles`-row `FOR UPDATE` lock. The block-write path's
   **first and only mandatory lock is that `vehicles` row**, at the `vehicle` position in the
   global chain, with **nothing to its left** — it takes no `users`/driver lock and no
   assignment lock, so it adds no reverse edge and no deadlock cycle (see "Concurrency / race
   note" and the `01B` checklist).
10. **The block-write transaction does not run shift reconciliation.** Applying or lifting a
    block performs **only** its own `vehicle_operational_block` write under the `vehicles`
    lock. It never, in the same transaction, closes a shift, resets a selection, or calls
    `reconcileAssignmentUnusableShift`. Reconciliation of an `OPEN` shift whose pinned
    vehicle became `BLOCKED` is a **separate, after-commit** worker/event slice (`01C-C`).
11. **Orthogonal to `archived`.** `vehicle_operational_block` and `vehicles.archived` are
    independent confirmed-negatives with different write paths, lift authorities, and audit
    events; neither is read as, derived from, or written to satisfy the other.
12. **Orthogonal to Driver Document Compliance.** No `block_reason` is raised from a
    document lapse; `vehicleBlockState(t) == BLOCKED` is never a proxy for
    `complianceReady == false` (see "Separation from Driver Document Compliance").

## State machine

**Per row:**

```
NONE ──▶ ACTIVE ──▶ LIFTED
```

- `NONE` is the absence of an `ACTIVE` row for that `(vehicle_id, block_reason)` — not a
  stored value. Historical `LIFTED` rows may exist in any number.
- `ACTIVE → LIFTED` is the only transition. **No `LIFTED → ACTIVE`.** A vehicle blocked
  again for the same reason after a lift gets a **new** row (new `id`).
- No `PENDING` / `UNDER_REVIEW` / intent state: a block either applies or it does not. If a
  future Ops workflow wants a "proposed block awaiting approval" concept, that is a separate
  entity/state, contract-amended — not a silent column here.

**Per vehicle (derived, not stored):**

```
vehicleBlockState(t) == BLOCKED    iff  COUNT(rows WHERE vehicle_id = v AND status = 'ACTIVE' AND effective_at <= t) >= 1
vehicleBlockState(t) == UNBLOCKED  iff  that query succeeded AND the count is 0
vehicleBlockState(t) == UNKNOWN    iff  that query threw
```

## Mid-shift policy (carried verbatim from the frozen contracts — unchanged)

For a pinned vehicle that becomes `BLOCKED` while its driver has an `OPEN driver_shift`, the
already-frozen Shift Authority / Assignment Authority "server-forced close" policy applies
**verbatim** — this contract adds nothing to it and changes nothing in it:

- a **confirmed `BLOCKED`** makes the pinned assignment's `assignmentUsabilityDecision`
  `UNUSABLE('BLOCKED')` — a confirmed `UNUSABLE`, which **blocks new work immediately** (the
  driver is removed from matching/dispatch for further trips at once);
- an **active passenger ride is NOT auto-aborted** — the current trip is not cancelled or
  interrupted merely because the vehicle became blocked; the pinned tuple is retained as
  ride identity / audit context (a retained pinned tuple never implies the assignment is
  still usable);
- **after the ride reaches a terminal state** (`COMPLETED` / `CANCELED` / `NO_SHOW`), the
  **existing** reconciliation (`reconcileAssignmentUnusableShift`, `close_reason =
  'ASSIGNMENT_UNUSABLE'`) closes the shift, sets the driver non-dispatchable, and clears the
  now-stale `driver_active_vehicle` selection — all before the driver can re-enter
  matching/dispatch;
- **`UNKNOWN` alone changes no durable state** — it triggers only the fail-closed refusals
  above, never a shift close, an `OFFLINE`, or a selection reset;
- **no new `close_reason`** — a `BLOCKED`-driven forced close uses the existing
  `ASSIGNMENT_UNUSABLE` (the pinned assignment's usability decision is `UNUSABLE`). `01B` /
  `01C-C` must **not** invent `OPS_FORCED` or `COMPLIANCE_UNUSABLE` for the block case; those
  stay deferred exactly as the Shift Authority contract froze them;
- **emergency interruption** of an in-flight ride (e.g. an acute-safety `STOLEN_REPORTED`
  seizure) remains a **separate Safety-policy decision**, out of scope here — this contract
  never, by itself, drops a passenger ride.

## Separation from Driver Document Compliance (frozen)

Vehicle operational block-state and Driver Document Compliance are **separate authorities,
enforced side by side, never one through the other**:

- A missing / expired / rejected `TAXI_OSAGO`, `TAXI_REGISTRY`, `WAYBILL`, or
  `MEDICAL_CHECK` **MUST NOT**, by itself, make `vehicleBlockState(t) == BLOCKED`. There is
  **no `COMPLIANCE_HOLD` reason** in 01A's vocabulary, and no code path raises a
  `vehicle_operational_block` row from a compliance projection.
- Compliance readiness is its own AND-term. The frozen roll-up
  (`complianceReady = documentsReady && shiftReady`,
  `docs/driver-document-compliance-contract.md`) is evaluated **beside** vehicle
  operational block-state, not folded into it. A future dispatch/ONLINE gate is, in effect,
  `… AND vehicleBlockState(serverTime) == UNBLOCKED AND complianceReady == true AND …` —
  two independent conjuncts, each with its own authority, its own storage, and its own
  audit events.
- The reverse also holds: an operational block is **not** recorded as a compliance signal;
  it does not touch `driver_documents` / `driver_document_lineages`.
- If a future policy genuinely wants a compliance lapse to raise an operational block, that
  is a deliberate new decision — it must add `COMPLIANCE_HOLD` (or its own entity) with an
  explicit trigger and justification, contract-amended, not assumed here.

## Data / source-of-truth table

| Data / state | Stored where | Writer | Reader | Authority |
| --- | --- | --- | --- | --- |
| Block identity (`id`) | PostgreSQL `vehicle_operational_block` (future `01B`) | Backend API on a Safety/Ops action or a server safety procedure, server-generated | Safety & Ops, Assignment usability, Shift Authority, `01C-C` reconciler, (future) Dispatcher | Server |
| Block status (`ACTIVE` / `LIFTED`) | PostgreSQL `vehicle_operational_block` | Backend API, transactionally (apply / lift-by-id) | same as above | Server |
| `block_reason` | PostgreSQL `vehicle_operational_block` | Backend API, at apply, from the canonical vocabulary | Safety & Ops, audit; (future) a driver-facing projected reason category | Server |
| `applied_by_*` / `lifted_by_*` | PostgreSQL `vehicle_operational_block` | Backend API, server-resolved actor (XOR human / service) | audit, Ops | Server |
| `effective_at` / `lifted_at` | PostgreSQL `vehicle_operational_block` | Backend API, server clock | Assignment usability (`vehicleBlockState(t)`), audit | Server |
| `vehicleBlockState(t)` verdict | derived (not stored) | n/a | `openDriverShift`, `setDriverSelection`, `reconcileAssignmentUnusableShift`, Live Shift API, (future) matching / dispatch | Server, via `resolveVehicleBlockState(vehicleId, client)` |
| `vehicles.archived` | PostgreSQL `vehicles` (existing, 0001) | future garage-CRUD slice, owner action | Assignment usability (step 2), garage UI, Ops | Server — **separate from this table** |
| `complianceReady` | future compliance projection (`docs/driver-document-compliance-contract.md`) | future compliance service | Dispatcher, Availability | Server, once built — **a separate AND-term, not this table** |
| Identity trust-block (per user) | future (BD-DOCS-037 §4), keyed to `users(id)` | future Safety & Compliance service | going-online / accept-assign / order gates | Server, once built — **not this slice** |

## Concurrency / race note

A block applied **concurrently with a shift-open** (or a `select` / `switch`, or a
reconciliation) on the same vehicle **serializes on the `vehicles`-row `FOR UPDATE` lock the
usability check already takes** — no new lock, no new global lock order, no
`vehicle → driver` edge.

**Isolation-level assumption, stated explicitly (P3-4).** `server/src/infra/db.js` `db.tx`
issues a bare `BEGIN` with no `ISOLATION LEVEL` clause, so every consumer transaction runs at
PostgreSQL's default **READ COMMITTED**. The "no TOCTOU between 'is it blocked?' and 'open
the shift'" guarantee rests on exactly two things, and **does not require `SERIALIZABLE`**:

1. the reader acquires `SELECT * FROM vehicles WHERE id = $1 FOR UPDATE` on the subject
   vehicle **before** `decideAssignmentUsability` calls the resolver, and holds it for the
   rest of the transaction (this is what `lockVehicleById` + the merged call order already
   do); and
2. every block **write** must acquire that **same** `vehicles` row lock **first** (its only
   mandatory lock), then `INSERT` / `UPDATE` `vehicle_operational_block`.

Given (1) and (2), the two transactions cannot interleave on the subject vehicle: whichever
locks the `vehicles` row first runs to commit while the other blocks on that row lock. Under
READ COMMITTED each statement sees the latest *committed* data, so after the writer commits
and releases the row, the reader's subsequent `SELECT` on `vehicle_operational_block` sees
the committed block row (or its committed lift). There is no window in which the reader can
observe the `vehicles` row lock free *and* miss a concurrently-committing block write — the
`FOR UPDATE` on `vehicles` is the single serialization point, identical to the mechanism the
Shift Authority contract already relies on for cross-driver shift exclusivity.

- **block-write commits first** ⇒ the shift-open's subsequent `vehicleBlockState(t)` read
  sees `BLOCKED` ⇒ `UNUSABLE('BLOCKED')`, **zero durable shift writes** (precondition #8).
- **shift-open commits first** ⇒ the block write proceeds against a now-`OPEN` shift; the
  pinned assignment is now a **confirmed `UNUSABLE`** target, and the frozen
  server-forced-close policy (Shift Authority) closes that shift after any in-flight ride
  terminates — via `01C-C` (a separate after-commit slice), **not** inside the block-write
  transaction (Invariant 10).
- **two Safety/Ops applies, same `(vehicle_id, block_reason)`** ⇒ serialize on the same
  `vehicles` row lock; the partial unique index `… WHERE status = 'ACTIVE'` is the final
  backstop, and the loser's `23505` maps to an idempotent "already blocked for this reason".
- **two applies, different `block_reason`** ⇒ both succeed; two `ACTIVE` rows co-exist; the
  vehicle is `BLOCKED` until **both** are lifted.
- **apply vs. lift on the same row** ⇒ serialize on the `vehicles` row lock + the block
  row's own `FOR UPDATE` (taken *after* the `vehicles` lock); `LIFTED` is terminal, so a
  lost race is a clean no-op (`WHERE status = 'ACTIVE'` guard, mirroring `closeShift`).
- **a future read-only Matching / Dispatcher block-state probe** takes **no** `vehicles`-row
  lock — it is not a mutation and does not enter the mutation lock chain. It calls the same
  `resolveVehicleBlockState` and is protected by the **fail-closed verdict** plus the
  **mandatory final-assignment re-check**: a block that commits *after* such a probe but
  *before* the order is assigned is caught by that re-check, not by a lock. The
  `vehicles FOR UPDATE` rule above is mandatory only for the **mutating** authority/usability
  transactions (`select` / `switch` / shift-open / `reconcileAssignmentUnusableShift`).

## `BD-DRIVER-VEHICLE-BLOCK-STATE-AUTHORITY-01B` — scope preview (NOT implemented here)

1. **Migration `0008_vehicle_block_state_authority.sql`** — `vehicle_operational_block`:
   - `id UUID PK DEFAULT gen_random_uuid()`;
   - `vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT`;
   - `applied_by_user_id UUID NULL REFERENCES users(id) ON DELETE RESTRICT`,
     `applied_by_service_id TEXT NULL`, actor-XOR `CHECK`
     (`vehicle_operational_block_applied_actor_xor`);
   - `lifted_by_user_id` / `lifted_by_service_id` (same shape), enforced by the lifecycle
     `CHECK`;
   - `block_reason TEXT NOT NULL CHECK (block_reason IN ('SAFETY_HOLD','OWNERSHIP_DISPUTE','STOLEN_REPORTED','REGULATORY_HOLD'))`
     — named `CHECK` (`vehicle_operational_block_reason_check`), `TEXT` not a native enum so a
     later scoped slice can extend it;
   - `status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LIFTED'))`;
   - `effective_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `lifted_at TIMESTAMPTZ NULL`,
     `applied_reason_note` / `lift_reason_note TEXT NULL` (length-bounded),
     `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
   - the two named lifecycle `CHECK`s (`vehicle_operational_block_lifecycle_check`):
     `ACTIVE ⇒ lifted_at IS NULL AND lifted_by_* IS NULL AND lift_reason_note IS NULL`;
     `LIFTED ⇒ lifted_at IS NOT NULL AND lifted_at >= effective_at AND (lifted_by_user_id IS NOT NULL) <> (lifted_by_service_id IS NOT NULL)`;
   - **`vehicle_operational_block_one_active_per_reason_uq`** partial unique index
     `ON vehicle_operational_block (vehicle_id, block_reason) WHERE status = 'ACTIVE'` — the
     "one `ACTIVE` hold per `(vehicle, reason)`" backstop and the `23505` race-loser source;
   - a `vehicle_operational_block_guard_immutability()` `BEFORE UPDATE` trigger (name sorts
     before `_updated_at` so it runs first): rejects any rewrite of `vehicle_id` /
     `block_reason` / `applied_by_*` / `effective_at` / `created_at`, and any
     `LIFTED → ACTIVE`;
   - `set_updated_at()` trigger;
   - lookup index `idx_vehicle_operational_block_vehicle_status (vehicle_id, status)`;
   - idempotent (`CREATE … IF NOT EXISTS`, `DROP TRIGGER IF EXISTS`, `DO`-block constraint
     guards), wrapped in `BEGIN/COMMIT` — exactly the `0005`/`0006`/`0007` conventions.
2. **`server/src/repositories/vehicle_operational_block.js`** — the single SQL seam, no
   orchestration:
   - `existsActiveBlockForVehicle(client, vehicleId)` — a plain
     `SELECT EXISTS(… WHERE vehicle_id = $1 AND status = 'ACTIVE' AND effective_at <= now())`,
     used by the real resolver;
   - **no new `vehicles` SQL seam** — the write path's **first** lock **MUST** reuse
     `repositories/vehicles.js::lockVehicleById` (`SELECT * FROM vehicles WHERE id = $1 FOR
     UPDATE`); `01B` adds **no** second module that runs SQL against `vehicles` (see the MUST
     below);
   - `lockActiveBlockRow(client, blockId)` — `SELECT … FOR UPDATE` on the block row, for the
     lift path, taken **after** the `vehicles` row lock;
   - `insertActiveBlock(client, { vehicleId, blockReason, appliedByUserId | appliedByServiceId, appliedReasonNote })`;
   - `liftBlockById(client, { blockId, liftedByUserId | liftedByServiceId, liftReasonNote })`
     — `UPDATE … SET status='LIFTED', lifted_at = now(), … WHERE id = $blockId AND status = 'ACTIVE' RETURNING *`.
     **Never** a `WHERE vehicle_id = …` variant.
   - **MUST (frozen from the concurrency argument, P3-2 — an explicit `01B` checklist item,
     not just prose):** both the apply path and the lift path acquire
     `SELECT * FROM vehicles WHERE id = $vehicle_id FOR UPDATE` as their **first lock**, at
     the `vehicle` position in the global chain
     (`driver authority → assignment → vehicle → dependent authority → mutation`), **with
     nothing to its left** — no `users`/driver lock, no assignment lock. This introduces
     **no `vehicle → driver` lock edge** and reuses the existing serialization point; `01B`
     tests must assert this ordering explicitly.
3. **The real `resolveVehicleBlockState(vehicleId, client)`** — calls
   `existsActiveBlockForVehicle` on the caller's `client` (already holding the `vehicles` row
   lock), maps `true → 'BLOCKED'`, `false → 'UNBLOCKED'`, and lets any query error propagate
   (⇒ `'UNKNOWN'` via the caller's `catch`) — **never** swallows an error into `'UNBLOCKED'`.
   Wired as the production default in `buildApp()` / the service composition root;
   `defaultResolveVehicleBlockState` (always `'UNKNOWN'`) stays as the injection-absent
   fallback + test seam. **No edit to `server/src/domain/assignment-usability.js` or the two
   consumer services.**
4. **Readiness / schema assertions** — `server/src/infra/db.js` `ready()` gains a structural
   check for `vehicle_operational_block` (load-bearing columns + the named actor-XOR and
   lifecycle `CHECK`s + the `block_reason` `CHECK` + the
   `vehicle_operational_block_one_active_per_reason_uq` partial index +
   `trg_vehicle_operational_block_guard_immutability` + `trg_vehicle_operational_block_updated_at`),
   following the exact structural (not `to_regclass`) pattern the sibling tables use.
   `server-ci.yml` replays `0001`–`0008` twice and adds by-name object assertions; the `app`
   job additionally proves a database with `0001`–`0007` but not `0008` already reports
   `{status:'degraded', db:'schema-incomplete'}` / `503`.
5. **Real PostgreSQL adversarial / concurrency tests** — apply → `BLOCKED`; lift-by-id →
   recompute (with a second `ACTIVE` row still present, the vehicle stays `BLOCKED`);
   the per-`(vehicle_id, block_reason)` partial-unique race (two applies, same reason →
   one wins, loser is idempotent "already blocked for this reason"); two applies, different
   reasons → two `ACTIVE` rows co-exist; the immutability trigger (no `LIFTED → ACTIVE`, no
   pinned-field rewrite); the resolver's throw ⇒ `'UNKNOWN'` mapping (never `'UNBLOCKED'`);
   and the **shift-open-vs-block-apply concurrency test** — two real transactions racing on
   the `vehicles` row lock, asserting the two deterministic outcomes above with **zero orphan
   `OPEN` `driver_shift` rows** and **zero shift-reconciliation side effects inside the
   block-write transaction** (Invariant 10).

`01B` ships a **dark seam only** where a route is not yet authorized — mirroring
`services/driver-vehicle-assignment-authority/index.js`'s own "importable, not wired into
`services/index.js SERVICES`, no HTTP surface" pattern. No public/live route without a
separate authorization.

## `01C` scope preview (NOT implemented here)

Authorized **Safety / Operations** write endpoints, live: `POST` apply-block / `POST`
lift-block (by block `id`), gated by whatever Ops-authority model `BD-DOCS-037` (or a
dedicated Ops-auth slice) defines, with the uniform problem shape and strict schemas.
Optionally a **driver-facing projected read** ("your selected/pinned vehicle is currently
blocked — reason category only"), consuming the entity, never asserting it, and surfacing at
most the `block_reason` category (not `applied_reason_note`).

## Audit events (indicative, future)

Names indicative; the sink/outbox is the Monitoring & Audit concern
(`BD-DRIVER-DOCUMENT-COMPLIANCE-01G` family / `BD-DOCS-039`). No emission or outbox wiring is
part of 01A.

- `VEHICLE_OPERATIONAL_BLOCK_APPLIED` — records `vehicle_id`, `block_reason`, `applied_by_*`,
  `effective_at`, `applied_reason_note`, block `id`.
- `VEHICLE_OPERATIONAL_BLOCK_LIFTED` — records `vehicle_id`, block `id`, `block_reason`,
  `lifted_by_*`, `lifted_at`, `lift_reason_note`.

These compose with the frozen Shift Authority events — e.g. a `BLOCKED` pinned assignment
that forces a shift closed still emits `DRIVER_SHIFT_FORCED_CLOSED_ASSIGNMENT_UNUSABLE`
(from the Shift / Assignment contracts), *plus* this contract's `_APPLIED` event from the
block write that triggered it.

## 01A non-goals

This slice does not add:

- DB migration (no `vehicle_operational_block` table; no `0008`)
- backend route / runtime / API / resolver implementation
- any `repositories/*`, `services/*`, `domain/*`, or `infra/db.js` change
- any edit to `server/src/domain/assignment-usability.js` or the two consumer services (they
  already consume the seam; `01B` only swaps the injected default resolver)
- any change to `vehicles`, `vehicles.archived`, `vehicles.is_active`, or any `vehicles`
  index
- any `close_reason` value (`OPS_FORCED` / `COMPLIANCE_UNUSABLE` stay deferred as the Shift
  Authority contract froze them)
- any `block_reason` beyond the four frozen values (no `COMPLIANCE_HOLD`, no
  `MAINTENANCE_HOLD`)
- scheduled / future-effective blocks; any caching / materialization tier; a
  prolonged-`UNKNOWN` escalation policy; a finer block-independence key
- PWA change (no screen, `state.js`, or `garage.js` change)
- Service Worker / precache / CSP change
- Presence runtime, heartbeat, or cache/Redis
- Matching / Dispatcher runtime or the candidate/final-assignment gates
- Driver Document Compliance runtime
- external-service integration (stolen registry, insurer hold, Ops console) — named only as
  a future ingester
- identity trust-block / ban (BD-DOCS-037 §4) — a separate, per-user concept
- any modification of `BD-DRIVER-SHIFT-AUTHORITY-01C-B` (HOLD, `6dba8ff`) or `01C-C`
- any additional Project metadata change or document-registry edit
- any edit to `docs/driver-vehicle-assignment-authority-contract.md`,
  `docs/driver-shift-authority-contract.md`, `docs/driver-document-compliance-contract.md`,
  or any `docs-site` ADR / the document registry

If a genuine contradiction with a frozen contract is found, it is **flagged as a decision for
review**, not resolved by editing the frozen contract. **None was found in this gate** — the
Assignment Authority contract explicitly anticipates this entity and explicitly leaves its
storage open ("a column on `vehicles`, a separate table, an external service … a decision
this contract does not fix").

## Follow-up slices

1. `BD-DRIVER-VEHICLE-BLOCK-STATE-AUTHORITY-01B` — migration `0008_vehicle_block_state_authority.sql`
   (`vehicle_operational_block`) + `repositories/vehicle_operational_block.js` + the real
   `resolveVehicleBlockState` wired as the production default + `infra/db.js` readiness +
   `server-ci` replay + real PostgreSQL adversarial/concurrency tests incl. the
   shift-open-vs-block-apply race. Dark seam only where a route is not yet authorized.
2. `BD-DRIVER-VEHICLE-BLOCK-STATE-AUTHORITY-01C` — authorized Safety/Ops apply/lift-by-id
   endpoints, live; optional driver-facing projected read (reason category only).
3. `BD-DRIVER-SHIFT-AUTHORITY-01C-B` (**resume — not part of this slice**) — the held Live
   Shift API; its happy-path `POST …/open` stops failing closed on
   `ASSIGNMENT_STATE_UNKNOWN` once `01B` supplies the real resolver.
4. `BD-DRIVER-SHIFT-AUTHORITY-01C-C` — the assignment-unusable reconciliation worker;
   consumes the same confirmed-`UNUSABLE` signal (incl. `BLOCKED`) and gains the new
   discovery-scan trigger input named in "Read authority / consumers" (P3-3). Must wait for
   this slice's `01B`.
5. (Later, separate) identity trust-block / ban per `BD-DOCS-037` §4; matching/dispatch
   consumption of `vehicleBlockState(t)` per `BD-DOCS-035`; a caching/materialization tier
   for the block read; scheduled/future-effective blocks; a finer block-independence key —
   each its own contract amendment or slice.

## Presence / Dispatcher boundary

No Presence or Matching/Dispatcher runtime in this slice. The following **future invariants**
are frozen for later consumption only (carried from the Assignment/Shift contracts, applied
to this entity):

- A driver is eligible for new matching only if, among the other frozen conditions, **the
  shift's pinned vehicle has `vehicleBlockState(serverTime) == UNBLOCKED`** — re-checked at
  both the candidate-set and final-assignment points; a `false` (`BLOCKED` **or `UNKNOWN`**)
  excludes the driver.
- A vehicle transitioning to `BLOCKED` while it has an `OPEN` shift triggers the frozen
  server-forced-close policy (via `01C-C`), **not** an immediate passenger-ride interruption
  — emergency interruption stays a separate Safety-policy decision.
- Presence `ONLINE` for a driver whose pinned vehicle is `BLOCKED` is not permitted once
  Presence is built; `UNKNOWN` refuses the transition fail-closed without, on its own,
  forcing `OFFLINE`.

## Resolution of the prior review (P2-1 + four P3s)

| Finding | Where it was wrong in the prior draft | Resolution in this contract |
| --- | --- | --- |
| **P2-1** — only one `ACTIVE` block per vehicle (partial unique index `WHERE status='ACTIVE'` on `vehicle_id`), per-*tier* lift authority; independent authorities' holds cannot co-exist and lifting one can prematurely unblock. | "Exclusivity: at most **one `ACTIVE` `vehicle_operational_block` per `vehicle_id`**"; lift described per authority tier, not scoped to a row. | **"Multiple independent simultaneous blocks":** uniqueness is now per **`(vehicle_id, block_reason)`** (partial unique index `WHERE status='ACTIVE'`), so e.g. police `STOLEN_REPORTED` + a `REGULATORY_HOLD` co-exist as two `ACTIVE` rows. `vehicleBlockState(t) == BLOCKED` iff **≥ 1** effective `ACTIVE` row. **Lift targets one row by `id`** (`… WHERE id = $blockId AND status = 'ACTIVE'`), never `vehicle_id`-scoped, so it never releases a hold another authority still owns. Same-reason apply race → idempotent "already blocked for this reason". Finer per-authority key (`block_case_ref`) explicitly deferred. Invariants 4–5; "Concurrency / race note". |
| **P3-1** — precedence wording bundled `vehicles.archived` into the 3-value `vehicleBlockState(t)` order as a peer of `BLOCKED`. | "confirmed `BLOCKED` (and `vehicles.archived`) outrank `UNKNOWN`, which outranks `UNBLOCKED`". | **"The three-value model, precisely":** `vehicleBlockState(t) ∈ {BLOCKED, UNKNOWN, UNBLOCKED}` with `BLOCKED > UNKNOWN > UNBLOCKED` **among those three values only**. `vehicles.archived` (and a confirmed entitlement-negative) are **not** `vehicleBlockState(t)` values — they short-circuit **ahead of** the resolver in `decideAssignmentUsability` steps 1–2, "dominating" only by being checked first. Shown with the exact merged-code step order. Invariant 2; "Relationship to `vehicles.archived`" ("A value of `vehicleBlockState(t)`? — no"). |
| **P3-2** — "apply/lift acquires `vehicles FOR UPDATE` first" was only in prose. | Stated in the prior draft's "Concurrency / race note" narrative, absent from the `01B` scope list. | **`01B` scope preview item 2** now carries it as an explicit **MUST** checklist item: both the apply and lift paths take `SELECT * FROM vehicles WHERE id = $vehicle_id FOR UPDATE` as their **first** lock, at the `vehicle` position, nothing to its left, no `vehicle → driver` edge; `01B` tests must assert the ordering. Also Invariant 9. |
| **P3-3** — the `01C-C` reconciliation worker's OPEN-shift discovery scan gains a new trigger input. | The prior draft's consumer row for `reconcileAssignmentUnusableShift` mentioned it only as consuming "the confirmed `UNUSABLE` signal", without naming the scan input. | **"Read authority / consumers"** now names it explicitly: the `01C-C` discovery scan gains "**`OPEN driver_shift` whose pinned `vehicle_id` has an effective `ACTIVE` `vehicle_operational_block` row**" alongside the existing ENDED/REVOKED/elapsed/archived triggers. Also Follow-up slice 4. |
| **P3-4** — the "no TOCTOU" claim implicitly assumed READ COMMITTED. | "there is **no TOCTOU** between 'is it blocked?' and 'open the shift'" stated with no isolation-level premise. | **"Concurrency / race note"** now states it: `db.tx` issues a bare `BEGIN` ⇒ **READ COMMITTED**; the no-TOCTOU guarantee rests on (1) the reader holding the `vehicles`-row `FOR UPDATE` for the transaction and (2) every block write taking that same row lock first — and **does not require `SERIALIZABLE`**. The exact statement-visibility argument is spelled out. |

The prior review's **CONFIRMED-sound** points are carried forward unchanged: the dedicated
co-located PostgreSQL table direction, the append-mostly history model, the resolver
semantics, orthogonality with `archived` / `is_active`, actor-XOR write authority with
`RESTRICT` history, no-new-lock / no-deadlock concurrency, DB representability without
trigger-heavy logic, and the deferrals of `COMPLIANCE_HOLD` / `MAINTENANCE_HOLD` / scheduled
blocks / caching / prolonged-`UNKNOWN` / identity-trust-block.
