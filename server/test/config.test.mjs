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

test('OTP/session knobs default sensibly (ttl 300, length 6, maxAttempts 5, session ttl 0)', () => {
  const cfg = loadConfig({ ...base, NODE_ENV: 'development' });
  assert.equal(cfg.otp.ttlSeconds, 300);
  assert.equal(cfg.otp.length, 6, 'BD-AUTH-HARDEN-01 (#824): 6 digits by default');
  assert.equal(cfg.otp.maxAttempts, 5);
  assert.equal(cfg.session.ttlSeconds, 0, 'no session expiry modeled by default');
});

// BD-AUTH-HARDEN-01 (#824): loadConfig always turns the OTP limits on — in every profile, with no
// env value that turns them off. Only a hand-built test config without `otp.limits` runs without.
test('OTP limits are on by default in every profile (60 s resend, 5/phone, 20/address, 10 failed checks per hour)', () => {
  const expected = { resendSeconds: 60, phoneRequestsPerHour: 5, ipRequestsPerHour: 20, phoneFailedVerifiesPerHour: 10 };
  for (const env of [
    { NODE_ENV: 'development' },
    { NODE_ENV: 'test' },
    { NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://a.github.io' },
    { NODE_ENV: 'development', PUBLIC_EXPOSURE: 'true', HOST: '127.0.0.1', SESSION_TTL_SECONDS: '86400' },
  ]) {
    assert.deepEqual(loadConfig({ ...base, ...env }).otp.limits, expected, JSON.stringify(env));
  }
});

test('OTP limits honor explicit env overrides; the resend pause alone may be 0', () => {
  const cfg = loadConfig({
    ...base,
    NODE_ENV: 'development',
    OTP_RESEND_SECONDS: '0',
    OTP_PHONE_REQUESTS_PER_HOUR: '50',
    OTP_IP_REQUESTS_PER_HOUR: '500',
    OTP_PHONE_FAILED_VERIFIES_PER_HOUR: '30',
  });
  assert.deepEqual(cfg.otp.limits, {
    resendSeconds: 0, phoneRequestsPerHour: 50, ipRequestsPerHour: 500, phoneFailedVerifiesPerHour: 30,
  });
});

test('OTP limits out of range are rejected at startup; no cap can be 0 (no "off" value)', () => {
  const cases = {
    OTP_RESEND_SECONDS: ['-1', '3601', 'abc', ''],
    OTP_PHONE_REQUESTS_PER_HOUR: ['0', '-1', '1001', 'abc', ''],
    OTP_IP_REQUESTS_PER_HOUR: ['0', '100001', 'abc', ''],
    OTP_PHONE_FAILED_VERIFIES_PER_HOUR: ['0', '1001', 'abc', ''],
  };
  for (const [name, values] of Object.entries(cases)) {
    for (const bad of values) {
      assert.throws(
        () => loadConfig({ ...base, NODE_ENV: 'development', [name]: bad }),
        new RegExp(`Invalid ${name}`),
        `${name}=${JSON.stringify(bad)}`,
      );
    }
  }
  // The upper bounds themselves are accepted.
  const max = loadConfig({
    ...base,
    NODE_ENV: 'development',
    OTP_RESEND_SECONDS: '3600',
    OTP_PHONE_REQUESTS_PER_HOUR: '1000',
    OTP_IP_REQUESTS_PER_HOUR: '100000',
    OTP_PHONE_FAILED_VERIFIES_PER_HOUR: '1000',
  });
  assert.equal(max.otp.limits.ipRequestsPerHour, 100_000);
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
    OTP_LENGTH: '8',
    OTP_MAX_ATTEMPTS: '3',
    OTP_DEV_MODE: 'false',
    SESSION_TTL_SECONDS: '86400',
  });
  assert.equal(cfg.otp.ttlSeconds, 120);
  assert.equal(cfg.otp.length, 8);
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

// BD-RIDE-AUTHORITY-01B-C: the receipt commission rate (docs/ride-state-receipt-authority-contract.md §3).
test('RECEIPT_COMMISSION_PERCENT defaults to 12 and accepts a decimal 0..100', () => {
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development' }).receipts.commissionPercent, 12);
  for (const [raw, want] of [['15', 15], ['12.5', 12.5], ['0', 0], ['100', 100], [' 8 ', 8]]) {
    assert.equal(loadConfig({ ...base, NODE_ENV: 'development', RECEIPT_COMMISSION_PERCENT: raw }).receipts.commissionPercent, want, raw);
  }
});

test('RECEIPT_COMMISSION_PERCENT outside 0..100 or not a plain decimal fails at startup', () => {
  for (const bad of ['-1', '101', '100.01', 'abc', '', '1e1', '12%', '0x10']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', RECEIPT_COMMISSION_PERCENT: bad }),
      /Invalid RECEIPT_COMMISSION_PERCENT: .* must be a number 0\.\.100/,
      `expected reject: ${JSON.stringify(bad)}`,
    );
  }
});

