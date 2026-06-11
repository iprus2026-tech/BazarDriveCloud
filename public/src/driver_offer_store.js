// BD-ORDER-DETAIL-01D-1 — DriverOffer local store.
//
// Persists DriverOffers behind `bazardrive.driver_offers.v1`, keyed by
// (orderId, driverId) so a repeated «Откликнуться на заказ» tap is
// naturally idempotent — the same composite key is overwritten, never
// duplicated. The shape mirrors the Model B contract documented in
// docs/screen-contracts.md but the store is intentionally tiny:
//
//   {
//     [orderId]: {
//       [driverId]: {
//         id, orderId, driverId, status, createdAt, updatedAt
//       }
//     }
//   }
//
// This slice (01D-1) supports only `status: 'sent' | 'withdrawn'`. The
// remaining Model B statuses (`accepted`, `rejected`, `expired`) are
// owned by later 01D sub-slices and the future system/TTL job.
//
// No backend, no Mapbox, no fetch. The store is a pure-JS abstraction
// over localStorage with safe fallbacks (parse errors → empty store, no
// localStorage → in-memory throwaway).

const STORAGE_KEY = 'bazardrive.driver_offers.v1';

// In-memory fallback so headless tests and incognito sessions don't
// crash on `localStorage` absence.
const _memoryStore = { value: '' };

function safeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touch to flush iOS-style quota errors early.
    const probe = '__bd_driver_offer_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw() {
  const ls = safeLocalStorage();
  if (ls) return ls.getItem(STORAGE_KEY);
  return _memoryStore.value || null;
}

function writeRaw(value) {
  const ls = safeLocalStorage();
  if (ls) { ls.setItem(STORAGE_KEY, value); return; }
  _memoryStore.value = value;
}

function loadStore() {
  const raw = readRaw();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(map) {
  writeRaw(JSON.stringify(map));
}

function nowIso() {
  return new Date().toISOString();
}

function isString(v) {
  return typeof v === 'string' && v.length > 0;
}

// Frozen status set for 01D-1. The store accepts only these two values
// when callers attempt to write a status; anything else is treated as a
// caller bug and rejected (the helpers below never expose that path).
export const DRIVER_OFFER_STATUS = Object.freeze({
  SENT:      'sent',
  WITHDRAWN: 'withdrawn',
});

export const DRIVER_OFFERS_STORAGE_KEY = STORAGE_KEY;

// Build a stable offer id from the composite key — keeps the
// (orderId, driverId) → 1 offer invariant explicit even outside the
// store map.
function buildOfferId(orderId, driverId) {
  return `offer_${orderId}_${driverId}`;
}

// Return the offer for (orderId, driverId) or null. Reads on every
// call so callers see the freshest store; the cost is one JSON parse
// per read which is fine for the read/render path.
export function getDriverOffer(orderId, driverId) {
  if (!isString(orderId) || !isString(driverId)) return null;
  const store = loadStore();
  const bucket = store[orderId];
  if (!bucket || typeof bucket !== 'object') return null;
  const off = bucket[driverId];
  return off && typeof off === 'object' ? off : null;
}

// Returns every offer the store carries for a given order, in
// insertion order from the underlying JSON map. Terminal offers
// (`withdrawn`) are included — Order Detail filters selectable
// candidates with activeSentOffers() at the render layer.
export function listDriverOffersForOrder(orderId) {
  if (!isString(orderId)) return [];
  const store = loadStore();
  const bucket = store[orderId];
  if (!bucket || typeof bucket !== 'object') return [];
  return Object.values(bucket).filter((v) => v && typeof v === 'object');
}

// Idempotent send. The (orderId, driverId) key guarantees we never
// create a duplicate sent offer for the same driver/order. The four
// states callers care about:
//   • no existing offer            → create with status='sent'
//   • existing with status='sent'  → no-op (return existing). The
//     screen surface toasts "уже отправлен" in this case.
//   • existing with status='withdrawn' → re-send: flip to 'sent',
//     bump updatedAt, keep createdAt.
//   • caller-supplied driverId/orderId malformed → null
//
// Returns the offer object on success, null on bad input.
export function sendDriverOffer({ orderId, driverId } = {}) {
  if (!isString(orderId) || !isString(driverId)) return null;
  const store = loadStore();
  const bucket = store[orderId] || (store[orderId] = {});
  const existing = bucket[driverId];
  const now = nowIso();
  if (existing && existing.status === DRIVER_OFFER_STATUS.SENT) {
    return existing;
  }
  const next = existing
    ? { ...existing, status: DRIVER_OFFER_STATUS.SENT, updatedAt: now }
    : {
        id: buildOfferId(orderId, driverId),
        orderId,
        driverId,
        status: DRIVER_OFFER_STATUS.SENT,
        createdAt: now,
        updatedAt: now,
      };
  bucket[driverId] = next;
  saveStore(store);
  return next;
}

// Idempotent withdraw. Only acts on an existing `sent` offer; flips
// to `withdrawn` and bumps `updatedAt`. Already-withdrawn offers are
// returned unchanged. Missing offers return null (nothing to withdraw).
export function withdrawDriverOffer({ orderId, driverId } = {}) {
  if (!isString(orderId) || !isString(driverId)) return null;
  const store = loadStore();
  const bucket = store[orderId];
  if (!bucket || typeof bucket !== 'object') return null;
  const existing = bucket[driverId];
  if (!existing || typeof existing !== 'object') return null;
  if (existing.status === DRIVER_OFFER_STATUS.WITHDRAWN) return existing;
  const next = { ...existing, status: DRIVER_OFFER_STATUS.WITHDRAWN, updatedAt: nowIso() };
  bucket[driverId] = next;
  saveStore(store);
  return next;
}

// Clears the entire store. Owned by the user-scoped logout boundary in
// storage_boundary.js; exported so 01D-1 tests can reset between runs.
export function clearDriverOfferStore() {
  writeRaw('{}');
}
