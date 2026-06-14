import {
  listInboxItems,
  INBOX_STATUS_LABEL,
  INBOX_STATUS_TONE,
} from '../mock_api.js';
import { loadResource } from '../data_layer.js';
import { escapeHtml } from '../util.js';
import { go } from '../router.js';

// BD-ERROR-01C-C / BD-ERROR-02A — route an inbox data-load failure through the
// global app-shell overlay via the shared data_layer.loadResource adapter (the
// per-screen wrapper was consolidated in 02A). Defensive wire: today
// listInboxItems() resolves from mock/localStorage and does not reject, so the
// failure path is dormant. loadResource shows 'retrying' on retry, dismisses only
// on a successful reload (guarded by onlyIfState), reports server_error with the
// guarded onRetry on failure, and falls back to [] so the inbox's own empty state
// is preserved (the overlay is additive).

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

const ARROW_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="12" height="12">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="13 6 19 12 13 18"/>
  </svg>`;

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
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

function renderItem(item) {
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

  return `
    <article class="bd-card inbox-item${item.unread ? ' inbox-item--unread' : ''}"
             data-inbox-id="${escapeHtml(item.id)}"
             data-href="${escapeHtml(fallbackHref)}"
             role="button"
             tabindex="0"
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

function renderEmpty(tab) {
  const hint = EMPTY_HINTS[tab] || EMPTY_HINTS.all;
  return `
    <div class="bd-card inbox-empty" role="status">
      <div class="inbox-empty__glyph" aria-hidden="true">✉</div>
      <div class="inbox-empty__title">Пока ничего нового</div>
      <p class="inbox-empty__body">${escapeHtml(hint)}</p>
      <button type="button" class="bd-btn primary sm inbox-empty__cta"
              data-inbox-empty-cta="feed">
        Перейти в ленту
      </button>
    </div>
  `;
}

export default async function inbox() {
  // Retry re-runs the inbox load (isRetry=true → 'retrying' progress, dismiss on
  // success). refreshInbox is hoisted, so referencing it here before its
  // declaration is safe — the arrow only runs when the user taps «Повторить».
  const onInboxRetry = () => { refreshInbox(true); };
  let items = await loadResource(listInboxItems, { onRetry: onInboxRetry, isRetry: false });
  let activeTab = resolveActiveTab();

  const root = document.createElement('section');
  root.className = 'screen screen--inbox';

  const unread = unreadCount(items);
  const subText = unread > 0
    ? `${unread} ${pluralUnread(unread)}`
    : 'Все события прочитаны';

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Входящие</h1>
        <p class="bd-topbar__sub" data-inbox-sub>${escapeHtml(subText)}</p>
      </div>
      ${unread > 0
        ? `<span class="bd-badge accent" data-inbox-unread-badge
                  aria-label="Непрочитанных событий: ${escapeHtml(String(unread))}">
             ${escapeHtml(String(unread))}
           </span>`
        : ''}
    </div>
    <div class="feed-chip-row" role="tablist" aria-label="Категории входящих">
      ${TABS.map((t) =>
        `<button class="feed-chip${t.key === activeTab ? ' active' : ''}"
                 data-inbox-tab="${escapeHtml(t.key)}"
                 role="tab" type="button"
                 aria-selected="${t.key === activeTab ? 'true' : 'false'}">
           ${escapeHtml(t.label)}
         </button>`
      ).join('')}
    </div>
    <div class="bd-scroll inbox-list" role="feed" aria-label="События"></div>
  `;

  const chipRow = root.querySelector('.feed-chip-row');
  const listEl  = root.querySelector('.inbox-list');

  function renderList() {
    const visible = filterItems(items, activeTab);
    listEl.innerHTML = visible.length
      ? visible.map(renderItem).join('')
      : renderEmpty(activeTab);
  }

  // Re-run the inbox load and re-render the list. Mirrors feed's refreshList:
  // the list is re-rendered, while the static topbar (unread sub/badge) is left
  // as-is — the retry path is a dormant defensive wire.
  async function refreshInbox(isRetry) {
    items = await loadResource(listInboxItems, { onRetry: onInboxRetry, isRetry });
    renderList();
  }

  function setActiveTab(key) {
    if (!TABS.some((t) => t.key === key) || key === activeTab) return;
    activeTab = key;
    for (const btn of chipRow.querySelectorAll('[data-inbox-tab]')) {
      const isActive = btn.dataset.inboxTab === activeTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    const nextHash = activeTab === 'all' ? '#/inbox' : `#/inbox?tab=${activeTab}`;
    if (location.hash !== nextHash) {
      history.replaceState(null, '', nextHash);
    }
    renderList();
  }

  chipRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-inbox-tab]');
    if (!btn) return;
    setActiveTab(btn.dataset.inboxTab);
  });

  function openHref(href) {
    if (!href) return;
    go(href);
  }

  listEl.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-inbox-action]');
    if (actionBtn) {
      e.stopPropagation();
      openHref(actionBtn.dataset.href);
      return;
    }
    const emptyCta = e.target.closest('[data-inbox-empty-cta]');
    if (emptyCta) {
      go('/feed');
      return;
    }
    const card = e.target.closest('[data-inbox-id]');
    if (!card) return;
    openHref(card.dataset.href);
  });

  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-inbox-id]');
    if (!card || e.target.closest('button')) return;
    e.preventDefault();
    openHref(card.dataset.href);
  });

  renderList();
  return root;
}
