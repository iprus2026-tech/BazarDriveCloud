const KEY = 'bazardrive.user.v1';

// Driver document readiness model (BD-PROFILE-DOCS-01 / BD-DRIVER-DOCS-01).
//
// The onboarding UI marks only three documents as обязательные (dl / osago /
// permit) — the rest are optional "загружу позже" items. The readiness model
// honours that split so a driver who completes onboarding with the three
// required docs is NOT reported as documentsReady:false just because the
// shift-only documents (путевой лист / медосмотр) are still pending.
//
//   REGISTRATION_DOCS — base documents needed to finish registration. Drives
//                       documentsReady (a.k.a. registration readiness).
//   SHIFT_DOCS        — extra documents needed to actually go online for a
//                       shift, on top of the registration docs.
//   REQUIRED_DOCS     — canonical full document set (registration + shift).
//                       Single source of truth for the Documents tab shape,
//                       normalize(), and the line-blocking attention counts.
export const REGISTRATION_DOCS = ['driverLicense', 'taxiOsago', 'taxiRegistry'];
export const SHIFT_DOCS = ['waybill', 'medicalCheck'];
export const REQUIRED_DOCS = [...REGISTRATION_DOCS, ...SHIFT_DOCS];

// Allowed statuses for a single document. Used by setDocumentStatus() to
// reject typos and by normalize() to fall back to defaults if persisted
// state somehow contains an unknown value.
export const DOC_STATUSES = ['uploaded', 'review_required', 'expired', 'missing', 'draft'];

// Allowed statuses: uploaded | review_required | expired | missing | draft
function defaultDocuments() {
  return {
    driverLicense: { status: 'uploaded' },
    taxiOsago:     { status: 'review_required' },
    taxiRegistry:  { status: 'expired' },
    waybill:       { status: 'missing' },
    medicalCheck:  { status: 'missing' },
  };
}

function buildDefaults() {
  return {
    // v1
    welcomeSeen: false,
    onboarded: false,
    displayName: null,
    city: null,
    // v2 — BD-ONBOARDING-01
    role: null,        // 'passenger' | 'driver' | 'guest'
    phone: null,
    firstName: null,
    lastName: null,
    vehicleMake: null,
    vehicleModel: null,
    vehicleYear: null,
    vehiclePlate: null,
    vehicleColor: null,
    vehicleBody: null,
    // v3 — BD-PROFILE-01
    driverOnline: false,
    // BD-PROFILE-01: passenger Profile V2 defaults notifications to ON
    // (план + push enabled out of the box).
    notificationsEnabled: true,
    // v4 — BD-PROFILE-02 Taxi/IP
    shiftOpen: false,
    waybillOpen: false,
    medicalCheckPassed: false,
    parkMode: 'independent',
    // v5 — BD-DRIVER-02 (derived from driverDocuments)
    // documentsReady = registration readiness (REGISTRATION_DOCS only).
    // shiftDocsReady = every document, incl. путевой лист / медосмотр, ready
    // for going online (BD-DRIVER-DOCS-01).
    documentsReady: false,
    shiftDocsReady: false,
    // v6 — BD-PROFILE-READYNESS-01 (derived from driverDocuments.taxiRegistry)
    taxiPermit: false,
    taxiPermitDraft: null,
    // v7 — BD-PROFILE-DOCS-01
    driverDocuments: defaultDocuments(),
    // v8 — BD-PROFILE-PASSENGER-01 Passenger Profile V2
    profileStatus: 'incomplete',     // 'incomplete' | 'ready'
    tripCount: 0,
    savedAddressCount: 0,
    trustedContactsCount: 0,
    paymentLast4: null,              // string | null
    promoCount: 0,
    // v9 — BD-PROFILE-01 phone-verification surface. Default false so the
    // verify banner + ТРЕБУЕТСЯ ДЕЙСТВИЕ card stay reachable from a fresh
    // localStorage. Set to true by the mock "Получить код" / "Подтвердить
    // телефон" handlers (no real SMS provider is wired).
    phoneVerified: false,
    // v10 — BD-PROFILE-D-05D Driver Garage active vehicle selection.
    // v11 — BD-PROFILE-D-05F persisted garage vehicle collection.
    // Profile-local namespace: only the garage section reads or writes
    // this. `activeVehicleId` persists the driver's last "Сделать активной"
    // choice; `vehicles` persists the garage collection itself when an
    // explicit safe save path lands (05G+). 05F only READS this field —
    // the render path never auto-initialises it from legacy fields.
    // Resolver in `public/src/garage.js` falls back to the legacy-derived
    // single-vehicle collection when `vehicles` is empty/missing, and
    // never mutates the persisted shape on its own. Not consumed by the
    // active ride / ride lifecycle / history / receipts.
    driverGarage: { activeVehicleId: null, vehicles: [] },
  };
}

