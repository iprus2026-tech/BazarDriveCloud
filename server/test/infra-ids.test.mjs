// /server/test/infra-ids.test.mjs — hermetic unit test for the business-id minter (infra/ids).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newOrderId } from '../src/infra/ids.js';

test('newOrderId mints unique order-<uuid> ids', () => {
  const a = newOrderId();
  const b = newOrderId();
  assert.match(a, /^order-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(a, b, 'two mints differ (collision-resistant)');
});
