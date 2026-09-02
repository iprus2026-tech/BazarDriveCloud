// BD-ERROR-01C-C / BD-ERROR-02A-b / BD-CLOUD-DESIGN-LOADING-02F-R1 —
// regression smoke for the Inbox error trigger and final audit repairs.
//
// Inbox routes every real data load through the shared data_layer.loadResource
// adapter. 02F mounts the shell before the initial read, keeps the push prompt
// outside the replaceable read-body, and uses one shared load site for initial /
// retry / background refresh. The global overlay remains additive; the read-body
// also owns an honest screen-local error state through the custom fallback sentinel.
//
// No browser, jsdom or network. Small executable harnesses below run the
// production helper bodies against deterministic DOM-shaped stubs.

import fs from 'node:fs';

const inbox = fs.readFileSync(new URL('../public/src/screens/inbox.js', import.meta.url), 'utf8');
const inboxCss = fs.readFileSync(new URL('../public/styles/inbox_02f.css', import.meta.url), 'utf8');
const app   = fs.readFileSync(new URL('../public/src/app.js', import.meta.url), 'utf8');

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

function compileBody(body, parameters) {
  if (!body) return null;
  return new Function(...parameters, body.slice(1, -1));
}

// ── A. inbox delegates to shared data_layer.js ────────────────
expect("inbox.js imports loadResource from ../data_layer.js",
  /import\s*\{\s*loadResource\s*\}\s*from\s*'\.\.\/data_layer\.js'/.test(inbox));
