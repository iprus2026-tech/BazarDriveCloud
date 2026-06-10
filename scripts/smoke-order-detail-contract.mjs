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

// ── C. Role variants + role chips ──────────────────────────────────
// Both variants live on the same route, role-dispatched via ?role=. The
// passenger chip text contains «Ваш заказ» and the driver chip text
// contains «Просмотр водителя» so a future implementation can't ship
// mirror-image copy and silently look passenger-only or driver-only.
expect('contract declares the passenger role variant',
  !!section && /\bpassenger\b/i.test(section));
expect('contract declares the driver role variant',
  !!section && /\bdriver\b/i.test(section));
expect('contract pins both variants live on the SAME route (role-split)',
  !!section && /role-split|role-dispatched|\?role=/.test(section));
expect('contract names roleView ∈ {passenger, driver}',
  !!section && /roleView[\s\S]{0,80}passenger[\s\S]{0,40}driver/.test(section));
expect('contract pins the passenger role chip text «Ваш заказ»',
  !!section && /Ваш\s+заказ/.test(section));
expect('contract pins the driver role chip text «Просмотр водителя»',
  !!section && /Просмотр\s+водителя/.test(section));

// ── D. Model B chosen semantics + Models A/C forbidden ─────────────
// The single most load-bearing audit decision: driver offers ≠ order
// acceptance. The contract MUST name Model B as chosen and explicitly
// forbid Models A (one-tap accept) and C (passenger-invitation-only).
expect('contract names Model B as the chosen semantics (offer + passenger confirm)',
  !!section && /Model\s+B[\s\S]{0,120}(offer|оффер)[\s\S]{0,120}(confirm|подтверж)/i.test(section));
expect('contract forbids Model A (driver instant accept)',
  !!section && /Model\s+A[\s\S]{0,200}(instant|instantly|one-tap|single-tap)/i.test(section));
expect('contract forbids Model C (passenger-invitation-only)',
  !!section && /Model\s+C[\s\S]{0,200}(invitation|invitation-only|passenger\s+invitation)/i.test(section));
expect('contract states "a single driver tap must never assign the ride"',
  !!section && /single\s+driver\s+tap[\s\S]{0,80}(never|not)[\s\S]{0,40}assign/i.test(section));

// ── D1. Driver primary CTA «Откликнуться на заказ» + forbidden labels ─
// The driver CTA copy is the most visible Model-B signal; anchor it
// exactly and ban the three regression labels the audit named.
expect('driver primary CTA is exactly «Откликнуться на заказ»',
  !!section && /«Откликнуться на заказ»/.test(section));
expect('contract explicitly forbids regression CTA «Принять» (bare)',
  !!section
  && /Forbidden[\s\S]{0,400}«Принять»/.test(section)
  // Negative pin: «Принять» must not appear as a *prescribed* CTA.
  && !/primary[\s\S]{0,40}CTA[\s\S]{0,40}«Принять»\s*$/i.test(section));
expect('contract explicitly forbids regression CTA «Принять заказ»',
  !!section && /Forbidden[\s\S]{0,400}«Принять заказ»/.test(section));
expect('contract explicitly forbids regression CTA «Забрать заказ»',
  !!section && /Forbidden[\s\S]{0,400}«Забрать заказ»/.test(section));

// ── D2. P0 transition rule — driver tap creates offer, only passenger commits ─
expect('driver CTA creates DriverOffer(status=\'sent\')',
  !!section && /DriverOffer\(\s*status\s*=\s*'sent'\s*\)/.test(section));
expect('driver CTA does NOT mutate Order.status to «Заказ принят»',
  !!section
  // Markdown bold around "does not" introduces `**`, so allow asterisks
  // between the words. Same trick used for `not registered` above.
  && /(does[\s*]+not|не[\s*]+должен)[\s*]+(mutate|set|менять)[\s\S]{0,200}Order\.status[\s\S]{0,120}Заказ принят/i.test(section));
expect('passenger «Выбрать водителя» commits acceptance',
  !!section && /«Выбрать водителя»[\s\S]{0,200}commits/i.test(section));
expect('committing sets Order.selectedDriverId = offer.driverId',
  !!section && /Order\.selectedDriverId\s*=\s*offer\.driverId/.test(section));
