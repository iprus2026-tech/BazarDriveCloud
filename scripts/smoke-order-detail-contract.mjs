// BD-ORDER-DETAIL-01C — Order Detail runtime-shell smoke.
//
// This smoke is the post-gate version of the Order Detail guard: /order/<id>
// and order_detail.js are now expected to exist. The checks below keep the
// Model B contract locked while the first runtime shell remains read/render
// only and all mutating writes stay deferred to BD-ORDER-DETAIL-01D.

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
expect('order_detail.js carries deferred-write stub toasts',
  /Действие будет подключено в 01D/.test(orderDetailSrc)
  && /Оффер будет подключён в 01D/.test(orderDetailSrc));
expect('driver-send-offer path never mutates order / selectedDriverId / DriverOffer',
  !/driver-send-offer[\s\S]{0,500}Order\.status\s*=/.test(orderDetailSrc)
  && !/driver-send-offer[\s\S]{0,500}selectedDriverId\s*=/.test(orderDetailSrc)
  && !/saveDriverOffer\s*\(/.test(orderDetailSrc));
expect('order_detail.js never seeds active_ride in 01C',
  !/saveActiveRide\s*\(/.test(orderDetailSrc)
  && !/updateActiveRideStatus\s*\(/.test(orderDetailSrc));

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
    && /BD-ORDER-DETAIL-01[\s\S]{0,2400}writes\s+pending/i.test(screenMap)
    && !/BD-ORDER-DETAIL-01[\s\S]{0,2400}\bmissing\s+runtime\b/i.test(screenMap)
    && !/BD-ORDER-DETAIL-01[\s\S]{0,2400}(unresolved|нерешён)[\s\S]{0,240}«Принять»/i.test(screenMap));
} else {
  expect('docs/screen-map.md not present — skipping mirrored entry check', true);
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