let cache = null;

// ── Document-derived helpers ────────────────────────────────────────────────

// Hard-blocking attention: documents that prevent the driver from going
// online. expired / missing / draft block the line; review_required is
// considered acceptable (see computeDocumentsReady), so it is NOT counted
// here. Callers that want to surface "ожидает проверки" use
// documentsReviewCount() for a soft, non-blocking signal.
export function documentsAttentionCount(docs) {
  if (!docs) return 0;
  let n = 0;
  for (const key of REQUIRED_DOCS) {
    const s = docs[key]?.status;
    if (s === 'expired' || s === 'missing' || s === 'draft') n++;
  }
  return n;
}

// Soft attention: documents whose review_required status keeps documentsReady
// true. Surfaced as informational, not blocking.
export function documentsReviewCount(docs) {
  if (!docs) return 0;
  let n = 0;
  for (const key of REQUIRED_DOCS) {
    if (docs[key]?.status === 'review_required') n++;
  }
  return n;
}

// taxiPermit is true ⇔ taxiRegistry document is uploaded.
export function computeTaxiPermit(docs) {
  return docs?.taxiRegistry?.status === 'uploaded';
}

// Shared rule: a document counts as "ready" when uploaded or under review;
// expired / missing / draft block readiness.
function docsReadyOver(keys, docs) {
  if (!docs) return false;
  return keys.every((k) => {
    const s = docs[k]?.status;
    return s === 'uploaded' || s === 'review_required';
  });
}

// documentsReady = registration readiness: only the REGISTRATION_DOCS (dl /
// osago / permit) must be ready. Mirrors the обязательные set in the
// onboarding UI so finishing onboarding with the three required docs does not
// report documentsReady:false (BD-DRIVER-DOCS-01).
export function computeDocumentsReady(docs) {
  return docsReadyOver(REGISTRATION_DOCS, docs);
}

// shiftDocsReady = full readiness to go online: every document (registration
// docs PLUS путевой лист / медосмотр) must be ready.
export function computeShiftDocsReady(docs) {
  return docsReadyOver(REQUIRED_DOCS, docs);
}

// ── Line-readiness rule (single source of truth) ────────────────────────────
// Promoted here from profile.js so every readiness surface derives from the
// same rule and cannot drift: Profile's status/checklist (BD-PROFILE-02) and
// the DriverMap readiness gate (BD-DRIVER-02) both call these.

// Profile data completeness — phone + vehicle identity all present.
export function canShowReadyStatus(u) {
  if (!u) return false;
  return !!(u.phone && u.vehicleMake && u.vehicleModel && u.vehiclePlate);
}

// A driver is ready to go on line — and to accept orders on /driver-map — only
// when basic profile data is complete AND documents are ready AND the waybill
// is open AND today's medical check has been passed.
export function isDriverLineReady(u) {
  if (!u) return false;
  return canShowReadyStatus(u)
    && u.documentsReady === true
    && u.waybillOpen === true
    && u.medicalCheckPassed === true;
}

function syncDerived(state) {
  const docs = state.driverDocuments;
  if (!docs) return state;
  state.taxiPermit      = computeTaxiPermit(docs);
  state.documentsReady  = computeDocumentsReady(docs);
  state.shiftDocsReady  = computeShiftDocsReady(docs);
  return state;
}

// BD-PROFILE-D-05F — Normalise the `driverGarage` namespace shape on
// every load / set so callers can rely on `{ activeVehicleId, vehicles }`
// existing with the right types, even on records persisted before this
// release. Lenient: a missing or malformed field falls back to the safe
// default (null id, empty vehicles array) without dropping the other
// field. Idempotent — running this on a well-shaped record is a no-op.
function normalizeDriverGarage(state) {
  const dg = (state.driverGarage && typeof state.driverGarage === 'object')
    ? state.driverGarage
    : {};
  const activeVehicleId = (typeof dg.activeVehicleId === 'string' && dg.activeVehicleId.length > 0)
    ? dg.activeVehicleId
    : null;
  const vehicles = Array.isArray(dg.vehicles) ? dg.vehicles : [];
  state.driverGarage = { activeVehicleId, vehicles };
  return state;
}

