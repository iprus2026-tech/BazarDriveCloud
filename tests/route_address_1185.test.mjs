// #1185 — the route picker and what it hands to the order:
//   · the city and the entrance note of a manually entered address never left the passenger's
//     device (the order carried the street line alone);
//   · text typed into a route field was erased by «Готово», by a tap on the other field, and by a
//     tap inside the field itself.

import { test } from 'node:test';
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

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const { manualAddressLabel } = await import('../public/src/screens/route_picker.js');
const { routeNoteOf, offerRouteNote } = await import('../public/src/screens/order_map_draft.js');

test('a manual address carries its city in the label', () => {
  assert.equal(manualAddressLabel('Химки', 'ул. Ленина, 5'), 'Химки, ул. Ленина, 5');
  assert.equal(manualAddressLabel(' Москва ', ' ул. Тверская, 12 '), 'Москва, ул. Тверская, 12');
});

test('the city is not repeated, and either part alone is the whole label', () => {
  assert.equal(manualAddressLabel('Химки', 'Химки, ул. Ленина, 5'), 'Химки, ул. Ленина, 5');
  assert.equal(manualAddressLabel('химки', 'г. Химки, ул. Ленина, 5'), 'г. Химки, ул. Ленина, 5');
  assert.equal(manualAddressLabel('', 'ул. Ленина, 5'), 'ул. Ленина, 5');
  assert.equal(manualAddressLabel('Химки', ''), 'Химки');
  assert.equal(manualAddressLabel('', ''), '');
});

test('the city is matched as a whole part of the address, not as letters inside a word', () => {
  // Codex review on #1216: «томская» contains «омск», and the city was silently dropped.
  assert.equal(manualAddressLabel('Омск', 'Томская улица, 5'), 'Омск, Томская улица, 5');
  assert.equal(manualAddressLabel('Тула', 'ул. Тульская, 3'), 'Тула, ул. Тульская, 3');
  assert.equal(manualAddressLabel('Москва', 'Московский проспект, 10'), 'Москва, Московский проспект, 10');
  assert.equal(manualAddressLabel('Химки', 'ул. Химкинская, 1, Химки'), 'ул. Химкинская, 1, Химки', 'named as its own part, anywhere in the line');
  assert.equal(manualAddressLabel('Нижний  Новгород', 'нижний новгород, ул. Ленина, 5'), 'нижний новгород, ул. Ленина, 5');
  assert.equal(manualAddressLabel('г. Химки', 'город Химки, ул. Ленина, 5'), 'город Химки, ул. Ленина, 5');
  assert.equal(manualAddressLabel('г.Химки', 'Химки, ул. Ленина, 5'), 'Химки, ул. Ленина, 5');
  assert.equal(manualAddressLabel('Горки', 'ул. Ленина, 5'), 'Горки, ул. Ленина, 5', 'a city starting with «г» keeps its name');
  assert.equal(manualAddressLabel('Горки', 'Горки, ул. Ленина, 5'), 'Горки, ул. Ленина, 5');
});

test('the route note is the pickup note, then the dropoff note marked «Куда:»', () => {
  const point = (note) => ({ label: 'x', ...(note === undefined ? {} : { note }) });
  assert.equal(routeNoteOf({ pickup: point('Подъезд 3, домофон 28#'), dropoff: point() }), 'Подъезд 3, домофон 28#');
  assert.equal(routeNoteOf({ pickup: point(), dropoff: point('вход со двора') }), 'Куда: вход со двора');
  assert.equal(routeNoteOf({ pickup: point(' Подъезд 3 '), dropoff: point('вход со двора') }), 'Подъезд 3 · Куда: вход со двора');
  assert.equal(routeNoteOf({ pickup: point(), dropoff: point() }), '');
  assert.equal(routeNoteOf({ pickup: point(7), dropoff: null }), '', 'a non-text note is no note');
  assert.equal(routeNoteOf(null), '');
  assert.equal(routeNoteOf({ pickup: point('я'.repeat(300)), dropoff: point() }).length, 200, 'fits the comment field');
});

