// /server/test/ops-driver-cli.test.mjs — hermetic tests for the `ops:driver` argument parser
// and output helpers (BD-AUTH-POLICY-01B-A). No database: the DB-backed CLI paths are covered
// in driver-enrollment-flow.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, pendingHeader, maskPhone } from '../scripts/ops-driver.mjs';

test('parseArgs accepts the documented forms', () => {
  assert.deepEqual(parseArgs(['list']), { command: 'list' });
  assert.deepEqual(parseArgs(['approve', '+79000001004']),
    { command: 'approve', target: '+79000001004', reason: null, by: null });
  assert.deepEqual(parseArgs(['revoke', '+79000001004', '--reason', 'expired licence', '--by', 'alice']),
    { command: 'revoke', target: '+79000001004', reason: 'expired licence', by: 'alice' });
  assert.deepEqual(parseArgs(['reject', '--by', 'bob', '+79000001004']),
    { command: 'reject', target: '+79000001004', reason: null, by: 'bob' });
});

test('a flag never takes another flag, an empty value or nothing as its operand', () => {
  for (const argv of [
    ['approve', '+79000001004', '--by', '--reason', 'x'],
    ['approve', '+79000001004', '--reason', '--by', 'alice'],
    ['approve', '+79000001004', '--by'],
    ['approve', '+79000001004', '--by', ''],
    ['approve', '+79000001004', '--reason', '   '],
    ['approve', '+79000001004', '--by', '-x'],
  ]) {
    assert.match(parseArgs(argv).error ?? '', /needs a value/, JSON.stringify(argv));
  }
});

test('parseArgs rejects unknown commands, options and extra arguments', () => {
  assert.match(parseArgs([]).error, /unknown command/);
  assert.match(parseArgs(['grant', 'x']).error, /unknown command/);
  assert.match(parseArgs(['list', 'extra']).error, /list takes no arguments/);
  assert.match(parseArgs(['approve']).error, /needs a <phone\|userId>/);
  assert.match(parseArgs(['approve', 'a', 'b']).error, /unexpected argument/);
  assert.match(parseArgs(['approve', 'a', '--force']).error, /unknown option/);
});

test('the pending header states the full count and when the display is capped', () => {
  assert.equal(pendingHeader(0, 0), 'pending driver applications: 0');
  assert.equal(pendingHeader(50, 50), 'pending driver applications: 50');
  assert.equal(pendingHeader(51, 50), 'pending driver applications: 51 (showing the oldest 50)');
});

test('maskPhone never reveals the middle digits', () => {
  assert.equal(maskPhone('+79000001004'), '+7 900 ***-10-04');
  assert.equal(maskPhone('+15550001234'), '+1555 ***1234');
  assert.equal(maskPhone(''), '-');
  assert.equal(maskPhone('+12345'), '***');
});