// BD-AUTH-POLICY-01B-A — the stand-only driver enrollment auto-approve switch.
test('DRIVER_ENROLLMENT_AUTO_APPROVE defaults to false and accepts only true / false', () => {
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development' }).drivers.enrollmentAutoApprove, false);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', DRIVER_ENROLLMENT_AUTO_APPROVE: 'true' }).drivers.enrollmentAutoApprove, true);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', DRIVER_ENROLLMENT_AUTO_APPROVE: 'false' }).drivers.enrollmentAutoApprove, false);
  assert.equal(loadConfig({ ...base, NODE_ENV: 'test', DRIVER_ENROLLMENT_AUTO_APPROVE: ' true ' }).drivers.enrollmentAutoApprove, true);
  for (const bad of ['', 'yes', '1', 'TRUE', 'on']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', DRIVER_ENROLLMENT_AUTO_APPROVE: bad }),
      /Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: .* must be true or false/,
      `expected reject: ${JSON.stringify(bad)}`,
    );
  }
});

test('production rejects DRIVER_ENROLLMENT_AUTO_APPROVE=true at startup, accepts false', () => {
  const prod = { ...base, NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://a.github.io', OTP_DEV_MODE: 'false' };
  assert.throws(
    () => loadConfig({ ...prod, DRIVER_ENROLLMENT_AUTO_APPROVE: 'true' }),
    /Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: true is forbidden when NODE_ENV=production/,
  );
  assert.equal(loadConfig({ ...prod, DRIVER_ENROLLMENT_AUTO_APPROVE: 'false' }).drivers.enrollmentAutoApprove, false);
  assert.equal(loadConfig(prod).drivers.enrollmentAutoApprove, false);
});

// BD-STAND-PUBLIC-01 (#1124) — the public profile for a stand reachable from the internet.
const pub = { ...base, NODE_ENV: 'development', PUBLIC_EXPOSURE: 'true', SESSION_TTL_SECONDS: '86400' };

test('PUBLIC_EXPOSURE is strict true / false; unset = false and development is unchanged', () => {
  const dev = loadConfig({ ...base, NODE_ENV: 'development' });
  assert.equal(dev.publicExposure, false);
  assert.equal(dev.host, '0.0.0.0', 'dev bind default unchanged');
  assert.equal(dev.otp.devMode, true, 'dev OTP echo default unchanged');
  assert.equal(dev.session.ttlSeconds, 0, 'dev may keep non-expiring sessions');
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', PUBLIC_EXPOSURE: 'false' }).publicExposure, false);
  for (const bad of ['', 'yes', '1', 'TRUE', 'on']) {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: 'development', PUBLIC_EXPOSURE: bad }),
      /Invalid PUBLIC_EXPOSURE: .* must be true or false/,
      `expected reject: ${JSON.stringify(bad)}`,
    );
  }
});

test('the public profile defaults to a loopback bind and OTP dev-mode off', () => {
  const c = loadConfig(pub);
  assert.equal(c.publicExposure, true);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.otp.devMode, false);
  assert.equal(c.drivers.enrollmentAutoApprove, false);
  assert.equal(c.session.ttlSeconds, 86400);
  for (const host of ['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', 'localhost']) {
    assert.equal(loadConfig({ ...pub, HOST: host }).host, host, `loopback ${host} accepted`);
  }
  assert.equal(loadConfig({ ...pub, OTP_DEV_MODE: 'false' }).otp.devMode, false);
  assert.equal(loadConfig({ ...pub, NODE_ENV: 'production', ALLOWED_ORIGIN: 'https://iprus2026-tech.github.io' }).publicExposure, true,
    'combines with production');
});

