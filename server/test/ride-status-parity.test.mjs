// /server/test/ride-status-parity.test.mjs — the enum-parity gate (ADR BD-DOCS-041):
// pins the server's domain/ride-status.js against the CLIENT's public/src/ride_state.js
// and FAILS CI on any drift in the RIDE_STATUS literals, the driver-advance map, the
// isValid predicate, or the terminal-freeze rule. This is what lets RIDE_STATUS authority
// move client->server "without changing the enum or transitions".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as server from '../src/domain/ride-status.js';

// The client module reaches for browser localStorage inside its stateful helpers; stub it
// so we can import the module under node:test without a DOM (top-level is import-safe).
globalThis.localStorage ??= (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
})();

const client = await import('../../public/src/ride_state.js');
const ALL = Object.keys(server.RIDE_STATUS);

test('RIDE_STATUS literals match the client verbatim', () => {
  assert.deepEqual({ ...server.RIDE_STATUS }, { ...client.RIDE_STATUS });
  assert.equal(ALL.length, 12, 'the whole 12-status lifecycle moves, not a subset');
});

test('getNextStatus matches client getNextDriverStatus for every status', () => {
  for (const s of ALL) {
    assert.equal(server.getNextStatus(s), client.getNextDriverStatus(s), `next(${s})`);
  }
});

test('isValidRideStatus matches the client over valid + invalid probes', () => {
  const probes = [...ALL, 'BOGUS', '', 'new_order', 'COMPLETED ', null, undefined, 7];
  for (const s of probes) {
    assert.equal(server.isValidRideStatus(s), client.isValidRideStatus(s), `valid(${String(s)})`);
  }
});

test('STATUS_TIMESTAMP_FIELD mirrors the client verbatim (R06 chokepoint stamps)', () => {
  assert.deepEqual({ ...server.STATUS_TIMESTAMP_FIELD }, { ...client.STATUS_TIMESTAMP_FIELD });
  // every mapped key is a real status, and every mapped value is a known timestamp field.
  const TS_FIELDS = new Set(['acceptedAt', 'approachingAt', 'arrivedAt', 'startedAt', 'completedAt', 'canceledAt']);
  for (const [status, field] of Object.entries(server.STATUS_TIMESTAMP_FIELD)) {
    assert.ok(server.isValidRideStatus(status), `${status} is a real status`);
    assert.ok(TS_FIELDS.has(field), `${field} is a known timestamp field`);
  }
});

test('terminal set is exactly {CANCELED, COMPLETED, NO_SHOW}', () => {
  assert.deepEqual([...server.TERMINAL_RIDE_STATUSES].sort(), ['CANCELED', 'COMPLETED', 'NO_SHOW']);
  for (const s of server.TERMINAL_RIDE_STATUSES) {
    assert.ok(server.isValidRideStatus(s), `${s} must be a real status`);
  }
});

test('canTransition mirrors the client terminal-freeze for every (from,to) pair', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const tripId = `parity_${from}_${to}`;
      // seed a ride in `from`, then attempt to move it to `to` through the client store.
      client.saveActiveRide({ tripId, status: from });
      const after = client.saveActiveRide({ tripId, status: to });
      const clientAllowed = after.status === to;
      assert.equal(server.canTransition(from, to), clientAllowed, `${from} -> ${to}`);
    }
  }
});
