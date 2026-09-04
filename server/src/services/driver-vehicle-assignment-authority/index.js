// /server/src/services/driver-vehicle-assignment-authority/index.js — BD-DRIVER-VEHICLE-
// ASSIGNMENT-AUTHORITY-01B dark seam.
//
// Deliberately NOT a Fastify plugin, and deliberately NOT listed in services/index.js
// SERVICES: importing this file registers no route and adds no HTTP surface — grep
// services/index.js and there is no reference to this directory. Contrast with
// services/availability (a REGISTERED darkService() plugin that answers 501 at a real
// /api/v1/availability path); this module is one level darker still — it is not reachable
// over HTTP at all yet, matching the contract's own follow-up-slice wording: 01B ships "...a
// dark API seam that is not yet a live route" (docs/driver-vehicle-assignment-authority-
// contract.md, "Follow-up slices").
//
// It exists only to give a future 01C runtime (the authenticated driver selection endpoint +
// owner/fleet assignment-management endpoints) ONE stable import path for the 0005
// repository primitives, instead of reaching into server/src/repositories/* directly.
//
// Orchestration this file deliberately does NOT provide: the contract's full
// "Selection-mutation sequence" and "Opening a shift" also require asserting "no OPEN
// driver_shift" and "no non-terminal ride" (docs/driver-vehicle-assignment-authority-
// contract.md, Invariants 7-8). driver_shift does not exist yet (BD-DRIVER-SHIFT-AUTHORITY is
// a later, separate slice) and reading `rides` state to enforce those guards reaches into the
// matching/dispatch domain — both are explicitly out of bounds for this slice. Composing
// those checks belongs to 01C (or later), once driver_shift exists; wiring any of this behind
// a real route is likewise 01C's job, not this file's.
export * as vehicleDriverAssignments from '../../repositories/vehicle_driver_assignments.js';
export * as driverActiveVehicle from '../../repositories/driver_active_vehicle.js';
