// BD-MAP-06 — cross-check handed-off orders against the canonical
// active-ride record so the passenger entry never reopens a terminal
// trip. ride_state.js is the foundation layer (no imports back into
// mock_api.js), so this introduces no circular dependency.
import { findActiveRide, loadActiveRideStore, saveActiveRideStore } from './ride_state.js';

// ── Ownership marker for locally created posts ────────────────
// Used by BD-PROFILE-MY-POSTS-01 to identify "Мои публикации".
// All mock posts in this file are seed data from other authors; only
// posts created via createFeedPost() carry the local-user marker.
export const LOCAL_USER_ID = 'local-user';

// ── Feed V2 mock data ──────────────────────────────────────────
export const FEED_POSTS_V2 = [
  {
    id: 'sys-1',
    type: 'system',
    pinned: true,
    author: 'BazarDrive',
    role: 'Администрация',
    time: '2 ч',
    title: 'Новые тарифы с 1 мая',
    body: 'Базовая ставка по городу повышена на 8%. Минимальная стоимость поездки — 180 ₽. Подробности в разделе «Правила».',
    likes: 142,
    comments: 38,
  },
  {
    id: 'trip-1',
    type: 'trip',
    author: 'Рустам К.',
    role: 'Водитель · ★ 4.92',
    time: '15 мин',
    from: 'Москва',
    to: 'Тула',
    price: '2 800 ₽',
    seats: 3,
    when: 'Сегодня, 18:30',
    body: 'Еду с Юго-Запада, могу заехать по пути. Авто Camry, кондиционер. Курю на остановках.',
    likes: 8,
    comments: 4,
  },
  {
    id: 'trip-2',
    type: 'trip',
    passenger: true,
    author: 'Анна М.',
    role: 'Пассажир',
    time: '32 мин',
    from: 'Аэропорт Внуково',
    to: 'м. Парк Победы',
    price: null,
    seats: null,
    when: 'Завтра, 07:00',
    body: 'Нужно к 8:00 на работу, 1 чемодан + ручная кладь. Готова заплатить 1 500 ₽.',
    likes: 2,
    comments: 6,
  },
  {
    id: 'ann-1',
    type: 'announcement',
    pinned: true,
    author: 'BazarDrive',
    role: 'Администрация',
    time: '1 д',
    title: 'Обновлены правила сообщества',
    body: 'Добавлен пункт о запрете демпинга и недобросовестной конкуренции. Прочтите перед публикацией.',
    likes: 67,
    comments: 22,
  },
  {
    id: 'mkt-1',
    type: 'marketplace',
    author: 'Нурлан',
    role: null,
    time: '26 ч',
    title: 'Camry 70 — зимняя резина Bridgestone 215/55 R17',
    body: 'Использовалась один сезон. Износ 5%. Самовывоз с СТО на Сейфуллина.',
    price: '45 000 ₸',
    tags: ['запчасти', 'астана'],
    likes: 5,
    comments: 2,
  },
  {
    id: 'trip-3',
    type: 'trip',
    author: 'Сергей Л.',
    role: 'Водитель · ★ 4.78',
    time: '1 ч',
    from: 'Казань',
    to: 'Москва',
    price: '4 500 ₽',
    seats: 2,
    when: 'Пятница, 06:00',
    body: 'Возвращаюсь в столицу, есть 2 места. Опытный водитель, 12 лет стажа.',
    likes: 14,
    comments: 9,
  },
];

// ── My publications (BD-PROFILE-MY-POSTS-01) ───────────────────
// Persists locally-created feed posts so they survive reloads and can be
// surfaced under «Мои публикации» in Profile. Seed FEED_POSTS_V2 entries
// are NOT persisted here — only posts created via createFeedPost().
const MY_POSTS_KEY = 'bazardrive.myposts.v1';

