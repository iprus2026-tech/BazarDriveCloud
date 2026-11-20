// #1185 — three small interface fixes:
//   · «Поделиться маршрутом» on /route-preview did nothing without the system share sheet;
//   · the driver ride sheet printed the «18 мин» label over the route track;
//   · the driver cancel sheet promised a description for «Другая причина» it never asked for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const { routeShareText } = await import('../public/src/screens/route_preview.js');
const { DRIVER_CANCEL_REASONS, renderDriverCancelSheet } = await import('../public/src/screens/active_ride_driver_sheets.js');

const point = (label) => ({ id: null, label });

test('the shared route is text: both addresses, then the estimate when there is one', () => {
  assert.equal(
    routeShareText({ pickup: point('Тверская улица, 1'), dropoff: point('Арбат, 10'), distanceKm: 11.2, durationMin: 34.4, estimatePriceFrom: 465 }),
    'Маршрут: Тверская улица, 1 → Арбат, 10 · 11 км · 34 мин · от 465 ₽',
  );
  assert.equal(
    routeShareText({ pickup: point(' Дом '), dropoff: point('Работа'), distanceKm: 3.5, durationMin: 9, estimatePriceFrom: 180 }),
    'Маршрут: Дом → Работа · 3.5 км · 9 мин · от 180 ₽',
  );
});

test('a route with no estimate (backend ON) is shared as the two addresses only', () => {
  assert.equal(
    routeShareText({ pickup: point('Дом'), dropoff: point('Работа'), distanceKm: null, durationMin: null, estimatePriceFrom: null }),
    'Маршрут: Дом → Работа',
  );
});

test('an incomplete route has nothing to share', () => {
  assert.equal(routeShareText(null), '');
  assert.equal(routeShareText({ pickup: point('Дом'), dropoff: null }), '');
});

test('«Поделиться маршрутом» is never silent: share sheet, clipboard, or a toast that says why', () => {
  const src = read('../public/src/screens/route_preview.js');
  const fn = src.slice(src.indexOf('async function shareRoute('), src.indexOf('function handleAction('));
  assert.match(fn, /navigator\.share\(\{ title: 'Маршрут', text \}\)/);
  assert.match(fn, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(fn, /showToast\(root, 'Маршрут скопирован'\)/);
  assert.match(fn, /state !== STATE\.VALID[\s\S]*?showToast\(root, 'Сначала выберите маршрут'\)/);
  assert.match(fn, /err\.name === 'AbortError'\) return;/, 'a dismissed share sheet is not an error');
  assert.doesNotMatch(fn, /location\.href/, 'a link to this screen opens empty for anyone else');
  assert.match(src, /toast\.id = 'rpv-toast';/);
  assert.match(src, /toast\.setAttribute\('role', 'status'\);/);
});

test('the route track has its own lane, clear of the time column', () => {
  const css = read('../public/styles/cloud.css');
  const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, `${selector} rule exists`);
    return css.slice(at, css.indexOf('}', at));
  };
  const px = (text, prop) => Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(text)[1]);
  const pointRule = rule('.active-ride__route-point');
  const [, timeColumn] = /grid-template-columns:\s*(\d+)px 1fr/.exec(pointRule);
  const gap = px(pointRule, 'gap');
  const trackLeft = px(rule('.active-ride__route-list::before'), 'left');
  const dotLeft = px(rule('.active-ride__route-point::after'), 'left');
  const dotWidth = px(rule('.active-ride__route-point::after'), 'width');
  assert.ok(dotLeft >= Number(timeColumn), 'the dot starts after the time column ends');
  assert.ok(dotLeft + dotWidth <= Number(timeColumn) + gap, 'the dot ends before the address starts');
  assert.ok(trackLeft > dotLeft && trackLeft < dotLeft + dotWidth, 'the line runs through the dot');
});

test('the driver cancel sheet says the «Другая причина» comment is optional', () => {
  const other = DRIVER_CANCEL_REASONS.find(([code]) => code === 'other');
  assert.deepEqual(other, ['other', 'Другая причина', 'Можно описать ниже']);
  const html = renderDriverCancelSheet('other');
  assert.match(html, /for="driver-cancel-custom">Опишите причину \(необязательно\)<\/label>/);
  assert.doesNotMatch(html, /Опишу подробнее ниже/);
});
