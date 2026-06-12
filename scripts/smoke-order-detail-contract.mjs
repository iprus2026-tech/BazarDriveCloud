// BD-ORDER-DETAIL-01C — Order Detail runtime-shell smoke.
//
// This smoke is the post-gate version of the Order Detail guard: /order/<id>
// and order_detail.js are now expected to exist. The checks below keep the
// Model B contract locked AND the scoped local 01D write paths intact:
// driver send/withdraw offer, passenger select-driver commit, passenger
// open-trip active_ride handoff, passenger cancel order, passenger reject
// offer, passenger cancel sent-offer sync, driver cancel accepted order.
// Backend / Mapbox / payment remain out of scope.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const exists = (rel) => {
  try { fs.accessSync(new URL(rel, import.meta.url)); return true; }
  catch { return false; }
};

const contracts = read('../docs/screen-contracts.md');
const appJs = read('../public/src/app.js');
const routerJs = read('../public/src/router.js');
const swJs = read('../public/sw.js');
const orderDetailPath = '../public/src/screens/order_detail.js';
const orderDetailSrc = read(orderDetailPath);

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function sectionBody(source, heading) {
  const start = source.indexOf(heading);
  if (start === -1) return null;
  const after = source.indexOf('\n### ', start + heading.length);
  return after === -1 ? source.slice(start) : source.slice(start, after);
}

