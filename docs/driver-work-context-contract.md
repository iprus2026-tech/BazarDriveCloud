# BD-PROFILE-D-WORK-CONTEXT-01A

Status: contract-first / docs-only, audit + contract

Issue: #990

Baseline: `main@2996264dd5fa896235cad1bccd45ec2d881e496e`

Architecture: Driver App / Driver Availability / Backend API contract / DB authority mapping

Runtime impact: none

## Goal

Freeze the server-authoritative **Driver Work Context** read model that the existing Driver Profile can consume in a later runtime slice, without changing UI/PWA, localStorage, backend runtime/routes, DB schema, migrations, service registration, or runtime tests in 01A.

The work context joins existing authority layers rather than creating a new business entity:

```
authenticated driver session
        ↓
driver_active_vehicle
        ↓
vehicle_driver_assignments
        ↓
vehicles
        ↓
driver_shift
```

The Profile is a consumer of this model, not its authority.

## Audit findings

The required backend substrate already exists:

- session identity: `req.resolveUser().userId`
- entitlement: `vehicle_driver_assignments`
- current pre-shift selection: `driver_active_vehicle`
- canonical vehicle identity/data: `vehicles`
- working identity: `driver_shift`
- transactional shift primitives: `openDriverShift`, `closeDriverShift`, `getOpenDriverShift`

These authority services are currently dark and are not registered as live Driver App HTTP routes.

Current Profile mirrors such as `driverGarage.activeVehicleId`, `driverOnline`, and `shiftOpen` remain prototype state and are not backend authority.

## Ownership

The future read model belongs to **Driver Availability / work-context projection**, not to a new Profile domain.

Conceptual future endpoint, **not implemented by 01A**:

```
GET /api/v1/availability/work-context
Authorization: Bearer <session>
```

The authenticated driver identity is resolved server-side from `req.resolveUser()`. The caller must hold a driver session/role. `driverId`, `vehicleId`, `assignmentId`, `shiftId`, timestamps, and online state are never accepted from the client as authority inputs.

## Read model

Minimum conceptual response:

```json
{
  "state": "SHIFT_OPEN",
  "selection": {
    "assignmentId": "uuid",
    "selectedAt": "server-timestamp",
    "vehicle": {
      "id": "uuid",
      "model": "Toyota Prius",
      "color": "Жёлтый",
      "plate": "X500OX790",
      "archived": false
    }
  },
  "openShift": {
    "id": "uuid",
    "assignmentId": "uuid",
    "openedAt": "server-timestamp",
    "vehicle": {
      "id": "uuid",
      "model": "Toyota Prius",
      "color": "Жёлтый",
      "plate": "X500OX790",
      "archived": false
    }
  }
}
```

`openShift` is either `null` or the driver's current `OPEN` shift. Closed shift history is not part of this projection.

No new persisted `state` field is introduced. It is derived from the authoritative rows:

```
NO_SELECTION
  selection = null
  openShift = null

SELECTED
  selection != null
  openShift = null

SHIFT_OPEN
  selection != null
  openShift != null
```

Any other combination is an authority-integrity failure, not a fourth business state.

When a shift is OPEN, the working identity comes from the pinned shift tuple:

```
workingDriverId     = driver_shift.driver_id
workingVehicleId    = driver_shift.vehicle_id
workingAssignmentId = driver_shift.assignment_id
```

The mutable `driver_active_vehicle` row remains the driver's pre-shift selection/preference and must never replace the pinned shift tuple as working authority.

## Integrity invariants

For the driver's own OPEN shift, the server projection must not silently repair contradictory authority state.

Expected consistency while the normal selection freeze holds:

```
openShift.assignmentId == selection.assignmentId
openShift.vehicle.id    == selection.vehicle.id
```

If authority rows are contradictory, the future read path must surface an integrity/server failure and monitoring signal rather than selecting an arbitrary local/browser value.

`vehicles.is_active` and any localStorage mirror are explicitly excluded from server authority decisions.

## Snapshot consistency

The future work-context read must represent one coherent PostgreSQL snapshot of selection + assignment + vehicle + OPEN shift.

01A freezes the semantic requirement only. A later runtime slice may implement it with one SQL statement or a read-only transaction whose isolation guarantees one consistent snapshot for all component reads (for example, `REPEATABLE READ`). It must not compose independently timed client-side or default `READ COMMITTED` multi-statement reads into a false state.

Ordinary display reads do not require mutation locks or `FOR UPDATE`.

## Presence boundary

`OPEN shift != ONLINE`.

Presence remains a separate future Availability/Redis state machine. Target direction:

```
ONLINE => exactly one OPEN driver_shift
OPEN driver_shift !=> ONLINE
```

Therefore this 01A work-context contract does **not** add or infer `ONLINE`, `OFFLINE`, or `BUSY`.

## Compliance boundary

01A does not compute document/compliance readiness.

Later compliance consumption uses the OPEN shift's pinned context:

```
{ driverId, shiftId, activeVehicleId = driver_shift.vehicle_id }
```

WAYBILL / MEDICAL_CHECK remain owned by Driver Document Compliance.

## Current local mirrors

These remain untouched in 01A and are classified as prototype mirrors, not production authority:

- `driverOnline`
- `shiftOpen`
- `driverGarage.activeVehicleId`
- legacy `vehicleMake` / `vehicleModel` / `vehiclePlate`

No migration, deletion, synchronization writer, or behavior change is authorized in this slice.

## UI mapping for a later runtime slice

Without redesigning the existing Profile:

- **Overview** may consume selected vehicle + OPEN shift fact.
- **Garage** may consume server selection instead of local `driverGarage.activeVehicleId`.
- **Такси·ИП** may consume OPEN/CLOSED shift state.
- **Documents** may later use `openShift.id` as the context for shift-scoped compliance.

01A changes none of those surfaces.

## Non-goals

01A must not modify or add:

- Profile/UI/PWA runtime
- `public/src/screens/profile.js`
- `public/src/state.js`
- `public/src/garage.js`
- localStorage schema or migration
- live backend route or Fastify service registration
- Availability runtime
- shift open/close HTTP actions
- database schema, migration, table, column, index, trigger, or seed
- runtime tests
- Presence/Redis/heartbeat
- compliance upload/verification runtime
- rating
- payouts/taxes
- Safety runtime
- Matching/Dispatcher
- Mapbox
- Service Worker / precache / CSP
- PR creation or merge

## Acceptance criteria

1. No new domain entity duplicates `driver_active_vehicle` or `driver_shift`.
2. Authenticated `driverId` is server-resolved and never accepted as client authority.
3. Before a shift, selection is sourced from `driver_active_vehicle`; with an OPEN shift, working identity is sourced from the pinned `driver_shift` tuple.
4. `vehicles.is_active` and localStorage never participate in backend authority.
5. ONLINE/OFFLINE/BUSY and compliance readiness remain outside 01A.
6. The read model is specified as one coherent server snapshot.
7. Contradictory selection/OPEN-shift combinations fail closed as integrity errors instead of being silently repaired.
8. UI, localStorage, backend runtime, DB, tests runtime, SW and CSP remain unchanged.
9. Any repository documentation file/commit/PR requires a separate protected authorization gate.
