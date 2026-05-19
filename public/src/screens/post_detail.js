import { listFeedPosts } from '../mock_api.js';
import { escapeHtml } from '../util.js';
import { go, setPendingAction } from '../router.js';
import { user } from '../state.js';

const TYPE_LABELS = {
  trip:          'Поездка',
  passenger:     'Попутчик',
  announcement:  'Объявление',
  marketplace:   'Маркет',
  system:        'Системное',
};

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

function typeKey(p) {
  if (p.type === 'trip' && p.passenger === true) return 'passenger';
  return p.type || 'announcement';
}

function typeLabel(p) {
  return TYPE_LABELS[typeKey(p)] || 'Публикация';
}

function pickCity(p) {
  if (typeof p.city === 'string' && p.city.trim()) return p.city.trim();
  if (typeof p.location === 'string' && p.location.trim()) return p.location.trim();
  if (Array.isArray(p.tags)) {
    const candidate = p.tags.find((t) => typeof t === 'string' && t.trim());
    if (candidate) return candidate.trim();
  }
  return null;
}

function getRouteParam(name) {
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get(name);
}

const SVG_BACK = `
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="11 4 6 9 11 14"/>
  </svg>`;

const SVG_LOCK = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <rect x="4" y="11" width="16" height="9" rx="2"/>
    <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
  </svg>`;

const SVG_PHONE = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
       width="18" height="18">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>`;

function maskPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '••• •• ••';
  const tail = digits.slice(-2);
  return `+${digits[0]} ••• ••• •• ${tail}`;
}

function revealedPhone(p) {
  if (typeof p.phone === 'string' && p.phone.trim()) return p.phone.trim();
  // Mock contact for seed posts that don't carry a real phone.
  return '+7 (900) 000-00-00';
}

function renderRouteBlock(p) {
  if (!(p.from || p.to)) return '';
  return `
    <div class="feed-route-row post-detail__route">
      <div class="feed-route-track">
        <div class="feed-route-dot"></div>
        <div class="feed-route-line"></div>
        <div class="feed-route-sq"></div>
      </div>
      <div class="feed-route-places">
        <div class="feed-route-from">${escapeHtml(p.from || '—')}</div>
        <div class="feed-route-to">${escapeHtml(p.to || '—')}</div>
      </div>
    </div>
  `;
}

function renderMetaRow(p) {
  const badges = [];
  if (p.when) {
    badges.push(`<span class="bd-badge accent">${escapeHtml(p.when)}</span>`);
  }
  if (p.seats) {
    badges.push(`<span class="bd-badge">${escapeHtml(String(p.seats))} места</span>`);
  }
  const priceHtml = p.price
    ? `<div class="feed-trip-price post-detail__price">${escapeHtml(p.price)}</div>`
    : '';
  if (!badges.length && !priceHtml) return '';
  return `
    <div class="feed-trip-meta post-detail__meta">
      <div class="feed-trip-meta__badges">${badges.join('')}</div>
      ${priceHtml}
    </div>
  `;
}

function renderFactsRow(p) {
  const city = pickCity(p);
  const facts = [
    `<span class="bd-badge">${escapeHtml(typeLabel(p))}</span>`,
  ];
  if (city) {
    facts.push(`<span class="bd-badge">${escapeHtml(city)}</span>`);
  }
  if (p.time) {
    facts.push(`<span class="bd-badge">${escapeHtml(p.time)}</span>`);
  }
  return `<div class="post-detail__facts">${facts.join('')}</div>`;
}

function renderContactBlock(p, onboarded) {
  if (onboarded) {
    return `
      <div class="bd-alert success post-detail__contact">
        <div class="post-detail__contact-icon">${SVG_PHONE}</div>
        <div class="post-detail__contact-body">
          <div class="bd-label post-detail__contact-label">Контакт автора</div>
          <a class="post-detail__contact-phone"
             href="tel:${escapeHtml(revealedPhone(p).replace(/[^+\d]/g, ''))}">
            ${escapeHtml(revealedPhone(p))}
          </a>
          <p class="post-detail__contact-hint">
            Контакт доступен — вы прошли онбординг.
          </p>
        </div>
      </div>
    `;
  }
  return `
    <div class="bd-alert info post-detail__contact post-detail__contact--locked">
      <div class="post-detail__contact-icon">${SVG_LOCK}</div>
      <div class="post-detail__contact-body">
        <div class="bd-label post-detail__contact-label">Контакт скрыт</div>
        <div class="post-detail__contact-phone post-detail__contact-phone--masked">
          ${escapeHtml(maskPhone(revealedPhone(p)))}
        </div>
        <p class="post-detail__contact-hint">
          Контакты автора откроются после онбординга.
        </p>
      </div>
    </div>
  `;
}

