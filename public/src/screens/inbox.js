import { listInboxItems } from '../mock_api.js';
import { escapeHtml } from '../util.js';
import { go } from '../router.js';

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

function renderItem(item) {
  const glyph     = KIND_GLYPH[item.kind] || '•';
  const kindLabel = KIND_LABEL[item.kind] || 'Событие';
  const meta = [
    escapeHtml(kindLabel),
    item.actor ? escapeHtml(item.actor) : '',
    item.time  ? escapeHtml(item.time)  : '',
  ].filter(Boolean).join(' · ');

  const unreadBadge = item.unread
    ? `<span class="bd-badge accent inbox-item__badge">Новое</span>`
    : '';

  return `
    <article class="bd-card inbox-item${item.unread ? ' inbox-item--unread' : ''}"
             data-inbox-id="${escapeHtml(item.id)}"
             data-href="${escapeHtml(item.href)}"
             role="button"
             tabindex="0"
             aria-label="${escapeHtml(item.title)}">
      <div class="feed-card-header">
        <div class="feed-avatar" aria-hidden="true">${escapeHtml(glyph)}</div>
        <div class="feed-card-header__info">
          <div class="feed-card-header__name">${escapeHtml(item.title)}</div>
          <div class="feed-card-header__meta">${meta}</div>
        </div>
        ${unreadBadge}
      </div>
      ${item.preview
        ? `<p class="feed-card-body">${escapeHtml(item.preview)}</p>`
        : ''}
    </article>
  `;
}

function renderEmpty(tab) {
  const hints = {
    all:       'Здесь будут появляться отклики, сообщения и события поездок.',
    responses: 'Новых откликов пока нет — попробуйте опубликовать заявку.',
    messages:  'В чатах пока тишина — напишите водителю или попутчику.',
    rides:     'Событий по поездкам ещё нет — они появятся после первого заказа.',
  };
  return `
    <div class="bd-empty">
      <div class="bd-empty__title">Пока пусто</div>
      <p>${escapeHtml(hints[tab] || hints.all)}</p>
    </div>
  `;
}

export default async function inbox() {
  const items = await listInboxItems();
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

  function openItem(card) {
    const href = card?.dataset.href;
    if (!href) return;
    go(href);
  }

  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('[data-inbox-id]');
    if (!card) return;
    openItem(card);
  });

  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-inbox-id]');
    if (!card) return;
    e.preventDefault();
    openItem(card);
  });

  renderList();
  return root;
}
