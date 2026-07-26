// /server/test/config.test.mjs — loadConfig() env validation. Pins the ALLOWED_ORIGIN
// exact-origin / no-wildcard boundary (ADR BD-DOCS-041): "*" and malformed origins must be
// rejected at startup, before cors.js registers @fastify/cors with the value.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://u@localhost:5432/db' };

test('production rejects ALLOWED_ORIGIN="*" (no allow-any-origin CORS)', () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGIN: '*' }),
    /Invalid ALLOWED_ORIGIN/,
  );
});

test('a "*" is rejected even outside production (a wildcard is never valid)', () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: 'development', ALLOWED_ORIGIN: '*' }),
    /Invalid ALLOWED_ORIGIN/,
  );
});

test('malformed ALLOWED_ORIGIN values are rejected (no scheme, path, slash, list, non-http)', () => {
  for (const bad of [
    'github.io',
    'https://a.github.io/',
    'https://a.github.io/path',
    'https://a.io,https://b.io',
    'ftp://a.io',
  ]) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGIN: bad }),
      /Invalid ALLOWED_ORIGIN/,
      `expected reject: ${bad}`,
    );
  }
});

test('a single exact http(s) origin is accepted', () => {
  const cfg = loadConfig({
    ...base,
    NODE_ENV: 'production',
    ALLOWED_ORIGIN: 'https://iprus2026-tech.github.io',
  });
  assert.equal(cfg.allowedOrigin, 'https://iprus2026-tech.github.io');
});

test('ALLOWED_ORIGIN is optional in dev/test (unset => CORS off, no throw)', () => {
  const cfg = loadConfig({ ...base, NODE_ENV: 'development' });
  assert.equal(cfg.allowedOrigin, '');
});

test('production still requires ALLOWED_ORIGIN to be present', () => {
  assert.throws(
    () => loadConfig({ ...base, NODE_ENV: 'production' }),
    /Missing required env: ALLOWED_ORIGIN/,
  );
});

// --- AUTH knobs (BD-DOCS-032; parsed-but-dark until the OTP-verify cutover, R02) ---

test('OTP/session knobs default sensibly (ttl 300, length 4, maxAttempts 5, session ttl 0)', () => {
  const cfg = loadConfig({ ...base, NODE_ENV: 'development' });
  assert.equal(cfg.otp.ttlSeconds, 300);
  assert.equal(cfg.otp.length, 4);
  assert.equal(cfg.otp.maxAttempts, 5);
  assert.equal(cfg.session.ttlSeconds, 0, 'no session expiry modeled by default');
});

test('OTP dev-mode defaults ON outside production, OFF in production', () => {
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development' }).otp.devMode, true);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'test' }).otp.devMode, true);
  assert.equal(
    loadConfig({ ...base, NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://a.github.io' }).otp.devMode,
    false,
  );
});

test('OTP/session knobs honor explicit env overrides', () => {
  const cfg = loadConfig({
    ...base,
    NODE_ENV: 'development',
    OTP_TTL_SECONDS: '120',
    OTP_LENGTH: '6',
    OTP_MAX_ATTEMPTS: '3',
    OTP_DEV_MODE: 'false',
    SESSION_TTL_SECONDS: '86400',
  });
  assert.equal(cfg.otp.ttlSeconds, 120);
  assert.equal(cfg.otp.length, 6);
  assert.equal(cfg.otp.maxAttempts, 3);
  assert.equal(cfg.otp.devMode, false, 'explicit OTP_DEV_MODE=false overrides the dev default');
  assert.equal(cfg.session.ttlSeconds, 86400);
});

test('production rejects OTP_DEV_MODE=true at startup', () => {
  assert.throws(
    () => loadConfig({
      ...base, NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://a.github.io', OTP_DEV_MODE: 'true',
    }),
    /Invalid OTP_DEV_MODE/,
  );
});

test('production accepts explicit OTP_DEV_MODE=false', () => {
  const cfg = loadConfig({
    ...base, NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://a.github.io', OTP_DEV_MODE: 'false',
  });
  assert.equal(cfg.otp.devMode, false);
});

test('development still allows OTP_DEV_MODE=true', () => {
  const cfg = loadConfig({ ...base, NODE_ENV: 'development', OTP_DEV_MODE: 'true' });
  assert.equal(cfg.otp.devMode, true);
});

test('OTP_LENGTH out of the supported range is rejected at startup (no per-request 500)', () => {
  for (const bad of ['15', '0', '3', '11', 'abc']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', OTP_LENGTH: bad }),
      /Invalid OTP_LENGTH/,
      `expected reject: ${bad}`,
    );
  }
});

test('OTP_TTL_SECONDS must be an integer in 1..3600 (NaN/<=0/over-ceiling rejected at startup)', () => {
  // NOTE: parseInt('300abc')->300 by design (matches the existing OTP_LENGTH guard); the
  // guard's job is rejecting NaN ('abc'), non-positive values, and an absurd over-ceiling value
  // (e.g. 1e20) that would otherwise overflow Date math into a per-request 500 — not fractional
  // truncation.
  for (const bad of ['abc', '0', '-1', '3601', '99999999999999999999']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', OTP_TTL_SECONDS: bad }),
      /Invalid OTP_TTL_SECONDS/,
      `expected reject: ${bad}`,
    );
  }
  // the ceiling itself is accepted.
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', OTP_TTL_SECONDS: '3600' }).otp.ttlSeconds, 3600);
});

test('OTP_MAX_ATTEMPTS must be an integer in 1..100 (NaN/<=0/over-ceiling rejected at startup)', () => {
  // An absurdly large cap would silently DISABLE the only live brute-force lockout (Codex #788),
  // so it is bounded like the other knobs.
  for (const bad of ['abc', '0', '-2', '101', '99999999999999999999']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', OTP_MAX_ATTEMPTS: bad }),
      /Invalid OTP_MAX_ATTEMPTS/,
      `expected reject: ${bad}`,
    );
  }
  // the ceiling itself is accepted.
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', OTP_MAX_ATTEMPTS: '100' }).otp.maxAttempts, 100);
});

test('SESSION_TTL_SECONDS must be an integer in 0..315360000 (NaN/negative/over-ceiling rejected; 0 allowed)', () => {
  for (const bad of ['abc', '-1', '315360001', '99999999999999999999']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', SESSION_TTL_SECONDS: bad }),
      /Invalid SESSION_TTL_SECONDS/,
      `expected reject: ${bad}`,
    );
  }
  // 0 is valid (no expiry modeled); the ceiling itself is accepted.
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', SESSION_TTL_SECONDS: '0' }).session.ttlSeconds, 0);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', SESSION_TTL_SECONDS: '315360000' }).session.ttlSeconds, 315360000);
});
