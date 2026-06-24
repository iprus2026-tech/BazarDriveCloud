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

// Where the defect actually bites — kept SEPARATE from severity (which is
// code-correctness). Drives real triage priority: a code-severe MEL reachable
// only via a dev/QA param is lower-priority than a user-path one (this is the
// distinction that made the garage demo-2 MEL-B a WONTFIX). BD-OPS / #684 #3.
export const MEL_REACHABILITY = ['user-path', 'dev-param', 'edge'];

// #684 R4 — floor vs ceiling: is this a BASELINE break (must-fix to be acceptable — a
// broken focus-trap, a dead-end CTA) or a POLISH opportunity (a quality ceiling — a
// cosmetic gap)? Orthogonal to severity (code-correctness) and reachability (where it
// bites): the #732 audit bucketed a baseline a11y break and a cosmetic item under the
// same MEL-C band. '' = unclassified. The port plan sequences all floor before any ceiling.
export const MEL_TIER = ['floor', 'ceiling'];

// #684 #10 — which lifecycle ENTRY-STATES the audit probed. Separate from #3
// reachability (HOW the screen is reached): this is WHAT STATE the entity is in on
// entry. All three BD-RESPONSES-01 (#688) rounds were entry-state edges the
// single-tap audit missed (first-entry leak, live regression, terminal/re-entry).
export const MEL_LIFECYCLE_STATES = ['first-entry', 'live-mid-flow', 'terminal', 're-entry'];

// Validate + canonicalise (dedupe + order) the audited-states array.
function sanitizeLifecycle(value) {
  return Array.isArray(value) ? MEL_LIFECYCLE_STATES.filter((st) => value.includes(st)) : [];
}

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

// All MEL cards across every screen, in one read — the registry list groups
// these by screenId to render per-row badges without a load() per screen.
export function listAllMel() {
  return load();
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
    reachability: MEL_REACHABILITY.includes(input.reachability) ? input.reachability : 'user-path',
    // #684 R4 — floor (baseline-broken / must-fix) vs ceiling (polish). '' = unclassified.
    tier: MEL_TIER.includes(input.tier) ? input.tier : '',
    // #684 #2 — stable selector/symbol anchor (e.g. #pf2-doc-add, markGarageVehicleActive).
    // Line numbers drift; the anchor + the prompt's grep-locate re-resolve at fix time.
    selector: typeof input.selector === 'string' ? input.selector : '',
    // #684 #4 — the PR / commit that resolved this MEL (the MEL→ship trail), so a
    // screen's MEL history shows what actually shipped. Free-text (#683 or a SHA).
    pr: typeof input.pr === 'string' ? input.pr : '',
    // #684 — role-variant-keyed MEL: the declared variant key this MEL is scoped to
    // (e.g. 'guest'), or '' for the whole screen. Free-text here; the dashboard form
    // constrains it to the screen's declared variants (the store keeps no registry dep).
    variant: typeof input.variant === 'string' ? input.variant : '',
    // #684 #10 — the lifecycle entry-states the audit actually probed.
    lifecycleAudited: sanitizeLifecycle(input.lifecycleAudited),
    problem: input.problem || '',
    operationalDecision: input.operationalDecision || '',
    requiredRepair: input.requiredRepair || '',
    // #684 R7 — the recommended INVARIANT GUARD (the auditor's #684 R3 output): a drafted static
    // smoke pin for the recurring class, carried into the repair prompt + the MEL export. Free-text;
    // patched through ...patch on update like the other free-text fields.
    recommendedGuard: input.recommendedGuard || '',
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
  const reachCandidate = patch.reachability !== undefined ? patch.reachability : cur.reachability;
  const tierCandidate = patch.tier !== undefined ? patch.tier : cur.tier;
  const lcCandidate = patch.lifecycleAudited !== undefined ? patch.lifecycleAudited : cur.lifecycleAudited;
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
    reachability: MEL_REACHABILITY.includes(reachCandidate) ? reachCandidate : (cur.reachability || 'user-path'),
    // #684 R4 — '' is the documented "unclassified" value, so accept it EXPLICITLY: an update that
    // clears the tier must win, not fall back to the stale cur.tier (Codex #758).
    tier: (tierCandidate === '' || MEL_TIER.includes(tierCandidate)) ? tierCandidate : (cur.tier || ''),
    lifecycleAudited: sanitizeLifecycle(lcCandidate),
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
