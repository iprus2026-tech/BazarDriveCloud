// /server/test/auth-tokens.test.mjs — hermetic (no DB, no network) unit tests for the auth
// token/OTP primitives (services/auth/tokens.js): opaque token + numeric OTP minting and
// the one-way hashes used for auth_session.token_hash / auth_otp.code_hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  hashToken,
  hashOtpCode,
  generateToken,
  generateOtpCode,
} from '../src/services/auth/tokens.js';

test('hashToken / hashOtpCode are deterministic 64-char sha256 hex', () => {
  for (const fn of [hashToken, hashOtpCode]) {
    const h = fn('abc');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(fn('abc'), h, 'same input => same hash');
    assert.notEqual(fn('abd'), h, 'different input => different hash');
  }
});

test('generateToken mints a high-entropy, URL/header-safe opaque token', () => {
  const a = generateToken();
  const b = generateToken();
  assert.equal(typeof a, 'string');
  assert.ok(a.length >= 32, `expected a long token, got ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'base64url: no +, /, or = padding');
  assert.notEqual(a, b, 'two mints must differ (random)');
  assert.match(hashToken(a), /^[0-9a-f]{64}$/, 'hashes cleanly for token_hash');
});

test('generateOtpCode returns exactly `length` digits (default 4), zero-padded', () => {
  for (let i = 0; i < 200; i += 1) {
    const c = generateOtpCode();
    assert.match(c, /^\d{4}$/, `default length 4 digits, got "${c}"`);
  }
  for (const len of [1, 5, 6, 8]) {
    const c = generateOtpCode(len);
    assert.equal(c.length, len, `length ${len}`);
    assert.match(c, /^\d+$/, 'all digits');
  }
});

test('generateOtpCode covers leading-zero codes (padStart) and the full range', () => {
  let sawLeadingZero = false;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 2000; i += 1) {
    const c = generateOtpCode(4);
    if (c[0] === '0') sawLeadingZero = true;
    const n = Number(c);
    if (n < min) min = n;
    if (n > max) max = n;
  }
  assert.ok(sawLeadingZero, 'a 4-digit code must sometimes start with 0 (zero-padded)');
  assert.ok(min < 1000, 'codes below 1000 occur (range starts at 0)');
  assert.ok(max >= 1000, 'codes at/above 1000 occur');
});
