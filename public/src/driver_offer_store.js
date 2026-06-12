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
//         id, orderId, driverId, status,
//         driverName, car, rating, etaMin, price, message,
//         createdAt, updatedAt, expiresAt
//       }
//     }
//   }
//
// This slice (01D-1) writes `status: 'sent' | 'withdrawn'` only. The
// remaining Model B statuses (`accepted`, `rejected`, `expired`) are
// owned by later 01D sub-slices and the future system/TTL job. The
// store still recognises those statuses defensively: withdraw refuses
// to overwrite them, and unknown statuses are returned verbatim.
//
// BD-ORDER-DETAIL-01D-1F Codex hardening:
//   • `expiresAt` is stamped on every fresh sent offer (createdAt +
//     `DEFAULT_OFFER_TTL_MIN` minutes); re-sending a withdrawn offer
//     either preserves its previous `expiresAt` or backfills one.
//   • Special keys (`__proto__`, `constructor`, `prototype`) are
//     rejected by `isSafeStoreKey()` before they can reach any
//     bracket-write — the store also reads buckets through
//     `Object.prototype.hasOwnProperty` so a polluted prototype chain
//     cannot leak into the result.
//   • `withdrawDriverOffer` mutates only when the existing status is
//     `'sent'`. Terminal / unknown statuses are returned unchanged.
//   • The `details` overlay is filtered through `pickOfferDetails()`,
//     a strict whitelist of render/edit fields with type validation —
//     a caller cannot overwrite canonical `id`, `orderId`, `driverId`,
//     `status`, `createdAt`, `updatedAt`, or `expiresAt`.
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

// Null-prototype map factory. Using `Object.create(null)` for in-memory
// store rebuilds keeps assignments off `Object.prototype`'s lookup
// path so a polluted bucket can never leak through prototype chain
// reads. Combined with `isSafeStoreKey()` below this gives belt-and-
// suspenders against `__proto__` / `constructor` / `prototype` keys.
function createMap() {
  return Object.create(null);
}

// Own-property check that ignores anything inherited from
// Object.prototype. We always pair this with `isSafeStoreKey()` before
// a bracket write, but `hasOwn()` is still the read-side guarantee.
function hasOwn(obj, key) {
  return obj !== null && typeof obj === 'object'
    && Object.prototype.hasOwnProperty.call(obj, key);
}