test('the note is offered as the comment once, and never over the passenger\'s own text', () => {
  // first entry, empty comment
  assert.deepEqual(offerRouteNote({ note: 'Подъезд 3', applied: null, comment: '' }), { applied: 'Подъезд 3', comment: 'Подъезд 3' });
  // the passenger already typed something
  assert.deepEqual(offerRouteNote({ note: 'Подъезд 3', applied: null, comment: 'чемодан' }), { applied: 'Подъезд 3', comment: 'чемодан' });
  // the same note again (re-entry, reload): nothing changes — a cleared comment stays cleared
  assert.deepEqual(offerRouteNote({ note: 'Подъезд 3', applied: 'Подъезд 3', comment: '' }), { applied: 'Подъезд 3', comment: '' });
  assert.deepEqual(offerRouteNote({ note: 'Подъезд 3', applied: 'Подъезд 3', comment: 'Подъезд 3, чемодан' }), { applied: 'Подъезд 3', comment: 'Подъезд 3, чемодан' });
});

test('a new route replaces an offer the passenger did not edit, and clears a stale one', () => {
  assert.deepEqual(offerRouteNote({ note: 'Подъезд 7', applied: 'Подъезд 3', comment: 'Подъезд 3' }), { applied: 'Подъезд 7', comment: 'Подъезд 7' });
  assert.deepEqual(offerRouteNote({ note: '', applied: 'Подъезд 3', comment: 'Подъезд 3' }), { applied: '', comment: '' });
  assert.deepEqual(offerRouteNote({ note: '', applied: 'Подъезд 3', comment: 'Подъезд 3, чемодан' }), { applied: '', comment: 'Подъезд 3, чемодан' });
  // a route with no note and nothing offered before leaves the form alone
  assert.deepEqual(offerRouteNote({ note: '', applied: null, comment: 'чемодан' }), { applied: null, comment: 'чемодан' });
});

test('the picker saves the city in the label and the note on the point; the order form reads it', () => {
  const picker = read('../public/src/screens/route_picker.js');
  const save = picker.slice(picker.indexOf("if (action === 'manual-save') {"), picker.indexOf("if (action === 'edit-route') {"));
  assert.match(save, /manualAddressLabel\(city, street\)/);
  assert.match(save, /if \(extra\) point\.note = extra\.slice\(0, POINT_NOTE_MAX\);/);
  assert.match(picker, /typeof raw\.note === 'string' && raw\.note\.trim\(\) \? \{ note:/, 'the note survives the persisted draft');
  const form = read('../public/src/screens/order_map_draft.js');
  assert.match(form, /syncRouteFingerprint\(draft\);\s*applyRouteNote\(draft\);/);
  assert.match(form, /routeNote: appliedRouteNote,/, 'the offer is remembered with the saved form');
});

test('the order point sent to the server carries no note (the comment does)', () => {
  const utils = read('../public/src/passenger_order_utils.js');
  const fn = utils.slice(utils.indexOf('export function enrichOrderPointWithCoords('), utils.indexOf('const PLACE_ID_RE'));
  assert.doesNotMatch(fn, /note/, 'the server point schema is closed (additionalProperties: false)');
});

test('typed text survives «Готово», a tap on the other field and a tap inside its own field', () => {
  const picker = read('../public/src/screens/route_picker.js');
  assert.match(picker, /function commitTypedQuery\(\) \{\s*if \(!routeDraft\.query\.trim\(\)\) return false;\s*setPoint\(routeDraft\.focus, makeManualPoint\(\)\);\s*return true;\s*\}/);
  const done = picker.slice(picker.indexOf("if (action === 'done') {"), picker.indexOf("if (action === 'manual-open') {"));
  assert.match(done, /if \(!commitTypedQuery\(\) && routeDraft\.query\) \{/);
  const focus = picker.slice(picker.indexOf("const focusKind = target.closest('[data-focus]')"));
  assert.match(focus, /if \(focusKind === routeDraft\.focus && routeDraft\.query && !routeDraft\.manual\) return;/);
  assert.match(focus, /if \(focusKind !== routeDraft\.focus\) commitTypedQuery\(\);/);
});
