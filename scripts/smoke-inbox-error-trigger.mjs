// BD-ERROR-01C-C / BD-ERROR-02A-b / BD-CLOUD-DESIGN-LOADING-02F — static
// regression smoke for the Inbox error trigger and final audit repairs.
//
// Inbox routes every real data load through the shared data_layer.loadResource
// adapter. 02F mounts the shell before the initial read, keeps the push prompt
// outside the replaceable read-body, and uses one shared load site for initial /
// retry / background refresh. The global overlay remains additive; the read-body
// also owns an honest screen-local error state through the custom fallback sentinel.
//
// STATIC only: no browser, DOM or network.

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
