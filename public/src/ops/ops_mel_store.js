// BD-OPS-03 — ScreenOps MEL card local store (dev/docs tool).
//
// MEL cards are dev-tool-local data, persisted under a dedicated key. This data
// is intentionally NOT part of the user-scoped storage boundary
// (public/src/storage_boundary.js): an ordinary passenger / driver logout must
// not wipe a developer's MEL log. `clearOpsMel()` is exposed for explicit dev
// use only and is deliberately NOT wired into user.reset() / logout flows.
//
// No network. localStorage is the only persistence surface.

const KEY = 'bazardrive.ops.mel.v1';

// Canonical MEL vocab — used to validate createMelCard input. Module-local: not
// part of the public API (no consumer imports these), but the authoritative
// source for the allowed values, so an edit here actually changes behaviour.
const MEL_SEVERITIES = ['MEL-A', 'MEL-B', 'MEL-C', 'MEL-D', 'WAITING', 'OK'];
const MEL_STATUSES = [
  'DETECTED',
  'NEEDS_AUDIT',
  'WAITING_FOR_CLOUD_DESIGN',
  'CONTRACT_READY',
  'READY_FOR_DEV',
  'IN_DEV',
  'IN_REVIEW',
  'DONE',
];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Returns true on success, false if persistence failed (quota / private mode),
// so callers can surface the failure instead of falsely reporting success.
function save(cards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
    return true;
  } catch {
    return false;
  }
}

function uid() {
  return 'mel_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

export function listMelForScreen(screenId) {
  return load().filter((c) => c.screenId === screenId);
}

// Creates a MEL card. Severity/status are validated against the canonical vocab.
// Returns the card on success, or null if it could not be persisted.
export function createMelCard(input = {}) {
  const cards = load();
  const now = new Date().toISOString();
  const card = {
    id: uid(),
    screenId: input.screenId || '',
    route: input.route || '',
    file: input.file || '',
    severity: MEL_SEVERITIES.includes(input.severity) ? input.severity : 'MEL-C',
    status: MEL_STATUSES.includes(input.status) ? input.status : 'DETECTED',
    problem: input.problem || '',
    operationalDecision: input.operationalDecision || '',
    requiredRepair: input.requiredRepair || '',
    createdAt: now,
    updatedAt: now,
  };
  cards.push(card);
  return save(cards) ? card : null;
}

// Dev-only reset. Intentionally not part of the storage boundary / logout path.
export function clearOpsMel() {
  save([]);
}
