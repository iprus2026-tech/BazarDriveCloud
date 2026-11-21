// /responses — background offers refresh (backend ON). The board used to read the offers once on
// entry and again only on «Проверить отклики», so a passenger waiting on it never saw a driver's
// offer arrive. Pins the refresh and its guards in the shipped source. The behaviour was checked
// end to end on the local dev stand (scripts/dev-stand.mjs): offers appear without a tap, the
// passenger's sort survives a refresh, reads run about every 6 s and stop after the selection.

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/src/screens/responses.js', import.meta.url), 'utf8');
const failures = [];
let passed = 0;

function check(label, run) {
  try {
    run();
    passed += 1;
    console.log(`PASS — ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL — ${label}: ${error?.message || error}`);
  }
}

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `end marker not found: ${endMarker}`);
  return source.slice(start, end);
}

check('the refresh period is a named constant of a few seconds', () => {
  const m = /^const OFFERS_POLL_MS = (\d+);$/m.exec(source);
  assert.ok(m, 'OFFERS_POLL_MS must be a one-line constant');
  const ms = Number(m[1]);
  assert.ok(ms >= 3000 && ms <= 15000, `OFFERS_POLL_MS=${ms} is outside 3–15 s`);
});

check('the refresh runs only for a server order, after the entry read', () => {
  const entry = block('if (backendAuthoritative) {\n    // The router awaits the loader', 'queueMicrotask(markFeedTabActive);');
  assert.ok(entry.indexOf('void loadServerOffers();') < entry.indexOf('setInterval('), 'entry read first, then the interval');
  assert.match(entry, /const offersPollId = setInterval\(\(\) => \{/);
  assert.match(entry, /\}, OFFERS_POLL_MS\);/);
});

check('each tick stops with the screen and skips a hidden tab, a pending choice, a withdrawal or a handoff', () => {
  const tick = block('const offersPollId = setInterval(() => {', '}, OFFERS_POLL_MS);');
  assert.match(tick, /if \(!document\.body\.contains\(root\)\) \{ clearInterval\(offersPollId\); return; \}/);
  assert.match(tick, /document\.hidden\) return;/);
  assert.match(tick, /if \(selecting \|\| orderCancelPending \|\| isAccepted \|\| offersReadsInFlight > 0\) return;/);
  assert.match(tick, /if \(readState !== 'empty' && readState !== 'loaded'\) return;/);
  assert.match(tick, /void loadServerOffers\(\{ silent: true \}\);/);
});

check('a background read with the same offers changes nothing on screen', () => {
  const loader = block('async function loadServerOffers(', 'function refreshBoard()');
  assert.match(loader, /\{ isRetry = false, silent = false \} = \{\}/);
  const same = loader.indexOf('if (silent && nextSignature === offersSignature) return;');
  assert.ok(same > 0, 'an unchanged silent read returns early');
  assert.ok(same < loader.indexOf('drivers = nextDrivers;'), '…before the board state is replaced');
  assert.ok(same < loader.indexOf('renderReadRegion();'), '…and before any render');
  assert.match(loader, /offersSignature = nextSignature;/);
});

check('the identity covers every field a card shows (Codex P2: a re-sent offer with a new car or name)', () => {
  const sig = block('function signatureOf(list) {', '\n  }');
  assert.match(sig, /return JSON\.stringify\(list\);/, 'the whole card list, not a hand-picked subset');
});

check('a background tick never overlaps a pending read (Codex P2: a superseded manual check stayed busy)', () => {
  const loader = block('async function loadServerOffers(', 'function refreshBoard()');
  const inc = loader.indexOf('offersReadsInFlight += 1;');
  assert.ok(inc > 0 && inc < loader.indexOf('await listOrderOffers('), 'counted before the request');
  const fin = loader.indexOf('} finally {');
  assert.ok(fin > 0 && loader.indexOf('offersReadsInFlight -= 1;', fin) > fin, 'released in finally, on every exit');
});

check('a failed background read keeps the board (no error state from a tick)', () => {
  const loader = block('async function loadServerOffers(', 'function refreshBoard()');
  const catchAt = loader.indexOf('} catch (err) {');
  const silentReturn = loader.indexOf('if (silent) return;', catchAt);
  assert.ok(catchAt > 0 && silentReturn > catchAt, 'the catch returns early for a silent read');
  assert.ok(silentReturn < loader.indexOf("readState = 'error';", catchAt), '…before the error state is set');
});

if (failures.length) {
  console.error(`FAIL ${failures.length} expectation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${passed} passed; 0 failed`);
