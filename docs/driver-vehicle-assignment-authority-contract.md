# BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01A

Status: contract-first / docs-only

Issue: #959

Architecture: Driver App / Driver Availability / Backend API / DB / Safety & Compliance

## Existing UI anchor

This slice reuses the existing driver garage surface — it adds no route:

- route: `/profile` (driver mode; single registered route, `register('/profile', profile)` in `public/src/app.js`)
- runtime: `public/src/screens/profile.js` (`garageSectionHtml`, `wireGarageActions`, `buildGarageVehicles`, `garageVehicleCardHtml`)
- shared resolver: `public/src/garage.js` (`buildGarageVehicles`, `resolveActiveGarageVehicleId`, `resolveActiveGarageVehicle`)
- current local selection seam: `driverGarage` namespace inside `bazardrive.user.v1` — `{ activeVehicleId, vehicles: [] }`, normalised per BD-PROFILE-D-05F
- design preview gates: `?garage=empty`, `?garage=multi` (dev/QA render-gates only, never a user path)

Contracts touched conceptually: `BD-PROFILE-D-05B/05C/05D/05E` (garage action surface, in-memory collection, persisted `activeVehicleId`, driver-snapshot read), `BD-DOCS-031` (vehicles entity), `BD-DOCS-032` (compliance + vehicles follow-up), `BD-DOCS-033` (Presence), `BD-DRIVER-DOCUMENT-COMPLIANCE-01A` (the compliance evaluation context this feeds).

No new route is introduced by 01A. No screen changes.

## Problem

Today the relationship between a driver and the vehicle they work on is **client-owned and structurally incomplete**.

- `vehicles.owner_user_id` (`server/migrations/0001_phase1_init.sql:129-171`) records the **owner** of a vehicle — the user under whose garage the row was migrated from `driverGarage.vehicles[]`. It is an ownership reference, not a statement about who is currently driving the car.
- `vehicles.is_active` (same migration) is a per-**owner** flag materialising `driverGarage.activeVehicleId` — the driver's last "Сделать активной" tap in the garage section (`public/src/screens/profile.js`; persisted to `bazardrive.user.v1` per BD-PROFILE-D-05D). The partial-unique `uq_vehicles_one_active ON vehicles(owner_user_id) WHERE is_active` enforces "one active vehicle per owner" — again scoped to the owner, and set by the client.
- No server code reads or writes `vehicles` at all today (`grep vehicles|is_active|activeVehicle` across `server/src/**` → zero matches). There is no `repositories/vehicles.js`, no route, no service.
- A vehicle attached to a ride or a response is a **denormalised display snapshot**, never a foreign key: `rides.vehicle_model` / `vehicle_color` / `vehicle_plate` (from `buildActiveRideSeed`), `responses.vehicle_id TEXT` / `offers.vehicle_id TEXT` (= `response.vehicleId`, literally `'user_vehicle'` today). The strings are sourced from the driver's client-side `resolveActiveGarageVehicle(u)` selection (`public/src/garage.js` → `public/src/screens/respond.js` `getUserVehicle`, `public/src/ride_actions.js` `buildAcceptedDriverSnapshot`).

BazarDrive has an explicit scenario this model cannot express:

```
the vehicle owner is NOT necessarily the driver currently working on the vehicle
```

Concretely: Ruslan owns a car → rents it to another driver → that other driver opens a shift and works on it. During that shift the working driver is someone `vehicles.owner_user_id` does not name, and `vehicles.is_active` — an owner-scoped client flag — says nothing about it.

Safety & Compliance (`BD-DRIVER-DOCUMENT-COMPLIANCE-01A`) needs a **server-authoritative** answer to "which driver is entitled to, and currently working on, which vehicle, in which shift" before it can evaluate `WAYBILL` (DRIVER + VEHICLE + SHIFT) and `MEDICAL_CHECK` (DRIVER + SHIFT) against a real subject tuple. `owner_user_id` and `is_active` cannot be that answer.

## Source of truth

The backend becomes the authority for **entitlement** (who may work on a vehicle) and **current selection** (which entitled vehicle a driver has chosen right now), split into three layers:

