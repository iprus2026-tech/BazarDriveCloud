// BD-RIDE-AUTHORITY-01D — Response store leaf module.
// Foundation layer only. No screen imports, no DOM, no navigation.
//
// Owns the read side of the `bazardrive.responses.v1` keyed store: the
// exact-key lookup (resolveResponseById) plus the one raw-parse primitive
// (loadAllResponses) that both this module and responses.js's own
// by-orderId scan (loadResponsesForOrder, used by the /responses board)
// build on — so RESPONSES_KEY has exactly one literal declaration and
// exactly one file that ever calls localStorage for it (the BD-DATA-
// STATIC-01 gate only resolves same-file `const NAME = 'literal'`
// storage-key arguments; a raw `localStorage.getItem(RESPONSES_KEY)` in
// responses.js off an imported constant would show up as an unresolved
// dynamic key). The write side (respond.js) and the filter-by-orderId
// logic stay exactly where they are — this module is deliberately narrow,
// not a migration of the whole responses persistence subsystem.

export const RESPONSES_KEY = 'bazardrive.responses.v1';

// Raw read + parse of the whole keyed store. Returns {} for: no storage,
// malformed JSON, or a non-object payload. Callers filter/scan the
// returned map themselves — this primitive makes no assumption about
// what they're looking for.
export function loadAllResponses() {
  try {
    const raw = localStorage.getItem(RESPONSES_KEY);
    if (!raw) return {};
    const map = JSON.parse(raw);
    return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  } catch {
    return {};
  }
}

// Exact-key lookup only. Returns the stored passenger_response for this
// exact responseId, or null for: missing id, no storage, malformed JSON,
// a non-object map, a missing entry, or the wrong kind. Never falls back
// to latest/first/guess — a caller holding a stale or foreign responseId
// gets null, not a coincidentally-similar record. This module does not
// claim global uniqueness of responseId across the store; it guarantees
// only that a lookup by exact key returns that key's own entry.
export function resolveResponseById(responseId) {
  const id = typeof responseId === 'string' ? responseId.trim() : '';
  if (!id) return null;
  const map = loadAllResponses();
  const r = map[id];
  return (r && typeof r === 'object' && r.kind === 'passenger_response') ? r : null;
}
