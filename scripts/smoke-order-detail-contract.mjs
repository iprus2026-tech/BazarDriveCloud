// BD-ORDER-DETAIL-01A — Order Detail contract gate smoke.
//
// The Cloud Design audit (#454) and the Codex screen audit (#455) both
// flagged a P0 gap: there is no runtime route /order/<id> for an Order
// Detail screen. Implementation is intentionally deferred — this smoke
// only guards the *contract* so a future implementation cannot drift
// from the audit decisions (role split, required states, out-of-scope
// list, unresolved driver "Принять" semantics).
//
// The contract lives in docs/screen-contracts.md under
// BD-ORDER-DETAIL-01 and is mirrored as a missing-screen row in
// docs/screen-map.md. This smoke fails if either of those documents
// drops the contract's load-bearing pieces, or if a runtime route /
// screen file appears before the screen is actually implemented and
// re-graded.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const exists = (rel) => {
  try { fs.accessSync(new URL(rel, import.meta.url)); return true; }
  catch { return false; }
};

const contracts = read('../docs/screen-contracts.md');
const appJs     = read('../public/src/app.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract the BD-ORDER-DETAIL-01 section so every per-field assertion
// stays scoped to its contract and can't pick up a stray match from a
// neighbouring screen entry.
function sectionBody(source, heading) {
  const start = source.indexOf(heading);
  if (start === -1) return null;
  // The next h3 (### …) terminates the section; if there is no next
  // section, take everything until EOF.
  const after = source.indexOf('\n### ', start + heading.length);
  return after === -1 ? source.slice(start) : source.slice(start, after);
}

// ── A. screen-contracts.md carries the BD-ORDER-DETAIL-01 entry ─────
expect('docs/screen-contracts.md references BD-ORDER-DETAIL-01',
  /BD-ORDER-DETAIL-01/.test(contracts));

const section = sectionBody(contracts, '### BD-ORDER-DETAIL-01');
expect('BD-ORDER-DETAIL-01 contract section resolved', !!section);

// ── B. Route shape /order/<id> or an explicit synonym ───────────────
// The audit fixed the canonical shape as /order/<id>; allow a placeholder
// like /order/:id so the contract reads naturally without forcing a
// concrete sample id into the doc.
expect('contract names the /order/<id> deep-link route',
  !!section && /\/order\/(?:<id>|:id|\{id\})/.test(section));
expect('contract notes the route is NOT yet registered',
  !!section && /not\**\s*\**\s+registered/i.test(section));

// ── C. Role variants ───────────────────────────────────────────────
expect('contract declares the passenger role variant',
  !!section && /\bpassenger\b/i.test(section));
expect('contract declares the driver role variant',
  !!section && /\bdriver\b/i.test(section));
expect('contract pins both variants live on the SAME route (role-split)',
  !!section && /role-split|role-dispatched|\?role=/.test(section));

// ── D. Required states ─────────────────────────────────────────────
// Each item below maps to one of the ten states the audit named. The
// regex deliberately matches a phrase the contract uses, not just a
// keyword, so a half-finished refactor that drops e.g. the "responses
// available" passenger state can't pass.
const requiredStates = [
  ['passenger: open order',
    /Open\s+order[\s\S]{0,200}CREATED|passenger[\s\S]{0,40}open\s+order/i],
  ['passenger: responses available',
    /Responses\s+available[\s\S]{0,200}passenger_response/i],
  ['passenger: driver selected / confirmation ready',
    /Driver\s+selected[\s\S]{0,80}confirmation\s+ready/i],
  ['passenger: active ride handoff ready',
    /Active\s+ride\s+handoff\s+ready/i],
  ['driver: open order / can respond',
    /Open\s+order\s*\/\s*can\s+respond/i],
  ['driver: response sent',
    /Response\s+sent/i],
  ['driver: accepted / continue',
    /Accepted\s*\/\s*continue/i],
  ['shared: canceled / expired',
    /Canceled\s*\/\s*expired/i],
  ['shared: loading',
    /Loading\b/i],
  ['shared: error / not found',
    /Error\s*\/\s*not\s+found/i],
];
for (const [name, re] of requiredStates) {
  expect(`contract enumerates required state — ${name}`,
    !!section && re.test(section));
}

// ── E. Explicit out-of-scope list ─────────────────────────────────
expect('contract explicitly rules out backend',
  !!section && /No\s+backend\b/i.test(section));
expect('contract explicitly rules out Mapbox',
  !!section && /No\s+Mapbox\b/i.test(section));
expect('contract explicitly rules out payment',
  !!section && /No\s+payment\b/i.test(section));

// ── F. Unresolved product decision: driver "Принять" semantics ────
expect('contract flags the driver "Принять" semantics as unresolved',
  !!section && /Unresolved\s+product\s+decision[\s\S]{0,400}Принять/i.test(section));

// ── G. Gate invariants — no runtime route / screen file shipped ───
// If either lands before the screen is actually implemented and the
// contract is re-graded, the smoke must fail so the audit can't be
// silently bypassed.
expect('public/src/app.js does NOT register a runtime /order route',
  !/register\(\s*'\/order(?:\/|'|"|\?)/.test(appJs));
expect('public/src/screens/order_detail.js is NOT yet shipped',
  !exists('../public/src/screens/order_detail.js'));

// ── H. screen-map.md mirrors the missing-screen entry ─────────────
// screen-map.md tracks missing screens with priority/status; pin that
// the Order Detail row exists there too. The file is optional in the
// repo contract — skip the check (PASS) if it isn't present, so this
// smoke doesn't tie the audit to a doc that lives elsewhere.
const mapPath = new URL('../docs/screen-map.md', import.meta.url);
let mapPresent = false;
try { fs.accessSync(mapPath); mapPresent = true; } catch {}
if (mapPresent) {
  const screenMap = fs.readFileSync(mapPath, 'utf8');
  expect('docs/screen-map.md lists BD-ORDER-DETAIL-01 as a missing screen',
    /BD-ORDER-DETAIL-01/.test(screenMap));
  expect('screen-map.md flags BD-ORDER-DETAIL-01 with P0 priority',
    /BD-ORDER-DETAIL-01[\s\S]{0,1200}P0/.test(screenMap));
  expect('screen-map.md marks BD-ORDER-DETAIL-01 as missing / contract-gated',
    /BD-ORDER-DETAIL-01[\s\S]{0,1200}missing[\s\S]{0,200}contract-gated/i.test(screenMap));
} else {
  expect('docs/screen-map.md not present — skipping mirrored entry check', true);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
