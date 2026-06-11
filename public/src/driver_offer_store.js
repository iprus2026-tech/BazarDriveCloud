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

// Monotonic ISO timestamp. Plain `Date.now()` resolves to milliseconds,
// so two sequential store writes inside the same JS task (e.g. CI hot
// path `send → withdraw`) can produce identical `updatedAt` values.
// `bumpedIso(prev)` guarantees the next stamp is strictly greater than
// the previous, by at least one millisecond, so callers can reliably
// detect "this offer was just touched".
function bumpedIso(prevIso) {
  let ms = Date.now();
  if (typeof prevIso === 'string' && prevIso) {
    const prev = new Date(prevIso).getTime();
    if (Number.isFinite(prev) && ms <= prev) ms = prev + 1;
  }
  return new Date(ms).toISOString();
}

function isString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Hydrate a freshly-created own DriverOffer with renderable demo fields
// so D2 ("Оффер отправлен") and the cross-role P2 card both have safe,
// non-empty content. Real input (price/ETA/message coming from a form
// in a later 01D sub-slice) wins over these defaults via the
// `details` override passed to `sendDriverOffer`.
const NEW_OFFER_DEFAULTS = Object.freeze({
  driverName: 'Вы (демо)',
  car: 'Демо · автомобиль',
  rating: '5,0',
  etaMin: 5,
  price: 1000,
  message: 'Готов выехать',
});

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
  if (!isPlainObject(bucket)) return null;
  const off = bucket[driverId];
  return isPlainObject(off) ? off : null;
}

// Returns every offer the store carries for a given order, in
// insertion order from the underlying JSON map. Terminal offers
// (`withdrawn`) are included — Order Detail filters selectable
// candidates with activeSentOffers() at the render layer.
export function listDriverOffersForOrder(orderId) {
  if (!isString(orderId)) return [];
  const store = loadStore();
  const bucket = store[orderId];
  if (!isPlainObject(bucket)) return [];
  return Object.values(bucket).filter(isPlainObject);
}

// Idempotent send. The (orderId, driverId) key guarantees we never
// create a duplicate sent offer for the same driver/order. The four
// states callers care about:
//   • no existing offer            → create with status='sent' +
//                                    hydrated renderable defaults
//   • existing with status='sent'  → no-op (return existing). The
//     screen surface toasts "уже отправлен" in this case.
//   • existing with status='withdrawn' → re-send: flip to 'sent',
//     bump updatedAt monotonically, keep createdAt + previously
//     hydrated render fields.
//   • caller-supplied driverId/orderId malformed → null
//
// A malformed bucket (e.g. someone seeded `store[orderId] = "stale"`
// into localStorage) is reset to `{}` so the write can land without
// throwing — this matches the fail-soft posture the rest of the store
// uses for malformed JSON.
//
// `details` is an optional overlay for caller-supplied renderable
// fields (price, etaMin, message, driverName, car, rating). It wins
// over the hydrated demo defaults but is ignored for already-existing
// offers (preserving the offer's pinned values on re-send).
//
// Returns the offer object on success, null on bad input.
export function sendDriverOffer({ orderId, driverId, details } = {}) {
  if (!isString(orderId) || !isString(driverId)) return null;
  const store = loadStore();
  // Recover a malformed bucket — a primitive (string/number) or an
  // array would throw on the assignment below. Resetting to `{}` is
  // the same fail-soft behaviour the JSON parser uses for malformed
  // top-level storage.
  let bucket = store[orderId];
  if (!isPlainObject(bucket)) {
    bucket = {};
    store[orderId] = bucket;
  }
  const existing = isPlainObject(bucket[driverId]) ? bucket[driverId] : null;
  if (existing && existing.status === DRIVER_OFFER_STATUS.SENT) {
    return existing;
  }
  const stamp = bumpedIso(existing && existing.updatedAt);
  const overlay = isPlainObject(details) ? details : null;
  const next = existing
    ? { ...existing, status: DRIVER_OFFER_STATUS.SENT, updatedAt: stamp }
    : {
        id: buildOfferId(orderId, driverId),
        orderId,
        driverId,
        ...NEW_OFFER_DEFAULTS,
        ...(overlay || {}),
        status: DRIVER_OFFER_STATUS.SENT,
        createdAt: stamp,
        updatedAt: stamp,
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
  if (!isPlainObject(bucket)) return null;
  const existing = bucket[driverId];
  if (!isPlainObject(existing)) return null;
  if (existing.status === DRIVER_OFFER_STATUS.WITHDRAWN) return existing;
  const next = {
    ...existing,
    status: DRIVER_OFFER_STATUS.WITHDRAWN,
    updatedAt: bumpedIso(existing.updatedAt),
  };
  bucket[driverId] = next;
  saveStore(store);
  return next;
}

// Clears the entire store. Owned by the user-scoped logout boundary in
// storage_boundary.js; exported so 01D-1 tests can reset between runs.
export function clearDriverOfferStore() {
  writeRaw('{}');
}