function extractRow(src, idToken) {
  const re = new RegExp(`\\|\\s*${idToken}\\s*\\|[^\\n]*`, 'i');
  const m = src.match(re);
  return m ? m[0] : '';
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buttonTextForAction(markup, action) {
  const re = new RegExp(`<button\\b(?=[^>]*\\bdata-action="${escapeRegExp(action)}")[^>]*>([\\s\\S]*?)<\\/button>`, 'i');
  const m = markup.match(re);
  if (!m) return null;
  return m[1].replace(/<[^>]+>/g, '').trim();
}

function renderState(mod, id, role) {
  const order = mod.loadOrder(id);
  const state = mod.resolveState(order, role);
  const markup = mod.renderOrderDetailMarkup({ order, role, state });
  return { order, role, state, markup };
}

// ── A. Contract still carries the locked Model B semantics ────────────
expect('docs/screen-contracts.md references BD-ORDER-DETAIL-01',
  /BD-ORDER-DETAIL-01/.test(contracts));

const section = sectionBody(contracts, '### BD-ORDER-DETAIL-01');
expect('BD-ORDER-DETAIL-01 contract section resolved', !!section);

expect('contract names the /order/<id> deep-link route',
  !!section && /\/order\/(?:<id>|:id|\{id\})/.test(section));
expect('contract states the /order route is registered in app.js',
  !!section && /register\(\s*['"]\/order['"]\s*,\s*orderDetail\s*\)/.test(section));
expect('contract declares passenger + driver role variants',
  !!section && /\bpassenger\b/i.test(section) && /\bdriver\b/i.test(section));
expect('contract pins roleView ∈ {passenger, driver}',
  !!section && /roleView[\s\S]{0,100}passenger[\s\S]{0,60}driver/.test(section));
expect('contract pins passenger role chip «Ваш заказ»',
  !!section && /Ваш\s+заказ/.test(section));
expect('contract pins driver role chip «Просмотр водителя»',
  !!section && /Просмотр\s+водителя/.test(section));
expect('contract names Model B as the chosen semantics',
  !!section && /Model\s+B[\s\S]{0,160}(offer|оффер)[\s\S]{0,160}(confirm|подтверж)/i.test(section));
expect('contract forbids Model A instant accept',
  !!section && /Model\s+A[\s\S]{0,240}(instant|instantly|one-tap|single-tap)/i.test(section));
expect('contract forbids Model C invitation-only',
  !!section && /Model\s+C[\s\S]{0,240}(invitation|invitation-only|passenger\s+invitation)/i.test(section));
expect('contract states a single driver tap must never assign the ride',
  !!section && /single\s+driver\s+tap[\s\S]{0,100}(never|not)[\s\S]{0,60}assign/i.test(section));

const d1Row = extractRow(section || '', 'D1');
expect('D1 driver-available row resolved', d1Row.length > 0);
expect('D1 row carries exact primary CTA «Откликнуться на заказ»',
  d1Row.includes('«Откликнуться на заказ»') && /\(primary\)/i.test(d1Row));
for (const label of ['«Принять»', '«Принять заказ»', '«Забрать заказ»']) {
  expect(`D1 contract row does not carry regression label ${label}`,
    !d1Row.includes(label));
  expect(`contract forbidden list explicitly names ${label}`,
    !!section && new RegExp(`Forbidden[\\s\\S]{0,500}${escapeRegExp(label)}`).test(section));
}

expect('driver CTA creates DriverOffer(status=\'sent\') in the 01D write contract',
  !!section && /DriverOffer\(\s*status\s*=\s*'sent'\s*\)/.test(section));
expect('driver CTA does NOT mutate Order.status to ACCEPTED',
  !!section && /(does[\s*]+not|не[\s*]+должен)[\s*]+(mutate|set|менять)[\s\S]{0,240}Order\.status[\s\S]{0,160}'?ACCEPTED'?/i.test(section));
expect('passenger «Выбрать водителя» commits acceptance',
  !!section && /«Выбрать водителя»[\s\S]{0,240}commits/i.test(section));
expect('passenger commit writes selectedDriverId + canonical ACCEPTED status',
  !!section
  && /Order\.selectedDriverId\s*=\s*offer\.driverId/.test(section)
  && /Order\.status\s*=\s*['"`]ACCEPTED['"`]/.test(section));
expect('contract spells out that «Заказ принят» is UI display/chip only',
  !!section && /«Заказ принят»\s+is\s+UI\s+(display|chip)/i.test(section));
expect('contract never stores the Russian UI label as Order.status',
  !!section && !/Order\.status\s*=\s*['"`«][^'"`»]*Заказ принят/.test(section));
expect('passenger commit rejects only active competing sent offers',
  !!section && /only\s+active\s+competing\s+offers\s+with\s+`?status='sent'`?[\s\S]{0,500}rejected/i.test(section));
expect('passenger commit preserves withdrawn + expired terminal offers',
  !!section
  && /(preserved|verbatim|untouched|stays?)[\s\S]{0,500}status='withdrawn'/i.test(section)
  && /(preserved|verbatim|untouched|stays?)[\s\S]{0,500}status='expired'/i.test(section));
expect('future passenger commit seeds bazardrive.active_ride.v1 with trip_${order.id}',
  !!section
  && /bazardrive\.active_ride\.v1/.test(section)
  && /tripId\s*=\s*trip_\$\{order\.id\}/.test(section));

// ── B. Contract states and terminal affordance pins ──────────────────
const requiredStates = [
  ['P1', /Passenger\s+Own\s+Order\s+Created[\s\S]{0,500}«Ждём водителя»/i],
  ['P2', /Passenger\s+Has\s+Driver\s+Offers[\s\S]{0,500}«Есть предложения»/i],
  ['P3', /Passenger\s+Driver\s+Selected[\s\S]{0,700}«Заказ принят»[\s\S]{0,700}«Открыть поездку»/i],
  ['P4', /Passenger\s+Terminal\s+State[\s\S]{0,500}«Отменён»[\s\S]{0,180}«Истёк»/i],
  ['D1', /Driver\s+Available\s+Order[\s\S]{0,500}«Откликнуться на заказ»/i],
  ['D2', /Driver\s+Offer\s+Sent[\s\S]{0,500}«Оффер отправлен»/i],
  ['D3', /Driver\s+Accepted\s*\/\s*Assigned[\s\S]{0,500}«Заказ принят»/i],
  ['D4', /Driver\s+Locked\s*\/\s*Unavailable[\s\S]{0,500}«Недоступен»/i],
];
for (const [id, re] of requiredStates) {
  expect(`contract enumerates required state ${id}`, !!section && re.test(section));
}

const p4Row = extractRow(section || '', 'P4');
expect('P4 terminal row exposes only terminal exits',
  p4Row.length > 0
  && /Создать\s+новый\s+заказ/.test(p4Row)
  && /Вернуться\s+в\s+ленту/.test(p4Row)
  && !/Откликнуться/.test(p4Row)
  && !/Выбрать\s+водителя/.test(p4Row));
const d4Row = extractRow(section || '', 'D4');
expect('D4 locked row exposes only driver exits',
  d4Row.length > 0
  && /Найти\s+другие\s+заказы/.test(d4Row)
  && /Вернуться\s+в\s+ленту/.test(d4Row)
  && !/Откликнуться/.test(d4Row)
  && !/Выбрать\s+водителя/.test(d4Row));
expect('P1 row pins empty offers state',
  /empty\s+offers\s+state/i.test(extractRow(section || '', 'P1')));
expect('P2 over-budget rule pins «Выше бюджета» when offer.price > order.budget',
  !!section && /offer\.price\s*>\s*order\.budget/.test(section) && /«Выше бюджета»/.test(section));

const s1Row = extractRow(section || '', 'S1');
const s2Row = extractRow(section || '', 'S2');
expect('S1 Loading row pins «Загружаем заказ»',
  s1Row.length > 0 && /Loading/i.test(s1Row) && s1Row.includes('«Загружаем заказ»'));
expect('S2 Error / Not Found row pins «Заказ не найден» and safe exits',
  s2Row.length > 0
  && /Error\s*\/\s*Not\s+Found/i.test(s2Row)
  && s2Row.includes('«Заказ не найден»')
  && /Вернуться\s+в\s+ленту/.test(s2Row)
  && /Найти\s+другие\s+заказы/.test(s2Row)
  && !/Откликнуться/.test(s2Row)
  && !/Выбрать\s+водителя/.test(s2Row)
  && !/Принять/.test(s2Row));

// ── C. Out-of-scope and data-contract anchors stay documented ────────
expect('contract explicitly rules out backend / Mapbox / payment',
  !!section && /No\s+backend\b/i.test(section) && /No\s+Mapbox\b/i.test(section) && /No\s+payment\b/i.test(section));
expect('contract explicitly bans fetch( / api.mapbox.com / token / inline script-style',
  !!section
  && /fetch\(/.test(section)
  && /api\.mapbox\.com/.test(section)
  && /token/i.test(section)
  && /inline\s+(?:<script>|`?<script>`?|script|style)/i.test(section));
expect('Order + DriverOffer data contracts are enumerated',
  !!section
  && /\bOrder\b[\s\S]{0,500}selectedDriverId/.test(section)
  && /\bpassengerId\b/.test(section)
  && /\bbudget\b/.test(section)
  && /\bDriverOffer\b[\s\S]{0,700}orderId[\s\S]{0,500}driverId/.test(section)
  && /\betaMin\b/.test(section));
for (const member of ['sent', 'accepted', 'rejected', 'withdrawn', 'expired']) {
  expect(`DriverOffer status set includes '${member}'`,
    !!section && new RegExp(`['\`]${member}['\`]`).test(section));
}
expect('status language list includes «Истёк»',
  !!section && /Status\s+language[\s\S]{0,1000}[«`"']Истёк[`»"']/i.test(section));
expect('stored-order compatibility maps current mock fields safely',
  !!section
  && /Stored\s+order\s+shape\s+compatibility/i.test(section)
  && /\btime\b[\s\S]{0,240}scheduledAt/.test(section)
  && /\bprice\b[\s\S]{0,120}\bbudget\b[\s\S]{0,240}estimatedPrice/.test(section)
  && /estimatedPriceLabel[\s\S]{0,360}(presentation-only|display-only|display\s+string)/i.test(section)
  && /(must\s+not|never)\s+(?:be\s+)?parse(?:d)?[\s\S]{0,240}number/i.test(section)
  && /\bexpiresAt\b[\s\S]{0,500}(absent|optional)[\s\S]{0,500}(mock|current)/i.test(section)
  && /passenger\.authorId/.test(section)
  && /roleView[\s\S]{0,500}(derived|not\s+stored|never\s+persisted|render-?time)/i.test(section));
expect('Order-store writes table documents driver none + passenger commit',
  !!section
  && /Order-store\s+writes/i.test(section)
  && /Driver[\s\S]{0,500}«Откликнуться на заказ»[\s\S]{0,500}\bNone\b/.test(section)
  && /Passenger[\s\S]{0,500}«Выбрать водителя»[\s\S]{0,500}Order\.selectedDriverId[\s\S]{0,260}Order\.status/.test(section));

// ── D. Runtime wiring: route + file + SW are present ─────────────────
const ORDER_ROUTE_GUARD = /register\(\s*['"]\/order(?:\/|['"]|\?)/;
const GUARD_SHOULD_MATCH = [
  `register('/order', orderDetail);`,
  `register("/order", orderDetail);`,
  `register('/order/:id', orderDetail);`,
  `register("/order/:id", orderDetail);`,
  `register( '/order', orderDetail );`,
  `register(  "/order?role=passenger", orderDetail);`,
];
const GUARD_SHOULD_NOT_MATCH = [
  `register('/orders', ordersList);`,
  `register('/order-map-draft', orderMap);`,
  `register('/feed', feed);`,
];
let guardSelfTestOk = true;
for (const s of GUARD_SHOULD_MATCH) if (!ORDER_ROUTE_GUARD.test(s)) guardSelfTestOk = false;
for (const s of GUARD_SHOULD_NOT_MATCH) if (ORDER_ROUTE_GUARD.test(s)) guardSelfTestOk = false;
expect('route-guard regex self-test', guardSelfTestOk);
expect('public/src/app.js imports and registers orderDetail',
  /import\s+orderDetail\s+from\s+['"]\.\/screens\/order_detail\.js['"]/.test(appJs)
  && ORDER_ROUTE_GUARD.test(appJs));
expect('public/src/screens/order_detail.js is shipped', exists(orderDetailPath));
expect('router.js dispatches /order/<id> to the exact /order loader',
  /startsWith\(\s*['"]\/order\/['"]\s*\)/.test(routerJs)
  && /=\s*['"]\/order['"]/.test(routerJs)
  && /routes\.get\(\s*['"]\/feed['"]\s*\)/.test(routerJs));
expect('public/sw.js precaches order_detail.js and bumps VERSION to v111+',
  /\.\/src\/screens\/order_detail\.js/.test(swJs)
  && Number(swJs.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 111);

// ── E. Runtime module surface + read/render state coverage ───────────
const orderDetailMod = await import(new URL(orderDetailPath, import.meta.url).href);
for (const name of [
  'default',
  'parseOrderHashPath',
  'resolveRoleFromQuery',
  'loadOrder',
  'resolveState',
  'resolveStateChip',
  'renderOrderDetailMarkup',
  'activeSentOffers',
  'ROLE_CHIP',
  'STATE_CHIP',
  'ORDER_STATUS',
  'DRIVER_PRIMARY_CTA',
  'DEMO_ORDERS',
  'SELF_DRIVER_ID',
]) {
  expect(`order_detail.js exports ${name}`, orderDetailMod[name] !== undefined);
}
expect('activeSentOffers is exported as a function',
  typeof orderDetailMod.activeSentOffers === 'function');
expect('default export is a screen loader function', typeof orderDetailMod.default === 'function');
expect('role chips match contract',
  orderDetailMod.ROLE_CHIP.passenger === 'Ваш заказ'
  && orderDetailMod.ROLE_CHIP.driver === 'Просмотр водителя');
expect('canonical accepted enum and UI chip stay separated',
  orderDetailMod.ORDER_STATUS.ACCEPTED === 'ACCEPTED'
  && orderDetailMod.STATE_CHIP.P3 === 'Заказ принят'
  && orderDetailMod.STATE_CHIP.D3 === 'Заказ принят'
  && orderDetailMod.STATE_CHIP.S1 === 'Загружаем заказ'
  && orderDetailMod.STATE_CHIP.S2 === 'Заказ не найден');
expect('DRIVER_PRIMARY_CTA exact label is locked',
  orderDetailMod.DRIVER_PRIMARY_CTA === 'Откликнуться на заказ');

expect('parseOrderHashPath extracts /order/<id> id and query deterministically',
  (() => {
    const parsed = orderDetailMod.parseOrderHashPath('#/order/demo-order-1?role=driver&x=1');
    return parsed.id === 'demo-order-1' && parsed.query.get('role') === 'driver' && parsed.query.get('x') === '1';
  })());
expect('roleView resolver only returns passenger or driver',
  orderDetailMod.resolveRoleFromQuery(new URLSearchParams('role=driver'), {}) === 'driver'
  && orderDetailMod.resolveRoleFromQuery(new URLSearchParams('role=passenger'), {}) === 'passenger'
  && orderDetailMod.resolveRoleFromQuery(new URLSearchParams('role=alien'), { role: 'driver' }) === 'driver'
  && orderDetailMod.resolveRoleFromQuery(new URLSearchParams(''), {}) === 'passenger');

expect('demo-order-1 resolves to P1 passenger and D1 driver',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-1'), 'passenger') === 'P1'
  && orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-1'), 'driver') === 'D1');
expect('demo-order-offers resolves to P2 passenger',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-offers'), 'passenger') === 'P2');
expect('demo-order-accepted resolves to P3 passenger and D3 driver',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-accepted'), 'passenger') === 'P3'
  && orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-accepted'), 'driver') === 'D3');
expect('demo-order-terminal resolves to P4 passenger and D4 driver',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-terminal'), 'passenger') === 'P4'
  && orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-terminal'), 'driver') === 'D4');
expect('demo-order-locked resolves to D4 driver',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-locked'), 'driver') === 'D4');
expect('demo-order-expired resolves to P4 passenger and D4 driver',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-expired'), 'passenger') === 'P4'
  && orderDetailMod.resolveState(orderDetailMod.loadOrder('demo-order-expired'), 'driver') === 'D4');
expect('missing order and loading state resolve to S2 / S1',
  orderDetailMod.resolveState(orderDetailMod.loadOrder('missing-order'), 'passenger') === 'S2'
  && orderDetailMod.resolveState({ __loading: true }, 'passenger') === 'S1');

// ── E1. Malformed /order/<id> deep-link must not crash ──────────────
// `#/order/%E0%A4%A` is a syntactically-valid hash path with an
// invalid percent-encoded id. Raw `decodeURIComponent` throws URIError
// for that token; the runtime must catch and fall through to S2.
{
  const malformedHash = '#/order/%E0%A4%A?role=passenger';
  let malformed = null;
  let threw = false;
  try { malformed = orderDetailMod.parseOrderHashPath(malformedHash); }
  catch { threw = true; }
  expect('parseOrderHashPath does not throw on a malformed id', !threw);
  expect('malformed order id decodes to null instead of throwing',
    !!malformed && malformed.id === null);
  expect('malformed order id query is still parsed',
    !!malformed && malformed.query.get('role') === 'passenger');
  const malformedState = orderDetailMod.resolveState(
    orderDetailMod.loadOrder(malformed && malformed.id),
    'passenger');
  expect('malformed order id resolves to S2', malformedState === 'S2');
  const malformedMarkup = orderDetailMod.renderOrderDetailMarkup({
    order: orderDetailMod.loadOrder(malformed && malformed.id),
    role: 'passenger',
    state: malformedState,
  });
  expect('malformed order id renders S2 «Заказ не найден»',
    malformedMarkup.includes('Заказ не найден'));
  expect('malformed order id S2 markup carries no select-driver CTA',
    !malformedMarkup.includes('Выбрать водителя')
    && !malformedMarkup.includes('Откликнуться'));
}

// ── E2. Active-sent-only P2 — terminal offers don't count as candidates ──
// Codex P2 #459: a passenger order whose only offers are
// `rejected`/`withdrawn`/`expired` must NOT enter P2. Terminal offers
// stay in the data shape (write-side preservation in 01D) but never
// surface as selectable candidates.
{
  const terminalOnly = {
    ...orderDetailMod.loadOrder('demo-order-1'),
    offers: [
      { id: 'expired-offer',   orderId: 'demo-order-1', driverId: 'driver-expired',
        driverName: 'Истёкший водитель', car: 'Test', rating: '4,8',
        etaMin: 5, price: 1000, message: 'expired',
        status: 'expired',   createdAt: 0, expiresAt: 1 },
      { id: 'withdrawn-offer', orderId: 'demo-order-1', driverId: 'driver-withdrawn',
        driverName: 'Отозванный водитель', car: 'Test', rating: '4,7',
        etaMin: 6, price: 900, message: 'withdrawn',
        status: 'withdrawn', createdAt: 0, expiresAt: 1 },
      { id: 'rejected-offer',  orderId: 'demo-order-1', driverId: 'driver-rejected',
        driverName: 'Отклонённый водитель', car: 'Test', rating: '4,6',
        etaMin: 7, price: 950, message: 'rejected',
        status: 'rejected',  createdAt: 0, expiresAt: 1 },
    ],
  };
  expect('terminal-only offers count via activeSentOffers === 0',
    orderDetailMod.activeSentOffers(terminalOnly).length === 0);
  const state = orderDetailMod.resolveState(terminalOnly, 'passenger');
  expect('terminal-only passenger offers resolve to P1, not P2', state === 'P1');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: terminalOnly, role: 'passenger', state });
  expect('terminal-only passenger render exposes no «Выбрать водителя»',
    !markup.includes('Выбрать водителя'));
  expect('terminal-only passenger render shows the empty-offers panel',
    markup.includes('Пока нет предложений'));
  // Terminal driver names must not surface as selectable candidates.
  for (const name of ['Истёкший водитель', 'Отозванный водитель', 'Отклонённый водитель']) {
    expect(`terminal-only passenger render hides terminal candidate "${name}"`,
      !markup.includes(name));
  }
  // Underlying data is still preserved (write-side 01D contract).
  expect('terminal offers are preserved in the order object',
    terminalOnly.offers.length === 3
    && terminalOnly.offers.some((o) => o.status === 'expired')
    && terminalOnly.offers.some((o) => o.status === 'withdrawn')
    && terminalOnly.offers.some((o) => o.status === 'rejected'));
}

// ── E3. Mixed sent + terminal — P2 renders only the sent candidate ──
{
  const mixed = {
    ...orderDetailMod.loadOrder('demo-order-1'),
    offers: [
      { id: 'sent-offer',    orderId: 'demo-order-1', driverId: 'driver-active',
        driverName: 'Активный водитель', car: 'BMW · чёрный', rating: '4,9',
        etaMin: 3, price: 1450, message: 'live',
        status: 'sent',    createdAt: 0, expiresAt: Date.now() + 60_000 },
      { id: 'expired-offer', orderId: 'demo-order-1', driverId: 'driver-expired',
        driverName: 'Истёкший водитель', car: 'Test', rating: '4,8',
        etaMin: 5, price: 1000, message: 'expired',
        status: 'expired', createdAt: 0, expiresAt: 1 },
    ],
  };
  expect('mixed offers: activeSentOffers === 1',
    orderDetailMod.activeSentOffers(mixed).length === 1);
  const state = orderDetailMod.resolveState(mixed, 'passenger');
  expect('mixed offers resolve to P2', state === 'P2');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: mixed, role: 'passenger', state });
  expect('mixed P2 markup includes the live sent driver name',
    markup.includes('Активный водитель'));
  expect('mixed P2 markup does NOT include the expired driver name',
    !markup.includes('Истёкший водитель'));
  expect('mixed P2 markup exposes the «Выбрать водителя» CTA for the sent candidate',
    markup.includes('Выбрать водителя'));
  // Both offer objects stay in the data — only render is filtered.
  expect('mixed data preserves the expired offer for 01D write-side',
    mixed.offers.some((o) => o.id === 'expired-offer' && o.status === 'expired'));
}

{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-1', 'passenger');
  expect('P1 passenger render carries role chip, state chip, empty offers, and four actions',
    state === 'P1'
    && markup.includes('Ваш заказ')
    && markup.includes('Ждём водителя')
    && markup.includes('Пока нет предложений')
    && ['Изменить', 'Отменить заказ', 'Поделиться', 'Скопировать'].every((label) => markup.includes(label))
    && !markup.includes(orderDetailMod.DRIVER_PRIMARY_CTA));
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-offers', 'passenger');
  expect('P2 passenger render carries offers, over-budget badge, and offer actions',
    state === 'P2'
    && markup.includes('Есть предложения')
    && markup.includes('DriverOffer') === false
    && ['Выбрать водителя', 'Написать', 'Отклонить', 'Выше бюджета'].every((label) => markup.includes(label)));
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-accepted', 'passenger');
  expect('P3 passenger render carries accepted chip + open trip action',
    state === 'P3'
    && markup.includes('Заказ принят')
    && buttonTextForAction(markup, 'open-trip') === 'Открыть поездку');
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-terminal', 'passenger');
  expect('P4 passenger terminal render exposes safe exits only',
    state === 'P4'
    && markup.includes('Отменён')
    && markup.includes('Создать новый заказ')
    && markup.includes('Вернуться в ленту')
    && !markup.includes('Откликнуться')
    && !markup.includes('Выбрать водителя')
    && !markup.includes('Принять'));
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-1', 'driver');
  expect('D1 driver render carries driver role chip and exact primary button text',
    state === 'D1'
    && markup.includes('Просмотр водителя')
    && buttonTextForAction(markup, 'driver-send-offer') === orderDetailMod.DRIVER_PRIMARY_CTA);
  for (const label of ['Принять', 'Принять заказ', 'Забрать заказ']) {
    expect(`D1 driver markup never carries bare forbidden regression label ${label}`,
      !markup.includes(label));
  }
}
{
  const seed = orderDetailMod.loadOrder('demo-order-1');
  seed.offers = [{
    id: 'offer-self', orderId: seed.id, driverId: orderDetailMod.SELF_DRIVER_ID,
    driverName: 'Вы', car: 'Test', rating: '5,0', etaMin: 6, price: 1100,
    message: 'Готов выехать', status: 'sent', createdAt: 0, expiresAt: 0,
  }];
  const state = orderDetailMod.resolveState(seed, 'driver');
  const markup = orderDetailMod.renderOrderDetailMarkup({ order: seed, role: 'driver', state });
  expect('D2 driver render works when self has a sent offer',
    state === 'D2'
    && markup.includes('Оффер отправлен')
    && ['Изменить оффер', 'Отозвать оффер', 'Написать'].every((label) => markup.includes(label)));
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-accepted', 'driver');
  expect('D3 driver render carries accepted chip and assigned-driver actions',
    state === 'D3'
    && markup.includes('Заказ принят')
    && ['Начать подачу', 'Открыть активную поездку', 'Написать', 'Отменить'].every((label) => markup.includes(label)));
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-locked', 'driver');
  expect('D4 driver locked render exposes safe exits only',
    state === 'D4'
    && markup.includes('Недоступен')
    && markup.includes('Пассажир выбрал другого водителя')
    && markup.includes('Найти другие заказы')
    && markup.includes('Вернуться в ленту')
    && !markup.includes('Откликнуться')
    && !markup.includes('Выбрать водителя'));
}
{
  const { state, markup } = renderState(orderDetailMod, 'demo-order-expired', 'driver');
  expect('expired order renders as driver D4 and never exposes offer CTA',
    state === 'D4'
    && markup.includes('Недоступен')
    && markup.includes('Заказ истёк')
    && !markup.includes('Откликнуться')
    && !markup.includes('Выбрать водителя')
    && !markup.includes('Принять'));
}
{
  const markup = orderDetailMod.renderOrderDetailMarkup({ order: { __loading: true, id: 'x' }, role: 'passenger', state: 'S1' });
  expect('S1 markup contains loading chip', markup.includes('Загружаем заказ'));
}
{
  const { state, markup } = renderState(orderDetailMod, 'missing-order', 'passenger');
  expect('S2 markup contains not-found chip and safe exits only',
    state === 'S2'
    && markup.includes('Заказ не найден')
    && markup.includes('Вернуться в ленту')
    && markup.includes('Найти другие заказы')
    && !markup.includes('Откликнуться')
    && !markup.includes('Выбрать водителя')
    && !markup.includes('Принять'));
}

// ── F. Runtime source isolation: read/render only, no out-of-scope tech ─
expect('order_detail.js never assigns Russian UI label to Order.status',
  !/Order\.status\s*=\s*['"`«][^'"`»]*Заказ принят/.test(orderDetailSrc));
expect('order_detail.js uses canonical ACCEPTED enum', /['"`]ACCEPTED['"`]/.test(orderDetailSrc));
expect('order_detail.js never calls fetch(', !/\bfetch\s*\(/.test(orderDetailSrc));
expect('order_detail.js never references api.mapbox.com', !/api\.mapbox\.com/i.test(orderDetailSrc));
const orderDetailSrcNoComments = stripComments(orderDetailSrc);
expect('order_detail.js never references a Mapbox access token in code',
  !/mapbox[\s\S]{0,80}token/i.test(orderDetailSrcNoComments)
  && !/accessToken/i.test(orderDetailSrcNoComments));
expect('order_detail.js never emits inline script/style markup',
  !/<script\b/i.test(orderDetailSrc)
  && !/\bstyle\s*=\s*["'][^"']/.test(orderDetailSrc));
expect('order_detail.js still carries deferred-write stub toasts for the non-01D-1 actions',
  /Действие будет подключено в 01D/.test(orderDetailSrc));
// BD-ORDER-DETAIL-01D-1 relaxes the gate on the driver-send-offer path:
// the runtime IS now allowed to persist a DriverOffer for the calling
// driver via the local store. The 01C bans on Order.status and
// selectedDriverId mutations stay in force — only the offer-store
// pinhole opens.
expect('driver-send-offer path never mutates Order.status',
  !/driver-send-offer[\s\S]{0,800}Order\.status\s*=/.test(orderDetailSrc));
expect('driver-send-offer path never mutates selectedDriverId',
  !/driver-send-offer[\s\S]{0,800}selectedDriverId\s*=/.test(orderDetailSrc));
// Window widened to 2400 chars in BD-ORDER-DETAIL-01D-2C-B — the
// 01D-2C-B short-circuit for an existing rejected SELF offer +
// rejectedBy-aware branching sits between the early
// `existing.status === 'sent'` return and the sendDriverOffer call.
expect('driver-send-offer path writes the DriverOffer store (sendDriverOffer)',
  /driver-send-offer[\s\S]{0,2400}sendDriverOffer\s*\(/.test(orderDetailSrc));
expect('withdraw-offer path uses withdrawDriverOffer (no Order/selectedDriverId mutation)',
  /withdraw-offer[\s\S]{0,800}withdrawDriverOffer\s*\(/.test(orderDetailSrc)
  && !/withdraw-offer[\s\S]{0,800}Order\.status\s*=/.test(orderDetailSrc)
  && !/withdraw-offer[\s\S]{0,800}selectedDriverId\s*=/.test(orderDetailSrc));
// BD-ORDER-DETAIL-01D-2B — `saveActiveRide` is now legitimately called
// from the open-trip handoff. The 01D-1 ban relaxes to:
//   • driver-send-offer path never calls saveActiveRide
//   • withdraw-offer path never calls saveActiveRide
//   • select-driver (01D-2A commit) path never calls saveActiveRide
//   • The only saveActiveRide call site is the open-trip handler
//     (gated by canOpenTrip + role === 'passenger', see F4).
expect('driver/withdraw/select-driver paths never seed active_ride (01D-1 + 01D-2A)',
  !/driver-send-offer[\s\S]{0,1000}saveActiveRide\s*\(/.test(orderDetailSrc)
  && !/withdraw-offer[\s\S]{0,1000}saveActiveRide\s*\(/.test(orderDetailSrc)
  && !/action\s*===\s*['"]select-driver['"][\s\S]{0,2500}saveActiveRide\s*\(/.test(orderDetailSrc)
  && !/driver-send-offer[\s\S]{0,1000}updateActiveRideStatus\s*\(/.test(orderDetailSrc)
  && !/withdraw-offer[\s\S]{0,1000}updateActiveRideStatus\s*\(/.test(orderDetailSrc)
  && !/action\s*===\s*['"]select-driver['"][\s\S]{0,2500}updateActiveRideStatus\s*\(/.test(orderDetailSrc));

// ── F1. DriverOffer local store (BD-ORDER-DETAIL-01D-1) ─────────────
// Behavioral round-trip over the new local store: an in-memory
// localStorage shim runs the same module the runtime loads. Pins:
//   • exported API surface, status enum
//   • send is idempotent (same orderId+driverId → same offer, no dup)
//   • send after withdraw re-sends and bumps updatedAt
//   • withdraw flips sent → withdrawn and is itself idempotent
//   • storage key is exactly the contracted bazardrive.driver_offers.v1
//   • clear empties the store
const _bdofs = new Map();
globalThis.localStorage = {
  getItem: (k) => _bdofs.has(k) ? _bdofs.get(k) : null,
  setItem: (k, v) => { _bdofs.set(k, String(v)); },
  removeItem: (k) => { _bdofs.delete(k); },
  clear: () => { _bdofs.clear(); },
};
const driverOfferStore = await import(new URL('../public/src/driver_offer_store.js', import.meta.url).href);
expect('driver_offer_store exports the contracted helpers',
  typeof driverOfferStore.sendDriverOffer === 'function'
  && typeof driverOfferStore.withdrawDriverOffer === 'function'
  && typeof driverOfferStore.getDriverOffer === 'function'
  && typeof driverOfferStore.listDriverOffersForOrder === 'function'
  && typeof driverOfferStore.clearDriverOfferStore === 'function'
  && driverOfferStore.DRIVER_OFFER_STATUS
  && driverOfferStore.DRIVER_OFFER_STATUS.SENT === 'sent'
  && driverOfferStore.DRIVER_OFFER_STATUS.WITHDRAWN === 'withdrawn');
expect('driver_offer_store uses the canonical storage key bazardrive.driver_offers.v1',
  driverOfferStore.DRIVER_OFFERS_STORAGE_KEY === 'bazardrive.driver_offers.v1');

driverOfferStore.clearDriverOfferStore();
const A = driverOfferStore.sendDriverOffer({ orderId: 'order-x', driverId: 'drv-1' });
expect('sendDriverOffer creates a fresh DriverOffer with status=sent',
  !!A && A.status === 'sent' && A.orderId === 'order-x' && A.driverId === 'drv-1'
  && typeof A.id === 'string' && A.id.length > 0
  && typeof A.createdAt === 'string' && A.createdAt.length > 0
  && typeof A.updatedAt === 'string' && A.updatedAt.length > 0);
const A2 = driverOfferStore.sendDriverOffer({ orderId: 'order-x', driverId: 'drv-1' });
expect('repeated sendDriverOffer on the same key is idempotent (no dup, same id, same createdAt)',
  !!A2 && A2.id === A.id && A2.status === 'sent'
  && A2.createdAt === A.createdAt
  && driverOfferStore.listDriverOffersForOrder('order-x').length === 1);
const W = driverOfferStore.withdrawDriverOffer({ orderId: 'order-x', driverId: 'drv-1' });
expect('withdrawDriverOffer flips status to withdrawn and bumps updatedAt',
  !!W && W.status === 'withdrawn' && W.id === A.id && W.createdAt === A.createdAt
  && W.updatedAt !== A.updatedAt);
const Wn = driverOfferStore.withdrawDriverOffer({ orderId: 'order-x', driverId: 'drv-1' });
expect('withdraw on an already-withdrawn offer is idempotent',
  !!Wn && Wn.status === 'withdrawn' && Wn.id === A.id);
const Rs = driverOfferStore.sendDriverOffer({ orderId: 'order-x', driverId: 'drv-1' });
expect('send after withdraw re-sends with status=sent (same id, createdAt preserved)',
  !!Rs && Rs.status === 'sent' && Rs.id === A.id && Rs.createdAt === A.createdAt
  && driverOfferStore.listDriverOffersForOrder('order-x').length === 1);
expect('sendDriverOffer rejects malformed input',
  driverOfferStore.sendDriverOffer({}) === null
  && driverOfferStore.sendDriverOffer({ orderId: '', driverId: 'd' }) === null
  && driverOfferStore.sendDriverOffer({ orderId: 'o', driverId: '' }) === null);
expect('getDriverOffer is read-only and returns the current offer',
  driverOfferStore.getDriverOffer('order-x', 'drv-1')?.status === 'sent'
  && driverOfferStore.getDriverOffer('missing', 'drv-1') === null);

// ── F2. order_detail.js merges stored offers into loadOrder() ──────
driverOfferStore.clearDriverOfferStore();
{
  const base = orderDetailMod.loadOrder('demo-order-1');
  expect('demo-order-1 baseline has no offers before any driver action',
    base.offers.length === 0);
  const sent = driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('sendDriverOffer persists for the SELF driver on demo-order-1', !!sent);
  const after = orderDetailMod.loadOrder('demo-order-1');
  expect('loadOrder merges the stored sent offer into the fixture',
    after.offers.some((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID && o.status === 'sent'));
  expect('driver resolveState moves to D2 with a self-sent stored offer',
    orderDetailMod.resolveState(after, 'driver') === 'D2');
  // Withdraw → back to D1 because the withdrawn offer is no longer a
  // sent candidate and activeSentOffers([…]) === 0.
  driverOfferStore.withdrawDriverOffer({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const after2 = orderDetailMod.loadOrder('demo-order-1');
  expect('after withdraw, the withdrawn offer is preserved in the merged data',
    after2.offers.some((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID && o.status === 'withdrawn'));
  expect('driver resolveState falls back to D1 once the offer is withdrawn',
    orderDetailMod.resolveState(after2, 'driver') === 'D1');
  expect('activeSentOffers excludes the withdrawn offer',
    orderDetailMod.activeSentOffers(after2).length === 0);

  // Sanity — the Order.status / selectedDriverId / tripId fields the
  // contract names as untouchable for this slice are still untouched.
  expect('Order.status is unchanged after send + withdraw',
    after2.status === base.status);
  expect('Order.selectedDriverId is unchanged after send + withdraw',
    after2.selectedDriverId === base.selectedDriverId);
  expect('Order.tripId is unchanged after send + withdraw',
    after2.tripId === base.tripId);
}

// ── F2a. Fresh DriverOffer hydrates renderable D2 fields + driver label ─
// BD-ORDER-DETAIL-01D-1 CI fixup: sendDriverOffer must persist a
// renderable offer so D2/P2 cards aren't empty. The store's hydration
// fields (driverName, car, rating, etaMin, price, message) plus the
// click-handler's order-derived `details.price` together guarantee no
// missing core fields. Test by sending without a `details` override
// (store-only defaults) and inspecting the offer.
{
  driverOfferStore.clearDriverOfferStore();
  const fresh = driverOfferStore.sendDriverOffer({
    orderId: 'render-hydrate-test',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('fresh offer hydrates a non-empty driverName',
    !!fresh && typeof fresh.driverName === 'string' && fresh.driverName.length > 0);
  expect('fresh offer hydrates a non-empty car string',
    !!fresh && typeof fresh.car === 'string' && fresh.car.length > 0);
  expect('fresh offer hydrates a non-empty rating',
    !!fresh && typeof fresh.rating === 'string' && fresh.rating.length > 0);
  expect('fresh offer hydrates a positive numeric etaMin',
    !!fresh && typeof fresh.etaMin === 'number' && fresh.etaMin > 0);
  expect('fresh offer hydrates a positive numeric price',
    !!fresh && typeof fresh.price === 'number' && fresh.price > 0);
}

// ── F2b. After D1 send, D2 markup renders non-empty price / ETA / driver
{
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    details: { price: 1500 }, // mirrors what the click handler passes
  });
  const order = orderDetailMod.loadOrder('demo-order-1');
  const state = orderDetailMod.resolveState(order, 'driver');
  expect('D1 → D2 after send transitions correctly', state === 'D2');
  const markup = orderDetailMod.renderOrderDetailMarkup({ order, role: 'driver', state });
  expect('D2 markup includes the «Оффер отправлен» chip',
    markup.includes('Оффер отправлен'));
  // The D2 summary panel must show the self driver label, a non-empty
  // formatted price, and a non-empty ETA — never bare "  мин" or "★ ".
  expect('D2 markup shows a non-empty self driver label',
    /<strong>[^<]{1,40}<\/strong>/.test(markup) && /Водитель/.test(markup));
  expect('D2 markup shows a formatted price (non-empty)',
    /<strong>[^<]*₽<\/strong>/.test(markup));
  expect('D2 markup shows a non-empty ETA (digit + " мин")',
    /<strong>\d+\s*мин<\/strong>/.test(markup));
}

// ── F2c. Cross-role P2 card for a stored sent offer has safe fields ─
{
  driverOfferStore.clearDriverOfferStore();
  // A peer driver (NOT self) sends an offer → passenger sees P2 with
  // that offer card. The fields must all render with safe non-empty
  // copy or recognised dash fallbacks.
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1',
    driverId: 'peer-driver-1',
  });
  const order = orderDetailMod.loadOrder('demo-order-1');
  expect('peer offer resolves passenger to P2',
    orderDetailMod.resolveState(order, 'passenger') === 'P2');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order, role: 'passenger', state: 'P2' });
  // No empty rating ("★ " with no value), no empty ETA fragment.
  expect('P2 card has no empty rating glyph',
    !/<div class="od-offer__rating">★ <\/div>/.test(markup));
  expect('P2 card has no empty ETA cell',
    !/<span><\/span><span class="od-offer__price">/.test(markup));
  expect('P2 card exposes the «Выбрать водителя» CTA for the peer offer',
    markup.includes('Выбрать водителя'));
}

// ── F2d. Malformed bucket recovery — stale primitive doesn't crash ─
{
  // Pre-seed the store with a malformed bucket — the kind of value a
  // future writer (or a corrupted upgrade) might leave behind. The
  // helpers must recover instead of throwing.
  _bdofs.clear();
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'demo-order-1': 'stale',
    'another-order': 42,
    'array-bucket': [1, 2, 3],
  }));
  let threw = false;
  let result = null;
  try {
    result = driverOfferStore.sendDriverOffer({
      orderId: 'demo-order-1',
      driverId: orderDetailMod.SELF_DRIVER_ID,
    });
  } catch { threw = true; }
  expect('sendDriverOffer does not throw on a malformed string bucket', !threw);
  expect('sendDriverOffer succeeds on a malformed bucket',
    !!result && result.status === 'sent');
  expect('after recovery, listDriverOffersForOrder finds exactly one offer',
    driverOfferStore.listDriverOffersForOrder('demo-order-1').length === 1);
  // Same for a numeric bucket.
  let threw2 = false;
  try {
    driverOfferStore.sendDriverOffer({
      orderId: 'another-order',
      driverId: 'd',
    });
  } catch { threw2 = true; }
  expect('sendDriverOffer does not throw on a malformed numeric bucket', !threw2);
}

// ── F2e. updatedAt is strictly monotonic across send → withdraw ──
{
  driverOfferStore.clearDriverOfferStore();
  const s = driverOfferStore.sendDriverOffer({
    orderId: 'monotonic-test', driverId: 'drv-m',
  });
  const w = driverOfferStore.withdrawDriverOffer({
    orderId: 'monotonic-test', driverId: 'drv-m',
  });
  // Lexicographic compare on ISO 8601 is equivalent to chronological
  // compare. The store must guarantee strict monotonicity even when
  // both calls land in the same millisecond.
  expect('withdraw updatedAt is strictly greater than send updatedAt',
    !!w && w.updatedAt > s.updatedAt);
  // createdAt is preserved verbatim.
  expect('withdraw preserves the original createdAt',
    !!w && w.createdAt === s.createdAt);
}

// ── F2f. Dedup — no duplicate sent offers per (order, driver) ──
{
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.sendDriverOffer({ orderId: 'dedup-test', driverId: 'drv-dup' });
  driverOfferStore.sendDriverOffer({ orderId: 'dedup-test', driverId: 'drv-dup' });
  driverOfferStore.sendDriverOffer({ orderId: 'dedup-test', driverId: 'drv-dup' });
  const list = driverOfferStore.listDriverOffersForOrder('dedup-test');
  expect('repeated sendDriverOffer does not create duplicate offers',
    list.length === 1 && list[0].status === 'sent');
}

// ── F2g. Invariants — no Order.status / selectedDriverId / active_ride
{
  driverOfferStore.clearDriverOfferStore();
  const base = orderDetailMod.loadOrder('demo-order-1');
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  driverOfferStore.withdrawDriverOffer({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const after = orderDetailMod.loadOrder('demo-order-1');
  expect('Order.status unchanged across send/withdraw/re-send', after.status === base.status);
  expect('selectedDriverId unchanged across send/withdraw/re-send',
    after.selectedDriverId === base.selectedDriverId);
  // active_ride store is not seeded — the underlying offer store never
  // writes the key.
  const ar = _bdofs.get('bazardrive.active_ride.v1');
  expect('bazardrive.active_ride.v1 is NOT seeded by the offer store',
    ar === undefined || ar === null);
}

// ── F2h. expiresAt is stamped on every fresh sent offer (01D-1F) ───
// BD-ORDER-DETAIL-01D-1F hardening — Codex flagged the missing TTL on
// fresh DriverOffers. Default: createdAt + 15 minutes. Spec smoke pin.
{
  driverOfferStore.clearDriverOfferStore();
  const fresh = driverOfferStore.sendDriverOffer({
    orderId: 'ttl-test', driverId: 'drv-ttl',
  });
  expect('fresh sent offer carries an expiresAt string',
    !!fresh && typeof fresh.expiresAt === 'string' && fresh.expiresAt.length > 0);
  const created = new Date(fresh.createdAt).getTime();
  const expires = new Date(fresh.expiresAt).getTime();
  expect('expiresAt parses to a finite timestamp', Number.isFinite(expires));
  expect('expiresAt > createdAt', expires > created);
  // 15 minutes ± a small slack window for clock smearing across the
  // bumped stamp.
  const FIFTEEN_MIN = 15 * 60_000;
  expect('expiresAt is approximately createdAt + 15 minutes',
    Math.abs((expires - created) - FIFTEEN_MIN) < 1000,
    `delta=${expires - created} expected≈${FIFTEEN_MIN}`);
}

// ── F2i. Re-send of a withdrawn offer preserves identity + expiresAt ─
{
  driverOfferStore.clearDriverOfferStore();
  const sent = driverOfferStore.sendDriverOffer({
    orderId: 'resend-test', driverId: 'drv-resend',
  });
  const originalExpiresAt = sent.expiresAt;
  const originalCreatedAt = sent.createdAt;
  driverOfferStore.withdrawDriverOffer({
    orderId: 'resend-test', driverId: 'drv-resend',
  });
  const resent = driverOfferStore.sendDriverOffer({
    orderId: 'resend-test', driverId: 'drv-resend',
  });
  expect('re-send flips status back to sent', resent.status === 'sent');
  expect('re-send preserves createdAt', resent.createdAt === originalCreatedAt);
  expect('re-send preserves the original expiresAt when still valid',
    resent.expiresAt === originalExpiresAt);
}

// ── F2j. Re-send backfills expiresAt when the existing one is missing ─
{
  // Pre-seed a withdrawn offer without an expiresAt — this is the
  // shape an upgrade from the pre-hardening store would leave behind.
  _bdofs.clear();
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'backfill-test': {
      'drv-backfill': {
        id: 'offer_backfill-test_drv-backfill',
        orderId: 'backfill-test',
        driverId: 'drv-backfill',
        status: 'withdrawn',
        createdAt: '2026-06-11T08:00:00.000Z',
        updatedAt: '2026-06-11T08:05:00.000Z',
        // no expiresAt
      },
    },
  }));
  const resent = driverOfferStore.sendDriverOffer({
    orderId: 'backfill-test', driverId: 'drv-backfill',
  });
  expect('re-send backfills a missing expiresAt',
    !!resent && typeof resent.expiresAt === 'string' && resent.expiresAt.length > 0);
  // Backfill is anchored to createdAt + 15 min (safer than updatedAt +
  // 15 min — keeps offer lifetime measured from creation).
  const created = new Date(resent.createdAt).getTime();
  const expires = new Date(resent.expiresAt).getTime();
  const FIFTEEN_MIN = 15 * 60_000;
  expect('backfilled expiresAt = createdAt + 15 min',
    Math.abs((expires - created) - FIFTEEN_MIN) < 1000);
}

// ── F2k. Special keys + prototype pollution rejected ─────────────────
// BD-ORDER-DETAIL-01D-1F — `__proto__`, `constructor`, `prototype`
// must never reach a bracket write. Either side of the composite key
// being blocked is enough to fail the call. We also check that the
// store never mutates Object.prototype as a side effect, even when a
// hostile JSON tries to smuggle a polluted bucket.
{
  driverOfferStore.clearDriverOfferStore();
  // Capture a snapshot of Object.prototype before the polluted attempt.
  const protoSnapshot = JSON.stringify(Object.keys(Object.prototype));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    expect(`sendDriverOffer rejects orderId = "${key}"`,
      driverOfferStore.sendDriverOffer({ orderId: key, driverId: 'drv' }) === null);
    expect(`sendDriverOffer rejects driverId = "${key}"`,
      driverOfferStore.sendDriverOffer({ orderId: 'order', driverId: key }) === null);
    expect(`getDriverOffer rejects orderId = "${key}"`,
      driverOfferStore.getDriverOffer(key, 'drv') === null);
    expect(`getDriverOffer rejects driverId = "${key}"`,
      driverOfferStore.getDriverOffer('order', key) === null);
    expect(`listDriverOffersForOrder rejects orderId = "${key}"`,
      driverOfferStore.listDriverOffersForOrder(key).length === 0);
    expect(`withdrawDriverOffer rejects orderId = "${key}"`,
      driverOfferStore.withdrawDriverOffer({ orderId: key, driverId: 'drv' }) === null);
    expect(`withdrawDriverOffer rejects driverId = "${key}"`,
      driverOfferStore.withdrawDriverOffer({ orderId: 'order', driverId: key }) === null);
  }
  // The polluted-JSON smuggle: localStorage carries a "__proto__" key.
  // Our loader copies into a null-proto map and filters via
  // isSafeStoreKey, so the polluted bucket can't reach the store.
  _bdofs.clear();
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    '__proto__': { polluted: true },
    'safe-order': { 'drv-safe': {
      id: 'offer_safe', orderId: 'safe-order', driverId: 'drv-safe',
      status: 'sent', createdAt: '2026-06-11T08:00:00.000Z',
      updatedAt: '2026-06-11T08:00:00.000Z',
    } },
  }));
  // Object.prototype must not have gained a `polluted` field as a
  // side effect of parsing/loading.
  expect('Object.prototype is NOT polluted via JSON __proto__ smuggle',
    Object.prototype.polluted === undefined);
  expect('Object.prototype keys are unchanged after pollution attempt',
    JSON.stringify(Object.keys(Object.prototype)) === protoSnapshot);
  // The "safe-order" bucket is still readable.
  expect('safe entries co-existing with a polluted __proto__ key still load',
    driverOfferStore.getDriverOffer('safe-order', 'drv-safe')?.status === 'sent');
}

// ── F2k2. listDriverOffersForOrder filters bucket-internal blocked keys ─
// BD-ORDER-DETAIL-01D-1F Codex follow-up: the outer `orderId` was
// already gated through `isSafeStoreKey`, but a legacy / corrupted
// bucket can still carry own driverId keys like `__proto__` /
// `constructor` / `prototype`. `getDriverOffer` rejects them on read,
// so `listDriverOffersForOrder` must agree — otherwise the
// `loadOrder()` merge re-surfaces a blocked driverId via the main
// read path.
{
  const protoBefore = JSON.stringify(Object.keys(Object.prototype));
  // Seed a safe order bucket with three blocked driver entries
  // alongside one safe one.
  _bdofs.clear();
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'safe-order': {
      '__proto__':  { id: 'p1', orderId: 'safe-order', driverId: '__proto__',  status: 'sent', createdAt: '2026-06-11T08:00:00.000Z', updatedAt: '2026-06-11T08:00:00.000Z', expiresAt: '2026-06-11T08:15:00.000Z' },
      'constructor':{ id: 'p2', orderId: 'safe-order', driverId: 'constructor',status: 'sent', createdAt: '2026-06-11T08:00:00.000Z', updatedAt: '2026-06-11T08:00:00.000Z', expiresAt: '2026-06-11T08:15:00.000Z' },
      'prototype':  { id: 'p3', orderId: 'safe-order', driverId: 'prototype',  status: 'sent', createdAt: '2026-06-11T08:00:00.000Z', updatedAt: '2026-06-11T08:00:00.000Z', expiresAt: '2026-06-11T08:15:00.000Z' },
      'drv-safe':   { id: 'ok', orderId: 'safe-order', driverId: 'drv-safe',   status: 'sent', createdAt: '2026-06-11T08:00:00.000Z', updatedAt: '2026-06-11T08:00:00.000Z', expiresAt: '2026-06-11T08:15:00.000Z' },
    },
  }));
  const list = driverOfferStore.listDriverOffersForOrder('safe-order');
  expect('listDriverOffersForOrder filters out __proto__ / constructor / prototype driverIds',
    list.length === 1, `got=${list.length}`);
  expect('the single returned offer is the safe driver',
    list.length === 1 && list[0].driverId === 'drv-safe');
  expect('getDriverOffer rejects driverId="__proto__" even inside a safe order bucket',
    driverOfferStore.getDriverOffer('safe-order', '__proto__') === null);
  expect('getDriverOffer rejects driverId="constructor" even inside a safe order bucket',
    driverOfferStore.getDriverOffer('safe-order', 'constructor') === null);
  expect('getDriverOffer rejects driverId="prototype" even inside a safe order bucket',
    driverOfferStore.getDriverOffer('safe-order', 'prototype') === null);
  expect('Object.prototype keys unchanged after bucket-internal blocked-key read',
    JSON.stringify(Object.keys(Object.prototype)) === protoBefore);
  expect('Object.prototype is NOT polluted via bucket-internal __proto__ driver entry',
    Object.prototype.polluted === undefined);
}

// ── F2l. details overlay cannot override canonical identity ──────────
// BD-ORDER-DETAIL-01D-1F — the whitelist accepts only render/edit
// fields. Caller-supplied id, orderId, driverId, status, createdAt,
// updatedAt, expiresAt are silently dropped.
{
  driverOfferStore.clearDriverOfferStore();
  const hostile = driverOfferStore.sendDriverOffer({
    orderId: 'safe-order',
    driverId: 'safe-driver',
    details: {
      id: 'evil',
      orderId: 'evil-order',
      driverId: 'evil-driver',
      status: 'accepted',
      createdAt: 'bad',
      updatedAt: 'bad',
      expiresAt: 'bad',
      price: 777,
      etaMin: 9,
      driverName: 'Тест',
      car: 'Hostile · Test',
      rating: '5,0',
      message: 'hostile message',
    },
  });
  expect('details.id is rejected — id stays the canonical composite id',
    !!hostile && hostile.id === 'offer_safe-order_safe-driver');
  expect('details.orderId is rejected — canonical orderId wins',
    !!hostile && hostile.orderId === 'safe-order');
  expect('details.driverId is rejected — canonical driverId wins',
    !!hostile && hostile.driverId === 'safe-driver');
  expect('details.status is rejected — fresh offer is always sent',
    !!hostile && hostile.status === 'sent');
  expect('details.createdAt is rejected — store-stamped ISO wins',
    !!hostile
    && hostile.createdAt !== 'bad'
    && Number.isFinite(new Date(hostile.createdAt).getTime()));
  expect('details.updatedAt is rejected — store-stamped ISO wins',
    !!hostile
    && hostile.updatedAt !== 'bad'
    && Number.isFinite(new Date(hostile.updatedAt).getTime()));
  expect('details.expiresAt is rejected — store-stamped TTL wins',
    !!hostile
    && hostile.expiresAt !== 'bad'
    && Number.isFinite(new Date(hostile.expiresAt).getTime()));
  // Whitelisted render fields ARE honoured.
  expect('details.price (whitelisted, numeric) is accepted',
    !!hostile && hostile.price === 777);
  expect('details.etaMin (whitelisted, numeric) is accepted',
    !!hostile && hostile.etaMin === 9);
  expect('details.driverName (whitelisted, string) is accepted',
    !!hostile && hostile.driverName === 'Тест');
  expect('details.car (whitelisted, string) is accepted',
    !!hostile && hostile.car === 'Hostile · Test');
  expect('details.message (whitelisted, string) is accepted',
    !!hostile && hostile.message === 'hostile message');
}

// ── F2m. Type validation in the details overlay ─────────────────────
{
  driverOfferStore.clearDriverOfferStore();
  const offer = driverOfferStore.sendDriverOffer({
    orderId: 'type-test', driverId: 'drv-types',
    details: {
      price: -10,                  // negative — must be dropped
      etaMin: 0,                   // not > 0 — must be dropped
      driverName: 42,              // not a string — must be dropped
      car: 'Test Car',             // string — accepted
      rating: 4.5,                 // not a string — must be dropped
      message: '',                 // empty string — accepted (string-typed)
    },
  });
  expect('negative price is rejected — falls back to hydrated default',
    !!offer && offer.price === 1000);
  expect('etaMin = 0 is rejected — falls back to hydrated default',
    !!offer && offer.etaMin === 5);
  expect('non-string driverName is rejected — falls back to hydrated default',
    !!offer && offer.driverName === 'Вы (демо)');
  expect('non-string rating is rejected — falls back to hydrated default',
    !!offer && offer.rating === '5,0');
  expect('valid string car is honoured', !!offer && offer.car === 'Test Car');
}

// ── F2n. withdrawDriverOffer preserves terminal / unknown statuses ──
// Pre-seed offers in every non-sent status. withdraw must NOT
// overwrite their status — only `sent` is overridable.
{
  _bdofs.clear();
  const seeded = {
    'preserve-test': {
      'drv-w': { id: 'a', orderId: 'preserve-test', driverId: 'drv-w', status: 'withdrawn', createdAt: '2026-06-11T08:00:00.000Z', updatedAt: '2026-06-11T08:00:00.000Z', expiresAt: '2026-06-11T08:15:00.000Z' },
      'drv-a': { id: 'b', orderId: 'preserve-test', driverId: 'drv-a', status: 'accepted',  createdAt: '2026-06-11T08:01:00.000Z', updatedAt: '2026-06-11T08:01:00.000Z', expiresAt: '2026-06-11T08:16:00.000Z' },
      'drv-r': { id: 'c', orderId: 'preserve-test', driverId: 'drv-r', status: 'rejected',  createdAt: '2026-06-11T08:02:00.000Z', updatedAt: '2026-06-11T08:02:00.000Z', expiresAt: '2026-06-11T08:17:00.000Z' },
      'drv-e': { id: 'd', orderId: 'preserve-test', driverId: 'drv-e', status: 'expired',   createdAt: '2026-06-11T08:03:00.000Z', updatedAt: '2026-06-11T08:03:00.000Z', expiresAt: '2026-06-11T08:18:00.000Z' },
      'drv-u': { id: 'e', orderId: 'preserve-test', driverId: 'drv-u', status: 'unknown',   createdAt: '2026-06-11T08:04:00.000Z', updatedAt: '2026-06-11T08:04:00.000Z', expiresAt: '2026-06-11T08:19:00.000Z' },
    },
  };
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify(seeded));
  for (const [key, expectedStatus] of [
    ['drv-w', 'withdrawn'], ['drv-a', 'accepted'], ['drv-r', 'rejected'],
    ['drv-e', 'expired'],   ['drv-u', 'unknown'],
  ]) {
    const result = driverOfferStore.withdrawDriverOffer({
      orderId: 'preserve-test', driverId: key,
    });
    expect(`withdraw preserves status='${expectedStatus}'`,
      !!result && result.status === expectedStatus);
    // The store record itself was not mutated.
    expect(`store still reads status='${expectedStatus}' after withdraw call`,
      driverOfferStore.getDriverOffer('preserve-test', key)?.status === expectedStatus);
  }
  // sendDriverOffer on a terminal-status entry is also a no-op.
  for (const [key, expectedStatus] of [
    ['drv-a', 'accepted'], ['drv-r', 'rejected'],
    ['drv-e', 'expired'],  ['drv-u', 'unknown'],
  ]) {
    const result = driverOfferStore.sendDriverOffer({
      orderId: 'preserve-test', driverId: key,
    });
    expect(`sendDriverOffer also preserves terminal status='${expectedStatus}'`,
      !!result && result.status === expectedStatus);
  }
  // Only the withdrawn offer flips back to sent.
  const reSent = driverOfferStore.sendDriverOffer({
    orderId: 'preserve-test', driverId: 'drv-w',
  });
  expect('sendDriverOffer on a withdrawn offer flips it back to sent',
    !!reSent && reSent.status === 'sent');
}

// ── F3a–F3j. Passenger commit (BD-ORDER-DETAIL-01D-2A) ──────────────
// Passenger «Выбрать водителя» local commit. Verifies the atomic
// multi-write: order overlay (status='ACCEPTED' + selectedDriverId),
// chosen offer → 'accepted', competing sent offers → 'rejected',
// terminal offers preserved verbatim, no active_ride seed.

expect('driver_offer_store.js exports commitPassengerSelection',
  typeof driverOfferStore.commitPassengerSelection === 'function');
expect('driver_offer_store.js exports getOrderOverlay',
  typeof driverOfferStore.getOrderOverlay === 'function');
expect('driver_offer_store.js exports clearOrderOverlayStore',
  typeof driverOfferStore.clearOrderOverlayStore === 'function');

// Helper to seed an order with a known offer mix for the commit tests.
function seedOrderWithOffers(orderId, offers) {
  _bdofs.clear();
  const bucket = {};
  for (const o of offers) bucket[o.driverId] = o;
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({ [orderId]: bucket }));
}

function mkOffer(orderId, driverId, status, extra = {}) {
  return {
    id: `offer_${orderId}_${driverId}`,
    orderId,
    driverId,
    driverName: `Водитель ${driverId}`,
    car: 'Demo · Test',
    rating: '5,0',
    etaMin: 5,
    price: 1000,
    message: 'mock',
    status,
    createdAt: '2026-06-11T08:00:00.000Z',
    updatedAt: '2026-06-11T08:00:00.000Z',
    expiresAt: '2026-06-11T08:15:00.000Z',
    ...extra,
  };
}

// ── F3a — passenger can select a sent offer ─────────────────────────
{
  seedOrderWithOffers('commit-test-a', [mkOffer('commit-test-a', 'drv-a1', 'sent')]);
  const all = driverOfferStore.listDriverOffersForOrder('commit-test-a');
  const accepted = driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-a',
    selectedDriverId: 'drv-a1',
    allOffers: all,
  });
  expect('F3a — commitPassengerSelection returns the accepted offer',
    !!accepted && accepted.driverId === 'drv-a1' && accepted.status === 'accepted');
}

// ── F3b — selected order becomes ACCEPTED ───────────────────────────
{
  seedOrderWithOffers('commit-test-b', [mkOffer('commit-test-b', 'drv-b1', 'sent')]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-b',
    selectedDriverId: 'drv-b1',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-b'),
  });
  const overlay = driverOfferStore.getOrderOverlay('commit-test-b');
  expect('F3b — order overlay writes status="ACCEPTED"',
    !!overlay && overlay.status === 'ACCEPTED');
}

// ── F3c — selectedDriverId is written from chosen offer.driverId ────
{
  seedOrderWithOffers('commit-test-c', [mkOffer('commit-test-c', 'drv-c-target', 'sent')]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-c',
    selectedDriverId: 'drv-c-target',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-c'),
  });
  const overlay = driverOfferStore.getOrderOverlay('commit-test-c');
  expect('F3c — order overlay writes selectedDriverId from chosen offer',
    !!overlay && overlay.selectedDriverId === 'drv-c-target');
}

// ── F3d — chosen offer becomes accepted ─────────────────────────────
{
  seedOrderWithOffers('commit-test-d', [mkOffer('commit-test-d', 'drv-d1', 'sent')]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-d',
    selectedDriverId: 'drv-d1',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-d'),
  });
  const after = driverOfferStore.getDriverOffer('commit-test-d', 'drv-d1');
  expect('F3d — chosen offer status flips to "accepted"',
    !!after && after.status === 'accepted');
}

// ── F3e — competing sent offers become rejected ─────────────────────
{
  seedOrderWithOffers('commit-test-e', [
    mkOffer('commit-test-e', 'drv-e-target', 'sent'),
    mkOffer('commit-test-e', 'drv-e-peer1',  'sent'),
    mkOffer('commit-test-e', 'drv-e-peer2',  'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-e',
    selectedDriverId: 'drv-e-target',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-e'),
  });
  const peer1 = driverOfferStore.getDriverOffer('commit-test-e', 'drv-e-peer1');
  const peer2 = driverOfferStore.getDriverOffer('commit-test-e', 'drv-e-peer2');
  expect('F3e — every competing sent offer flips to "rejected"',
    !!peer1 && peer1.status === 'rejected'
    && !!peer2 && peer2.status === 'rejected');
}

// ── F3f — withdrawn offer cannot be selected and remains withdrawn ──
{
  seedOrderWithOffers('commit-test-f', [
    mkOffer('commit-test-f', 'drv-f-target', 'sent'),
    mkOffer('commit-test-f', 'drv-f-with',   'withdrawn'),
  ]);
  // Attempt to select the withdrawn offer — must fail.
  const reject1 = driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-f',
    selectedDriverId: 'drv-f-with',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-f'),
  });
  expect('F3f — selecting a withdrawn offer returns null',
    reject1 === null);
  expect('F3f — withdrawn offer remains withdrawn after the failed select',
    driverOfferStore.getDriverOffer('commit-test-f', 'drv-f-with')?.status === 'withdrawn');
  // Now commit the actual sent target. The peer withdrawn must stay
  // withdrawn — terminal preservation across a successful commit.
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-f',
    selectedDriverId: 'drv-f-target',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-f'),
  });
  expect('F3f — terminal withdrawn offer is preserved through a peer commit',
    driverOfferStore.getDriverOffer('commit-test-f', 'drv-f-with')?.status === 'withdrawn');
}

// ── F3g — expired offer cannot be selected and remains expired ──────
{
  seedOrderWithOffers('commit-test-g', [
    mkOffer('commit-test-g', 'drv-g-target', 'sent'),
    mkOffer('commit-test-g', 'drv-g-exp',    'expired'),
  ]);
  const reject1 = driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-g',
    selectedDriverId: 'drv-g-exp',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-g'),
  });
  expect('F3g — selecting an expired offer returns null', reject1 === null);
  expect('F3g — expired offer remains expired after the failed select',
    driverOfferStore.getDriverOffer('commit-test-g', 'drv-g-exp')?.status === 'expired');
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-g',
    selectedDriverId: 'drv-g-target',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-g'),
  });
  expect('F3g — terminal expired offer is preserved through a peer commit',
    driverOfferStore.getDriverOffer('commit-test-g', 'drv-g-exp')?.status === 'expired');
}

// ── F3h — rejected offer cannot be selected and remains rejected ────
{
  seedOrderWithOffers('commit-test-h', [
    mkOffer('commit-test-h', 'drv-h-target', 'sent'),
    mkOffer('commit-test-h', 'drv-h-rej',    'rejected'),
  ]);
  const reject1 = driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-h',
    selectedDriverId: 'drv-h-rej',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-h'),
  });
  expect('F3h — selecting a rejected offer returns null', reject1 === null);
  expect('F3h — rejected offer remains rejected after the failed select',
    driverOfferStore.getDriverOffer('commit-test-h', 'drv-h-rej')?.status === 'rejected');
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-h',
    selectedDriverId: 'drv-h-target',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-h'),
  });
  expect('F3h — terminal rejected offer is preserved through a peer commit',
    driverOfferStore.getDriverOffer('commit-test-h', 'drv-h-rej')?.status === 'rejected');
}

// ── F3i — malformed / foreign offers cannot be selected ─────────────
{
  seedOrderWithOffers('commit-test-i', [
    mkOffer('commit-test-i', 'drv-i-sent', 'sent'),
  ]);
  // Foreign orderId on the supplied offer — the offer claims to belong
  // to a different order than the one we're committing.
  const foreign = [
    mkOffer('OTHER-ORDER', 'drv-i-sent', 'sent'),
  ];
  expect('F3i — selecting an offer with foreign orderId returns null',
    driverOfferStore.commitPassengerSelection({
      orderId: 'commit-test-i',
      selectedDriverId: 'drv-i-sent',
      allOffers: foreign,
    }) === null);
  // Blocked driverId on either side of the composite key.
  expect('F3i — selecting via __proto__ driverId returns null',
    driverOfferStore.commitPassengerSelection({
      orderId: 'commit-test-i',
      selectedDriverId: '__proto__',
      allOffers: [mkOffer('commit-test-i', '__proto__', 'sent')],
    }) === null);
  expect('F3i — selecting via __proto__ orderId returns null',
    driverOfferStore.commitPassengerSelection({
      orderId: '__proto__',
      selectedDriverId: 'drv',
      allOffers: [mkOffer('__proto__', 'drv', 'sent')],
    }) === null);
  // Malformed inputs.
  expect('F3i — null allOffers returns null',
    driverOfferStore.commitPassengerSelection({
      orderId: 'commit-test-i',
      selectedDriverId: 'drv-i-sent',
      allOffers: null,
    }) === null);
  expect('F3i — missing target driver returns null',
    driverOfferStore.commitPassengerSelection({
      orderId: 'commit-test-i',
      selectedDriverId: 'drv-i-not-present',
      allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-i'),
    }) === null);
  // The original sent offer must still be sent after every rejection.
  expect('F3i — sent target is untouched after every failed selection attempt',
    driverOfferStore.getDriverOffer('commit-test-i', 'drv-i-sent')?.status === 'sent');
  // Order.status must not have been written by any failed attempt.
  expect('F3i — no order overlay write happens for failed selections',
    driverOfferStore.getOrderOverlay('commit-test-i') === null);
}

// ── F3j — no active_ride seed is written in 01D-2A ──────────────────
{
  _bdofs.clear();
  // Run a successful commit and check that the active_ride key is
  // never touched by either the store or the click-handler path.
  seedOrderWithOffers('commit-test-j', [
    mkOffer('commit-test-j', 'drv-j', 'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'commit-test-j',
    selectedDriverId: 'drv-j',
    allOffers: driverOfferStore.listDriverOffersForOrder('commit-test-j'),
  });
  expect('F3j — bazardrive.active_ride.v1 is NOT seeded by commitPassengerSelection',
    !_bdofs.has('bazardrive.active_ride.v1'));
  // Source-level guard on order_detail.js: the select-driver handler
  // path must never call saveActiveRide / updateActiveRideStatus, and
  // must never write the active_ride.v1 key.
  // BD-ORDER-DETAIL-01D-2B — anchor the scan on the click-handler
  // `action === 'select-driver'` check so the offerCard markup
  // mention of the action token doesn't drag in the unrelated
  // open-trip saveActiveRide call elsewhere in the file.
  expect('F3j — order_detail.js select-driver handler path never seeds active_ride',
    !/action\s*===\s*['"]select-driver['"][\s\S]{0,2500}saveActiveRide\s*\(/.test(orderDetailSrc)
    && !/action\s*===\s*['"]select-driver['"][\s\S]{0,2500}updateActiveRideStatus\s*\(/.test(orderDetailSrc)
    && !/action\s*===\s*['"]select-driver['"][\s\S]{0,2500}active_ride\.v1/.test(orderDetailSrc));
  const offerStoreSrcInline = read('../public/src/driver_offer_store.js');
  // Strip comments before the active_ride scan so the "deliberately
  // does NOT seed bazardrive.active_ride.v1" disclaimer in the
  // commitPassengerSelection JSDoc isn't a false positive.
  const offerStoreCode = stripComments(offerStoreSrcInline);
  expect('F3j — driver_offer_store.js never seeds active_ride (code-only)',
    !/saveActiveRide\s*\(/.test(offerStoreCode)
    && !/updateActiveRideStatus\s*\(/.test(offerStoreCode)
    && !/active_ride\.v1/.test(offerStoreCode));
}

// ── F3k — loadOrder applies the overlay → passenger sees P3 ──────────
// Smoke-level integration check: a successful commit on demo-order-offers
// (which fixture-ships two sent offers) flips the merged Order to
// status='ACCEPTED' + selectedDriverId, and the passenger resolveState
// lands on P3.
{
  driverOfferStore.clearDriverOfferStore();
  const before = orderDetailMod.loadOrder('demo-order-offers');
  expect('F3k baseline — demo-order-offers passenger sees P2 before commit',
    orderDetailMod.resolveState(before, 'passenger') === 'P2');
  const target = before.offers.find((o) => o.status === 'sent');
  expect('F3k baseline — at least one sent fixture offer is present', !!target);
  driverOfferStore.commitPassengerSelection({
    orderId: 'demo-order-offers',
    selectedDriverId: target.driverId,
    allOffers: before.offers,
  });
  const after = orderDetailMod.loadOrder('demo-order-offers');
  expect('F3k — after commit, merged Order.status is "ACCEPTED"',
    after.status === 'ACCEPTED');
  expect('F3k — after commit, merged Order.selectedDriverId mirrors the chosen offer',
    after.selectedDriverId === target.driverId);
  expect('F3k — passenger resolveState lands on P3 after commit',
    orderDetailMod.resolveState(after, 'passenger') === 'P3');
}

// ── F3l — stale sent snapshot cannot accept terminal stored target ───
// Codex review on PR #464: an old passenger tab can hold an
// `allOffers` snapshot where the target offer still claims
// status='sent', even though the store has since flipped that same
// offer to withdrawn / rejected / expired (e.g. driver withdrew in
// another tab, or a 01D-2C reject mutation landed). The stored
// baseline is the source of truth; the commit must refuse and leave
// the terminal stored offer + every peer verbatim.
for (const terminalStatus of ['withdrawn', 'rejected', 'expired']) {
  const orderId = `commit-test-l-${terminalStatus}`;
  const driverId = `drv-l-${terminalStatus}`;

  // The STORE carries a terminal offer for the target driver.
  seedOrderWithOffers(orderId, [
    mkOffer(orderId, driverId, terminalStatus),
  ]);

  // The CALLER passes a stale snapshot still claiming the same offer
  // is sent.
  const staleAllOffers = [
    mkOffer(orderId, driverId, 'sent'),
  ];

  const result = driverOfferStore.commitPassengerSelection({
    orderId,
    selectedDriverId: driverId,
    allOffers: staleAllOffers,
  });

  expect(`F3l — stale sent snapshot over stored ${terminalStatus} returns null`,
    result === null);
  expect(`F3l — stored ${terminalStatus} target remains terminal after stale select`,
    driverOfferStore.getDriverOffer(orderId, driverId)?.status === terminalStatus);
  expect(`F3l — no order overlay is written for stale ${terminalStatus} target`,
    driverOfferStore.getOrderOverlay(orderId) === null);
}

// F3l second pass — when a peer's stored baseline has gone terminal
// since the snapshot was captured, the peer must be preserved
// verbatim (not rewritten to 'rejected'). A legitimately-sent target
// in the same commit still goes through.
{
  const orderId = 'commit-test-l-peer';
  seedOrderWithOffers(orderId, [
    mkOffer(orderId, 'drv-l-target', 'sent'),
    mkOffer(orderId, 'drv-l-peer-withdrawn', 'withdrawn'),
    mkOffer(orderId, 'drv-l-peer-expired',   'expired'),
    mkOffer(orderId, 'drv-l-peer-rejected',  'rejected'),
  ]);
  const stalePeers = [
    mkOffer(orderId, 'drv-l-target',           'sent'),
    // Snapshot still thinks these peers are sent even though the
    // store has them as terminal.
    mkOffer(orderId, 'drv-l-peer-withdrawn',   'sent'),
    mkOffer(orderId, 'drv-l-peer-expired',     'sent'),
    mkOffer(orderId, 'drv-l-peer-rejected',    'sent'),
  ];
  const ok = driverOfferStore.commitPassengerSelection({
    orderId,
    selectedDriverId: 'drv-l-target',
    allOffers: stalePeers,
  });
  expect('F3l peer — legitimate sent target still commits when peers are stale',
    !!ok && ok.status === 'accepted' && ok.driverId === 'drv-l-target');
  expect('F3l peer — stale-snapshot withdrawn peer stays withdrawn',
    driverOfferStore.getDriverOffer(orderId, 'drv-l-peer-withdrawn')?.status === 'withdrawn');
  expect('F3l peer — stale-snapshot expired peer stays expired',
    driverOfferStore.getDriverOffer(orderId, 'drv-l-peer-expired')?.status === 'expired');
  expect('F3l peer — stale-snapshot rejected peer stays rejected',
    driverOfferStore.getDriverOffer(orderId, 'drv-l-peer-rejected')?.status === 'rejected');
  expect('F3l peer — order overlay still writes for the legitimate commit',
    driverOfferStore.getOrderOverlay(orderId)?.status === 'ACCEPTED');
}

// ── F4a–F4j. Passenger active-ride handoff (BD-ORDER-DETAIL-01D-2B) ──
// «Открыть поездку» on P3 builds an active_ride seed and writes it to
// `bazardrive.active_ride.v1` BEFORE navigating to /active-ride. Until
// the CTA is tapped no active-ride write happens — the 01D-2A select
// commit alone NEVER seeds active_ride.

const rideState = await import(new URL('../public/src/ride_state.js', import.meta.url).href);
const ACTIVE_RIDE_STORE_KEY = 'bazardrive.active_ride.v1';

expect('order_detail.js exports canOpenTrip',
  typeof orderDetailMod.canOpenTrip === 'function');
expect('order_detail.js exports buildPassengerActiveRideSeed',
  typeof orderDetailMod.buildPassengerActiveRideSeed === 'function');

// Helper to build a synthetic accepted order with an `accepted` offer
// matching `selectedDriverId`. Mirrors what loadOrder() returns after a
// successful 01D-2A commit + overlay merge.
function mkAcceptedOrder(orderId, selectedDriverId, overrides = {}) {
  return {
    id: orderId,
    status: 'ACCEPTED',
    selectedDriverId,
    pickup: 'ул. Тестовая, 1',
    dropoff: 'Аэропорт',
    time: 'Сегодня, 15:00',
    passengerName: 'Иван П.',
    budget: 1200,
    comment: 'Test',
    offers: [
      mkOffer(orderId, selectedDriverId, 'accepted', { price: 1100 }),
    ],
    ...overrides,
  };
}

// ── F4a — select driver alone NEVER writes active_ride.v1 ───────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('handoff-test-a', [mkOffer('handoff-test-a', 'drv-a', 'sent')]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'handoff-test-a',
    selectedDriverId: 'drv-a',
    allOffers: driverOfferStore.listDriverOffersForOrder('handoff-test-a'),
  });
  expect('F4a — 01D-2A commit alone NEVER writes bazardrive.active_ride.v1',
    !_bdofs.has(ACTIVE_RIDE_STORE_KEY));
}

// ── F4b — canOpenTrip = true ONLY when post-commit state is reached ──
{
  expect('F4b — accepted order with accepted self-offer satisfies canOpenTrip',
    orderDetailMod.canOpenTrip(mkAcceptedOrder('o', 'drv-x')) === true);
  expect('F4b — accepted order with sent self-offer also satisfies canOpenTrip',
    orderDetailMod.canOpenTrip({
      ...mkAcceptedOrder('o', 'drv-x'),
      offers: [mkOffer('o', 'drv-x', 'sent')],
    }) === true);
}

// ── F4c — CTA disabled when selectedDriverId is missing ─────────────
{
  expect('F4c — order with status=ACCEPTED but no selectedDriverId fails canOpenTrip',
    orderDetailMod.canOpenTrip({
      ...mkAcceptedOrder('o', 'drv-x'),
      selectedDriverId: null,
    }) === false);
  expect('F4c — order with empty-string selectedDriverId fails canOpenTrip',
    orderDetailMod.canOpenTrip({
      ...mkAcceptedOrder('o', 'drv-x'),
      selectedDriverId: '',
    }) === false);
}

// ── F4d — CTA disabled when selected offer is missing ───────────────
{
  expect('F4d — order with selectedDriverId pointing at no offer fails canOpenTrip',
    orderDetailMod.canOpenTrip({
      ...mkAcceptedOrder('o', 'drv-target'),
      offers: [mkOffer('o', 'drv-other', 'accepted')],
    }) === false);
  expect('F4d — order with no offers at all fails canOpenTrip',
    orderDetailMod.canOpenTrip({
      ...mkAcceptedOrder('o', 'drv-target'),
      offers: [],
    }) === false);
}

// ── F4e — CTA disabled when selected offer is stale (terminal) ──────
for (const stale of ['withdrawn', 'expired', 'rejected']) {
  expect(`F4e — selected offer with status='${stale}' fails canOpenTrip`,
    orderDetailMod.canOpenTrip({
      ...mkAcceptedOrder('o', 'drv-x'),
      offers: [mkOffer('o', 'drv-x', stale)],
    }) === false);
}
// Non-accepted order is also a fail regardless of the selected offer.
expect('F4e — order.status != ACCEPTED fails canOpenTrip',
  orderDetailMod.canOpenTrip({
    ...mkAcceptedOrder('o', 'drv-x'),
    status: 'CREATED',
  }) === false);

// ── F4f — building the seed does not mutate terminal offers ─────────
{
  driverOfferStore.clearDriverOfferStore();
  // Pre-seed an order whose merged offers include the selected accepted
  // offer plus a withdrawn peer. The seed builder must read but never
  // write — terminal offers stay exactly as they were before / after.
  const orderId = 'handoff-test-f';
  seedOrderWithOffers(orderId, [
    mkOffer(orderId, 'drv-target',        'accepted'),
    mkOffer(orderId, 'drv-peer-withdrawn','withdrawn'),
    mkOffer(orderId, 'drv-peer-expired',  'expired'),
  ]);
  // Plant an overlay so the merged order reports status=ACCEPTED +
  // selectedDriverId — same shape loadOrder() produces.
  _bdofs.set('bazardrive.order_overlay.v1', JSON.stringify({
    [orderId]: { status: 'ACCEPTED', selectedDriverId: 'drv-target',
      updatedAt: '2026-06-11T08:00:00.000Z' },
  }));
  const merged = {
    id: orderId,
    status: 'ACCEPTED',
    selectedDriverId: 'drv-target',
    passengerName: 'Test',
    pickup: 'A', dropoff: 'B', time: 'now',
    budget: 1000, comment: '',
    offers: driverOfferStore.listDriverOffersForOrder(orderId),
  };
  const seed = orderDetailMod.buildPassengerActiveRideSeed(merged);
  expect('F4f — seed builder returns a non-null seed for a valid order',
    !!seed);
  expect('F4f — terminal withdrawn peer still withdrawn after seed build',
    driverOfferStore.getDriverOffer(orderId, 'drv-peer-withdrawn')?.status === 'withdrawn');
  expect('F4f — terminal expired peer still expired after seed build',
    driverOfferStore.getDriverOffer(orderId, 'drv-peer-expired')?.status === 'expired');
}

// ── F4g — seed snapshot carries every required field ────────────────
{
  const orderId = 'handoff-test-g';
  const order = mkAcceptedOrder(orderId, 'drv-g', {
    passengerName: 'Анна М.',
    pickup: 'ул. Малая Бронная, 28',
    dropoff: 'Шереметьево',
    budget: 1500,
  });
  // Inject driver / price fields onto the accepted offer.
  order.offers = [mkOffer(orderId, 'drv-g', 'accepted', {
    driverName: 'Рустам К.',
    car: 'Toyota Camry · серый',
    rating: '4,92',
    etaMin: 5,
    price: 1450,
  })];
  const seed = orderDetailMod.buildPassengerActiveRideSeed(order);
  expect('F4g — seed.tripId is derived from orderId when not set',
    !!seed && seed.tripId === `trip_${orderId}`);
  expect('F4g — seed.orderId carries the source order id',
    !!seed && seed.orderId === orderId);
  expect('F4g — seed.role === "passenger"', !!seed && seed.role === 'passenger');
  expect('F4g — seed.selectedDriverId mirrors the chosen offer driverId',
    !!seed && seed.selectedDriverId === 'drv-g');
  expect('F4g — seed.selectedOfferId mirrors the chosen offer id',
    !!seed && seed.selectedOfferId === order.offers[0].id);
  expect('F4g — seed.status is a passenger-supported RIDE_STATUS',
    !!seed && (seed.status === rideState.RIDE_STATUS.ACCEPTED
            || seed.status === rideState.RIDE_STATUS.DRIVER_EN_ROUTE));
  expect('F4g — seed.passenger.name comes from order.passengerName',
    !!seed && seed.passenger.name === 'Анна М.');
  expect('F4g — seed.driver.name comes from the chosen offer.driverName',
    !!seed && seed.driver.name === 'Рустам К.');
  expect('F4g — seed.driver.car comes from the chosen offer.car',
    !!seed && seed.driver.car === 'Toyota Camry · серый');
  expect('F4g — seed.vehicle is present (model from offer.car)',
    !!seed && typeof seed.vehicle === 'object'
    && seed.vehicle.model === 'Toyota Camry · серый');
  expect('F4g — seed.route carries pickup/dropoff from the order',
    !!seed && seed.route.pickupLabel === 'ул. Малая Бронная, 28'
    && seed.route.dropoffLabel === 'Шереметьево');
  expect('F4g — seed.order.offerPrice is formatted from the chosen offer price',
    !!seed && typeof seed.order.offerPrice === 'string'
    && seed.order.offerPrice.length > 0);
  expect('F4g — seed.payment.amount is formatted from the order budget / offer price',
    !!seed && typeof seed.payment.amount === 'string'
    && seed.payment.amount.length > 0);
  expect('F4g — seed.seededFrom marks the Order Detail handoff source',
    !!seed && seed.seededFrom === 'order_detail_passenger_handoff');
}

// ── F4h — seed round-trip via ride_state.saveActiveRide ─────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const orderId = 'handoff-test-h';
  const order = mkAcceptedOrder(orderId, 'drv-h');
  const seed = orderDetailMod.buildPassengerActiveRideSeed(order);
  // Simulate the click-handler path: idempotent saveActiveRide.
  rideState.saveActiveRide(seed);
  const persisted = rideState.findActiveRide(seed.tripId);
  expect('F4h — saveActiveRide round-trip surfaces the seeded ride',
    !!persisted
    && persisted.tripId === seed.tripId
    && persisted.orderId === orderId
    && persisted.selectedDriverId === 'drv-h');
  // bazardrive.active_ride.v1 is now written — this is the ONLY place
  // 01D-2B touches that key.
  expect('F4h — bazardrive.active_ride.v1 is written by the handoff seed',
    _bdofs.has(ACTIVE_RIDE_STORE_KEY));
}

// ── F4i — click handler routes to /active-ride?role=passenger&tripId= ─
expect('F4i — open-trip handler navigates to /active-ride?role=passenger&tripId=',
  /open-trip[\s\S]{0,2500}go\(`\/active-ride\?role=passenger&tripId=\$\{encodeURIComponent\(seed\.tripId\)\}`\)/.test(orderDetailSrc));

// ── F4j — open-trip handler is gated and never seeds without canOpenTrip ─
// Source-level guards: handler must check role === 'passenger', call
// canOpenTrip, build seed, persist via saveActiveRide, then navigate.
expect('F4j — open-trip handler gates on role === passenger',
  /open-trip[\s\S]{0,1500}role\s*!==\s*['"]passenger['"]/.test(orderDetailSrc));
expect('F4j — open-trip handler calls canOpenTrip before building the seed',
  /open-trip[\s\S]{0,1500}canOpenTrip\(/.test(orderDetailSrc));
expect('F4j — open-trip handler calls buildPassengerActiveRideSeed',
  /open-trip[\s\S]{0,1500}buildPassengerActiveRideSeed\(/.test(orderDetailSrc));
expect('F4j — open-trip handler is the only place saveActiveRide is called',
  /open-trip[\s\S]{0,2000}saveActiveRide\(/.test(orderDetailSrc));
expect('F4j — open-trip handler is idempotent via findActiveRide guard',
  /findActiveRide\(\s*seed\.tripId\s*\)/.test(orderDetailSrc));
// Defensive: open-trip handler must NOT call commitPassengerSelection
// or any of the 01D-2A overlay mutators.
expect('F4j — open-trip handler never calls commitPassengerSelection',
  !/open-trip[\s\S]{0,2000}commitPassengerSelection\(/.test(orderDetailSrc));
// driver-send-offer / withdraw-offer / select-driver paths never call
// saveActiveRide.
expect('F4j — driver-send-offer path never calls saveActiveRide',
  !/driver-send-offer[\s\S]{0,1000}saveActiveRide\(/.test(orderDetailSrc));
expect('F4j — withdraw-offer path never calls saveActiveRide',
  !/withdraw-offer[\s\S]{0,1000}saveActiveRide\(/.test(orderDetailSrc));
expect('F4j — select-driver handler path never calls saveActiveRide',
  !/action\s*===\s*['"]select-driver['"][\s\S]{0,2500}saveActiveRide\(/.test(orderDetailSrc));

// ── F4k — no new Mapbox / backend / payment strings introduced ──────
{
  const orderDetailNoComments = stripComments(orderDetailSrc);
  expect('F4k — order_detail.js still has no fetch( calls',
    !/\bfetch\s*\(/.test(orderDetailNoComments));
  expect('F4k — order_detail.js still has no mapbox references',
    !/mapbox/i.test(orderDetailNoComments));
  expect('F4k — order_detail.js still has no api.mapbox.com',
    !/api\.mapbox\.com/.test(orderDetailNoComments));
  expect('F4k — order_detail.js carries no card / charge payment strings',
    !/<input[^>]*\btype=["']?card["']?/i.test(orderDetailNoComments));
}

// ── F4l — P3 markup disables «Открыть поездку» when canOpenTrip fails ─
{
  // Simulate a P3 render with an ineligible order: status=ACCEPTED but
  // no selectedDriverId. The bodyP3 path should render the CTA with the
  // disabled attribute on the button so a stray click can't fire.
  const ineligible = {
    id: 'render-test-p3',
    status: 'ACCEPTED',
    selectedDriverId: null,
    passengerName: 'Test',
    pickup: 'A', dropoff: 'B', time: 'now',
    budget: 1000, comment: '',
    offers: [],
  };
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: ineligible, role: 'passenger', state: 'P3' });
  expect('F4l — P3 CTA is rendered with disabled attribute when canOpenTrip=false',
    /<button[^>]*data-action="open-trip"[^>]*\sdisabled/.test(markup));
  // And ENABLED in the happy path.
  const eligible = mkAcceptedOrder('render-test-p3-ok', 'drv-ok');
  const markupOk = orderDetailMod.renderOrderDetailMarkup(
    { order: eligible, role: 'passenger', state: 'P3' });
  expect('F4l — P3 CTA is NOT disabled when canOpenTrip=true',
    !/<button[^>]*data-action="open-trip"[^>]*\sdisabled/.test(markupOk));
}

// ── F5a–F5m. Passenger cancel order (BD-ORDER-DETAIL-01D-2C-A) ──────
// First 01D-2C mutation: passenger «Отменить заказ» writes the order
// overlay. The DriverOffer-status sync (sent → rejected) is NOT part
// of 01D-2C-A — that's a later sub-slice. active_ride is NOT touched.
// The driver flow is NOT touched. The store helper enforces the
// existing safe-key / prototype-pollution guards.

expect('driver_offer_store.js exports cancelOrderByPassenger',
  typeof driverOfferStore.cancelOrderByPassenger === 'function');

// ── F5a — cancelOrderByPassenger writes the overlay with the right shape ──
{
  driverOfferStore.clearDriverOfferStore();
  const result = driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-a' });
  expect('F5a — cancelOrderByPassenger returns the canceled overlay record',
    !!result
    && result.status === 'CANCELED'
    && result.canceledBy === 'passenger'
    && typeof result.canceledAt === 'string' && result.canceledAt.length > 0
    && typeof result.updatedAt === 'string' && result.updatedAt.length > 0);
  const overlay = driverOfferStore.getOrderOverlay('cancel-test-a');
  expect('F5a — overlay store carries the canceled record',
    !!overlay
    && overlay.status === 'CANCELED'
    && overlay.canceledBy === 'passenger');
}

// ── F5b — cancel is idempotent ──────────────────────────────────────
{
  driverOfferStore.clearDriverOfferStore();
  const first = driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-b' });
  const second = driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-b' });
  expect('F5b — second cancel returns the same record (idempotent)',
    !!second
    && second.status === 'CANCELED'
    && second.canceledAt === first.canceledAt
    && second.updatedAt === first.updatedAt);
}

// ── F5c — selectedDriverId is preserved across a cancel ─────────────
// Contract: "selectedDriverId stays unchanged" when the passenger
// cancels. Simulate a 01D-2A commit first, then cancel — the overlay
// must carry both the canceled status AND the selectedDriverId.
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-test-c', [mkOffer('cancel-test-c', 'drv-c1', 'sent')]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'cancel-test-c',
    selectedDriverId: 'drv-c1',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-test-c'),
  });
  const before = driverOfferStore.getOrderOverlay('cancel-test-c');
  expect('F5c baseline — overlay carries selectedDriverId after commit',
    !!before && before.selectedDriverId === 'drv-c1');
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-c' });
  const after = driverOfferStore.getOrderOverlay('cancel-test-c');
  expect('F5c — selectedDriverId preserved across cancel',
    !!after
    && after.status === 'CANCELED'
    && after.selectedDriverId === 'drv-c1'
    && after.canceledBy === 'passenger');
}

// ── F5d — DriverOffer-store records are NOT mutated by cancel ───────
// 01D-2C-A is overlay-only. The sent → rejected sync is a later
// sub-slice. Confirm by seeding offers, canceling, and checking each
// offer's status is verbatim.
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-test-d', [
    mkOffer('cancel-test-d', 'drv-d-sent',       'sent'),
    mkOffer('cancel-test-d', 'drv-d-withdrawn',  'withdrawn'),
    mkOffer('cancel-test-d', 'drv-d-expired',    'expired'),
    mkOffer('cancel-test-d', 'drv-d-rejected',   'rejected'),
  ]);
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-d' });
  expect('F5d — sent offer stays sent after cancel (01D-2C-A is overlay-only)',
    driverOfferStore.getDriverOffer('cancel-test-d', 'drv-d-sent')?.status === 'sent');
  expect('F5d — withdrawn offer stays withdrawn after cancel',
    driverOfferStore.getDriverOffer('cancel-test-d', 'drv-d-withdrawn')?.status === 'withdrawn');
  expect('F5d — expired offer stays expired after cancel',
    driverOfferStore.getDriverOffer('cancel-test-d', 'drv-d-expired')?.status === 'expired');
  expect('F5d — rejected offer stays rejected after cancel',
    driverOfferStore.getDriverOffer('cancel-test-d', 'drv-d-rejected')?.status === 'rejected');
}

// ── F5e — active_ride.v1 is NOT seeded by cancel ────────────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-e' });
  expect('F5e — bazardrive.active_ride.v1 is NOT written by cancel',
    !_bdofs.has('bazardrive.active_ride.v1'));
}

// ── F5f — canOpenTrip returns false for a canceled order ────────────
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-test-f', [mkOffer('cancel-test-f', 'drv-f', 'sent')]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'cancel-test-f',
    selectedDriverId: 'drv-f',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-test-f'),
  });
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-test-f' });
  // Simulate the merged order shape loadOrder would produce.
  const merged = {
    id: 'cancel-test-f',
    status: 'CANCELED',
    selectedDriverId: 'drv-f',
    offers: driverOfferStore.listDriverOffersForOrder('cancel-test-f'),
  };
  expect('F5f — canOpenTrip is false for a canceled order',
    orderDetailMod.canOpenTrip(merged) === false);
  expect('F5f — buildPassengerActiveRideSeed returns null for a canceled order',
    orderDetailMod.buildPassengerActiveRideSeed(merged) === null);
}

// ── F5g — loadOrder applies the canceled overlay → resolveState = P4 ──
{
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F5g — merged Order.status === "CANCELED" after cancel',
    merged && merged.status === 'CANCELED');
  expect('F5g — passenger resolveState lands on P4 after cancel',
    orderDetailMod.resolveState(merged, 'passenger') === 'P4');
  // P4 markup carries the canceled terminal copy.
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'passenger', state: 'P4' });
  expect('F5g — P4 markup includes the canceled exits',
    markup.includes('Создать новый заказ') && markup.includes('Вернуться в ленту'));
  expect('F5g — P4 markup exposes NO Отменить заказ / Открыть поездку CTA',
    !/data-action="cancel-order"/.test(markup)
    && !/data-action="open-trip"/.test(markup));
}

// ── F5h — driver flow unaffected: canceled order → D4 (no offer CTA) ──
{
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F5h — driver resolveState lands on D4 for a canceled order',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F5h — driver D4 markup carries NO «Откликнуться» on a canceled order',
    !markup.includes('Откликнуться'));
}

// ── F5i — selected-driver / 2B handoff still works for non-canceled orders ─
// A successful 01D-2A commit + 01D-2B handoff on a different order ID
// must remain unaffected by a cancel on demo-order-1.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  seedOrderWithOffers('handoff-after-cancel', [
    mkOffer('handoff-after-cancel', 'drv-ok', 'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'handoff-after-cancel',
    selectedDriverId: 'drv-ok',
    allOffers: driverOfferStore.listDriverOffersForOrder('handoff-after-cancel'),
  });
  const okOrder = {
    id: 'handoff-after-cancel',
    status: 'ACCEPTED',
    selectedDriverId: 'drv-ok',
    passengerName: 'Test',
    pickup: 'A', dropoff: 'B', time: 'now',
    budget: 1000, comment: '',
    offers: driverOfferStore.listDriverOffersForOrder('handoff-after-cancel'),
  };
  expect('F5i — canOpenTrip still true for an untouched accepted order',
    orderDetailMod.canOpenTrip(okOrder) === true);
  const seed = orderDetailMod.buildPassengerActiveRideSeed(okOrder);
  expect('F5i — buildPassengerActiveRideSeed still returns a seed for an untouched accepted order',
    !!seed && seed.tripId === 'trip_handoff-after-cancel');
}

// ── F5j — safe-key guards on cancelOrderByPassenger ─────────────────
{
  expect('F5j — cancelOrderByPassenger rejects __proto__ orderId',
    driverOfferStore.cancelOrderByPassenger({ orderId: '__proto__' }) === null);
  expect('F5j — cancelOrderByPassenger rejects constructor orderId',
    driverOfferStore.cancelOrderByPassenger({ orderId: 'constructor' }) === null);
  expect('F5j — cancelOrderByPassenger rejects prototype orderId',
    driverOfferStore.cancelOrderByPassenger({ orderId: 'prototype' }) === null);
  expect('F5j — cancelOrderByPassenger rejects empty orderId',
    driverOfferStore.cancelOrderByPassenger({ orderId: '' }) === null);
  expect('F5j — cancelOrderByPassenger rejects missing args',
    driverOfferStore.cancelOrderByPassenger() === null
    && driverOfferStore.cancelOrderByPassenger({}) === null);
  expect('Object.prototype is NOT polluted by cancelOrderByPassenger attempts',
    Object.prototype.canceledBy === undefined);
}

// ── F5k — cancel-order click handler is gated on role + 2-step confirm ─
expect('F5k — cancel-order handler gates on role === "passenger"',
  /cancel-order[\s\S]{0,1200}role\s*!==\s*['"]passenger['"]/.test(orderDetailSrc));
expect('F5k — cancel-order handler uses a 2-step armed/confirm pattern',
  /cancel-order[\s\S]{0,1500}dataset\.armed/.test(orderDetailSrc));
expect('F5k — cancel-order handler commits via cancelOrderByPassenger',
  /cancel-order[\s\S]{0,2000}cancelOrderByPassenger\s*\(/.test(orderDetailSrc));
// (F5k — `saveActiveRide` / `updateActiveRideStatus` ban is enforced
// below via the bound-extracted cancel handler block to avoid window
// drag from the bodyP1 button markup.)
// Bound-extract the cancel-order handler body so the assertion can't
// drag the regex into a neighbouring handler. The cancel block runs
// from `action === 'cancel-order'` up to (but not including) the next
// handler's `action === 'select-driver'`.
const cancelBlockMatch = orderDetailSrc.match(
  /action\s*===\s*['"]cancel-order['"][\s\S]*?action\s*===\s*['"]select-driver['"]/);
const cancelBlock = cancelBlockMatch ? cancelBlockMatch[0] : '';
expect('F5k — cancel-order handler block resolved', cancelBlock.length > 0);
expect('F5k — cancel-order handler never calls sendDriverOffer',
  !/sendDriverOffer\s*\(/.test(cancelBlock));
expect('F5k — cancel-order handler never calls withdrawDriverOffer',
  !/withdrawDriverOffer\s*\(/.test(cancelBlock));
expect('F5k — cancel-order handler never calls commitPassengerSelection',
  !/commitPassengerSelection\s*\(/.test(cancelBlock));
expect('F5k — cancel-order handler never calls saveActiveRide',
  !/saveActiveRide\s*\(/.test(cancelBlock));
expect('F5k — cancel-order handler never calls updateActiveRideStatus',
  !/updateActiveRideStatus\s*\(/.test(cancelBlock));

// ── F5l — driver_offer_store.js cancel path is overlay-only ─────────
const offerStoreSrcF5 = read('../public/src/driver_offer_store.js');
const offerStoreCodeF5 = stripComments(offerStoreSrcF5);
expect('F5l — cancelOrderByPassenger never writes active_ride',
  !/cancelOrderByPassenger[\s\S]{0,2000}saveActiveRide\s*\(/.test(offerStoreCodeF5)
  && !/cancelOrderByPassenger[\s\S]{0,2000}active_ride\.v1/.test(offerStoreCodeF5));
expect('F5l — cancelOrderByPassenger uses ORDER_STATUS_CANCELED literal',
  /cancelOrderByPassenger[\s\S]{0,2000}ORDER_STATUS_CANCELED/.test(offerStoreCodeF5)
  || /cancelOrderByPassenger[\s\S]{0,2000}['"`]CANCELED['"`]/.test(offerStoreCodeF5));

// ── F5m — P1 markup carries the cancel-order CTA on an un-canceled order ─
{
  driverOfferStore.clearDriverOfferStore();
  const baseline = orderDetailMod.loadOrder('demo-order-1');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: baseline, role: 'passenger', state: 'P1' });
  expect('F5m — P1 markup exposes the cancel-order CTA',
    /data-action="cancel-order"/.test(markup));
}

// ── F6a–F6n. Passenger reject single offer (BD-ORDER-DETAIL-01D-2C-B) ──
// Passenger «Отклонить» on a single sent DriverOffer flips ONLY that
// offer to `status='rejected'` and stamps `rejectedBy='passenger'` /
// `rejectedAt` / `updatedAt`. Other offers in the same order, every
// cross-order slot, the order overlay, and the active_ride store are
// all untouched. The driver-side flow is unaffected. The helper enforces
// the existing safe-key / prototype-pollution guards.

expect('driver_offer_store.js exports rejectDriverOfferByPassenger',
  typeof driverOfferStore.rejectDriverOfferByPassenger === 'function');

// ── F6a — happy path: sent offer flips to rejected with overlay fields ──
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-a', [mkOffer('reject-test-a', 'drv-a', 'sent')]);
  const result = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-a', driverId: 'drv-a',
  });
  expect('F6a — rejectDriverOfferByPassenger returns the rejected offer',
    !!result
    && result.status === 'rejected'
    && result.rejectedBy === 'passenger'
    && typeof result.rejectedAt === 'string' && result.rejectedAt.length > 0
    && typeof result.updatedAt === 'string' && result.updatedAt.length > 0);
  const stored = driverOfferStore.getDriverOffer('reject-test-a', 'drv-a');
  expect('F6a — store carries the rejected overlay',
    !!stored
    && stored.status === 'rejected'
    && stored.rejectedBy === 'passenger'
    && stored.rejectedAt === result.rejectedAt);
}

// ── F6b — repeat reject is idempotent ────────────────────────────────
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-b', [mkOffer('reject-test-b', 'drv-b', 'sent')]);
  const first = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-b', driverId: 'drv-b',
  });
  const second = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-b', driverId: 'drv-b',
  });
  expect('F6b — second reject returns the same record (idempotent)',
    !!second
    && second.status === 'rejected'
    && second.rejectedBy === 'passenger'
    && second.rejectedAt === first.rejectedAt
    && second.updatedAt === first.updatedAt);
}

// ── F6c — only the target offer is mutated; peer sent offers stay sent ─
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-c', [
    mkOffer('reject-test-c', 'drv-c-target', 'sent'),
    mkOffer('reject-test-c', 'drv-c-peer1',  'sent'),
    mkOffer('reject-test-c', 'drv-c-peer2',  'sent'),
  ]);
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-c', driverId: 'drv-c-target',
  });
  expect('F6c — target offer flipped to rejected',
    driverOfferStore.getDriverOffer('reject-test-c', 'drv-c-target')?.status === 'rejected');
  expect('F6c — peer1 sent offer stays sent',
    driverOfferStore.getDriverOffer('reject-test-c', 'drv-c-peer1')?.status === 'sent');
  expect('F6c — peer2 sent offer stays sent',
    driverOfferStore.getDriverOffer('reject-test-c', 'drv-c-peer2')?.status === 'sent');
}

// ── F6d — non-sent statuses are preserved verbatim ──────────────────
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-d', [
    mkOffer('reject-test-d', 'drv-d-acc', 'accepted'),
    mkOffer('reject-test-d', 'drv-d-w',   'withdrawn'),
    mkOffer('reject-test-d', 'drv-d-e',   'expired'),
    mkOffer('reject-test-d', 'drv-d-r',   'rejected', { rejectedBy: 'system' }),
  ]);
  driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'reject-test-d', driverId: 'drv-d-acc' });
  driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'reject-test-d', driverId: 'drv-d-w' });
  driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'reject-test-d', driverId: 'drv-d-e' });
  driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'reject-test-d', driverId: 'drv-d-r' });
  expect('F6d — accepted offer stays accepted',
    driverOfferStore.getDriverOffer('reject-test-d', 'drv-d-acc')?.status === 'accepted');
  expect('F6d — withdrawn offer stays withdrawn',
    driverOfferStore.getDriverOffer('reject-test-d', 'drv-d-w')?.status === 'withdrawn');
  expect('F6d — expired offer stays expired',
    driverOfferStore.getDriverOffer('reject-test-d', 'drv-d-e')?.status === 'expired');
  const r = driverOfferStore.getDriverOffer('reject-test-d', 'drv-d-r');
  expect('F6d — pre-existing non-passenger rejected stays verbatim',
    r?.status === 'rejected' && r?.rejectedBy === 'system');
}

