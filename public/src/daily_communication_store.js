// BD-DAILY-COMM-01 — local prototype store for the Daily Communication hub.
//
// Target backend contract:
//   communication_threads(id, orderId, rideId, channel, status, priority,
//     participantRoles, unreadForRoles, lastMessageAt, createdAt, updatedAt)
//   communication_messages(id, threadId, authorRole, type, body, requiresAck,
//     createdAt, deliveredAt, acknowledgedAt)
//
// Runtime boundary for this slice:
//   - localStorage is a temporary prototype cache, not source of truth.
//   - the prototype reuses bazardrive.chat.v1 under a reserved namespace so the
//     existing auth-boundary clearChatStore() already wipes daily communication.
//   - no ride/order status is mutated here; CTAs only navigate to existing
//     ride/chat surfaces.
const CHAT_KEY = 'bazardrive.chat.v1';
const DAILY_COMMUNICATION_NAMESPACE = '__daily_communication_threads__';

export const DAILY_COMMUNICATION_STATUSES = [
  'OPEN',
  'ACK_REQUIRED',
  'NEEDS_ACTION',
  'ACKNOWLEDGED',
  'RESOLVED',
];

export const DAILY_COMMUNICATION_STATUS_LABEL = {
  OPEN: 'Открыто',
  ACK_REQUIRED: 'Нужно подтвердить',
  NEEDS_ACTION: 'Требует действия',
  ACKNOWLEDGED: 'Принято',
  RESOLVED: 'Закрыто',
};

export const DAILY_COMMUNICATION_STATUS_TONE = {
  OPEN: 'info',
  ACK_REQUIRED: 'warning',
  NEEDS_ACTION: 'danger',
  ACKNOWLEDGED: 'success',
  RESOLVED: 'muted',
};

export const DAILY_COMMUNICATION_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'ride', label: 'Поездки' },
  { key: 'passenger', label: 'Пассажиры' },
  { key: 'driver', label: 'Водители' },
  { key: 'support', label: 'Поддержка' },
];

export const DAILY_COMMUNICATION_TEMPLATES = [
  {
    id: 'pickup-confirm',
    label: 'Подтвердить подачу',
    body: 'Подтверждаю. Встречаемся в указанной точке подачи.',
  },
  {
    id: 'arriving-soon',
    label: 'Подъезжаю',
    body: 'Подъезжаю к точке подачи. Буду через 3–5 минут.',
  },
  {
    id: 'need-details',
    label: 'Уточнить детали',
    body: 'Пожалуйста, уточните ориентир и удобное место встречи.',
  },
  {
    id: 'support-needed',
    label: 'Нужна поддержка',
    body: 'Нужна помощь диспетчера по текущей поездке.',
  },
];

const VALID_STATUSES = new Set(DAILY_COMMUNICATION_STATUSES);
const VALID_KINDS = new Set(['ride', 'passenger', 'driver', 'support']);
const VALID_ROLES = new Set(['passenger', 'driver', 'support', 'system']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);
let cache = null;

function nowIso() {
  return new Date().toISOString();
}

