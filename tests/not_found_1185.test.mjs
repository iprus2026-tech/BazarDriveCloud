// #1185 — an address with no screen (`#/nonexistent`) silently rendered the feed and kept the
// wrong path in the address bar. By the owner's decision the /feed loader — which the router
// uses for every unknown path — now answers with a not-found state and one way out.

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
const { unknownRoutePath, readableRoutePath } = await import('../public/src/screens/feed.js');

test('the feed and the bare root forms are home, with or without a query', () => {
  for (const hash of ['#/feed', '#/feed?x=1', '#/', '#', '', '#/feed?tab=trips&q=%D0%B0']) {
    assert.equal(unknownRoutePath(hash), null, hash);
  }
});

test('any other path that reaches the /feed loader is unknown; the query is not part of it', () => {
  assert.equal(unknownRoutePath('#/nonexistent'), '/nonexistent');
  assert.equal(unknownRoutePath('#/nonexistent?x=1'), '/nonexistent');
  assert.equal(unknownRoutePath('#/feeds'), '/feeds');
  assert.equal(unknownRoutePath('#/feed/'), '/feed/');
  assert.equal(unknownRoutePath('#/driver-navigation?tripId=t1&leg=pickup'), '/driver-navigation');
  assert.equal(unknownRoutePath('#nonexistent'), 'nonexistent');
});

test('the shown address is readable text of bounded length', () => {
  assert.equal(readableRoutePath('/nonexistent'), '/nonexistent');
  assert.equal(readableRoutePath('/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82'), '/привет');
  assert.equal(readableRoutePath('/100%'), '/100%', 'a stray percent sign is shown as typed');
  const long = readableRoutePath('/' + 'a'.repeat(200));
  assert.equal(long.length, 61);
  assert.ok(long.endsWith('…'));
  // decoded markup is still only text: the view escapes what it shows
  assert.equal(readableRoutePath('/%3Cimg%20src=x%3E'), '/<img src=x>');
});

test('the /feed loader answers an unknown path before it builds the feed', () => {
  const src = read('../public/src/screens/feed.js');
  assert.match(src, /export default function feed\(renderContext\) \{\s*const unknownPath = unknownRoutePath\(\);\s*if \(unknownPath !== null\) return notFoundView\(unknownPath\);/);
  const view = src.slice(src.indexOf('function notFoundView(path) {'), src.indexOf('export default function feed('));
  assert.match(view, /root\.dataset\.state = 'not-found';/);
  assert.match(view, /\$\{escapeHtml\(shown\)\}/, 'the typed address is escaped');
  assert.doesNotMatch(view, /\$\{(?:path|shown)\}/, 'never interpolated raw');
  assert.match(view, /data-action="not-found-feed">В ленту<\/button>/);
  assert.match(view, /addEventListener\('click', \(\) => go\('\/feed'\)\);/);
  assert.match(view, /role="status"/);
});

test('routing is unchanged: the router still resolves an unknown path to the /feed loader', () => {
  const router = read('../public/src/router.js');
  assert.ok(router.includes("const loader = routes.get(lookupPath) ?? routes.get('/feed');"));
  assert.ok(router.includes("publishRenderedRoute(routes.has(lookupPath) ? lookupPath : '/feed');"));
  assert.doesNotMatch(router, /not-found|notFound/);
  const app = read('../public/src/app.js');
  assert.ok(app.includes("register('/feed',        feed);"));
});
