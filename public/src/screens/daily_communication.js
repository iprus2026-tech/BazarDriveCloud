import { go } from '../router.js';
import { user } from '../state.js';
import { escapeHtml } from '../util.js';
import {
  DAILY_COMMUNICATION_STATUS_LABEL,
  DAILY_COMMUNICATION_STATUS_TONE,
  DAILY_COMMUNICATION_TABS,
  DAILY_COMMUNICATION_TEMPLATES,
  acknowledgeDailyCommunication,
  listDailyCommunicationThreads,
  resolveDailyCommunication,
  sendDailyCommunicationMessage,
} from '../daily_communication_store.js';

const BACK_SVG = `<svg viewBox='0 0 18 18' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' width='18' height='18'><polyline points='11 4 6 9 11 14'/></svg>`;
const ARROW_SVG = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' width='12' height='12'><line x1='5' y1='12' x2='19' y2='12'/><polyline points='13 6 19 12 13 18'/></svg>`;

const KIND_LABEL = { ride: 'Поездка', passenger: 'Пассажир', driver: 'Водитель', support: 'Поддержка' };
const KIND_GLYPH = { ride: '🚕', passenger: 'П', driver: 'В', support: 'S' };
const PRIORITY_LABEL = { high: 'Высокий', normal: 'Обычный', low: 'Низкий' };
const ROLE_LABEL = { passenger: 'Пассажир', driver: 'Водитель', support: 'Поддержка', system: 'Система' };
const ACK_ACTIONABLE_STATUSES = new Set(['ACK_REQUIRED', 'NEEDS_ACTION']);

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  return qi === -1 ? null : new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function actorRole() {
  const role = user.get().role;
  return role === 'driver' || role === 'passenger' ? role : 'support';
}

function resolveActiveTab() {
  const raw = (getRouteParam('tab') || 'all').toLowerCase();
  return DAILY_COMMUNICATION_TABS.some((t) => t.key === raw) ? raw : 'all';
}

function formatTime(value) {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return '';
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return 'сейчас';
  if (min < 60) return `${min} мин`;
  if (min < 1440) return `${Math.round(min / 60)} ч`;
  return `${Math.round(min / 1440)} д`;
}

function statusHtml(status) {
  const tone = DAILY_COMMUNICATION_STATUS_TONE[status] || 'muted';
  const label = DAILY_COMMUNICATION_STATUS_LABEL[status] || status || 'Открыто';
  return `<span class='dc-status dc-status--${escapeHtml(tone)}'>${escapeHtml(label)}</span>`;
}

function routeHtml(route) {
  if (!route) return '';
  return `<div class='dc-route' aria-label='Маршрут'><span>${escapeHtml(route.from || '—')}</span><span class='dc-route__arrow' aria-hidden='true'>${ARROW_SVG}</span><span>${escapeHtml(route.to || '—')}</span></div>`;
}

function filterThreads(threads, tab) {
  return tab === 'all' ? threads : threads.filter((thread) => thread.kind === tab);
}

function renderThreadCard(thread, selectedId) {
  const selected = thread.id === selectedId;
  const kindLabel = KIND_LABEL[thread.kind] || 'Связь';
  const glyph = KIND_GLYPH[thread.kind] || '•';
  const unreadDot = thread.unread ? `<span class='dc-unread-dot' aria-label='Новое сообщение'></span>` : '';
  return `
    <article class='bd-card dc-thread${selected ? ' dc-thread--selected' : ''}${thread.unread ? ' dc-thread--unread' : ''}'
             data-dc-thread-id='${escapeHtml(thread.id)}' role='button' tabindex='0'
             aria-selected='${selected ? 'true' : 'false'}' aria-label='${escapeHtml(kindLabel)} · ${escapeHtml(thread.title)}'>
      <div class='dc-thread__head'>
        <div class='dc-thread__avatar' aria-hidden='true'>${escapeHtml(glyph)}</div>
        <div class='dc-thread__main'>
          <div class='dc-thread__title-row'><span class='dc-thread__title'>${escapeHtml(thread.title)}</span>${unreadDot}</div>
          <div class='dc-thread__meta'>${escapeHtml(kindLabel)} · ${escapeHtml(thread.counterpartRole || '')}</div>
        </div>
        <div class='dc-thread__side'>${statusHtml(thread.status)}<span class='dc-thread__time'>${escapeHtml(formatTime(thread.updatedAt))}</span></div>
      </div>
      ${routeHtml(thread.route)}
      <p class='dc-thread__summary'>${escapeHtml(thread.summary)}</p>
      <div class='dc-thread__foot'><span class='dc-priority dc-priority--${escapeHtml(thread.priority)}'>${escapeHtml(PRIORITY_LABEL[thread.priority] || 'Обычный')}</span><span>${escapeHtml(thread.counterpart || 'BazarDrive')}</span></div>
    </article>`;
}

