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

// Canonical MEL vocab — exported so the dashboard's MEL editor can build its
// severity/status selects, and used here to validate create/update input.
export const MEL_SEVERITIES = ['MEL-A', 'MEL-B', 'MEL-C', 'MEL-D', 'WAITING', 'OK'];
export const MEL_STATUSES = [
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

// The next status in the lifecycle, or the same status if already terminal/unknown.
export function nextMelStatus(status) {
  const i = MEL_STATUSES.indexOf(status);
  return i === -1 || i === MEL_STATUSES.length - 1 ? status : MEL_STATUSES[i + 1];
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

// Patches a MEL card's editable fields (severity/status/problem/
// operationalDecision/requiredRepair). id, screenId, route, file and createdAt
// are screen-derived/identity and stay immutable; updatedAt is refreshed;
// severity/status are validated against the vocab (invalid values keep the
// current value). Returns the updated card, or null if the id is unknown or
// persistence failed.
export function updateMelCard(id, patch = {}) {
  const cards = load();
  const i = cards.findIndex((c) => c.id === id);
  if (i === -1) return null;
  const cur = cards[i];
  const sevCandidate = patch.severity !== undefined ? patch.severity : cur.severity;
  const statusCandidate = patch.status !== undefined ? patch.status : cur.status;
  const next = {
    ...cur,
    ...patch,
    id: cur.id,
    screenId: cur.screenId,
    route: cur.route,
    file: cur.file,
    createdAt: cur.createdAt,
    severity: MEL_SEVERITIES.includes(sevCandidate) ? sevCandidate : cur.severity,
    status: MEL_STATUSES.includes(statusCandidate) ? statusCandidate : cur.status,
    updatedAt: new Date().toISOString(),
  };
  cards[i] = next;
  return save(cards) ? { ...next } : null;
}

// Deletes a MEL card by id. Returns true if a card was removed and persisted.
export function deleteMelCard(id) {
  const cards = load();
  const next = cards.filter((c) => c.id !== id);
  if (next.length === cards.length) return false;
  return save(next);
}

// Dev-only reset. Intentionally not part of the storage boundary / logout path.
export function clearOpsMel() {
  save([]);
}
