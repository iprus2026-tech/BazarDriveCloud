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