function renderMessage(msg) {
  const own = msg.authorRole === actorRole();
  return `<div class='dc-msg dc-msg--${own ? 'out' : 'in'}'><div class='dc-msg__bubble'><div class='dc-msg__role'>${escapeHtml(ROLE_LABEL[msg.authorRole] || 'Участник')}</div><div class='dc-msg__body'>${escapeHtml(msg.body)}</div><div class='dc-msg__time'>${escapeHtml(formatTime(msg.createdAt))}</div></div></div>`;
}

function renderTemplates() {
  return `<div class='dc-template-row' role='group' aria-label='Быстрые ответы'>${DAILY_COMMUNICATION_TEMPLATES.map((item) => `<button type='button' class='dc-template-chip' data-dc-template='${escapeHtml(item.id)}' data-template-body='${escapeHtml(item.body)}'>${escapeHtml(item.label)}</button>`).join('')}</div>`;
}

function renderEmpty(tab) {
  const label = DAILY_COMMUNICATION_TABS.find((t) => t.key === tab)?.label || 'Все';
  return `<div class='bd-card dc-empty' role='status'><div class='dc-empty__glyph' aria-hidden='true'>💬</div><div class='dc-empty__title'>Нет тем в разделе «${escapeHtml(label)}»</div><p class='dc-empty__body'>Операционные сообщения появятся здесь, когда заказ, поездка или поддержка потребуют связи.</p></div>`;
}

function renderDetail(thread) {
  if (!thread) return `<aside class='bd-card dc-detail dc-detail--empty' role='status'><div class='dc-empty__glyph' aria-hidden='true'>⌁</div><div class='dc-empty__title'>Выберите тему</div><p class='dc-empty__body'>Откройте сообщение слева, чтобы увидеть историю и быстрые действия.</p></aside>`;
  const canAck = ACK_ACTIONABLE_STATUSES.has(thread.status);
  const ackButton = canAck
    ? `<button type='button' class='bd-btn primary sm' data-dc-action='ack'>Принять</button>`
    : '';
  const secondaryButton = thread.secondaryHref
    ? `<button type='button' class='bd-btn ghost sm' data-dc-open-route='secondary'>К связанному экрану</button>`
    : '';
  return `
    <aside class='bd-card dc-detail' data-dc-detail-id='${escapeHtml(thread.id)}'>
      <div class='dc-detail__head'><div><div class='dc-detail__eyebrow'>${escapeHtml(KIND_LABEL[thread.kind] || 'Связь')}</div><h2 class='dc-detail__title'>${escapeHtml(thread.title)}</h2><p class='dc-detail__sub'>${escapeHtml(thread.counterpart)} · ${escapeHtml(thread.counterpartRole)}</p></div>${statusHtml(thread.status)}</div>
      ${routeHtml(thread.route)}
      <div class='dc-detail__actions'>${ackButton}<button type='button' class='bd-btn sm' data-dc-action='resolve'>Закрыть</button></div>
      <div class='dc-detail__links'><button type='button' class='bd-btn ghost sm' data-dc-open-route='primary'>Открыть канал</button>${secondaryButton}</div>
      <div class='dc-msg-list' role='log' aria-label='История сообщений'>${(thread.messages || []).map(renderMessage).join('')}</div>
      ${renderTemplates()}
      <div class='dc-composer'><textarea class='bd-textarea dc-composer__input' data-dc-input maxlength='500' rows='3' placeholder='Написать операционное сообщение…' aria-label='Сообщение daily communication'></textarea><button type='button' class='bd-btn primary dc-composer__send' data-dc-send disabled>Отправить</button></div>
    </aside>`;
}

function renderContractCard() {
  return `<div class='bd-card dc-contract' role='region' aria-label='Контракт daily communication'><div class='dc-contract__kicker'>Backend contract</div><div class='dc-contract__title'>communication_threads + communication_messages</div><p class='dc-contract__body'>Runtime-срез хранит прототип в локальном chat-store. Заказы, поездки и назначения не меняются.</p></div>`;
}