// ── F6e — active_ride store is NOT seeded by reject ─────────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-e', [mkOffer('reject-test-e', 'drv-e', 'sent')]);
  driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'reject-test-e', driverId: 'drv-e' });
  expect('F6e — bazardrive.active_ride.v1 is NOT written by reject',
    !_bdofs.has('bazardrive.active_ride.v1'));
}

// ── F6f — order overlay is NOT touched by reject ─────────────────────
{
  driverOfferStore.clearDriverOfferStore();
  // Plant an overlay first (simulating a prior 01D-2A commit on another
  // driver) so we can prove reject doesn't disturb selectedDriverId.
  seedOrderWithOffers('reject-test-f', [
    mkOffer('reject-test-f', 'drv-f-accepted', 'sent'),
    mkOffer('reject-test-f', 'drv-f-peer',     'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'reject-test-f',
    selectedDriverId: 'drv-f-accepted',
    allOffers: driverOfferStore.listDriverOffersForOrder('reject-test-f'),
  });
  const beforeOverlay = driverOfferStore.getOrderOverlay('reject-test-f');
  // The commit already flipped drv-f-peer to 'rejected'. Re-reject it via
  // the passenger helper — idempotent on a non-sent terminal status.
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-f', driverId: 'drv-f-peer',
  });
  const afterOverlay = driverOfferStore.getOrderOverlay('reject-test-f');
  expect('F6f — order overlay status untouched by reject',
    !!afterOverlay && !!beforeOverlay && afterOverlay.status === beforeOverlay.status);
  expect('F6f — selectedDriverId untouched by reject',
    !!afterOverlay && afterOverlay.selectedDriverId === beforeOverlay.selectedDriverId);
}

