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

export async function listFeedPosts() {
  return FEED_POSTS_V2;
}

export function createFeedPost(post) {
  FEED_POSTS_V2.unshift({
    id:       `user-${Date.now()}`,
    likes:    0,
    comments: 0,
    time:     'Только что',
    ...post,
  });
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

// ── Payouts mock API (BD-PROFILE-02 Payouts) ───────────────────

export async function getPayoutSummary() {
  return {
    available:       18420,
    weekEarned:      21580,
    commissionPct:   12,
    commissionAmt:   2590,
    acquiringPct:    1.5,
    acquiringAmt:    324,
    weekPayout:      18666,
  };
}

export async function listPayoutMethods() {
  return [
    { id: 'card-4821', bank: 'Сбербанк', last4: '4821', isDefault: true },
  ];
}

export async function listPayoutHistory() {
  return [
    { id: 'ph-1', last4: '4821', date: '24.04', time: '22:10', amount: 12000, status: 'credited' },
    { id: 'ph-2', last4: '4821', date: '17.04', time: '21:48', amount: 15200, status: 'credited' },
    { id: 'ph-3', last4: '4821', date: '10.04', time: '20:02', amount:  9800, status: 'pending'  },
    { id: 'ph-4', last4: '4821', date: '03.04', time: '19:30', amount: 14400, status: 'credited' },
  ];
}

export async function getTaxSummary() {
  return {
    npd: { label: 'Налог НПД за апрель',              deadline: 'До 25 мая',  rate: 'самозанятость 4%', amount: 4280 },
    usn: { label: 'Налог УСН · аванс за II квартал',  deadline: 'До 28 июля', rate: '~6% от дохода',    amount: null },
  };
}

export async function requestIncomeReport() {
  return { status: 'ok' };
}
