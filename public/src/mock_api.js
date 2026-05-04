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
