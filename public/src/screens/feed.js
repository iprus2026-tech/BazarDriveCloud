import { listPosts } from '../mock_api.js';
import { escapeHtml } from '../util.js';

export default async function feed() {
  const root = document.createElement('section');
  root.className = 'screen screen--feed';
  const posts = await listPosts();
  root.innerHTML = `
    <header class="screen__header">
      <h1 class="screen__title">Лента</h1>
      <p class="screen__subtitle">Свежие объявления рядом</p>
    </header>
    <ul class="card-list">
      ${posts.map(renderCard).join('')}
    </ul>
  `;
  return root;
}

function renderCard(p) {
  const tags = (p.tags || []).slice(0, 3)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
  const meta = `${escapeHtml(p.author || '—')} · ${escapeHtml(formatTime(p.createdAt))}`;
  return `
    <li class="card">
      <h2 class="card__title">${escapeHtml(p.title)}</h2>
      ${p.body ? `<p class="card__body">${escapeHtml(p.body)}</p>` : ''}
      <div class="card__footer">
        <span class="card__meta">${meta}</span>
        ${tags ? `<div class="card__tags">${tags}</div>` : ''}
      </div>
    </li>
  `;
}

function formatTime(ts) {
  if (!ts) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return `${d} дн назад`;
}
