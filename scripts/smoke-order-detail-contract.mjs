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
expect('driver_offer_store.js never writes the active_ride store',
  !/active_ride\.v1/.test(offerStoreSrc));

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