// Shape normalization only: ensure driverDocuments contains every required
// key with a valid object, then re-derive taxiPermit and documentsReady.
// IMPORTANT: legacy migrations (lifting docs based on persisted taxiPermit /
// documentsReady) are NOT performed here — they are one-shot operations that
// run in load() against raw localStorage, and in set() against an explicit
// patch. Running them on every normalize() would revert legitimate
// downgrades (e.g. setDocumentStatus('taxiRegistry', 'expired')) because
// the derived flags themselves would still be true from a previous cycle.
function normalize(state) {
  const base = defaultDocuments();
  const incoming = (state.driverDocuments && typeof state.driverDocuments === 'object')
    ? state.driverDocuments
    : {};
  const merged = { ...base };
  for (const k of REQUIRED_DOCS) {
    const v = incoming[k];
    if (v && typeof v === 'object' && typeof v.status === 'string'
        && DOC_STATUSES.includes(v.status)) {
      merged[k] = { ...base[k], ...v };
    }
  }
  state.driverDocuments = merged;
  normalizeDriverGarage(state);
  return syncDerived(state);
}

// True when the persisted payload pre-dates v9 phoneVerified AND already
// represents a ready passenger. Back-filling these users to true keeps the
// new verify banner / ТРЕБУЕТСЯ ДЕЙСТВИЕ card from suddenly appearing for
// accounts that were considered fully set up before this release. Fresh
// installs (no parsed payload) keep the false default in buildDefaults().
function needsPhoneVerifiedBackfill(parsed) {
  return !!parsed
      && typeof parsed === 'object'
      && !('phoneVerified' in parsed)
      && parsed.profileStatus === 'ready';
}

// One-shot legacy migrations applied at load(). Inspects the raw persisted
// payload (not the merged state) so each migration only fires once per
// upgrade window. After load() persists the migrated payload back, these
// branches become no-ops on subsequent loads.
function migrateLegacy(state, parsed) {
  if (!parsed || typeof parsed !== 'object') return state;
  let next = state;
  // v9 — phoneVerified backfill. Runs independently of driverDocuments
  // because it must also catch payloads written between v7 and v9 (which
  // already contain driverDocuments).
  if (needsPhoneVerifiedBackfill(parsed)) {
    next = { ...next, phoneVerified: true };
  }
  // Pre-v7 driverDocuments migrations — only relevant when the persisted
  // payload pre-dates driverDocuments entirely.
  if ('driverDocuments' in parsed) return next;
  if (parsed.taxiPermit === true && next.driverDocuments.taxiRegistry.status !== 'uploaded') {
    next = {
      ...next,
      driverDocuments: {
        ...next.driverDocuments,
        taxiRegistry: { ...next.driverDocuments.taxiRegistry, status: 'uploaded' },
      },
    };
  }
  if (parsed.documentsReady === true) {
    next = liftRequiredDocsToUploaded(next);
  }
  return next;
}

function load() {
  if (cache) return cache;
  const defaults = buildDefaults();
  let parsed = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  cache = parsed ? { ...defaults, ...parsed } : defaults;
  cache = migrateLegacy(cache, parsed);
  cache = normalize(cache);
  // Persist migrated payload so the legacy fields don't trigger again on
  // the next load (and so other tabs / restarts see the upgraded shape).
  const migrated = parsed
    && (!('driverDocuments' in parsed) || needsPhoneVerifiedBackfill(parsed));
  if (migrated) persist();
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable (private mode, quota) — fail soft.
  }
}

// Lift every required document into `uploaded` status. Used by
// migrateLegacy() for pre-v7 storage and by user.set() when a caller
// explicitly patches documentsReady=true without touching driverDocuments.
function liftRequiredDocsToUploaded(state) {
  const base = state.driverDocuments || defaultDocuments();
  const next = { ...base };
  for (const key of REQUIRED_DOCS) {
    const prev = next[key];
    if (!prev || prev.status !== 'uploaded') {
      next[key] = { ...(prev || {}), status: 'uploaded' };
    }
  }
  return { ...state, driverDocuments: next };
}

export const user = {
  get() { return { ...load() }; },
  set(patch) {
    load();
    let merged = { ...cache, ...patch };
    // Explicit legacy shim for documentsReady=true. Only fires when the
    // caller (e.g. onboarding finish) sends the flag without also sending
    // driverDocuments — i.e. they speak v6 semantics. We deliberately do
    // NOT shim the `false` case: wiping driverDocuments would destroy
    // statuses uploaded via the Documents tab in later sessions (onboarding
    // re-edit can flip the flag back to false without the user intending
    // to discard real uploads). Modern callers downgrade per-document via
    // setDocumentStatus(key, 'expired'|'missing'|...), which survives
    // normalize() and accurately drives the derived flag.
    if (patch && patch.documentsReady === true && !('driverDocuments' in patch)) {
      merged = liftRequiredDocsToUploaded(merged);
    }
    cache = normalize(merged);
    persist();
  },
  reset() {
    cache = normalize(buildDefaults());
    persist();
  },
};

