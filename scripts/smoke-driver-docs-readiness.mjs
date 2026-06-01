// BD-DRIVER-DOCS-01 — behavioural smoke for the driver document readiness
// contract.
//
// Background: the onboarding UI marks only three documents as обязательные
// (dl / osago / permit). state.js must therefore treat `documentsReady` as
// *registration* readiness over REGISTRATION_DOCS only — otherwise a driver
// who finishes onboarding with the three required docs is wrongly reported as
// documentsReady:false because the shift-only documents (путевой лист /
// медосмотр) default to missing. The shift documents are tracked separately by
// `shiftDocsReady`.
//
// This script drives the real state.js store (the same module the onboarding /
// profile screens use) behind a minimal localStorage stub, replays the exact
// driverDocuments patch that onboarding.js#finish() builds, and asserts the
// derived readiness flags. No browser, no DOM — pure data-layer contract.

// ── Minimal localStorage stub (state.js persists here) ───────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
};

const {
  user,
  REGISTRATION_DOCS,
  SHIFT_DOCS,
  REQUIRED_DOCS,
  computeDocumentsReady,
  computeShiftDocsReady,
} = await import('../public/src/state.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Mirror onboarding.js: checklist id → canonical driverDocuments key, and the
// three обязательные ids the UI requires before "Продолжить".
const DOC_ID_TO_KEY = {
  dl: 'driverLicense', osago: 'taxiOsago', permit: 'taxiRegistry',
  waybill: 'waybill', med: 'medicalCheck',
};
const REQUIRED_DOC_IDS = ['dl', 'osago', 'permit'];

// Rebuilds the driverDocuments patch exactly as onboarding.js#finish() does for
// a given set of ticked checklist ids, against the current persisted docs.
function buildOnboardingPatch(tickedIds) {
  const ticked = new Set(tickedIds);
  const prevDocs = user.get().driverDocuments || {};
  const driverDocuments = {};
  for (const key of REQUIRED_DOCS) {
    const onboardingId = Object.keys(DOC_ID_TO_KEY).find((id) => DOC_ID_TO_KEY[id] === key);
    const checked = onboardingId ? ticked.has(onboardingId) : false;
    const prev = prevDocs[key];
    if (checked) {
      const carryOver = prev && (prev.status === 'uploaded' || prev.status === 'review_required');
      driverDocuments[key] = carryOver ? prev : { status: 'uploaded' };
    } else {
      driverDocuments[key] = { status: 'missing' };
    }
  }
  const documentsReady = REQUIRED_DOC_IDS.every((id) => ticked.has(id));
  return { documentsReady, driverDocuments };
}

// ── Constants contract ───────────────────────────────────────────────────────
expect('REGISTRATION_DOCS = [driverLicense, taxiOsago, taxiRegistry]',
  JSON.stringify(REGISTRATION_DOCS) === JSON.stringify(['driverLicense', 'taxiOsago', 'taxiRegistry']),
  JSON.stringify(REGISTRATION_DOCS));
expect('SHIFT_DOCS = [waybill, medicalCheck]',
  JSON.stringify(SHIFT_DOCS) === JSON.stringify(['waybill', 'medicalCheck']),
  JSON.stringify(SHIFT_DOCS));
expect('REQUIRED_DOCS = registration + shift (5 docs)',
  JSON.stringify(REQUIRED_DOCS) === JSON.stringify([...REGISTRATION_DOCS, ...SHIFT_DOCS]),
  JSON.stringify(REQUIRED_DOCS));

// ── computeDocumentsReady = registration readiness only ──────────────────────
expect('documentsReady true when 3 base docs ready, waybill/medical missing',
  computeDocumentsReady({
    driverLicense: { status: 'uploaded' },
    taxiOsago: { status: 'review_required' },
    taxiRegistry: { status: 'uploaded' },
    waybill: { status: 'missing' },
    medicalCheck: { status: 'missing' },
  }) === true);
expect('documentsReady false when a base doc is expired',
  computeDocumentsReady({
    driverLicense: { status: 'uploaded' },
    taxiOsago: { status: 'uploaded' },
    taxiRegistry: { status: 'expired' },
  }) === false);
expect('shiftDocsReady false until waybill + medical ready',
  computeShiftDocsReady({
    driverLicense: { status: 'uploaded' },
    taxiOsago: { status: 'uploaded' },
    taxiRegistry: { status: 'uploaded' },
    waybill: { status: 'missing' },
    medicalCheck: { status: 'missing' },
  }) === false);
expect('shiftDocsReady true when all five docs ready',
  computeShiftDocsReady({
    driverLicense: { status: 'uploaded' },
    taxiOsago: { status: 'review_required' },
    taxiRegistry: { status: 'uploaded' },
    waybill: { status: 'uploaded' },
    medicalCheck: { status: 'uploaded' },
  }) === true);

// ── Driver onboarding: tick the 3 required docs only ─────────────────────────
localStorage.clear();
user.reset();
const patch = buildOnboardingPatch(['dl', 'osago', 'permit']);
expect('onboarding locally computes documentsReady=true for 3 required ticks',
  patch.documentsReady === true);
user.set({
  onboarded: true,
  role: 'driver',
  phone: '9001234567',
  phoneVerified: true,
  ...patch,
});
const driver = user.get();
expect('role persisted as driver', driver.role === 'driver', driver.role);
expect('phoneVerified persisted true (not regressed by #334)', driver.phoneVerified === true);
expect('canonical driverDocuments preserved: driverLicense uploaded',
  driver.driverDocuments.driverLicense.status === 'uploaded',
  driver.driverDocuments.driverLicense.status);
expect('canonical driverDocuments preserved: taxiOsago ready (review_required carried over)',
  ['uploaded', 'review_required'].includes(driver.driverDocuments.taxiOsago.status),
  driver.driverDocuments.taxiOsago.status);
expect('canonical driverDocuments preserved: taxiRegistry uploaded',
  driver.driverDocuments.taxiRegistry.status === 'uploaded',
  driver.driverDocuments.taxiRegistry.status);
expect('THE BUG FIX: documentsReady NOT false after onboarding with 3 required docs',
  driver.documentsReady === true, 'documentsReady=' + driver.documentsReady);
expect('shiftDocsReady false — waybill/medical still missing for the line',
  driver.shiftDocsReady === false, 'shiftDocsReady=' + driver.shiftDocsReady);
expect('honest line gate: waybill + medical missing → not all docs ready',
  driver.driverDocuments.waybill.status === 'missing'
    && driver.driverDocuments.medicalCheck.status === 'missing');

// ── Driver later uploads waybill + medical → full shift readiness ────────────
user.set({
  driverDocuments: {
    ...driver.driverDocuments,
    waybill: { status: 'uploaded' },
    medicalCheck: { status: 'uploaded' },
  },
});
const ready = user.get();
expect('after uploading waybill + medical: documentsReady stays true',
  ready.documentsReady === true);
expect('after uploading waybill + medical: shiftDocsReady becomes true',
  ready.shiftDocsReady === true);

// ── Passenger onboarding sanity (no driver docs leakage / regression) ────────
localStorage.clear();
user.reset();
user.set({ onboarded: true, role: 'passenger', phone: '9007654321', phoneVerified: true });
const passenger = user.get();
expect('passenger role persisted', passenger.role === 'passenger', passenger.role);
expect('passenger phoneVerified true', passenger.phoneVerified === true);
expect('passenger documentsReady false (registration docs untouched)',
  passenger.documentsReady === false, 'documentsReady=' + passenger.documentsReady);
expect('passenger shiftDocsReady false',
  passenger.shiftDocsReady === false, 'shiftDocsReady=' + passenger.shiftDocsReady);

if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll driver-docs-readiness smoke checks passed.');
