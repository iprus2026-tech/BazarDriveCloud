// BD-TG-MINIAPP-01 M1 (#1126) — Telegram Mini App launch capture (public/src/telegram_launch.js).
// Contract: docs/telegram-mini-app-contract.md, section "M1 — launch capture".
//
// Runs the shipped module in Node with fake location / history / Web Storage. It pins:
// - a Telegram hash is captured before the router (first import of app.js);
// - the launch is kept per tab, with the raw initData only in sessionStorage;
// - the hash is rewritten once to an allowlisted startapp route, else /feed;
// - a reload keeps the launch;
// - a malformed launch is ignored;
// - an ordinary launch (no tgWebAppData) behaves exactly as before: nothing written,
//   nothing rewritten.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const launchSource = read('../public/src/telegram_launch.js');
const appSource = read('../public/src/app.js');
const mockAuthSource = read('../public/src/mock_auth.js');
const swSource = read('../public/sw.js');
const failures = [];
let passed = 0;

async function check(label, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS — ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL — ${label}: ${error?.stack || error}`);
  }
}

const LAUNCH_KEY = 'bazardrive.tg_launch.v1';
const INIT_DATA_KEY = 'bazardrive.tg_init_data.v1';
const PATHNAME = '/BazarDriveCloud/';
// A realistic raw initData (already URL-encoded inside, as Telegram sends it).
const INIT_DATA = 'query_id=AAHdF6IQAAAAAN0XohDhrOrc'
  + '&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vlad%22%2C%22language_code%22%3A%22ru%22%7D'
  + '&auth_date=1729800000'
  + '&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';

// throws: every call fails · failSetKey: only setItem(failSetKey) fails (e.g. a quota error on the
// second write) · readOnly: setItem and removeItem fail, getItem works.
function storageShim(map, { throws = false, failSetKey = null, readOnly = false } = {}) {
  const guard = () => { if (throws) throw new Error('SecurityError: storage is disabled'); };
  const deny = (what) => { throw new Error(`QuotaExceededError: ${what}`); };
  return {
    getItem: (k) => { guard(); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { guard(); if (readOnly || k === failSetKey) deny(`setItem ${k}`); map.set(k, String(v)); },
    removeItem: (k) => { guard(); if (readOnly) deny(`removeItem ${k}`); map.delete(k); },
    clear: () => { guard(); map.clear(); },
    get length() { return map.size; },
  };
}

// Installs fake globals for one page load and returns handles to inspect them.
function installEnv({ hash = '', search = '', session = new Map(), sessionThrows = false, sessionOpts = {},
  replaceStateThrows = false } = {}) {
  const local = new Map();
  const replaced = [];
  const location = { hash, search, pathname: PATHNAME };
  globalThis.location = location;
  globalThis.history = {
    replaceState(_state, _title, url) {
      if (replaceStateThrows) throw new Error('SecurityError: replaceState is not allowed');
      replaced.push(String(url));
      const i = String(url).indexOf('#');
      location.hash = i >= 0 ? String(url).slice(i) : '';
    },
  };
  globalThis.sessionStorage = storageShim(session, { throws: sessionThrows, ...sessionOpts });
  globalThis.localStorage = storageShim(local);
  return { location, replaced, session, local };
}
// An older launch already stored in this tab (a previous capture).
function olderLaunch() {
  return new Map([
    [LAUNCH_KEY, JSON.stringify({ v: 1, version: '7.10', platform: 'ios', startParam: 'rules', capturedAt: 1 })],
    [INIT_DATA_KEY, 'query_id=OLD&auth_date=1&hash=old'],
  ]);
}

// The hash Telegram builds: each value URL-encoded once (encodeURIComponent).
function tgHash({ initData = INIT_DATA, version = '8.0', platform = 'android', prefix = '' } = {}) {
  const parts = [];
  if (initData != null) parts.push(`tgWebAppData=${encodeURIComponent(initData)}`);
  if (version != null) parts.push(`tgWebAppVersion=${encodeURIComponent(version)}`);
  if (platform != null) parts.push(`tgWebAppPlatform=${encodeURIComponent(platform)}`);
  parts.push(`tgWebAppThemeParams=${encodeURIComponent('{"bg_color":"#ffffff","text_color":"#000000"}')}`);
  return `#${prefix}${parts.join('&')}`;
}
const startSearch = (param) => `?tgWebAppStartParam=${encodeURIComponent(param)}`;

