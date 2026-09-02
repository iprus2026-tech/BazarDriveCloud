import {
  listInboxItems,
  INBOX_STATUS_LABEL,
  INBOX_STATUS_TONE,
  ensureDemoResponseOrder,
} from '../mock_api.js';
import { loadResource } from '../data_layer.js';
import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';

// BD-CLOUD-DESIGN-LOADING-02F — Inbox owns an honest list-read boundary while
// preserving the shared app-shell error overlay as an additive channel. The
// screen shell mounts synchronously; only .inbox-read-body owns loading/loaded/
// empty/error. A local sentinel distinguishes a failed read from a genuine empty
// list without changing data_layer.loadResource.
const INBOX_READ_FAILED = Symbol('inbox-read-failed');
const INBOX_FIXTURES = new Set(['loading', 'loaded', 'empty', 'error']);

const TABS = [
  { key: 'all',       label: 'Все' },
  { key: 'responses', label: 'Отклики' },
  { key: 'messages',  label: 'Сообщения' },
  { key: 'rides',     label: 'Поездки' },
];

const KIND_GLYPH = {
  response: 'О',
  message:  'С',
  ride:     'П',
};

const KIND_LABEL = {
  response: 'Отклик',
  message:  'Сообщение',
  ride:     'Поездка',
};

const EMPTY_HINTS = {
  all:       'Здесь будут появляться отклики, сообщения и события поездок.',
  responses: 'Новых откликов пока нет — попробуйте опубликовать заявку.',
  messages:  'В чатах пока тишина — напишите водителю или попутчику.',
  rides:     'Событий по поездкам ещё нет — они появятся после первого заказа.',
};

const FIXTURE_ITEMS = [
  {
    id: 'inbox-fixture-response',
    tab: 'responses',
    kind: 'response',
    actor: 'Алексей М.',
    actorRole: 'Водитель',
    status: 'NEW_RESPONSE',
    unread: true,
    time: '2 мин',
    route: { from: 'Тверская улица', to: 'Шереметьево' },
    summary: 'Водитель готов забрать заказ через несколько минут.',
    href: '',
  },
  {
    id: 'inbox-fixture-message',
    tab: 'messages',
    kind: 'message',
    actor: 'Алексей М.',
    actorRole: 'Водитель',
    status: '',
    unread: false,
    time: '8 мин',
    route: null,
    summary: 'Я подъехал к указанному входу.',
    href: '',
  },
  {
    id: 'inbox-fixture-ride',
    tab: 'rides',
    kind: 'ride',
    actor: 'Поездка',
    actorRole: 'Событие',
    status: 'DRIVER_EN_ROUTE',
    unread: false,
    time: '12 мин',
    route: { from: 'Ленинградский проспект', to: 'Белорусский вокзал' },
    summary: 'Водитель назначен. Следите за поездкой в активном заказе.',
    href: '',
  },
];

const ARROW_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="12" height="12">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="13 6 19 12 13 18"/>
  </svg>`;

// BD-NOTIF-01 — push-permission prompt glyphs.
const BELL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M6 8a6 6 0 0112 0c0 6 3 7 3 7H3s3-1 3-7"/>
    <path d="M10 21a2 2 0 004 0"/>
  </svg>`;
const CHECK_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="14" height="14">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;

// BD-NOTIF-01 — push-permission prompt. UI-only: «Включить» flips the existing
// notificationsEnabled flag (no native OS registration, no backend); «Позже»
// dismisses for the session. Two views (prompt → done) toggled by [data-view].
function promptHtml(view) {
  return `
    <div class="bd-card inbox-pushprompt" data-view="${escapeHtml(view)}" role="region" aria-label="Push-уведомления">
      <div class="inbox-pushprompt__main">
        <span class="inbox-pushprompt__ic" aria-hidden="true">${BELL_SVG}</span>
        <div class="inbox-pushprompt__copy">
          <div class="inbox-pushprompt__title">Включите push-уведомления</div>
          <p class="inbox-pushprompt__text">Чтобы не пропустить новые отклики и сообщения. Демо-режим — реальные push не отправляются.</p>
        </div>
        <button type="button" class="inbox-pushprompt__close" data-notif-prompt="later" data-notif-focus="close" aria-label="Скрыть">×</button>
      </div>
      <div class="inbox-pushprompt__actions">
        <button type="button" class="bd-btn primary sm" data-notif-prompt="enable" data-notif-focus="enable">Включить</button>
        <button type="button" class="bd-btn ghost sm" data-notif-prompt="later" data-notif-focus="later">Позже</button>
      </div>
      <div class="inbox-pushprompt__done" role="status">
        <span class="inbox-pushprompt__done-ic" aria-hidden="true">${CHECK_SVG}</span>
        <span>Push-уведомления включены</span>
      </div>
    </div>
  `;
}

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function getCurrentRoutePath() {
  const hash = window.location.hash || '';
  const fullPath = hash.startsWith('#') ? hash.slice(1) : hash;
  return fullPath.split('?')[0];
}