function loadMyPostsRaw() {
  try {
    const raw = localStorage.getItem(MY_POSTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistMyPosts(list) {
  try { localStorage.setItem(MY_POSTS_KEY, JSON.stringify(list)); } catch {}
}

// BD-AUTH-BOUNDARY-01 — "Мои публикации" is the user's own authored feed
// posts (createdByCurrentUser=true). Wiped on logout / local reset so a
// new local identity does not inherit posts authored by the previous one.
// Also strips the in-memory hydrated entries so the feed renders cleanly
// without a reload.
export function clearMyPostsStore() {
  try { localStorage.removeItem(MY_POSTS_KEY); } catch {}
  for (let i = FEED_POSTS_V2.length - 1; i >= 0; i--) {
    if (FEED_POSTS_V2[i] && FEED_POSTS_V2[i].createdByCurrentUser === true) {
      FEED_POSTS_V2.splice(i, 1);
    }
  }
}

// Hydrate on module load: re-inject persisted owned posts so they appear
// on the feed and in «Мои публикации» across reloads. Persisted store is
// already newest-first; spread-unshift preserves that order (iterating +
// per-item unshift would reverse it).
(function hydrateMyPosts() {
  const persisted = loadMyPostsRaw();
  if (!persisted.length) return;
  const existingIds = new Set(FEED_POSTS_V2.map((p) => p.id));
  const fresh = persisted.filter((p) => p && p.id && !existingIds.has(p.id));
  if (fresh.length) FEED_POSTS_V2.unshift(...fresh);
})();

export async function listFeedPosts() {
  return mergeFeedAndRideOrderPosts(FEED_POSTS_V2, listRideOrdersAsFeedPosts());
}

export function createFeedPost(post) {
  const owned = {
    id:                    `user-${Date.now()}`,
    likes:                 0,
    comments:              0,
    time:                  'Только что',
    ...post,
    authorId:              LOCAL_USER_ID,
    createdByCurrentUser:  true,
    createdAt:             Date.now(),
  };
  FEED_POSTS_V2.unshift(owned);
  persistMyPosts([owned, ...loadMyPostsRaw()]);
  return owned;
}

// Returns posts owned by the current user, newest first. Reads both the
// persisted store and the in-memory FEED_POSTS_V2 (in case a future caller
// adds an owned post without going through createFeedPost), deduped by id.
export function listMyPostsSync() {
  const persisted = loadMyPostsRaw();
  const inMemoryOwned = FEED_POSTS_V2.filter((p) => p?.createdByCurrentUser === true);
  const byId = new Map();
  for (const p of [...persisted, ...inMemoryOwned]) {
    if (p && p.id && !byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function listMyPosts() {
  return listMyPostsSync();
}

// ── Inbox foundation (BD-RIDE-INBOX-01 + BD-RIDE-INBOX-02) ─────
// Lightweight, in-memory mock for the "Входящие" hub.
//   kind:    'response' | 'message' | 'ride'
//   tab:     virtual grouping key (responses | messages | rides)
//   role:    'passenger' | 'driver' — viewer's role in this thread
//   actor:   counterparty name (driver name for passenger view, etc.)
//   actorRole: display label («Водитель», «Пассажир»)
//   route:   { from, to } — ride/order summary
//   status:  normalized status key — see STATUS_LABEL/STATUS_TONE
//   summary: last message / response summary (one-liner)
//   time:    mock recency string
//   unread:  affects unread badge + visual accent
//   primary: { label, href }   — primary safe action
//   secondary: { label, href } — optional helper action (often Chat)
//   href:    fallback open-target if no primary action
const INBOX_ITEMS_V1 = [
  {
    id:        'inbox-response-1',
    kind:      'response',
    tab:       'responses',
    role:      'passenger',
    actor:     'Рустам К.',
    actorRole: 'Водитель · ★ 4,92',
    route:     { from: 'Внуково', to: 'Парк Победы' },
    status:    'NEW_RESPONSE',
    summary:   'Подъеду к подъезду №3, позвоню. Цена 950 ₽, подача 4 мин.',
    time:      '2 мин',
    unread:    true,
    primary:   { label: 'Посмотреть отклик', href: '/responses?orderId=order-demo-response-1&state=list' },
    secondary: { label: 'В чат',             href: '/chat?responseId=response_1' },
  },
  {
    id:        'inbox-response-2',
    kind:      'response',
    tab:       'responses',
    role:      'driver',
    actor:     'Анна М.',
    actorRole: 'Пассажир',
    route:     { from: 'Аэропорт Внуково', to: 'м. Парк Победы' },
    status:    'WAITING_REPLY',
    summary:   'Готова к 07:00, 1 чемодан. Подтвердите подачу, пожалуйста.',
    time:      '8 мин',
    unread:    true,
    primary:   { label: 'Ответить пассажиру', href: '/respond?postId=trip-2' },
    secondary: { label: 'В чат',              href: '/chat?responseId=response_2' },
  },
  {
    id:        'inbox-message-1',
    kind:      'message',
    tab:       'messages',
    role:      'driver',
    actor:     'Анна М.',
    actorRole: 'Пассажир',
    route:     { from: 'Аэропорт Внуково', to: 'м. Парк Победы' },
    status:    'ACCEPTED',
    summary:   'Спасибо! Буду ждать у выхода №2, ориентир — кофейня.',
    time:      '14 мин',
    unread:    true,
    primary:   { label: 'Открыть чат',       href: '/chat?tripId=trip-2' },
    secondary: { label: 'К активной поездке', href: '/active-ride?role=driver&tripId=trip-2&status=DRIVER_EN_ROUTE' },
  },
  {
    id:        'inbox-ride-1',
    kind:      'ride',
    tab:       'rides',
    role:      'passenger',
    actor:     'Рустам К.',
    actorRole: 'Водитель · Toyota Camry',
    route:     { from: 'ТЦ Мега', to: 'Аэропорт, терминал B' },
    status:    'DRIVER_EN_ROUTE',
    summary:   'Водитель в пути · подача через 4 мин.',
    time:      '1 мин',
    unread:    false,
    primary:   { label: 'К поездке',  href: '/active-ride?role=passenger&status=DRIVER_EN_ROUTE' },
    secondary: { label: 'Открыть чат', href: '/chat?tripId=trip-mega-vnukovo' },
  },
  {
    id:        'inbox-ride-2',
    kind:      'ride',
    tab:       'rides',
    role:      'driver',
    actor:     'Анна М.',
    actorRole: 'Пассажир',
    route:     { from: 'Внуково', to: 'Парк Победы' },
    status:    'IN_PROGRESS',
    summary:   'Везёте пассажира. До места ~28 мин.',
    time:      'сейчас',
    unread:    true,
    primary:   { label: 'Продолжить поездку', href: '/active-ride?role=driver&tripId=feed-trip-2&status=IN_PROGRESS' },
    secondary: { label: 'В чат',              href: '/chat?tripId=feed-trip-2' },
  },
  {
    id:        'inbox-ride-3',
    kind:      'ride',
    tab:       'rides',
    role:      'passenger',
    actor:     'Сергей Л.',
    actorRole: 'Водитель · ★ 4,78',
    route:     { from: 'Казань', to: 'Москва' },
    status:    'COMPLETED',
    summary:   'Поездка завершена. Оставьте оценку, если ещё не делали.',
    time:      'вчера',
    unread:    false,
    primary:   { label: 'Открыть чат',     href: '/chat?tripId=trip-3' },
    secondary: { label: 'Посмотреть пост', href: '/post?id=trip-3' },
  },
];

// Normalized status copy for the ride/order flow. Matches active-ride
// language so inbox surfaces stay coherent with the live flow screens.
export const INBOX_STATUS_LABEL = {
  NEW_RESPONSE:    'Новый отклик',
  WAITING_REPLY:   'Ждём ответа',
  ACCEPTED:        'Принят',
  DRIVER_EN_ROUTE: 'Водитель едет',
  IN_PROGRESS:     'В пути',
  COMPLETED:       'Завершено',
  CANCELED:        'Отменено',
};

// Visual tone for status badges — maps to existing bd-badge variants.
export const INBOX_STATUS_TONE = {
  NEW_RESPONSE:    'accent',
  WAITING_REPLY:   'warning',
  ACCEPTED:        'success',
  DRIVER_EN_ROUTE: 'info',
  IN_PROGRESS:     'info',
  COMPLETED:       'muted',
  CANCELED:        'danger',
};

export async function listInboxItems() {
  // Return a defensive copy so screens cannot mutate the seed.
  return INBOX_ITEMS_V1.map((item) => ({ ...item }));
}

// ── Legacy posts (classic announcements board) ─────────────────
const STORE_KEY = 'bazardrive.posts.v1';

const SEED = [
  {
    id: 1,
    title: 'Аренда KIA Rio посуточно',
    body: 'Чистый салон, полный бак, без водителя. Алматы и пригород. Залог 50 000 ₸.',
    tags: ['аренда', 'алматы', 'авто'],
    author: 'Айдос',
    createdAtOffsetMs: -1000 * 60 * 35,
  },
  {
    id: 2,
    title: 'Камри 70 — комплект зимней резины Bridgestone 215/55 R17',
    body: 'Использовалась один сезон. Износ 5%. Самовывоз с СТО на Сейфуллина.',
    tags: ['запчасти', 'астана'],
    author: 'Нурлан',
    createdAtOffsetMs: -1000 * 60 * 60 * 26,
  },
  {
    id: 3,
    title: 'Ищу попутку Алматы → Бишкек',
    body: 'Один пассажир без багажа. Готов разделить топливо. Выезд утром в субботу.',
    tags: ['попутка'],
    author: 'Жанибек',
    createdAtOffsetMs: -1000 * 60 * 60 * 5,
  },
  {
    id: 4,
    title: 'Hyundai Accent на свадьбу с водителем',
    body: 'Белый, с лентами и куклой. 4 часа аренды, проезд по городу включён.',
    tags: ['свадьба', 'шымкент'],
    author: 'Алия',
    createdAtOffsetMs: -1000 * 60 * 60 * 50,
  },
];

let cache = null;

function seedFresh() {
  const now = Date.now();
  return SEED.map(({ createdAtOffsetMs, ...rest }) => ({
    ...rest,
    createdAt: now + createdAtOffsetMs,
  }));
}

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    // fall through to seed
  }
  cache = seedFresh();
  persist();
  return cache;
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — keep cache in-memory only
  }
}

function nextId() {
  return load().reduce((max, p) => Math.max(max, p.id || 0), 0) + 1;
}

export async function listPosts() {
  const posts = load().slice();
  posts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return posts;
}

export async function createPost({ title, body, tags }) {
  const post = {
    id: nextId(),
    title: String(title ?? '').trim(),
    body: String(body ?? '').trim(),
    tags: Array.isArray(tags) ? tags.filter(Boolean).map(String) : [],
    author: 'Вы',
    createdAt: Date.now(),
  };
  cache = [post, ...load()];
  persist();
  return post;
}

export function _resetForTests() {
  cache = null;
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

// ── Ride orders (BD-MAP-05 OrderMapDraft) ──────────────────────
// Local mock passenger orders created from the routeDraft. No backend,
// no driver assignment, no push — just a localStorage list newest-first
// so DriverMap / nearby-orders surfaces can list them later.
const RIDE_ORDERS_KEY = 'bazardrive.ride_orders.v1';

function loadRideOrdersRaw() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(RIDE_ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistRideOrders(list) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RIDE_ORDERS_KEY, JSON.stringify(list));
  } catch {
    // fail soft
  }
}

// BD-ACTIVE-07 — Sanitize the passenger snapshot pinned at order
// creation. Stored as-is on the canonical ride order so later
// driver-side accept / active-ride / chat / history surfaces never have
// to fall back to a seed/mock passenger ("Анна М.") that belongs to a
// different orderId.
function sanitizePassengerSnapshot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return null;
  const initials = typeof input.initials === 'string' && input.initials.trim()
    ? input.initials.trim()
    : name.charAt(0).toUpperCase();
  const phoneMasked = typeof input.phoneMasked === 'string' ? input.phoneMasked.trim() : '';
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  const authorId = typeof input.authorId === 'string' && input.authorId.trim()
    ? input.authorId.trim()
    : null;
  return {
    name,
    initials,
    phoneMasked,
    comment,
    authorId,
    isCurrentUser: input.isCurrentUser === true,
  };
}

export function createRideOrder(input = {}) {
  const order = {
    id: `order-${Date.now()}`,
    type: input.type === 'ride_order' ? 'ride_order' : 'passenger_request',
    source: input.source === 'feed' ? 'feed' : 'map',
    pickup: input.pickup ?? null,
    dropoff: input.dropoff ?? null,
    distanceKm: Number(input.distanceKm) || 0,
    durationMin: Number(input.durationMin) || 0,
    estimatedPrice: Number(input.estimatedPrice) || 0,
    estimatedPriceLabel: typeof input.estimatedPriceLabel === 'string'
      ? input.estimatedPriceLabel.trim()
      : '',
    scheduledMode: input.scheduledMode === 'later' ? 'later' : 'now',
    scheduledAt: input.scheduledAt ?? new Date().toISOString(),
    scheduledLabel: typeof input.scheduledLabel === 'string'
      ? input.scheduledLabel.trim()
      : '',
    comment: typeof input.comment === 'string' ? input.comment : '',
    // BD-ACTIVE-07 — Per-order passenger snapshot captured at creation.
    // Carries the order author's identity so driver-side accept can hand
    // off the right passenger to /active-ride without falling back to
    // the demo "Анна М." seed.
    passenger: sanitizePassengerSnapshot(input.passenger),
    status: 'CREATED',
    createdAt: new Date().toISOString(),
  };
  const list = [order, ...loadRideOrdersRaw()];
  persistRideOrders(list);
  return order;
}

export function listNearbyOrders() {
  return loadRideOrdersRaw()
    .filter((o) => o && o.status === 'CREATED' && !o.demo)
    .slice(0, 20);
}

// BD-DRIVER-01 — driver accepts a published mock order. Mutates the
// stored order in place: status flips from CREATED → ACCEPTED so it
// drops out of listNearbyOrders() and a driver-side surface can pick
// it up later (active-ride mock). No backend, no driver assignment
// state machine, no push. Returns the updated order, or null if the
// id was not found / order was already non-CREATED.
export function acceptNearbyOrder(id) {
  if (typeof id !== 'string' || !id) return null;
  const list = loadRideOrdersRaw();
  let updated = null;
  const next = list.map((o) => {
    if (o && o.id === id && o.status === 'CREATED') {
      updated = {
        ...o,
        status: 'ACCEPTED',
        acceptedAt: new Date().toISOString(),
      };
      return updated;
    }
    return o;
  });
  if (!updated) return null;
  persistRideOrders(next);
  return updated;
}

export function clearRideOrdersStore() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(RIDE_ORDERS_KEY);
  } catch {
    // fail soft
  }
}