// ── F6g — rejected offer is no longer selectable by commit ──────────
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-g', [mkOffer('reject-test-g', 'drv-g', 'sent')]);
  driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'reject-test-g', driverId: 'drv-g' });
  const all = driverOfferStore.listDriverOffersForOrder('reject-test-g');
  const result = driverOfferStore.commitPassengerSelection({
    orderId: 'reject-test-g',
    selectedDriverId: 'drv-g',
    allOffers: all,
  });
  expect('F6g — commitPassengerSelection refuses a rejected offer',
    result === null);
  expect('F6g — rejected offer remains rejected after refused commit',
    driverOfferStore.getDriverOffer('reject-test-g', 'drv-g')?.status === 'rejected');
}

// ── F6h — rejected selectedDriverId fails canOpenTrip and seed build ─
// Even if the merged Order somehow names the rejected offer as the
// selected driver (impossible via the supported commit path, but worth
// belt-and-suspenders), canOpenTrip refuses and the seed builder returns
// null. This is the open-trip safety net the spec calls out.
{
  const merged = {
    id: 'reject-test-h',
    status: 'ACCEPTED',
    selectedDriverId: 'drv-h',
    passengerName: 'Test',
    pickup: 'A', dropoff: 'B', time: 'now',
    budget: 1000, comment: '',
    offers: [mkOffer('reject-test-h', 'drv-h', 'rejected', { rejectedBy: 'passenger' })],
  };
  expect('F6h — canOpenTrip refuses a rejected selectedDriverId offer',
    orderDetailMod.canOpenTrip(merged) === false);
  expect('F6h — buildPassengerActiveRideSeed returns null for a rejected selected offer',
    orderDetailMod.buildPassengerActiveRideSeed(merged) === null);
}