function getInboxFixture() {
  const raw = (getRouteParam('fixture') || '').toLowerCase();
  return INBOX_FIXTURES.has(raw) ? raw : '';
}

function resolveActiveTab() {
  const raw = (getRouteParam('tab') || 'all').toLowerCase();
  return TABS.some((t) => t.key === raw) ? raw : 'all';
}

function filterItems(items, tab) {
  return tab === 'all' ? items : items.filter((it) => it.tab === tab);
}

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

function unreadCount(items) {
  return items.reduce((n, it) => n + (it.unread ? 1 : 0), 0);
}

function pluralUnread(count) {
  const mod10  = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'непрочитанное';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'непрочитанных';
  return 'непрочитанных';
}

function renderStatus(item) {
  const label = INBOX_STATUS_LABEL[item.status];
  if (!label) return '';
  const tone = INBOX_STATUS_TONE[item.status] || 'muted';
  return `
    <span class="inbox-item__status inbox-item__status--${escapeHtml(tone)}"
          aria-label="Статус: ${escapeHtml(label)}">
      ${escapeHtml(label)}
    </span>
  `;
}

function renderRoute(route) {
  if (!route || (!route.from && !route.to)) return '';
  return `
    <div class="inbox-item__route" aria-label="Маршрут">
      <span class="inbox-item__route-from">${escapeHtml(route.from || '—')}</span>
      <span class="inbox-item__route-arrow" aria-hidden="true">${ARROW_SVG}</span>
      <span class="inbox-item__route-to">${escapeHtml(route.to || '—')}</span>
    </div>
  `;
}

function renderActions(item) {
  const primary = item.primary;
  const secondary = item.secondary;
  if (!primary && !secondary) return '';

  const parts = [];
  if (primary) {
    parts.push(`
      <button type="button"
              class="bd-btn primary sm inbox-item__btn inbox-item__btn--primary"
              data-inbox-action="primary"
              data-href="${escapeHtml(primary.href)}">
        ${escapeHtml(primary.label)}
      </button>
    `);
  }
  if (secondary) {
    parts.push(`
      <button type="button"
              class="bd-btn ghost sm inbox-item__btn inbox-item__btn--secondary"
              data-inbox-action="secondary"
              data-href="${escapeHtml(secondary.href)}">
        ${escapeHtml(secondary.label)}
      </button>
    `);
  }
  return `<div class="inbox-item__actions">${parts.join('')}</div>`;
}

function renderItem(item, interactive = true) {
  const glyph     = KIND_GLYPH[item.kind] || '•';
  const kindLabel = KIND_LABEL[item.kind] || 'Событие';

  const metaBits = [
    escapeHtml(kindLabel),
    item.actorRole ? escapeHtml(item.actorRole) : '',
  ].filter(Boolean).join(' · ');

  const fallbackHref = item.primary?.href || item.secondary?.href || item.href || '';

  const ariaLabel = [
    kindLabel,
    item.actor,
    INBOX_STATUS_LABEL[item.status],
  ].filter(Boolean).join(' · ');

  const interactionAttributes = interactive
    ? '\n             role="button"\n             tabindex="0"'
    : '';

  return `
    <article class="bd-card inbox-item${item.unread ? ' inbox-item--unread' : ''}"
             data-inbox-id="${escapeHtml(item.id)}"
             data-href="${escapeHtml(fallbackHref)}"${interactionAttributes}
             aria-label="${escapeHtml(ariaLabel)}">
      <div class="inbox-item__head">
        <div class="inbox-item__avatar" aria-hidden="true">${escapeHtml(glyph)}</div>
        <div class="inbox-item__head-info">
          <div class="inbox-item__name-row">
            <span class="inbox-item__name">${escapeHtml(item.actor || kindLabel)}</span>
            ${item.unread
              ? `<span class="inbox-item__unread-dot" aria-label="Новое событие"></span>`
              : ''}
          </div>
          <div class="inbox-item__meta">${metaBits}</div>
        </div>
        <div class="inbox-item__head-side">
          ${renderStatus(item)}
          ${item.time ? `<span class="inbox-item__time">${escapeHtml(item.time)}</span>` : ''}
        </div>
      </div>

      ${renderRoute(item.route)}

      ${item.summary
        ? `<p class="inbox-item__summary">${escapeHtml(item.summary)}</p>`
        : ''}

      ${renderActions(item)}
    </article>
  `;
}

