import { listFeedPosts } from '../mock_api.js';
import { reportAppShellError, dismissAppShellError } from '../app_error_triggers.js';
import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user } from '../state.js';
import {
  canAcceptOrder,
  canAcceptPassengerRequest,
  canManageOwnOrder,
  acceptPassengerRequestFromPost,
  acceptCanonicalRideOrder,
} from '../ride_actions.js';
import { applySmokeRole, getSmokeRole, resolveRole } from '../smoke_role.js';

const CATS = [
  { key: 'all',          label: 'Всё' },
  { key: 'trip',         label: 'Поездки' },
  { key: 'passenger',    label: 'Попутчики' },
  { key: 'announcement', label: 'Объявления' },
  { key: 'marketplace',  label: 'Маркет' },
];

// BD-ERROR-01C-B — first real flow trigger. Route a feed data-load failure
// through the global app-shell overlay (BD-ERROR-01A/01C-A adapter). This is a
// defensive wire: today listFeedPosts() resolves from mock/localStorage and
// does not reject, so the catch is dormant — but a future data-layer/backend
// failure surfaces the global error instead of silently rendering an empty
// feed. The per-screen empty state is preserved via the [] fallback (the
// global overlay is additive, never a replacement for the feed's own UI).
//
// onRetry powers the overlay's «Повторить» button. On retry the overlay shows a
// non-blocking 'retrying' progress state and is only dismissed AFTER a
// successful reload — a slow/hanging/late-failing refetch keeps an error or
// progress affordance on screen the whole time (a repeat failure re-surfaces
// server_error). The overlay deliberately does not auto-dismiss when onRetry is
// provided, so this wrapper owns the retrying → recovered/error transition.
async function loadFeedPosts(onRetry, isRetry) {
  if (isRetry) reportAppShellError('retrying');
  try {
    const fresh = await listFeedPosts();
    // Only clear the overlay if it is still the retrying state we raised — a
    // newer state (e.g. an offline banner from the connection watcher mid-retry)
    // must not be clobbered by a fast cache-served success.
    if (isRetry) dismissAppShellError({ onlyIfState: 'retrying' });
    return fresh;
  } catch (err) {
    reportAppShellError('server_error', onRetry ? { onRetry } : {});
    return [];
  }
}