// BD-PROFILE-D-05G — Append a single new vehicle to the persisted garage
// collection. Single safe save path used by the Driver Profile garage's
// "Добавить авто" sheet — every other render/wire path in 05A–05F stays
// strictly read-only against `driverGarage.vehicles`.
//
// Inputs are trimmed and gated:
//   - `model` is REQUIRED (after trim). A blank model refuses to persist
//     and returns null — the caller's sheet should surface a validation
//     error and keep the draft on screen.
//   - `color` / `plate` are optional and trimmed.
//   - `source` is ALWAYS set to `'persisted'` here — never copied from
//     user input. The whitelist guards future smoke source-distinction
//     and prevents a tampered draft from claiming `source: 'legacy'`
//     and earning the legacy-fallback semantics on read.
//
// Output:
//   - Returns the new vehicle's id on success, null on validation
//     refusal. The id is generated as `vehicle-${N}` where N starts at
//     `vehicles.length + 1` and skips past any existing collision —
//     never reusing an id already present on the record.
//
// Active selection:
//   - `options.makeActive === true` patches `driverGarage.activeVehicleId`
//     to the new id (single allowed writer for that field outside the
//     05D make-active handler). Otherwise the existing `activeVehicleId`
//     is preserved verbatim.
//
// Safety:
//   - The existing `vehicles` array is preserved by reference-and-spread:
//     `[...vehicles, newVehicle]`. No other field on the user record is
//     touched — legacy `vehicleMake/Model/Plate/Color` stay intact, and
//     no active-ride / history / receipt / response store is read or
//     written.
//   - `normalize()` runs as part of the existing `user.set` path
//     (via `cache = normalize(...)`) so the post-save shape always
//     satisfies `normalizeDriverGarage`'s invariants.
export function appendGarageVehicle(rawVehicle, options = {}) {
  const model = (rawVehicle && typeof rawVehicle.model === 'string')
    ? rawVehicle.model.trim() : '';
  if (!model) return null;
  const color = (rawVehicle && typeof rawVehicle.color === 'string')
    ? rawVehicle.color.trim() : '';
  const plate = (rawVehicle && typeof rawVehicle.plate === 'string')
    ? rawVehicle.plate.trim() : '';

  load();
  const dg = (cache.driverGarage && typeof cache.driverGarage === 'object')
    ? cache.driverGarage
    : { activeVehicleId: null, vehicles: [] };
  const vehicles = Array.isArray(dg.vehicles) ? dg.vehicles : [];

  // Generate a non-colliding id deterministically. Start past the
  // current array length and walk forward until we find a free slot —
  // this handles records where ids were synthesised earlier (e.g. via
  // garage-N from `normalisePersistedVehicle`) without overwriting them.
  const usedIds = new Set();
  for (const v of vehicles) {
    if (v && typeof v.id === 'string' && v.id.length > 0) usedIds.add(v.id);
  }
  let n = vehicles.length + 1;
  let id = `vehicle-${n}`;
  while (usedIds.has(id)) {
    n++;
    id = `vehicle-${n}`;
  }

  const newVehicle = { id, model, color, plate, source: 'persisted' };

  const nextDriverGarage = {
    activeVehicleId: options && options.makeActive === true
      ? id
      : dg.activeVehicleId,
    vehicles: [...vehicles, newVehicle],
  };

  cache = normalize({ ...cache, driverGarage: nextDriverGarage });
  persist();
  return id;
}