function loadStore() {
  const raw = readRaw();
  if (!raw) return createMap();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createMap();
    }
    // Copy own properties only into a fresh null-prototype map. This
    // strips any inherited junk and any literal `__proto__` setter
    // payload a hostile JSON might try to smuggle (JSON.parse does NOT
    // honour `__proto__` as a setter, but copying to a null-proto map
    // is the explicit defense).
    const out = createMap();
    for (const k of Object.keys(parsed)) {
      if (isSafeStoreKey(k)) out[k] = parsed[k];
    }
    return out;
  } catch {
    return createMap();
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

// BD-ORDER-DETAIL-01D-1F — keys that must NEVER be used as orderId or
// driverId. Using these as bracket-write targets would mutate
// `Object.prototype`'s lookup path on a plain `{}` map, which is the
// canonical prototype-pollution vector. We reject the value before any
// store read or write.
const BLOCKED_STORE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeStoreKey(v) {
  return isString(v) && !BLOCKED_STORE_KEYS.has(v);
}

// Default TTL for a freshly created sent offer (Model B's
// `DriverOffer.expiresAt` rule, 15 min from createdAt). Kept here as a
// named constant so the smoke can pin both the value and the formula.
const DEFAULT_OFFER_TTL_MIN = 15;

// Returns an ISO timestamp `minutes` minutes after `baseIso`. Falls
// back to `Date.now()` if the input is unparseable so the result is
// always a finite forward-dated ISO string.
function addMinutesIso(baseIso, minutes) {
  const base = new Date(baseIso).getTime();
  const safe = Number.isFinite(base) ? base : Date.now();
  return new Date(safe + minutes * 60_000).toISOString();
}

// BD-ORDER-DETAIL-01D-1F — whitelist for caller-supplied `details`.
// The store accepts only render/edit fields; canonical identity and
// timeline fields (id, orderId, driverId, status, createdAt,
// updatedAt, expiresAt) are owned by the store itself and can never
// be overridden by a `details` overlay. Strings must be strings;
// `etaMin` must be a finite positive number; `price` must be a finite
// non-negative number. Anything else is silently dropped.
function pickOfferDetails(details) {
  const out = {};
  if (!isPlainObject(details)) return out;
  if (typeof details.driverName === 'string') out.driverName = details.driverName;
  if (typeof details.car        === 'string') out.car        = details.car;
  if (typeof details.rating     === 'string') out.rating     = details.rating;
  if (typeof details.message    === 'string') out.message    = details.message;
  if (typeof details.etaMin === 'number'
      && Number.isFinite(details.etaMin)
      && details.etaMin > 0) {
    out.etaMin = details.etaMin;
  }
  if (typeof details.price === 'number'
      && Number.isFinite(details.price)
      && details.price >= 0) {
    out.price = details.price;
  }
  return out;
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
// per read which is fine for the read/render path. Reads go through
// `hasOwn()` so a polluted prototype chain on the underlying parsed
// object cannot leak a fake bucket / fake offer through.
export function getDriverOffer(orderId, driverId) {
  if (!isSafeStoreKey(orderId) || !isSafeStoreKey(driverId)) return null;
  const store = loadStore();
  if (!hasOwn(store, orderId)) return null;
  const bucket = store[orderId];
  if (!isPlainObject(bucket) || !hasOwn(bucket, driverId)) return null;
  const off = bucket[driverId];
  return isPlainObject(off) ? off : null;
}

// Returns every offer the store carries for a given order, in
// insertion order from the underlying JSON map. Terminal offers
// (`withdrawn`) are included — Order Detail filters selectable
// candidates with activeSentOffers() at the render layer.
export function listDriverOffersForOrder(orderId) {
  if (!isSafeStoreKey(orderId)) return [];
  const store = loadStore();
  if (!hasOwn(store, orderId)) return [];
  const bucket = store[orderId];
  if (!isPlainObject(bucket)) return [];
  // Filter inside the bucket too: legacy / corrupted storage may carry
  // own driverId keys like "__proto__" / "constructor" / "prototype",
  // and `getDriverOffer` already rejects them — `list` must agree, or
  // the merge in `loadOrder()` would re-surface a blocked driverId.
  return Object.keys(bucket)
    .filter((k) => isSafeStoreKey(k) && hasOwn(bucket, k))
    .map((k) => bucket[k])
    .filter(isPlainObject);
}

// Idempotent send. The (orderId, driverId) key guarantees we never
// create a duplicate sent offer for the same driver/order. The four
// states callers care about:
//   • no existing offer            → create with status='sent' +
//                                    hydrated renderable defaults +
//                                    expiresAt = createdAt + 15 min
//   • existing with status='sent'  → no-op (return existing). The
//     screen surface toasts "уже отправлен" in this case.
//   • existing with status='withdrawn' → re-send: flip to 'sent',
//     bump updatedAt monotonically, keep createdAt + previously
//     hydrated render fields. Preserves existing `expiresAt` if it
//     was already pinned (and still parseable); backfills
//     `createdAt + 15 min` otherwise.
//   • existing with terminal/unknown status (`accepted`, `rejected`,
//     `expired`, or any future value)                → return existing
//     UNCHANGED. 01D-1 never overwrites a terminal status; later sub-
//     slices own those transitions.
//   • caller-supplied driverId/orderId malformed or blocked → null
//
// A malformed bucket (e.g. someone seeded `store[orderId] = "stale"`
// into localStorage) is reset to a fresh null-prototype map so the
// write can land without throwing — this matches the fail-soft posture
// the rest of the store uses for malformed JSON.
//
// `details` is an optional overlay for caller-supplied renderable
// fields. It is filtered through `pickOfferDetails()` — only the
// whitelisted render/edit fields are accepted, and identity / timeline
// fields are silently dropped. Applies only to brand-new offers; a
// re-send of an existing withdrawn offer preserves the offer's pinned
// render fields (passing details on a re-send is a no-op).
//
// Returns the offer object on success, null on bad input.
export function sendDriverOffer({ orderId, driverId, details } = {}) {
  if (!isSafeStoreKey(orderId) || !isSafeStoreKey(driverId)) return null;
  const store = loadStore();
  // Recover a malformed bucket — a primitive (string/number) or an
  // array would throw on the assignment below. Resetting to a fresh
  // null-prototype map is the same fail-soft behaviour the JSON
  // parser uses for malformed top-level storage.
  let bucket = hasOwn(store, orderId) ? store[orderId] : null;
  if (!isPlainObject(bucket)) {
    bucket = createMap();
    store[orderId] = bucket;
  }
  const existing = hasOwn(bucket, driverId) && isPlainObject(bucket[driverId])
    ? bucket[driverId]
    : null;
  if (existing && existing.status === DRIVER_OFFER_STATUS.SENT) {
    return existing;
  }
  // BD-ORDER-DETAIL-01D-1F — terminal / unknown statuses are not
  // overridable from 01D-1. Anything that isn't `sent` or `withdrawn`
  // is owned by a future sub-slice; return verbatim instead of
  // silently rewriting it back to 'sent'.
  if (existing
      && existing.status !== DRIVER_OFFER_STATUS.WITHDRAWN
      && existing.status !== DRIVER_OFFER_STATUS.SENT) {
    return existing;
  }
  const stamp = bumpedIso(existing && existing.updatedAt);
  const overlay = pickOfferDetails(details);
  let next;
  if (existing) {
    // Re-send of a withdrawn offer. Preserve identity, createdAt, the
    // previously hydrated render fields, and the original expiresAt
    // when it parses; otherwise backfill expiresAt from createdAt +
    // TTL (the safer of the two options — the offer's lifetime stays
    // anchored to its original creation time, not to the re-send).
    const prevExpiry = typeof existing.expiresAt === 'string'
      && Number.isFinite(new Date(existing.expiresAt).getTime())
      ? existing.expiresAt
      : addMinutesIso(existing.createdAt || stamp, DEFAULT_OFFER_TTL_MIN);
    next = {
      ...existing,
      status: DRIVER_OFFER_STATUS.SENT,
      updatedAt: stamp,
      expiresAt: prevExpiry,
    };
  } else {
    next = {
      id: buildOfferId(orderId, driverId),
      orderId,
      driverId,
      ...NEW_OFFER_DEFAULTS,
      ...overlay,
      status: DRIVER_OFFER_STATUS.SENT,
      createdAt: stamp,
      updatedAt: stamp,
      expiresAt: addMinutesIso(stamp, DEFAULT_OFFER_TTL_MIN),
    };
  }
  bucket[driverId] = next;
  saveStore(store);
  return next;
}

// Idempotent withdraw. Only acts on an existing offer whose status is
// EXACTLY `'sent'`; flips to `'withdrawn'` and bumps `updatedAt`.
//   • status='withdrawn' / 'accepted' / 'rejected' / 'expired' / unknown
//     → return existing UNCHANGED (terminal/unknown statuses are owned
//     by later 01D sub-slices; 01D-1 never overwrites them).
//   • no existing offer / malformed bucket / blocked key → null.
export function withdrawDriverOffer({ orderId, driverId } = {}) {
  if (!isSafeStoreKey(orderId) || !isSafeStoreKey(driverId)) return null;
  const store = loadStore();
  if (!hasOwn(store, orderId)) return null;
  const bucket = store[orderId];
  if (!isPlainObject(bucket) || !hasOwn(bucket, driverId)) return null;
  const existing = bucket[driverId];
  if (!isPlainObject(existing)) return null;
  // BD-ORDER-DETAIL-01D-1F — only 'sent' is overridable. Every other
  // status (including the implicit 'unknown' that a future or
  // corrupted writer might leave) is returned verbatim.
  if (existing.status !== DRIVER_OFFER_STATUS.SENT) return existing;
  const next = {
    ...existing,
    status: DRIVER_OFFER_STATUS.WITHDRAWN,
    updatedAt: bumpedIso(existing.updatedAt),
  };
  bucket[driverId] = next;
  saveStore(store);
  return next;
}

// Clears the entire offers store + the order overlay store. Owned by
// the user-scoped logout boundary in storage_boundary.js; exported so
// tests can reset between runs.
export function clearDriverOfferStore() {
  writeRaw('{}');
  clearOrderOverlayStore();
}

// ── Order overlay store (BD-ORDER-DETAIL-01D-2A) ────────────────────
//
// The Order Detail screen has no real backend, so the passenger
// «Выбрать водителя» commit needs a local place to record the
// resulting `Order.status='ACCEPTED'` + `selectedDriverId` writes that
// `loadOrder()` can layer on top of the frozen `DEMO_ORDERS` fixtures
// at render time. Same fail-soft posture as the DriverOffer store:
//   • null-prototype map for the parsed envelope
//   • `isSafeStoreKey()` guard on `orderId`
//   • `hasOwn()` reads
//   • malformed buckets reset to `{}` on write
//
// Shape:
//   {
//     [orderId]: {
//       status,             // canonical enum (e.g. 'ACCEPTED')
//       selectedDriverId,
//       updatedAt
//     }
//   }
//
// The overlay is a thin patch — `loadOrder()` only reads `status` and
// `selectedDriverId` from it and merges them onto the fixture; every
// other field stays canonical.

const ORDER_OVERLAY_STORAGE_KEY = 'bazardrive.order_overlay.v1';
export const ORDER_DETAIL_OVERLAY_STORAGE_KEY = ORDER_OVERLAY_STORAGE_KEY;

const _overlayMemoryStore = { value: '' };

function readOverlayRaw() {
  const ls = safeLocalStorage();
  if (ls) return ls.getItem(ORDER_OVERLAY_STORAGE_KEY);
  return _overlayMemoryStore.value || null;
}

function writeOverlayRaw(value) {
  const ls = safeLocalStorage();
  if (ls) { ls.setItem(ORDER_OVERLAY_STORAGE_KEY, value); return; }
  _overlayMemoryStore.value = value;
}

function loadOverlayStore() {
  const raw = readOverlayRaw();
  if (!raw) return createMap();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return createMap();
    }
    const out = createMap();
    for (const k of Object.keys(parsed)) {
      if (isSafeStoreKey(k)) out[k] = parsed[k];
    }
    return out;
  } catch {
    return createMap();
  }
}