function minutesAgo(min) {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

function asString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function seedMessages(threadId, items) {
  return items.map((item, idx) => ({
    id: `${threadId}-msg-${idx + 1}`,
    type: item.type || 'TEXT',
    authorRole: VALID_ROLES.has(item.authorRole) ? item.authorRole : 'system',
    body: asString(item.body),
    requiresAck: item.requiresAck === true,
    createdAt: item.createdAt || minutesAgo(20 - idx * 4),
  }));
}

function buildSeedStore() {
  const threads = [
    {
      id: 'dc-ride-pickup-1',
      kind: 'ride',
      channel: 'ride_ops',
      title: 'Подача: уточнить точку встречи',
      summary: 'Пассажир ждёт подтверждение ориентира у выхода №2.',
      counterpart: 'Анна М.',
      counterpartRole: 'Пассажир',
      route: { from: 'Аэропорт Внуково', to: 'м. Парк Победы' },
      status: 'NEEDS_ACTION',
      priority: 'high',
      unread: true,
      updatedAt: minutesAgo(2),
      primaryHref: '/chat?tripId=feed-trip-2&role=driver',
      secondaryHref: '/active-ride?role=driver&tripId=feed-trip-2&status=DRIVER_EN_ROUTE',
      messages: seedMessages('dc-ride-pickup-1', [
        { authorRole: 'passenger', body: 'Я у выхода №2, рядом кофейня. Подтвердите, пожалуйста.', requiresAck: true, createdAt: minutesAgo(8) },
        { authorRole: 'system', type: 'STATUS', body: 'Требуется ответ водителя до подачи.', createdAt: minutesAgo(2) },
      ]),
    },
    {
      id: 'dc-driver-shift-1',
      kind: 'driver',
      channel: 'shift_ops',
      title: 'Водитель на линии',
      summary: 'Документы готовы, смена открыта. Можно принимать ближайшие заказы.',
      counterpart: 'Рустам К.',
      counterpartRole: 'Водитель · Toyota Camry',
      route: { from: 'ТЦ Мега', to: 'Аэропорт, терминал B' },
      status: 'ACK_REQUIRED',
      priority: 'normal',
      unread: true,
      updatedAt: minutesAgo(9),
      primaryHref: '/driver-map',
      secondaryHref: '/chat?tripId=trip-mega-vnukovo&role=passenger',
      messages: seedMessages('dc-driver-shift-1', [
        { authorRole: 'driver', body: 'Я онлайн, готов брать заказы по району аэропорта.', requiresAck: true, createdAt: minutesAgo(12) },
        { authorRole: 'system', type: 'STATUS', body: 'Проверка доступности ожидает подтверждения.', createdAt: minutesAgo(9) },
      ]),
    },
    {
      id: 'dc-support-digest-1',
      kind: 'support',
      channel: 'support_digest',
      title: 'Сводка поддержки за день',
      summary: 'Контролируйте no-show, задержки подачи и спорные отмены через единый канал.',
      counterpart: 'BazarDrive Support',
      counterpartRole: 'Операционная поддержка',
      route: { from: 'Город', to: 'Операции' },
      status: 'OPEN',
      priority: 'low',
      unread: false,
      updatedAt: minutesAgo(35),
      primaryHref: '/inbox?tab=rides',
      secondaryHref: '/rules',
      messages: seedMessages('dc-support-digest-1', [
        { authorRole: 'support', body: 'Проверяйте спорные отмены до закрытия смены.', createdAt: minutesAgo(35) },
      ]),
    },
  ];
  return { version: 1, threads };
}

function cloneMessage(message) {
  return { ...message };
}

function cloneThread(thread) {
  return {
    ...thread,
    route: thread.route ? { ...thread.route } : null,
    messages: Array.isArray(thread.messages) ? thread.messages.map(cloneMessage) : [],
  };
}

function normalizeMessage(raw, threadId, index) {
  const fallbackId = `${threadId}-msg-${index + 1}`;
  return {
    id: asString(raw?.id, fallbackId),
    type: asString(raw?.type, 'TEXT'),
    authorRole: VALID_ROLES.has(raw?.authorRole) ? raw.authorRole : 'system',
    body: asString(raw?.body),
    requiresAck: raw?.requiresAck === true,
    createdAt: asString(raw?.createdAt, nowIso()),
  };
}

function normalizeThread(raw, index) {
  const id = asString(raw?.id, `dc-thread-${index + 1}`);
  const kind = VALID_KINDS.has(raw?.kind) ? raw.kind : 'support';
  const route = raw?.route && typeof raw.route === 'object'
    ? {
        from: asString(raw.route.from, '—'),
        to: asString(raw.route.to, '—'),
      }
    : { from: '—', to: '—' };
  const messages = Array.isArray(raw?.messages)
    ? raw.messages.map((m, i) => normalizeMessage(m, id, i)).filter((m) => m.body)
    : [];

  return {
    id,
    kind,
    channel: asString(raw?.channel, kind),
    title: asString(raw?.title, 'Операционная связь'),
    summary: asString(raw?.summary, messages.at(-1)?.body || 'Нет сообщений'),
    counterpart: asString(raw?.counterpart, 'BazarDrive'),
    counterpartRole: asString(raw?.counterpartRole, 'Участник'),
    route,
    status: VALID_STATUSES.has(raw?.status) ? raw.status : 'OPEN',
    priority: VALID_PRIORITIES.has(raw?.priority) ? raw.priority : 'normal',
    unread: raw?.unread === true,
    updatedAt: asString(raw?.updatedAt, messages.at(-1)?.createdAt || nowIso()),
    primaryHref: asString(raw?.primaryHref, '/inbox'),
    secondaryHref: asString(raw?.secondaryHref, ''),
    messages,
  };
}

function normalizeStore(raw) {
  const threads = Array.isArray(raw?.threads)
    ? raw.threads.map(normalizeThread)
    : buildSeedStore().threads;
  return { version: 1, threads };
}

function loadChatStoreRaw() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadStore() {
  if (cache) return cache;
  const chatStore = loadChatStoreRaw();
  if (chatStore[DAILY_COMMUNICATION_NAMESPACE]) {
    cache = normalizeStore(chatStore[DAILY_COMMUNICATION_NAMESPACE]);
    return cache;
  }
  cache = buildSeedStore();
  persistStore();
  return cache;
}

function persistStore() {
  try {
    if (typeof localStorage === 'undefined' || !cache) return;
    const chatStore = loadChatStoreRaw();
    chatStore[DAILY_COMMUNICATION_NAMESPACE] = cache;
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatStore));
  } catch {
    // fail soft: the screen can keep the in-memory cache for this session
  }
}