export default async function feed() {
  // Retry re-runs the feed load (isRetry=true → 'retrying' progress, dismiss on
  // success). refreshList is hoisted, so referencing it here before its
  // declaration is safe — the arrow only runs when the user taps «Повторить».
  const onFeedRetry = () => { refreshList(true); };
  let posts = await loadFeedPosts(onFeedRetry, false);
  let activeKey = 'all';

  const root = document.createElement('section');
  root.className = 'screen screen--feed';

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Лента</h1>
        <p class="bd-topbar__sub">Москва · сегодня</p>
      </div>
      <div class="feed-topbar-actions">
        <button class="bd-iconbtn" type="button" aria-label="Поиск">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button class="bd-iconbtn bd-iconbtn--accent feed-btn-new" type="button" aria-label="Создать публикацию">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" aria-hidden="true" width="22" height="22">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="feed-chip-row" role="tablist" aria-label="Категории">
      ${CATS.map((c, i) =>
        `<button class="feed-chip${i === 0 ? ' active' : ''}" data-cat="${escapeHtml(c.key)}"
                 role="tab" type="button">${escapeHtml(c.label)}</button>`
      ).join('')}
    </div>
    <div class="bd-scroll feed-list" role="feed"></div>
  `;

  const chipRow  = root.querySelector('.feed-chip-row');
  const feedList = root.querySelector('.feed-list');

  async function refreshList(isRetry) {
    posts = await loadFeedPosts(onFeedRetry, isRetry);
    renderList();
  }

  function renderList() {
    const items = posts.filter((p) => {
      if (activeKey === 'all')       return true;
      if (activeKey === 'passenger') return p.type === 'trip' && p.passenger === true;
      if (activeKey === 'trip')      return p.type === 'trip' && !p.passenger;
      return p.type === activeKey;
    });
    feedList.innerHTML = items.length
      ? items.map(renderCard).join('')
      : `<div class="bd-empty">
           <div class="bd-empty__title">Пока пусто</div>
           <p>Попробуйте сменить фильтр</p>
         </div>`;
  }

  chipRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    activeKey = btn.dataset.cat;
    for (const b of chipRow.querySelectorAll('[data-cat]')) {
      b.classList.toggle('active', b.dataset.cat === activeKey);
    }
    renderList();
  });

  root.querySelector('.feed-btn-new').addEventListener('click', () => {
    // BD-SMOKE-ROLE-01 — per-tab role override decides where "+" routes. A
    // passenger smoke tab carries passenger intent into the composer; real
    // passengers keep '/new' so an in-progress draft type is preserved.
    const role = resolveRole(user.get());
    if (role === 'driver') { go('/driver-map'); return; }
    go(getSmokeRole() === 'passenger' ? '/new?type=passenger_request' : '/new');
  });

  feedList.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const postId = actionBtn.dataset.postId;

      if (actionBtn.dataset.action === 'respond') {
        go(postId ? `/respond?postId=${encodeURIComponent(postId)}` : '/respond');
        return;
      }

      if (actionBtn.dataset.action === 'chat') {
        go(postId ? `/chat?tripId=${encodeURIComponent(postId)}` : '/chat');
        return;
      }

      if (actionBtn.dataset.action === 'own-order') {
        const post = posts.find((p) => String(p.id) === String(postId));
        if (post?.canonical === 'ride_order' && post.orderId) {
          go(`/responses?orderId=${encodeURIComponent(post.orderId)}`);
        } else {
          go(postId ? `/post?id=${encodeURIComponent(postId)}` : '/feed');
        }
        return;
      }

      if (actionBtn.dataset.action === 'accept-order') {
        // BD-SMOKE-ROLE-01 — gate the driver accept on the per-tab effective
        // role so a passenger smoke tab cannot execute the accept flow even if
        // the shared persisted role is driver.
        const u = applySmokeRole(user.get());
        const post = posts.find((p) => String(p.id) === String(postId));
        if (!canAcceptPassengerRequest(u, post)) return;

        // BD-RIDE-ORDER-UNIFY-01 PR3 — Canonical ride-order projections
        // accept through the shared store so the underlying order flips
        // CREATED → ACCEPTED and drops out of Feed + DriverMap.
        if (post.canonical === 'ride_order' && post.orderId) {
          // BD-LIFE-06 — accurate accept-source label so the seeded ride
          // does not claim it came from /driver-map.
          const accepted = acceptCanonicalRideOrder(post.orderId, { acceptedSource: 'feed' });
          if (!accepted) {
            // Stale / already accepted in another surface — refetch
            // so the now-gone projection card disappears (local `posts`
            // snapshot would otherwise still hold the stale card).
            refreshList();
            return;
          }
          go(`/active-ride?role=driver&tripId=${encodeURIComponent(accepted.tripId)}&status=ACCEPTED`);
          return;
        }

        const ride = acceptPassengerRequestFromPost(post);
        go(`/active-ride?role=driver&tripId=${encodeURIComponent(ride.tripId)}`);
      }
      return;
    }

    const card = e.target.closest('[data-post-card]');
    if (!card) return;
    if (e.target.closest('button, a, [data-action]')) return;
    const postId = card.dataset.postCard;
    if (!postId) return;
    go(`/post?id=${encodeURIComponent(postId)}`);
  });

  renderList();
  return root;
}

// ── Helpers ────────────────────────────────────────────────────

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

function renderCard(p) {
  switch (p.type) {
    case 'system':       return renderSystemCard(p);
    case 'trip':         return renderTripCard(p);
    case 'announcement': return renderAnnouncementCard(p);
    case 'marketplace':  return renderMarketplaceCard(p);
    default:             return '';
  }
}

function renderCardHeader(p) {
  const meta = [
    p.role ? escapeHtml(p.role) : '',
    p.time ? escapeHtml(p.time) : '',
  ].filter(Boolean).join(' · ');

  return `
    <div class="feed-card-header">
      <div class="feed-avatar" aria-hidden="true">${escapeHtml(initial(p.author))}</div>
      <div class="feed-card-header__info">
        <div class="feed-card-header__name">${escapeHtml(p.author || '—')}</div>
        <div class="feed-card-header__meta">${escapeHtml(meta)}</div>
      </div>
      <button class="feed-card-menu" type="button" aria-label="Меню поста">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="18" height="18">
          <circle cx="5" cy="12" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="19" cy="12" r="2"/>
        </svg>
      </button>
    </div>
  `;
}

function renderPostActions(p) {
  return `
    <div class="feed-post-actions">
      <button class="feed-post-actions__btn" type="button" aria-label="Нравится">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
        ${escapeHtml(String(p.likes || 0))}
      </button>
      <button class="feed-post-actions__btn" type="button" aria-label="Комментарии">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        ${escapeHtml(String(p.comments || 0))}
      </button>
      <button class="feed-post-actions__btn feed-post-actions__share" type="button" aria-label="Поделиться">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
          <circle cx="18" cy="5" r="3"/>
          <circle cx="6" cy="12" r="3"/>
          <circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
    </div>
  `;
}

function renderSystemCard(p) {
  // Render system posts as pinned announcement cards, matching prototype visual
  return `
    <article class="bd-card feed-card--pinned" data-post-card="${escapeHtml(p.id || '')}">
      ${renderCardHeader(p)}
      ${p.title ? `<h2 class="feed-card-ann-title">${escapeHtml(p.title)}</h2>` : ''}
      ${p.body ? `<p class="feed-card-body">${escapeHtml(p.body)}</p>` : ''}
      ${renderPostActions(p)}
    </article>
  `;
}

function renderTripCard(p) {
  const clockIcon = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" aria-hidden="true" width="12" height="12">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  `;

  // BD-SMOKE-ROLE-01 — the accept CTA visibility follows the per-tab effective
  // role; a passenger smoke tab never sees "Принять заказ". canManageOwnOrder
  // is identity-based (authorId), so the role override does not affect it.
  const u = applySmokeRole(user.get());
  const ownPassengerOrder = p.passenger === true && canManageOwnOrder(p, u);
  const driverCanAccept = canAcceptOrder(p, u);
  const postId = escapeHtml(p.id || '');

  let ctaAttrs;
  let ctaLabel;
  if (ownPassengerOrder) {
    ctaAttrs = `data-action="own-order" data-post-id="${postId}" aria-label="К моему заказу"`;
    ctaLabel = 'К моему заказу';
  } else if (driverCanAccept) {
    ctaAttrs = `data-action="accept-order" data-post-id="${postId}" aria-label="Принять заказ"`;
    ctaLabel = 'Принять заказ';
  } else if (p.passenger) {
    ctaAttrs = `data-action="respond" data-post-id="${postId}" aria-label="Откликнуться на заявку попутчика"`;
    ctaLabel = 'Откликнуться';
  } else {
    ctaAttrs = `data-action="chat" data-post-id="${postId}" aria-label="Написать водителю"`;
    ctaLabel = 'Написать водителю';
  }

  return `
    <article class="bd-card${p.pinned ? ' feed-card--pinned' : ''}" data-post-card="${postId}">
      ${renderCardHeader(p)}
      <div class="feed-route-row">
        <div class="feed-route-track">
          <div class="feed-route-dot"></div>
          <div class="feed-route-line"></div>
          <div class="feed-route-sq"></div>
        </div>
        <div class="feed-route-places">
          <div class="feed-route-from">${escapeHtml(p.from || '')}</div>
          <div class="feed-route-to">${escapeHtml(p.to || '')}</div>
        </div>
      </div>
      <div class="feed-trip-meta">
        <div class="feed-trip-meta__badges">
          <span class="bd-badge accent">${clockIcon}${escapeHtml(p.when || '')}</span>
          ${p.seats ? `<span class="bd-badge">${escapeHtml(String(p.seats))} места</span>` : ''}
        </div>
        ${p.price ? `<div class="feed-trip-price">${escapeHtml(p.price)}</div>` : ''}
      </div>
      ${p.body ? `<p class="feed-card-body">${escapeHtml(p.body)}</p>` : ''}
      <button class="bd-btn primary feed-card-cta" type="button" ${ctaAttrs}>
        ${ctaLabel}
      </button>
      ${renderPostActions(p)}
    </article>
  `;
}