// ── Canonical ride-order spine API (BD-RIDE-ORDER-UNIFY-01) ────
// Thin spine helpers over the same `bazardrive.ride_orders.v1` store so
// callers reach for one canonical surface regardless of entry point
// (Composer /new, OrderMapDraft, DriverMap, ActiveRide handoff).
// Names mirror the spec on issue #238:
//   getOrderById, acceptOrder, updateTripStatus.

export function getOrderById(id) {
  if (typeof id !== 'string' || !id) return null;
  const list = loadRideOrdersRaw();
  const found = list.find((o) => o && o.id === id);
  return found ? { ...found } : null;
}

// BD-RESPONSES-01 — the static Inbox "driver responded" notification
// (inbox-response-1) points at this canonical demo order so the passenger can
// open the offers board and actually BUILD the active ride (select → /active-ride),
// not hit a dead-end. Ride orders are runtime/localStorage data, so a static href
// alone resolves to nothing on a fresh load — this idempotently materialises the
// order. Called when the Inbox screen MOUNTS (not at module load), so the
// lifecycle smokes that start from an empty ride-order store are unaffected.
export const DEMO_RESPONSE_ORDER_ID = 'order-demo-response-1';

export function ensureDemoResponseOrder() {
  const tripId = `trip_${DEMO_RESPONSE_ORDER_ID}`;
  const linkedRide = findActiveRide(tripId);
  const rideTerminal = !!linkedRide && TERMINAL_ACTIVE_RIDE_STATUSES.has(linkedRide.status);
  const existing = getOrderById(DEMO_RESPONSE_ORDER_ID);
  // Reuse only a still-fresh demo order: status CREATED (not yet consumed by a
  // select → accept) AND no terminal ride sitting on its fixed tripId. Otherwise
  // regenerate, so re-opening the notification after one completed/canceled demo
  // lifecycle restores a working CTA instead of reopening the finished trip.
  if (existing && existing.status === 'CREATED' && !rideTerminal) return existing;
  if (rideTerminal) {
    // Drop the terminal handoff ride so the next select builds a fresh one.
    const store = loadActiveRideStore();
    delete store[tripId];
    saveActiveRideStore(store);
  }
  const now = new Date().toISOString();
  const order = {
    id: DEMO_RESPONSE_ORDER_ID,
    type: 'passenger_request',
    source: 'map',
    pickup: { id: null, label: 'Внуково' },
    dropoff: { id: null, label: 'Парк Победы' },
    distanceKm: 24,
    durationMin: 38,
    estimatedPrice: 950,
    estimatedPriceLabel: '950',
    scheduledMode: 'now',
    scheduledAt: now,
    scheduledLabel: '',
    comment: '',
    passenger: null,
    status: 'CREATED',
    // Demo-only: keep this order OUT of the shared published-order surfaces
    // (Feed via rideOrderToFeedPost, DriverMap via listNearbyOrders) so a user
    // who only opens notifications never appears to have published a ride.
    demo: true,
    createdAt: now,
  };
  // Replace any stale demo order (e.g. a prior ACCEPTED one) rather than stacking.
  const rest = loadRideOrdersRaw().filter((o) => !o || o.id !== DEMO_RESPONSE_ORDER_ID);
  persistRideOrders([order, ...rest]);
  return order;
}