function saveOverlayStore(map) {
  writeOverlayRaw(JSON.stringify(map));
}

// Returns the overlay record for `orderId` or null. Reads through
// `hasOwn()` so a polluted prototype chain on the parsed envelope
// cannot leak through.
export function getOrderOverlay(orderId) {
  if (!isSafeStoreKey(orderId)) return null;
  const store = loadOverlayStore();
  if (!hasOwn(store, orderId)) return null;
  const entry = store[orderId];
  return isPlainObject(entry) ? entry : null;
}

// Frozen status literals used by `commitPassengerSelection`. `accepted`
// and `rejected` are NOT in DRIVER_OFFER_STATUS because the public
// send/withdraw API never writes them — they live only inside the
// commit transaction. ORDER_STATUS_ACCEPTED mirrors the canonical
// enum used by `ride_state.js`; held here to avoid a circular import
// (the order-detail click handler imports from this module, not from
// ride_state).
const OFFER_STATUS_ACCEPTED = 'accepted';
const OFFER_STATUS_REJECTED = 'rejected';
const ORDER_STATUS_ACCEPTED = 'ACCEPTED';

// Atomic-ish multi-write that BD-ORDER-DETAIL-01D-2A needs for the
// passenger commit:
//   • the order overlay record gains `{ status: 'ACCEPTED',
//     selectedDriverId, updatedAt }`
//   • the chosen DriverOffer flips to `status='accepted'`
//   • every other sent DriverOffer for the same order flips to
//     `status='rejected'`
//   • terminal offers (`withdrawn`, `expired`, `rejected`) are
//     preserved verbatim — the loop short-circuits on them
//
// `allOffers` is the merged list the caller (order_detail.js) already
// holds — passing it in keeps fixture-only offers and store-resident
// offers under one code path.
//
// Returns the committed (accepted) offer object on success, null on
// any validation failure (unsafe keys, missing target, target not in
// status='sent', foreign orderId, malformed `allOffers`). The store is
// written in a single `saveStore` + `saveOverlayStore` pair, so a
// caller observes either the full commit or nothing.
//
// NOTE: this helper deliberately does NOT seed `bazardrive.active_ride.v1`.
// That write belongs to a later sub-slice (BD-ORDER-DETAIL-01D-2B);
// 01D-2A stops at the Order-Detail-side commit.
export function commitPassengerSelection({ orderId, selectedDriverId, allOffers } = {}) {
  if (!isSafeStoreKey(orderId)) return null;
  if (!isSafeStoreKey(selectedDriverId)) return null;
  if (!Array.isArray(allOffers)) return null;

  // Find the target offer. It must be a plain object, belong to this
  // order, have a safe driverId, and currently be status='sent'.
  const target = allOffers.find((o) => isPlainObject(o)
    && isSafeStoreKey(o.driverId)
    && o.driverId === selectedDriverId
    && o.orderId === orderId
    && o.status === DRIVER_OFFER_STATUS.SENT);
  if (!target) return null;

  const store = loadStore();
  let bucket = hasOwn(store, orderId) ? store[orderId] : null;
  if (!isPlainObject(bucket)) {
    bucket = createMap();
    store[orderId] = bucket;
  }

  let acceptedOffer = null;
  for (const offer of allOffers) {
    if (!isPlainObject(offer)) continue;
    if (!isSafeStoreKey(offer.driverId)) continue;
    if (offer.orderId !== orderId) continue;

    // The stored baseline (the bucket entry) is the source of truth.
    // The snapshot's `status` may be stale: another tab could have
    // already withdrawn / rejected / expired this same offer, and the
    // commit must respect the persisted state instead of the snapshot.
    // Fall back to a fresh copy of the supplied offer only when the
    // store has no entry yet (fixture-only candidate, first commit).
    const baseline = hasOwn(bucket, offer.driverId) && isPlainObject(bucket[offer.driverId])
      ? bucket[offer.driverId]
      : { ...offer };
    const baselineIsSent = baseline.status === DRIVER_OFFER_STATUS.SENT;
    const isTarget = offer.driverId === selectedDriverId;

    // BD-ORDER-DETAIL-01D-2A stale-store guard. If the target's
    // stored baseline is no longer 'sent', the commit fails wholesale —
    // we return null before any saveStore / saveOverlayStore, leaving
    // the stored terminal offer (and every peer) verbatim.
    if (isTarget && !baselineIsSent) {
      return null;
    }
    // Peers whose stored baseline is no longer 'sent' are likewise
    // preserved verbatim. They're skipped, not overwritten — the
    // snapshot's stale `status='sent'` claim is ignored.
    if (!baselineIsSent) {
      continue;
    }
    const nextStatus = isTarget
      ? OFFER_STATUS_ACCEPTED
      : OFFER_STATUS_REJECTED;
    const next = {
      ...baseline,
      // Re-pin canonical identity in case the supplied offer carries
      // stale field shape.
      id:        baseline.id || buildOfferId(orderId, offer.driverId),
      orderId,
      driverId:  offer.driverId,
      status:    nextStatus,
      updatedAt: bumpedIso(baseline.updatedAt),
    };
    bucket[offer.driverId] = next;
    if (isTarget) acceptedOffer = next;
  }

  saveStore(store);

  // Write the order overlay so `loadOrder()` sees the new status +
  // selectedDriverId on the next read.
  const overlayStore = loadOverlayStore();
  overlayStore[orderId] = {
    status: ORDER_STATUS_ACCEPTED,
    selectedDriverId,
    updatedAt: bumpedIso(null),
  };
  saveOverlayStore(overlayStore);

  return acceptedOffer;
}

