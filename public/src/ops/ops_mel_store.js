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

function save(cards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards));
  } catch {
    /* storage unavailable (private mode / quota) — dev tool degrades quietly */
  }
}

function uid() {
  return 'mel_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

export function listMelCards() {
  return load();
}

export function listMelForScreen(screenId) {
  return load().filter((c) => c.screenId === screenId);
}

export function createMelCard(input = {}) {
  const cards = load();
  const now = new Date().toISOString();
  const card = {
    id: uid(),
    screenId: input.screenId || '',
    route: input.route || '',
    file: input.file || '',
    severity: input.severity || 'MEL-C',
    status: input.status || 'DETECTED',
    problem: input.problem || '',
    operationalDecision: input.operationalDecision || '',
    requiredRepair: input.requiredRepair || '',
    createdAt: now,
    updatedAt: now,
  };
  cards.push(card);
  save(cards);
  return card;
}

export function updateMelCard(id, patch = {}) {
  const cards = load();
  const i = cards.findIndex((c) => c.id === id);
  if (i === -1) return null;
  cards[i] = { ...cards[i], ...patch, id: cards[i].id, updatedAt: new Date().toISOString() };
  save(cards);
  return { ...cards[i] };
}

export function deleteMelCard(id) {
  save(load().filter((c) => c.id !== id));
}

// Dev-only reset. Intentionally not part of the storage boundary / logout path.
export function clearOpsMel() {
  save([]);
}
