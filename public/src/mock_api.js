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
    primary:   { label: 'Посмотреть отклик', href: '/responses?postId=trip-2&state=list' },
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
    status: 'CREATED',
    createdAt: new Date().toISOString(),
  };
  const list = [order, ...loadRideOrdersRaw()];
  persistRideOrders(list);
  return order;
}

export function listNearbyOrders() {
  return loadRideOrdersRaw()
    .filter((o) => o && o.status === 'CREATED')
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
