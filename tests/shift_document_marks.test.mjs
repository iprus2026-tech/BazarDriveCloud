// #1185 — the Documents tab vs the line gate. A shift document («Путевой лист», «Медосмотр») and
// its readiness mark (`waybillOpen`, `medicalCheckPassed`) are one fact: marking the document
// used to leave the mark false, so the gate stayed at 5/7 with every document added.
// Runs the real state.js over an in-memory localStorage.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const {
  user, setDocumentStatus, shiftMarksFromDocuments, isDriverLineReady,
} = await import('../public/src/state.js');

const PROFILE = { role: 'driver', phone: '+79001234567', vehicleMake: 'Toyota', vehicleModel: 'Camry', vehiclePlate: 'А123ВС77' };
const persisted = () => JSON.parse(store.get('bazardrive.user.v1'));

beforeEach(() => { store.clear(); user.reset(); user.set(PROFILE); });

test('marking a shift document raises its own mark, and only its own', () => {
  setDocumentStatus('waybill', 'uploaded');
  assert.equal(user.get().waybillOpen, true);
  assert.equal(user.get().medicalCheckPassed, false);
  setDocumentStatus('medicalCheck', 'uploaded');
  assert.equal(user.get().medicalCheckPassed, true);
  assert.equal(persisted().waybillOpen, true, 'the mark is stored, not only cached');
  assert.equal(persisted().medicalCheckPassed, true);
});

test('every document marked in the Documents tab makes the driver line-ready', () => {
  assert.equal(isDriverLineReady(user.get()), false);
  for (const key of ['taxiRegistry', 'waybill', 'medicalCheck']) setDocumentStatus(key, 'uploaded');
  const u = user.get();
  assert.equal(u.documentsReady, true);
  assert.equal(u.shiftDocsReady, true);
  assert.equal(isDriverLineReady(u), true);
});

test('a registration document does not touch the shift marks', () => {
  setDocumentStatus('taxiRegistry', 'uploaded');
  setDocumentStatus('driverLicense', 'expired');
  assert.equal(user.get().waybillOpen, false);
  assert.equal(user.get().medicalCheckPassed, false);
});

test('a shift document that stops being ready lowers its mark', () => {
  setDocumentStatus('waybill', 'uploaded');
  setDocumentStatus('medicalCheck', 'review_required');
  assert.equal(user.get().medicalCheckPassed, true, 'review_required counts as ready, as for shiftDocsReady');
  setDocumentStatus('waybill', 'expired');
  assert.equal(user.get().waybillOpen, false);
  assert.equal(user.get().medicalCheckPassed, true);
  setDocumentStatus('medicalCheck', 'missing');
  assert.equal(user.get().medicalCheckPassed, false);
});

test('the Такси·ИП action order (mark first, document second) keeps the mark', () => {
  user.set({ waybillOpen: true });
  setDocumentStatus('waybill', 'uploaded');
  assert.equal(user.get().waybillOpen, true);
  assert.equal(user.get().driverDocuments.waybill.status, 'uploaded');
});

test('an unknown key or status changes nothing', () => {
  const before = JSON.stringify(user.get());
  setDocumentStatus('waybill', 'done');
  setDocumentStatus('passport', 'uploaded');
  assert.equal(JSON.stringify(user.get()), before);
});

test('shiftMarksFromDocuments maps the two shift documents to the two marks', () => {
  assert.deepEqual(shiftMarksFromDocuments({ waybill: { status: 'uploaded' }, medicalCheck: { status: 'missing' } }),
    { waybillOpen: true, medicalCheckPassed: false });
  assert.deepEqual(shiftMarksFromDocuments({ waybill: { status: 'draft' }, medicalCheck: { status: 'review_required' } }),
    { waybillOpen: false, medicalCheckPassed: true });
  assert.deepEqual(shiftMarksFromDocuments({}), { waybillOpen: false, medicalCheckPassed: false });
  assert.deepEqual(shiftMarksFromDocuments(null), { waybillOpen: false, medicalCheckPassed: false });
});

test('onboarding finish writes the marks with the documents it writes', () => {
  const src = fs.readFileSync(new URL('../public/src/screens/onboarding.js', import.meta.url), 'utf8');
  assert.match(src, /driverDocuments,[\s\S]{0,400}\.\.\.shiftMarksFromDocuments\(driverDocuments\),\s*\}\);/);
  // The same patch, replayed: both shift boxes ticked, then both left empty.
  const ticked = { driverLicense: { status: 'uploaded' }, taxiOsago: { status: 'uploaded' }, taxiRegistry: { status: 'uploaded' }, waybill: { status: 'uploaded' }, medicalCheck: { status: 'uploaded' } };
  user.set({ documentsReady: true, driverDocuments: ticked, ...shiftMarksFromDocuments(ticked) });
  assert.equal(isDriverLineReady(user.get()), true);
  const requiredOnly = { ...ticked, waybill: { status: 'missing' }, medicalCheck: { status: 'missing' } };
  user.set({ documentsReady: true, driverDocuments: requiredOnly, ...shiftMarksFromDocuments(requiredOnly) });
  assert.equal(user.get().documentsReady, true);
  assert.equal(isDriverLineReady(user.get()), false, 'registration is complete, the shift is not');
});
