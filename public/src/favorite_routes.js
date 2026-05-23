// BD-RIDE-HISTORY-06 — Favorite routes from completed ride history.
//
// LocalStorage/mock-only route templates. A favorite route is deliberately
// smaller than a completed ride receipt: only pickup/dropoff and safe route
// estimate fields cross the boundary. Driver/passenger identity, chat,
// rating/comment, payment/earnings, vehicle/phone and active ride state are
// intentionally dropped.

import { go } from './router.js';
import { escapeHtml } from './util.js';
import { readRideHistoryStatus } from './ride_history.js';
import { buildRepeatRouteDraft, writeRepeatRouteDraft } from './repeat_route.js';

const FAVORITE_ROUTES_KEY = 'bazardrive.favorite_routes.v1';
const FAVORITE_NOTICE_KEY = 'bazardrive.favorite_route_notice.v1';
const PROFILE_HISTORY_LIMIT = 20;

const REPEAT_NOTICE_APPLIED = 'Маршрут заполнен из истории поездки';
const REPEAT_NOTICE_COLLISION = 'Сохранён текущий черновик — маршрут из истории не применён';

let currentHistoryEntry = null;
let observerStarted = false;
let enhanceTimer = null;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('-')) return null;
  const numeric = trimmed.replace(/\s+/g, '').replace(/[^\d.,]/g, '');
  if (!numeric || !/\d/.test(numeric)) return null;
  const commaIndex = numeric.lastIndexOf(',');
  const dotIndex = numeric.lastIndexOf('.');
  const separatorIndex = Math.max(commaIndex, dotIndex);
  const fractionLength = separatorIndex >= 0 ? numeric.length - separatorIndex - 1 : 0;
  let normalized;
  if (separatorIndex >= 0 && fractionLength > 0 && fractionLength <= 2) {
    const integerPart = numeric.slice(0, separatorIndex).replace(/\D/g, '');
    const fractionPart = numeric.slice(separatorIndex + 1).replace(/\D/g, '');
    normalized = `${integerPart || '0'}.${fractionPart}`;
  } else {
    normalized = numeric.replace(/\D/g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function routeKey(pickup, dropoff) {
  return `${cleanString(pickup).toLowerCase()}→${cleanString(dropoff).toLowerCase()}`;
}

function historyEntryTimestamp(entry) {
  return entry?.savedAt || entry?.completedAt || '';
}

function parseTimestamp(value) {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  } catch {
    return '';
  }
}

function sortHistoryEntriesDesc(entries) {
  return entries.slice().sort((a, b) => parseTimestamp(historyEntryTimestamp(b)) - parseTimestamp(historyEntryTimestamp(a)));
}

function sortedHistoryEntries() {
  try {
    const result = readRideHistoryStatus();
    const entries = Array.isArray(result.entries) ? result.entries : [];
    return sortHistoryEntriesDesc(entries.filter((e) => e && (e.role === 'passenger' || e.role === 'driver')))
      .slice(0, PROFILE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function readFavoriteStore() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(FAVORITE_ROUTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPlainObject) : [];
  } catch {
    return [];
  }
}

function writeFavoriteStore(list) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(FAVORITE_ROUTES_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function sanitizeFavorite(raw) {
  if (!isPlainObject(raw)) return null;
  const pickup = cleanString(raw.pickup);
  const dropoff = cleanString(raw.dropoff);
  if (!pickup || !dropoff) return null;
  const favorite = {
    id: cleanString(raw.id) || `fav_route_${Date.now()}`,
    source: raw.source === 'ride_history' ? 'ride_history' : 'manual',
    sourceRideId: cleanString(raw.sourceRideId),
    role: raw.role === 'driver' ? 'driver' : 'passenger',
    label: cleanString(raw.label) || `${pickup} → ${dropoff}`,
    pickup,
    dropoff,
    savedAt: cleanString(raw.savedAt) || new Date().toISOString(),
    lastUsedAt: cleanString(raw.lastUsedAt) || null,
  };
  const distance = cleanNumber(raw.distanceKm ?? raw.distance);
  const duration = cleanNumber(raw.durationMin ?? raw.duration);
  const fare = cleanNumber(raw.suggestedPrice ?? raw.suggestedFare ?? raw.fare);
  if (distance != null) favorite.distanceKm = distance;
  if (duration != null) favorite.durationMin = duration;
  if (fare != null) favorite.suggestedFare = fare;
  return favorite;
}

export function loadFavoriteRoutes() {
  return readFavoriteStore().map(sanitizeFavorite).filter(Boolean);
}

export function clearFavoriteRoutes() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(FAVORITE_ROUTES_KEY);
    localStorage.removeItem(FAVORITE_NOTICE_KEY);
  } catch {
    // storage unavailable — fail soft.
  }
}

export function saveFavoriteRouteFromHistory(entry) {
  const repeat = buildRepeatRouteDraft(entry);
  if (!repeat) return null;
  const sourceRideId = cleanString(entry?.tripId || entry?.id);
  const favorite = sanitizeFavorite({
    id: sourceRideId ? `fav_${repeat.role}_${sourceRideId}` : `fav_route_${Date.now()}`,
    source: 'ride_history',
    sourceRideId,
    role: repeat.role,
    label: `${repeat.pickup} → ${repeat.dropoff}`,
    pickup: repeat.pickup,
    dropoff: repeat.dropoff,
    distance: entry?.distance,
    duration: entry?.duration,
    suggestedFare: repeat.suggestedFare,
    savedAt: new Date().toISOString(),
  });
  if (!favorite) return null;

  const list = loadFavoriteRoutes();
  const key = routeKey(favorite.pickup, favorite.dropoff);
  const idx = list.findIndex((item) => routeKey(item.pickup, item.dropoff) === key);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...favorite, id: list[idx].id, savedAt: list[idx].savedAt };
  } else {
    list.unshift(favorite);
  }
  return writeFavoriteStore(list) ? (idx >= 0 ? list[idx] : favorite) : null;
}