// Spine alias for acceptNearbyOrder — keeps the legacy export stable
// while exposing the name listed in the unified mock API contract.
export function acceptOrder(id) {
  return acceptNearbyOrder(id);
}

// BD-MAP-06 — Passenger order → DriverMap handoff link. Resolves the
// canonical active-ride tripId (`trip_<orderId>`) for the passenger's
// most recent order that a driver has already taken (ACCEPTED or
// IN_PROGRESS) AND whose shared active-ride record is still live. Used so
// /active-ride?role=passenger (with no explicit tripId in the URL) lands
// on the passenger's real handed-off trip instead of the demo ride.
//
// The ride-order status alone is not enough: a ride order can sit at
// ACCEPTED while its `active_ride.v1` record has already moved to a
// terminal status (COMPLETED / CANCELED / NO_SHOW). Returning that
// tripId would let the passenger entry reopen a stale, finished trip.
// So each candidate is cross-checked against the canonical active-ride
// record: skip when there is no record, or when it is terminal. Returns
// null when nothing live is found, so callers keep their demo fallback.
const HANDED_OFF_ORDER_STATUSES = new Set(['ACCEPTED', 'IN_PROGRESS']);
const TERMINAL_ACTIVE_RIDE_STATUSES = new Set(['COMPLETED', 'CANCELED', 'NO_SHOW']);