// BD-PROFILE-D-05H — Patch a single existing vehicle in the persisted
// garage collection. Single safe write path for the Driver Profile
// garage's "Редактировать авто" sheet — every other render/wire path
// stays strictly read-only against `driverGarage.vehicles`.
//
// Inputs are trimmed and gated the same way as `appendGarageVehicle`:
//   - `vehicleId` MUST be a non-empty string. A missing or unknown id
//     refuses to persist and returns null — the caller's sheet should
//     fail gracefully (the per-vehicle wiring already gates against
//     legacy-source cards, so this is a defensive belt).
//   - `rawPatch.model` is REQUIRED (after trim). A blank model refuses
//     to persist and returns null.
//   - `rawPatch.color` / `rawPatch.plate` are optional and trimmed.
//
// Field-write contract:
//   - `id` is PRESERVED from the existing record and is never copied
//     from `rawPatch` (caller cannot rename a vehicle via edit).
//   - `source` is PRESERVED when the existing value is in the resolver's
//     known whitelist (`persisted`/`legacy`/`mock`); otherwise it is
//     normalised to `'persisted'`. Never copied from `rawPatch` — the
//     caller cannot promote a vehicle to `'legacy'` semantics via edit.
//   - Unknown / future fields on the existing record are PRESERVED via
//     `...prev` spread before the canonical fields land.
//   - `activeVehicleId` is PRESERVED verbatim — edit never changes the
//     active selection (that stays owned by 05D's make-active handler
//     and 05G's `appendGarageVehicle({ makeActive: true })`).
//   - The vehicles array order is preserved: the patched entry replaces
//     the existing slot at the same index.
//   - Other vehicles in the array are preserved by reference-and-spread
//     in `[...vehicles]` and indexed assignment.
//
// Output: the patched id on success, null on validation refusal.
export function patchGarageVehicle(vehicleId, rawPatch) {
  if (typeof vehicleId !== 'string' || vehicleId.length === 0) return null;
  const model = (rawPatch && typeof rawPatch.model === 'string')
    ? rawPatch.model.trim() : '';
  if (!model) return null;
  const color = (rawPatch && typeof rawPatch.color === 'string')
    ? rawPatch.color.trim() : '';
  const plate = (rawPatch && typeof rawPatch.plate === 'string')
    ? rawPatch.plate.trim() : '';

  load();
  const dg = (cache.driverGarage && typeof cache.driverGarage === 'object')
    ? cache.driverGarage
    : { activeVehicleId: null, vehicles: [] };
  const vehicles = Array.isArray(dg.vehicles) ? dg.vehicles : [];

  // Strict match against the raw stored id.
  let idx = vehicles.findIndex((v) => v && v.id === vehicleId);

  // Codex P2 (05H) — synthesised-id fallback. The resolver
  // (`normalisePersistedVehicle` in `public/src/garage.js`) assigns
  // `garage-${rawIndex + 1}` to persisted entries that landed without a
  // usable string id; the render then exposes that synthesised id on the
  // edit button and the sheet's `data-edit-vehicle-id`. Without this
  // branch, saving the edit would call `patchGarageVehicle('garage-1', …)`
  // and the strict match above would miss the raw slot (whose `.id` is
  // missing/blank), refusing the write. Here we parse the synthesised id,
  // verify the targeted raw slot is genuinely id-less, and route the
  // patch to that slot. The save below persists the synthesised id onto
  // the slot's `.id`, so subsequent edits hit the strict path.
  if (idx < 0) {
    const synth = /^garage-(\d+)$/.exec(vehicleId);
    if (synth) {
      const rawIdx = parseInt(synth[1], 10) - 1;
      if (rawIdx >= 0 && rawIdx < vehicles.length) {
        const candidate = vehicles[rawIdx];
        if (candidate && typeof candidate === 'object') {
          const candidateId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
          if (!candidateId) idx = rawIdx;
        }
      }
    }
  }
  if (idx < 0) return null;

  const prev = vehicles[idx] || {};
  // Source is preserved when the existing value is recognised by the
  // resolver; otherwise normalised to 'persisted'. NEVER copied from
  // `rawPatch` — the resolver fallback chain treats 'legacy' specially
  // and only the legacy-bridge codepath should produce a 'legacy' entry.
  const KNOWN_SOURCES = new Set(['persisted', 'legacy', 'mock']);
  const source = (typeof prev.source === 'string' && KNOWN_SOURCES.has(prev.source))
    ? prev.source
    : 'persisted';

  const patched = {
    ...prev,
    id: vehicleId,
    model,
    color,
    plate,
    source,
  };

  const nextVehicles = [...vehicles];
  nextVehicles[idx] = patched;

  const nextDriverGarage = {
    activeVehicleId: dg.activeVehicleId,
    vehicles: nextVehicles,
  };

  cache = normalize({ ...cache, driverGarage: nextDriverGarage });
  persist();
  return vehicleId;
}

// Convenience helper for Profile → Documents tab.
// Updates a single document's status and re-syncs derived fields. Unknown
// keys or statuses outside the supported enum are rejected so callers can't
// silently corrupt state — typos no longer leave a doc in a status that
// none of the derived helpers can classify.
export function setDocumentStatus(key, status) {
  if (!REQUIRED_DOCS.includes(key)) return;
  if (!DOC_STATUSES.includes(status)) return;
  load();
  const docs = cache.driverDocuments || {};
  const next = { ...docs, [key]: { ...(docs[key] || {}), status } };
  cache = normalize({ ...cache, driverDocuments: next });
  persist();
}
