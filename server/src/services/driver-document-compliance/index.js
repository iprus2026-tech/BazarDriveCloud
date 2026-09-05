// /server/src/services/driver-document-compliance/index.js — BD-DRIVER-DOCUMENT-COMPLIANCE-01B
// (rebuild) dark seam.
//
// Deliberately NOT a Fastify plugin, and deliberately NOT listed in services/index.js
// SERVICES: importing this file registers no route and adds no HTTP surface — grep
// services/index.js and there is no reference to this directory. Mirrors
// services/driver-vehicle-assignment-authority/index.js's own "one level darker than a
// registered 501 stub" positioning (docs/driver-document-compliance-contract.md's own "01A
// non-goals" carries forward into this schema-only 01B: no backend route/runtime yet).
//
// It exists only to give a future 01C-or-later runtime (authorized upload, the verification
// lifecycle, the compliance projection) ONE stable import path for the 0007 repository
// primitives, instead of reaching into server/src/repositories/* directly.
//
// Orchestration this file deliberately does NOT provide: composing a lock order (lineage ->
// open-submission check -> insert), deriving/validating driverId/vehicleId/shiftId from
// server-owned state (the authenticated session, the OPEN driver_shift's own pinned
// vehicle_id — never client input), the full verification/activation state machine
// (docs/driver-document-compliance-contract.md "Approval vs. activation"), and the
// compliance projection (documentsReady / shiftReady / complianceReady) are all explicitly
// OUT of scope for this slice and belong to a later, separately-scoped runtime.
export * as driverDocumentCompliance from '../../repositories/driver_document_compliance.js';