export function findLatestHandedOffOrderTripId() {
  // loadRideOrdersRaw() is newest-first (createRideOrder unshifts), so
  // the first live match is the most recently handed-off active trip.
  for (const o of loadRideOrdersRaw()) {
    if (!o || typeof o.id !== 'string' || !HANDED_OFF_ORDER_STATUSES.has(o.status)) continue;
    const tripId = `trip_${o.id}`;
    const ride = findActiveRide(tripId);
    // No seeded active-ride record → nothing to show; skip safely.
    if (!ride) continue;
    // Active ride already finished → do not reopen a terminal trip.
    if (TERMINAL_ACTIVE_RIDE_STATUSES.has(ride.status)) continue;
    return tripId;
  }
  return null;
}

// Allowed lifecycle transitions for a canonical ride order. CREATED is
// creation-only: createRideOrder() publishes a new order, while
// updateTripStatus() may only move an existing order forward through the
// mock lifecycle. Terminal statuses cannot be reopened into Feed/DriverMap.
const RIDE_ORDER_TRANSITIONS = {
  CREATED:     new Set(['ACCEPTED', 'CANCELED']),
  ACCEPTED:    new Set(['IN_PROGRESS', 'COMPLETED', 'CANCELED']),
  IN_PROGRESS: new Set(['COMPLETED', 'CANCELED']),
  COMPLETED:   new Set([]),
  CANCELED:    new Set([]),
};

