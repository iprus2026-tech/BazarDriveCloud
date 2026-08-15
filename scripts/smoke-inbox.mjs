// BD-INBOX-03 / BD-CLOUD-DESIGN-LOADING-02F — static regression smoke for
// the Inbox hub, including the list-owned read-state boundary and deterministic
// fixtures. STATIC only: no browser, DOM, jsdom, Playwright, network or backend.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const app      = read('../public/src/app.js');
const chat     = read('../public/src/screens/chat.js');
const index    = read('../public/index.html');
const inbox    = read('../public/src/screens/inbox.js');
const mockApi  = read('../public/src/mock_api.js');
const sw       = read('../public/sw.js');
const css      = read('../public/styles/cloud.css');
const inboxCss = read('../public/styles/inbox_02f.css');
const dailyStore = read('../public/src/daily_communication_store.js');
const dailyScreen = read('../public/src/screens/daily_communication.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

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

function arrayBody(source, name) {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  return m ? m[1] : null;
}

function objectBody(source, name) {
  const m = source.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  return m ? m[1] : null;
}

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
expect('setActiveTab() preserves existing query params while changing tab',
  /new URLSearchParams/.test(setActiveTabBody)
  && /params\.delete\('tab'\)/.test(setActiveTabBody)
  && /params\.set\('tab',\s*activeTab\)/.test(setActiveTabBody));
expect('setActiveTab() rebuilds #/inbox hash without dropping fixture/prompt params',
  /const\s+nextHash\s*=\s*query\s*\?\s*`#\/inbox\?\$\{query\}`\s*:\s*'#\/inbox'/.test(setActiveTabBody));

// ── D2. category chips are a filter GROUP (#732) ─────────────
expect('the inbox chip row is a role="group" filter set (not a fake tablist)',
  /class="feed-chip-row" role="group"/.test(inbox) && !/role="tablist"/.test(inbox));
expect('inbox chip markup declares aria-pressed (active tab), not role="tab"',
  /aria-pressed="\$\{t\.key === activeTab \? 'true' : 'false'\}"/.test(inbox) && !/\brole="tab"/.test(inbox));
expect('the inbox chip handler keeps aria-pressed in sync',
  /setAttribute\('aria-pressed',\s*isActive \? 'true' : 'false'\)/.test(inbox));

// ── E. inbox.js — empty state + interaction (unique hooks) ───
expect('empty state exposes data-inbox-empty-cta="feed"', inbox.includes('data-inbox-empty-cta="feed"'));
expect("empty CTA normal-runtime click routes to /feed via go('/feed')",
  /data-inbox-empty-cta[\s\S]{0,220}go\('\/feed'\)/.test(inbox));
expect('keydown handler reacts only to Enter and Space',
  /e\.key !== 'Enter' && e\.key !== ' '/.test(inbox));
expect('Enter/Space opens the card fallback href',
  /openHref\(card\.dataset\.href\)/.test(inbox));

// ── F. mock_api.js — exports ─────────────────────────────────
expect('mock_api.js exports listInboxItems', /export\s+(?:async\s+)?function\s+listInboxItems/.test(mockApi));
expect('mock_api.js exports INBOX_STATUS_LABEL', /export\s+const\s+INBOX_STATUS_LABEL\s*=/.test(mockApi));
expect('mock_api.js exports INBOX_STATUS_TONE', /export\s+const\s+INBOX_STATUS_TONE\s*=/.test(mockApi));

// ── G. mock_api.js — seed data contract ──────────────────────
const itemsBody = arrayBody(mockApi, 'INBOX_ITEMS_V1') || '';
expect('INBOX_ITEMS_V1 array resolved', itemsBody.length > 0);
for (const tab of ['responses', 'messages', 'rides']) {
  expect(`INBOX_ITEMS_V1 has at least one '${tab}' item`, new RegExp(`tab:\\s*'${tab}'`).test(itemsBody));
}
expect('INBOX_ITEMS_V1 has at least one unread:true item', /unread:\s*true/.test(itemsBody));

const ALLOWED_KIND = ['response', 'message', 'ride'];
const kinds = collect(/kind:\s*'(\w+)'/g, itemsBody);
expect('INBOX_ITEMS_V1 exposes kind values', kinds.length > 0);
const badKinds = [...new Set(kinds.filter((k) => !ALLOWED_KIND.includes(k)))];
expect('every item.kind is one of response|message|ride', badKinds.length === 0, 'unexpected=' + JSON.stringify(badKinds));

const ALLOWED_TAB = ['responses', 'messages', 'rides'];
const tabs = collect(/tab:\s*'(\w+)'/g, itemsBody);
expect('INBOX_ITEMS_V1 exposes tab values', tabs.length > 0);
const badTabs = [...new Set(tabs.filter((t) => !ALLOWED_TAB.includes(t)))];
expect('every item.tab is one of responses|messages|rides', badTabs.length === 0, 'unexpected=' + JSON.stringify(badTabs));

const labelBody = objectBody(mockApi, 'INBOX_STATUS_LABEL') || '';
const toneBody  = objectBody(mockApi, 'INBOX_STATUS_TONE') || '';
expect('INBOX_STATUS_LABEL object body resolved', labelBody.length > 0);
expect('INBOX_STATUS_TONE object body resolved', toneBody.length > 0);
const statuses = [...new Set(collect(/status:\s*'(\w+)'/g, itemsBody))];
expect('INBOX_ITEMS_V1 exposes status values', statuses.length > 0);
const missingLabel = statuses.filter((s) => !new RegExp(`${s}:`).test(labelBody));
const missingTone  = statuses.filter((s) => !new RegExp(`${s}:`).test(toneBody));
expect('every item.status has an INBOX_STATUS_LABEL entry', missingLabel.length === 0, 'missing=' + JSON.stringify(missingLabel));
expect('every item.status has an INBOX_STATUS_TONE entry', missingTone.length === 0, 'missing=' + JSON.stringify(missingTone));

const hrefs = collect(/href:\s*'([^']*)'/g, itemsBody);
expect('INBOX_ITEMS_V1 exposes href values', hrefs.length > 0);
const externalHrefs = [...new Set(hrefs.filter((h) => !h.startsWith('/')))];
expect('every primary/secondary/fallback href is an internal route (starts with "/")', externalHrefs.length === 0, 'external=' + JSON.stringify(externalHrefs));

