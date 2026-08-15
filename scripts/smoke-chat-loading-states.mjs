// BD-CLOUD-DESIGN-LOADING-02C (#870) — focused Chat initial-read smoke.
// Pins the four message-region states, data-free fixtures, writer isolation,
// signal plumbing, bounded read ownership, stale/teardown guards, incremental
// non-overlapping polling, accessibility, and the version-only SW refresh.

import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const chat = read('../public/src/screens/chat.js');
const css = read('../public/styles/cloud.css');
const sw = read('../public/sw.js');
const failures = [];

function expect(label, condition) {
  const passed = Boolean(condition);
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} — ${label}\n`);
  if (!passed) failures.push(label);
}

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
}

const fixtureContract = between(chat, 'const CHAT_READ_STATE', 'function createReadAbortError');
const readManagerSource = between(chat, 'function createChatReadManager', 'function loadChatStore');
const fixtureHydrationSource = between(chat, 'function resolveFixtureHydration', '// Decide whether this chat surface');
const loadingRenderer = between(chat, 'function renderChatLoading()', 'function renderChatReadError()');
const errorRenderer = between(chat, 'function renderChatReadError()', 'const BACK_SVG');
const initialLoader = between(chat, 'async function loadInitialServerMessages()', 'requestAnimationFrame(scrollBottom);');
const refreshLoader = between(chat, 'async function refreshServerMessages(epoch)', 'function startPolling(epoch)');
const pollStarter = between(chat, 'function startPolling(epoch)', 'async function loadInitialServerMessages()');
const fixtureWriteGuard = between(chat, 'function doSend()', 'const now  = new Date();');

// A. Persistent shell and four honest request states.
expect('Chat remains a synchronous stable shell',
  /export default function chat\(\)/.test(chat)
  && !/export default async function chat/.test(chat)
  && chat.indexOf('class="chat__header"') < chat.indexOf('id="chat-messages"')
  && chat.indexOf('class="chat__composer"') > chat.indexOf('id="chat-messages"'));
expect('message-list is the persistent aria-busy owner',
  /id="chat-messages" tabindex="-1"[\s\S]{0,180}aria-busy=/.test(chat)
  && /messagesEl\.setAttribute\('aria-busy', nextState === CHAT_READ_STATE\.LOADING/.test(chat));
expect('read renderer has distinct loading, loaded, empty and error branches',
  /CHAT_READ_STATE\.LOADING/.test(chat)
  && /CHAT_READ_STATE\.LOADED/.test(chat)
  && /CHAT_READ_STATE\.EMPTY/.test(chat)
  && /CHAT_READ_STATE\.ERROR/.test(chat)
  && /renderChatLoading\(\)/.test(chat)
  && /renderChatReadError\(\)/.test(chat)
  && /renderEmptyThread\(viewerRole,\s*confirmed\)/.test(chat));
expect('successful zero result is the only initial path to empty',
  /renderReadState\(list\.length \? CHAT_READ_STATE\.LOADED : CHAT_READ_STATE\.EMPTY, list\)/.test(initialLoader));
expect('rejected or unusable initial read renders error',
  /throw new TypeError\('chat messages response is unusable'\)/.test(chat)
  && /catch \{[\s\S]*renderReadState\(CHAT_READ_STATE\.ERROR\)/.test(initialLoader));

// B. Structural skeleton, error recovery, and motion accessibility.
expect('loading has one polite status outside decorative bones',
  (loadingRenderer.match(/role', 'status'/g) || []).length === 1
  && /Загружаем сообщения…/.test(loadingRenderer)
  && /setAttribute\('aria-hidden', 'true'\)/.test(loadingRenderer));
expect('bubble skeleton contains no fake message data or controls',
  /chat__skeleton-bubble--wide/.test(loadingRenderer)
  && /chat__skeleton-bubble--medium/.test(loadingRenderer)
  && /chat__skeleton-bubble--short/.test(loadingRenderer)
  && !/<button\b|Здравствуйте|14:|Рустам|₽/.test(loadingRenderer));
expect('read error has an accessible heading and a real retry button',
  /aria-labelledby', 'chat-read-error-title'/.test(errorRenderer)
  && /retry\.dataset\.action = 'retry-chat-read'/.test(errorRenderer)
  && /Повторить загрузку сообщений/.test(errorRenderer));
expect('skeleton is static by default and animates only when motion is allowed',
  /\.chat__skeleton-bone\s*\{[\s\S]*background: var\(--bg-2\)/.test(css)
  && /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.chat__skeleton-bone::after[\s\S]*animation: chat-skeleton-shimmer/.test(css));
expect('settlement preserves focus on the persistent owner before replacement',
  /messagesEl\.contains\(document\.activeElement\)/.test(chat)
  && /messagesEl\.focus\(\{ preventScroll: true \}\)/.test(chat)
  && chat.indexOf("messagesEl.focus({ preventScroll: true });") < chat.indexOf('messagesEl.replaceChildren(renderChatLoading())'));

// C. Deterministic fixtures and write isolation.
expect('fixture allowlist is exactly the four canonical read states',
  /const CHAT_READ_STATE = Object\.freeze/.test(fixtureContract)
  && /LOADING: 'loading'/.test(fixtureContract)
  && /LOADED:\s+'loaded'/.test(fixtureContract)
  && /EMPTY:\s+'empty'/.test(fixtureContract)
  && /ERROR:\s+'error'/.test(fixtureContract)
  && /new Set\(Object\.values\(CHAT_READ_STATE\)\)/.test(fixtureContract));
expect('unknown fixture falls back to normal runtime',
  /return CHAT_FIXTURES\.has\(value\) \? value : ''/.test(fixtureContract));
expect('known fixtures bypass local message read, backend authority and polling',
  /const stored\s+= fixture \? null : loadMessages\(chatId\)/.test(chat)
  && /const backendRead = !fixture && isBackendEnabled\(\) && isRealThread/.test(chat)
  && /if \(isTerminal \|\| fixture\) return/.test(pollStarter));
expect('fixture hydration stays synthetic even when tripId or responseId match persisted data',
  /const counterpartRole = viewerRole === 'driver' \? 'passenger' : 'driver'/.test(fixtureHydrationSource)
  && /MOCK_PASSENGER/.test(fixtureHydrationSource)
  && /MOCK_DRIVER/.test(fixtureHydrationSource)
  && /trip: \{ \.\.\.MOCK_TRIP, status: 'Принят' \}/.test(fixtureHydrationSource)
  && /response: null/.test(fixtureHydrationSource)
  && !/localStorage|loadResponse|findActiveRide|resolveRideContext|resolveChatHydration/.test(fixtureHydrationSource)
  && /function loadResponse\(responseId\) \{\s*if \(!responseId\) return null;/.test(chat)
  && /const rideContext = resolveRideContext\(\{\s*responseId: fixture \? null : responseId,\s*viewerRole,\s*\}\)/.test(chat)
  && /const hydration = fixture\s*\? resolveFixtureHydration\(viewerRole\)\s*: resolveChatHydration\(\{ tripId, responseId, viewerRole \}\)/.test(chat));
expect('loaded fixture is deterministic and role-aware',
  /CHAT_FIXTURE_MESSAGES/.test(fixtureContract)
  && /senderRole: 'passenger'/.test(fixtureContract)
  && /senderRole: 'driver'/.test(fixtureContract));
expect('loading fixture remains pending with no initial GET',
  /if \(backendRead\) void loadInitialServerMessages\(\)/.test(chat)
  && /backendRead = !fixture/.test(chat));
expect('fixture composer, quick replies and confirmation write are inert',
  /const writeLocked = isTerminal \|\| Boolean\(fixture\) \|\| readLocked/.test(chat)
  && /if \(!chip \|\| chip\.disabled \|\| inputEl\.disabled \|\| fixture\) return/.test(chat)
  && /if \(fixture \|\| isTerminal \|\| inputEl\.disabled\) return/.test(fixtureWriteGuard)
  && /if \(fixture && confirmBtn\) confirmBtn\.disabled = true/.test(chat)
  && /if \(fixture \|\| confirming \|\| confirmBtn\.disabled\) return/.test(chat));
expect('fixture error retry remains deterministic and never starts the GET',
  /if \(fixture\) \{[\s\S]{0,100}renderReadState\(CHAT_READ_STATE\.ERROR\);[\s\S]{0,80}return;/.test(chat));

// D. End-to-end signal, timeout, retry, stale settlement and poll lifecycle.
expect('AbortSignal reaches the actual apiFetch call',
  /fetchServerMessages\(chatId, signal\)/.test(chat)
  && /apiFetch\(`\/chat\/messages\?chatId=\$\{encodeURIComponent\(chatId\)\}`, \{ signal \}\)/.test(chat));
expect('initial timeout is bounded and aborts the controller',
  /const CHAT_READ_TIMEOUT_MS = 12_000/.test(chat)
  && /error\.name = 'TimeoutError'/.test(readManagerSource)
  && /controller\.abort\(\)/.test(readManagerSource));
expect('retry supersedes the old read and repeats only the GET loader',
  /readManager\.run\(chatId, epoch, \{ supersede: true \}\)/.test(initialLoader)
  && /if \(backendRead\) void loadInitialServerMessages\(\)/.test(chat));
expect('epoch and detached-root guards reject stale settlement',
  /epoch === readEpoch/.test(chat)
  && /root\.isConnected/.test(chat)
  && (initialLoader.match(/!isCurrentRead\(epoch\)/g) || []).length >= 2);
expect('teardown clears polling and aborts the in-flight GET',
  /function teardownReads\(\)[\s\S]{0,140}stopPolling\(\)[\s\S]{0,100}readManager\.cancel\('chat screen torn down'\)/.test(chat)
  && /new MutationObserver/.test(chat));
expect('poll starts only after successful initial settlement and stays non-overlapping',
  initialLoader.indexOf('renderReadState(list.length') < initialLoader.indexOf('startPolling(epoch)')
  && /readManager\.isActive\(\)/.test(refreshLoader)
  && /supersede: false/.test(refreshLoader)
  && /CHAT_POLL_MS/.test(pollStarter));
expect('refresh failure preserves usable content and append stays incremental',
  /refresh failure is non-destructive/.test(refreshLoader)
  && !/renderReadState\(/.test(refreshLoader)
  && /appendRefreshMessages\(list\)/.test(refreshLoader)
  && /renderMessage\(message\)/.test(chat));
expect('terminal backend thread reads once without polling',
  /const backendChat = backendRead && !isTerminal/.test(chat)
  && /if \(isTerminal \|\| fixture\) return/.test(pollStarter));
expect('existing POST writer and local persistence keys remain unchanged',
  /return apiFetch\('\/chat\/messages', \{[\s\S]{0,120}method: 'POST'/.test(chat)
  && /const CHAT_KEY\s+=\s+'bazardrive\.chat\.v1'/.test(chat));

// Execute the exact operation manager used by chat.js behind a deterministic
// scheduler. These regressions catch timer leaks, missing abort propagation,
// overlapping polls and stale supersession independently of source regexes.
const abortHelperSource = between(chat, 'function createReadAbortError', '// One operation owner');
let createManager;
try {
  createManager = new Function(`${abortHelperSource}\n${readManagerSource}\nreturn createChatReadManager;`)();
} catch (error) {
  failures.push(`read manager extraction failed: ${error.message}`);
}

function makeClock() {
  let nextId = 1;
  const timers = new Map();
  return {
    timers,
    schedule(fn) { const id = nextId++; timers.set(id, fn); return id; },
    unschedule(id) { timers.delete(id); },
    fireFirst() {
      const entry = timers.entries().next().value;
      if (!entry) return false;
      const [id, fn] = entry;
      timers.delete(id);
      fn();
      return true;
    },
  };
}

if (createManager) {
  {
    const clock = makeClock();
    let seenSignal = null;
    const manager = createManager(async (_chatId, signal) => {
      seenSignal = signal;
      return [{ id: 'ok', text: 'ok' }];
    }, 10, clock.schedule, clock.unschedule);
    const result = await manager.run('trip-ok', 1);
    expect('read manager success clears its timer and active operation',
      result.length === 1 && seenSignal && !seenSignal.aborted
      && clock.timers.size === 0 && !manager.isActive());
  }

  {
    const clock = makeClock();
    let seenSignal = null;
    const manager = createManager((_chatId, signal) => {
      seenSignal = signal;
      return new Promise(() => {});
    }, 10, clock.schedule, clock.unschedule);
    const pending = manager.run('trip-cancel', 1).catch((error) => error);
    await Promise.resolve();
    manager.cancel('teardown');
    const error = await pending;
    expect('read manager teardown aborts signal, rejects AbortError and clears timer',
      error?.name === 'AbortError' && seenSignal?.aborted
      && clock.timers.size === 0 && !manager.isActive());
  }

  {
    const clock = makeClock();
    let seenSignal = null;
    const manager = createManager((_chatId, signal) => {
      seenSignal = signal;
      return new Promise(() => {});
    }, 10, clock.schedule, clock.unschedule);
    const pending = manager.run('trip-timeout', 1).catch((error) => error);
    await Promise.resolve();
    const fired = clock.fireFirst();
    const error = await pending;
    expect('read manager timeout aborts signal, rejects TimeoutError and clears timer',
      fired && error?.name === 'TimeoutError' && seenSignal?.aborted
      && clock.timers.size === 0 && !manager.isActive());
  }

  {
    const clock = makeClock();
    const signals = [];
    let call = 0;
    const manager = createManager((_chatId, signal) => {
      signals.push(signal);
      call += 1;
      return call === 1 ? new Promise(() => {}) : Promise.resolve(['fresh']);
    }, 10, clock.schedule, clock.unschedule);
    const stale = manager.run('trip-old', 1).catch((error) => error);
    await Promise.resolve();
    const fresh = manager.run('trip-new', 2);
    const [staleResult, freshResult] = await Promise.all([stale, fresh]);
    expect('superseding retry aborts stale read and keeps only fresh settlement',
      staleResult?.name === 'AbortError' && signals[0]?.aborted
      && freshResult[0] === 'fresh' && !signals[1]?.aborted
      && clock.timers.size === 0 && !manager.isActive());
  }

  {
    const clock = makeClock();
    let calls = 0;
    const manager = createManager(() => {
      calls += 1;
      return new Promise(() => {});
    }, 10, clock.schedule, clock.unschedule);
    const first = manager.run('trip-poll', 1).catch((error) => error);
    await Promise.resolve();
    const overlap = manager.run('trip-poll', 1, { supersede: false });
    manager.cancel('poll stopped');
    await first;
    expect('non-superseding poll cannot accumulate overlapping GETs or timers',
      overlap === null && calls === 1 && clock.timers.size === 0 && !manager.isActive());
  }
}

// E. Version-only offline refresh.
expect('Service Worker records 02C v266 and keeps changed assets precached',
  /v266 \(BD-CLOUD-DESIGN-LOADING-02C #870\)/.test(sw)
  && (() => {
    const version = sw.match(/const VERSION\s*=\s*'v(\d+)'/);
    return version && Number(version[1]) >= 266;
  })()
  && sw.includes("'./src/screens/chat.js'")
  && sw.includes("'./styles/cloud.css'"));

if (failures.length) {
  process.stderr.write(`\nFAIL ${failures.length} expectation(s):\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}

process.stdout.write('\nALL PASSED\n');
