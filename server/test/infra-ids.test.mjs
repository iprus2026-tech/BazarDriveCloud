// /server/test/infra-ids.test.mjs — hermetic unit test for the business-id minter (infra/ids).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newOrderId, newOfferId } from '../src/infra/ids.js';

test('newOrderId mints unique order-<uuid> ids', () => {
  const a = newOrderId();
  const b = newOrderId();
  assert.match(a, /^order-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(a, b, 'two mints differ (collision-resistant)');
});

test('newOfferId is the deterministic (order,driver) composite key', () => {
  assert.equal(newOfferId('order-1', 'driver-9'), 'offer_order-1_driver-9');
  assert.equal(newOfferId('order-1', 'driver-9'), newOfferId('order-1', 'driver-9'), 'stable/idempotent');
  assert.notEqual(newOfferId('order-1', 'driver-9'), newOfferId('order-1', 'driver-8'));
});