expect('committing sets Order.status = «Заказ принят»',
  !!section && /Order\.status\s*=\s*['"«]Заказ принят/.test(section));
expect('committing flips selected offer.status to "accepted"',
  !!section && /offer\.status\s*=\s*'accepted'/.test(section));
expect('committing flips competing offers.status to "rejected"',
  !!section && /offers\.status\s*=\s*'rejected'/.test(section));

// ── D3. Passenger + driver state coverage (8 states with chips) ─────
const requiredStates = [
  ['passenger P1: Passenger Own Order Created · «Ждём водителя»',
    /Passenger\s+Own\s+Order\s+Created[\s\S]{0,400}«Ждём водителя»/i],
  ['passenger P2: Passenger Has Driver Offers · «Есть предложения»',
    /Passenger\s+Has\s+Driver\s+Offers[\s\S]{0,400}«Есть предложения»/i],
  ['passenger P3: Passenger Driver Selected · «Заказ принят» + «Открыть поездку»',
    /Passenger\s+Driver\s+Selected[\s\S]{0,600}«Заказ принят»[\s\S]{0,600}«Открыть поездку»/i],
  ['passenger P4: Passenger Terminal State · «Отменён» or «Истёк»',
    /Passenger\s+Terminal\s+State[\s\S]{0,400}«Отменён»[\s\S]{0,120}«Истёк»/i],
  ['driver D1: Driver Available Order · «Откликнуться на заказ»',
    /Driver\s+Available\s+Order[\s\S]{0,400}«Откликнуться на заказ»/i],
  ['driver D2: Driver Offer Sent · «Оффер отправлен»',
    /Driver\s+Offer\s+Sent[\s\S]{0,400}«Оффер отправлен»/i],
  ['driver D3: Driver Accepted / Assigned · «Заказ принят»',
    /Driver\s+Accepted\s*\/\s*Assigned[\s\S]{0,400}«Заказ принят»/i],
  ['driver D4: Driver Locked / Unavailable · «Недоступен»',
    /Driver\s+Locked\s*\/\s*Unavailable[\s\S]{0,400}«Недоступен»/i],
];
for (const [name, re] of requiredStates) {
  expect(`contract enumerates required state — ${name}`,
    !!section && re.test(section));
}

// ── D4. Terminal states expose no accept/offer affordance ──────────
// Extract the full P4 / D4 markdown table row (everything between the
// row's leading `|` and the next `\n|`-or-blank-line) so the actions
// check stays scoped to that row and can't leak into a neighbouring
// state. Markdown tables have 5 cells here (id · state · chip · renders ·
// actions), so a fixed cell-count regex would be brittle — capture the
// whole line instead.
function extractRow(src, idToken) {
  const re = new RegExp(`\\|\\s*${idToken}\\s*\\|[^\\n]*`, 'i');
  const m = src.match(re);
  return m ? m[0] : '';
}
const p4Row = extractRow(section, 'P4');
expect('P4 terminal row resolved', p4Row.length > 0);
if (p4Row) {
  expect('P4 terminal actions expose Создать новый заказ + Вернуться в ленту',
    /Создать\s+новый\s+заказ/.test(p4Row) && /Вернуться\s+в\s+ленту/.test(p4Row));
  expect('P4 terminal actions DO NOT expose «Откликнуться»',
    !/Откликнуться/.test(p4Row));
  expect('P4 terminal actions DO NOT expose «Выбрать водителя»',
    !/Выбрать\s+водителя/.test(p4Row));
}
const d4Row = extractRow(section, 'D4');
expect('D4 driver-locked row resolved', d4Row.length > 0);
if (d4Row) {
  expect('D4 driver-locked actions are Найти другие заказы + Вернуться в ленту',
    /Найти\s+другие\s+заказы/.test(d4Row) && /Вернуться\s+в\s+ленту/.test(d4Row));
  expect('D4 driver-locked actions DO NOT expose «Откликнуться»',
    !/Откликнуться/.test(d4Row));
}

// ── D5. Offer list rendering + empty-offers state ──────────────────
expect('contract requires DriverOffer[] to render in P2',
  !!section && /DriverOffer\[\]/.test(section));
expect('contract pins the empty offers state copy «Ждём водителя»',
  !!section && /empty\s+offers\s+state|«Ждём водителя»/i.test(section));

// ── D6. Over-budget badge + post-accept «Открыть поездку» + offer expiry ─
expect('over-budget rule: badge «Выше бюджета» when offer.price > order.budget',
  !!section
  && /offer\.price\s*>\s*order\.budget/.test(section)
  && /«Выше бюджета»/.test(section));
expect('post-accept rule: Order Detail stays accessible and primary becomes «Открыть поездку»',
  !!section
  && /remains\s+accessible[\s\S]{0,400}«Открыть поездку»/i.test(section));
expect('DriverOffer.expiresAt requirement with min() default',
  !!section
  && /DriverOffer[\s\S]{0,200}expiresAt/.test(section)
  && /min\(\s*Order\.expiresAt\s*,\s*createdAt\s*\+\s*15/.test(section));

// ── E. Explicit out-of-scope list ─────────────────────────────────
expect('contract explicitly rules out backend',
  !!section && /No\s+backend\b/i.test(section));
expect('contract explicitly rules out Mapbox',
  !!section && /No\s+Mapbox\b/i.test(section));
expect('contract explicitly rules out payment',
  !!section && /No\s+payment\b/i.test(section));
expect('contract explicitly bans fetch( in the gate phase',
  !!section && /fetch\(/.test(section));
expect('contract explicitly bans access tokens / api.mapbox.com',
  !!section && /api\.mapbox\.com/.test(section) && /token/i.test(section));
expect('contract explicitly bans inline script / inline style',
  !!section && /inline\s+(?:<script>|`?<script>`?|script|style)/i.test(section));

// ── F. Data contract surface (Order + DriverOffer) ────────────────
expect('Order data contract is enumerated',
  !!section
  && /\bOrder\b[\s\S]{0,400}selectedDriverId/.test(section)
  && /\bpassengerId\b/.test(section)
  && /\bbudget\b/.test(section));
expect('DriverOffer data contract is enumerated',
  !!section
  && /\bDriverOffer\b[\s\S]{0,600}orderId[\s\S]{0,400}driverId/.test(section)
  && /\betaMin\b/.test(section));
expect('DriverOffer status set includes sent / accepted / rejected',
  !!section && /['`]sent['`][\s\S]{0,80}['`]accepted['`][\s\S]{0,80}['`]rejected['`]/.test(section));

// ── G. Gate invariants — no runtime route / screen file shipped ───
// If either lands before the screen is actually implemented and the
// contract is re-graded, the smoke must fail so the audit can't be
// silently bypassed.
//
// The route guard accepts BOTH single- and double-quoted register()
// calls and BOTH `/order` (bare) and `/order/<param>` shapes so the
// guard can't be sidestepped by a `register("/order", …)` or
// `register('/order/:id', …)` form. Patterns matched:
//   register('/order',  …)   register("/order",  …)
//   register('/order/:id', …) register("/order/:id", …)
//   register('/order?…', …)  register("/order?…", …)
const ORDER_ROUTE_GUARD = /register\(\s*['"]\/order(?:\/|['"]|\?)/;

// Self-test the guard against synthetic inputs so a regex regression
// surfaces in CI even when public/src/app.js carries no /order line at
// all (the empty-positive case is otherwise unobservable). Failing any
// of these means the broadened regex from the BD-ORDER-DETAIL-01A
// follow-up review (#457) has been silently weakened.
const GUARD_SHOULD_MATCH = [
  `register('/order', orderDetail);`,
  `register("/order", orderDetail);`,
  `register('/order/:id', orderDetail);`,
  `register("/order/:id", orderDetail);`,
  `register( '/order', orderDetail );`,
  `register(  "/order?role=passenger", orderDetail);`,
];
const GUARD_SHOULD_NOT_MATCH = [
  `register('/orders', ordersList);`,           // different route family
  `register('/order-map-draft', orderMap);`,    // existing related route
  `// register('/order', orderDetail);`,        // commented-out — limit: still flags; pin we accept that
  `register('/feed', feed);`,                   // unrelated route
];
let guardSelfTestOk = true;
for (const s of GUARD_SHOULD_MATCH) {
  if (!ORDER_ROUTE_GUARD.test(s)) {
    console.log(`FAIL — route-guard self-test should MATCH: ${s}`);
    issues.push(`route-guard self-test missed: ${s}`);
    guardSelfTestOk = false;
  }
}
// The "should-not-match" list is intentionally short — the guard is meant
// to be conservative (false positives are safer than misses here). We
// still pin two surrounding routes that must not trip it.
for (const s of GUARD_SHOULD_NOT_MATCH.slice(0, 2).concat([GUARD_SHOULD_NOT_MATCH[3]])) {
  if (ORDER_ROUTE_GUARD.test(s)) {
    console.log(`FAIL — route-guard self-test false positive: ${s}`);
    issues.push(`route-guard self-test false positive: ${s}`);
    guardSelfTestOk = false;
  }
}
expect('route-guard regex self-test (single/double quotes, bare/path/query)',
  guardSelfTestOk);

expect('public/src/app.js does NOT register a runtime /order route',
  !ORDER_ROUTE_GUARD.test(appJs));
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