// ── Import-time capture: the module runs once, at import, before anything else ──
const first = installEnv({ hash: tgHash(), search: startSearch('map') });
const mod = await import(new URL('../public/src/telegram_launch.js', import.meta.url).href);

await check('import-time capture: a Telegram hash with startapp=map is rewritten once to #/map', () => {
  assert.deepEqual(first.replaced, [`${PATHNAME}?tgWebAppStartParam=map#/map`]);
  assert.equal(first.location.hash, '#/map');
});

await check('the launch environment is kept per tab (sessionStorage) and exposed frozen', () => {
  const stored = JSON.parse(first.session.get(LAUNCH_KEY));
  assert.equal(stored.v, 1);
  assert.equal(stored.version, '8.0');
  assert.equal(stored.platform, 'android');
  assert.equal(stored.startParam, 'map');
  assert.equal(typeof stored.capturedAt, 'number');
  assert.ok(!JSON.stringify(stored).includes('query_id'), 'the environment record carries no initData');
  const env = mod.getTelegramLaunch();
  assert.deepEqual({ ...env }, { version: '8.0', platform: 'android', startParam: 'map' });
  assert.ok(Object.isFrozen(env));
});

await check('the raw initData is kept exactly once, only in sessionStorage — never in localStorage or the URL', () => {
  assert.equal(first.session.get(INIT_DATA_KEY), INIT_DATA, 'stored raw, decoded exactly once');
  assert.equal(mod.getTelegramInitData(), INIT_DATA);
  assert.equal(first.local.size, 0, 'localStorage untouched');
  for (const url of first.replaced) {
    assert.ok(!url.includes('tgWebAppData'), 'no tgWebAppData in the rewritten URL');
    assert.ok(!url.includes('query_id') && !url.includes('auth_date'), 'no initData in the rewritten URL');
  }
});

// ── startapp allowlist ──────────────────────────────────────────────────────────
await check('startapp allowlist: feed/map/rules/profile/post_<id> map to their routes', () => {
  const rows = [
    ['feed', '/feed'], ['map', '/map'], ['rules', '/rules'], ['profile', '/profile'],
    ['post_abc-1_2', '/post?id=abc-1_2'], [`post_${'a'.repeat(64)}`, `/post?id=${'a'.repeat(64)}`],
  ];
  for (const [param, route] of rows) {
    const e = installEnv({ hash: tgHash(), search: startSearch(param) });
    mod.captureTelegramLaunch();
    assert.deepEqual(e.replaced, [`${PATHNAME}${startSearch(param)}#${route}`], `startapp=${param}`);
    assert.equal(mod.getTelegramLaunch().startParam, param);
  }
});

await check('no startapp → /feed', () => {
  const e = installEnv({ hash: tgHash() });
  mod.captureTelegramLaunch();
  assert.deepEqual(e.replaced, [`${PATHNAME}#/feed`]);
  assert.equal(mod.getTelegramLaunch().startParam, null);
});

await check('a startapp outside the allowlist → /feed (the hash never takes it as a route)', () => {
  const bogus = ['bogus', 'MAP', 'post_', `post_${'a'.repeat(65)}`, 'order_42', 'active-ride', 'ops_screens'];
  for (const param of bogus) {
    const e = installEnv({ hash: tgHash(), search: startSearch(param) });
    mod.captureTelegramLaunch();
    assert.equal(e.location.hash, '#/feed', `startapp=${param}`);
  }
  // A value with characters Telegram does not allow is dropped entirely.
  for (const param of ['post_a/b', '../feed', 'map?x=1', '/active-ride']) {
    const e = installEnv({ hash: tgHash(), search: startSearch(param) });
    mod.captureTelegramLaunch();
    assert.equal(e.location.hash, '#/feed', `startapp=${param}`);
    assert.equal(mod.getTelegramLaunch().startParam, null, `startapp=${param} is not kept`);
  }
});

await check('start_param inside initData is used when the GET param is absent', () => {
  const e = installEnv({ hash: tgHash({ initData: `${INIT_DATA}&start_param=rules` }) });
  mod.captureTelegramLaunch();
  assert.equal(e.location.hash, '#/rules');
});

await check("the '#<path>?params' form is accepted as well (the SDK's own parser accepts it)", () => {
  const e = installEnv({ hash: tgHash({ prefix: '/welcome?' }), search: startSearch('profile') });
  mod.captureTelegramLaunch();
  assert.equal(e.location.hash, '#/profile');
  assert.equal(e.session.get(INIT_DATA_KEY), INIT_DATA);
});