test('the public profile refuses startup on each explicitly dangerous value', () => {
  const refused = [
    [{ OTP_DEV_MODE: 'true' }, /Invalid OTP_DEV_MODE: true is forbidden when PUBLIC_EXPOSURE=true/],
    [{ DRIVER_ENROLLMENT_AUTO_APPROVE: 'true' }, /Invalid DRIVER_ENROLLMENT_AUTO_APPROVE: true is forbidden when PUBLIC_EXPOSURE=true/],
    [{ SESSION_TTL_SECONDS: '0' }, /Invalid SESSION_TTL_SECONDS: must be > 0 when PUBLIC_EXPOSURE=true/],
    [{ SESSION_TTL_SECONDS: undefined }, /Invalid SESSION_TTL_SECONDS: must be > 0 when PUBLIC_EXPOSURE=true/],
    [{ HOST: '0.0.0.0' }, /Invalid HOST: 0\.0\.0\.0 — must be a loopback address when PUBLIC_EXPOSURE=true/],
    [{ HOST: '::' }, /Invalid HOST: :: — must be a loopback address/],
    [{ HOST: '192.168.1.5' }, /Invalid HOST: 192\.168\.1\.5 — must be a loopback address/],
    [{ HOST: 'stand.example.com' }, /Invalid HOST: stand\.example\.com — must be a loopback address/],
    // #1134 review: out-of-range octets are not an address at all.
    [{ HOST: '127.999.1.1' }, /Invalid HOST: 127\.999\.1\.1 — must be a loopback address/],
    [{ HOST: '127.0.0.256' }, /Invalid HOST: 127\.0\.0\.256 — must be a loopback address/],
  ];
  for (const [patch, re] of refused) {
    const env = { ...pub, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete env[k];
    assert.throws(() => loadConfig(env), re, `expected refusal for ${JSON.stringify(patch)}`);
  }
});

test('outside the public profile the same values still start (no behaviour change)', () => {
  const dev = { ...base, NODE_ENV: 'development' };
  assert.doesNotThrow(() => loadConfig({ ...dev, OTP_DEV_MODE: 'true', DRIVER_ENROLLMENT_AUTO_APPROVE: 'true', SESSION_TTL_SECONDS: '0', HOST: '0.0.0.0' }));
  assert.doesNotThrow(() => loadConfig({ ...dev, PUBLIC_EXPOSURE: 'false', OTP_DEV_MODE: 'true', HOST: '0.0.0.0' }));
});

test('.env.example states the OTP length and limit defaults (#824)', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const keys = ['OTP_LENGTH', 'OTP_RESEND_SECONDS', 'OTP_PHONE_REQUESTS_PER_HOUR', 'OTP_IP_REQUESTS_PER_HOUR', 'OTP_PHONE_FAILED_VERIFIES_PER_HOUR'];
  const example = {};
  for (const key of keys) {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
    assert.ok(m, `${key} is in the example`);
    example[key] = m[1];
  }
  const fromExample = loadConfig({ ...base, NODE_ENV: 'development', ...example }).otp;
  const defaults = loadConfig({ ...base, NODE_ENV: 'development' }).otp;
  assert.equal(fromExample.length, defaults.length);
  assert.deepEqual(fromExample.limits, defaults.limits);
});

test('.env.example: only flipping PUBLIC_EXPOSURE is refused; the documented overrides start (#1134 review)', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  assert.equal(env.PUBLIC_EXPOSURE, 'false', 'the example ships the profile off');
  assert.throws(() => loadConfig({ ...env, PUBLIC_EXPOSURE: 'true' }), /Invalid (HOST|OTP_DEV_MODE|SESSION_TTL_SECONDS)/);
  // The overrides the example documents beside PUBLIC_EXPOSURE (the block right above it):
  const block = text.slice(text.indexOf('To enable the'), text.indexOf('\nPUBLIC_EXPOSURE=false'));
  const documented = [...block.matchAll(/^#\s{2,}([A-Z_]+)=(\S+)/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(documented.map(([k]) => k).sort(),
    ['DRIVER_ENROLLMENT_AUTO_APPROVE', 'HOST', 'OTP_DEV_MODE', 'PUBLIC_EXPOSURE', 'SESSION_TTL_SECONDS']);
  const c = loadConfig({ ...env, ...Object.fromEntries(documented) });
  assert.equal(c.publicExposure, true);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.otp.devMode, false);
  assert.ok(c.session.ttlSeconds > 0);
});