```
vehicles                       canonical vehicle data + OWNER  (exists today — unchanged by this contract)
        │
        ▼
vehicle_driver_assignments      server-owned entitlement: this driver MAY work on this vehicle
        │                       (assignment_type OWNER | RENTAL | FLEET; status ACTIVE | ENDED | REVOKED)
        ▼
driver_active_vehicle           server-owned CURRENT selection: which of the driver's usable
        │                       assignments (assignmentUsableAt(serverTime) == true) the driver picked
        ▼
driver_shift                    an OPEN shift PINS driver_id + vehicle_id + assignment_id
        │                       (owned by Driver Availability / Presence — BD-DRIVER-SHIFT-AUTHORITY, a later slice)
        ▼
Safety & Compliance             evaluates documents for the exact driver + vehicle + shift
```

Each layer is a distinct concept and must not be collapsed into another:

- **Ownership** (`vehicles.owner_user_id`) ≠ **entitlement** (a `vehicle_driver_assignments` row that is not `ENDED`/`REVOKED`) ≠ **selection** (`driver_active_vehicle`) ≠ **working** (an `OPEN` `driver_shift`).
- A driver can be *entitled* to several vehicles at once (own one, rent another), *select* at most one at a time, and be *working* on exactly the one their `OPEN` shift pinned.

The client may display a driver's assignments and their current selection, and may request a selection change. It may not create, end, or revoke an assignment, and it may not assert the selection server-side — the server owns both.

## Data contract

### `vehicles` (existing — unchanged by 01A)

`vehicles` stays exactly as migrated (`0001`): `id`, `owner_user_id → users(id)`, `legacy_id`, `model`, `color`, `plate`, `source`, `archived`, `restored_from_archive`, `is_active`, `created_at`, `updated_at`; constraints `vehicles_owner_legacy_uq`, indexes `idx_vehicles_owner` / `uq_vehicles_one_active` / `idx_vehicles_owner_active_list`; trigger `trg_vehicles_updated_at`.

This contract changes the **meaning** attributed to two of its columns, not the schema:

- `owner_user_id` is the **owner**. `vehicle_driver_assignments.vehicle_id` references `vehicles.id` (**not** `owner_user_id`); owner-side authorization — e.g. "may this actor create a `RENTAL` grant for this vehicle?" — *reads* `vehicles.owner_user_id`. It is never read as "the driver working on this vehicle".
- `is_active` is **legacy / derived only** (see the dedicated section below). No server decision reads it.
- `archived = TRUE` (BD-PROFILE-D-05I soft-delete) means the vehicle is withdrawn from use. A future "blocked" state (safety hold, ownership dispute, stolen) is a separate flag the runtime slice may add; this contract refers to both together as **archived/blocked**.

### `vehicle_driver_assignments` (new — target entity, not created by 01A)

One row = one grant of the right for a driver to work on a vehicle. Append-mostly: a row's identity and grant terms never change; only its lifecycle status and end time are written after creation.

**Immutable at creation, never rewritten:**

| Field | Meaning |
| --- | --- |
| `id` | Surrogate PK (server-generated UUID). |
| `vehicle_id` | FK → `vehicles(id)`. The vehicle the grant is for. |
| `driver_id` | FK → `users(id)`. The driver being entitled. |
| `assigned_by_user_id` | `UUID NULL`, FK → `users(id)`. Set when a **human** actor (owner / rental operator / fleet manager / Ops) created the grant. |
| `assigned_by_service_id` | `TEXT NULL`. Set when a **server-owned procedure** (e.g. ownership onboarding) created the grant — a service-principal identifier, not a `users` row. |
| `assignment_type` | `OWNER` \| `RENTAL` \| `FLEET`. `OWNER` = the owner driving their own vehicle (`driver_id == vehicles.owner_user_id`). `RENTAL` = the owner lets another specific driver use it. `FLEET` = a fleet/company vehicle assigned to a driver by an operator. |
| `starts_at` | When the entitlement window opens (server time). **May be in the future** — a scheduled grant is entitled only once `starts_at` is reached. |
| `created_at` | Row creation (server time). |