function threadSort(a, b) {
  const pa = a.priority === 'high' ? 2 : a.priority === 'normal' ? 1 : 0;
  const pb = b.priority === 'high' ? 2 : b.priority === 'normal' ? 1 : 0;
  if (pa !== pb) return pb - pa;
  return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
}

function appendSystemMessage(thread, body, authorRole) {
  const msg = {
    id: `dc-msg-${Date.now()}`,
    type: 'STATUS',
    authorRole: VALID_ROLES.has(authorRole) ? authorRole : 'system',
    body,
    requiresAck: false,
    createdAt: nowIso(),
  };
  thread.messages = [...thread.messages, msg];
  thread.summary = body;
  thread.updatedAt = msg.createdAt;
}

export function listDailyCommunicationThreads() {
  return loadStore().threads.map(cloneThread).sort(threadSort);
}

export function getDailyCommunicationThread(id) {
  const thread = loadStore().threads.find((t) => t.id === id);
  return thread ? cloneThread(thread) : null;
}

export function sendDailyCommunicationMessage(threadId, input = {}) {
  const text = asString(input.body);
  if (!threadId || !text) return null;
  const authorRole = VALID_ROLES.has(input.authorRole) ? input.authorRole : 'support';
  const store = loadStore();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) return null;

  const msg = {
    id: `dc-msg-${Date.now()}`,
    type: input.templateId ? 'TEMPLATE' : 'TEXT',
    authorRole,
    body: text,
    requiresAck: false,
    createdAt: nowIso(),
  };
  thread.messages = [...thread.messages, msg];
  thread.summary = text;
  thread.status = thread.status === 'RESOLVED' ? 'OPEN' : 'ACKNOWLEDGED';
  thread.unread = false;
  thread.updatedAt = msg.createdAt;
  persistStore();
  return cloneThread(thread);
}

export function acknowledgeDailyCommunication(threadId, actorRole = 'support') {
  const store = loadStore();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  thread.status = 'ACKNOWLEDGED';
  thread.unread = false;
  appendSystemMessage(thread, 'Сообщение принято в работу.', actorRole);
  persistStore();
  return cloneThread(thread);
}

export function resolveDailyCommunication(threadId, actorRole = 'support') {
  const store = loadStore();
  const thread = store.threads.find((t) => t.id === threadId);
  if (!thread) return null;
  thread.status = 'RESOLVED';
  thread.unread = false;
  appendSystemMessage(thread, 'Тема закрыта. История сохранена в локальном прототипе.', actorRole);
  persistStore();
  return cloneThread(thread);
}

export function clearDailyCommunicationStore() {
  cache = null;
  try {
    if (typeof localStorage === 'undefined') return;
    const chatStore = loadChatStoreRaw();
    delete chatStore[DAILY_COMMUNICATION_NAMESPACE];
    if (Object.keys(chatStore).length === 0) {
      localStorage.removeItem(CHAT_KEY);
      return;
    }
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatStore));
  } catch {
    // fail soft
  }
}