export function removeFavoriteRoute(id) {
  const routeId = cleanString(id);
  if (!routeId) return false;
  const next = loadFavoriteRoutes().filter((item) => item.id !== routeId);
  return writeFavoriteStore(next);
}

function markFavoriteUsed(id) {
  const routeId = cleanString(id);
  const list = loadFavoriteRoutes();
  const idx = list.findIndex((item) => item.id === routeId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], lastUsedAt: new Date().toISOString() };
  writeFavoriteStore(list);
}

function writeFavoriteNotice() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(FAVORITE_NOTICE_KEY, '1');
  } catch {
    // storage unavailable — fail soft.
  }
}

function consumeFavoriteNotice() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(FAVORITE_NOTICE_KEY);
    localStorage.removeItem(FAVORITE_NOTICE_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

function writeFavoriteRepeatDraft(favorite) {
  const entry = {
    role: favorite.role,
    tripId: favorite.sourceRideId || favorite.id,
    route: {
      pickupLabel: favorite.pickup,
      dropoffLabel: favorite.dropoff,
    },
    fare: favorite.suggestedFare,
  };
  const ok = writeRepeatRouteDraft(entry);
  if (ok) writeFavoriteNotice();
  return ok;
}

function favoriteRouteCardHtml(route) {
  const meta = [
    route.distanceKm != null ? `${route.distanceKm} км` : '',
    route.durationMin != null ? `${route.durationMin} мин` : '',
    route.lastUsedAt ? `использован ${formatDate(route.lastUsedAt)}` : (route.savedAt ? `сохранён ${formatDate(route.savedAt)}` : ''),
  ].filter(Boolean).join(' · ');
  return `
    <article class="bd-card-tight profile-history__card favorite-routes__card" data-favorite-route-id="${escapeHtml(route.id)}">
      <div class="profile-history__head">
        <span class="bd-badge profile-history__role profile-history__role--passenger">Избранное</span>
      </div>
      <p class="profile-history__route">
        <span class="profile-history__route-from">${escapeHtml(route.pickup)}</span>
        <span class="profile-history__route-arrow" aria-hidden="true">→</span>
        <span class="profile-history__route-to">${escapeHtml(route.dropoff)}</span>
      </p>
      ${meta ? `<p class="profile-history__when favorite-routes__meta">${escapeHtml(meta)}</p>` : ''}
      <div class="profile-history-detail__actions favorite-routes__actions">
        <button type="button" class="bd-btn primary profile-history-detail__action" data-favorite-action="repeat">Повторить</button>
        <button type="button" class="bd-btn profile-history-detail__action" data-favorite-action="remove">Удалить</button>
      </div>
    </article>`;
}

function favoriteRoutesSectionHtml(routes) {
  if (!routes.length) return '';
  return `
    <section class="profile-history favorite-routes" id="profile-favorite-routes-section">
      <div class="profile-history__header">
        <p class="pfp-section-title profile-history__title">Избранные маршруты</p>
        <span class="bd-badge profile-history__count">${escapeHtml(String(routes.length))}</span>
      </div>
      <div class="profile-history__list favorite-routes__list">
        ${routes.map(favoriteRouteCardHtml).join('')}
      </div>
    </section>`;
}

function renderFavoriteRoutesSection(root) {
  const routes = loadFavoriteRoutes();
  const current = root.querySelector('#profile-favorite-routes-section');
  if (!routes.length) {
    current?.remove();
    return;
  }
  const wrap = document.createElement('div');
  wrap.innerHTML = favoriteRoutesSectionHtml(routes).trim();
  const next = wrap.firstElementChild;
  if (!next) return;
  if (current) current.replaceWith(next);
  else {
    const history = root.querySelector('#profile-history-section');
    if (history) history.before(next);
    else root.querySelector('.bd-scroll')?.appendChild(next);
  }
}

function resolveHistoryEntryFromCard(card) {
  const index = Number(card?.dataset?.historyIndex);
  if (!Number.isInteger(index)) return null;
  return sortedHistoryEntries()[index] || null;
}

function injectFavoriteAction(root) {
  const overlay = root.querySelector('#profile-history-detail');
  if (!overlay || overlay.dataset.favoriteEnhanced === '1') return;
  if (!buildRepeatRouteDraft(currentHistoryEntry)) return;
  const actions = overlay.querySelector('.profile-history-detail__actions');
  if (!actions) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bd-btn profile-history-detail__action';
  btn.dataset.favoriteAction = 'save-from-detail';
  btn.textContent = isCurrentEntryFavorite() ? '★ В избранном' : '☆ В избранные';
  actions.prepend(btn);
  overlay.dataset.favoriteEnhanced = '1';
}

function isCurrentEntryFavorite() {
  const repeat = buildRepeatRouteDraft(currentHistoryEntry);
  if (!repeat) return false;
  const key = routeKey(repeat.pickup, repeat.dropoff);
  return loadFavoriteRoutes().some((item) => routeKey(item.pickup, item.dropoff) === key);
}

function wireProfileEnhancer(root) {
  if (root.dataset.favoriteRoutesWired === '1') return;
  root.dataset.favoriteRoutesWired = '1';

  root.addEventListener('click', (e) => {
    const historyCard = e.target.closest('[data-history-index]');
    if (historyCard) currentHistoryEntry = resolveHistoryEntryFromCard(historyCard);

    const favoriteBtn = e.target.closest('[data-favorite-action]');
    if (!favoriteBtn) return;
    const action = favoriteBtn.dataset.favoriteAction;

    if (action === 'save-from-detail') {
      const saved = saveFavoriteRouteFromHistory(currentHistoryEntry);
      if (saved) {
        favoriteBtn.textContent = '★ В избранном';
        renderFavoriteRoutesSection(root);
      }
      return;
    }

    const card = favoriteBtn.closest('[data-favorite-route-id]');
    const id = card?.dataset?.favoriteRouteId;
    if (!id) return;
    const route = loadFavoriteRoutes().find((item) => item.id === id);

    if (action === 'remove') {
      removeFavoriteRoute(id);
      renderFavoriteRoutesSection(root);
      return;
    }

    if (action === 'repeat' && route && writeFavoriteRepeatDraft(route)) {
      markFavoriteUsed(id);
      go('/new');
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const historyCard = e.target.closest('[data-history-index]');
    if (historyCard) currentHistoryEntry = resolveHistoryEntryFromCard(historyCard);
  });

  root.querySelector('#pfp-quick-fav')?.addEventListener('click', () => {
    const section = root.querySelector('#profile-favorite-routes-section') || root.querySelector('#profile-history-section');
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function enhanceProfile() {
  const root = document.querySelector('.screen--profile');
  if (!root) return;
  wireProfileEnhancer(root);
  renderFavoriteRoutesSection(root);
  injectFavoriteAction(root);
}

function enhanceComposerNotice() {
  if ((location.hash || '').split('?')[0] !== '#/new') return;
  if (!consumeFavoriteNotice()) return;
  const note = document.querySelector('#composer-prefill-note');
  const text = document.querySelector('#composer-prefill-note-text');
  if (!note || !text || note.hidden) return;
  const current = text.textContent.trim();
  if (current === REPEAT_NOTICE_APPLIED) {
    text.textContent = 'Маршрут заполнен из избранного';
  } else if (current === REPEAT_NOTICE_COLLISION) {
    text.textContent = 'Сохранён текущий черновик — маршрут из избранного не применён';
  }
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => {
    enhanceProfile();
    enhanceComposerNotice();
  }, 0);
}

export function initFavoriteRoutes() {
  if (observerStarted) return;
  observerStarted = true;
  window.addEventListener('hashchange', scheduleEnhance);
  const app = document.getElementById('app');
  if (app) {
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(app, { childList: true, subtree: true });
  }
  scheduleEnhance();
}
