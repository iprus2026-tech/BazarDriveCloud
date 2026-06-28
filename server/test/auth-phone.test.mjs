// /server/test/auth-phone.test.mjs — hermetic (no DB) unit tests for the OTP identity-key
// phone normalizer/validator (services/auth/phone.js). Normalization must map cosmetic
// variants of the SAME number to ONE canonical key (so request and verify agree and one
// account exists per phone), and validation must reject empty/garbage before any OTP is minted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, isValidPhone } from '../src/services/auth/phone.js';

test('normalizePhone strips cosmetic separators and keeps a single leading +', () => {
  assert.equal(normalizePhone('+7 (999) 123-45-67'), '+79991234567');
  assert.equal(normalizePhone('  +1 555 000 1234  '), '+15550001234');
  assert.equal(normalizePhone('15550001234'), '15550001234', 'no + => none added');
  // cosmetic variants collapse to ONE canonical key.
  assert.equal(normalizePhone('+1-555-000-1234'), normalizePhone('+1 (555) 000.1234'));
});

test('normalizePhone returns "" for non-strings / empty / no-digit input', () => {
  for (const bad of [undefined, null, 42, {}, '', '   ', '+', '()- .']) {
    assert.equal(normalizePhone(bad), '', `expected "" for ${JSON.stringify(bad)}`);
  }
});

test('isValidPhone accepts E.164-ish numbers and rejects garbage', () => {
  for (const ok of ['+79991234567', '15550001234', '+1234567', '+123456789012345']) {
    assert.equal(isValidPhone(ok), true, `expected valid: ${ok}`);
  }
  for (const bad of [
    '',            // empty
    'not-a-phone', // letters
    '+0123456789', // leading zero after +
    '123456',      // too short (<7)
    '+1234567890123456', // too long (>15)
  ]) {
    assert.equal(isValidPhone(bad), false, `expected invalid: ${bad}`);
  }
});
