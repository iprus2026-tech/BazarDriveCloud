// /server/test/auth-bearer.test.mjs — bearerToken (plugins/auth.js) without a backtracking regex
// (CodeQL js/polynomial-redos, alert #1): the same result as the old /^Bearer\s+(.+)$/i on the
// trimmed header, and linear time on a hostile header. Hermetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bearerToken } from '../src/plugins/auth.js';

// The previous implementation, kept here as the reference.
function oldBearerToken(authHeader) {
  if (typeof authHeader !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : '';
}

test('bearerToken: the same result as the old regex on ordinary and odd headers', () => {
  const inputs = [
    'Bearer abc', 'bearer abc', 'BEARER abc', '  Bearer   abc  ', 'Bearer\tabc', 'Bearer\n abc', 'Bearer \t\n abc def',
    'Bearer', 'Bearer ', 'Bearer\t', 'Bearerabc', 'Bear abc', 'Basic abc', '', ' ', 'Bearer abc\ndef', 'Bearer abc\rdef',
    'Bearer abc def', 'Bearer a', 'Bearer  a b  c ', 'xBearer abc', 'Bearer abc', 'Bearer abc',
  ];
  for (const header of inputs) {
    assert.equal(bearerToken(header), oldBearerToken(header), JSON.stringify(header));
  }
  for (const header of [undefined, null, 5, {}, ['Bearer abc']]) assert.equal(bearerToken(header), '');
});

test('bearerToken: linear on a long whitespace run (no ReDoS)', () => {
  // The quadratic case for the old regex: a long whitespace run, then a token with a line break
  // (20 000 tabs took ~0.7 s with the old /^Bearer\s+(.+)$/i).
  const hostile = `bearer\t${'\t'.repeat(50_000)}x\ny`;
  const started = process.hrtime.bigint();
  assert.equal(bearerToken(hostile), '');
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
});
