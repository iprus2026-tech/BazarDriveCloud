import { listFeedPosts } from '../mock_api.js';
import { loadResource } from '../data_layer.js';
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

// BD-ERROR-01C-B / BD-ERROR-02A — route a feed data-load failure through the
// global app-shell overlay via the shared data_layer.loadResource adapter (the
// per-screen wrapper was consolidated in 02A). Defensive wire: today
// listFeedPosts() resolves from mock/localStorage and does not reject, so the
// failure path is dormant. loadResource shows 'retrying' on retry, dismisses
// only on a successful reload (guarded by onlyIfState), reports server_error
// with the guarded onRetry on failure, and falls back to [] so the feed's own
// empty state is preserved (the overlay is additive).
export default function feed() {
  // BD-FEED-01 — return the screen shell synchronously and load in the
  // background (refreshList) so the feed paints a loading skeleton immediately
  // instead of leaving #app blank while the data resolves (the router clears
  // #app before awaiting the loader). Both the initial load and the retry go
  // through refreshList → loadResource (BD-ERROR-01C-B: single guarded path,
  // server_error overlay + [] fallback). The retry arrow runs only on «Повторить».
  const onFeedRetry = () => { refreshList(true); };
  let posts = [];
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
        <button class="bd-iconbtn" type="button" data-noop aria-label="Поиск">
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
    <div class="feed-chip-row" role="group" aria-label="Категории">
      ${CATS.map((c, i) =>
        `<button class="feed-chip${i === 0 ? ' active' : ''}" data-cat="${escapeHtml(c.key)}"
                 type="button" aria-pressed="${i === 0 ? 'true' : 'false'}">${escapeHtml(c.label)}</button>`
      ).join('')}
    </div>
    <div class="bd-scroll feed-list" role="feed"></div>
  `;

  const chipRow  = root.querySelector('.feed-chip-row');
  const feedList = root.querySelector('.feed-list');

  async function refreshList(isRetry) {
    // Skeleton only on the first load; a retry shows the global 'retrying'
    // overlay (loadResource), so the existing content / empty state stays put.
    if (!isRetry) renderLoading();
    posts = await loadResource(listFeedPosts, { onRetry: onFeedRetry, isRetry });
    renderList();
  }

  function renderLoading() {
    feedList.setAttribute('aria-busy', 'true');
    feedList.innerHTML = Array.from({ length: 4 }, () => `
      <div class="bd-card feed-card--skeleton" aria-hidden="true">
        <div class="feed-skeleton__head">
          <div class="feed-skeleton__avatar"></div>
          <div class="feed-skeleton__lines">
            <div class="feed-skeleton__line feed-skeleton__line--name"></div>
            <div class="feed-skeleton__line feed-skeleton__line--meta"></div>
          </div>
        </div>
        <div class="feed-skeleton__line"></div>
        <div class="feed-skeleton__line feed-skeleton__line--short"></div>
      </div>`).join('');
  }

  function renderList() {
    feedList.setAttribute('aria-busy', 'false');
    const items = posts.filter((p) => {
      if (activeKey === 'all')       return true;
      if (activeKey === 'passenger') return p.type === 'trip' && p.passenger === true;
      if (activeKey === 'trip')      return p.type === 'trip' && !p.passenger;
      return p.type === activeKey;
    });
    if (items.length) {
      feedList.innerHTML = items.map(renderCard).join('');
      return;
    }
    // Distinguish a genuinely empty / failed feed (no posts at all) from a
    // filter that matched nothing — telling the user to "change the filter" is
    // wrong when there is nothing to show regardless of the active filter.
    feedList.innerHTML = posts.length === 0
      ? `<div class="bd-empty">
           <div class="bd-empty__title">Пока нет публикаций</div>
           <p>Здесь появятся поездки, попутчики и объявления.</p>
         </div>`
      : `<div class="bd-empty">
           <div class="bd-empty__title">Ничего не найдено</div>
           <p>Попробуйте сменить фильтр.</p>
         </div>`;
  }

  chipRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    activeKey = btn.dataset.cat;
    for (const b of chipRow.querySelectorAll('[data-cat]')) {
      const selected = b.dataset.cat === activeKey;
      b.classList.toggle('active', selected);
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
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

    // Card-body navigation is the native stretched .feed-card__open link
    // (rendered per card) — it handles mouse and keyboard (Enter) without a
    // custom handler and keeps the <article> role intact. Only the per-card
    // action buttons need JS, handled above.
  });

  // BD-FEED-01 — the search, post-menu (⋮), like, comment and share controls are
  // intentional UI-only stubs (no backend / target screen yet). Mark them
  // data-noop and swallow their click so they are explicit no-ops, not mistaken
  // for broken wiring (mirrors the rules.js data-noop convention).
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-noop]')) e.preventDefault();
  });

  refreshList(false);
  return root;
}

// ── Helpers ────────────────────────────────────────────────────

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : '?';
}

// BD-FEED-01 — keyboard-operable card WITHOUT overriding article semantics. The
// card stays a real <article> inside the role="feed" list; a dedicated stretched
// open-link (.feed-card__open, absolutely positioned over the card) is the
// activatable control — natively keyboard-focusable (Enter opens Post Detail)
// and exposed to assistive tech as a link with a DISTINCTIVE name (route/title +
// author), so same-author posts are tellable apart. The inner controls (CTA /
// like / comment / share / kebab) are raised above the link via z-index and keep
// their own click/focus. This satisfies both "preserve the article role" and
// "expose an activatable control" without making the article a button.
function cardLabel(p) {
  const what = (p.from || p.to)
    ? `${p.from || '—'} → ${p.to || '—'}`
    : (p.title || 'публикация');
  const who = p.author ? ` · ${p.author}` : '';
  return `Открыть: ${what}${who}`;
}
function cardOpenLink(p) {
  return `<a class="feed-card__open" href="#/post?id=${escapeHtml(p.id || '')}" aria-label="${escapeHtml(cardLabel(p))}"></a>`;
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
      <button class="feed-card-menu" type="button" data-noop aria-label="Меню поста">
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
      <button class="feed-post-actions__btn" type="button" data-noop aria-label="Нравится: ${escapeHtml(String(p.likes || 0))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
        ${escapeHtml(String(p.likes || 0))}
      </button>
      <button class="feed-post-actions__btn" type="button" data-noop aria-label="Комментарии: ${escapeHtml(String(p.comments || 0))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="18" height="18">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        ${escapeHtml(String(p.comments || 0))}
      </button>
      <button class="feed-post-actions__btn feed-post-actions__share" type="button" data-noop aria-label="Поделиться">
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
      ${cardOpenLink(p)}
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
      ${cardOpenLink(p)}
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
      ${cardOpenLink(p)}
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
      ${cardOpenLink(p)}
      ${renderCardHeader(p)}
      ${p.title ? `<h2 class="feed-card-mkt-title">${escapeHtml(p.title)}</h2>` : ''}
      ${p.price ? `<div class="feed-card-mkt-price">${escapeHtml(p.price)}</div>` : ''}
      ${p.body ? `<p class="feed-card-body">${escapeHtml(p.body)}</p>` : ''}
      ${tags ? `<div class="feed-card-tags">${tags}</div>` : ''}
      ${renderPostActions(p)}
    </article>
  `;
}