// Canonical Order.status enum value used by the cancel path (mirrors
// `ride_state.js`). Held here to avoid a circular import for the same
// reason ORDER_STATUS_ACCEPTED is.
const ORDER_STATUS_CANCELED = 'CANCELED';

// BD-ORDER-DETAIL-01D-2C-A — passenger «Отменить заказ» local commit.
//
// Writes the order overlay record for `orderId` with:
//   • status        = 'CANCELED'
//   • canceledBy    = 'passenger'
//   • canceledAt    = ISO timestamp (monotonic vs the overlay's
//                     previous updatedAt, just like the existing
//                     commit path)
//   • updatedAt     = same monotonic stamp
//
// Existing overlay fields (e.g. `selectedDriverId` written by a prior
// 01D-2A commit) are PRESERVED — the contract documents that
// `selectedDriverId` stays unchanged across a cancel. This slice does
// NOT touch the DriverOffer-status store (sent → rejected sync is a
// later 01D-2C sub-slice), the active_ride store, or any driver-side
// surface.
//
// Idempotent: a second call when the overlay is already
// `status='CANCELED'` with `canceledBy='passenger'` returns the
// existing record unchanged.
//
// Refused on unsafe / blocked keys (`__proto__` / `constructor` /
// `prototype`) — same posture as every other store helper.
export function cancelOrderByPassenger({ orderId } = {}) {
  if (!isSafeStoreKey(orderId)) return null;
  const overlayStore = loadOverlayStore();
  const bucket = hasOwn(overlayStore, orderId) && isPlainObject(overlayStore[orderId])
    ? overlayStore[orderId]
    : {};
  if (bucket.status === ORDER_STATUS_CANCELED && bucket.canceledBy === 'passenger') {
    return bucket;
  }
  const stamp = bumpedIso(bucket && typeof bucket.updatedAt === 'string'
    ? bucket.updatedAt
    : null);
  const next = {
    ...bucket,
    status:     ORDER_STATUS_CANCELED,
    canceledBy: 'passenger',
    canceledAt: stamp,
    updatedAt:  stamp,
  };
  overlayStore[orderId] = next;
  saveOverlayStore(overlayStore);
  return next;
}

// Clears the order overlay store. Called from `clearDriverOfferStore`
// so the user-scoped logout boundary continues to wipe everything the
// Order Detail screen wrote.
export function clearOrderOverlayStore() {
  writeOverlayRaw('{}');
}