Exactly one of `assigned_by_user_id` / `assigned_by_service_id` is non-null — an exactly-one `CHECK` at the future DB layer. The client sets neither; the logical "who assigned this" is always a server-resolved actor. `users` today is a stub with roles `passenger` / `driver` / `guest` and models no service principal, so a service actor is never written as a `users` row.

**Server-mutable lifecycle fields:**

| Field | Meaning |
| --- | --- |
| `status` | `ACTIVE` \| `ENDED` \| `REVOKED`. `ACTIVE` means the grant is **not yet** `ENDED`/`REVOKED` — it does **not** mean "usable now". Current usability is `assignmentUsableAt(serverTime)` alone: a still-`ACTIVE` grant that is past its `ends_at`, or before its `starts_at`, is not usable. `ENDED` = the entitlement window closed normally (rental term over, driver left the fleet). `REVOKED` = terminated out-of-band (dispute, fraud, safety) — takes effect immediately. |
| `ends_at` | The planned upper bound of the entitlement window. **May be set at row creation** (a fixed-term rental), and may later be **shortened** by an authorized server action (owner / operator / Ops). On an `ENDED`/`REVOKED` transition it must be **≤ the server-side transition time**. `NULL` = open-ended (see *Non-overlapping entitlement windows*). |
| `updated_at` | Last lifecycle write (server time). |

**Non-overlapping entitlement windows (contract level).** An assignment's *entitlement window* is the half-open interval `[starts_at, ends_at)`, where `ends_at IS NULL` means *infinity*. For one `(vehicle_id, driver_id)` pair, the entitlement windows of any two **non-terminal** assignments (`status = ACTIVE`) must **not overlap** — a scheduled future grant is accepted only if its window is disjoint from every existing non-terminal one for that pair. This is deliberately a *time-range* invariant, **not** a "one row where `assignmentEntitledAt(now())`" rule: membership of that set changes with the clock alone, with no `INSERT`/`UPDATE`, so a static partial-unique index over a `now()`-dependent predicate cannot enforce it, and two future grants that do not overlap *today* could overlap *later*. At the future database layer this is an exclusion constraint over the entitlement-window range per `(vehicle_id, driver_id)` (or an equivalent serialized check on write); this contract does not prescribe the DDL. Terminal `ENDED`/`REVOKED` rows are excluded from the constraint and retained as history.

