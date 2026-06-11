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
expect('driver-send-offer path writes the DriverOffer store (sendDriverOffer)',
  /driver-send-offer[\s\S]{0,800}sendDriverOffer\s*\(/.test(orderDetailSrc));
expect('withdraw-offer path uses withdrawDriverOffer (no Order/selectedDriverId mutation)',
  /withdraw-offer[\s\S]{0,800}withdrawDriverOffer\s*\(/.test(orderDetailSrc)
  && !/withdraw-offer[\s\S]{0,800}Order\.status\s*=/.test(orderDetailSrc)
  && !/withdraw-offer[\s\S]{0,800}selectedDriverId\s*=/.test(orderDetailSrc));
expect('order_detail.js still never seeds active_ride in 01D-1',
  !/saveActiveRide\s*\(/.test(orderDetailSrc)
  && !/updateActiveRideStatus\s*\(/.test(orderDetailSrc)
  && !/active_ride\.v1/.test(orderDetailSrc));

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
  expect('F3j — order_detail.js select-driver path never seeds active_ride',
    !/select-driver[\s\S]{0,2000}saveActiveRide\s*\(/.test(orderDetailSrc)
    && !/select-driver[\s\S]{0,2000}updateActiveRideStatus\s*\(/.test(orderDetailSrc)
    && !/select-driver[\s\S]{0,2000}active_ride\.v1/.test(orderDetailSrc));
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

// ── F6. SW precaches the new store + VERSION bumped to ≥ v112 ──────
expect('public/sw.js precaches driver_offer_store.js',
  /\.\/src\/driver_offer_store\.js/.test(swJs));
expect('public/sw.js VERSION bumped to v112+ for the new store',
  Number(swJs.match(/VERSION\s*=\s*'v(\d+)'/)?.[1] || 0) >= 112);

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