// ── Malformed launches are ignored: the router sees the hash as today ───────────
await check('a malformed launch writes nothing and rewrites nothing', () => {
  const malformed = [
    tgHash({ version: null }), tgHash({ platform: null }), tgHash({ version: 'abc' }),
    tgHash({ platform: 'and roid' }), tgHash({ initData: '' }), tgHash({ initData: 'x'.repeat(16385) }),
  ];
  for (const hash of malformed) {
    const e = installEnv({ hash });
    mod.captureTelegramLaunch();
    assert.equal(e.replaced.length, 0);
    assert.equal(e.location.hash, hash);
    assert.equal(e.session.size, 0);
    assert.equal(mod.getTelegramLaunch(), null);
    assert.equal(mod.getTelegramInitData(), null);
  }
});

// ── Reload ───────────────────────────────────────────────────────────────────────
await check('reload: the stored launch is read back; nothing is captured or rewritten again', () => {
  const session = new Map();
  installEnv({ hash: tgHash(), search: startSearch('map'), session });
  mod.captureTelegramLaunch();
  const before = JSON.stringify([...session]);
  const e = installEnv({ hash: '#/map', search: startSearch('map'), session });
  mod.captureTelegramLaunch();
  assert.equal(e.replaced.length, 0, 'no second rewrite');
  assert.equal(e.location.hash, '#/map');
  assert.equal(JSON.stringify([...session]), before, 'storage unchanged (incl. capturedAt)');
  assert.deepEqual({ ...mod.getTelegramLaunch() }, { version: '8.0', platform: 'android', startParam: 'map' });
  assert.equal(mod.getTelegramInitData(), INIT_DATA);
  // A reload after the user navigated on keeps that route.
  const later = installEnv({ hash: '#/post?id=7', session });
  mod.captureTelegramLaunch();
  assert.equal(later.replaced.length, 0);
  assert.equal(later.location.hash, '#/post?id=7');
});

// ── Ordinary launch outside Telegram: exactly as before ─────────────────────────
await check('ordinary launch (no tgWebAppData): nothing written, nothing rewritten, no launch', () => {
  const hashes = ['', '#/feed', '#/welcome', '#/post?id=7', '#/active-ride?role=passenger&tripId=t1',
    '#/order/ord_1', '#/ops/screens', '#/profile?role=driver&pane=payouts', '#data=1&x=2'];
  for (const hash of hashes) {
    const e = installEnv({ hash, search: '' });
    mod.captureTelegramLaunch();
    assert.equal(e.replaced.length, 0, `${hash}: no replaceState`);
    assert.equal(e.location.hash, hash, `${hash}: hash untouched`);
    assert.equal(e.session.size, 0, `${hash}: no sessionStorage write`);
    assert.equal(e.local.size, 0, `${hash}: no localStorage write`);
    assert.equal(mod.getTelegramLaunch(), null);
    assert.equal(mod.getTelegramInitData(), null);
  }
});

await check('ordinary launch: a tgWebAppStartParam without a Telegram hash is ignored', () => {
  const e = installEnv({ hash: '#/rules', search: startSearch('map') });
  mod.captureTelegramLaunch();
  assert.equal(e.location.hash, '#/rules');
  assert.equal(e.replaced.length, 0);
  assert.equal(mod.getTelegramLaunch(), null);
});

// ── Storage failure, logout ───────────────────────────────────────────────────────
await check('sessionStorage unavailable: the hash is still restored and the launch holds in memory', () => {
  const e = installEnv({ hash: tgHash(), search: startSearch('map'), sessionThrows: true });
  mod.captureTelegramLaunch();
  assert.equal(e.location.hash, '#/map');
  assert.equal(mod.getTelegramLaunch().platform, 'android');
  assert.equal(mod.getTelegramInitData(), INIT_DATA, 'this page load keeps its copy');
  assert.equal(e.local.size, 0, 'never falls back to localStorage');
});

await check('a failed second write drops BOTH records: no reload can pair this launch with older initData', () => {
  const session = olderLaunch();
  installEnv({ hash: tgHash(), search: startSearch('map'), session, sessionOpts: { failSetKey: INIT_DATA_KEY } });
  mod.captureTelegramLaunch();
  assert.equal(session.has(LAUNCH_KEY), false, 'the new launch record is rolled back');
  assert.equal(session.has(INIT_DATA_KEY), false, 'the older initData is invalidated');
  assert.equal(mod.getTelegramInitData(), INIT_DATA, 'this page load keeps its own capture');
  const reload = installEnv({ hash: '#/map', session });
  mod.captureTelegramLaunch();
  assert.equal(reload.replaced.length, 0);
  assert.equal(mod.getTelegramLaunch(), null, 'nothing half-written to recover');
  assert.equal(mod.getTelegramInitData(), null, 'never the older tab value');
});

