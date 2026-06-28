// /server/test/auth-phone.test.mjs — hermetic (no DB) unit tests for the OTP identity-key
// phone normalizer/validator (services/auth/phone.js). Normalization must canonicalize every
// cosmetic variant of the SAME number to ONE key (so request and verify agree and one account
// exists per phone — Codex #788), and validation must reject empty/garbage/non-canonical input
// before any OTP is minted.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, isValidPhone } from '../src/services/auth/phone.js';

test('normalizePhone canonicalizes to a single leading + and strips cosmetic separators', () => {
  assert.equal(normalizePhone('+7 (999) 123-45-67'), '+79991234567');
  assert.equal(normalizePhone('  +1 555 000 1234  '), '+15550001234');
  assert.equal(normalizePhone('15550001234'), '+15550001234', 'a missing + is added (canonical)');
  assert.equal(normalizePhone('+1-555-000-1234'), normalizePhone('+1 (555) 000.1234'));
});

test('normalizePhone collapses with/without "+" to ONE identity key, never merges distinct numbers', () => {
  assert.equal(normalizePhone('+15550001234'), normalizePhone('15550001234'), 'same digits => one key');
  assert.equal(normalizePhone('15550001234'), '+15550001234');
  assert.notEqual(normalizePhone('+15550001234'), normalizePhone('15550001235'), 'different digits never merge');
});

test('normalizePhone returns "" for non-strings / empty / no-digit input', () => {
  for (const bad of [undefined, null, 42, {}, '', '   ', '+', '()- .']) {
    assert.equal(normalizePhone(bad), '', `expected "" for ${JSON.stringify(bad)}`);
  }
});

test('isValidPhone accepts canonical E.164 (+digits) and rejects garbage / non-canonical', () => {
  for (const ok of ['+79991234567', '+15550001234', '+1234567', '+123456789012345']) {
    assert.equal(isValidPhone(ok), true, `expected valid: ${ok}`);
  }
  for (const bad of [
    '',                  // empty
    '15550001234',       // no leading + (normalizePhone always adds it — non-canonical here)
    'not-a-phone',       // letters
    '+0123456789',       // leading zero after +
    '+123456',           // too short (<7 digits)
    '+1234567890123456', // too long (>15 digits)
  ]) {
    assert.equal(isValidPhone(bad), false, `expected invalid: ${bad}`);
  }
});