export function updateTripStatus(id, status) {
  if (typeof id !== 'string' || !id) return null;
  if (typeof status !== 'string' || status === 'CREATED') return null;

  const list = loadRideOrdersRaw();
  let updated = null;

  const next = list.map((o) => {
    if (!o || o.id !== id) return o;

    const currentStatus = typeof o.status === 'string' ? o.status : 'CREATED';
    const allowedNext = RIDE_ORDER_TRANSITIONS[currentStatus];

    if (!allowedNext || !allowedNext.has(status)) {
      return o;
    }

    updated = {
      ...o,
      status,
      statusUpdatedAt: new Date().toISOString(),
    };

    return updated;
  });

  if (!updated) return null;
  persistRideOrders(next);
  return updated;
}

// ── Ride order → Feed projection (BD-RIDE-ORDER-UNIFY-01) ──────
// Read-side adapter: surfaces map-created CREATED ride orders as
// passenger ride cards in Feed without duplicating them into
// FEED_POSTS_V2 / MY_POSTS_KEY. bazardrive.ride_orders.v1 remains the
// single source of truth for ride orders.
function pointLabel(point, fallback) {
  if (point && typeof point.label === 'string' && point.label.trim()) {
    return point.label.trim();
  }
  return fallback;
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatRideOrderTime(order) {
  if (!order || typeof order !== 'object') return 'Сейчас';
  if (order.scheduledMode !== 'later') return 'Сейчас';
  const ts = Date.parse(order.scheduledAt);
  if (!Number.isFinite(ts)) return 'Сейчас';
  const when = new Date(ts);
  const now  = new Date();
  const hhmm = `${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
  const sameDay = when.getFullYear() === now.getFullYear()
    && when.getMonth() === now.getMonth()
    && when.getDate() === now.getDate();
  if (sameDay) return `Сегодня, ${hhmm}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow = when.getFullYear() === tomorrow.getFullYear()
    && when.getMonth() === tomorrow.getMonth()
    && when.getDate() === tomorrow.getDate();
  if (isTomorrow) return `Завтра, ${hhmm}`;
  return `${pad2(when.getDate())}.${pad2(when.getMonth() + 1)}, ${hhmm}`;
}

// Preserves user-typed budget labels (`1 500`, `1 500 ₽`) when projecting
// ride orders into Feed, instead of falling back to numeric estimatedPrice
// which strips spaces and other formatting.
function formatMoneyLabel(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /₽\s*$/.test(text) ? text : `${text} ₽`;
}

function formatRideOrderPrice(order) {
  const label = formatMoneyLabel(order && order.estimatedPriceLabel);
  if (label) return label;

  const estimatedPrice = Number(order && order.estimatedPrice);
  return Number.isFinite(estimatedPrice) && estimatedPrice > 0
    ? `${estimatedPrice} ₽`
    : null;
}

function formatRideOrderWhen(order) {
  const label = String((order && order.scheduledLabel) || '').trim();
  if (label) return label;
  return formatRideOrderTime(order);
}

export function rideOrderToFeedPost(order) {
  if (!order || typeof order !== 'object') return null;
  if (order.demo) return null;
  if (order.status !== 'CREATED') return null;

  const id = String(order.id || '');
  if (!id) return null;

  const comment = typeof order.comment === 'string' ? order.comment.trim() : '';

  return {
    id,
    orderId: id,
    source: order.source || 'map',
    canonical: 'ride_order',
    type: 'trip',
    passenger: true,
    author: 'Вы',
    role: 'Пассажир',
    time: 'Только что',
    from: pointLabel(order.pickup, 'Точка подачи'),
    to: pointLabel(order.dropoff, 'Точка назначения'),
    when: formatRideOrderWhen(order),
    price: formatRideOrderPrice(order),
    seats: null,
    body: comment || null,
    rideOrderStatus: order.status,
    createdAt: Date.parse(order.createdAt) || Date.now(),
    createdByCurrentUser: true,
  };
}

export function listRideOrdersAsFeedPosts() {
  const raw = loadRideOrdersRaw();
  if (!Array.isArray(raw) || !raw.length) return [];
  const out = [];
  for (const order of raw) {
    const projected = rideOrderToFeedPost(order);
    if (projected) out.push(projected);
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

export function mergeFeedAndRideOrderPosts(feedPosts, rideOrderPosts) {
  const feed = Array.isArray(feedPosts) ? feedPosts : [];
  const rides = Array.isArray(rideOrderPosts) ? rideOrderPosts : [];

  const canonicalIds = new Set();
  const dedupedRides = [];
  for (const p of rides) {
    if (!p || !p.id) continue;
    const idKey = String(p.id);
    if (canonicalIds.has(idKey)) continue;
    canonicalIds.add(idKey);
    dedupedRides.push(p);
  }

  if (!canonicalIds.size) return feed.slice();

  const filteredFeed = feed.filter((p) => {
    if (!p) return false;
    if (p.id && canonicalIds.has(String(p.id))) return false;
    if (p.orderId && canonicalIds.has(String(p.orderId))) return false;
    return true;
  });

  return [...dedupedRides, ...filteredFeed];
}

// ── Driver ride receipts (BD-RIDE-HISTORY-D-01, issue #381) ───────────────
// Canonical post-completion financial document for a driver's completed
// ride. The driver earnings flow (active_ride.js → buildDriverEarningsPayload)
// computes `net` exactly ONCE and persists this object. Ride history, Driver
// payouts and the Trip receipt screen all READ this shape and only FORMAT it
// — they never recompute fare / commission / tip / net. No backend, no real
// payments, no balances, no tax / accounting math.
//
// Shape (the single source of truth for every completed-ride money surface):
//   { tripId, completedAt, fare, commission, tip, net, paymentMode, status }
// fare / tip / net are whole-ruble numbers; `commission` is stored already
// SIGNED (negative) so every reader formats it verbatim instead of
// re-deriving a sign. paymentMode is 'cash' | 'noncash'.
const DRIVER_RECEIPTS_KEY = 'bazardrive.driver_receipts.v1';

const VALID_PAYMENT_MODES = new Set(['cash', 'noncash']);

// Canonical demo receipt (issue #381). Always resolvable at
// /receipt?tripId=48-321 so the render gate + manual URLs work without first
// driving a live completion. Persisted receipts override it by tripId.
export const DEMO_DRIVER_RECEIPT = Object.freeze({
  tripId:      '48-321',
  completedAt: '2026-06-04T09:12:00.000Z',
  fare:        1540,
  commission:  -185,
  tip:         120,
  net:         1475,
  paymentMode: 'cash',
  status:      'completed',
});

function loadDriverReceiptsRaw() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DRIVER_RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r === 'object') : [];
  } catch {
    return [];
  }
}