await check("read-only storage: getTelegramInitData() returns this page's capture, never the stale stored copy", () => {
  const session = olderLaunch();
  installEnv({ hash: tgHash(), search: startSearch('map'), session, sessionOpts: { readOnly: true } });
  mod.captureTelegramLaunch();
  assert.equal(session.get(INIT_DATA_KEY), 'query_id=OLD&auth_date=1&hash=old', 'the stale copy could not be removed');
  assert.equal(mod.getTelegramInitData(), INIT_DATA);
  assert.equal(mod.getTelegramLaunch().startParam, 'map');
});

await check('a throwing replaceState never aborts the import: the hash falls back to the target', () => {
  const e = installEnv({ hash: tgHash(), search: startSearch('map'), replaceStateThrows: true });
  assert.doesNotThrow(() => mod.captureTelegramLaunch());
  assert.equal(e.location.hash.replace(/^#?/, '#'), '#/map');
  assert.equal(mod.getTelegramLaunch().startParam, 'map');
});

await check('a throwing location never aborts the import: captureTelegramLaunch() returns null', () => {
  globalThis.location = { get hash() { throw new Error('SecurityError: location is not readable'); }, search: '', pathname: PATHNAME };
  assert.equal(mod.captureTelegramLaunch(), null);
  assert.equal(mod.getTelegramLaunch(), null);
  assert.equal(mod.getTelegramInitData(), null);
});

await check('check.mjs reports this smoke from stderr first (FAIL lines are console.error)', () => {
  const block = read('../scripts/check.mjs').split("const telegramLaunchSmoke")[1] || '';
  assert.match(block.slice(0, 800), /\(e\.stderr && e\.stderr\.toString\(\)\) \|\| \(e\.stdout && e\.stdout\.toString\(\)\) \|\| e\.message/);
});

await check('clearTelegramInitData(): the initData goes, the launch environment stays', () => {
  const e = installEnv({ hash: tgHash() });
  mod.captureTelegramLaunch();
  mod.clearTelegramInitData();
  assert.equal(e.session.has(INIT_DATA_KEY), false);
  assert.equal(e.session.has(LAUNCH_KEY), true);
  assert.equal(mod.getTelegramInitData(), null);
  assert.notEqual(mod.getTelegramLaunch(), null);
});

await check('resetLocalSession() clears the initData on every logout / local reset (source pin)', () => {
  assert.match(mockAuthSource, /import \{ clearTelegramInitData \} from '\.\/telegram_launch\.js';/);
  const body = mockAuthSource.slice(mockAuthSource.indexOf('export function resetLocalSession('));
  assert.match(body.slice(0, body.indexOf('\n}\n')), /clearSmokeRole\(\);\s*\n\s*clearTelegramInitData\(\);/);
});

// ── Static pins: order, no leaks, precache ──────────────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

await check('app.js imports telegram_launch.js FIRST (before router.js is evaluated)', () => {
  const firstImport = stripComments(appSource).match(/^\s*import\b[^;]*;/m);
  assert.ok(firstImport, 'app.js has imports');
  assert.equal(firstImport[0].trim(), "import './telegram_launch.js';");
  assert.equal(stripComments(appSource).trimStart().indexOf("import './telegram_launch.js';"), 0,
    'nothing but comments precedes it');
});

await check('telegram_launch.js imports nothing, logs nothing, sends nothing, never touches localStorage', () => {
  const code = stripComments(launchSource);
  assert.doesNotMatch(code, /^\s*import\b/m, 'no imports');
  assert.doesNotMatch(code, /\bconsole\./, 'no console');
  assert.doesNotMatch(code, /\blocalStorage\b/, 'no localStorage');
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|sendBeacon|postMessage|WebSocket|EventSource)\b/, 'no network');
  assert.doesNotMatch(code, /JSON\.parse\(\s*[^)]*initData/i, 'initData fields are never parsed');
});

await check('sw.js precaches telegram_launch.js', () => {
  assert.match(swSource, /'\.\/src\/telegram_launch\.js',/);
});

delete globalThis.location;
delete globalThis.history;
console.log(`\n${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