Multiple drivers **may** hold entitled assignments on the same vehicle simultaneously (the owner's `OWNER` grant and a `RENTAL` grant to a tenant can coexist). Exclusivity is enforced **only at the shift layer** (one `OPEN` `driver_shift` per `vehicle_id`) — never at the entitlement or the selection layer.

**Who may create an assignment.**

| `assignment_type` | Created by |
| --- | --- |
| `OWNER` | the vehicle owner, or a server-owned ownership-onboarding procedure. A self-`OWNER` grant is accepted only when the server independently confirms `assignment.driver_id == vehicles.owner_user_id`. |
| `RENTAL` | the vehicle owner, or an authorized rental operator. |
| `FLEET` | a fleet manager, or the Ops authority for that fleet. |

A driver can never assign themselves someone else's vehicle: the client cannot write `vehicle_driver_assignments` at all, and the server sets `assigned_by_user_id` / `assigned_by_service_id` from the resolved actor. Ending or revoking an assignment is likewise a server / owner / operator / Ops action, never a driver self-service one.

### Assignment usability

Whether an assignment may be acted on is a **single fail-closed predicate**, `assignmentUsableAt(t)`, evaluated at server time. It composes an *entitlement* check (the driver's right) with an *operational* check (the vehicle's technical state); the two are defined separately so neither can be conflated with, or checked without, the other:

```text
assignmentEntitledAt(t) =
  assignment.status == ACTIVE                       -- i.e. not ENDED / REVOKED
  AND assignment.starts_at <= t
  AND (assignment.ends_at IS NULL OR t < assignment.ends_at)

vehicleOperationalAt(t) =
  vehicle.archived == false
  AND vehicleBlockState(t) == UNBLOCKED

assignmentUsableAt(t) =
  assignmentEntitledAt(t)
  AND vehicleOperationalAt(t)
```

`vehicleBlockState(t)` is three-valued:

- **`UNBLOCKED`** — no effective server-side block record applies at `t`.
- **`BLOCKED`** — an effective server-side block record applies at `t` (safety hold, ownership dispute, stolen).
- **`UNKNOWN`** — the authoritative block source errored or was unreachable.

`vehicleOperationalAt(t)` is `true` **only** for `UNBLOCKED`; both `BLOCKED` and `UNKNOWN` make it `false`. Where the block state is physically stored (a column on `vehicles`, a separate table, an external service) is a runtime / DB decision this contract does not fix.

Every critical operation evaluates the **full `assignmentUsableAt(serverTime)`** — never `status = ACTIVE` alone, and never the entitlement half without the operational half:

- selecting an active vehicle (`NONE → SELECTED`) and switching it (`SELECTED(A) → SELECTED(B)`)
- opening a `driver_shift`
- **matching** — before a driver is added to a candidate set, on that driver's `OPEN` shift's pinned assignment
- **dispatch** — immediately before a final order is assigned to the driver, re-checked on the pinned assignment
- the server's periodic / event-driven re-validation of a current selection or an open shift

**Temporal fail-closed.** An assignment whose `ends_at` is already in the past is **unusable immediately** — correctness does not wait for a background job to materialise `status = ENDED`. `assignmentEntitledAt(t)` is computed from `starts_at` / `ends_at` / `status` at evaluation time, server clock only; a stale stored `status = ACTIVE` past `ends_at` (or before `starts_at`) never yields `true`.

**Operational fail-closed.** When `vehicleBlockState(t)` is `UNKNOWN` — the authoritative block source errored or was unreachable — `vehicleOperationalAt(t)` is `false`: an interactive operation (selection, switch, shift-open) **fails closed** with a retryable error, and dispatch inclusion is refused. The client is never granted the operation by default.

**Dispatch fail-closed gate.** `assignmentUsableAt(serverTime)` is re-evaluated on the `OPEN` shift's pinned assignment at two points in the order pipeline, independently of any event or worker: (a) before the driver is added to a matching candidate set, and (b) immediately before a final order is assigned. A `false` **or `UNKNOWN`** result excludes the driver — no order is offered and none is assigned. The event-driven invalidation policy (*Downstream contract*) and any periodic worker are accelerators that materialise `OFFLINE` / shift-close sooner; correctness never depends on their timeliness.

### `driver_active_vehicle` (new — target entity, not created by 01A)

One row = a driver's current choice of which entitled vehicle to work with. It is distinct from ownership and from assignment *existence*: having a usable assignment does not select it; a driver with three usable assignments still selects at most one.

| Field | Meaning |
| --- | --- |
| `driver_id` | PK / FK → `users(id)`. One row per driver at most; absence of a row = the `NONE` state. |
| `assignment_id` | FK → `vehicle_driver_assignments(id)`. The selected grant. Must satisfy `assignmentUsableAt(serverTime)` at selection time (see *Assignment usability*). |
| `selected_at` | When this selection was made (server time). |
| `updated_at` | Last write (server time). |

The selected **vehicle is derived** — it is the `vehicle_id` of the `vehicle_driver_assignments` row that `assignment_id` points at — and is **not** stored on `driver_active_vehicle`. To make an internally inconsistent selection unrepresentable, the reference is a **composite foreign key** to the assignment plus its driver:

```text
(driver_active_vehicle.assignment_id, driver_active_vehicle.driver_id)
  REFERENCES vehicle_driver_assignments (id, driver_id)
```

so the selected assignment always belongs to the selecting driver (at the future DB layer `vehicle_driver_assignments` carries the matching `UNIQUE (id, driver_id)` to be an FK target). If a future runtime slice keeps a denormalised `vehicle_id` on `driver_active_vehicle` for read convenience, it must be covered by a **three-column** composite FK to `vehicle_driver_assignments (id, driver_id, vehicle_id)` — never an application-level assert.

`driver_active_vehicle` is the driver's **pre-shift preference** — what the driver picks in the garage before going on duty. It is explicitly **not**:

- a **reservation** or a **lease** on the vehicle;
- an **occupancy lock** — several drivers who each hold a usable assignment on the same vehicle may each select it, at the same time;
- **proof** that the driver is working on the vehicle, or that the vehicle is free;
- the **compliance authority** — see *Downstream contract*.

Because it is only a preference, it needs no TTL, lease, or heartbeat, and a stale or forgotten selection can never lock a vehicle for anyone else. Real exclusivity is established only by opening a `driver_shift` (see *Invariants* and *Downstream contract*). If BazarDrive later adds a genuine "hold this car for me" feature, that is a **separate entity and a separate slice** (`vehicle_reservation`, with its own `lease_until` / `heartbeat` / `released_at`) — never a reinterpretation of `driver_active_vehicle`.

### Relationship to the finalized compliance context

`BD-DRIVER-DOCUMENT-COMPLIANCE-01A` evaluates its verdict for a server-authoritative context `{ driverId, activeVehicleId, shiftId }`. This contract supplies the substrate:

- `driverId` — unchanged: the authenticated driver session (`plugins/auth.js` `resolveUser()`), already server-authoritative.
- `activeVehicleId` — sourced from the **`OPEN` `driver_shift` row's pinned `vehicle_id`**, not from `driver_active_vehicle` and never from `vehicles.is_active`.
- `shiftId` — the `OPEN` `driver_shift` row for the driver.

`driver_active_vehicle` feeds the *shift-open* operation; once a shift is open, the shift's pinned tuple is the authority.

## State machines

### Assignment lifecycle

```
(created) ──▶ ACTIVE            (ends_at may already be set as the planned upper bound)
                │
                ├──▶ ENDED     (window closed normally; ends_at finalized ≤ transition server time)
                └──▶ REVOKED   (terminated out-of-band, immediate; ends_at finalized ≤ transition server time)
```

`ENDED` and `REVOKED` are terminal for the row. There is no `ENDED → ACTIVE` or `REVOKED → ACTIVE`: renewing an entitlement creates a **new** assignment row.

### Active vehicle selection

```
NONE ──▶ SELECTED(assignment A)          the driver picks a usable assignment
SELECTED(A) ──▶ SELECTED(assignment B)   the driver switches to a different usable assignment
SELECTED(A) ──▶ NONE                     the driver clears the selection
```

A selection transition (`NONE → SELECTED(A)`, `SELECTED(A) → SELECTED(B)`) is valid only when `assignmentUsableAt(serverTime)` holds for the target assignment and `A.driver_id` is the selecting driver (see *Assignment usability* and *Invariants*). `SELECTED(A) → SELECTED(A)` is a no-op. `SELECTED(A) → NONE` is always allowed.

A selection becomes **stale** the moment `assignmentUsableAt(t)` goes `true → false` for its assignment — whether the cause is `status → ENDED`, `status → REVOKED`, an elapsed `ends_at`, the vehicle being archived, or a server-side vehicle block. Staleness is resolved by whether a shift is open:

- **No `OPEN` shift** — the server resets the selection to `NONE`. A new shift cannot be opened from a stale selection.
- **An `OPEN` shift exists** — the mutable `driver_active_vehicle` row is **no longer consulted as authority** (the shift's pinned tuple already is). The pinned tuple is kept until the shift closes safely (see *Downstream contract*); the stale selection is reset to `NONE` inside the shift-close transaction if the assignment is still unusable at that point.

A selection is **never** marked stale merely because another driver opened a shift on the same vehicle — see Invariant 5.

## Invariants

1. **Every critical operation uses `assignmentUsableAt(serverTime)`.** Selecting a vehicle, switching it, opening a `driver_shift`, and every server-side re-validation evaluate the full predicate — entitlement (`status` / `starts_at` / `ends_at`) **and** vehicle-operational (`archived` / server-side block) — never `status = ACTIVE` alone and never the entitlement half in isolation. See *Assignment usability*.
2. **Fail-closed on an unknowable vehicle state.** If `vehicleOperationalAt(t)` cannot be determined (a dependent vehicle-state service errors or is unreachable), selection / switch / shift-open are refused with a retryable error — never granted by default.
3. **At most one selected vehicle per driver.** `driver_active_vehicle` has at most one row per `driver_id` (PK on `driver_id`).
4. **Selection is not an occupancy lock.** The selected vehicle is **derived** from `assignment_id` (`driver_active_vehicle` stores no `vehicle_id` column), and there is **no** uniqueness on the derived vehicle across drivers. Several drivers who each hold a usable assignment on the same vehicle may each select it simultaneously. A selection is a preference — not a reservation, an occupancy lock, or proof of work — and carries no TTL, lease, or heartbeat; a forgotten selection can never block the vehicle for another driver.
5. **Exclusivity lives on the shift layer.** At most one `OPEN` `driver_shift` per `driver_id`, **and** at most one `OPEN` `driver_shift` per `vehicle_id`. This — not the selection — is what makes "one working driver per vehicle" true. Opening a shift when the vehicle already has an `OPEN` shift is rejected with `409 VEHICLE_ALREADY_IN_OPEN_SHIFT`; the losing driver's `driver_active_vehicle` selection is left intact (a preference that simply cannot become a shift right now), never cleared or flagged stale.
6. **Atomic switch.** Changing `driver_active_vehicle` (`NONE → SELECTED`, `SELECTED(A) → SELECTED(B)`, `SELECTED(A) → NONE`) is a single server transaction — it never leaves a driver with two selections or a half-written row. At the future database layer this is `db.tx` + a row lock on the driver's selection (`SELECT … FOR UPDATE`), consistent with the house `lock<Entity>By<Key>()` pattern.
7. **No switch during an `OPEN` shift.** While the driver has an `OPEN` `driver_shift`, the active-vehicle selection is frozen. The car for that shift is whatever the shift pinned; changing it mid-shift is not a selection change — it is closing the shift and opening a new one.
8. **No switch during an active ride.** While the driver has a non-terminal ride, the selection is frozen. "Active ride" = a `rides` row for the driver whose `status` is past `ACCEPTED` and not terminal: `ACCEPTED`, `DRIVER_EN_ROUTE`, `DRIVER_APPROACHING_PICKUP`, `WAITING_PASSENGER`, `IN_PROGRESS` (`server/src/domain/ride-status.js`; `TERMINAL_RIDE_STATUSES = {COMPLETED, CANCELED, NO_SHOW}`). Pre-accept states (`NEW_ORDER`, `CONFIRMATION_PENDING`, `CONFIRMED`, `CHAT_STARTED`) do not freeze the selection.
9. **Selection change requires a matching, usable target.** A `SELECTED(A) → SELECTED(B)` or `NONE → SELECTED(B)` transition is rejected unless `B.vehicle_id` and `B.driver_id` match the request **and** `assignmentUsableAt(serverTime)` holds for `B`.

## Read/write ownership

| Data | Stored where | Written by | Read by |
| --- | --- | --- | --- |
| `vehicles` row (owner, model, plate, `archived`, `is_active`) | PostgreSQL | garage CRUD (future BD-PROFILE-D-05x runtime slice) | Driver App garage, Assignment authority, Ops |
| `vehicle_driver_assignments` | PostgreSQL | Backend API on an owner / rental-operator / fleet-manager / Ops action — never the driver; `assigned_by_user_id` / `assigned_by_service_id` are server-resolved | Driver App (own assignments), Shift authority, Safety & Compliance, Ops |
| `driver_active_vehicle` | PostgreSQL | Backend API on the authenticated driver's own selection request, transactionally | Driver App (own selection), Shift authority (at shift-open) |
| Pinned shift tuple (`driver_id` + `vehicle_id` + `assignment_id`) | PostgreSQL (`driver_shift`) | Driver Availability / Presence at shift-open (BD-DRIVER-SHIFT-AUTHORITY) | Safety & Compliance, Dispatcher, Ops |
| Audit event | DB / audit ledger | backend services | Monitoring / Ops |

Client never writes `vehicle_driver_assignments` or `driver_active_vehicle` directly; it issues intent (`select vehicle X`) and the server validates and persists. No assignment or selection state is authoritative in `localStorage`.

## Audit events

This is a **future audit contract** — names are indicative, the sink and outbox are defined by the audit/monitoring slice (`BD-DRIVER-DOCUMENT-COMPLIANCE-01G` family), and no event emission or outbox wiring is part of 01A.

- `VEHICLE_DRIVER_ASSIGNMENT_CREATED`
- `VEHICLE_DRIVER_ASSIGNMENT_ENDED`
- `VEHICLE_DRIVER_ASSIGNMENT_REVOKED`
- `DRIVER_ACTIVE_VEHICLE_SELECTED`
- `DRIVER_ACTIVE_VEHICLE_SWITCHED`
- `DRIVER_ACTIVE_VEHICLE_CLEARED`
- `DRIVER_ACTIVE_VEHICLE_RESET_STALE` — server-initiated reset when a selection's assignment stops satisfying `assignmentUsableAt` and no `OPEN` shift protects it, or inside a shift-close transaction if still unusable
- `DRIVER_SHIFT_ASSIGNMENT_INVALIDATED` — the pinned assignment's `assignmentUsableAt` went `true → false` while its shift was `OPEN`
- `DRIVER_SHIFT_CLOSE_DEFERRED_FOR_ACTIVE_RIDE` — shift-close held until the in-flight ride reaches a terminal state
- `DRIVER_SHIFT_FORCED_CLOSED_ASSIGNMENT_UNUSABLE` — shift closed with `close_reason = ASSIGNMENT_UNUSABLE`

Each event records actor/source, `vehicle_id`, `driver_id`, `assignment_id` where applicable, `assignment_type`, previous/new state, and timestamp.

## Downstream contract — driver shift

`driver_shift` is owned by Driver Availability / Presence and specified in full by `BD-DRIVER-SHIFT-AUTHORITY-01A` (a later slice). This contract fixes only the parts Vehicle Assignment Authority depends on.

### Opening a shift

Opening an `OPEN` `driver_shift` is **one server transaction**:

```text
lock driver
lock vehicle
lock the selected assignment

assert  assignmentUsableAt(serverTime)                     -- full predicate, not status alone
assert  selected assignment belongs to this driver + this vehicle
assert  no OPEN driver_shift for this driver_id
assert  no OPEN driver_shift for this vehicle_id
assert  no active ride for this driver that blocks a shift change

insert OPEN driver_shift  pinning  driver_id + vehicle_id + assignment_id
```

- The pinned `driver_id` + `vehicle_id` + `assignment_id` are copied from the driver's `driver_active_vehicle` selection **at open time**, after the asserts pass.
- If the vehicle already has an `OPEN` shift: **`409 VEHICLE_ALREADY_IN_OPEN_SHIFT`**. The driver's `driver_active_vehicle` selection is **not** cleared or marked stale — it is a preference that simply cannot become a shift right now (a UI may later show "the car is in use by another driver").

### While a shift is `OPEN`

- The **shift's pinned tuple** — not the mutable `driver_active_vehicle` row, and not `vehicles.is_active` — is the authority for the Safety & Compliance evaluation context (`activeVehicleId`, `shiftId`).
- The `driver_active_vehicle` selection is frozen (Invariant 7). Closing the shift releases the freeze.

### An assignment becomes unusable during an `OPEN` shift

The policy fires on **any** `assignmentUsableAt(t): true → false` transition for the pinned assignment — `status → ENDED`, `status → REVOKED`, an elapsed `ends_at`, the vehicle archived, or a server-side vehicle block:

1. **New orders are blocked immediately.** The driver is removed from matching/dispatch for further trips at once, regardless of ride state.
2. **No active ride** — the shift is closed with `close_reason = ASSIGNMENT_UNUSABLE`, the driver is set `OFFLINE`, and the stale `driver_active_vehicle` selection is reset to `NONE`.
3. **A non-terminal active ride is in progress** — the current passenger trip is **not** cancelled or interrupted merely because the assignment became unusable:
   - no further trips are assigned;
   - the pinned `driver_id` + `vehicle_id` + `assignment_id` is retained as **identity / audit context** for the ride in flight;
   - once the ride reaches a terminal state (`COMPLETED` / `CANCELED` / `NO_SHOW`), the shift **must** close, the driver **must** be set `OFFLINE`, and the selection **must** be reset — all before the driver can re-enter matching/dispatch.
4. **Emergency interruption** of a passenger trip (e.g. a stolen-vehicle or acute-safety revocation) is the decision of a **separate Safety policy** and is out of scope for this contract. Vehicle Assignment Authority never, by itself, drops a passenger ride in progress.

This base policy is identical for `ENDED` and `REVOKED`. `REVOKED` additionally permits a higher-severity safety signal to Driver Availability, but the fate of the in-flight ride remains the separate Safety-policy decision above.

**Formulation to keep exact:** a retained pinned shift tuple preserves *identity and audit context* only — it does **not** imply the assignment is still usable.

### Minimal `driver_shift` shape assumed here (defined fully by `BD-DRIVER-SHIFT-AUTHORITY-01A`)

```text
driver_shift
  id
  driver_id       FK → users(id)
  vehicle_id      FK → vehicles(id)
  assignment_id   FK → vehicle_driver_assignments(id)
  status          OPEN | CLOSED
  close_reason    NULL | ASSIGNMENT_UNUSABLE | ...   (vocabulary owned by the shift slice)
  opened_at
  closed_at
```

with "at most one `OPEN` shift per `driver_id`" and "at most one `OPEN` shift per `vehicle_id`".

## `vehicles.is_active` — legacy / derived only

`vehicles.is_active` and `uq_vehicles_one_active` describe **an owner's single active garage vehicle** — a client convenience materialised from `driverGarage.activeVehicleId` (BD-PROFILE-D-05D). They do **not** describe the working-driver relationship and must never be read as such.

Once `driver_active_vehicle` exists:

- No server decision (assignment validation, shift open, compliance context, dispatch) reads `vehicles.is_active`.
- The runtime slice **may** keep `is_active` maintained as a **derived** flag for backward compatibility with existing garage reads/indexes — set only for the **owner-driver** case (`assignment_type = OWNER`, `driver_id = owner_user_id`) as a mirror of that driver's `driver_active_vehicle` — or it may deprecate the column outright. Either choice is a runtime-slice decision; this contract only forbids treating `is_active` as a production source of truth.
- The existing garage UI (`public/src/garage.js` `resolveActiveGarageVehicle`) continues to drive the *client-side* display snapshot for `/respond` and the handoff card unchanged; it is not authoritative for any backend decision.

## 01A non-goals

This slice does not add:

- DB migration (no `vehicle_driver_assignments`, `driver_active_vehicle`, or `driver_shift` table is created here)
- backend route / runtime / API
- a `repositories/vehicles.js` or any server code that reads or writes `vehicles`
- PWA changes (no garage screen, `state.js`, or `garage.js` change)
- Service Worker / precache / CSP changes
- Dispatcher / matching / Presence enforcement
- Driver Shift Authority implementation (`BD-DRIVER-SHIFT-AUTHORITY`)
- Driver Document Compliance implementation (`BD-DRIVER-DOCUMENT-COMPLIANCE-01B` and later)
- any change to `vehicles.is_active` behaviour, or its removal

## Follow-up slices

1. `BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01B` — PostgreSQL schema (`vehicle_driver_assignments`, `driver_active_vehicle`) + repository primitives + schema/readiness tests + a dark API seam that is not yet a live route.
2. `BD-DRIVER-VEHICLE-ASSIGNMENT-AUTHORITY-01C` (if needed) — the authenticated driver selection endpoint + owner/fleet assignment-management endpoints, live.
3. `BD-DRIVER-SHIFT-AUTHORITY-01A` / `01B` — the `driver_shift` contract, then its schema + open/close writes via partial-promotion of `services/availability`, pinning `driver_id` + `vehicle_id` + `assignment_id`.
4. `BD-DRIVER-DOCUMENT-COMPLIANCE-01B` — the compliance schema (`driver_document_lineages` + `driver_documents`) now able to bind `WAYBILL` / `MEDICAL_CHECK` to a real `shift_id` with a real FK.
5. `BD-DRIVER-DOCUMENT-COMPLIANCE-01C` … `01G` — upload/storage, verification lifecycle + projection + reconciliation, Driver App consumption, ONLINE enforcement, audit/monitoring.

## Figma boundary

The design reference belongs under the existing driver garage surface (`BD-PROFILE-D-05x`, the garage section of `/profile` driver mode). Figma owns visual and interaction intent for choosing and switching the active vehicle only. Backend contracts own vehicle entitlement, the current selection, and the shift binding that Safety & Compliance reads.
