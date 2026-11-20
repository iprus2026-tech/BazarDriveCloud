// BD-DRIVER-02 — static regression smoke for the DriverMap readiness gate.
//
// /driver-map must gate the working accept surface behind isDriverLineReady():
// a role=driver who is not line-ready sees a readiness banner + read-only
// checklist + LOCKED order cards and is routed to /profile — never an accept
// button. This script is intentionally STATIC: it reads the source and asserts
// the gate contract still holds, so a future refactor cannot silently drop the
// gate (or let isDriverLineReady drift back into a screen-local copy) without
// tripping `node scripts/check.mjs`. No browser, no DOM, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const driverMap   = read('../public/src/screens/driver_map.js');
const state       = read('../public/src/state.js');
const profile     = read('../public/src/screens/profile.js');
const rideActions = read('../public/src/ride_actions.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// 1) The readiness rule is the single source of truth in state.js …
expect('state.js exports isDriverLineReady',
  /export\s+function\s+isDriverLineReady\s*\(/.test(state));
expect('state.js exports canShowReadyStatus',
  /export\s+function\s+canShowReadyStatus\s*\(/.test(state));

// 2) … and profile.js no longer defines its own copy (no drift).
expect('profile.js does not redefine isDriverLineReady locally',
  !/function\s+isDriverLineReady\s*\(/.test(profile));
expect('profile.js imports isDriverLineReady from state.js',
  /import\s*\{[^}]*isDriverLineReady[^}]*\}\s*from\s*'\.\.\/state\.js'/s.test(profile));

// 2b) ride_actions.js shares the SAME rule — no third copy that could drift.
//     Its canAcceptOrder() accept gating must call the state.js helper.
expect('ride_actions.js imports isDriverLineReady from state.js',
  /import\s*\{[^}]*isDriverLineReady[^}]*\}\s*from\s*'\.\/state\.js'/s.test(rideActions));
expect('ride_actions.js does not define a local function isDriverLineReady',
  !/function\s+isDriverLineReady\s*\(/.test(rideActions));
expect('ride_actions.js does not define a local function canShowReadyStatus',
  !/function\s+canShowReadyStatus\s*\(/.test(rideActions));

// 3) driver_map.js imports and enforces the gate.
expect('driver_map.js imports isDriverLineReady from state.js',
  /import\s*\{[^}]*isDriverLineReady[^}]*\}\s*from\s*'\.\.\/state\.js'/s.test(driverMap));