// ── F6i — cross-order isolation: reject in one order leaves the other ─
//                                  fully selectable and seed-eligible
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Seed two unrelated orders. Direct bucket merge so both live under
  // the same store.v1 envelope (seedOrderWithOffers clears _bdofs each
  // time, so we hand-assemble the combined envelope).
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'reject-test-i-one': {
      'drv-target': mkOffer('reject-test-i-one', 'drv-target', 'sent'),
    },
    'reject-test-i-two': {
      'drv-other':  mkOffer('reject-test-i-two', 'drv-other',  'sent'),
    },
  }));
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-i-one', driverId: 'drv-target',
  });
  expect('F6i — target offer in one order rejected',
    driverOfferStore.getDriverOffer('reject-test-i-one', 'drv-target')?.status === 'rejected');
  expect('F6i — unrelated order offer untouched (still sent)',
    driverOfferStore.getDriverOffer('reject-test-i-two', 'drv-other')?.status === 'sent');
  // The unrelated accepted-order seed path still works end-to-end.
  driverOfferStore.commitPassengerSelection({
    orderId: 'reject-test-i-two',
    selectedDriverId: 'drv-other',
    allOffers: driverOfferStore.listDriverOffersForOrder('reject-test-i-two'),
  });
  const merged = {
    id: 'reject-test-i-two',
    status: 'ACCEPTED',
    selectedDriverId: 'drv-other',
    passengerName: 'X', pickup: 'A', dropoff: 'B', time: 'now',
    budget: 1000, comment: '',
    offers: driverOfferStore.listDriverOffersForOrder('reject-test-i-two'),
  };
  expect('F6i — unrelated accepted order is still canOpenTrip-eligible',
    orderDetailMod.canOpenTrip(merged) === true);
}

// ── F6j — passenger cancel-order (01D-2C-A) still works after a reject ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('reject-test-j', [
    mkOffer('reject-test-j', 'drv-j-sent',   'sent'),
    mkOffer('reject-test-j', 'drv-j-reject', 'sent'),
  ]);
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-j', driverId: 'drv-j-reject',
  });
  const result = driverOfferStore.cancelOrderByPassenger({ orderId: 'reject-test-j' });
  expect('F6j — cancel-order succeeds after a reject',
    !!result && result.status === 'CANCELED' && result.canceledBy === 'passenger');
  expect('F6j — rejected offer preserved across cancel',
    driverOfferStore.getDriverOffer('reject-test-j', 'drv-j-reject')?.status === 'rejected');
  expect('F6j — sibling sent offer preserved across cancel',
    driverOfferStore.getDriverOffer('reject-test-j', 'drv-j-sent')?.status === 'sent');
}

// ── F6k — driver view sees rejected peer as non-promoting ───────────
// A peer-driver offer that's been passenger-rejected should not promote
// the SELF driver from D1 → D2 (D2 only triggers on a self-sent offer)
// and should not promote the passenger from P1 → P2 (activeSentOffers
// excludes terminal statuses).
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('demo-order-1', [
    mkOffer('demo-order-1', 'peer-rejected', 'rejected', { rejectedBy: 'passenger' }),
  ]);
  const order = orderDetailMod.loadOrder('demo-order-1');
  expect('F6k — driver state stays D1 with only a rejected peer offer',
    orderDetailMod.resolveState(order, 'driver') === 'D1');
  expect('F6k — passenger state stays P1 with only a rejected peer offer',
    orderDetailMod.resolveState(order, 'passenger') === 'P1');
  expect('F6k — activeSentOffers excludes the rejected peer',
    orderDetailMod.activeSentOffers(order).length === 0);
}

// ── F6l — safe-key guards on rejectDriverOfferByPassenger ───────────
{
  expect('F6l — rejectDriverOfferByPassenger rejects __proto__ orderId',
    driverOfferStore.rejectDriverOfferByPassenger({ orderId: '__proto__', driverId: 'd' }) === null);
  expect('F6l — rejectDriverOfferByPassenger rejects constructor orderId',
    driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'constructor', driverId: 'd' }) === null);
  expect('F6l — rejectDriverOfferByPassenger rejects prototype orderId',
    driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'prototype', driverId: 'd' }) === null);
  expect('F6l — rejectDriverOfferByPassenger rejects __proto__ driverId',
    driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'x', driverId: '__proto__' }) === null);
  expect('F6l — rejectDriverOfferByPassenger rejects constructor driverId',
    driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'x', driverId: 'constructor' }) === null);
  expect('F6l — rejectDriverOfferByPassenger rejects prototype driverId',
    driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'x', driverId: 'prototype' }) === null);
  expect('F6l — rejectDriverOfferByPassenger rejects empty / missing args',
    driverOfferStore.rejectDriverOfferByPassenger() === null
    && driverOfferStore.rejectDriverOfferByPassenger({}) === null
    && driverOfferStore.rejectDriverOfferByPassenger({ orderId: '', driverId: '' }) === null
    && driverOfferStore.rejectDriverOfferByPassenger({ orderId: 'x', driverId: '' }) === null
    && driverOfferStore.rejectDriverOfferByPassenger({ orderId: '', driverId: 'd' }) === null);
  expect('Object.prototype is NOT polluted by rejectDriverOfferByPassenger attempts',
    Object.prototype.rejectedBy === undefined
    && Object.prototype.rejectedAt === undefined);
}

// ── F6m — reject-offer click handler is gated on role + sent status ─
expect('F6m — reject-offer handler gates on role === "passenger"',
  /reject-offer[\s\S]{0,1500}role\s*!==\s*['"]passenger['"]/.test(orderDetailSrc));
expect('F6m — reject-offer handler calls rejectDriverOfferByPassenger',
  /reject-offer[\s\S]{0,2000}rejectDriverOfferByPassenger\s*\(/.test(orderDetailSrc));
expect('F6m — reject-offer handler guards offer.status === "sent"',
  /reject-offer[\s\S]{0,2000}offer\.status\s*!==\s*['"]sent['"]/.test(orderDetailSrc));
// Bound-extract the reject-offer handler block via its unique success
// notice so the assertions can't drag into a neighbouring handler.
const rejectBlockMatch = orderDetailSrc.match(
  /action\s*===\s*['"]reject-offer['"][\s\S]*?showNotice\(rootEl,\s*['"]Оффер отклонён['"]\)/);
const rejectBlock = rejectBlockMatch ? rejectBlockMatch[0] : '';
expect('F6m — reject-offer handler block resolved', rejectBlock.length > 0);
expect('F6m — reject-offer handler never calls saveActiveRide',
  !/saveActiveRide\s*\(/.test(rejectBlock));
expect('F6m — reject-offer handler never calls updateActiveRideStatus',
  !/updateActiveRideStatus\s*\(/.test(rejectBlock));
expect('F6m — reject-offer handler never calls commitPassengerSelection',
  !/commitPassengerSelection\s*\(/.test(rejectBlock));
expect('F6m — reject-offer handler never calls cancelOrderByPassenger',
  !/cancelOrderByPassenger\s*\(/.test(rejectBlock));
expect('F6m — reject-offer handler never calls sendDriverOffer',
  !/sendDriverOffer\s*\(/.test(rejectBlock));
expect('F6m — reject-offer handler never calls withdrawDriverOffer',
  !/withdrawDriverOffer\s*\(/.test(rejectBlock));

// ── F6n — driver_offer_store.js reject path stays per-offer overlay only ─
expect('F6n — rejectDriverOfferByPassenger never writes active_ride',
  !/rejectDriverOfferByPassenger[\s\S]{0,2000}saveActiveRide\s*\(/.test(offerStoreCodeF5)
  && !/rejectDriverOfferByPassenger[\s\S]{0,2000}active_ride\.v1/.test(offerStoreCodeF5));
expect('F6n — rejectDriverOfferByPassenger never writes the order overlay',
  !/rejectDriverOfferByPassenger[\s\S]{0,2000}saveOverlayStore\s*\(/.test(offerStoreCodeF5));
expect('F6n — rejectDriverOfferByPassenger stamps rejectedBy=passenger',
  /rejectDriverOfferByPassenger[\s\S]{0,2000}rejectedBy[\s\S]{0,200}['"]passenger['"]/.test(offerStoreCodeF5));

// ── F6o — P2 markup carries the reject-offer CTA for a live sent offer ─
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('demo-order-1', [
    mkOffer('demo-order-1', 'peer-live', 'sent'),
  ]);
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F6o — passenger state with a live sent peer is P2',
    orderDetailMod.resolveState(merged, 'passenger') === 'P2');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'passenger', state: 'P2' });
  expect('F6o — P2 markup exposes the reject-offer CTA',
    /data-action="reject-offer"/.test(markup)
    && markup.includes('Отклонить'));
}

// ── F6p–F6u. Codex review feedback ──────────────────────────────────
// F6p: reject must persist from a fixture-only sent snapshot (P2 card
//      that hasn't been written to bazardrive.driver_offers.v1 yet).
// F6q: integration via loadOrder — fresh /order/demo-order-offers
//      passenger reject succeeds with an empty offer store.
// F6r: rejected fixture offer is no longer selectable / canOpenTrip.
// F6s: passenger-rejected SELF offer routes driver to D4 with the
//      explicit driver_offer_rejected lockedReason, not D1.
// F6t: sendDriverOffer preserves a passenger-rejected offer verbatim;
//      the click handler short-circuits before showing «Оффер отправлен».
// F6u: source-level pin on the driver-send-offer guard.

// ── F6p — fixture-only sent snapshot is persisted as rejected ───────
{
  driverOfferStore.clearDriverOfferStore();
  // No store entry. Pass a sent-offer snapshot mirroring what the click
  // handler passes when the P2 card is fixture-backed.
  const snapshot = mkOffer('reject-test-p', 'drv-p', 'sent', {
    driverName: 'Тест Водитель',
    price: 1234,
  });
  const result = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'reject-test-p',
    driverId: 'drv-p',
    offer: snapshot,
  });
  expect('F6p — reject persists from a fixture-only sent snapshot',
    !!result
    && result.status === 'rejected'
    && result.rejectedBy === 'passenger'
    && typeof result.rejectedAt === 'string' && result.rejectedAt.length > 0);
  const stored = driverOfferStore.getDriverOffer('reject-test-p', 'drv-p');
  expect('F6p — store now carries the rejected baseline derived from snapshot',
    !!stored
    && stored.status === 'rejected'
    && stored.rejectedBy === 'passenger'
    && stored.driverName === 'Тест Водитель'
    && stored.price === 1234);
  expect('F6p — reject still refuses when no snapshot AND no stored baseline',
    driverOfferStore.rejectDriverOfferByPassenger({
      orderId: 'reject-test-p-empty', driverId: 'd',
    }) === null);
  expect('F6p — snapshot with mismatched orderId is refused',
    driverOfferStore.rejectDriverOfferByPassenger({
      orderId: 'reject-test-p-empty', driverId: 'd',
      offer: { ...snapshot, orderId: 'other-order' },
    }) === null);
  expect('F6p — snapshot with non-sent status is refused',
    driverOfferStore.rejectDriverOfferByPassenger({
      orderId: 'reject-test-p-empty', driverId: 'd',
      offer: { id: 'x', orderId: 'reject-test-p-empty', driverId: 'd', status: 'withdrawn' },
    }) === null);
}

// ── F6q — fresh /order/demo-order-offers passenger reject works ─────
// Reproduces the Codex P1 scenario: an empty driver_offers.v1 store +
// the deterministic fixture P2 candidates. The merged loadOrder result
// is what the click handler iterates over, and the snapshot it passes
// to rejectDriverOfferByPassenger comes straight off `order.offers`.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const fresh = orderDetailMod.loadOrder('demo-order-offers');
  expect('F6q baseline — demo-order-offers fresh has 2 sent fixture offers',
    fresh.offers.filter((o) => o.status === 'sent').length === 2);
  const target = fresh.offers.find((o) => o.driverId === 'driver-1');
  expect('F6q baseline — fixture target offer is sent',
    !!target && target.status === 'sent');
  const result = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-offers',
    driverId: 'driver-1',
    offer: target,
  });
  expect('F6q — fixture-only reject succeeds via the merged path',
    !!result
    && result.status === 'rejected'
    && result.rejectedBy === 'passenger');
  const after = orderDetailMod.loadOrder('demo-order-offers');
  expect('F6q — merged order surfaces the rejected target via store overlay',
    after.offers.find((o) => o.driverId === 'driver-1')?.status === 'rejected');
  expect('F6q — the other fixture offer stays sent',
    after.offers.find((o) => o.driverId === 'driver-2')?.status === 'sent');
  expect('F6q — passenger state remains P2 (second sent offer survives)',
    orderDetailMod.resolveState(after, 'passenger') === 'P2');
  expect('F6q — bazardrive.active_ride.v1 is NOT seeded by the reject',
    !_bdofs.has('bazardrive.active_ride.v1'));
}

// ── F6r — rejected fixture offer is no longer selectable / eligible ─
{
  driverOfferStore.clearDriverOfferStore();
  const fresh = orderDetailMod.loadOrder('demo-order-offers');
  const target = fresh.offers.find((o) => o.driverId === 'driver-1');
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-offers',
    driverId: 'driver-1',
    offer: target,
  });
  const after = orderDetailMod.loadOrder('demo-order-offers');
  const refused = driverOfferStore.commitPassengerSelection({
    orderId: 'demo-order-offers',
    selectedDriverId: 'driver-1',
    allOffers: after.offers,
  });
  expect('F6r — commitPassengerSelection refuses the rejected fixture offer',
    refused === null);
  const sentIds = orderDetailMod.activeSentOffers(after).map((o) => o.driverId);
  expect('F6r — activeSentOffers excludes the rejected driver-1',
    !sentIds.includes('driver-1'));
  expect('F6r — activeSentOffers still includes the un-rejected driver-2',
    sentIds.includes('driver-2'));
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: after, role: 'passenger', state: 'P2' });
  expect('F6r — P2 markup excludes the rejected driver from the card list',
    !markup.includes(target.driverName));
  // canOpenTrip / seed builder also refuse if the rejected driver is
  // somehow promoted to selectedDriverId (belt-and-suspenders).
  const promoted = { ...after, status: 'ACCEPTED', selectedDriverId: 'driver-1' };
  expect('F6r — canOpenTrip refuses a rejected promoted-selected offer',
    orderDetailMod.canOpenTrip(promoted) === false);
  expect('F6r — buildPassengerActiveRideSeed returns null for the promoted-rejected case',
    orderDetailMod.buildPassengerActiveRideSeed(promoted) === null);
}

// ── F6s — passenger-rejected SELF offer routes driver to D4, not D1 ──
{
  driverOfferStore.clearDriverOfferStore();
  // Driver sends offer (D1 → D2).
  const sent = driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F6s baseline — SELF offer is sent', !!sent && sent.status === 'sent');
  // Passenger rejects the SELF offer.
  const offerSnapshot = orderDetailMod.loadOrder('demo-order-1').offers
    .find((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID);
  const rejected = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    offer: offerSnapshot,
  });
  expect('F6s baseline — reject succeeded',
    !!rejected && rejected.status === 'rejected' && rejected.rejectedBy === 'passenger');
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F6s — driver state is D4 (NOT D1) after passenger rejects SELF offer',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  expect('F6s — loadOrder surfaces the driver_offer_rejected lockedReason',
    merged.lockedReason === 'driver_offer_rejected');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F6s — D4 markup carries the «Пассажир отклонил ваш оффер» info',
    markup.includes('Пассажир отклонил ваш оффер'));
  expect('F6s — D4 markup carries NO «Откликнуться» CTA',
    !markup.includes('Откликнуться'));
  expect('F6s — D4 markup exposes only safe driver exits',
    markup.includes('Найти другие заказы') && markup.includes('Вернуться в ленту'));
  // Passenger view also reflects the rejected SELF offer — no longer P2.
  expect('F6s — passenger view falls back to P1 once the only sent offer is rejected',
    orderDetailMod.resolveState(merged, 'passenger') === 'P1');
}

// ── F6t — sendDriverOffer preserves a passenger-rejected SELF offer ──
{
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-t', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const baseline = driverOfferStore.getDriverOffer('demo-order-t', orderDetailMod.SELF_DRIVER_ID);
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-t',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    offer: baseline,
  });
  const rejected = driverOfferStore.getDriverOffer('demo-order-t', orderDetailMod.SELF_DRIVER_ID);
  expect('F6t baseline — SELF offer is now rejected',
    rejected?.status === 'rejected' && rejected?.rejectedBy === 'passenger');
  // The driver now attempts to re-send via sendDriverOffer. The helper
  // must preserve the rejected status verbatim and NOT flip back to sent.
  const result = driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-t', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F6t — sendDriverOffer returns the existing rejected record verbatim',
    !!result
    && result.status === 'rejected'
    && result.rejectedBy === 'passenger'
    && result.rejectedAt === rejected.rejectedAt);
  const stillRejected = driverOfferStore.getDriverOffer('demo-order-t', orderDetailMod.SELF_DRIVER_ID);
  expect('F6t — store still carries the rejected record (no resend)',
    stillRejected?.status === 'rejected'
    && stillRejected?.rejectedBy === 'passenger');
}

