// #1185 — states that used to be lost: opened Inbox items, and a driver trip closed with
// «Закрыть поездку». Both are stored; this runs the real modules over an in-memory localStorage.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const api = await import('../public/src/mock_api.js');
const history = await import('../public/src/ride_history.js');

beforeEach(() => { store.clear(); });

test('an opened Inbox item is no longer unread, and stays so on the next read', async () => {
  const before = await api.listInboxItems();
  const unread = before.filter((item) => item.unread);
  assert.ok(unread.length > 0, 'the seed has unread items');
  const target = unread[0];
  assert.equal(api.markInboxItemRead(target.id), true);
  const after = await api.listInboxItems();
  assert.equal(after.find((item) => item.id === target.id).unread, false);
  assert.equal(after.filter((item) => item.unread).length, unread.length - 1, 'only that item changed');
  assert.deepEqual(JSON.parse(store.get('bazardrive.inbox_read.v1')), [target.id]);
});

test('marking twice stores the id once; a bad id is refused; the seed is not mutated', async () => {
  const [first] = (await api.listInboxItems()).filter((item) => item.unread);
  api.markInboxItemRead(first.id);
  api.markInboxItemRead(first.id);
  assert.equal(JSON.parse(store.get('bazardrive.inbox_read.v1')).length, 1);
  assert.equal(api.markInboxItemRead(''), false);
  assert.equal(api.markInboxItemRead(null), false);
  api.clearInboxReadStore();
  assert.equal(store.has('bazardrive.inbox_read.v1'), false);
  assert.equal((await api.listInboxItems()).find((item) => item.id === first.id).unread, true, 'unread again after the boundary clear');
});

test('a malformed read-store is ignored', async () => {
  store.set('bazardrive.inbox_read.v1', '{not json');
  assert.ok((await api.listInboxItems()).some((item) => item.unread));
  store.set('bazardrive.inbox_read.v1', JSON.stringify({ a: 1 }));
  assert.ok((await api.listInboxItems()).some((item) => item.unread));
});

test('a closed driver trip is remembered on its history entry and survives a re-save', () => {
  assert.equal(history.isDriverTripClosed('trip-1'), false);
  assert.equal(history.markDriverTripClosed('trip-1'), false, 'no history entry yet — nothing to stamp');
  history.saveRideHistoryEntry({ role: 'driver', tripId: 'trip-1', fare: '420 ₽' });
  history.saveRideHistoryEntry({ role: 'passenger', tripId: 'trip-1' });
  assert.equal(history.markDriverTripClosed('trip-1'), true);
  assert.equal(history.isDriverTripClosed('trip-1'), true);
  // The completion screen re-saves the entry on every render: the stamp must stay.
  history.saveRideHistoryEntry({ role: 'driver', tripId: 'trip-1', fare: '420 ₽' });
  assert.equal(history.isDriverTripClosed('trip-1'), true);
  const entries = history.loadRideHistory();
  assert.equal(entries.find((e) => e.role === 'passenger' && e.tripId === 'trip-1').closedAt, undefined, 'only the driver entry is stamped');
  assert.equal(history.isDriverTripClosed('trip-2'), false);
  history.clearRideHistory();
  assert.equal(history.isDriverTripClosed('trip-1'), false, 'cleared with the history');
});