function renderDailyCommunicationEntry() {
  return `
    <article class="bd-card inbox-item inbox-item--daily-communication"
             data-inbox-daily-communication
             data-href="/daily-communication"
             role="button"
             tabindex="0"
             aria-label="Операционная связь · Пассажир водитель поддержка · Открыть">
      <div class="inbox-item__head">
        <div class="inbox-item__avatar" aria-hidden="true">О</div>
        <div class="inbox-item__head-info">
          <div class="inbox-item__name-row"><span class="inbox-item__name">Операционная связь</span></div>
          <div class="inbox-item__meta">Пассажир ↔ водитель ↔ поддержка</div>
        </div>
      </div>
      <p class="inbox-item__summary">Темы, подтверждения и действия по поездкам</p>
      <div class="inbox-item__actions"><span class="bd-btn primary sm inbox-item__btn inbox-item__btn--primary" aria-hidden="true">Открыть</span></div>
    </article>
  `;
}

function renderEmpty(tab, fixtureMode = false) {
  const hint = EMPTY_HINTS[tab] || EMPTY_HINTS.all;
  return `
    <div class="bd-card inbox-empty" role="status">
      <div class="inbox-empty__glyph" aria-hidden="true">✉</div>
      <div class="inbox-empty__title">Пока ничего нового</div>
      <p class="inbox-empty__body">${escapeHtml(hint)}</p>
      <button type="button" class="bd-btn primary sm inbox-empty__cta"
              data-inbox-empty-cta="feed"${fixtureMode ? ' disabled aria-disabled="true"' : ''}>
        Перейти в ленту
      </button>
    </div>
  `;
}

function renderLoadingSkeleton() {
  return `
    <div role="status" aria-live="polite" class="muted">Загружаем входящие…</div>
    ${Array.from({ length: 3 }, () => `
      <article class="bd-card inbox-item" aria-hidden="true">
        <div class="feed-skeleton__head">
          <div class="feed-skeleton__avatar"></div>
          <div class="feed-skeleton__lines">
            <div class="feed-skeleton__line feed-skeleton__line--name"></div>
            <div class="feed-skeleton__line feed-skeleton__line--meta"></div>
          </div>
        </div>
        <div class="feed-skeleton__line"></div>
        <div class="feed-skeleton__line feed-skeleton__line--short"></div>
        <div class="feed-skeleton__line feed-skeleton__line--meta"></div>
      </article>`).join('')}
  `;
}

function renderReadError(retrying = false) {
  return `
    <div class="bd-empty" role="alert" aria-labelledby="inbox-read-error-title">
      <div class="bd-empty__title" id="inbox-read-error-title">Не удалось загрузить входящие</div>
      <p>Проверьте соединение и попробуйте ещё раз.</p>
      <button type="button" class="bd-btn ghost sm" data-inbox-retry
              aria-busy="${retrying ? 'true' : 'false'}"
              aria-disabled="${retrying ? 'true' : 'false'}"
              ${retrying ? 'disabled' : ''}>
        ${retrying ? 'Повторяем…' : 'Повторить'}
      </button>
    </div>
  `;
}