expect('inbox.js no longer defines its own loadInboxItems wrapper (consolidated into data_layer.js)',
  !/function\s+loadInboxItems\s*\(/.test(inbox));
expect('inbox.js no longer imports the overlay adapter directly (it goes through data_layer)',
  !/from\s*'\.\.\/app_error_triggers\.js'/.test(inbox));

// ── B. one shared read site covers initial / retry / background ──
const refreshBody = functionBody(inbox, 'refreshInbox') || '';
expect("initial read is started through refreshInbox('initial') after shell creation",
  /refreshInbox\(\s*'initial'\s*\)/.test(inbox));
expect('refreshInbox routes the Inbox read through loadResource(listInboxItems, …)',
  /loadResource\(\s*listInboxItems\s*,\s*\{/.test(refreshBody)
  && /onRetry:\s*onInboxRetry/.test(refreshBody)
  && /isRetry\s*,/.test(refreshBody));
expect('all real Inbox reads use the single shared loadResource(listInboxItems, …) site',
  (inbox.match(/loadResource\(\s*listInboxItems\s*,/g) || []).length === 1,
  'expected one shared refreshInbox load site');
expect('inbox.js reads the Inbox only through the adapter (no direct listInboxItems() call)',
  (inbox.match(/await\s+listInboxItems\(\)/g) || []).length === 0,
  'listInboxItems is passed by reference to loadResource, never called directly in inbox.js');
expect('02F uses a custom failure sentinel so failed read is not confused with genuine empty',
  /const\s+INBOX_READ_FAILED\s*=\s*Symbol/.test(inbox)
  && /fallback:\s*INBOX_READ_FAILED/.test(refreshBody));

// ── B2. retry closure re-runs the shared load, does not pre-dismiss ──
expect("onInboxRetry re-runs the load as a retry (refreshInbox('retry'))",
  /onInboxRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?refreshInbox\(\s*'retry'\s*\)/.test(inbox));
expect('onInboxRetry does NOT pre-emptively dismiss before the reload result is known',
  !/onInboxRetry\s*=\s*\(\)\s*=>\s*\{[\s\S]*?dismissAppShellError\(\)/.test(inbox));

// ── B3. 02F-R1 executable Retry ownership + fixture semantics ──
const setRetryPendingBody = functionBody(inbox, 'setRetryPending') || '';
const runSetRetryPending = compileBody(setRetryPendingBody, ['listEl', 'pending']);
const retryAttrs = new Map();
const retryButton = {
  disabled: false,
  textContent: '',
  setAttribute(name, value) { retryAttrs.set(name, value); },
};
const listBusyValues = [];
const retryList = {
  setAttribute(name, value) {
    if (name === 'aria-busy') listBusyValues.push(value);
  },
  querySelector(selector) {
    return selector === '[data-inbox-retry]' ? retryButton : null;
  },
};

expect('setRetryPending() body compiles for deterministic execution', typeof runSetRetryPending === 'function');
if (runSetRetryPending) {
  runSetRetryPending(retryList, true);
  expect('Retry pending keeps the read body settled',
    listBusyValues.at(-1) === 'false', 'aria-busy=' + listBusyValues.at(-1));
  expect('Retry pending exposes busy + disabled state on the initiating button',
    retryButton.disabled === true
    && retryAttrs.get('aria-disabled') === 'true'
    && retryAttrs.get('aria-busy') === 'true'
    && retryButton.textContent === 'Повторяем…');

  runSetRetryPending(retryList, false);
  expect('Retry settlement still keeps the read body settled',
    listBusyValues.at(-1) === 'false', 'aria-busy=' + listBusyValues.at(-1));
  expect('Retry settlement restores the same button accessibility state and label',
    retryButton.disabled === false
    && retryAttrs.get('aria-disabled') === 'false'
    && retryAttrs.get('aria-busy') === 'false'
    && retryButton.textContent === 'Повторить');
}

const renderItemBody = functionBody(inbox, 'renderItem') || '';
const runRenderItem = compileBody(renderItemBody, [
  'item',
  'interactive',
  'KIND_GLYPH',
  'KIND_LABEL',
  'INBOX_STATUS_LABEL',
  'escapeHtml',
  'renderStatus',
  'renderRoute',
  'renderActions',
]);
const fixtureLikeItem = {
  id: 'fixture-card',
  kind: 'message',
  actor: 'Алексей М.',
  actorRole: 'Водитель',
  status: '',
  unread: false,
  time: '8 мин',
  route: null,
  summary: 'Тестовое сообщение',
  href: '/chat?id=fixture-card',
};
const escapeStub = (value) => String(value ?? '');
let runtimeCard = '';
let fixtureCard = '';
if (runRenderItem) {
  const args = [
    fixtureLikeItem,
    true,
    { message: 'С' },
    { message: 'Сообщение' },
    {},
    escapeStub,
    () => '',
    () => '',
    () => '',
  ];
  runtimeCard = runRenderItem(...args);
  args[1] = false;
  fixtureCard = runRenderItem(...args);
}
const runtimeOpeningTag = runtimeCard.match(/<article[\s\S]*?>/)?.[0] || '';
const fixtureOpeningTag = fixtureCard.match(/<article[\s\S]*?>/)?.[0] || '';
expect('renderItem() body compiles for deterministic execution', typeof runRenderItem === 'function');
expect('normal-runtime rendered card keeps button semantics and focusability',
  /role="button"/.test(runtimeOpeningTag)
  && /tabindex="0"/.test(runtimeOpeningTag)
  && /data-href="\/chat\?id=fixture-card"/.test(runtimeOpeningTag));
expect('loaded fixture rendered card keeps data identity but is not an enabled control',
  /data-inbox-id="fixture-card"/.test(fixtureOpeningTag)
  && /data-href="\/chat\?id=fixture-card"/.test(fixtureOpeningTag)
  && !/role="button"/.test(fixtureOpeningTag)
  && !/tabindex="0"/.test(fixtureOpeningTag));
expect('renderList explicitly selects non-interactive rendering only for fixture mode',
  /visible\.map\(\(item\) => renderItem\(item, !fixtureMode\)\)\.join\(''\)/.test(functionBody(inbox, 'renderList') || ''));

// ── B4. 02F-R1 executable exact-route / generation / root guard ──
const currentRoutePathBody = functionBody(inbox, 'getCurrentRoutePath') || '';
const currentInstanceBody = functionBody(inbox, 'isCurrentInboxInstance') || '';
const runCurrentRoutePath = compileBody(currentRoutePathBody, ['window']);
const makeCurrentInstance = currentInstanceBody
  ? new Function(
    'isCurrentRender',
    'getCurrentRoutePath',
    'root',
    'appRoot',
    `let hasMounted = false; return function isCurrentInboxInstance() ${currentInstanceBody};`,
  )
  : null;

function guardHarness(overrides = {}) {
  const state = {
    hash: '#/inbox',
    current: true,
    connected: false,
    contained: false,
    parentNode: null,
    childElementCount: 0,
    ...overrides,
  };
  const root = {
    get isConnected() { return state.connected; },
    get parentNode() { return state.parentNode; },
  };
  const appRoot = {
    get childElementCount() { return state.childElementCount; },
    contains(node) { return state.contained && node === root; },
  };
  const windowStub = { location: { get hash() { return state.hash; } } };
  const getCurrentRoutePath = () => runCurrentRoutePath(windowStub);
  const guard = makeCurrentInstance(
    () => state.current,
    getCurrentRoutePath,
    root,
    appRoot,
  );
  return { state, root, appRoot, guard };
}

expect('exact-route and current-instance helper bodies compile for deterministic execution',
  typeof runCurrentRoutePath === 'function' && typeof makeCurrentInstance === 'function');
if (runCurrentRoutePath && makeCurrentInstance) {
  const initial = guardHarness();
  expect('pristine exact-route render is active during synchronous pre-mount handoff',
    initial.guard() === true);

  const detachedParent = guardHarness({ parentNode: {} });
  expect('a root already parented into a detached container cannot impersonate pre-mount',
    detachedParent.guard() === false);

  const mounted = guardHarness({
    hash: '#/inbox?tab=rides',
    connected: true,
    contained: true,
    childElementCount: 1,
  });
  mounted.state.parentNode = mounted.appRoot;
  expect('current mounted /inbox with query parameters remains active', mounted.guard() === true);

  mounted.state.hash = '#/inbox-old';
  expect('prefix lookalike #/inbox-old is rejected by exact-route matching', mounted.guard() === false);

  mounted.state.hash = '#/inbox';
  mounted.state.current = false;
  expect('A→B→A generation invalidation wins even when hash and mounted root still match',
    mounted.guard() === false);

  mounted.state.current = true;
  mounted.state.connected = false;
  mounted.state.contained = false;
  mounted.state.parentNode = null;
  mounted.state.childElementCount = 0;
  expect('a previously mounted root stays stale after it is detached', mounted.guard() === false);

  const replaced = guardHarness({
    connected: true,
    contained: false,
    parentNode: {},
    childElementCount: 1,
  });
  expect('a connected old root not contained by #app is rejected', replaced.guard() === false);
}

expect('the obsolete broad #/inbox prefix predicate is absent',
  !/startsWith\('#\/inbox'\)/.test(inbox));

const awaitedReadIndex = refreshBody.indexOf('const result = await loadResource');
const currentRecheckIndex = refreshBody.indexOf('const stillCurrent = isCurrentInboxInstance()');
const staleReturnIndex = refreshBody.indexOf('if (!stillCurrent || epoch !== readEpoch) return;');
const pendingClearIndex = refreshBody.indexOf('readPending = false');
const retryRestoreIndex = refreshBody.indexOf('setRetryPending(false)');
const resultBranchIndex = refreshBody.indexOf('if (result === INBOX_READ_FAILED)');
const preGuardSettlementSlice = awaitedReadIndex !== -1 && currentRecheckIndex !== -1
  ? refreshBody.slice(awaitedReadIndex, currentRecheckIndex)
  : '';
expect('loadResource and post-await settlement share the same current-instance predicate',
  /isActive:\s*isCurrentInboxInstance/.test(refreshBody)
  && currentRecheckIndex !== -1);
expect('settlement rechecks activity before any state, DOM or focus mutation',
  awaitedReadIndex !== -1
  && currentRecheckIndex > awaitedReadIndex
  && !/readPending\s*=|readState\s*=|setRetryPending\(|listEl\.|captureScreenFocus\(/.test(preGuardSettlementSlice));
expect('current/epoch guard precedes pending release, Retry restoration and both result branches',
  currentRecheckIndex !== -1
  && staleReturnIndex > currentRecheckIndex
  && pendingClearIndex > staleReturnIndex
  && retryRestoreIndex > pendingClearIndex
  && resultBranchIndex > retryRestoreIndex,
  JSON.stringify({
    awaitedReadIndex,
    currentRecheckIndex,
    staleReturnIndex,
    pendingClearIndex,
    retryRestoreIndex,
    resultBranchIndex,
  }));
expect('Retry restoration is result-independent and therefore covers success and failure',
  (refreshBody.match(/setRetryPending\(false\)/g) || []).length === 1
  && /if\s*\(isRetry && readState === 'error'\) setRetryPending\(false\)/.test(refreshBody)
  && retryRestoreIndex < resultBranchIndex);

// ── C. final-audit repairs: request-state boundary, stable prompt, focus ──
const renderListBody = functionBody(inbox, 'renderList') || '';
const renderPromptBody = functionBody(inbox, 'renderPrompt') || '';
const updateTopbarBody = functionBody(inbox, 'updateTopbar') || '';
const clearTopbarBody = functionBody(inbox, 'clearTopbarSummary') || '';
const captureFocusBody = functionBody(inbox, 'captureScreenFocus') || '';
const restoreFocusBody = functionBody(inbox, 'restoreScreenFocus') || '';

expect('request states belong to the inner Inbox read-body, not the topbar or outer scroll shell',
  /class="bd-scroll inbox-list"/.test(inbox)
  && /class="inbox-prompt-host" data-inbox-prompt-host/.test(inbox)
  && /class="inbox-read-body" role="feed" aria-label="События" aria-busy="true" tabindex="-1"/.test(inbox)
  && /const\s+listEl\s*=\s*root\.querySelector\('\.inbox-read-body'\)/.test(inbox));
expect('loading/error topbar is a neutral footprint and exposes no request-state copy',
  /readState === 'loading' \|\| readState === 'error'/.test(updateTopbarBody)
  && /clearTopbarSummary\(\)/.test(updateTopbarBody)
  && /subEl\.textContent\s*=\s*'\\u00a0'/.test(clearTopbarBody)
  && /setAttribute\('aria-hidden',\s*'true'\)/.test(clearTopbarBody)
  && !/Загружаем|Не удалось/.test(updateTopbarBody));

expect('push prompt has a stable host outside the replaceable read-body',
  /const\s+promptHost\s*=\s*root\.querySelector\('\[data-inbox-prompt-host\]'\)/.test(inbox)
  && /promptHost\.innerHTML/.test(renderPromptBody)
  && !/promptHtml|promptHost/.test(renderListBody));
expect('normal error keeps Daily Communication + local read error while prompt stays in its stable host',
  /if\s*\(readState === 'error'\)/.test(renderListBody)
  && /const\s+daily\s*=\s*fixtureMode\s*\?\s*''\s*:\s*renderDailyCommunicationEntry\(\)/.test(renderListBody)
  && /listEl\.innerHTML\s*=\s*daily\s*\+\s*renderReadError\(false\)/.test(renderListBody));
expect('fixture mode still suppresses prompt and Daily Communication production-state surfaces',
  /return\s+!fixtureMode/.test(functionBody(inbox, 'promptShown') || '')
  && /const\s+daily\s*=\s*fixtureMode\s*\?\s*''\s*:\s*renderDailyCommunicationEntry\(\)/.test(renderListBody));

expect('the two semantic later controls have distinct focus identities',
  /data-notif-prompt="later" data-notif-focus="close"/.test(inbox)
  && /data-notif-prompt="later" data-notif-focus="later"/.test(inbox)
  && /data-notif-prompt="enable" data-notif-focus="enable"/.test(inbox));
expect('focus snapshot preserves exact prompt-control identity before considering replaceable read-body targets',
  /closest\?\.\('\[data-notif-focus\]'\)/.test(captureFocusBody)
  && /promptHost\.contains\(promptControl\)/.test(captureFocusBody)
  && /key:\s*promptControl\.dataset\.notifFocus/.test(captureFocusBody)
  && /!listEl\.contains\(active\)/.test(captureFocusBody));
expect('focus restoration resolves prompt by unique focus key, not shared semantic action',
  /snapshot\.kind === 'prompt'/.test(restoreFocusBody)
  && /querySelectorAll\('\[data-notif-focus\]'\)/.test(restoreFocusBody)
  && /node\.dataset\.notifFocus === snapshot\.key/.test(restoreFocusBody));
expect('successful settlement snapshots focus immediately before DOM replacement and restores after render',
  /const\s+focusSnapshot\s*=\s*captureScreenFocus\(\)[\s\S]*?items\s*=\s*Array\.isArray\(result\)[\s\S]*?renderList\(\)[\s\S]*?restoreScreenFocus\(focusSnapshot\)/.test(refreshBody));
expect('initial failure cannot destroy focused prompt DOM because renderList never mutates promptHost',
  /if\s*\(result === INBOX_READ_FAILED\)[\s\S]*?renderList\(\)/.test(refreshBody)
  && !/promptHost/.test(renderListBody));
expect('failed loaded/background refresh remains non-destructive',
  /if\s*\(hadUsableContent\)\s*\{[\s\S]*?listEl\.setAttribute\('aria-busy',\s*'false'\)[\s\S]*?return/.test(refreshBody));

expect('unread badge keeps original semantics: hidden unless unread > 0 and never shows request-state glyphs',
  /class="inbox-unread-slot"/.test(inbox)
  && /data-inbox-unread-badge hidden/.test(inbox)
  && /hideUnreadBadge\(\)/.test(updateTopbarBody)
  && /if\s*\(unread > 0\)[\s\S]*?unreadBadge\.hidden\s*=\s*false/.test(updateTopbarBody)
  && /unreadBadge\.textContent\s*=\s*String\(unread\)/.test(updateTopbarBody)
  && !/unreadBadge\.textContent\s*=\s*['"`](?:…|!|✓)/.test(updateTopbarBody));
expect('screen-scoped CSS reserves stable badge geometry and defines the read-body without global CSS changes',
  /\.screen--inbox\s+\.inbox-unread-slot\s*\{[\s\S]*?width:\s*36px;[\s\S]*?min-width:\s*36px;[\s\S]*?flex-shrink:\s*0;[\s\S]*?\}/.test(inboxCss)
  && /\.screen--inbox\s+\.inbox-read-body\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?\}/.test(inboxCss));

// ── D. per-screen empty/error states preserved ───────────────
expect('inbox.js still renders its own inbox-empty state',
  /class="bd-card inbox-empty"/.test(inbox));
expect('inbox.js renders an in-list recoverable error with Retry',
  /data-inbox-retry/.test(inbox) && /Не удалось загрузить входящие/.test(inbox));

// ── E. additive only: no global error replaces the Inbox ─────
expect('inbox.js does not hide/replace itself on error (no overlay route change)',
  !/go\(\s*['"`]\/error/.test(inbox));
expect('app.js does NOT register an /error route (any quote style)',
  !/register\(\s*['"`]\/error['"`]/.test(app));
expect('inbox.js does not import or call renderAppErrorOverlay directly',
  !/renderAppErrorOverlay/.test(inbox));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));

process.exit(issues.length ? 1 : 0);