function persistDriverReceipts(list) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DRIVER_RECEIPTS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — fail soft.
  }
}

function toReceiptInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toReceiptTripId(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

// Normalize to the canonical receipt shape. Returns null when the identity
// (tripId) or any money field is missing / malformed, so a partial write can
// never poison the store or the receipt screen. This is the data boundary —
// it copies and rounds the persisted numbers but never combines them, so the
// "net computed once" invariant is preserved.
export function sanitizeDriverReceipt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const tripId = toReceiptTripId(input.tripId);
  if (!tripId) return null;
  const fare = toReceiptInt(input.fare);
  const commission = toReceiptInt(input.commission);
  const tip = toReceiptInt(input.tip);
  const net = toReceiptInt(input.net);
  if (fare === null || commission === null || tip === null || net === null) return null;
  const paymentMode = VALID_PAYMENT_MODES.has(input.paymentMode) ? input.paymentMode : 'noncash';
  const completedAt = typeof input.completedAt === 'string' && input.completedAt.trim()
    ? input.completedAt.trim()
    : new Date().toISOString();
  return { tripId, completedAt, fare, commission, tip, net, paymentMode, status: 'completed' };
}

// Upsert a canonical receipt by tripId (newest write wins). Returns the
// sanitized receipt that was stored, or null when the input was unusable.
export function saveDriverReceipt(receipt) {
  const clean = sanitizeDriverReceipt(receipt);
  if (!clean) return null;
  const list = loadDriverReceiptsRaw().filter((r) => toReceiptTripId(r.tripId) !== clean.tripId);
  list.unshift(clean);
  persistDriverReceipts(list);
  return clean;
}

