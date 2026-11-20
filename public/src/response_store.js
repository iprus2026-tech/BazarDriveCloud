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

// #1188 — backend OFF: the owner's edit of an open order, applied to the open local offers on it
// by the server's rule (server/repositories/offers.js). A new price rejects every SENT offer
// (`rejectedBy: 'passenger_edit'`, the driver may offer again — respond.js writes a fresh SENT
// entry, which also drops the marks); a new time or comment keeps them, marked `previousTermsAt`.
// Returns how many offers changed. The one write this module makes, next to respond.js's own.
export function reconcileResponsesAfterOrderEdit(orderId, { priceChanged = false, termsChanged = false, at = new Date().toISOString() } = {}) {
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  if (!id || (!priceChanged && !termsChanged)) return 0;
  const map = loadAllResponses();
  let changed = 0;
  for (const [key, r] of Object.entries(map)) {
    if (!r || typeof r !== 'object' || r.kind !== 'passenger_response' || String(r.orderId || '') !== id || r.status !== 'SENT') continue;
    map[key] = priceChanged
      ? { ...r, status: 'REJECTED', rejectedBy: 'passenger_edit', rejectedReason: 'order_price_changed', rejectedAt: at }
      : { ...r, previousTermsAt: at };
    changed += 1;
  }
  if (!changed) return 0;
  try {
    localStorage.setItem(RESPONSES_KEY, JSON.stringify(map));
  } catch {
    return 0;
  }
  return changed;
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

// «Вы откликнулись · 950 ₽» for a CTA, or '' when the post has no own offer.
export function ownOfferLabel(postId) {
  const offer = findOwnOfferForPost(postId);
  if (!offer) return '';
  const n = Number(offer.driverPrice);
  let price;
  try { price = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n); } catch { price = String(n); }
  return `Вы откликнулись · ${price} ₽`;
}

// #1176 — the local user's own driver offer for a feed post, if one was sent from this device
// and is still an open offer: the exact `resp_<postId>` entry, status SENT, with a real price.
// The store is user-scoped (cleared at the auth boundary), so an entry belongs to the current
// account. Device-local on purpose: it answers "did I respond here?" for the feed, the post
// screen and the respond form; it is not a server read.
export function findOwnOfferForPost(postId) {
  const id = typeof postId === 'string' || typeof postId === 'number' ? String(postId).trim() : '';
  if (!id) return null;
  const r = resolveResponseById(`resp_${id}`);
  if (!r || r.status !== 'SENT' || String(r.requestId) !== id) return null;
  const price = Number(r.driverPrice);
  return Number.isFinite(price) && price > 0 ? r : null;
}
