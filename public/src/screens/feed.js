import { listPosts } from '../mock_api.js';
import { escapeHtml } from '../util.js';

export default async function feed() {
  const posts = await listPosts();

  const root = document.createElement('section');
  root.className = 'screen';

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Лента</h1>
        <p class="bd-topbar__sub">Свежие объявления</p>
      </div>
    </div>
    <div class="bd-scroll">
      ${posts.length
        ? posts.map(renderCard).join('')
        : `<div class="bd-empty">
             <div class="bd-empty__title">Объявлений пока нет</div>
             <p>Нажмите + чтобы опубликовать первое</p>
           </div>`
      }
    </div>
  `;

  return root;
}

function renderCard(p) {
  const tags = (p.tags || []).slice(0, 4)
    .map((t) => `<span class="bd-badge accent">${escapeHtml(t)}</span>`)
    .join('');
  return `
    <article class="bd-card post-card">
      <h2 class="post-card__title">${escapeHtml(p.title)}</h2>
      ${p.body ? `<p class="post-card__body">${escapeHtml(p.body)}</p>` : ''}
      <div class="post-card__footer">
        <span class="post-card__meta">${escapeHtml(p.author || '—')} · ${escapeHtml(relTime(p.createdAt))}</span>
        ${tags ? `<div class="post-card__tags">${tags}</div>` : ''}
      </div>
    </article>
  `;
}

function relTime(ts) {
  if (!ts) return '';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1)  return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}