export default function inbox() {
  const renderContext = arguments[0];
  const fixture = getInboxFixture();
  const fixtureMode = Boolean(fixture);
  if (!fixtureMode) ensureDemoResponseOrder();

  let items = fixture === 'loaded' ? FIXTURE_ITEMS.map((item) => ({ ...item })) : [];
  let activeTab = resolveActiveTab();
  let readState = fixture || 'loading';
  let readEpoch = 0;
  let readPending = false;

  const root = document.createElement('section');
  root.className = 'screen screen--inbox';

  // BD-CLOUD-DESIGN-LOADING-02F-R1 (#880) — a hash-prefix check cannot
  // distinguish this mounted Inbox from an older A→B→A instance. Bind reads
  // to the router generation, the exact route and this root's mount identity.
  // The narrow pre-mount allowance is required because inbox() returns its
  // shell synchronously and starts the initial read before router.js appends it.
  const appRoot = document.getElementById('app');
  const isCurrentRender = renderContext && typeof renderContext.isCurrent === 'function'
    ? renderContext.isCurrent
    : () => true;
  let hasMounted = false;
  function isCurrentInboxInstance() {
    if (!isCurrentRender() || getCurrentRoutePath() !== '/inbox') return false;
    const mountedHere = Boolean(appRoot && root.isConnected && appRoot.contains(root));
    if (mountedHere) hasMounted = true;
    const awaitingInitialMount = Boolean(
      appRoot
        && !hasMounted
        && !root.isConnected
        && root.parentNode === null
        && appRoot.childElementCount === 0,
    );
    return mountedHere || awaitingInitialMount;
  }

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Входящие</h1>
        <p class="bd-topbar__sub" data-inbox-sub aria-hidden="true">&nbsp;</p>
      </div>
      <span class="inbox-unread-slot">
        <span class="bd-badge accent inbox-unread-badge" data-inbox-unread-badge hidden></span>
      </span>
    </div>
    <div class="feed-chip-row" role="group" aria-label="Категории входящих">
      ${TABS.map((t) =>
        `<button class="feed-chip${t.key === activeTab ? ' active' : ''}"
                 data-inbox-tab="${escapeHtml(t.key)}"
                 type="button"
                 aria-pressed="${t.key === activeTab ? 'true' : 'false'}">
           ${escapeHtml(t.label)}
         </button>`
      ).join('')}
    </div>
    <div class="bd-scroll inbox-list">
      <div class="inbox-prompt-host" data-inbox-prompt-host></div>
      <div class="inbox-read-body" role="feed" aria-label="События" aria-busy="true" tabindex="-1"></div>
    </div>
  `;

  const chipRow = root.querySelector('.feed-chip-row');
  const promptHost = root.querySelector('[data-inbox-prompt-host]');
  const listEl = root.querySelector('.inbox-read-body');
  const subEl = root.querySelector('[data-inbox-sub]');
  const unreadBadge = root.querySelector('[data-inbox-unread-badge]');

  // BD-NOTIF-01 — push-permission prompt state. Fixtures never read or write the
  // preference, keeping preview output deterministic and production-state-free.
  const forcePrompt = !fixtureMode && getRouteParam('prompt') === '1';
  let promptDismissed = false;
  let promptDone = false;
  function promptShown() {
    return !fixtureMode
      && (promptDone || ((forcePrompt || !user.get().notificationsEnabled) && !promptDismissed));
  }

  function renderPrompt() {
    promptHost.innerHTML = promptShown() ? promptHtml(promptDone ? 'done' : 'prompt') : '';
  }

  function hideUnreadBadge() {
    unreadBadge.hidden = true;
    unreadBadge.textContent = '';
    unreadBadge.removeAttribute('aria-label');
  }

  function clearTopbarSummary() {
    subEl.textContent = '\u00a0';
    subEl.setAttribute('aria-hidden', 'true');
    hideUnreadBadge();
  }

  function updateTopbar() {
    if (readState === 'loading' || readState === 'error') {
      clearTopbarSummary();
      return;
    }
    const unread = unreadCount(items);
    subEl.removeAttribute('aria-hidden');
    subEl.textContent = unread > 0
      ? `${unread} ${pluralUnread(unread)}`
      : 'Все события прочитаны';
    if (unread > 0) {
      unreadBadge.hidden = false;
      unreadBadge.textContent = String(unread);
      unreadBadge.setAttribute('aria-label', `Непрочитанных событий: ${unread}`);
    } else {
      hideUnreadBadge();
    }
  }

  function captureScreenFocus() {
    const active = document.activeElement;
    if (!active || active === document.body) return null;

    const promptControl = active.closest?.('[data-notif-focus]');
    if (promptControl && promptHost.contains(promptControl)) {
      return { kind: 'prompt', key: promptControl.dataset.notifFocus || '' };
    }

    if (!listEl.contains(active)) return null;
    if (active === listEl) return { kind: 'list' };

    const card = active.closest?.('[data-inbox-id]');
    if (card) {
      const action = active.closest?.('[data-inbox-action]');
      return {
        kind: 'item',
        id: card.dataset.inboxId || '',
        action: action?.dataset.inboxAction || '',
      };
    }

    if (active.closest?.('[data-inbox-daily-communication]')) return { kind: 'daily' };
    if (active.closest?.('[data-inbox-empty-cta]')) return { kind: 'empty' };
    if (active.closest?.('[data-inbox-retry]')) return { kind: 'retry' };
    return { kind: 'list' };
  }

  function restoreScreenFocus(snapshot) {
    if (!snapshot) return;
    let target = null;

    if (snapshot.kind === 'prompt') {
      target = Array.from(promptHost.querySelectorAll('[data-notif-focus]'))
        .find((node) => node.dataset.notifFocus === snapshot.key);
      if (!target) return;
    } else if (snapshot.kind === 'list') {
      target = listEl;
    } else if (snapshot.kind === 'item') {
      const card = Array.from(listEl.querySelectorAll('[data-inbox-id]'))
        .find((node) => node.dataset.inboxId === snapshot.id);
      if (card) {
        target = snapshot.action
          ? Array.from(card.querySelectorAll('[data-inbox-action]'))
            .find((node) => node.dataset.inboxAction === snapshot.action)
          : card;
      }
    } else if (snapshot.kind === 'daily') {
      target = listEl.querySelector('[data-inbox-daily-communication]');
    } else if (snapshot.kind === 'empty') {
      target = listEl.querySelector('[data-inbox-empty-cta]');
    } else if (snapshot.kind === 'retry') {
      target = listEl.querySelector('[data-inbox-retry]');
    }

    (target || listEl).focus?.({ preventScroll: true });
  }

  function renderList() {
    updateTopbar();
    if (readState === 'loading') {
      listEl.setAttribute('aria-busy', 'true');
      listEl.innerHTML = renderLoadingSkeleton();
      return;
    }
    listEl.setAttribute('aria-busy', 'false');
    if (readState === 'error') {
      const daily = fixtureMode ? '' : renderDailyCommunicationEntry();
      listEl.innerHTML = daily + renderReadError(false);
      return;
    }
    const visible = filterItems(items, activeTab);
    const body = visible.length
      ? visible.map((item) => renderItem(item, !fixtureMode)).join('')
      : renderEmpty(activeTab, fixtureMode);
    const daily = fixtureMode ? '' : renderDailyCommunicationEntry();
    listEl.innerHTML = daily + body;
  }

  const onInboxRetry = () => { refreshInbox('retry'); };

  function setRetryPending(pending) {
    // Retry is a settled user command, not a new initial read. Keep the feed
    // settled and expose progress on the command that initiated it.
    listEl.setAttribute('aria-busy', 'false');
    const retryBtn = listEl.querySelector('[data-inbox-retry]');
    if (!retryBtn) return;
    retryBtn.disabled = pending;
    retryBtn.setAttribute('aria-disabled', pending ? 'true' : 'false');
    retryBtn.setAttribute('aria-busy', pending ? 'true' : 'false');
    retryBtn.textContent = pending ? 'Повторяем…' : 'Повторить';
  }

  async function refreshInbox(mode = 'background') {
    if (fixtureMode || readPending || !isCurrentInboxInstance()) return;
    const isInitial = mode === 'initial';
    const isRetry = mode === 'retry';
    const hadUsableContent = readState === 'loaded' || readState === 'empty';
    const epoch = ++readEpoch;
    readPending = true;

    if (isInitial) {
      readState = 'loading';
      renderList();
    } else if (isRetry && readState === 'error') {
      setRetryPending(true);
    }

    const result = await loadResource(listInboxItems, {
      onRetry: onInboxRetry,
      isRetry,
      fallback: INBOX_READ_FAILED,
      isActive: isCurrentInboxInstance,
    });

    // loadResource owns the overlay catch, so the same predicate is passed
    // above and repeated immediately after settlement before any local state,
    // DOM or focus mutation can escape a stale instance.
    const stillCurrent = isCurrentInboxInstance();
    if (!stillCurrent || epoch !== readEpoch) return;
    readPending = false;
    if (isRetry && readState === 'error') setRetryPending(false);

    if (result === INBOX_READ_FAILED) {
      if (hadUsableContent) {
        listEl.setAttribute('aria-busy', 'false');
        return;
      }
      readState = 'error';
      if (isRetry) {
        updateTopbar();
      } else {
        renderList();
      }
      return;
    }

    // Snapshot at settlement time, not request start: if the user moved focus
    // outside the replaceable Inbox read-body while awaiting the read, do not
    // steal it back. Prompt controls use unique focus keys even when their
    // semantic action is the same (close and bottom «Позже» both dismiss).
    const focusSnapshot = captureScreenFocus();
    items = Array.isArray(result) ? result : [];
    readState = items.length ? 'loaded' : 'empty';
    renderList();
    restoreScreenFocus(focusSnapshot);
  }

  function setActiveTab(key) {
    if (!TABS.some((t) => t.key === key) || key === activeTab) return;
    activeTab = key;
    for (const btn of chipRow.querySelectorAll('[data-inbox-tab]')) {
      const isActive = btn.dataset.inboxTab === activeTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    const currentHash = window.location.hash || '#/inbox';
    const qi = currentHash.indexOf('?');
    const params = new URLSearchParams(qi === -1 ? '' : currentHash.slice(qi + 1));
    if (activeTab === 'all') params.delete('tab');
    else params.set('tab', activeTab);
    const query = params.toString();
    const nextHash = query ? `#/inbox?${query}` : '#/inbox';
    if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
    renderList();
  }

  chipRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inbox-tab]');
    if (!btn) return;
    setActiveTab(btn.dataset.inboxTab);
  });

  function openHref(href) {
    if (!href || fixtureMode) return;
    go(href);
  }

  promptHost.addEventListener('click', (e) => {
    const promptBtn = e.target.closest('[data-notif-prompt]');
    if (!promptBtn) return;
    e.stopPropagation();
    if (fixtureMode) return;
    const act = promptBtn.dataset.notifPrompt;
    if (act === 'later') {
      promptDismissed = true;
      renderPrompt();
      return;
    }
    if (act === 'enable') {
      // UI-only: flip the persisted preference, no native push registration.
      user.set({ notificationsEnabled: true });
      promptDone = true;
      renderPrompt();
      setTimeout(() => {
        promptDone = false;
        promptDismissed = true;
        renderPrompt();
      }, 2400);
    }
  });

  listEl.addEventListener('click', (e) => {
    const retryBtn = e.target.closest('[data-inbox-retry]');
    if (retryBtn) {
      e.stopPropagation();
      if (fixtureMode) {
        setRetryPending(true);
        queueMicrotask(() => setRetryPending(false));
      } else {
        refreshInbox('retry');
      }
      return;
    }

    const dailyEntry = e.target.closest('[data-inbox-daily-communication]');
    if (dailyEntry) {
      e.stopPropagation();
      openHref('/daily-communication');
      return;
    }
    const actionBtn = e.target.closest('[data-inbox-action]');
    if (actionBtn) {
      e.stopPropagation();
      openHref(actionBtn.dataset.href);
      return;
    }
    const emptyCta = e.target.closest('[data-inbox-empty-cta]');
    if (emptyCta) {
      if (!fixtureMode) go('/feed');
      return;
    }
    const card = e.target.closest('[data-inbox-id]');
    if (!card) return;
    openHref(card.dataset.href);
  });

  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const dailyEntry = e.target.closest('[data-inbox-daily-communication]');
    if (dailyEntry) {
      e.preventDefault();
      openHref('/daily-communication');
      return;
    }
    const card = e.target.closest('[data-inbox-id]');
    if (!card || e.target.closest('button')) return;
    e.preventDefault();
    openHref(card.dataset.href);
  });

  renderPrompt();
  renderList();

  if (fixture === 'error') {
    readState = 'error';
    renderList();
  } else if (!fixtureMode) {
    refreshInbox('initial');
  }

  return root;
}