// Read one receipt by tripId. Persisted receipts win; the canonical demo
// receipt (48-321) is the seed fallback so the render-gate URL always
// resolves. Returns null when nothing matches → missing-receipt fallback.
export function getReceipt(tripId) {
  const id = toReceiptTripId(tripId);
  if (!id) return null;
  const persisted = loadDriverReceiptsRaw().find((r) => toReceiptTripId(r.tripId) === id);
  if (persisted) return sanitizeDriverReceipt(persisted);
  if (id === DEMO_DRIVER_RECEIPT.tripId) return { ...DEMO_DRIVER_RECEIPT };
  return null;
}

// List receipts newest-first for the Driver payouts surface. Persisted
// receipts are merged with the canonical demo seed (persisted wins by
// tripId) so the payouts list is never empty in the prototype.
export function listDriverReceipts() {
  const persisted = loadDriverReceiptsRaw()
    .map((r) => sanitizeDriverReceipt(r))
    .filter(Boolean);
  const seen = new Set(persisted.map((r) => r.tripId));
  const merged = seen.has(DEMO_DRIVER_RECEIPT.tripId)
    ? persisted
    : [...persisted, { ...DEMO_DRIVER_RECEIPT }];
  return merged.sort((a, b) => (Date.parse(b.completedAt) || 0) - (Date.parse(a.completedAt) || 0));
}

export function clearDriverReceiptsStore() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(DRIVER_RECEIPTS_KEY);
  } catch {
    // fail soft
  }
}