function renderAnnouncementCard(p) {
  return `
    <article class="bd-card${p.pinned ? ' feed-card--pinned' : ''}" data-post-card="${escapeHtml(p.id || '')}">
      ${renderCardHeader(p)}
      ${p.title ? `<h2 class="feed-card-ann-title">${escapeHtml(p.title)}</h2>` : ''}
      ${p.body ? `<p class="feed-card-body">${escapeHtml(p.body)}</p>` : ''}
      ${renderPostActions(p)}
    </article>
  `;
}

function renderMarketplaceCard(p) {
  const tags = (p.tags || []).slice(0, 4)
    .map((t) => `<span class="bd-badge">${escapeHtml(t)}</span>`)
    .join('');
  return `
    <article class="bd-card" data-post-card="${escapeHtml(p.id || '')}">
      ${renderCardHeader(p)}
      ${p.title ? `<h2 class="feed-card-mkt-title">${escapeHtml(p.title)}</h2>` : ''}
      ${p.price ? `<div class="feed-card-mkt-price">${escapeHtml(p.price)}</div>` : ''}
      ${p.body ? `<p class="feed-card-body">${escapeHtml(p.body)}</p>` : ''}
      ${tags ? `<div class="feed-card-tags">${tags}</div>` : ''}
      ${renderPostActions(p)}
    </article>
  `;
}