function renderMissing(root) {
  root.innerHTML = `
    <div class="respond__topbar post-detail__topbar">
      <button type="button" class="respond__back" id="pd-back" aria-label="Назад">
        ${SVG_BACK}
      </button>
      <span class="respond__title">Публикация</span>
      <span class="respond__title-spacer" aria-hidden="true"></span>
    </div>
    <div class="bd-scroll post-detail__body">
      <div class="bd-empty post-detail__missing">
        <div class="bd-empty__title">Публикация не найдена</div>
        <p>Возможно, объявление было удалено или ссылка устарела.</p>
        <button type="button" class="bd-btn primary sm post-detail__missing-cta" id="pd-to-feed">
          Вернуться в ленту
        </button>
      </div>
    </div>
  `;
  root.querySelector('#pd-back').addEventListener('click', () => go('/feed'));
  root.querySelector('#pd-to-feed').addEventListener('click', () => go('/feed'));
}

function renderPost(root, post) {
  const u = user.get();
  const onboarded = !!u.onboarded;
  const detailsHref = `/post?id=${encodeURIComponent(post.id || '')}`;

  const metaLine = [
    post.role ? escapeHtml(post.role) : '',
    post.time ? escapeHtml(post.time) : '',
  ].filter(Boolean).join(' · ');

  const title = post.title
    ? `<h2 class="post-detail__title">${escapeHtml(post.title)}</h2>`
    : '';

  const description = post.body
    ? `
      <section class="post-detail__section">
        <div class="bd-label">Описание</div>
        <p class="post-detail__description">${escapeHtml(post.body)}</p>
      </section>`
    : '';

  root.innerHTML = `
    <div class="respond__topbar post-detail__topbar">
      <button type="button" class="respond__back" id="pd-back" aria-label="Назад">
        ${SVG_BACK}
      </button>
      <span class="respond__title">Публикация</span>
      <span class="respond__title-spacer" aria-hidden="true"></span>
    </div>

    <div class="bd-scroll post-detail__body">
      <article class="bd-card post-detail__card">
        <div class="feed-card-header">
          <div class="feed-avatar" aria-hidden="true">${escapeHtml(initial(post.author))}</div>
          <div class="feed-card-header__info">
            <div class="feed-card-header__name">${escapeHtml(post.author || '—')}</div>
            <div class="feed-card-header__meta">${metaLine || '&nbsp;'}</div>
          </div>
        </div>

        ${renderFactsRow(post)}
        ${title}
        ${renderRouteBlock(post)}
        ${renderMetaRow(post)}
        ${description}
        ${renderContactBlock(post, onboarded)}
      </article>
    </div>

    <div class="respond__footer post-detail__footer">
      <button type="button" class="bd-btn ghost post-detail__btn-cancel" id="pd-cancel">
        Назад
      </button>
      <button type="button" class="bd-btn primary post-detail__btn-respond" id="pd-respond">
        Откликнуться
      </button>
    </div>
  `;

  root.querySelector('#pd-back').addEventListener('click', () => go('/feed'));
  root.querySelector('#pd-cancel').addEventListener('click', () => go('/feed'));

  root.querySelector('#pd-respond').addEventListener('click', () => {
    const fresh = user.get();
    if (!fresh.onboarded) {
      setPendingAction(() => go(detailsHref));
      go('/onboarding');
      return;
    }
    const postId = post.id || '';
    go(postId ? `/respond?postId=${encodeURIComponent(postId)}` : '/respond');
  });
}

export default async function postDetail() {
  const root = document.createElement('section');
  root.className = 'screen screen--post-detail';

  const id = getRouteParam('id');
  const posts = await listFeedPosts();
  const post = id ? posts.find((p) => String(p.id) === String(id)) : null;

  if (!post) {
    renderMissing(root);
    return root;
  }

  renderPost(root, post);
  return root;
}
