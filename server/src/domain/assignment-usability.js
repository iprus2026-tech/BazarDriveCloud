// /server/src/domain/assignment-usability.js — the frozen tri-state
// assignmentUsabilityDecision(t) from docs/driver-vehicle-assignment-authority-contract.md
// ("Assignment usability"): confirmed entitlement-negative  >  archived vehicle  >  injected
// block-state resolver (UNBLOCKED / BLOCKED / UNKNOWN), in that exact short-circuit order.
//
// Extracted here by BD-DRIVER-SHIFT-AUTHORITY-01C-A so BOTH authority services compose the
// SAME decision from ONE copy, never a second driftable one:
//   - services/driver-shift-authority/index.js            — shift-open + server-forced reconcile
//   - services/driver-vehicle-assignment-authority/index.js — driver-initiated select / switch
//
// domain/vehicle-assignment.js already anticipated this move: its header says "Composing the
// full tri-state assignmentUsabilityDecision(t) therefore belongs to a later slice, once a
// block-state source exists" — this file is that composition. It still only decides the
// ENTITLEMENT half from authoritative storage (via the caller's PostgreSQL-computed
// `entitled_now` on the LOCKED assignment row); the OPERATIONAL half's block state comes from
// an INJECTED server resolver, never client input.

// resolveVehicleBlockState is an INJECTED, internal server dependency — never client input.
// The default implementation always returns 'UNKNOWN' (there is no authoritative block-state
// resolver wired in yet); tests may supply a deterministic resolver to exercise the
// UNBLOCKED / BLOCKED / UNKNOWN paths. Its absence/error must yield an UNKNOWN decision with
// zero durable writes — callers below never let a thrown/rejected resolver escape as an
// uncaught error into a partially-decided state.
export async function defaultResolveVehicleBlockState(_vehicleId, _client) {
  return 'UNKNOWN';
}

// Classify WHICH confirmed-negative reason applies when a locked assignment's entitled_now is
// false. status ENDED/REVOKED are unambiguous from the row alone. status ACTIVE but not
// entitled_now means either the window hasn't opened yet (BEFORE_START) or it has closed
// (ELAPSED) — distinguishing those needs a time reference, fetched here via a bare
// `SELECT now()` (no table touched, so this does not violate vehicle_driver_assignments.js's
// single-SQL-seam ownership of that table) so the comparison is anchored to PostgreSQL's own
// clock, never the JS host clock — no app/DB clock-skew window.
async function classifyEntitlementUnusableReason(client, assignment) {
  if (assignment.status === 'ENDED') return 'ENDED';
  if (assignment.status === 'REVOKED') return 'REVOKED';
  const { rows: [{ server_now: serverNow }] } = await client.query('SELECT now() AS server_now');
  if (assignment.starts_at != null && new Date(assignment.starts_at) > serverNow) return 'BEFORE_START';
  return 'ELAPSED';
}

// The tri-state usability decision, in the frozen short-circuit order: confirmed
// entitlement-negative first (real DB data, already locked) -> archived vehicle (real DB
// data, already locked) -> injected block-state resolver (UNBLOCKED/BLOCKED/UNKNOWN) only
// once the first two are clear. Returns { decision: 'USABLE' | 'UNKNOWN' | 'UNUSABLE', reason }
// — reason is null unless decision === 'UNUSABLE'.
export async function decideAssignmentUsability(client, { assignment, vehicle, resolveVehicleBlockState }) {
  if (!assignment.entitled_now) {
    const reason = await classifyEntitlementUnusableReason(client, assignment);
    return { decision: 'UNUSABLE', reason };
  }
  if (vehicle.archived) {
    return { decision: 'UNUSABLE', reason: 'ARCHIVED' };
  }
  let blockState;
  try {
    blockState = await resolveVehicleBlockState(vehicle.id, client);
  } catch {
    blockState = 'UNKNOWN'; // resolver failure fails closed to UNKNOWN, never to USABLE.
  }
  if (blockState === 'BLOCKED') return { decision: 'UNUSABLE', reason: 'BLOCKED' };
  if (blockState !== 'UNBLOCKED') return { decision: 'UNKNOWN', reason: null }; // covers 'UNKNOWN' and any unrecognized value — fail closed.
  return { decision: 'USABLE', reason: null };
}
