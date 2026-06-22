// BD-INBOX-03 — static regression smoke for the inbox screen contract.
//
// /inbox is wired in public/src/app.js, rendered by
// public/src/screens/inbox.js, seeded by public/src/mock_api.js and
// precached by public/sw.js — but, like the passenger active-ride screen
// before BD-RIDE-P-12, none of that was pinned by an executable guard. A
// future refactor could silently drop a tab key, break the defensive copy
// in listInboxItems(), rename a data-* hook the screen's event delegation
// depends on, seed a mock item whose status has no label/tone, introduce an
// external (non-"/") href, or remove the precache entry — and
// `node scripts/check.mjs` would still pass.
//
// This script is intentionally STATIC: it reads the four source files and
// asserts the contract still holds in source. No browser, no DOM, no jsdom,
// no Playwright, no network — only file reads and source assertions.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const app     = read('../public/src/app.js');
const index   = read('../public/index.html');
const inbox   = read('../public/src/screens/inbox.js');
const mockApi = read('../public/src/mock_api.js');
const sw      = read('../public/sw.js');
const dailyStore = read('../public/src/daily_communication_store.js');
const dailyScreen = read('../public/src/screens/daily_communication.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a function body by name via brace matching, so an assertion
// scoped to one function doesn't accidentally inspect another. Skips the
// parameter list first so an object-default param is not mistaken for the
// body's opening brace.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) return null;
  const paren = source.indexOf('(', start);
  if (paren === -1) return null;
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') {
      pdepth--;
      if (pdepth === 0) { afterParams = i + 1; break; }
    }
  }
  if (afterParams === -1) return null;
  const open = source.indexOf('{', afterParams);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

// Extract a `[ ... ]` literal body assigned to `const NAME = [`.
function arrayBody(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  return m ? m[1] : null;
}

// Extract a `{ ... }` literal body assigned to `export const NAME = {`.
function objectBody(source, name) {
  const m = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  return m ? m[1] : null;
}