// ── F6u — driver-send-offer click handler short-circuits on rejected ──
expect('F6u — driver-send-offer handler short-circuits on existing rejected',
  /driver-send-offer[\s\S]{0,2500}existing[\s\S]{0,400}status\s*===\s*['"]rejected['"]/.test(orderDetailSrc));
expect('F6u — driver-send-offer handler shows a non-success toast for rejected',
  /existing[\s\S]{0,400}status\s*===\s*['"]rejected['"][\s\S]{0,400}showNotice\(rootEl,\s*['"]Пассажир отклонил оффер['"]\)/.test(orderDetailSrc));
// Bound-extract the driver-send-offer handler so the assertions can't
// drag the regex into a neighbouring handler.
const sendBlockMatch = orderDetailSrc.match(
  /action\s*===\s*['"]driver-send-offer['"][\s\S]*?showNotice\(rootEl,\s*['"]Оффер отправлен['"]\)/);
const sendBlock = sendBlockMatch ? sendBlockMatch[0] : '';
expect('F6u — driver-send-offer handler block resolved', sendBlock.length > 0);
expect('F6u — driver-send-offer handler returns early on existing rejected',
  /status\s*===\s*['"]rejected['"][\s\S]{0,400}return;/.test(sendBlock));

// ── F6v–F6z. Follow-up review feedback ──────────────────────────────
// F6v: helper preserves stale-stored accepted offer (snapshot doesn't
//      override a non-sent stored baseline).
// F6w: helper preserves stale-stored withdrawn / expired offers.
// F6x: helper preserves stale-stored foreign-rejected offer; no
//      overlay write; no active_ride seed.
// F6y: reject-offer click handler validates result.status === 'rejected'
//      AND result.rejectedBy === 'passenger' before the success toast.
// F6z: cancel-after-reject — terminal CANCELED reason wins over
//      driver_offer_rejected; D4 markup hides the rejected reason.

// ── F6v — stale-render: stored accepted offer NOT overwritten ───────
{
  driverOfferStore.clearDriverOfferStore();
  // Store the offer in 'accepted' state (e.g. an active commit landed
  // from another tab between the P2 render and the click).
  seedOrderWithOffers('stale-test-v', [
    mkOffer('stale-test-v', 'drv-v', 'accepted'),
  ]);
  const before = driverOfferStore.getDriverOffer('stale-test-v', 'drv-v');
  expect('F6v baseline — stored offer is accepted', before?.status === 'accepted');
  // Caller passes a sent snapshot (stale render).
  const result = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'stale-test-v', driverId: 'drv-v',
    offer: mkOffer('stale-test-v', 'drv-v', 'sent'),
  });
  expect('F6v — helper returns the stored accepted offer verbatim',
    !!result && result.status === 'accepted');
  expect('F6v — result.rejectedBy is NOT "passenger" (signals non-success to handler)',
    result.rejectedBy !== 'passenger');
  const after = driverOfferStore.getDriverOffer('stale-test-v', 'drv-v');
  expect('F6v — stored offer remains accepted (no mutation)',
    after?.status === 'accepted' && after?.id === before.id);
}

// ── F6w — stale-render: stored withdrawn / expired offers NOT mutated ─
for (const stale of ['withdrawn', 'expired']) {
  driverOfferStore.clearDriverOfferStore();
  const orderId = `stale-test-w-${stale}`;
  seedOrderWithOffers(orderId, [mkOffer(orderId, 'drv-w', stale)]);
  const result = driverOfferStore.rejectDriverOfferByPassenger({
    orderId, driverId: 'drv-w',
    offer: mkOffer(orderId, 'drv-w', 'sent'),
  });
  expect(`F6w — stored ${stale} offer is returned verbatim from snapshot path`,
    !!result && result.status === stale);
  expect(`F6w — stored ${stale} offer is preserved`,
    driverOfferStore.getDriverOffer(orderId, 'drv-w')?.status === stale);
  expect(`F6w — result.rejectedBy is NOT "passenger" for stored ${stale}`,
    result.rejectedBy !== 'passenger');
}

// ── F6x — stale-render: foreign-rejected stays put; no side effects ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('stale-test-x', [
    mkOffer('stale-test-x', 'drv-x', 'rejected', { rejectedBy: 'system' }),
  ]);
  const overlayBefore = _bdofs.get('bazardrive.order_overlay.v1') || null;
  const result = driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'stale-test-x', driverId: 'drv-x',
    offer: mkOffer('stale-test-x', 'drv-x', 'sent'),
  });
  expect('F6x — foreign-rejected offer returned verbatim',
    !!result && result.status === 'rejected' && result.rejectedBy === 'system');
  expect('F6x — foreign-rejected status not overwritten',
    driverOfferStore.getDriverOffer('stale-test-x', 'drv-x')?.rejectedBy === 'system');
  expect('F6x — stale reject does NOT seed bazardrive.active_ride.v1',
    !_bdofs.has('bazardrive.active_ride.v1'));
  const overlayAfter = _bdofs.get('bazardrive.order_overlay.v1') || null;
  expect('F6x — stale reject does NOT write the order overlay',
    overlayAfter === overlayBefore);
}

// ── F6y — reject-offer click handler validates result before success ─
expect('F6y — reject-offer handler checks result.status !== "rejected"',
  /reject-offer[\s\S]{0,3500}result\.status\s*!==\s*['"]rejected['"]/.test(orderDetailSrc));
expect('F6y — reject-offer handler checks result.rejectedBy !== "passenger"',
  /reject-offer[\s\S]{0,3500}result\.rejectedBy\s*!==\s*['"]passenger['"]/.test(orderDetailSrc));
expect('F6y — reject-offer handler shows non-success toast on stale outcome',
  /reject-offer[\s\S]{0,3500}['"]Этот оффер недоступен['"]/.test(orderDetailSrc));
// Bound-extract the reject-offer handler success branch so the
// assertions can't drag into a neighbouring handler.
const rejectBlock2Match = orderDetailSrc.match(
  /action\s*===\s*['"]reject-offer['"][\s\S]*?showNotice\(rootEl,\s*['"]Оффер отклонён['"]\)/);
const rejectBlock2 = rejectBlock2Match ? rejectBlock2Match[0] : '';
expect('F6y — reject-offer handler block resolved', rejectBlock2.length > 0);
expect('F6y — stale-result branch re-renders before the non-success toast',
  /result\.status\s*!==\s*['"]rejected['"][\s\S]{0,400}rerenderInPlace\(rootEl,\s*ctx\)/.test(rejectBlock2));
expect('F6y — stale-result branch returns before the success toast',
  /result\.rejectedBy\s*!==\s*['"]passenger['"][\s\S]{0,400}return;/.test(rejectBlock2));

// ── F6z — cancel-after-reject: canceled reason wins over rejected ───
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // 1. Driver sends offer (D1 → D2 in their view).
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  // 2. Passenger rejects the SELF offer.
  const offerSnap = orderDetailMod.loadOrder('demo-order-1').offers
    .find((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID);
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    offer: offerSnap,
  });
  // Sanity — without the cancel, the driver lands on D4 with the
  // driver_offer_rejected reason (F6s path).
  const beforeCancel = orderDetailMod.loadOrder('demo-order-1');
  expect('F6z baseline — pre-cancel driver_offer_rejected reason is set',
    beforeCancel.lockedReason === 'driver_offer_rejected');
  // 3. Passenger cancels the whole order.
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F6z — order is CANCELED after cancel',
    merged.status === 'CANCELED');
  expect('F6z — driver resolveState lands on D4',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  expect('F6z — lockedReason is order_canceled (NOT driver_offer_rejected)',
    merged.lockedReason === 'order_canceled');
  expect('F6z — lockedReason is explicitly NOT driver_offer_rejected',
    merged.lockedReason !== 'driver_offer_rejected');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F6z — D4 markup does NOT show «Пассажир отклонил ваш оффер»',
    !markup.includes('Пассажир отклонил ваш оффер'));
  expect('F6z — D4 markup shows the explicit «Заказ отменён» reason',
    markup.includes('Заказ отменён'));
  expect('F6z — D4 markup does NOT fall back to the generic «Заказ недоступен для отклика.»',
    !markup.includes('Заказ недоступен для отклика.'));
  expect('F6z — D4 markup carries NO «Откликнуться» CTA',
    !markup.includes('Откликнуться'));
  // Passenger side also resolves to terminal P4, NOT P1.
  expect('F6z — passenger view resolves to P4 (terminal)',
    orderDetailMod.resolveState(merged, 'passenger') === 'P4');
  // Same guarantee for an EXPIRED order (the fixture demo-order-expired
  // is canonically EXPIRED, then layer a SELF reject on it).
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-expired', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const expiredSnap = orderDetailMod.loadOrder('demo-order-expired').offers
    .find((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID);
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-expired',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    offer: expiredSnap,
  });
  const expiredMerged = orderDetailMod.loadOrder('demo-order-expired');
  expect('F6z — EXPIRED order keeps its order_expired lockedReason',
    expiredMerged.lockedReason === 'order_expired');
  const expiredMarkup = orderDetailMod.renderOrderDetailMarkup(
    { order: expiredMerged, role: 'driver', state: 'D4' });
  expect('F6z — EXPIRED D4 markup shows «Заказ истёк», not the rejected reason',
    expiredMarkup.includes('Заказ истёк')
    && !expiredMarkup.includes('Пассажир отклонил ваш оффер'));
  expect('F6z — EXPIRED D4 markup does NOT fall back to the generic unavailable line',
    !expiredMarkup.includes('Заказ недоступен для отклика.'));
}

// ── F6aa — runtime CANCELED without a prior reject also gets the
//          canonical order_canceled reason (covers the cancel-only path).
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F6aa — runtime canceled order surfaces order_canceled lockedReason',
    merged.lockedReason === 'order_canceled');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F6aa — driver D4 markup shows «Заказ отменён» on a runtime cancel',
    markup.includes('Заказ отменён'));
  expect('F6aa — driver D4 markup does NOT show the generic unavailable line',
    !markup.includes('Заказ недоступен для отклика.'));
}

// ── F6bb — fixture-set lockedReason is preserved (precedence rule #1) ──
{
  driverOfferStore.clearDriverOfferStore();
  // demo-order-locked carries lockedReason='passenger_chose_other' in
  // the fixture; the runtime overlay must NOT overwrite it.
  const merged = orderDetailMod.loadOrder('demo-order-locked');
  expect('F6bb — fixture lockedReason is preserved over runtime overlays',
    merged.lockedReason === 'passenger_chose_other');
}

// ── F6cc–F6ff. Final P3 review-thread fixes ────────────────────────
// F6cc: passenger rejects SELF then picks a peer driver — D4 reason is
//       passenger_chose_other, NOT driver_offer_rejected.
// F6dd: runtime ACCEPTED without any SELF involvement — D4 reason is
//       passenger_chose_other (not the generic «недоступен» fallback).
// F6ee: runtime ACCEPTED with SELF actually selected — routes to D3,
//       no D4 lockedReason regression.
// F6ff: driver-send-offer guard differentiates passenger vs foreign
//       rejectedBy — only labels passenger-rejected as such.

// ── F6cc — SELF rejected + passenger commits to peer → D4 reason is passenger_chose_other ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // 1. SELF sends offer on demo-order-offers (has two fixture peers).
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-offers', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  // 2. Passenger rejects the SELF offer.
  const selfSnap = orderDetailMod.loadOrder('demo-order-offers').offers
    .find((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID);
  driverOfferStore.rejectDriverOfferByPassenger({
    orderId: 'demo-order-offers',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    offer: selfSnap,
  });
  // Sanity: still CREATED, lockedReason=driver_offer_rejected for SELF.
  const afterReject = orderDetailMod.loadOrder('demo-order-offers');
  expect('F6cc baseline — pre-commit lockedReason is driver_offer_rejected',
    afterReject.lockedReason === 'driver_offer_rejected');
  // 3. Passenger commits to a peer fixture driver (driver-1).
  driverOfferStore.commitPassengerSelection({
    orderId: 'demo-order-offers',
    selectedDriverId: 'driver-1',
    allOffers: afterReject.offers,
  });
  const merged = orderDetailMod.loadOrder('demo-order-offers');
  expect('F6cc — order is ACCEPTED after commit',
    merged.status === 'ACCEPTED');
  expect('F6cc — selectedDriverId is the peer (NOT SELF)',
    merged.selectedDriverId === 'driver-1');
  expect('F6cc — lockedReason is passenger_chose_other (NOT driver_offer_rejected)',
    merged.lockedReason === 'passenger_chose_other');
  expect('F6cc — driver resolveState lands on D4',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F6cc — D4 markup shows «Пассажир выбрал другого водителя»',
    markup.includes('Пассажир выбрал другого водителя'));
  expect('F6cc — D4 markup does NOT show «Пассажир отклонил ваш оффер»',
    !markup.includes('Пассажир отклонил ваш оффер'));
  expect('F6cc — D4 markup does NOT fall back to the generic «Заказ недоступен для отклика.»',
    !markup.includes('Заказ недоступен для отклика.'));
  expect('F6cc — D4 markup carries NO «Откликнуться» CTA',
    !markup.includes('Откликнуться'));
}

// ── F6dd — runtime ACCEPTED without SELF: D4 reason is passenger_chose_other ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // No SELF offer at all — passenger commits to fixture peer driver-1.
  const fresh = orderDetailMod.loadOrder('demo-order-offers');
  driverOfferStore.commitPassengerSelection({
    orderId: 'demo-order-offers',
    selectedDriverId: 'driver-1',
    allOffers: fresh.offers,
  });
  const merged = orderDetailMod.loadOrder('demo-order-offers');
  expect('F6dd — order is ACCEPTED after commit',
    merged.status === 'ACCEPTED');
  expect('F6dd — runtime ACCEPTED gets passenger_chose_other lockedReason',
    merged.lockedReason === 'passenger_chose_other');
  expect('F6dd — driver resolveState lands on D4',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F6dd — D4 markup shows «Пассажир выбрал другого водителя»',
    markup.includes('Пассажир выбрал другого водителя'));
  expect('F6dd — D4 markup does NOT fall back to the generic «Заказ недоступен для отклика.»',
    !markup.includes('Заказ недоступен для отклика.'));
}

// ── F6ee — runtime ACCEPTED with SELF selected: D3 (NOT D4), no override ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // SELF sends offer on demo-order-1; passenger commits to SELF.
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const fresh = orderDetailMod.loadOrder('demo-order-1');
  driverOfferStore.commitPassengerSelection({
    orderId: 'demo-order-1',
    selectedDriverId: orderDetailMod.SELF_DRIVER_ID,
    allOffers: fresh.offers,
  });
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F6ee — order is ACCEPTED with SELF selected',
    merged.status === 'ACCEPTED'
    && merged.selectedDriverId === orderDetailMod.SELF_DRIVER_ID);
  expect('F6ee — SELF-selected ACCEPTED order does NOT get passenger_chose_other override',
    merged.lockedReason !== 'passenger_chose_other');
  expect('F6ee — driver resolveState routes SELF to D3 (NOT D4)',
    orderDetailMod.resolveState(merged, 'driver') === 'D3');
}

// ── F6ff — driver-send-offer guard differentiates passenger vs foreign rejectedBy ─
// Source-level pins for the branching logic.
expect('F6ff — driver-send-offer guard checks rejectedBy === "passenger"',
  /driver-send-offer[\s\S]{0,3500}rejectedBy\s*===\s*['"]passenger['"]/.test(orderDetailSrc));
expect('F6ff — driver-send-offer guard shows generic «Оффер недоступен» for foreign rejectedBy',
  /driver-send-offer[\s\S]{0,3500}['"]Оффер недоступен['"]/.test(orderDetailSrc));
// Bound-extract the driver-send-offer block to pin branch ordering.
const sendBlockFFMatch = orderDetailSrc.match(
  /action\s*===\s*['"]driver-send-offer['"][\s\S]*?showNotice\(rootEl,\s*['"]Оффер отправлен['"]\)/);
const sendBlockFF = sendBlockFFMatch ? sendBlockFFMatch[0] : '';
expect('F6ff — driver-send-offer block resolved', sendBlockFF.length > 0);
expect('F6ff — guard branches «Пассажир отклонил оффер» under rejectedBy === "passenger"',
  /rejectedBy\s*===\s*['"]passenger['"][\s\S]{0,300}['"]Пассажир отклонил оффер['"]/.test(sendBlockFF));
expect('F6ff — guard branches generic toast under the non-passenger else',
  /else\s*\{[\s\S]{0,300}['"]Оффер недоступен['"]/.test(sendBlockFF));

// Behavioral pin: sendDriverOffer preserves a system-rejected SELF offer
// (the store-level invariant the guard relies on).
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('foreign-reject-test', [
    mkOffer('foreign-reject-test', orderDetailMod.SELF_DRIVER_ID, 'rejected', { rejectedBy: 'system' }),
  ]);
  const before = driverOfferStore.getDriverOffer('foreign-reject-test', orderDetailMod.SELF_DRIVER_ID);
  expect('F6ff baseline — store carries system-rejected SELF offer',
    before?.status === 'rejected' && before?.rejectedBy === 'system');
  const result = driverOfferStore.sendDriverOffer({
    orderId: 'foreign-reject-test', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F6ff — sendDriverOffer preserves a foreign-rejected SELF offer verbatim',
    !!result
    && result.status === 'rejected'
    && result.rejectedBy === 'system');
  const after = driverOfferStore.getDriverOffer('foreign-reject-test', orderDetailMod.SELF_DRIVER_ID);
  expect('F6ff — store record unchanged after sendDriverOffer attempt',
    after?.status === 'rejected'
    && after?.rejectedBy === 'system');
}

// Behavioral pin: a SELF offer with status='rejected' and a foreign
// rejectedBy does NOT route to D4 via driver_offer_rejected — the
// loadOrder precedence only matches passenger.
{
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('demo-order-1', [
    mkOffer('demo-order-1', orderDetailMod.SELF_DRIVER_ID, 'rejected', { rejectedBy: 'system' }),
  ]);
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F6ff — foreign-rejected SELF offer does NOT trigger driver_offer_rejected lockedReason',
    merged.lockedReason !== 'driver_offer_rejected');
  // Driver state for such a SELF terminal offer: the existing
  // ownOffer-sent check misses (status is rejected, not sent), and
  // the ownRejectedByPassenger check also misses (rejectedBy is
  // 'system', not 'passenger'), so resolveState returns D1 — the
  // handler-side guard catches the click and shows the generic
  // notice, never mislabeling the rejecter.
  expect('F6ff — driver resolveState stays D1 for a foreign-rejected SELF offer (handler will guard)',
    orderDetailMod.resolveState(merged, 'driver') === 'D1');
}

// ── F7a–F7n. Passenger cancel-order sent → rejected sync (01D-2C-C) ─
// Closes the deferred gap from 01D-2C-A: when the passenger cancels the
// whole order, every active `status='sent'` DriverOffer for that order
// flips to a terminal `status='rejected'` record stamped with
// `rejectedBy='passenger_cancel'` + `rejectedReason='order_canceled_by_passenger'`.
// Terminal offers (`accepted` / `withdrawn` / `expired` / pre-existing
// `rejected`) and cross-order offers are preserved verbatim. The cancel
// overlay (01D-2C-A) is untouched by the sync; active_ride is not
// touched by either path.

expect('F7 — driver_offer_store exports rejectSentOffersForPassengerCanceledOrder',
  typeof driverOfferStore.rejectSentOffersForPassengerCanceledOrder === 'function');

// ── F7a — multi-offer cancel flips every active sent offer to rejected ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-sync-test-a', [
    mkOffer('cancel-sync-test-a', 'drv-a-1', 'sent'),
    mkOffer('cancel-sync-test-a', 'drv-a-2', 'sent'),
    mkOffer('cancel-sync-test-a', 'drv-a-3', 'sent'),
  ]);
  const overlayResult = driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-a' });
  expect('F7a — overlay carries cancel record',
    !!overlayResult && overlayResult.status === 'CANCELED' && overlayResult.canceledBy === 'passenger');
  const syncResult = driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-a',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-sync-test-a'),
  });
  expect('F7a — sync returns an array of 3 rejected records',
    Array.isArray(syncResult) && syncResult.length === 3);
  for (const driverId of ['drv-a-1', 'drv-a-2', 'drv-a-3']) {
    const stored = driverOfferStore.getDriverOffer('cancel-sync-test-a', driverId);
    expect(`F7a — ${driverId} status flipped to rejected`,
      stored?.status === 'rejected');
    expect(`F7a — ${driverId} carries rejectedBy='passenger_cancel'`,
      stored?.rejectedBy === 'passenger_cancel');
    expect(`F7a — ${driverId} carries rejectedReason='order_canceled_by_passenger'`,
      stored?.rejectedReason === 'order_canceled_by_passenger');
    expect(`F7a — ${driverId} carries non-empty rejectedAt`,
      typeof stored?.rejectedAt === 'string' && stored.rejectedAt.length > 0);
    expect(`F7a — ${driverId} updatedAt bumped`,
      typeof stored?.updatedAt === 'string' && stored.updatedAt === stored.rejectedAt);
  }
}

// ── F7b — overlay state after cancel + sync is canonical ─────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-sync-test-b', [
    mkOffer('cancel-sync-test-b', 'drv-b', 'sent'),
  ]);
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-b' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-b',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-sync-test-b'),
  });
  const overlay = driverOfferStore.getOrderOverlay('cancel-sync-test-b');
  expect('F7b — overlay status === CANCELED',
    overlay?.status === 'CANCELED');
  expect('F7b — overlay canceledBy === passenger',
    overlay?.canceledBy === 'passenger');
  expect('F7b — overlay carries canceledAt and updatedAt',
    typeof overlay?.canceledAt === 'string' && overlay.canceledAt.length > 0
    && typeof overlay?.updatedAt === 'string' && overlay.updatedAt.length > 0);
}

// ── F7c — terminal statuses preserved verbatim ──────────────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-sync-test-c', [
    mkOffer('cancel-sync-test-c', 'drv-c-sent',      'sent'),
    mkOffer('cancel-sync-test-c', 'drv-c-withdrawn', 'withdrawn'),
    mkOffer('cancel-sync-test-c', 'drv-c-expired',   'expired'),
    mkOffer('cancel-sync-test-c', 'drv-c-accepted',  'accepted'),
  ]);
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-c' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-c',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-sync-test-c'),
  });
  expect('F7c — sent offer flipped to rejected',
    driverOfferStore.getDriverOffer('cancel-sync-test-c', 'drv-c-sent')?.status === 'rejected');
  expect('F7c — withdrawn offer preserved verbatim',
    driverOfferStore.getDriverOffer('cancel-sync-test-c', 'drv-c-withdrawn')?.status === 'withdrawn');
  expect('F7c — expired offer preserved verbatim',
    driverOfferStore.getDriverOffer('cancel-sync-test-c', 'drv-c-expired')?.status === 'expired');
  expect('F7c — accepted offer preserved verbatim',
    driverOfferStore.getDriverOffer('cancel-sync-test-c', 'drv-c-accepted')?.status === 'accepted');
}

