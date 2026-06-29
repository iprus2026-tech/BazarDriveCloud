// /server/test/serialize.test.mjs — hermetic (no DB) unit tests for the order projection
// (serialize.serializeOrder). The security-critical invariant: passenger.isCurrentUser is
// recomputed PER VIEWER from passenger_id, and the stored snapshot's isCurrentUser is NEVER
// echoed (migrations/0002 note; else every viewer would see an order as "mine").
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeOrder, serializeOffer, serializeAssignment } from '../src/serialize.js';

const baseRow = {
  id: '11111111-1111-1111-1111-111111111111',
  legacy_id: 'order-abc',
  passenger_id: 'user-1',
  type: 'passenger_request',
  source: 'map',
  status: 'CREATED',
  pickup: { lng: 37.6, lat: 55.7, label: 'A' },
  dropoff: { lng: 37.7, lat: 55.8, label: 'B' },
  distance_km: '12.500',          // pg NUMERIC comes back as a string
  duration_min: 30,
  estimated_price: '1480.00',
  estimated_price_label: '1 480 ₽',
  scheduled_mode: 'now',
  scheduled_at: '',
  scheduled_label: '',
  comment: 'hi',
  passenger_snapshot: { name: 'Анна', initials: 'АМ', authorId: 'user-1', isCurrentUser: true },
  created_at: new Date('2026-06-28T12:00:00.000Z'),
  accepted_at: null,
};

test('serializeOrder maps the DB row to the client camelCase shape (id = legacy_id)', () => {
  const o = serializeOrder(baseRow, { viewerId: null });
  assert.equal(o.id, 'order-abc', 'client-facing id is the legacy join key');
  assert.equal(o.status, 'CREATED');
  assert.equal(o.source, 'map');
  assert.deepEqual(o.pickup, { lng: 37.6, lat: 55.7, label: 'A' });
  assert.equal(o.distanceKm, 12.5, 'NUMERIC string -> number');
  assert.equal(o.estimatedPrice, 1480);
  assert.equal(o.estimatedPriceLabel, '1 480 ₽');
  assert.equal(o.comment, 'hi');
  assert.equal(o.createdAt, '2026-06-28T12:00:00.000Z', 'Date -> ISO');
});

test('isCurrentUser is per-viewer; the public projection exposes NO passenger PII', () => {
  // The stored snapshot says isCurrentUser:true and the owner is user-1.
  assert.equal(serializeOrder(baseRow, { viewerId: 'user-1' }).passenger.isCurrentUser, true,
    'owner sees it as mine');
  const asOther = serializeOrder(baseRow, { viewerId: 'user-2' });
  assert.equal(asOther.passenger.isCurrentUser, false,
    'a DIFFERENT viewer must NOT see it as mine, despite the stored flag=true');
  assert.equal(serializeOrder(baseRow, { viewerId: null }).passenger.isCurrentUser, false,
    'anonymous viewer => false');
  // The stored snapshot's PII / internal id must NOT leak on this public projection (Codex R03).
  assert.deepEqual(Object.keys(asOther.passenger), ['isCurrentUser'], 'passenger carries ONLY isCurrentUser');
  assert.equal(asOther.passenger.name, undefined, 'no name leaked');
  assert.equal(asOther.passenger.phoneMasked, undefined, 'no masked phone leaked');
  assert.equal(asOther.passenger.authorId, undefined, 'no internal user id leaked');
});

test('serializeOrder tolerates a null snapshot, null geo, and a null owner', () => {
  const row = { ...baseRow, passenger_snapshot: null, pickup: null, dropoff: null, passenger_id: null };
  const o = serializeOrder(row, { viewerId: 'user-1' });
  assert.equal(o.pickup, null);
  assert.equal(o.passenger.isCurrentUser, false, 'no owner => not mine even for a logged-in viewer');
  assert.deepEqual(Object.keys(o.passenger), ['isCurrentUser']);
});

test('serializeOrder(null/undefined) => null', () => {
  assert.equal(serializeOrder(null), null);
  assert.equal(serializeOrder(undefined), null);
});

const offerRow = {
  legacy_id: 'offer_order-1_driver-9',
  order_id: 'uuid-order',
  driver_id: 'driver-9',
  status: 'sent',
  driver_name: 'Иван', car: 'Kia Rio', rating: '4,9',
  eta_min: 5, price: '850.00', message: 'еду',
  created_at: new Date('2026-06-29T10:00:00.000Z'),
  updated_at: new Date('2026-06-29T10:00:00.000Z'),
  expires_at: new Date('2026-06-29T10:15:00.000Z'),
};

test('serializeOffer maps an offers row to the owner-facing shape (id, driverId, NUMERIC->number, ISO)', () => {
  const o = serializeOffer(offerRow, { orderLegacyId: 'order-1' });
  assert.equal(o.id, 'offer_order-1_driver-9');
  assert.equal(o.orderId, 'order-1', 'caller-supplied legacy order id');
  assert.equal(o.driverId, 'driver-9');
  assert.equal(o.status, 'sent');
  assert.equal(o.driverName, 'Иван');
  assert.equal(o.etaMin, 5);
  assert.equal(o.price, 850, 'NUMERIC string -> number');
  assert.equal(o.expiresAt, '2026-06-29T10:15:00.000Z', 'Date -> ISO');
});

test('serializeOffer tolerates null detail fields / orderLegacyId / a null row', () => {
  const row = { legacy_id: 'offer_x', driver_id: 'd', status: 'withdrawn', price: null,
    driver_name: null, car: null, rating: null, eta_min: null, message: null,
    created_at: new Date(), updated_at: new Date(), expires_at: new Date() };
  const o = serializeOffer(row, {});
  assert.equal(o.price, null);
  assert.equal(o.orderId, null);
  assert.equal(o.etaMin, null);
  assert.equal(serializeOffer(null), null);
});

test('serializeAssignment maps the ACCEPTED overlay row to the owner-facing shape', () => {
  const row = { order_id: 'uuid', status: 'ACCEPTED', selected_driver_id: 'driver-9',
    canceled_by: null, canceled_at: null, updated_at: new Date('2026-06-29T10:00:00.000Z') };
  const a = serializeAssignment(row, { orderLegacyId: 'order-1' });
  assert.equal(a.orderId, 'order-1');
  assert.equal(a.status, 'ACCEPTED');
  assert.equal(a.selectedDriverId, 'driver-9');
  assert.equal(a.canceledBy, null);
  assert.equal(a.updatedAt, '2026-06-29T10:00:00.000Z');
  assert.equal(serializeAssignment(null), null);
});