export default function dailyCommunication() {
  let activeTab = resolveActiveTab();
  let threads = listDailyCommunicationThreads();
  let selectedId = getRouteParam('thread') || threads[0]?.id || '';
  const root = document.createElement('section');
  root.className = 'screen screen--daily-communication';

  const visibleThreads = () => filterThreads(threads, activeTab);
  const unreadCount = () => threads.reduce((n, thread) => n + (thread.unread ? 1 : 0), 0);
  const actionCount = () => threads.reduce((n, thread) => n + (thread.status === 'NEEDS_ACTION' || thread.status === 'ACK_REQUIRED' ? 1 : 0), 0);
  const selectedThread = () => {
    const visible = visibleThreads();
    let selected = visible.find((thread) => thread.id === selectedId);
    if (!selected) { selected = visible[0] || null; selectedId = selected?.id || ''; }
    return selected;
  };

  function syncUrl() {
    const params = new URLSearchParams();
    if (activeTab !== 'all') params.set('tab', activeTab);
    if (selectedId) params.set('thread', selectedId);
    const nextHash = params.toString() ? `#/daily-communication?${params.toString()}` : '#/daily-communication';
    if (location.hash !== nextHash) history.replaceState(null, '', nextHash);
  }

  function updateSendState() {
    const input = root.querySelector('[data-dc-input]');
    const send = root.querySelector('[data-dc-send]');
    if (input && send) send.disabled = input.value.trim().length === 0;
  }

  function paint() {
    const visible = visibleThreads();
    const selected = selectedThread();
    const unread = unreadCount();
    root.innerHTML = `
      <div class='bd-topbar dc-topbar'><button type='button' class='bd-iconbtn dc-back' data-dc-back aria-label='Назад'>${BACK_SVG}</button><div class='bd-topbar__titles'><h1 class='bd-topbar__title'>Daily Communication</h1><p class='bd-topbar__sub'>Связь пассажир ↔ водитель ↔ поддержка</p></div>${unread ? `<span class='bd-badge accent' aria-label='Новых сообщений: ${escapeHtml(String(unread))}'>${escapeHtml(String(unread))}</span>` : ''}</div>
      <div class='feed-chip-row dc-tabs' role='tablist' aria-label='Daily Communication разделы'>${DAILY_COMMUNICATION_TABS.map((tab) => `<button class='feed-chip${tab.key === activeTab ? ' active' : ''}' data-dc-tab='${escapeHtml(tab.key)}' role='tab' type='button' aria-selected='${tab.key === activeTab ? 'true' : 'false'}'>${escapeHtml(tab.label)}</button>`).join('')}</div>
      <div class='bd-scroll dc-scroll'>${renderContractCard()}<div class='dc-stats' aria-label='Сводка daily communication'><div class='dc-stat'><span>${escapeHtml(String(threads.length))}</span><small>темы</small></div><div class='dc-stat'><span>${escapeHtml(String(actionCount()))}</span><small>в работе</small></div><div class='dc-stat'><span>${escapeHtml(String(unread))}</span><small>новые</small></div></div><div class='dc-grid'><div class='dc-thread-list' role='list' aria-label='Темы связи'>${visible.length ? visible.map((thread) => renderThreadCard(thread, selectedId)).join('') : renderEmpty(activeTab)}</div>${renderDetail(selected)}</div></div>`;
    updateSendState();
  }

  function refreshAfterMutation(updated) {
    threads = listDailyCommunicationThreads();
    if (updated?.id) selectedId = updated.id;
    syncUrl();
    paint();
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-dc-back]')) { go('/inbox'); return; }
    const tab = e.target.closest('[data-dc-tab]');
    if (tab) {
      const key = tab.dataset.dcTab;
      if (!DAILY_COMMUNICATION_TABS.some((item) => item.key === key) || key === activeTab) return;
      activeTab = key; selectedId = visibleThreads()[0]?.id || ''; syncUrl(); paint(); return;
    }
    const card = e.target.closest('[data-dc-thread-id]');
    if (card) { selectedId = card.dataset.dcThreadId; syncUrl(); paint(); return; }
    const action = e.target.closest('[data-dc-action]');
    if (action) {
      const selected = selectedThread();
      if (!selected) return;
      const actionName = action.dataset.dcAction;
      let updated = null;
      if (actionName === 'resolve') updated = resolveDailyCommunication(selected.id, actorRole());
      else if (actionName === 'ack' && ACK_ACTIONABLE_STATUSES.has(selected.status)) updated = acknowledgeDailyCommunication(selected.id, actorRole());
      else return;
      refreshAfterMutation(updated); return;
    }
    const link = e.target.closest('[data-dc-open-route]');
    if (link) {
      const thread = selectedThread();
      const href = link.dataset.dcOpenRoute === 'secondary' ? thread?.secondaryHref : thread?.primaryHref;
      if (href) go(href);
      return;
    }
    const template = e.target.closest('[data-dc-template]');
    if (template) {
      const input = root.querySelector('[data-dc-input]');
      if (input) { input.value = template.dataset.templateBody || ''; input.focus(); updateSendState(); }
      return;
    }
    if (e.target.closest('[data-dc-send]')) {
      const selected = selectedThread();
      const input = root.querySelector('[data-dc-input]');
      const body = input?.value.trim() || '';
      if (selected && body) refreshAfterMutation(sendDailyCommunicationMessage(selected.id, { body, authorRole: actorRole() }));
    }
  });

  root.addEventListener('input', (e) => { if (e.target.closest('[data-dc-input]')) updateSendState(); });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-dc-thread-id]');
    if (!card || e.target.closest('button, textarea')) return;
    e.preventDefault(); selectedId = card.dataset.dcThreadId; syncUrl(); paint();
  });

  paint();
  syncUrl();
  return root;
}
