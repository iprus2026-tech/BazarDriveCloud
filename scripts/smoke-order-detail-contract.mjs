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
    /BD-ORDER-DETAIL-01[\s\S]{0,1600}P0/.test(screenMap));
  expect('screen-map.md marks BD-ORDER-DETAIL-01 as missing runtime / contract-gated',
    /BD-ORDER-DETAIL-01[\s\S]{0,1600}missing\s+runtime[\s\S]{0,400}contract-gated/i.test(screenMap));
  // Codex review #458 — the screen-map row must mirror the BD-ORDER-DETAIL-01B
  // decision: Model B is locked, and the old "unresolved driver «Принять»"
  // wording must be gone so a stale screen-map entry can't drift back to
  // the audit-only contract.
  expect('screen-map.md says Model B is locked for BD-ORDER-DETAIL-01',
    /BD-ORDER-DETAIL-01[\s\S]{0,2000}Model\s+B[\s\S]{0,200}lock/i.test(screenMap));
  expect('screen-map.md no longer flags driver «Принять» as unresolved',
    !/BD-ORDER-DETAIL-01[\s\S]{0,2000}(unresolved|нерешён)[\s\S]{0,200}«Принять»/i.test(screenMap));
  expect('screen-map.md mentions the planned DriverOffer store',
    /BD-ORDER-DETAIL-01[\s\S]{0,2000}(DriverOffer|driver_offers)/.test(screenMap));
} else {
  expect('docs/screen-map.md not present — skipping mirrored entry check', true);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
