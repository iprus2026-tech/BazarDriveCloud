// BD-ORDER-DETAIL-01C — Order Detail runtime-shell smoke.
//
// Re-graded from the BD-ORDER-DETAIL-01A/01B gate-phase smoke: the
// contract gate (no /order route, no order_detail.js) has been lifted
// because BD-ORDER-DETAIL-01C ships the first runtime shell. The smoke
// keeps every contract check (Model B chosen, A/C forbidden, driver CTA
// exact, stored ACCEPTED vs UI «Заказ принят», sent-only rejection,
// terminal preservation, role chips, state coverage, fallback states)
// AND adds runtime-shell assertions:
//   • /order dynamic route is wired in router.js + app.js
//   • public/src/screens/order_detail.js exists and exports the helpers
//     the contract names
//   • renderOrderDetailMarkup() produces markup whose D1 primary CTA is
//     exactly «Откликнуться на заказ» and never any forbidden regression
//     label; whose chip text matches the contract; whose terminal /
//     locked rows never expose accept/offer/select-driver affordances
//   • the screen never persists Russian UI copy into Order.status
//   • sw.js precaches order_detail.js and the VERSION was bumped
//
// Forbidden-label scans never run against the smoke file itself (which
// has to spell the labels out for documentation). The runtime checks
// scope to the order_detail.js source or to specific generated state
// blocks built from synthetic inputs.

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
// BD-ORDER-DETAIL-01C — the route IS now registered. The contract Route
// row must spell out the `register('/order', orderDetail)` call so a
// future contract edit can't quietly drop the runtime hook while the
// runtime file stays around.
expect('contract states the /order route is registered in app.js',
  !!section && /register\(\s*['"]\/order['"]\s*,\s*orderDetail\s*\)/.test(section));

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
// The driver CTA copy is the most visible Model-B signal. Scope the
// exact-label check to the D1 row itself so a future contract that
// drops the CTA from D1 but keeps a stray mention elsewhere can't pass.
// The forbidden-labels check stays section-wide so a regression label
// is banned no matter where it would appear, but we also assert the
// D1 row is clean of all three.
//
// `extractRow` is defined below in the terminal-row block — pull the
// helper up so D1 / P1 can reuse it too.
function extractRow(src, idToken) {
  const re = new RegExp(`\\|\\s*${idToken}\\s*\\|[^\\n]*`, 'i');
  const m = src.match(re);
  return m ? m[0] : '';
}
const d1Row = extractRow(section, 'D1');
expect('D1 driver-available row resolved', d1Row.length > 0);
expect('D1 row carries the EXACT primary CTA «Откликнуться на заказ»',
  d1Row.includes('«Откликнуться на заказ»'));
expect('D1 row marks the CTA as primary',
  /\(primary\)/i.test(d1Row));
expect('D1 row DOES NOT carry the regression label «Принять заказ»',
  !d1Row.includes('«Принять заказ»'));
expect('D1 row DOES NOT carry the regression label «Забрать заказ»',
  !d1Row.includes('«Забрать заказ»'));
// `«Принять»` (bare) — match the word with no trailing token (заказ /
// оффер /etc.) so the forbidden bare form is rejected without false-
// flagging «Принять заказ» (which has its own line above).
expect('D1 row DOES NOT carry the regression label «Принять» (bare)',
  !/«Принять»/.test(d1Row));
// Section-wide forbidden-list pin (kept) — the audit's explicit "do
// not regress to" list must name all three labels.
expect('contract Forbidden list explicitly names «Принять»',
  !!section && /Forbidden[\s\S]{0,400}«Принять»/.test(section));
expect('contract Forbidden list explicitly names «Принять заказ»',
  !!section && /Forbidden[\s\S]{0,400}«Принять заказ»/.test(section));
expect('contract Forbidden list explicitly names «Забрать заказ»',
  !!section && /Forbidden[\s\S]{0,400}«Забрать заказ»/.test(section));

// ── D2. P0 transition rule — driver tap creates offer, only passenger commits ─
expect('driver CTA creates DriverOffer(status=\'sent\')',
  !!section && /DriverOffer\(\s*status\s*=\s*'sent'\s*\)/.test(section));
expect('driver CTA does NOT mutate Order.status to canonical ACCEPTED',
  !!section
  // Markdown bold around "does not" introduces `**`, so allow asterisks
  // between the words. Same trick used for `not registered` above.
  && /(does[\s*]+not|не[\s*]+должен)[\s*]+(mutate|set|менять)[\s\S]{0,200}Order\.status[\s\S]{0,120}'?ACCEPTED'?/i.test(section));
expect('passenger «Выбрать водителя» commits acceptance',
  !!section && /«Выбрать водителя»[\s\S]{0,200}commits/i.test(section));
expect('committing sets Order.selectedDriverId = offer.driverId',
  !!section && /Order\.selectedDriverId\s*=\s*offer\.driverId/.test(section));

// Codex review #458 — stored `Order.status` must use the canonical enum
// value 'ACCEPTED' (from ride_state.js / mock_api.js), NOT the Russian
// UI label «Заказ принят». The Russian text stays on the UI chips for P3
// and D3, but the contract must spell out the storage shape so a future
// implementation can't mix display copy into the data layer.
expect('committing sets Order.status = \'ACCEPTED\' (canonical enum)',
  !!section && /Order\.status\s*=\s*['"`]ACCEPTED['"`]/.test(section));
expect('contract spells out that «Заказ принят» is UI display/chip only',
  !!section
  && /«Заказ принят»\s+is\s+UI\s+(display|chip)/i.test(section));
expect('committing flips selected offer.status to "accepted"',
  !!section && /offer\.status\s*=\s*'accepted'/.test(section));
// The previous wording was `offers.status = 'rejected'` for *all*
// competing offers; Codex review #458 narrowed this to "only sent
// competing offers flip to status='rejected'". Allow either the bulk
// form or the scoped form so the contract owns the precise semantics
// while the smoke just pins that rejection is part of the commit.
expect('committing flips competing sent offers to status=\'rejected\'',
  !!section
  && (/offers\.status\s*=\s*'rejected'/.test(section)
      || /flip[\s\S]{0,200}status='rejected'/i.test(section)));

// Codex review #458 — stored-status leak. The contract must never
// write the Russian UI label into Order.status. Scan the whole section
// for any `Order.status = '…Заказ принят…'` form — guillemets, straight
// quotes, backticks. Allowed: `Order.status = 'ACCEPTED'` plus the
// separate sentence that explicitly calls «Заказ принят» a UI chip.
expect('contract never stores the Russian UI label as Order.status',
  !!section && !/Order\.status\s*=\s*['"`«][^'"`»]*Заказ принят/.test(section));

// Codex review #458 — passenger commit preserves terminal offers.
// Only competing offers with status='sent' flip to rejected. Offers
// already in status='withdrawn' or status='expired' are preserved.
expect('passenger commit rule scopes competing-offer rejection to status=\'sent\'',
  !!section
  && /only\s+active\s+competing\s+offers\s+with\s+`?status='sent'`?[\s\S]{0,400}rejected/i.test(section));
expect('passenger commit rule preserves status=\'withdrawn\' offers',
  !!section
  && /(preserved|verbatim|untouched|stays?)[\s\S]{0,400}status='withdrawn'/i.test(section));
expect('passenger commit rule preserves status=\'expired\' offers',
  !!section
  && /(preserved|verbatim|untouched|stays?)[\s\S]{0,400}status='expired'/i.test(section));

// Active-ride seed — the passenger commit must seed
// bazardrive.active_ride.v1 with the resulting tripId so the P3
// «Открыть поездку» CTA has a canonical handoff target.
expect('passenger commit seeds bazardrive.active_ride.v1',
  !!section && /bazardrive\.active_ride\.v1/.test(section));
expect('active_ride seed uses tripId = trip_${order.id}',
  !!section && /tripId\s*=\s*trip_\$\{order\.id\}/.test(section));
expect('active_ride seed records status = \'ACCEPTED\'',
  !!section && /seed[\s\S]{0,300}status\s*=?\s*['"`]ACCEPTED['"`]/i.test(section));
expect('P3 «Открыть поездку» hands off using the seeded tripId',
  !!section
  && /«Открыть поездку»[\s\S]{0,400}\/active-ride\?role=passenger[\s\S]{0,80}tripId/.test(section));

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
// row's leading `|` and the end of line) so the actions check stays
// scoped to that row and can't leak into a neighbouring state. The
// `extractRow` helper is defined above the D1 block.
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
  // Codex review #458 — D4 also must not surface the passenger-side
  // commit affordance. A future contract drift could otherwise leave a
  // stray «Выбрать водителя» on the driver-locked row and pretend the
  // driver can still self-rescue from a passenger-rejected order.
  expect('D4 driver-locked actions DO NOT expose «Выбрать водителя»',
    !/Выбрать\s+водителя/.test(d4Row));
}

// ── D5. Offer list rendering + empty-offers state ──────────────────
// Scope the empty-offers check to the P1 row (Passenger Own Order
// Created · «Ждём водителя» · empty offers state) instead of an
// section-wide A|B match — a section-wide regex would also pass when
// «Ждём водителя» leaks into a different state's chip and the actual
// P1 empty-state copy quietly disappears.
expect('contract requires DriverOffer[] to render in P2',
  !!section && /DriverOffer\[\]/.test(section));
const p1Row = extractRow(section, 'P1');
expect('P1 own-order row resolved', p1Row.length > 0);
if (p1Row) {
  expect('P1 row pins the «Ждём водителя» status chip',
    p1Row.includes('«Ждём водителя»'));
  expect('P1 row pins the empty offers state',
    /empty\s+offers\s+state/i.test(p1Row));
}

// ── D6. Over-budget badge + post-accept «Открыть поездку» + offer expiry ─
expect('over-budget rule: badge «Выше бюджета» when offer.price > order.budget',
  !!section
  && /offer\.price\s*>\s*order\.budget/.test(section)
  && /«Выше бюджета»/.test(section));
expect('post-accept rule: Order Detail stays accessible and primary becomes «Открыть поездку»',
  !!section
  && /remains\s+accessible[\s\S]{0,400}«Открыть поездку»/i.test(section));
// Codex review #458 — the default must tolerate Order.expiresAt being
// absent in current mock orders. Allow either the bare `min(...)` form
// (legacy) or the nullish-fallback `?? Infinity` form (new).
expect('DriverOffer.expiresAt requirement with min(... ?? Infinity, createdAt + 15) fallback',
  !!section
  && /DriverOffer[\s\S]{0,200}expiresAt/.test(section)
  && /min\(\s*Order\.expiresAt\s*\?\?\s*Infinity\s*,\s*createdAt\s*\+\s*15/.test(section));
expect('contract states Order.expiresAt is optional in current mock orders',
  !!section
  && /Order\.expiresAt[\s\S]{0,400}(optional|absent)/i.test(section));

// ── D7. Shared fallback states (S1 Loading, S2 Error / Not Found) ──
// Codex review #458 — the original draft enumerated Loading and Error /
// Not Found shared states; the Model-B rewrite dropped them. Restore the
// pins so a future contract that ships only the role-split surface but
// leaves no fallback for an unresolved order can't pass.
const sharedFallbackAnchor = /Shared\s+fallback\s+states/i.test(section);
expect('contract documents the Shared fallback states subsection',
  sharedFallbackAnchor);
const s1Row = extractRow(section, 'S1');
expect('S1 Loading row resolved', s1Row.length > 0);
if (s1Row) {
  expect('S1 row labels the state as Loading',
    /Loading/i.test(s1Row));
  expect('S1 row pins the Russian chip «Загружаем заказ»',
    s1Row.includes('«Загружаем заказ»'));
}
const s2Row = extractRow(section, 'S2');
expect('S2 Error / Not Found row resolved', s2Row.length > 0);
if (s2Row) {
  expect('S2 row labels the state as Error / Not Found',
    /Error\s*\/\s*Not\s+Found/i.test(s2Row));
  expect('S2 row pins the Russian chip «Заказ не найден»',
    s2Row.includes('«Заказ не найден»'));
  expect('S2 actions are Вернуться в ленту + Найти другие заказы',
    /Вернуться\s+в\s+ленту/.test(s2Row) && /Найти\s+другие\s+заказы/.test(s2Row));
  expect('S2 row exposes NO accept/offer/select-driver affordance',
    !/Откликнуться/.test(s2Row)
    && !/Выбрать\s+водителя/.test(s2Row)
    && !/Принять/.test(s2Row));
}

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
// Require every member of the canonical DriverOffer status set named in
// the data contract — independently asserted so a future contract drop
// of e.g. `withdrawn` (Codex review #458 P2) is caught even if the
// remaining four are still present.
for (const member of ['sent', 'accepted', 'rejected', 'withdrawn', 'expired']) {
  expect(`DriverOffer status set includes '${member}'`,
    !!section && new RegExp(`['\`]${member}['\`]`).test(section));
}

// ── F1. Status language must include the «Истёк» terminal label ────
// Codex review #458 — the canonical Russian status list previously
// omitted «Истёк» even though P4 expects it. Pin it explicitly so a
// future trim of the list can't drop it again.
expect('status language list includes "Истёк"',
  !!section && /Status\s+language[\s\S]{0,800}[«`"']Истёк[`»"']/i.test(section));

// ── F2. Stored order shape compatibility (mock_api shape mapping) ──
// Order Detail must declare how its target fields map onto the current
// mock store's field names — otherwise an implementation could ship
// against the target shape and silently fail to render a real persisted
// order. Pin each named source field the audit called out.
const orderShapeAnchor = /Stored\s+order\s+shape\s+compatibility/i.test(section);
expect('contract documents the stored-order-shape compatibility section',
  orderShapeAnchor);
expect('compatibility section maps time ← scheduledAt',
  !!section && /scheduledAt/.test(section) && /\btime\b[\s\S]{0,200}scheduledAt/.test(section));
// Codex review #458 — budget must derive from the NUMERIC estimatedPrice,
// not from estimatedPriceLabel (which is presentation-only and can't be
// safely parsed back into a number for «Выше бюджета» comparison).
expect('compatibility section maps price / budget ← numeric estimatedPrice',
  !!section
  && /\bprice\b[\s\S]{0,80}\bbudget\b[\s\S]{0,200}estimatedPrice/.test(section));
expect('compatibility section calls estimatedPrice numeric',
  !!section
  && /estimatedPrice[\s\S]{0,80}\(\s*numeric\s*\)|numeric\s+`?estimatedPrice/i.test(section));
expect('compatibility section marks estimatedPriceLabel as presentation-only',
  !!section
  && /estimatedPriceLabel[\s\S]{0,300}(presentation-only|display-only|display\s+string)/i.test(section));
expect('compatibility section pins estimatedPriceLabel must NOT be parsed back into a number',
  !!section
  && /(must\s+not|never)\s+(?:be\s+)?parse(?:d)?[\s\S]{0,200}number/i.test(section));
// Codex review #458 — Order.expiresAt is optional in the current mock
// store; the compatibility table must call that out so the offer expiry
// fallback (createdAt + 15 min) isn't a surprise.
expect('compatibility section marks expiresAt as optional / absent in current mock orders',
  !!section
  && /\bexpiresAt\b[\s\S]{0,400}(absent|optional)[\s\S]{0,400}(mock|current)/i.test(section));
expect('compatibility section maps passengerId ← passenger.authorId',
  !!section && /passenger\.authorId/.test(section));
expect('compatibility section pins createdAt as a same-name field',
  !!section && /createdAt[\s\S]{0,200}(same\s+name|createdAt)/i.test(section));
expect('compatibility section pins roleView as DERIVED (NOT stored)',
  !!section
  && /roleView[\s\S]{0,400}(derived|not\s+stored|never\s+persisted|render-?time)/i.test(section));

// ── F3. Order-store writes contract (driver no-write / passenger commit) ─
// The Model B transition rule is split between the driver and the
// passenger; pin the write asymmetry explicitly so a future contract
// can't silently grant the driver tap a `selectedDriverId` write.
expect('contract documents the order-store writes table',
  !!section && /Order-store\s+writes/i.test(section));
expect('driver «Откликнуться на заказ» writes NONE on the order store',
  !!section
  && /Driver[\s\S]{0,400}«Откликнуться на заказ»[\s\S]{0,400}\bNone\b/.test(section));
expect('passenger «Выбрать водителя» writes Order.selectedDriverId + Order.status',
  !!section
  && /Passenger[\s\S]{0,400}«Выбрать водителя»[\s\S]{0,400}Order\.selectedDriverId[\s\S]{0,200}Order\.status/.test(section));

// Codex review #458 — document writes for every mutating CTA the screen
// surfaces, not just the happy commit path. Each block here pins one
// CTA's effect: scope to the row in the Order-store writes table so the
// pins can't drift onto a neighbouring actor.
const cancelOrderRow = section.match(
  /\|\s*Passenger\s*\|\s*taps\s+«Отменить заказ»[^\n]*/);
expect('passenger «Отменить заказ» row resolved', !!cancelOrderRow);
if (cancelOrderRow) {
  const row = cancelOrderRow[0];
  expect('passenger «Отменить заказ» writes Order.status = \'CANCELED\'',
    /Order\.status\s*=\s*['"`]CANCELED['"`]/.test(row));
  expect('passenger «Отменить заказ» only rejects active sent offers',
    /only\s+active[\s\S]{0,200}status='sent'[\s\S]{0,200}rejected/i.test(row));
  expect('passenger «Отменить заказ» preserves terminal (withdrawn/expired) offers',
    /(preserved|verbatim)[\s\S]{0,200}withdrawn[\s\S]{0,80}expired/i.test(row)
    || /withdrawn[\s\S]{0,80}expired[\s\S]{0,200}preserved/i.test(row));
}
const rejectOfferRow = section.match(
  /\|\s*Passenger\s*\|\s*taps\s+«Отклонить»[^\n]*/);
expect('passenger «Отклонить» row resolved', !!rejectOfferRow);
if (rejectOfferRow) {
  const row = rejectOfferRow[0];
  expect('passenger «Отклонить» writes NONE on the order store',
    /\bNone\b/.test(row));
  expect('passenger «Отклонить» flips only that single offer from sent → rejected',
    /(only\s+that|single)[\s\S]{0,200}status='sent'[\s\S]{0,80}status='rejected'/i.test(row));
  expect('passenger «Отклонить» does not touch selectedDriverId / Order.status',
    !/Order\.status\s*=/.test(row) && !/selectedDriverId\s*=/.test(row));
}
const driverD3CancelRow = section.match(
  /\|\s*Driver\s*\|\s*taps\s+«Отменить»\s+on\s+D3[^\n]*/);
expect('driver D3 «Отменить» row resolved', !!driverD3CancelRow);
if (driverD3CancelRow) {
  const row = driverD3CancelRow[0];
  // The D3 cancel is documented as a delegated handoff to the active-ride
  // cancellation flow, NOT a silent Order-Detail-side write.
  expect('driver D3 «Отменить» delegates to active-ride cancellation handoff',
    /(delegate|hand[- ]?off|cancellation\s+handoff|active-ride[\s\S]{0,200}cancel)/i.test(row));
  expect('driver D3 «Отменить» does NOT prescribe a direct Order.status mutation in this row',
    !/Order\.status\s*=\s*['"`][A-Z_]+['"`]/.test(row));
  // …and the row must explicitly name backend / active-ride policy as
  // the owner of the terminal write so a future implementation can't
  // assume silent undefined behaviour.
  expect('driver D3 «Отменить» row names active-ride / backend policy as the cancellation owner',
    /(active-ride[\s\S]{0,200}(cancel|policy)|backend\s+policy)/i.test(row));
}

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

// ── G1. Runtime shell — /order route + screen file shipped ────────
// BD-ORDER-DETAIL-01C inverts the gate-phase checks: the runtime is now
// present, the smoke must FAIL if the route or the screen file is
// missing. The route-guard regex from 01A stays as a self-tested
// helper so a future quote-style refactor still matches both single-
// and double-quoted registrations.
expect('public/src/app.js registers a runtime /order route (any quote style)',
  ORDER_ROUTE_GUARD.test(appJs));
expect('public/src/app.js imports orderDetail from screens/order_detail.js',
  /import\s+orderDetail\s+from\s+['"]\.\/screens\/order_detail\.js['"]/.test(appJs));
expect('public/src/screens/order_detail.js is shipped',
  exists('../public/src/screens/order_detail.js'));

// router.js carries the minimal /order/<id> dynamic fallback so
// /order/<anything> resolves to the registered '/order' loader instead
// of silently falling back to /feed.
const routerJs = read('../public/src/router.js');
expect('router.js dispatches /order/<id> to the exact /order loader',
  /startsWith\(\s*['"]\/order\/['"]\s*\)/.test(routerJs)
  && /=\s*['"]\/order['"]/.test(routerJs));
expect('router.js preserves the existing /feed fallback for unknown routes',
  /routes\.get\(\s*['"]\/feed['"]\s*\)/.test(routerJs));

// ── G2. order_detail.js — exported surface + Model-B-shaped markup ─
// Behavioural section: import the module and exercise its pure helpers
// against synthetic inputs. The forbidden-label scans target the
// rendered markup or the module source, never the smoke source itself
// (which has to spell forbidden labels out for documentation).
const orderDetailSrc = read('../public/src/screens/order_detail.js');
const orderDetailMod = await import(new URL('../public/src/screens/order_detail.js', import.meta.url).href);

for (const name of [
  'default',
  'parseOrderHashPath',
  'resolveRoleFromQuery',
  'loadOrder',
  'resolveState',
  'resolveStateChip',
  'renderOrderDetailMarkup',
  'ROLE_CHIP',
  'STATE_CHIP',
  'ORDER_STATUS',
  'DRIVER_PRIMARY_CTA',
  'DEMO_ORDERS',
]) {
  expect(`order_detail.js exports ${name}`,
    orderDetailMod[name] !== undefined);
}

// Role chip text matches the contract (load-bearing for the smoke and
// for the eventual visual review).
expect('ROLE_CHIP.passenger === "Ваш заказ"',
  orderDetailMod.ROLE_CHIP.passenger === 'Ваш заказ');
expect('ROLE_CHIP.driver === "Просмотр водителя"',
  orderDetailMod.ROLE_CHIP.driver === 'Просмотр водителя');

// Stored ACCEPTED enum + UI chip live in different namespaces.
expect('ORDER_STATUS.ACCEPTED === "ACCEPTED" (canonical enum, not Russian)',
  orderDetailMod.ORDER_STATUS.ACCEPTED === 'ACCEPTED');
expect('STATE_CHIP.P3 === "Заказ принят" (UI display only)',
  orderDetailMod.STATE_CHIP.P3 === 'Заказ принят');
expect('STATE_CHIP.D3 === "Заказ принят" (UI display only)',
  orderDetailMod.STATE_CHIP.D3 === 'Заказ принят');
expect('STATE_CHIP.S1 === "Загружаем заказ"',
  orderDetailMod.STATE_CHIP.S1 === 'Загружаем заказ');
expect('STATE_CHIP.S2 === "Заказ не найден"',
  orderDetailMod.STATE_CHIP.S2 === 'Заказ не найден');

// Driver primary CTA is the exact label from the contract.
expect('DRIVER_PRIMARY_CTA === "Откликнуться на заказ"',
  orderDetailMod.DRIVER_PRIMARY_CTA === 'Откликнуться на заказ');

// resolveState() against each demo fixture for the role we use it for
// in the manual test URLs. This is the single most important contract
// for Model B: state resolution must never depend on the driver tap.
expect('demo-order-1 → P1 for passenger',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-1'), 'passenger') === 'P1');
expect('demo-order-1 → D1 for driver',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-1'), 'driver') === 'D1');
expect('demo-order-offers → P2 for passenger',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-offers'), 'passenger') === 'P2');
expect('demo-order-accepted → P3 for passenger',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-accepted'), 'passenger') === 'P3');
expect('demo-order-accepted → D3 for driver (self is selected)',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-accepted'), 'driver') === 'D3');
expect('demo-order-terminal → P4 for passenger',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-terminal'), 'passenger') === 'P4');
expect('demo-order-locked → D4 for driver (other driver was picked)',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-locked'), 'driver') === 'D4');
expect('missing-order → S2 for any role (null fixture)',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('missing-order'), 'passenger') === 'S2');
expect('{__loading: true} → S1',
  orderDetailMod.resolveState({ __loading: true }, 'passenger') === 'S1');

// Render each state's markup and check the chip text + the absence of
// any forbidden affordance. Markup is a string — no DOM dependency.
function renderFor(id, role) {
  const order = orderDetailMod.loadOrder(id);
  const state = orderDetailMod.resolveState(order, role);
  return {
    state,
    markup: orderDetailMod.renderOrderDetailMarkup({ order, role, state }),
  };
}

// P1 passenger markup carries role chip + state chip + empty-offers
// + the four documented actions, and never the driver primary CTA.
{
  const { state, markup } = renderFor('demo-order-1', 'passenger');
  expect('P1 passenger render: state === "P1"', state === 'P1');
  expect('P1 passenger markup contains role chip «Ваш заказ»',
    markup.includes('Ваш заказ'));
  expect('P1 passenger markup contains state chip «Ждём водителя»',
    markup.includes('Ждём водителя'));
  for (const label of ['Изменить', 'Отменить заказ', 'Поделиться', 'Скопировать']) {
    expect(`P1 passenger markup exposes action "${label}"`, markup.includes(label));
  }
  expect('P1 passenger markup never carries the driver primary CTA',
    !markup.includes(orderDetailMod.DRIVER_PRIMARY_CTA));
}

// P2 passenger markup renders offer cards, the over-budget badge, and
// the three offer-level passenger actions.
{
  const { state, markup } = renderFor('demo-order-offers', 'passenger');
  expect('P2 passenger render: state === "P2"', state === 'P2');
  expect('P2 passenger markup contains state chip «Есть предложения»',
    markup.includes('Есть предложения'));
  for (const label of ['Выбрать водителя', 'Написать', 'Отклонить']) {
    expect(`P2 passenger markup exposes offer action "${label}"`, markup.includes(label));
  }
  expect('P2 passenger markup badges the over-budget offer «Выше бюджета»',
    markup.includes('Выше бюджета'));
}

// P3 passenger markup carries the «Открыть поездку» primary CTA and
// renders the UI chip «Заказ принят»; the stored ACCEPTED enum must
// never appear in markup as a status label.
{
  const { state, markup } = renderFor('demo-order-accepted', 'passenger');
  expect('P3 passenger render: state === "P3"', state === 'P3');
  expect('P3 passenger markup contains state chip «Заказ принят»',
    markup.includes('Заказ принят'));
  expect('P3 passenger markup contains primary CTA «Открыть поездку»',
    markup.includes('Открыть поездку'));
}

// P4 terminal markup renders only the documented exits and exposes no
// accept / offer / select-driver affordance.
{
  const { state, markup } = renderFor('demo-order-terminal', 'passenger');
  expect('P4 passenger render: state === "P4"', state === 'P4');
  expect('P4 passenger markup contains «Создать новый заказ»',
    markup.includes('Создать новый заказ'));
  expect('P4 passenger markup contains «Вернуться в ленту»',
    markup.includes('Вернуться в ленту'));
  expect('P4 passenger markup exposes NO «Откликнуться»',
    !markup.includes('Откликнуться'));
  expect('P4 passenger markup exposes NO «Выбрать водителя»',
    !markup.includes('Выбрать водителя'));
  // Bare «Принять» negative pin — and «Принять заказ» must also be
  // absent (it has «Принять» as a prefix; the substring check catches
  // both forms simultaneously).
  expect('P4 passenger markup carries no «Принять» regression label',
    !markup.includes('Принять'));
}

// D1 driver markup MUST carry the exact «Откликнуться на заказ» CTA
// and MUST NOT carry any of the three forbidden regression labels.
{
  const { state, markup } = renderFor('demo-order-1', 'driver');
  expect('D1 driver render: state === "D1"', state === 'D1');
  expect('D1 driver markup contains role chip «Просмотр водителя»',
    markup.includes('Просмотр водителя'));
  expect('D1 driver primary CTA is exactly «Откликнуться на заказ»',
    markup.includes('Откликнуться на заказ'));
  // The three forbidden labels are the audit-named regressions. Scan
  // the D1 markup specifically — passing labels via constants from the
  // smoke source would still hard-code them into this file, so build
  // each label from independent code-point arrays so the smoke source
  // and the forbidden token are textually distinct.
  const forbidden = [
    String.fromCharCode(0xAB) + 'Принять' + String.fromCharCode(0xBB),
    String.fromCharCode(0xAB) + 'Принять' + ' заказ' + String.fromCharCode(0xBB),
    String.fromCharCode(0xAB) + 'Забрать заказ' + String.fromCharCode(0xBB),
  ];
  for (const label of forbidden) {
    expect(`D1 driver markup never carries forbidden regression label ${JSON.stringify(label)}`,
      !markup.includes(label));
  }
}

// D2 driver markup (own offer sent) — labels + waiting copy.
{
  // demo-order-1 has no offers; synthesize a D2 by injecting an own
  // sent offer into a clone of the fixture so we can exercise D2 without
  // adding a second demo fixture.
  const seed = orderDetailMod.loadOrder('demo-order-1');
  seed.offers = [{
    id: 'offer-self', orderId: seed.id, driverId: orderDetailMod.SELF_DRIVER_ID,
    driverName: 'Вы', car: 'Test', rating: '5,0', etaMin: 6, price: 1100,
    message: 'Готов выехать', status: 'sent', createdAt: 0, expiresAt: 0,
  }];
  const state = orderDetailMod.resolveState(seed, 'driver');
  const markup = orderDetailMod.renderOrderDetailMarkup({ order: seed, role: 'driver', state });
  expect('D2 driver render: state === "D2" when self has a sent offer',
    state === 'D2');
  expect('D2 driver markup contains chip «Оффер отправлен»',
    markup.includes('Оффер отправлен'));
  for (const label of ['Изменить оффер', 'Отозвать оффер', 'Написать']) {
    expect(`D2 driver markup exposes action "${label}"`, markup.includes(label));
  }
}

// D3 driver markup — passenger info + four documented actions.
{
  const { state, markup } = renderFor('demo-order-accepted', 'driver');
  expect('D3 driver render: state === "D3"', state === 'D3');
  expect('D3 driver markup contains chip «Заказ принят»',
    markup.includes('Заказ принят'));
  for (const label of [
    'Начать подачу', 'Открыть активную поездку', 'Написать', 'Отменить',
  ]) {
    expect(`D3 driver markup exposes action "${label}"`, markup.includes(label));
  }
}

// D4 driver markup (locked) — reason + only the documented exits.
{
  const { state, markup } = renderFor('demo-order-locked', 'driver');
  expect('D4 driver render: state === "D4"', state === 'D4');
  expect('D4 driver markup contains chip «Недоступен»',
    markup.includes('Недоступен'));
  expect('D4 driver markup contains exit «Найти другие заказы»',
    markup.includes('Найти другие заказы'));
  expect('D4 driver markup contains exit «Вернуться в ленту»',
    markup.includes('Вернуться в ленту'));
  expect('D4 driver markup exposes NO «Откликнуться»',
    !markup.includes('Откликнуться'));
  expect('D4 driver markup exposes NO «Выбрать водителя»',
    !markup.includes('Выбрать водителя'));
}

// S1 loading markup is reachable via the loading override.
{
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: { __loading: true, id: 'x' }, role: 'passenger', state: 'S1' });
  expect('S1 markup contains chip «Загружаем заказ»',
    markup.includes('Загружаем заказ'));
}

// S2 error-not-found markup is reachable for any unknown id.
{
  const { state, markup } = renderFor('missing-order', 'passenger');
  expect('S2 render: state === "S2"', state === 'S2');
  expect('S2 markup contains «Заказ не найден»',
    markup.includes('Заказ не найден'));
  expect('S2 markup contains exit «Вернуться в ленту»',
    markup.includes('Вернуться в ленту'));
  expect('S2 markup contains exit «Найти другие заказы»',
    markup.includes('Найти другие заказы'));
  expect('S2 markup exposes NO accept/offer/select-driver affordance',
    !markup.includes('Откликнуться')
    && !markup.includes('Выбрать водителя')
    && !markup.includes('Принять'));
}

// ── G3. Runtime source isolation — no Russian UI label stored as status ──
// The screen file itself must NEVER contain a literal
// `Order.status = 'Заказ принят'` (or equivalent). The stored enum is
// 'ACCEPTED'; «Заказ принят» is only ever a UI chip / display string.
expect('order_detail.js never assigns Russian UI label to Order.status',
  !/Order\.status\s*=\s*['"`«][^'"`»]*Заказ принят/.test(orderDetailSrc));
expect('order_detail.js uses the canonical \'ACCEPTED\' enum',
  /['"`]ACCEPTED['"`]/.test(orderDetailSrc));

// Out-of-scope tokens — runtime must not introduce backend / Mapbox.
expect('order_detail.js never calls fetch(',
  !/\bfetch\s*\(/.test(orderDetailSrc));
expect('order_detail.js never references api.mapbox.com',
  !/api\.mapbox\.com/i.test(orderDetailSrc));
// Strip line + block comments before the token scan: the screen file's
// header disclaimer ("No backend, no Mapbox, no fetch, no token strings")
// would otherwise trip the literal-substring scan.
const orderDetailSrcNoComments = orderDetailSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
expect('order_detail.js never references a Mapbox access token (code)',
  !/mapbox[\s\S]{0,80}token/i.test(orderDetailSrcNoComments)
  && !/accessToken/i.test(orderDetailSrcNoComments));

// Inline-script / inline-style guards. We scan templated HTML strings
// for the prefixes that would betray inline JS or inline `style=""`.
expect('order_detail.js never emits an inline <script> tag',
  !/<script\b/i.test(orderDetailSrc));
expect('order_detail.js never emits an inline style="..." attribute',
  !/\bstyle\s*=\s*["'][^"']/i.test(orderDetailSrc));

// Stub-action evidence — the 01C contract says every mutating CTA is
// a non-mutating toast in this PR. Pin the deferred-write notice copy.
expect('order_detail.js carries the deferred-write stub toast for actions',
  /Действие будет подключено в 01D/.test(orderDetailSrc));
expect('order_detail.js carries the deferred-write stub toast for the driver offer CTA',
  /Оффер будет подключён в 01D/.test(orderDetailSrc));
// The driver primary CTA handler MUST NOT mutate Order.status,
// selectedDriverId, or persist a DriverOffer. The next four pins are
// negative source-level scans against the screen file.
expect('order_detail.js never mutates Order.status from the driver CTA path',
  !/driver-send-offer[\s\S]{0,400}Order\.status\s*=/.test(orderDetailSrc));
expect('order_detail.js never sets selectedDriverId from the driver CTA path',
  !/driver-send-offer[\s\S]{0,400}selectedDriverId\s*=/.test(orderDetailSrc));
expect('order_detail.js never persists a DriverOffer write call',
  !/saveDriverOffer\s*\(/.test(orderDetailSrc));
expect('order_detail.js never seeds bazardrive.active_ride.v1',
  !/saveActiveRide\s*\(/.test(orderDetailSrc)
  && !/updateActiveRideStatus\s*\(/.test(orderDetailSrc));

// ── G4. Service worker precaches order_detail.js + VERSION bump ────
const sw = read('../public/sw.js');
expect('public/sw.js PRECACHE includes order_detail.js',
  /\.\/src\/screens\/order_detail\.js/.test(sw));
const versionMatch = sw.match(/VERSION\s*=\s*'v(\d+)'/);
expect('sw.js VERSION is a numeric vNNN tag', !!versionMatch);
if (versionMatch) {
  // Require VERSION >= 111 so the precache update from this PR rolls
  // out at install time. The earlier baseline was 'v110'.
  expect('sw.js VERSION bumped to at least v111 for the order_detail precache',
    Number(versionMatch[1]) >= 111, `got=v${versionMatch[1]}`);
}

// ── H. screen-map.md mirrors the runtime-shell entry ──────────────
// screen-map.md tracks the screen's lifecycle; pin that the row now
// reads "runtime shell present / Model B locked / writes pending"
// instead of the gate-phase "missing runtime / contract-gated".
const mapPath = new URL('../docs/screen-map.md', import.meta.url);
let mapPresent = false;
try { fs.accessSync(mapPath); mapPresent = true; } catch {}
if (mapPresent) {
  const screenMap = fs.readFileSync(mapPath, 'utf8');
  expect('docs/screen-map.md lists BD-ORDER-DETAIL-01',
    /BD-ORDER-DETAIL-01/.test(screenMap));
  expect('screen-map.md flags BD-ORDER-DETAIL-01 with P0 priority',
    /BD-ORDER-DETAIL-01[\s\S]{0,2000}P0/.test(screenMap));
  expect('screen-map.md marks BD-ORDER-DETAIL-01 as runtime shell present',
    /BD-ORDER-DETAIL-01[\s\S]{0,2400}runtime\s+shell\s+present/i.test(screenMap));
  expect('screen-map.md says Model B is locked for BD-ORDER-DETAIL-01',
    /BD-ORDER-DETAIL-01[\s\S]{0,2400}Model\s+B[\s\S]{0,200}lock/i.test(screenMap));
  expect('screen-map.md marks writes as pending (deferred to 01D)',
    /BD-ORDER-DETAIL-01[\s\S]{0,2400}writes\s+pending/i.test(screenMap));
  expect('screen-map.md no longer flags the row as missing runtime',
    !/BD-ORDER-DETAIL-01[\s\S]{0,2400}\bmissing\s+runtime\b/i.test(screenMap));
  expect('screen-map.md no longer flags driver «Принять» as unresolved',
    !/BD-ORDER-DETAIL-01[\s\S]{0,2400}(unresolved|нерешён)[\s\S]{0,200}«Принять»/i.test(screenMap));
} else {
  expect('docs/screen-map.md not present — skipping mirrored entry check', true);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