// ── H. mock_api.js — defensive copy ──────────────────────────
const listBody = functionBody(mockApi, 'listInboxItems') || '';
expect('listInboxItems() body resolved', listBody.length > 0);
expect('listInboxItems() returns a defensive per-item copy (map + spread)',
  /INBOX_ITEMS_V1\.map\(/.test(listBody) && /\{\s*\.\.\.\s*item\s*\}/.test(listBody));

// ── I. sw.js — precache + current monotonic cache pin ─────────
expect('sw.js PRECACHE includes ./src/screens/inbox.js', /['"]\.\/src\/screens\/inbox\.js['"]/.test(sw));
expect('sw.js PRECACHE includes ./styles/inbox_02f.css', /['"]\.\/styles\/inbox_02f\.css['"]/.test(sw));
expect('index.html loads the scoped Inbox 02F stylesheet', /href=["']\.\/styles\/inbox_02f\.css["']/.test(index));
expect('current service worker VERSION follows the driver sheet layering repair to v289', /const\s+VERSION\s*=\s*'v289'/.test(sw));

// ── I2. BD-CLOUD-DESIGN-LOADING-02F read-state contract ──────
const inboxBody = functionBody(inbox, 'inbox') || '';
const refreshInboxBody = functionBody(inbox, 'refreshInbox') || '';
const openHrefBody = functionBody(inbox, 'openHref') || '';
const fixtureItemsBody = arrayBody(inbox, 'FIXTURE_ITEMS') || '';
const renderListBody = functionBody(inbox, 'renderList') || '';
const renderPromptBody = functionBody(inbox, 'renderPrompt') || '';
const updateTopbarBody = functionBody(inbox, 'updateTopbar') || '';
const clearTopbarBody = functionBody(inbox, 'clearTopbarSummary') || '';
const captureFocusBody = functionBody(inbox, 'captureScreenFocus') || '';
const restoreFocusBody = functionBody(inbox, 'restoreScreenFocus') || '';

expect('Inbox fixture vocabulary is exactly loading|loaded|empty|error',
  /const\s+INBOX_FIXTURES\s*=\s*new Set\(\s*\[\s*'loading'\s*,\s*'loaded'\s*,\s*'empty'\s*,\s*'error'\s*\]\s*\)/.test(inbox));
expect('Inbox loader is synchronous so shell can mount before initial read settles',
  /export\s+default\s+function\s+inbox\s*\(/.test(inbox) && !/export\s+default\s+async\s+function\s+inbox/.test(inbox));
expect('initial read starts after the read-body + prompt host are resolved',
  inbox.indexOf("refreshInbox('initial')") > inbox.indexOf("const listEl = root.querySelector('.inbox-read-body')")
  && inbox.indexOf("refreshInbox('initial')") > inbox.indexOf("const promptHost = root.querySelector('[data-inbox-prompt-host]')"));
expect('only the inner read-body owns aria-busy and skeleton settlement',
  /class="bd-scroll inbox-list"/.test(inbox)
  && /class="inbox-read-body" role="feed" aria-label="События" aria-busy="true" tabindex="-1"/.test(inbox)
  && /listEl\.setAttribute\('aria-busy',\s*'true'\)/.test(renderListBody)
  && /listEl\.setAttribute\('aria-busy',\s*'false'\)/.test(renderListBody)
  && /function renderLoadingSkeleton\(\)/.test(inbox));
expect('loading skeleton has a polite status outside aria-hidden bones',
  /role="status" aria-live="polite"[\s\S]*Загружаем входящие/.test(inbox)
  && /aria-hidden="true"/.test(functionBody(inbox, 'renderLoadingSkeleton') || ''));
expect('failed read is distinguishable from genuine empty via local sentinel fallback',
  /const\s+INBOX_READ_FAILED\s*=\s*Symbol/.test(inbox)
  && /fallback:\s*INBOX_READ_FAILED/.test(refreshInboxBody)
  && /result === INBOX_READ_FAILED/.test(refreshInboxBody));
expect('in-list error exposes a real Повторить button', /data-inbox-retry/.test(inbox) && /Повторить/.test(inbox));
expect('retry repeats only the Inbox read through refreshInbox(retry)',
  /refreshInbox\('retry'\)/.test(inbox) && /loadResource\(listInboxItems/.test(refreshInboxBody));
expect('normal refresh keeps usable content on failure instead of re-skeletoning',
  /const\s+hadUsableContent\s*=\s*readState === 'loaded' \|\| readState === 'empty'/.test(refreshInboxBody)
  && /if\s*\(result === INBOX_READ_FAILED\)[\s\S]*?if\s*\(hadUsableContent\)/.test(refreshInboxBody));
expect('refresh work is single-flight + epoch guarded',
  /if\s*\(fixtureMode \|\| readPending\) return/.test(refreshInboxBody)
  && /const\s+epoch\s*=\s*\+\+readEpoch/.test(refreshInboxBody)
  && /if\s*\(epoch !== readEpoch\) return/.test(refreshInboxBody));
expect('loadResource gets an Inbox route activity guard so stale loads do not raise overlay on another screen',
  /isActive:\s*\(\) => \(window\.location\.hash \|\| ''\)\.startsWith\('#\/inbox'\)/.test(refreshInboxBody));
expect('recognized fixtures bypass demo seeding and real Inbox reads',
  /if\s*\(!fixtureMode\)\s*ensureDemoResponseOrder\(\)/.test(inboxBody)
  && /if\s*\(fixtureMode \|\| readPending\) return/.test(refreshInboxBody));
expect('fixture navigation is inert through openHref()', /if\s*\(!href \|\| fixtureMode\) return/.test(openHrefBody));
expect('fixture empty CTA is disabled and normal empty copy is reused',
  /renderEmpty\(activeTab, fixtureMode\)/.test(inbox)
  && /disabled aria-disabled="true"/.test(functionBody(inbox, 'renderEmpty') || ''));
expect('feed skeleton shimmer atom reused by Inbox respects reduced motion',
  /\.feed-skeleton__line[\s\S]*?animation:\s*feed-skeleton-shimmer/.test(css)
  && /prefers-reduced-motion: reduce[\s\S]*?feed-skeleton__line[\s\S]*?animation:\s*none/.test(css));
expect('02F does not introduce polling/realtime timers in Inbox read orchestration',
  !/setInterval\s*\(/.test(inbox) && !/WebSocket|EventSource/.test(inbox));

expect('final audit repair removes loading/error request-state copy from the topbar',
  /readState === 'loading' \|\| readState === 'error'/.test(updateTopbarBody)
  && /clearTopbarSummary\(\)/.test(updateTopbarBody)
  && /subEl\.textContent\s*=\s*'\\u00a0'/.test(clearTopbarBody)
  && !/Загружаем|Не удалось/.test(updateTopbarBody));
expect('push prompt is a stable sibling and read-state rendering never replaces its host',
  /class="inbox-prompt-host" data-inbox-prompt-host/.test(inbox)
  && /promptHost\.innerHTML/.test(renderPromptBody)
  && !/promptHtml|promptHost/.test(renderListBody));
expect('normal error retains Daily Communication while stable prompt remains outside read-body',
  /if\s*\(readState === 'error'\)/.test(renderListBody)
  && /listEl\.innerHTML\s*=\s*daily\s*\+\s*renderReadError\(false\)/.test(renderListBody));
expect('prompt controls have unique focus keys including the two semantic later controls',
  /data-notif-prompt="later" data-notif-focus="close"/.test(inbox)
  && /data-notif-prompt="later" data-notif-focus="later"/.test(inbox)
  && /data-notif-prompt="enable" data-notif-focus="enable"/.test(inbox));
expect('focus snapshot/restore uses unique prompt focus key and preserves outside focus',
  /promptHost\.contains\(promptControl\)/.test(captureFocusBody)
  && /key:\s*promptControl\.dataset\.notifFocus/.test(captureFocusBody)
  && /!listEl\.contains\(active\)/.test(captureFocusBody)
  && /node\.dataset\.notifFocus === snapshot\.key/.test(restoreFocusBody));
expect('successful refresh snapshots focus at settlement and restores after read-body render',
  /const\s+focusSnapshot\s*=\s*captureScreenFocus\(\)[\s\S]*?renderList\(\)[\s\S]*?restoreScreenFocus\(focusSnapshot\)/.test(refreshInboxBody));
expect('final audit repair keeps badge geometry in a scoped slot while preserving unread-only visibility',
  /class="inbox-unread-slot"/.test(inbox)
  && /class="bd-badge accent inbox-unread-badge" data-inbox-unread-badge hidden/.test(inbox)
  && !/inbox-unread-badge"[^>]*style=/.test(inbox)
  && /\.screen--inbox\s+\.inbox-unread-slot\s*\{[\s\S]*?width:\s*36px;[\s\S]*?min-width:\s*36px;[\s\S]*?flex-shrink:\s*0;[\s\S]*?\}/.test(inboxCss)
  && /\.screen--inbox\s+\.inbox-read-body\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?\}/.test(inboxCss));
expect('02F loaded message fixture uses representative actor/role metadata without duplicate Сообщение copy',
  /id:\s*'inbox-fixture-message'[\s\S]{0,180}actor:\s*'Алексей М\.'[\s\S]{0,120}actorRole:\s*'Водитель'/.test(fixtureItemsBody)
  && !/id:\s*'inbox-fixture-message'[\s\S]{0,220}actorRole:\s*'Сообщение'/.test(fixtureItemsBody));

// ── J. BD-DAILY-COMM-01 — Daily Communication UI/store slice ─
expect('app.js imports dailyCommunication from ./screens/daily_communication.js',
  /import\s+dailyCommunication\s+from\s+'\.\/screens\/daily_communication\.js'/.test(app));
expect("app.js registers register('/daily-communication', dailyCommunication)",
  /register\(\s*'\/daily-communication'\s*,\s*dailyCommunication\s*\)/.test(app));
expect('index.html links ./styles/daily_communication.css', /href=["']\.\/styles\/daily_communication\.css["']/.test(index));
expect('daily store documents communication_threads and communication_messages', /communication_threads/.test(dailyStore) && /communication_messages/.test(dailyStore));
expect('daily store reuses audited bazardrive.chat.v1 key',
  /const\s+CHAT_KEY\s*=\s*'bazardrive\.chat\.v1'/.test(dailyStore) && !/bazardrive\.daily_communication\.v1/.test(dailyStore));
for (const exported of ['listDailyCommunicationThreads', 'sendDailyCommunicationMessage', 'acknowledgeDailyCommunication', 'resolveDailyCommunication', 'clearDailyCommunicationStore']) {
  expect(`daily store exports ${exported}`, new RegExp(`export\\s+function\\s+${exported}\\s*\\(`).test(dailyStore));
}
for (const status of ['OPEN', 'ACK_REQUIRED', 'NEEDS_ACTION', 'ACKNOWLEDGED', 'RESOLVED']) {
  expect(`daily store carries status ${status}`, dailyStore.includes(status));
}
expect('daily store does not mutate ride/order lifecycle', !/updateTripStatus|acceptOrder|acceptNearbyOrder|saveActiveRideStore|RIDE_STATUS\./.test(dailyStore));
expect('daily screen imports the daily communication store', /from\s+'\.\.\/daily_communication_store\.js'/.test(dailyScreen));
expect('daily screen renders screen--daily-communication root', dailyScreen.includes('screen--daily-communication'));
for (const hook of ['data-dc-tab', 'data-dc-thread-id', 'data-dc-action', 'data-dc-template', 'data-dc-input', 'data-dc-send', 'data-dc-open-route']) {
  expect(`daily screen exposes ${hook}`, dailyScreen.includes(hook));
}
expect('daily screen back action returns to /inbox', /go\('\/inbox'\)/.test(dailyScreen));
expect('daily screen linked CTAs navigate through go(href)', /go\(href\)/.test(dailyScreen));
for (const asset of ['./styles/daily_communication.css', './src/daily_communication_store.js', './src/screens/daily_communication.js']) {
  expect(`sw.js PRECACHE includes ${asset}`, sw.includes(asset));
}

// ── K. BD-DAILY-COMM-01 — review blocker pins ─────────────────
const loadChatStoreBody = functionBody(chat, 'loadChatStore') || '';
expect('chat.js does not import daily_communication_store.js', !/daily_communication_store\.js/.test(chat));
expect('chat.js legacy migration preserves unknown top-level keys',
  /const\s*\{\s*chatId\s*,\s*messages\s*,\s*\.\.\.rest\s*\}\s*=\s*data/.test(loadChatStoreBody)
  && /return\s*\{\s*\.\.\.rest\s*,\s*\[chatId\]\s*:\s*messages\s*\}/.test(loadChatStoreBody));
const saveMessagesBody = functionBody(chat, 'saveMessages') || '';
expect('chat.js saveMessages helper exists', saveMessagesBody.length > 0);
expect('chat.js saveMessages clones existing store', /const\s+next\s*=\s*\{\s*\.\.\.store\s*\}/.test(saveMessagesBody));
expect('chat.js appendMessage calls saveMessages(chatId, arr, store)', /saveMessages\(\s*chatId\s*,\s*arr\s*,\s*store\s*\)/.test(functionBody(chat, 'appendMessage') || ''));
expect('chat.js persistMessageInOrder calls saveMessages(chatId, arr, store)', /saveMessages\(\s*chatId\s*,\s*arr\s*,\s*store\s*\)/.test(functionBody(chat, 'persistMessageInOrder') || ''));

const acknowledgeBody = functionBody(dailyStore, 'acknowledgeDailyCommunication') || '';
const ackGuardIndex = acknowledgeBody.indexOf('!ACK_ACTIONABLE_STATUSES.has(thread.status)');
const ackMutationIndex = acknowledgeBody.indexOf("thread.status = 'ACKNOWLEDGED'");
expect('daily store declares ACK_ACTIONABLE_STATUSES for ACK_REQUIRED / NEEDS_ACTION',
  /const\s+ACK_ACTIONABLE_STATUSES\s*=\s*new Set\(\s*\[\s*'ACK_REQUIRED'\s*,\s*'NEEDS_ACTION'\s*\]\s*\)/.test(dailyStore));
expect('acknowledgeDailyCommunication no-ops non-actionable statuses before mutation',
  /if\s*\(\s*!ACK_ACTIONABLE_STATUSES\.has\(thread\.status\)\s*\)\s*\{\s*return cloneThread\(thread\);\s*\}/.test(acknowledgeBody));
expect('acknowledgeDailyCommunication keeps ACKNOWLEDGED mutation behind the guard',
  ackGuardIndex !== -1 && ackMutationIndex !== -1 && ackGuardIndex < ackMutationIndex);

const dailyDetailBody = functionBody(dailyScreen, 'renderDetail') || '';
const dailyScreenBody = functionBody(dailyScreen, 'dailyCommunication') || '';
expect('daily screen declares ACK_ACTIONABLE_STATUSES',
  /const\s+ACK_ACTIONABLE_STATUSES\s*=\s*new Set\(\s*\[\s*'ACK_REQUIRED'\s*,\s*'NEEDS_ACTION'\s*\]\s*\)/.test(dailyScreen));
expect('daily screen computes canAck and gates ackButton on it',
  /const\s+canAck\s*=\s*ACK_ACTIONABLE_STATUSES\.has\(thread\.status\)/.test(dailyDetailBody)
  && /const\s+ackButton\s*=\s*canAck/.test(dailyDetailBody));
expect('daily screen does not always render the ack button next to resolve',
  !dailyScreen.includes("<button type='button' class='bd-btn primary sm' data-dc-action='ack'>Принять</button><button"));
expect('daily screen click handler uses explicit actionName branches', dailyScreenBody.includes('const actionName = action.dataset.dcAction;'));
expect('daily screen unknown/non-resolve actions no-op', /else return;/.test(dailyScreenBody));
expect('daily screen ack branch requires actionable status', /actionName === 'ack' && ACK_ACTIONABLE_STATUSES\.has\(selected\.status\)/.test(dailyScreenBody));

expect('inbox.js contains the Daily Communication entry hook', inbox.includes('data-inbox-daily-communication'));
expect('inbox.js contains the Daily Communication route', inbox.includes('/daily-communication'));
expect('inbox.js renders the Daily Communication entry outside mock seed data', /function\s+renderDailyCommunicationEntry\s*\(\)/.test(inbox));
expect('inbox Daily Communication CTA is visual-only, not a nested button', inbox.includes('<span class="bd-btn primary sm inbox-item__btn inbox-item__btn--primary" aria-hidden="true">Открыть</span>'));
expect('inbox click handler opens Daily Communication entry', /addEventListener\('click'[\s\S]*data-inbox-daily-communication[\s\S]*openHref\('\/daily-communication'\)/.test(inbox));
expect('inbox Enter/Space handler opens Daily Communication entry', /addEventListener\('keydown'[\s\S]*data-inbox-daily-communication[\s\S]*openHref\('\/daily-communication'\)/.test(inbox));
expect('inbox entry does not call ride/order lifecycle writers', !/acceptOrder|updateTripStatus|saveActiveRideStore|acceptNearbyOrder|acceptPassengerRequestFromPost/.test(inbox));
expect('mock_api.js does not seed a Daily Communication inbox item', !/\/daily-communication/.test(mockApi));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
