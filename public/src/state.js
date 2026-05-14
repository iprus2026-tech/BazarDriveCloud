const KEY = 'bazardrive.user.v1';

// Required driver documents (BD-PROFILE-DOCS-01).
// Single source of truth for both the Documents tab and readiness checklist.
export const REQUIRED_DOCS = ['driverLicense', 'taxiOsago', 'taxiRegistry', 'waybill', 'medicalCheck'];

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
    notificationsEnabled: false,
    // v4 — BD-PROFILE-02 Taxi/IP
    shiftOpen: false,
    waybillOpen: false,
    medicalCheckPassed: false,
    parkMode: 'independent',
    // v5 — BD-DRIVER-02 (derived from driverDocuments)
    documentsReady: false,
    // v6 — BD-PROFILE-READYNESS-01 (derived from driverDocuments.taxiRegistry)
    taxiPermit: false,
    taxiPermitDraft: null,
    // v7 — BD-PROFILE-DOCS-01
    driverDocuments: defaultDocuments(),
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

// documentsReady requires every required document to be uploaded or under review.
// expired / missing / draft block readiness.
export function computeDocumentsReady(docs) {
  if (!docs) return false;
  return REQUIRED_DOCS.every((k) => {
    const s = docs[k]?.status;
    return s === 'uploaded' || s === 'review_required';
  });
}

function syncDerived(state) {
  const docs = state.driverDocuments;
  if (!docs) return state;
  state.taxiPermit     = computeTaxiPermit(docs);
  state.documentsReady = computeDocumentsReady(docs);
  return state;
}

// Reconcile loaded state: ensure driverDocuments contains all required keys
// and migrate legacy users (no driverDocuments yet but taxiPermit was true).
function normalize(state) {
  const base = defaultDocuments();
  const incoming = (state.driverDocuments && typeof state.driverDocuments === 'object')
    ? state.driverDocuments
    : {};
  const merged = { ...base };
  for (const k of REQUIRED_DOCS) {
    const v = incoming[k];
    if (v && typeof v === 'object' && typeof v.status === 'string') {
      merged[k] = { ...base[k], ...v };
    }
  }
  state.driverDocuments = merged;
  // Legacy migration: a v6 user might have taxiPermit=true and no
  // taxiRegistry doc state yet. Preserve their progress.
  if (state.taxiPermit === true && state.driverDocuments.taxiRegistry.status !== 'uploaded') {
    state.driverDocuments = {
      ...state.driverDocuments,
      taxiRegistry: { ...state.driverDocuments.taxiRegistry, status: 'uploaded' },
    };
  }
  return syncDerived(state);
}

function load() {
  if (cache) return cache;
  const defaults = buildDefaults();
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    cache = defaults;
  }
  cache = normalize(cache);
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable (private mode, quota) — fail soft.
  }
}

// Back-compat shim: legacy callers (e.g. onboarding) flag readiness via
// user.set({ documentsReady: true }) without touching driverDocuments. Since
// documentsReady is now derived from driverDocuments, that intent would be
// silently overwritten by normalize(). When such a patch arrives, lift the
// required documents into uploaded status so the derived flag stays true.
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
// Updates a single document's status and re-syncs derived fields.
export function setDocumentStatus(key, status) {
  if (!REQUIRED_DOCS.includes(key)) return;
  load();
  const docs = cache.driverDocuments || {};
  const next = { ...docs, [key]: { ...(docs[key] || {}), status } };
  cache = normalize({ ...cache, driverDocuments: next });
  persist();
}