// ── F7d — already-rejected offer preserves original rejectedBy/rejectedAt ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-sync-test-d', [
    mkOffer('cancel-sync-test-d', 'drv-d-1', 'sent'),
    mkOffer('cancel-sync-test-d', 'drv-d-2', 'rejected', {
      rejectedBy: 'passenger',
      rejectedAt: '2026-06-10T10:00:00.000Z',
    }),
    mkOffer('cancel-sync-test-d', 'drv-d-3', 'rejected', {
      rejectedBy: 'system',
      rejectedReason: 'driver_no_show',
      rejectedAt: '2026-06-10T11:00:00.000Z',
    }),
  ]);
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-d' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-d',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-sync-test-d'),
  });
  const d1 = driverOfferStore.getDriverOffer('cancel-sync-test-d', 'drv-d-1');
  expect('F7d — newly-canceled sent offer carries passenger_cancel reason',
    d1?.status === 'rejected' && d1?.rejectedBy === 'passenger_cancel');
  const d2 = driverOfferStore.getDriverOffer('cancel-sync-test-d', 'drv-d-2');
  expect('F7d — already-passenger-rejected preserves original rejectedBy',
    d2?.status === 'rejected'
    && d2?.rejectedBy === 'passenger'
    && d2?.rejectedAt === '2026-06-10T10:00:00.000Z');
  const d3 = driverOfferStore.getDriverOffer('cancel-sync-test-d', 'drv-d-3');
  expect('F7d — already-system-rejected preserves original rejectedBy + rejectedReason',
    d3?.status === 'rejected'
    && d3?.rejectedBy === 'system'
    && d3?.rejectedReason === 'driver_no_show'
    && d3?.rejectedAt === '2026-06-10T11:00:00.000Z');
}

// ── F7e — cross-order sent offer remains sent ────────────────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Hand-assemble two orders' buckets so both live under the same
  // store envelope (seedOrderWithOffers clears each call).
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'cancel-sync-test-e-one': {
      'drv-target': mkOffer('cancel-sync-test-e-one', 'drv-target', 'sent'),
    },
    'cancel-sync-test-e-two': {
      'drv-other':  mkOffer('cancel-sync-test-e-two', 'drv-other',  'sent'),
    },
  }));
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-e-one' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-e-one',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-sync-test-e-one'),
  });
  expect('F7e — canceled order target offer is rejected',
    driverOfferStore.getDriverOffer('cancel-sync-test-e-one', 'drv-target')?.status === 'rejected');
  expect('F7e — unrelated order sent offer remains sent',
    driverOfferStore.getDriverOffer('cancel-sync-test-e-two', 'drv-other')?.status === 'sent');
  expect('F7e — unrelated order overlay not touched',
    driverOfferStore.getOrderOverlay('cancel-sync-test-e-two') === null);
}

// ── F7f — no active_ride seed / no overlay mutation by the sync ─────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('cancel-sync-test-f', [
    mkOffer('cancel-sync-test-f', 'drv-f', 'sent'),
  ]);
  // Pre-seed an overlay record so we can prove the sync doesn't change it.
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-f' });
  const overlayBefore = driverOfferStore.getOrderOverlay('cancel-sync-test-f');
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-f',
    allOffers: driverOfferStore.listDriverOffersForOrder('cancel-sync-test-f'),
  });
  const overlayAfter = driverOfferStore.getOrderOverlay('cancel-sync-test-f');
  expect('F7f — sync does NOT seed bazardrive.active_ride.v1',
    !_bdofs.has('bazardrive.active_ride.v1'));
  expect('F7f — sync does NOT change overlay.canceledAt',
    overlayAfter?.canceledAt === overlayBefore?.canceledAt);
  expect('F7f — sync does NOT change overlay.updatedAt',
    overlayAfter?.updatedAt === overlayBefore?.updatedAt);
}

// ── F7g — fixture-only sent offers persisted via snapshot path ──────
// Reproduces the realistic Order Detail click path: passenger lands on
// /order/demo-order-offers (two fixture sent offers, empty store), taps
// «Отменить заказ». The cancel-order handler passes ctx.order.offers
// (the fixture snapshot) into the sync helper, which persists both as
// rejected records.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const fresh = orderDetailMod.loadOrder('demo-order-offers');
  expect('F7g baseline — demo-order-offers carries 2 sent fixture offers',
    fresh.offers.filter((o) => o.status === 'sent').length === 2);
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-offers' });
  const syncResult = driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'demo-order-offers',
    allOffers: fresh.offers,
  });
  expect('F7g — sync returns 2 rejected records from fixture-only snapshot',
    Array.isArray(syncResult) && syncResult.length === 2);
  for (const driverId of ['driver-1', 'driver-2']) {
    const stored = driverOfferStore.getDriverOffer('demo-order-offers', driverId);
    expect(`F7g — ${driverId} persisted as rejected via snapshot fallback`,
      stored?.status === 'rejected'
      && stored?.rejectedBy === 'passenger_cancel'
      && stored?.rejectedReason === 'order_canceled_by_passenger');
  }
}

// ── F7h — driver canceled order resolves D4 with no offer CTA ───────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Driver sends an offer (D1 → D2), then passenger cancels.
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-1', driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  // Sanity — driver is on D2 before the cancel.
  const beforeCancel = orderDetailMod.loadOrder('demo-order-1');
  expect('F7h baseline — driver is on D2 with a sent SELF offer',
    orderDetailMod.resolveState(beforeCancel, 'driver') === 'D2');
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-1' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'demo-order-1',
    allOffers: beforeCancel.offers,
  });
  const merged = orderDetailMod.loadOrder('demo-order-1');
  expect('F7h — driver state lands on D4 after cancel + sync',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  expect('F7h — SELF offer is rejected with passenger_cancel reason',
    merged.offers.find((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID)?.status === 'rejected'
    && merged.offers.find((o) => o.driverId === orderDetailMod.SELF_DRIVER_ID)?.rejectedBy === 'passenger_cancel');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F7h — driver D4 markup shows «Заказ отменён»',
    markup.includes('Заказ отменён'));
  for (const forbidden of [
    'Откликнуться на заказ',
    'Оффер отправлен',
    'Отозвать оффер',
    'Изменить оффер',
  ]) {
    expect(`F7h — driver D4 markup does NOT carry «${forbidden}»`,
      !markup.includes(forbidden));
  }
}

// ── F7i — passenger canceled order resolves P4 with terminal exits ──
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Seed a peer sent offer so we can also verify P2 affordances disappear.
  seedOrderWithOffers('demo-order-offers', [
    mkOffer('demo-order-offers', 'driver-1', 'sent'),
  ]);
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-offers' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'demo-order-offers',
    allOffers: driverOfferStore.listDriverOffersForOrder('demo-order-offers'),
  });
  const merged = orderDetailMod.loadOrder('demo-order-offers');
  expect('F7i — passenger state lands on P4',
    orderDetailMod.resolveState(merged, 'passenger') === 'P4');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'passenger', state: 'P4' });
  expect('F7i — passenger P4 markup carries «Создать новый заказ»',
    markup.includes('Создать новый заказ'));
  expect('F7i — passenger P4 markup carries «Вернуться в ленту»',
    markup.includes('Вернуться в ленту'));
  for (const forbidden of ['Выбрать водителя', 'Отклонить', 'Откликнуться']) {
    expect(`F7i — passenger P4 markup does NOT carry «${forbidden}»`,
      !markup.includes(forbidden));
  }
}

// ── F7j — safe-key guards on rejectSentOffersForPassengerCanceledOrder ─
{
  expect('F7j — sync refuses __proto__ orderId',
    driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
      orderId: '__proto__', allOffers: [],
    }) === null);
  expect('F7j — sync refuses constructor orderId',
    driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
      orderId: 'constructor', allOffers: [],
    }) === null);
  expect('F7j — sync refuses prototype orderId',
    driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
      orderId: 'prototype', allOffers: [],
    }) === null);
  expect('F7j — sync refuses empty orderId',
    driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
      orderId: '', allOffers: [],
    }) === null);
  expect('F7j — sync refuses missing args / non-array allOffers',
    driverOfferStore.rejectSentOffersForPassengerCanceledOrder() === null
    && driverOfferStore.rejectSentOffersForPassengerCanceledOrder({}) === null
    && driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
      orderId: 'x', allOffers: null,
    }) === null
    && driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
      orderId: 'x', allOffers: 'not-an-array',
    }) === null);
  // Snapshot entries with blocked driverId are skipped, not pollutive.
  driverOfferStore.clearDriverOfferStore();
  const result = driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'guard-test',
    allOffers: [
      { orderId: 'guard-test', driverId: '__proto__', status: 'sent' },
      { orderId: 'guard-test', driverId: 'constructor', status: 'sent' },
      { orderId: 'guard-test', driverId: 'drv-good',  status: 'sent' },
    ],
  });
  expect('F7j — sync skips snapshot entries with blocked driverId',
    Array.isArray(result) && result.length === 1
    && result[0].driverId === 'drv-good');
  expect('Object.prototype is NOT polluted by sync attempts',
    Object.prototype.rejectedBy === undefined
    && Object.prototype.rejectedReason === undefined);
}

// ── F7k — sync skips foreign-order snapshot entries ─────────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const result = driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-k',
    allOffers: [
      { orderId: 'cancel-sync-test-k', driverId: 'drv-own',  status: 'sent' },
      // Foreign order id — must be skipped.
      { orderId: 'other-order',         driverId: 'drv-other', status: 'sent' },
    ],
  });
  expect('F7k — sync flips only the same-order entry',
    Array.isArray(result) && result.length === 1
    && result[0].driverId === 'drv-own');
  // The store should NOT carry a foreign-order rejection write.
  const storeJson = _bdofs.get('bazardrive.driver_offers.v1') || '{}';
  expect('F7k — foreign-order bucket is not created by the sync',
    !JSON.parse(storeJson)['other-order']);
}

// ── F7l — cancel-order click handler imports + calls the sync ───────
expect('F7l — order_detail.js imports rejectSentOffersForPassengerCanceledOrder',
  /import\s*\{[\s\S]*?rejectSentOffersForPassengerCanceledOrder[\s\S]*?\}\s*from\s*['"]\.\.\/driver_offer_store\.js['"]/.test(orderDetailSrc));
expect('F7l — cancel-order handler calls rejectSentOffersForPassengerCanceledOrder',
  /cancel-order[\s\S]{0,3500}rejectSentOffersForPassengerCanceledOrder\s*\(/.test(orderDetailSrc));
// Bound-extract the cancel handler so the assertion can't drag into a
// neighbouring block.
const cancelBlock7Match = orderDetailSrc.match(
  /action\s*===\s*['"]cancel-order['"][\s\S]*?action\s*===\s*['"]select-driver['"]/);
const cancelBlock7 = cancelBlock7Match ? cancelBlock7Match[0] : '';
expect('F7l — cancel-order block resolved', cancelBlock7.length > 0);
expect('F7l — sync call appears AFTER the cancelOrderByPassenger success path',
  /cancelOrderByPassenger\s*\([\s\S]{0,1500}rejectSentOffersForPassengerCanceledOrder\s*\(/.test(cancelBlock7));
expect('F7l — cancel-order handler passes allOffers from ctx.order',
  /rejectSentOffersForPassengerCanceledOrder\s*\(\s*\{[\s\S]{0,400}allOffers:\s*\(?ctx\.order/.test(cancelBlock7));
expect('F7l — cancel-order handler never seeds active_ride',
  !/saveActiveRide\s*\(/.test(cancelBlock7));

// ── F7m — store source pin: sync stays in scope ─────────────────────
const offerStoreSrcF7 = read('../public/src/driver_offer_store.js');
const offerStoreCodeF7 = stripComments(offerStoreSrcF7);
expect('F7m — rejectSentOffersForPassengerCanceledOrder never writes active_ride',
  !/rejectSentOffersForPassengerCanceledOrder[\s\S]{0,3000}saveActiveRide\s*\(/.test(offerStoreCodeF7)
  && !/rejectSentOffersForPassengerCanceledOrder[\s\S]{0,3000}active_ride\.v1/.test(offerStoreCodeF7));
expect('F7m — rejectSentOffersForPassengerCanceledOrder never writes the order overlay',
  !/rejectSentOffersForPassengerCanceledOrder[\s\S]{0,3000}saveOverlayStore\s*\(/.test(offerStoreCodeF7));
expect('F7m — rejectSentOffersForPassengerCanceledOrder gates on baseline.status === SENT',
  /rejectSentOffersForPassengerCanceledOrder[\s\S]{0,3000}baseline\.status\s*!==\s*DRIVER_OFFER_STATUS\.SENT/.test(offerStoreCodeF7));
expect('F7m — rejectSentOffersForPassengerCanceledOrder stamps rejectedBy=passenger_cancel',
  /rejectSentOffersForPassengerCanceledOrder[\s\S]{0,3000}rejectedBy[\s\S]{0,200}['"]passenger_cancel['"]/.test(offerStoreCodeF7));
expect('F7m — rejectSentOffersForPassengerCanceledOrder stamps rejectedReason=order_canceled_by_passenger',
  /rejectSentOffersForPassengerCanceledOrder[\s\S]{0,3000}rejectedReason[\s\S]{0,200}['"]order_canceled_by_passenger['"]/.test(offerStoreCodeF7));

// ── F7n — end-to-end via the merged order: cancel + sync via cancelOrderByPassenger + helper ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Simulate the realistic flow on demo-order-offers: passenger sees 2
  // fixture sent offers, taps cancel; the handler runs both cancel +
  // sync via the snapshot.
  const fresh = orderDetailMod.loadOrder('demo-order-offers');
  driverOfferStore.cancelOrderByPassenger({ orderId: 'demo-order-offers' });
  driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'demo-order-offers',
    allOffers: fresh.offers,
  });
  const merged = orderDetailMod.loadOrder('demo-order-offers');
  // Both passenger and driver views land on the terminal D4/P4 state.
  expect('F7n — passenger view is P4 after cancel + sync',
    orderDetailMod.resolveState(merged, 'passenger') === 'P4');
  expect('F7n — driver view is D4 after cancel + sync',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  // Order has order_canceled lockedReason (precedence rule from 01D-2C-B).
  expect('F7n — lockedReason is order_canceled',
    merged.lockedReason === 'order_canceled');
  // No fixture offer remains sent.
  const stillSent = merged.offers.filter((o) => o.status === 'sent');
  expect('F7n — no sent offer survives the cancel sync',
    stillSent.length === 0);
  // Driver D4 markup
  const driverMarkup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F7n — driver D4 markup shows «Заказ отменён»',
    driverMarkup.includes('Заказ отменён'));
  expect('F7n — driver D4 markup excludes D2 affordances',
    !driverMarkup.includes('Оффер отправлен')
    && !driverMarkup.includes('Отозвать оффер')
    && !driverMarkup.includes('Изменить оффер'));
  // bazardrive.active_ride.v1 never written across the whole flow.
  expect('F7n — bazardrive.active_ride.v1 is NOT written during cancel + sync',
    !_bdofs.has('bazardrive.active_ride.v1'));
}

// ── F7o — stored-only sent offer (NOT in snapshot) still gets rejected ─
// Regression pin for the bucket-vs-snapshot bug: if another tab / role
// writes a sent DriverOffer into `bazardrive.driver_offers.v1` AFTER
// the current Order Detail screen rendered, the caller's snapshot
// won't include it. The sync must still pick it up from the stored
// bucket; otherwise that stored-only sent offer would stay `sent`
// after the passenger cancel and surface on the driver side as a
// stale D2.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Seed a stored sent offer for the order under test, AND a stored
  // sent offer for an unrelated order (cross-order isolation guard).
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'cancel-sync-test-o': {
      'drv-stored-only': mkOffer('cancel-sync-test-o', 'drv-stored-only', 'sent'),
    },
    'cancel-sync-test-o-other': {
      'drv-other-order': mkOffer('cancel-sync-test-o-other', 'drv-other-order', 'sent'),
    },
  }));
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-o' });
  // Critical: caller passes an EMPTY snapshot — the screen never saw
  // the stored sent offer (the live row was injected after render).
  const result = driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-o',
    allOffers: [],
  });
  expect('F7o — sync flips the stored-only sent offer even with empty snapshot',
    Array.isArray(result) && result.length === 1
    && result[0].driverId === 'drv-stored-only'
    && result[0].status === 'rejected'
    && result[0].rejectedBy === 'passenger_cancel'
    && result[0].rejectedReason === 'order_canceled_by_passenger');
  const storedAfter = driverOfferStore.getDriverOffer('cancel-sync-test-o', 'drv-stored-only');
  expect('F7o — stored-only sent offer is persisted as rejected (passenger_cancel)',
    storedAfter?.status === 'rejected'
    && storedAfter?.rejectedBy === 'passenger_cancel'
    && storedAfter?.rejectedReason === 'order_canceled_by_passenger');
  // Cross-order stored sent offer remains sent.
  const otherAfter = driverOfferStore.getDriverOffer('cancel-sync-test-o-other', 'drv-other-order');
  expect('F7o — stored sent offer for a different orderId stays sent',
    otherAfter?.status === 'sent');
  expect('F7o — sync does NOT seed bazardrive.active_ride.v1 in the stored-only path',
    !_bdofs.has('bazardrive.active_ride.v1'));
}

// ── F7p — mixed stored + snapshot candidates merge without duplication ─
// When the snapshot includes the same driverId as a stored entry, the
// stored baseline wins (matches the commit/reject helpers' stale-store
// guard). When the snapshot includes a NEW driverId for the same
// order, the snapshot fallback applies. The merge must not produce
// duplicate writes and must respect terminal statuses on either side.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  _bdofs.set('bazardrive.driver_offers.v1', JSON.stringify({
    'cancel-sync-test-p': {
      // Stored sent — present in both snapshot AND bucket.
      'drv-both-sent':  mkOffer('cancel-sync-test-p', 'drv-both-sent',  'sent'),
      // Stored withdrawn — present only in bucket. Must stay verbatim.
      'drv-stored-w':   mkOffer('cancel-sync-test-p', 'drv-stored-w',   'withdrawn'),
      // Stored sent — present only in bucket (not in snapshot). Must flip.
      'drv-stored-only-2': mkOffer('cancel-sync-test-p', 'drv-stored-only-2', 'sent'),
    },
  }));
  driverOfferStore.cancelOrderByPassenger({ orderId: 'cancel-sync-test-p' });
  const result = driverOfferStore.rejectSentOffersForPassengerCanceledOrder({
    orderId: 'cancel-sync-test-p',
    allOffers: [
      // Same driverId as one stored entry — stored baseline wins.
      mkOffer('cancel-sync-test-p', 'drv-both-sent', 'sent'),
      // Snapshot-only fixture-style entry (no store baseline).
      mkOffer('cancel-sync-test-p', 'drv-snapshot-only', 'sent'),
    ],
  });
  expect('F7p — sync flips 3 distinct candidates (both, stored-only, snapshot-only)',
    Array.isArray(result) && result.length === 3);
  const driverIds = result.map((o) => o.driverId).sort();
  expect('F7p — rejected driverIds are the three eligible candidates, deduplicated',
    JSON.stringify(driverIds) === JSON.stringify(
      ['drv-both-sent', 'drv-snapshot-only', 'drv-stored-only-2']));
  expect('F7p — stored withdrawn peer preserved verbatim',
    driverOfferStore.getDriverOffer('cancel-sync-test-p', 'drv-stored-w')?.status === 'withdrawn');
  for (const driverId of ['drv-both-sent', 'drv-stored-only-2', 'drv-snapshot-only']) {
    const stored = driverOfferStore.getDriverOffer('cancel-sync-test-p', driverId);
    expect(`F7p — ${driverId} persisted as passenger_cancel rejected`,
      stored?.status === 'rejected'
      && stored?.rejectedBy === 'passenger_cancel'
      && stored?.rejectedReason === 'order_canceled_by_passenger');
  }
}

// ── F8a–F8l. Assigned-driver «Отменить» on D3 (01D-2D) ──────────────
// Closes the last deferred Model-B mutation: when the driver currently
// assigned to an ACCEPTED order taps cancel from D3, the order overlay
// flips to `status='CANCELED'` + `canceledBy='driver'`. The assigned
// `selectedDriverId` is preserved on the overlay so the passenger view
// can render the explicit «Водитель отменил заказ.» copy on P4. The
// accepted DriverOffer stays `accepted` (the helper does not roll it
// back to sent/rejected), and `bazardrive.active_ride.v1` is never
// touched by this path.

expect('F8 — driver_offer_store exports cancelOrderByDriver',
  typeof driverOfferStore.cancelOrderByDriver === 'function');

// ── F8a — happy path: cancel commits a CANCELED overlay with driver actor ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Seed an ACCEPTED overlay with SELF as the assigned driver. Real
  // flow: a prior 01D-2A commit landed this state.
  seedOrderWithOffers('driver-cancel-test-a', [
    mkOffer('driver-cancel-test-a', orderDetailMod.SELF_DRIVER_ID, 'sent'),
    mkOffer('driver-cancel-test-a', 'drv-peer-rejected', 'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'driver-cancel-test-a',
    selectedDriverId: orderDetailMod.SELF_DRIVER_ID,
    allOffers: driverOfferStore.listDriverOffersForOrder('driver-cancel-test-a'),
  });
  const result = driverOfferStore.cancelOrderByDriver({
    orderId: 'driver-cancel-test-a',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F8a — cancelOrderByDriver returns the canceled overlay record',
    !!result
    && result.status === 'CANCELED'
    && result.canceledBy === 'driver'
    && typeof result.canceledAt === 'string' && result.canceledAt.length > 0
    && typeof result.updatedAt === 'string' && result.updatedAt.length > 0);
  const overlay = driverOfferStore.getOrderOverlay('driver-cancel-test-a');
  expect('F8a — overlay carries the canceled record + driver actor',
    !!overlay
    && overlay.status === 'CANCELED'
    && overlay.canceledBy === 'driver');
  expect('F8a — selectedDriverId preserved across driver cancel',
    overlay.selectedDriverId === orderDetailMod.SELF_DRIVER_ID);
  // Accepted DriverOffer stays accepted (not rolled back to sent/rejected).
  const accepted = driverOfferStore.getDriverOffer('driver-cancel-test-a', orderDetailMod.SELF_DRIVER_ID);
  expect('F8a — accepted SELF offer remains accepted after driver cancel',
    accepted?.status === 'accepted');
  // Peer that was flipped to rejected by the prior commit stays rejected.
  const peer = driverOfferStore.getDriverOffer('driver-cancel-test-a', 'drv-peer-rejected');
  expect('F8a — peer rejected (from prior commit) stays rejected',
    peer?.status === 'rejected');
}

// ── F8b — driver cancel is idempotent on any prior cancel actor ─────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('driver-cancel-test-b', [
    mkOffer('driver-cancel-test-b', orderDetailMod.SELF_DRIVER_ID, 'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'driver-cancel-test-b',
    selectedDriverId: orderDetailMod.SELF_DRIVER_ID,
    allOffers: driverOfferStore.listDriverOffersForOrder('driver-cancel-test-b'),
  });
  const first = driverOfferStore.cancelOrderByDriver({
    orderId: 'driver-cancel-test-b',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const second = driverOfferStore.cancelOrderByDriver({
    orderId: 'driver-cancel-test-b',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F8b — second driver cancel returns the same record (idempotent)',
    !!second
    && second.status === 'CANCELED'
    && second.canceledBy === 'driver'
    && second.canceledAt === first.canceledAt
    && second.updatedAt === first.updatedAt);
}

// ── F8c — driver cancel refuses to overwrite a passenger cancel ─────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('driver-cancel-test-c', [
    mkOffer('driver-cancel-test-c', orderDetailMod.SELF_DRIVER_ID, 'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'driver-cancel-test-c',
    selectedDriverId: orderDetailMod.SELF_DRIVER_ID,
    allOffers: driverOfferStore.listDriverOffersForOrder('driver-cancel-test-c'),
  });
  // Passenger cancels first.
  driverOfferStore.cancelOrderByPassenger({ orderId: 'driver-cancel-test-c' });
  const overlayBefore = driverOfferStore.getOrderOverlay('driver-cancel-test-c');
  // Driver tries to cancel — helper returns the existing passenger cancel verbatim.
  const result = driverOfferStore.cancelOrderByDriver({
    orderId: 'driver-cancel-test-c',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F8c — helper returns the existing passenger-cancel record verbatim',
    !!result
    && result.canceledBy === 'passenger'
    && result.canceledAt === overlayBefore.canceledAt);
  const overlayAfter = driverOfferStore.getOrderOverlay('driver-cancel-test-c');
  expect('F8c — overlay actor stays passenger (driver did NOT overwrite)',
    overlayAfter?.canceledBy === 'passenger');
}

// ── F8d — refuses when overlay pins a foreign selectedDriverId ──────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  seedOrderWithOffers('driver-cancel-test-d', [
    mkOffer('driver-cancel-test-d', 'drv-other', 'sent'),
  ]);
  driverOfferStore.commitPassengerSelection({
    orderId: 'driver-cancel-test-d',
    selectedDriverId: 'drv-other',
    allOffers: driverOfferStore.listDriverOffersForOrder('driver-cancel-test-d'),
  });
  // SELF was never the assigned driver — helper must refuse.
  const result = driverOfferStore.cancelOrderByDriver({
    orderId: 'driver-cancel-test-d',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F8d — helper refuses cancel from a non-assigned driver',
    result === null);
  const overlay = driverOfferStore.getOrderOverlay('driver-cancel-test-d');
  expect('F8d — overlay stays ACCEPTED (no foreign-driver cancel landed)',
    overlay?.status === 'ACCEPTED'
    && overlay?.selectedDriverId === 'drv-other');
}

// ── F8e — fixture-only ACCEPTED (no prior overlay) requires accepted-assignment proof ─
// demo-order-accepted carries selectedDriverId=SELF in the fixture but
// has no overlay record. The helper writes a fresh CANCELED overlay
// only when the caller supplies a valid order snapshot proving the
// assignment (`id` / `status='ACCEPTED'` / `selectedDriverId === driverId`).
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const merged = orderDetailMod.loadOrder('demo-order-accepted');
  const result = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-accepted',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: merged,
  });
  expect('F8e — driver cancel succeeds on fixture-only ACCEPTED with valid proof',
    !!result
    && result.status === 'CANCELED'
    && result.canceledBy === 'driver');
  expect('F8e — overlay pins selectedDriverId = SELF from the caller',
    result.selectedDriverId === orderDetailMod.SELF_DRIVER_ID);
}