// BD-AUTH-TELEGRAM-01 (ADR BD-DOCS-052, R10/R11): the bot token is optional, checked by shape only,
// and an error never echoes it.
test('TELEGRAM_*: defaults, a well-formed token, and bounded knobs', () => {
  const off = loadConfig(base);
  assert.deepEqual(off.telegram, {
    botToken: '', initDataMaxAgeSeconds: 600, sessionTtlSeconds: 604800,
    webhookSecret: '', miniAppUrl: '', supportContact: '',
  });
  const token = '1234567890:TEST_fake_token_for_unit_tests_only_x';
  assert.equal(loadConfig({ ...base, TELEGRAM_BOT_TOKEN: token }).telegram.botToken, token);
  for (const [name, value] of [
    ['TELEGRAM_INITDATA_MAX_AGE_SECONDS', '59'], ['TELEGRAM_INITDATA_MAX_AGE_SECONDS', '86401'],
    ['TELEGRAM_INITDATA_MAX_AGE_SECONDS', 'abc'], ['TELEGRAM_SESSION_TTL_SECONDS', '299'],
    ['TELEGRAM_SESSION_TTL_SECONDS', '31536001'], ['TELEGRAM_SESSION_TTL_SECONDS', '0'],
  ]) {
    assert.throws(() => loadConfig({ ...base, [name]: value }), new RegExp(`Invalid ${name}`), `${name}=${value}`);
  }
});

test('TELEGRAM_BOT_TOKEN: a malformed token is refused without echoing it', () => {
  for (const bad of ['secret-without-colon-value-xxxxxxxxxxxxxxx', '123:short', 'abc:TEST_fake_token_for_unit_tests_only_x',
    '1234567890:has spaces in the secret part xxxxxxxx']) {
    let message = '';
    try { loadConfig({ ...base, TELEGRAM_BOT_TOKEN: bad }); } catch (err) { message = err.message; }
    assert.match(message, /^Invalid TELEGRAM_BOT_TOKEN: unexpected format/);
    assert.equal(message.includes(bad), false, 'the value is never in the message');
    assert.equal(message.includes(bad.split(':')[1] ?? bad), false);
  }
});

test('.env.example: TELEGRAM_BOT_TOKEN is present and EMPTY (the real one lives only in server/.env)', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(text, /^TELEGRAM_BOT_TOKEN=$/m);
  assert.match(text, /^TELEGRAM_INITDATA_MAX_AGE_SECONDS=600$/m);
  assert.match(text, /^TELEGRAM_SESSION_TTL_SECONDS=604800$/m);
  assert.match(text, /^TELEGRAM_WEBHOOK_SECRET=$/m);
  assert.match(text, /^TELEGRAM_MINIAPP_URL=$/m);
  assert.match(text, /^TELEGRAM_SUPPORT_CONTACT=$/m);
});

// BD-TG-BOT-01 (#1128): the bot webhook's secret, Mini App URL and support contact.
test('TELEGRAM_WEBHOOK_SECRET / TELEGRAM_MINIAPP_URL / TELEGRAM_SUPPORT_CONTACT: accepted shapes', () => {
  const secret = 'Abc_def-0123456789_abcdefghijklmnopq';
  const t = loadConfig({
    ...base, TELEGRAM_WEBHOOK_SECRET: secret,
    TELEGRAM_MINIAPP_URL: 'https://iprus2026-tech.github.io/BazarDriveCloud/', TELEGRAM_SUPPORT_CONTACT: '@bazar_help',
  }).telegram;
  assert.equal(t.webhookSecret, secret);
  assert.equal(t.miniAppUrl, 'https://iprus2026-tech.github.io/BazarDriveCloud/');
  assert.equal(t.supportContact, '@bazar_help');
  assert.equal(loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(256) }).telegram.webhookSecret.length, 256);
});

test('TELEGRAM_WEBHOOK_SECRET: a malformed secret is refused without echoing it', () => {
  for (const bad of ['short_secret', 'x'.repeat(31), 'x'.repeat(257), `${'a'.repeat(32)} space`, `${'a'.repeat(32)}!`]) {
    let message = '';
    try { loadConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: bad }); } catch (err) { message = err.message; }
    assert.match(message, /^Invalid TELEGRAM_WEBHOOK_SECRET:/, bad);
    assert.equal(message.includes(bad), false, 'the value is never in the message');
  }
});

test('TELEGRAM_MINIAPP_URL must be https without credentials; TELEGRAM_SUPPORT_CONTACT must be an @username', () => {
  for (const bad of ['http://example.test/', 'https://u:p@example.test/', 'example.test', 'javascript:alert(1)']) {
    assert.throws(() => loadConfig({ ...base, TELEGRAM_MINIAPP_URL: bad }), /Invalid TELEGRAM_MINIAPP_URL/, bad);
  }
  for (const bad of ['bazar_help', '@abc', '@1bazar', '@bazar-help', 'https://t.me/bazar_help', `@${'a'.repeat(33)}`]) {
    assert.throws(() => loadConfig({ ...base, TELEGRAM_SUPPORT_CONTACT: bad }), /Invalid TELEGRAM_SUPPORT_CONTACT/, bad);
  }
});