// Collect capture-group 1 across every match of a global regex.
function collect(re, body) {
  const out = [];
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

// ── A. app.js wiring ─────────────────────────────────────────
expect('app.js imports inbox from ./screens/inbox.js',
  /import\s+inbox\s+from\s+'\.\/screens\/inbox\.js'/.test(app));
expect("app.js registers register('/inbox', inbox)",
  /register\(\s*'\/inbox'\s*,\s*inbox\s*\)/.test(app));

// ── B. inbox.js — TABS exact keys ────────────────────────────
const tabsBody = arrayBody(inbox, 'TABS');
expect('inbox.js TABS array resolved', !!tabsBody);
for (const key of ['all', 'responses', 'messages', 'rides']) {
  expect(`TABS contains key '${key}'`,
    new RegExp(`key:\\s*'${key}'`).test(tabsBody || ''));
}
const tabKeyCount = tabsBody ? (tabsBody.match(/key:/g) || []).length : 0;
expect('TABS has exactly 4 keys (no extra tabs)', tabKeyCount === 4, 'count=' + tabKeyCount);

// ── C. inbox.js — imports from mock_api.js ───────────────────
expect('inbox.js imports listInboxItems, INBOX_STATUS_LABEL, INBOX_STATUS_TONE from ../mock_api.js',
  /import\s*\{[\s\S]*?listInboxItems[\s\S]*?INBOX_STATUS_LABEL[\s\S]*?INBOX_STATUS_TONE[\s\S]*?\}\s*from\s*'\.\.\/mock_api\.js'/.test(inbox));

// ── D. inbox.js — scoped function-body contracts ─────────────
const resolveActiveTabBody = functionBody(inbox, 'resolveActiveTab') || '';
expect('resolveActiveTab() body resolved', resolveActiveTabBody.length > 0);
expect("resolveActiveTab() falls back unknown tab to 'all'",
  /\?\s*raw\s*:\s*'all'/.test(resolveActiveTabBody));

const filterItemsBody = functionBody(inbox, 'filterItems') || '';
expect('filterItems() body resolved', filterItemsBody.length > 0);
expect("filterItems() returns all items for 'all'",
  /tab === 'all'\s*\?\s*items\s*:/.test(filterItemsBody));
expect('filterItems() filters by item.tab for other tabs',
  /items\.filter\(\(it\) => it\.tab === tab\)/.test(filterItemsBody));

const unreadCountBody = functionBody(inbox, 'unreadCount') || '';
expect('unreadCount() body resolved', unreadCountBody.length > 0);
expect('unreadCount() counts item.unread',
  /reduce\(/.test(unreadCountBody) && /it\.unread/.test(unreadCountBody));

const renderStatusBody = functionBody(inbox, 'renderStatus') || '';
expect('renderStatus() body resolved', renderStatusBody.length > 0);
expect('renderStatus() uses INBOX_STATUS_LABEL[item.status]',
  /INBOX_STATUS_LABEL\[item\.status\]/.test(renderStatusBody));
expect('renderStatus() uses INBOX_STATUS_TONE[item.status]',
  /INBOX_STATUS_TONE\[item\.status\]/.test(renderStatusBody));

const renderItemBody = functionBody(inbox, 'renderItem') || '';
expect('renderItem() body resolved', renderItemBody.length > 0);
for (const hook of ['data-inbox-id', 'data-href', 'role="button"', 'tabindex="0"', 'aria-label=']) {
  expect(`renderItem() card has ${hook}`, renderItemBody.includes(hook));
}

const renderActionsBody = functionBody(inbox, 'renderActions') || '';
expect('renderActions() body resolved', renderActionsBody.length > 0);
for (const hook of ['data-inbox-action="primary"', 'data-inbox-action="secondary"', 'data-href']) {
  expect(`renderActions() has ${hook}`, renderActionsBody.includes(hook));
}

const setActiveTabBody = functionBody(inbox, 'setActiveTab') || '';
expect('setActiveTab() body resolved', setActiveTabBody.length > 0);
expect("setActiveTab() sets hash '#/inbox' for the 'all' tab",
  /activeTab === 'all'\s*\?\s*'#\/inbox'/.test(setActiveTabBody));
expect('setActiveTab() sets hash #/inbox?tab=<tab> for other tabs',
  /#\/inbox\?tab=\$\{activeTab\}/.test(setActiveTabBody));

// ── D2. category chips are a filter GROUP (#732) — demoted from the incomplete
// role="tab"/aria-selected pattern to role="group" + aria-pressed (they filter ONE
// role="feed" region, not switchable panels; matches /feed). ──
expect('the inbox chip row is a role="group" filter set (not a fake tablist)',
  /class="feed-chip-row" role="group"/.test(inbox) && !/role="tablist"/.test(inbox));
expect('inbox chip markup declares aria-pressed (active tab), not role="tab"',
  /aria-pressed="\$\{t\.key === activeTab \? 'true' : 'false'\}"/.test(inbox) && !/\brole="tab"/.test(inbox));
expect('the inbox chip handler keeps aria-pressed in sync',
  /setAttribute\('aria-pressed',\s*isActive \? 'true' : 'false'\)/.test(inbox));

// ── E. inbox.js — empty state + interaction (unique hooks) ───
expect('empty state exposes data-inbox-empty-cta="feed"',
  inbox.includes('data-inbox-empty-cta="feed"'));
expect("empty CTA click routes to /feed via go('/feed')",
  /data-inbox-empty-cta[\s\S]{0,200}go\('\/feed'\)/.test(inbox));
expect('keydown handler reacts only to Enter and Space',
  /e\.key !== 'Enter' && e\.key !== ' '/.test(inbox));
expect('Enter/Space opens the card fallback href',
  /openHref\(card\.dataset\.href\)/.test(inbox));

// ── F. mock_api.js — exports ─────────────────────────────────
expect('mock_api.js exports listInboxItems',
  /export\s+(?:async\s+)?function\s+listInboxItems/.test(mockApi));
expect('mock_api.js exports INBOX_STATUS_LABEL',
  /export\s+const\s+INBOX_STATUS_LABEL\s*=/.test(mockApi));
expect('mock_api.js exports INBOX_STATUS_TONE',
  /export\s+const\s+INBOX_STATUS_TONE\s*=/.test(mockApi));

// ── G. mock_api.js — seed data contract ──────────────────────
const itemsBody = arrayBody(mockApi, 'INBOX_ITEMS_V1') || '';
expect('INBOX_ITEMS_V1 array resolved', itemsBody.length > 0);

for (const tab of ['responses', 'messages', 'rides']) {
  expect(`INBOX_ITEMS_V1 has at least one '${tab}' item`,
    new RegExp(`tab:\\s*'${tab}'`).test(itemsBody));
}
expect('INBOX_ITEMS_V1 has at least one unread:true item',
  /unread:\s*true/.test(itemsBody));

const ALLOWED_KIND = ['response', 'message', 'ride'];
const kinds = collect(/kind:\s*'(\w+)'/g, itemsBody);
expect('INBOX_ITEMS_V1 exposes kind values', kinds.length > 0);
const badKinds = [...new Set(kinds.filter((k) => !ALLOWED_KIND.includes(k)))];
expect('every item.kind is one of response|message|ride',
  badKinds.length === 0, 'unexpected=' + JSON.stringify(badKinds));

const ALLOWED_TAB = ['responses', 'messages', 'rides'];
const tabs = collect(/tab:\s*'(\w+)'/g, itemsBody);
expect('INBOX_ITEMS_V1 exposes tab values', tabs.length > 0);
const badTabs = [...new Set(tabs.filter((t) => !ALLOWED_TAB.includes(t)))];
expect('every item.tab is one of responses|messages|rides',
  badTabs.length === 0, 'unexpected=' + JSON.stringify(badTabs));

const labelBody = objectBody(mockApi, 'INBOX_STATUS_LABEL') || '';
const toneBody  = objectBody(mockApi, 'INBOX_STATUS_TONE') || '';
expect('INBOX_STATUS_LABEL object body resolved', labelBody.length > 0);
expect('INBOX_STATUS_TONE object body resolved', toneBody.length > 0);
const statuses = [...new Set(collect(/status:\s*'(\w+)'/g, itemsBody))];
expect('INBOX_ITEMS_V1 exposes status values', statuses.length > 0);
const missingLabel = statuses.filter((s) => !new RegExp(`${s}:`).test(labelBody));
const missingTone  = statuses.filter((s) => !new RegExp(`${s}:`).test(toneBody));
expect('every item.status has an INBOX_STATUS_LABEL entry',
  missingLabel.length === 0, 'missing=' + JSON.stringify(missingLabel));
expect('every item.status has an INBOX_STATUS_TONE entry',
  missingTone.length === 0, 'missing=' + JSON.stringify(missingTone));

const hrefs = collect(/href:\s*'([^']*)'/g, itemsBody);
expect('INBOX_ITEMS_V1 exposes href values', hrefs.length > 0);
const externalHrefs = [...new Set(hrefs.filter((h) => !h.startsWith('/')))];
expect('every primary/secondary/fallback href is an internal route (starts with "/")',
  externalHrefs.length === 0, 'external=' + JSON.stringify(externalHrefs));

// ── H. mock_api.js — defensive copy ──────────────────────────
const listBody = functionBody(mockApi, 'listInboxItems') || '';
expect('listInboxItems() body resolved', listBody.length > 0);
expect('listInboxItems() returns a defensive per-item copy (map + spread)',
  /INBOX_ITEMS_V1\.map\(/.test(listBody) && /\{\s*\.\.\.\s*item\s*\}/.test(listBody));

// ── I. sw.js — precache ──────────────────────────────────────
expect('sw.js PRECACHE includes ./src/screens/inbox.js',
  /['"]\.\/src\/screens\/inbox\.js['"]/.test(sw));

// ── J. BD-DAILY-COMM-01 — Daily Communication UI/store slice ─
expect('app.js imports dailyCommunication from ./screens/daily_communication.js',
  /import\s+dailyCommunication\s+from\s+'\.\/screens\/daily_communication\.js'/.test(app));
expect("app.js registers register('/daily-communication', dailyCommunication)",
  /register\(\s*'\/daily-communication'\s*,\s*dailyCommunication\s*\)/.test(app));
expect('index.html links ./styles/daily_communication.css',
  /href=["']\.\/styles\/daily_communication\.css["']/.test(index));
expect('daily store documents communication_threads and communication_messages',
  /communication_threads/.test(dailyStore) && /communication_messages/.test(dailyStore));
expect('daily store reuses audited bazardrive.chat.v1 key',
  /const\s+CHAT_KEY\s*=\s*'bazardrive\.chat\.v1'/.test(dailyStore)
  && !/bazardrive\.daily_communication\.v1/.test(dailyStore));
for (const exported of ['listDailyCommunicationThreads', 'sendDailyCommunicationMessage', 'acknowledgeDailyCommunication', 'resolveDailyCommunication', 'clearDailyCommunicationStore']) {
  expect(`daily store exports ${exported}`,
    new RegExp(`export\\s+function\\s+${exported}\\s*\\(`).test(dailyStore));
}
for (const status of ['OPEN', 'ACK_REQUIRED', 'NEEDS_ACTION', 'ACKNOWLEDGED', 'RESOLVED']) {
  expect(`daily store carries status ${status}`, dailyStore.includes(status));
}
expect('daily store does not mutate ride/order lifecycle',
  !/updateTripStatus|acceptOrder|acceptNearbyOrder|saveActiveRideStore|RIDE_STATUS\./.test(dailyStore));
expect('daily screen imports the daily communication store',
  /from\s+'\.\.\/daily_communication_store\.js'/.test(dailyScreen));
expect('daily screen renders screen--daily-communication root',
  dailyScreen.includes('screen--daily-communication'));
for (const hook of ['data-dc-tab', 'data-dc-thread-id', 'data-dc-action', 'data-dc-template', 'data-dc-input', 'data-dc-send', 'data-dc-open-route']) {
  expect(`daily screen exposes ${hook}`, dailyScreen.includes(hook));
}
expect('daily screen back action returns to /inbox', /go\('\/inbox'\)/.test(dailyScreen));
expect('daily screen linked CTAs navigate through go(href)', /go\(href\)/.test(dailyScreen));
for (const asset of ['./styles/daily_communication.css', './src/daily_communication_store.js', './src/screens/daily_communication.js']) {
  expect(`sw.js PRECACHE includes ${asset}`, sw.includes(asset));
}
console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