expect('driver_map.js branches on !isDriverLineReady(...)',
  /if\s*\(\s*!\s*isDriverLineReady\s*\(/.test(driverMap));
// Accept-time re-check: readiness is re-validated BEFORE acceptCanonicalRideOrder,
// so readiness revoked between render and tap cannot mutate the order.
expect('accept branch re-checks readiness before acceptCanonicalRideOrder',
  /action === 'accept'[\s\S]*?!\s*isDriverLineReady\(\s*user\.get\(\)\s*\)[\s\S]*?acceptCanonicalRideOrder\(/.test(driverMap));

// 4) Gate copy is present.
expect('gate banner copy "профиль не готов" present',
  driverMap.includes('профиль не готов'));
expect('gate CTA copy "Завершить готовность" present',
  driverMap.includes('Завершить готовность'));
expect('locked order copy "Доступно после готовности" present',
  driverMap.includes('Доступно после готовности'));

// 5) The "Завершить готовность" CTA routes to /profile.
expect('complete-readiness action present',
  /data-action="complete-readiness"/.test(driverMap));
expect("complete-readiness routes to '/profile'",
  /complete-readiness'\s*\)\s*\{\s*\n?\s*go\('\/profile'\)/.test(driverMap)
    || /action === 'complete-readiness'[\s\S]{0,80}go\('\/profile'\)/.test(driverMap));

// 6) Locked rows expose NO accept action and instead route to /profile, so a
//    not-ready driver can tap "Доступно после готовности" to finish readiness
//    but can never accept an order from the gate.
expect('buildOrderRow supports a locked variant',
  /buildOrderRow\s*\(\s*order\s*,\s*index\s*,\s*\{\s*locked/.test(driverMap));

const lockedFootMatch = driverMap.match(/locked\s*\n?\s*\?\s*`([\s\S]*?)`\s*\n?\s*:/);
const lockedFoot = lockedFootMatch ? lockedFootMatch[1] : '';
expect('locked branch resolved from buildOrderRow', !!lockedFootMatch);
expect('locked branch renders the locked zone element',
  /class="driver-map__order-locked"/.test(lockedFoot));
expect('locked branch routes to complete-readiness (→ /profile)',
  /data-action="complete-readiness"/.test(lockedFoot));
expect('locked branch contains NO data-action="accept"',
  !/data-action="accept"/.test(lockedFoot));

// ── #1185 — the «На линии» toggle gates the working surface and direct accept ──
expect('driver map: a line-ready driver whose toggle is off gets the offline card, not the list',
  /const isOffline = \(\) => !fixture && \(refreshDriverLineOff\(\) \|\| user\.get\(\)\.driverOnline !== true\);/.test(driverMap)
    && /async function renderList\(isRetry\) \{\s*if \(isOffline\(\)\) \{ renderOffline\(\); return; \}/.test(driverMap)
    && /card\.dataset\.state = STATE\.OFFLINE;/.test(driverMap));
const offlineCard = (driverMap.match(/function buildOfflineCard\(\)[\s\S]*?\n\}/) || [''])[0];
expect('driver map: the offline card offers «Выйти на линию» and carries no accept control',
  /data-action="go-online"/.test(offlineCard) && !/data-action="accept"/.test(offlineCard));
expect('driver map: accept re-checks the toggle at tap time, after the readiness re-check',
  /if \(!isDriverLineReady\(user\.get\(\)\)\) \{\s*await renderReadinessGate\(false\);\s*return;\s*\}[\s\S]{0,160}if \(isOffline\(\)\) \{\s*renderOffline\(\);\s*return;\s*\}/.test(driverMap));
expect('driver map: «Выйти на линию» re-checks readiness before writing driverOnline',
  /action === 'go-online'\) \{[\s\S]{0,220}isDriverLineReady\(user\.get\(\)\)[\s\S]{0,120}user\.set\(\{ driverOnline: true \}\);/.test(driverMap));
// Review follow-up — user.get() is a per-tab cache: the gates read the PERSISTED flag first, and
// only ever lower this tab's flag (an «on» written elsewhere is never adopted).
expect('state: refreshDriverLineOff reads the persisted record and only downgrades the cached flag',
  /export function refreshDriverLineOff\(\) \{[\s\S]{0,420}localStorage\.getItem\(KEY\)[\s\S]{0,260}parsed\.driverOnline === false[\s\S]{0,200}if \(persistedOff && cache && cache\.driverOnline === true\) cache = \{ \.\.\.cache, driverOnline: false \};/.test(state)
    && !/driverOnline: true \}/.test((state.match(/export function refreshDriverLineOff\(\)[\s\S]*?\n\}/) || [''])[0]));
const feedSrc = read('../public/src/screens/feed.js');
const postDetailSrc = read('../public/src/screens/post_detail.js');
expect('feed + post detail: direct accept checks the persisted flag at tap time',
  /if \(refreshDriverLineOff\(\)\) \{\s*toast\(/.test(feedSrc)
    && /if \(spec\.kind === 'accept'\) \{[\s\S]{0,260}if \(refreshDriverLineOff\(\)\) \{/.test(postDetailSrc));
expect('ride_actions: canAcceptOrder refuses a driver who is not «На линии»',
  /if \(!isDriverLineReady\(u\)\) return false;[\s\S]{0,260}if \(u\.driverOnline !== true\) return false;/.test(rideActions));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
