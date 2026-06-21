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