// ── F8f — passenger view resolves P4 with «Водитель отменил заказ.» ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Use demo-order-accepted (fixture ACCEPTED with selectedDriverId=SELF).
  // The helper requires the accepted-assignment proof since there's no
  // prior overlay.
  const initial = orderDetailMod.loadOrder('demo-order-accepted');
  driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-accepted',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: initial,
  });
  const merged = orderDetailMod.loadOrder('demo-order-accepted');
  expect('F8f — passenger view resolves to P4 after driver cancel',
    orderDetailMod.resolveState(merged, 'passenger') === 'P4');
  expect('F8f — merged order surfaces canceledBy="driver" from overlay',
    merged.canceledBy === 'driver');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'passenger', state: 'P4' });
  expect('F8f — passenger P4 markup shows «Водитель отменил заказ.»',
    markup.includes('Водитель отменил заказ.'));
  expect('F8f — passenger P4 markup does NOT show generic «Заказ отменён.»',
    !markup.includes('Заказ отменён.'));
  for (const forbidden of ['Открыть поездку', 'Выбрать водителя', 'Отклонить']) {
    expect(`F8f — passenger P4 markup does NOT carry «${forbidden}»`,
      !markup.includes(forbidden));
  }
  expect('F8f — passenger P4 markup keeps terminal exits',
    markup.includes('Создать новый заказ') && markup.includes('Вернуться в ленту'));
}

// ── F8g — driver view resolves D4 with no D3 active CTAs ────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const initial = orderDetailMod.loadOrder('demo-order-accepted');
  driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-accepted',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: initial,
  });
  const merged = orderDetailMod.loadOrder('demo-order-accepted');
  expect('F8g — driver view resolves to D4 after driver cancel',
    orderDetailMod.resolveState(merged, 'driver') === 'D4');
  expect('F8g — lockedReason is order_canceled (canonical D4 reason)',
    merged.lockedReason === 'order_canceled');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D4' });
  expect('F8g — driver D4 markup shows «Заказ отменён»',
    markup.includes('Заказ отменён'));
  for (const forbidden of [
    'Начать подачу',
    'Открыть активную поездку',
    'Откликнуться на заказ',
    'Оффер отправлен',
  ]) {
    expect(`F8g — driver D4 markup does NOT carry «${forbidden}»`,
      !markup.includes(forbidden));
  }
  // The «Отменить» button in D3 must also be gone (D4 doesn't render it).
  expect('F8g — driver D4 markup carries no driver-cancel CTA',
    !/data-action="driver-cancel"/.test(markup));
}

// ── F8h — safe-key guards on cancelOrderByDriver ────────────────────
{
  expect('F8h — cancelOrderByDriver refuses __proto__ orderId',
    driverOfferStore.cancelOrderByDriver({ orderId: '__proto__', driverId: 'd' }) === null);
  expect('F8h — cancelOrderByDriver refuses constructor orderId',
    driverOfferStore.cancelOrderByDriver({ orderId: 'constructor', driverId: 'd' }) === null);
  expect('F8h — cancelOrderByDriver refuses prototype orderId',
    driverOfferStore.cancelOrderByDriver({ orderId: 'prototype', driverId: 'd' }) === null);
  expect('F8h — cancelOrderByDriver refuses __proto__ driverId',
    driverOfferStore.cancelOrderByDriver({ orderId: 'x', driverId: '__proto__' }) === null);
  expect('F8h — cancelOrderByDriver refuses empty orderId / driverId',
    driverOfferStore.cancelOrderByDriver({ orderId: '', driverId: 'd' }) === null
    && driverOfferStore.cancelOrderByDriver({ orderId: 'x', driverId: '' }) === null);
  expect('F8h — cancelOrderByDriver refuses missing args',
    driverOfferStore.cancelOrderByDriver() === null
    && driverOfferStore.cancelOrderByDriver({}) === null);
  expect('Object.prototype is NOT polluted by cancelOrderByDriver attempts',
    Object.prototype.canceledBy === undefined);
}

// ── F8i — active_ride store is NEVER seeded by the driver cancel path ─
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  const initial = orderDetailMod.loadOrder('demo-order-accepted');
  driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-accepted',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: initial,
  });
  expect('F8i — bazardrive.active_ride.v1 is NOT written by driver cancel',
    !_bdofs.has('bazardrive.active_ride.v1'));
}

// ── F8j — existing active_ride record is NOT overwritten ────────────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Pre-seed the active_ride store with a sentinel record. The driver
  // cancel must not mutate it (the store-helper-level invariant).
  const sentinel = JSON.stringify({
    'trip-pre-existing': { tripId: 'trip-pre-existing', status: 'driver_en_route', _marker: 'unchanged' },
  });
  _bdofs.set('bazardrive.active_ride.v1', sentinel);
  const initial = orderDetailMod.loadOrder('demo-order-accepted');
  driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-accepted',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: initial,
  });
  expect('F8j — pre-existing active_ride record is preserved verbatim',
    _bdofs.get('bazardrive.active_ride.v1') === sentinel);
}

// ── F8k — driver-cancel click handler is gated + uses 2-step confirm ─
expect('F8k — driver-cancel handler gates on role === "driver"',
  /driver-cancel[\s\S]{0,2500}role\s*!==\s*['"]driver['"]/.test(orderDetailSrc));
expect('F8k — driver-cancel handler requires status === ACCEPTED',
  /driver-cancel[\s\S]{0,2500}status\s*!==\s*ORDER_STATUS\.ACCEPTED/.test(orderDetailSrc));
expect('F8k — driver-cancel handler requires selectedDriverId === SELF',
  /driver-cancel[\s\S]{0,2500}selectedDriverId\s*!==\s*SELF_DRIVER_ID/.test(orderDetailSrc));
expect('F8k — driver-cancel handler uses 2-step armed pattern',
  /driver-cancel[\s\S]{0,2500}dataset\.armed/.test(orderDetailSrc));
expect('F8k — driver-cancel handler commits via cancelOrderByDriver',
  /driver-cancel[\s\S]{0,2500}cancelOrderByDriver\s*\(/.test(orderDetailSrc));
// Bound-extract the driver-cancel block via its unique armed-prompt
// notice so the assertions don't drag.
const driverCancelMatch = orderDetailSrc.match(
  /action\s*===\s*['"]driver-cancel['"][\s\S]*?showNotice\(rootEl,\s*['"]Заказ отменён['"]\)/);
const driverCancelBlock = driverCancelMatch ? driverCancelMatch[0] : '';
expect('F8k — driver-cancel block resolved', driverCancelBlock.length > 0);
expect('F8k — driver-cancel handler validates result.canceledBy === "driver" before success',
  /result\.canceledBy\s*!==\s*['"]driver['"]/.test(driverCancelBlock));
expect('F8k — driver-cancel handler never seeds active_ride',
  !/saveActiveRide\s*\(/.test(driverCancelBlock));
expect('F8k — driver-cancel handler never calls passenger sync helpers',
  !/rejectSentOffersForPassengerCanceledOrder\s*\(/.test(driverCancelBlock)
  && !/cancelOrderByPassenger\s*\(/.test(driverCancelBlock)
  && !/rejectDriverOfferByPassenger\s*\(/.test(driverCancelBlock));

// ── F8l — driver_offer_store cancelOrderByDriver stays in scope ─────
const offerStoreSrcF8 = read('../public/src/driver_offer_store.js');
const offerStoreCodeF8 = stripComments(offerStoreSrcF8);
expect('F8l — cancelOrderByDriver never writes active_ride',
  !/cancelOrderByDriver[\s\S]{0,2500}saveActiveRide\s*\(/.test(offerStoreCodeF8)
  && !/cancelOrderByDriver[\s\S]{0,2500}active_ride\.v1/.test(offerStoreCodeF8));
expect('F8l — cancelOrderByDriver never writes the DriverOffer store',
  !/cancelOrderByDriver[\s\S]{0,2500}saveStore\s*\(/.test(offerStoreCodeF8));
expect('F8l — cancelOrderByDriver stamps canceledBy=driver',
  /cancelOrderByDriver[\s\S]{0,2500}canceledBy[\s\S]{0,200}['"]driver['"]/.test(offerStoreCodeF8));
expect('F8l — cancelOrderByDriver preserves selectedDriverId',
  /cancelOrderByDriver[\s\S]{0,2500}selectedDriverId[\s\S]{0,200}bucket\.selectedDriverId/.test(offerStoreCodeF8));

// ── F8m — D3 markup still carries the «Отменить» CTA pre-cancel ─────
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Fresh demo-order-accepted with no overlay — driver is on D3.
  const merged = orderDetailMod.loadOrder('demo-order-accepted');
  expect('F8m baseline — driver state is D3 for the canonical fixture',
    orderDetailMod.resolveState(merged, 'driver') === 'D3');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'driver', state: 'D3' });
  expect('F8m — D3 markup exposes the driver-cancel CTA',
    /data-action="driver-cancel"/.test(markup)
    && markup.includes('Отменить'));
}

// ── F8n — direct cancelOrderByDriver on a non-assigned order is refused ─
// Regression pin for the no-overlay path bug: a direct call with a
// safe orderId + SELF driverId on a CREATED order (no overlay yet,
// no real assignment) could previously pin a CANCELED overlay onto
// the order. The helper now requires an accepted-assignment proof.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // demo-order-1 is CREATED in the fixture, no SELF assignment.
  // Direct call WITHOUT order proof must refuse.
  const noProof = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  expect('F8n — direct cancel on CREATED order without proof returns null',
    noProof === null);
  expect('F8n — no overlay was written for the refused cancel',
    driverOfferStore.getOrderOverlay('demo-order-1') === null);
  const fresh = orderDetailMod.loadOrder('demo-order-1');
  expect('F8n — passenger view stays P1 (no spurious cancel landed)',
    orderDetailMod.resolveState(fresh, 'passenger') === 'P1');
  expect('F8n — driver view stays D1 (no spurious cancel landed)',
    orderDetailMod.resolveState(fresh, 'driver') === 'D1');
  // Even when the caller forges a snapshot, the proof must match
  // reality — order.status must be ACCEPTED and selectedDriverId
  // must equal driverId. A forged CREATED snapshot is refused.
  const forgedCreated = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: { id: 'demo-order-1', status: 'CREATED', selectedDriverId: orderDetailMod.SELF_DRIVER_ID },
  });
  expect('F8n — forged CREATED snapshot is refused', forgedCreated === null);
  // Mismatched id is refused.
  const forgedId = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: { id: 'other-order-id', status: 'ACCEPTED', selectedDriverId: orderDetailMod.SELF_DRIVER_ID },
  });
  expect('F8n — forged snapshot with mismatched id is refused', forgedId === null);
  // Foreign selectedDriverId snapshot is refused.
  const forgedDriver = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: { id: 'demo-order-1', status: 'ACCEPTED', selectedDriverId: 'drv-other' },
  });
  expect('F8n — forged snapshot with foreign selectedDriverId is refused',
    forgedDriver === null);
  // Non-object snapshot is refused.
  expect('F8n — non-plain-object snapshot is refused',
    driverOfferStore.cancelOrderByDriver({
      orderId: 'demo-order-1',
      driverId: orderDetailMod.SELF_DRIVER_ID,
      order: 'not-an-object',
    }) === null
    && driverOfferStore.cancelOrderByDriver({
      orderId: 'demo-order-1',
      driverId: orderDetailMod.SELF_DRIVER_ID,
      order: null,
    }) === null);
  // Valid ACCEPTED + SELF snapshot is accepted.
  const valid = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-1',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: { id: 'demo-order-1', status: 'ACCEPTED', selectedDriverId: orderDetailMod.SELF_DRIVER_ID },
  });
  expect('F8n — valid accepted-assignment snapshot is accepted',
    !!valid && valid.status === 'CANCELED' && valid.canceledBy === 'driver');
  // Click-handler source pin: handler passes order: ctx.order through.
  expect('F8n — driver-cancel click handler passes order: ctx.order to the helper',
    /cancelOrderByDriver\s*\(\s*\{[\s\S]{0,400}order:\s*ctx\.order/.test(orderDetailSrc));
}

// ── F8o — cancelOrderByPassenger preserves a driver-canceled overlay ─
// Regression pin for the passenger-overwrite bug: a stale passenger
// tab landing behind a driver cancel previously overwrote the overlay
// to canceledBy='passenger', losing the driver actor + canceledAt.
// cancelOrderByPassenger is now idempotent on ANY existing CANCELED
// overlay regardless of actor.
{
  _bdofs.clear();
  driverOfferStore.clearDriverOfferStore();
  // Driver cancel lands first on a fixture-only ACCEPTED order.
  const fresh = orderDetailMod.loadOrder('demo-order-accepted');
  const driverResult = driverOfferStore.cancelOrderByDriver({
    orderId: 'demo-order-accepted',
    driverId: orderDetailMod.SELF_DRIVER_ID,
    order: fresh,
  });
  expect('F8o baseline — driver cancel landed',
    driverResult?.status === 'CANCELED' && driverResult?.canceledBy === 'driver');
  // Stale passenger tab confirms cancel.
  const passengerResult = driverOfferStore.cancelOrderByPassenger({
    orderId: 'demo-order-accepted',
  });
  expect('F8o — passenger cancel returns the existing driver-canceled record verbatim',
    !!passengerResult
    && passengerResult.status === 'CANCELED'
    && passengerResult.canceledBy === 'driver'
    && passengerResult.canceledAt === driverResult.canceledAt
    && passengerResult.updatedAt === driverResult.updatedAt);
  const overlay = driverOfferStore.getOrderOverlay('demo-order-accepted');
  expect('F8o — overlay actor stays driver (passenger did NOT overwrite)',
    overlay?.canceledBy === 'driver'
    && overlay?.canceledAt === driverResult.canceledAt
    && overlay?.updatedAt === driverResult.updatedAt);
  // Passenger P4 copy still reflects driver actor.
  const merged = orderDetailMod.loadOrder('demo-order-accepted');
  const markup = orderDetailMod.renderOrderDetailMarkup(
    { order: merged, role: 'passenger', state: 'P4' });
  expect('F8o — passenger P4 copy still shows «Водитель отменил заказ.»',
    markup.includes('Водитель отменил заказ.'));
  expect('F8o — passenger P4 copy does NOT regress to generic «Заказ отменён.»',
    !markup.includes('Заказ отменён.'));
}

// ── F3. EXPIRED orders still resolve to D4 (no offer surface) ──────
{
  driverOfferStore.clearDriverOfferStore();
  // Even if a driver had managed to send an offer earlier, the order
  // going EXPIRED must dominate state resolution: D4 unavailability
  // wins over a stale own-sent merge.
  driverOfferStore.sendDriverOffer({
    orderId: 'demo-order-expired',
    driverId: orderDetailMod.SELF_DRIVER_ID,
  });
  const expired = orderDetailMod.loadOrder('demo-order-expired');
  expect('EXPIRED order with a self-sent stored offer still resolves to D4',
    orderDetailMod.resolveState(expired, 'driver') === 'D4');
}

// ── F4. Malformed id still falls through to S2 even with store hits ─
{
  driverOfferStore.clearDriverOfferStore();
  driverOfferStore.sendDriverOffer({ orderId: '%E0%A4%A', driverId: 'd' });
  const parsed = orderDetailMod.parseOrderHashPath('#/order/%E0%A4%A?role=driver');
  expect('malformed id still decodes to null in 01D-1', parsed.id === null);
  expect('malformed id still resolves to S2 (loadOrder=null wins over the store)',
    orderDetailMod.resolveState(orderDetailMod.loadOrder(parsed.id), 'driver') === 'S2');
}

// ── F5. Storage boundary clears the new store ──────────────────────
const boundarySrc = read('../public/src/storage_boundary.js');
expect('storage_boundary.js imports clearDriverOfferStore',
  /import\s*\{\s*clearDriverOfferStore\s*\}\s*from\s*['"]\.\/driver_offer_store\.js['"]/.test(boundarySrc));
expect('clearUserScopedStorage calls clearDriverOfferStore',
  /clearUserScopedStorage[\s\S]{0,2000}clearDriverOfferStore\s*\(/.test(boundarySrc));

// ── F6. SW precaches the new store + VERSION bumped to ≥ v115 ──────
// Floor lifted to v115 for BD-ORDER-DETAIL-01D-2D because this slice
// modifies the same two precached runtime modules (`order_detail.js`
// + `driver_offer_store.js`) again — the driver-cancel handler now
// imports the new `cancelOrderByDriver` helper, the loadOrder merges
// `canceledBy` into the base, and bodyP4 differentiates the terminal
// copy by actor. Without the bump, existing PWA clients on v114 would
// keep serving the old cached JS.
expect('public/sw.js precaches driver_offer_store.js',
  /\.\/src\/driver_offer_store\.js/.test(swJs));
expect('public/sw.js precaches order_detail.js',
  /\.\/src\/screens\/order_detail\.js/.test(swJs));
expect('public/sw.js VERSION bumped to v115+ for the 01D-2D runtime module changes',
  Number(swJs.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 115);

// ── F7. driver_offer_store.js is out-of-scope-clean (no fetch/Mapbox) ─
const offerStoreSrc = read('../public/src/driver_offer_store.js');
expect('driver_offer_store.js never calls fetch(',
  !/\bfetch\s*\(/.test(offerStoreSrc));
// Strip comments so the file's own "No backend, no Mapbox, no fetch"
// disclaimer doesn't trip the case-insensitive scan.
const offerStoreSrcNoComments = stripComments(offerStoreSrc);
expect('driver_offer_store.js never references mapbox in code',
  !/mapbox/i.test(offerStoreSrcNoComments));
// Comment-strip so a "deliberately does NOT seed
// bazardrive.active_ride.v1" disclaimer added in BD-ORDER-DETAIL-01D-2A
// to document the commit boundary doesn't trip the literal scan.
expect('driver_offer_store.js never writes the active_ride store (code-only)',
  !/active_ride\.v1/.test(offerStoreSrcNoComments));

// ── G. screen-map.md mirrors the runtime-shell entry ─────────────────
const mapPath = new URL('../docs/screen-map.md', import.meta.url);
let mapPresent = false;
try { fs.accessSync(mapPath); mapPresent = true; } catch {}
if (mapPresent) {
  const screenMap = fs.readFileSync(mapPath, 'utf8');
  expect('docs/screen-map.md lists BD-ORDER-DETAIL-01 as runtime shell present',
    /BD-ORDER-DETAIL-01/.test(screenMap)
    && /BD-ORDER-DETAIL-01[\s\S]{0,2400}P0/.test(screenMap)
    && /BD-ORDER-DETAIL-01[\s\S]{0,2400}runtime\s+shell\s+present/i.test(screenMap)
    && /BD-ORDER-DETAIL-01[\s\S]{0,2400}Model\s+B[\s\S]{0,240}lock/i.test(screenMap)
    && /BD-ORDER-DETAIL-01[\s\S]{0,2400}01D\s+writes\s+landed/i.test(screenMap)
    && !/BD-ORDER-DETAIL-01[\s\S]{0,2400}\bmissing\s+runtime\b/i.test(screenMap)
    && !/BD-ORDER-DETAIL-01[\s\S]{0,2400}(unresolved|нерешён)[\s\S]{0,240}«Принять»/i.test(screenMap));

  // ── G-stale. BD-ORDER-DETAIL-01D-DOC-G regression guard: every stale
  // 01C-era phrase that PR #482 refreshed away must NOT reappear inside
  // the BD-ORDER-DETAIL-01 row. Each phrase is asserted as a separate
  // negative pin so a regression names the exact wording that drifted
  // back.
  //
  // Codex P2 review fix on #483 — extract the EXACT BD-ORDER-DETAIL-01
  // markdown row (one line in the screens table) and scan that line
  // only. The earlier `[\s\S]{0,2400}` window could spill into adjacent
  // planned-screen rows and false-positive when another row legitimately
  // used a phrase like "writes pending". Bounding to the single row
  // eliminates that drift without weakening the guard.
  const orderDetailRow = screenMap
    .split(/\r?\n/)
    .find((line) => /^\|\s*BD-ORDER-DETAIL-01\s*\|/.test(line));
  expect(
    'G-stale — BD-ORDER-DETAIL-01 row located in screen-map.md',
    typeof orderDetailRow === 'string' && orderDetailRow.length > 0);
  const orderDetailRowLc = (orderDetailRow || '').toLowerCase();
  const STALE_PHRASES = [
    'writes pending',
    'Writes: none',
    'Writes: **none**',
    'non-mutating stubs',
    'отложены до BD-ORDER-DETAIL-01D',
    'Действие будет подключено в 01D',
    'Оффер будет подключён в 01D',
  ];
  for (const phrase of STALE_PHRASES) {
    expect(
      `G-stale — BD-ORDER-DETAIL-01 row in screen-map.md does NOT contain "${phrase}"`,
      !orderDetailRowLc.includes(phrase.toLowerCase()));
  }
} else {
  expect('docs/screen-map.md not present — skipping mirrored entry check', true);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
