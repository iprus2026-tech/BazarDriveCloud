// #1185 — node:test coverage for the onboarding wizard's obvious-garbage guards. Both are pure and
// deliberately loose: accepted plate FORMATS are an open product decision (#1178).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isPlausiblePhone, isPlausiblePlate } from '../public/src/screens/onboarding.js';

test('a phone is 10 digits, or 11 with the 7/8 prefix', () => {
  assert.equal(isPlausiblePhone('9001234567'), true);
  assert.equal(isPlausiblePhone('79001234567'), true);
  assert.equal(isPlausiblePhone('89001234567'), true);
  assert.equal(isPlausiblePhone('+7 (900) 123-45-67'), true, 'formatting is ignored');
});

test('empty, too short, too long or a foreign 11-digit prefix is not a phone', () => {
  for (const bad of ['', null, undefined, '12', '900123456', '19001234567', '9001234567890123']) {
    assert.equal(isPlausiblePhone(bad), false, `rejected: ${bad}`);
  }
});

test('a plate has letters and digits, 4–12 of them; spaces and hyphens are fine', () => {
  for (const ok of ['А 123 АА 77', 'А123ВС77', 'a123bc77', '123 ABC 02', 'KZ-123-ABC', 'AB12']) {
    assert.equal(isPlausiblePlate(ok), true, `accepted: ${ok}`);
  }
});

test('punctuation, letters only, digits only, or the wrong length is not a plate', () => {
  for (const bad of ['!!!', 'A!23BC', 'ABCDEF', '123456', 'A1', 'А123ВС77А123ВС77']) {
    assert.equal(isPlausiblePlate(bad), false, `rejected: ${bad}`);
  }
});

test('an empty plate is left to the readiness checklist', () => {
  assert.equal(isPlausiblePlate(''), true);
  assert.equal(isPlausiblePlate('   '), true);
  assert.equal(isPlausiblePlate(null), true);
});
