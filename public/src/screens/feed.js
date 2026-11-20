import { listFeedPosts } from '../mock_api.js';
import { loadResource } from '../data_layer.js';
import { escapeHtml } from '../util.js';
import { go } from '../router.js';
import { user, refreshDriverLineOff } from '../state.js';
import {
  canAcceptOrder,
  canAcceptPassengerRequest,
  canManageOwnOrder,
  acceptPassengerRequestFromPost,
  acceptCanonicalRideOrder,
  isDriverMode,
} from '../ride_actions.js';
import { applySmokeRole } from '../smoke_role.js';
import { isBackendEnabled } from '../api_config.js';
import { busyDriverRide } from '../driver_current_trip.js';
import { ownOfferLabel } from '../response_store.js';

const CATS = [
  { key: 'all',          label: 'Всё' },
  { key: 'trip',         label: 'Поездки' },
  { key: 'passenger',    label: 'Попутчики' },
  { key: 'announcement', label: 'Объявления' },
  { key: 'marketplace',  label: 'Маркет' },
];

function feedLocationLabel(u) {
  const city = typeof u?.city === 'string' ? u.city.trim() : '';
  return city || 'Москва';
}

function feedDateLabel(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(now);
  } catch {
    return 'сегодня';
  }
}

// BD-ERROR-01C-B / BD-ERROR-02A — route a feed data-load failure through the
// global app-shell overlay via the shared data_layer.loadResource adapter (the
// per-screen wrapper was consolidated in 02A). Defensive wire: today
// listFeedPosts() resolves from mock/localStorage and does not reject, so the
// failure path is dormant. loadResource shows 'retrying' on retry, dismisses
// only on a successful reload (guarded by onlyIfState), reports server_error
// with the guarded onRetry on failure, and falls back to [] so the feed's own
// empty state is preserved (the overlay is additive).
// #1185 — the router sends every path it has no screen for to this loader («the /feed fallback»)
// and leaves the address as typed. The feed used to render under that wrong address as if
// nothing had happened. This loader now answers such a path with a not-found state: what was
// typed, and one way out. The bare root forms (an empty hash, `#/`) are the app's home and still
// show the feed. Routing itself is unchanged — the router still resolves an unknown path to the
// /feed loader and reports the rendered route as /feed.
const HOME_PATHS = new Set(['', '/', '/feed']);

export function unknownRoutePath(hash) {
  const raw = typeof hash === 'string' ? hash : ((typeof location !== 'undefined' && location.hash) || '');
  const path = raw.replace(/^#/, '').split('?')[0];
  return HOME_PATHS.has(path) ? null : path;
}

const NOT_FOUND_PATH_MAX = 60;

// The address as a person reads it: percent-escapes decoded when they decode cleanly, cut to a
// line's length. It is only ever shown as text (escaped at the call site).
export function readableRoutePath(path) {
  let text = String(path ?? '');
  try { text = decodeURIComponent(text); } catch { /* a stray «%» — show it as typed */ }
  return text.length > NOT_FOUND_PATH_MAX ? `${text.slice(0, NOT_FOUND_PATH_MAX)}…` : text;
}

function notFoundView(path) {
  const shown = readableRoutePath(path);
  const root = document.createElement('section');
  root.className = 'screen screen--not-found';
  root.dataset.state = 'not-found';
  root.innerHTML = `
    <header class="bd-topbar">
      <div class="bd-topbar__titles"><h1 class="bd-topbar__title">Страница не найдена</h1></div>
    </header>
    <div class="bd-scroll">
      <div class="bd-empty not-found" role="status">
        <div class="bd-empty__title">Такой страницы нет</div>
        <p class="not-found__text">Адрес <span class="not-found__path">${escapeHtml(shown)}</span> не ведёт ни на один экран. Возможно, ссылка устарела или в ней опечатка.</p>
        <button type="button" class="bd-btn primary not-found__cta" data-action="not-found-feed">В ленту</button>
      </div>
    </div>`;
  root.querySelector('[data-action="not-found-feed"]').addEventListener('click', () => go('/feed'));
  return root;
}

export default function feed(renderContext) {
  const unknownPath = unknownRoutePath();
  if (unknownPath !== null) return notFoundView(unknownPath);
  const guestReadOnly = renderContext?.guestReadOnly === true;
  // BD-FEED-01 — return the screen shell synchronously and load in the
  // background (refreshList) so the feed paints a loading skeleton immediately
  // instead of leaving #app blank while the data resolves (the router clears
  // #app before awaiting the loader). Both the initial load and the retry go
  // through refreshList → loadResource (BD-ERROR-01C-B: single guarded path,
  // server_error overlay + [] fallback). The retry arrow runs only on «Повторить».
  const onFeedRetry = () => { refreshList(true); };
  let posts = [];
  let activeKey = 'all';
  let query = '';
  const subtitle = `${feedLocationLabel(user.get())} · ${feedDateLabel()}`;

  const root = document.createElement('section');
  root.className = 'screen screen--feed';

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Лента</h1>
        <p class="bd-topbar__sub">${escapeHtml(subtitle)}</p>
      </div>
      <div class="feed-topbar-actions">
        <button class="bd-iconbtn" type="button" id="feed-search-toggle" aria-label="Поиск" aria-expanded="false" aria-controls="feed-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="rules-v2-search feed-search" id="feed-search" hidden>
      <span class="rules-v2-search__ic">${SEARCH_ICON}</span>
      <input id="feed-search-input" class="rules-v2-search__input" type="text" autocomplete="off" enterkeyhint="search"
        placeholder="Маршрут, автор или текст" aria-label="Поиск по ленте">
      <button type="button" class="rules-v2-search__clear" id="feed-search-clear" aria-label="Очистить поиск">×</button>
    </div>
    <div class="feed-chip-row" role="group" aria-label="Категории">
      ${CATS.map((c, i) =>
        `<button class="feed-chip${i === 0 ? ' active' : ''}" data-cat="${escapeHtml(c.key)}"
                 type="button" aria-pressed="${i === 0 ? 'true' : 'false'}">${escapeHtml(c.label)}</button>`
      ).join('')}
    </div>
    <div class="bd-scroll feed-list" role="feed"></div>
    <div class="feed-toast" id="feed-toast" role="status" aria-live="polite" hidden></div>
  `;

  const chipRow  = root.querySelector('.feed-chip-row');
  const feedList = root.querySelector('.feed-list');
  // #1125 R1 — on a live backend the order feed is for signed-in viewers only
  // (GET /orders answers 401), so a guest gets the sign-in prompt instead of a
  // request that can only fail into the server_error overlay. Nothing to filter
  // until then.
  const guestSignIn = guestReadOnly && isBackendEnabled();
  if (guestSignIn) chipRow.hidden = true;
  // Nothing to search either: the list is the sign-in prompt, and a repaint from the search
  // field would replace it with an empty-feed state.
  if (guestSignIn) root.querySelector('#feed-search-toggle').hidden = true;

  function renderSignIn() {
    feedList.setAttribute('aria-busy', 'false');
    feedList.innerHTML = `
      <div class="bd-empty feed-signin">
        <div class="bd-empty__title">Войдите, чтобы видеть заказы</div>
        <p>Поездки в ленте видны только участникам сервиса.</p>
        <button type="button" class="bd-btn primary sm feed-signin__cta" id="feed-signin">Войти</button>
      </div>`;
    feedList.querySelector('#feed-signin').addEventListener('click', () => go('/onboarding'));
  }

  async function refreshList(isRetry) {
    if (guestSignIn) return renderSignIn();
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
    if (guestSignIn) return renderSignIn();
    feedList.setAttribute('aria-busy', 'false');
    const q = normalizeQuery(query);
    const items = posts.filter((p) => {
      if (q && !postMatchesQuery(p, q)) return false;
      if (activeKey === 'all')       return true;
      if (activeKey === 'passenger') return p.type === 'trip' && p.passenger === true;
      if (activeKey === 'trip')      return p.type === 'trip' && !p.passenger;
      return p.type === activeKey;
    });
    if (items.length) {
      feedList.innerHTML = items.map(post => renderCard(post, guestReadOnly)).join('');
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
      : q
        ? `<div class="bd-empty">
             <div class="bd-empty__title">Ничего не найдено</div>
             <p>По запросу «${escapeHtml(query.trim())}» публикаций нет. Измените запрос или фильтр.</p>
             <button type="button" class="bd-btn sm feed-search__reset" data-feed-search-reset>Сбросить поиск</button>
           </div>`
        : `<div class="bd-empty">
             <div class="bd-empty__title">Ничего не найдено</div>
             <p>Попробуйте сменить фильтр.</p>
           </div>`;
  }

  // BD-FEED-SEARCH-01 — a real client-side filter over the loaded posts (route, author,
  // title, text, tags, price). It composes with the category chips and has its own
  // no-results state; closing the field clears the query.
  const searchToggle = root.querySelector('#feed-search-toggle');
  const searchWrap   = root.querySelector('#feed-search');
  const searchInput  = root.querySelector('#feed-search-input');
  function applyQuery(value) {
    query = value;
    searchWrap.classList.toggle('rules-v2-search--active', query.trim().length > 0);
    renderList();
  }
  function setSearchOpen(open) {
    searchWrap.hidden = !open;
    searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    searchToggle.classList.toggle('active', open);
    if (open) searchInput.focus();
    else if (query) { searchInput.value = ''; applyQuery(''); }
  }
  searchToggle.addEventListener('click', () => setSearchOpen(searchWrap.hidden));
  searchInput.addEventListener('input', () => applyQuery(searchInput.value));
  function resetSearch() {
    searchInput.value = '';
    applyQuery('');
    searchInput.focus();
  }
  root.querySelector('#feed-search-clear').addEventListener('click', resetSearch);

  // BD-FEED-SHARE-01 — «Поделиться» hands the post link to the system share sheet, or
  // copies it when the browser has none; the toast says which one happened.
  const toastEl = root.querySelector('#feed-toast');
  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }
  async function sharePost(postId) {
    const post = posts.find((p) => String(p.id) === String(postId));
    if (!post) return;
    const url = postShareUrl(post.id);
    const title = cardLabel(post).replace(/^Открыть: /, '');
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, url });
        return;
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(url);
        toast('Ссылка скопирована');
        return;
      }
      toast('Не удалось поделиться: скопируйте ссылку из адресной строки публикации');
    } catch (err) {
      // A dismissed share sheet is the user's choice, not a failure.
      if (err && err.name === 'AbortError') return;
      toast('Не удалось поделиться. Попробуйте ещё раз');
    }
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

  // Creation has one owner: the shell FAB in app.js preserves requireOnboarding
  // and the role-aware getCreateEntryRoute, including passenger smoke intent.

  feedList.addEventListener('click', (e) => {
    if (e.target.closest('[data-feed-search-reset]')) {
      resetSearch();
      return;
    }
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const postId = actionBtn.dataset.postId;

      if (actionBtn.dataset.action === 'share') {
        void sharePost(postId);
        return;
      }

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
        if (guestReadOnly) return;
        // BD-SMOKE-ROLE-01 — gate the driver accept on the per-tab effective
        // role so a passenger smoke tab cannot execute the accept flow even if
        // the shared persisted role is driver.
        // #1185 — the card was rendered «Принять заказ» for a driver on the line; if «На линии» was
        // switched off since (also in another tab — user.get() is this tab's cache), say so.
        if (refreshDriverLineOff()) {
          toast('Вы не на линии. Выйдите на линию, чтобы принять заказ');
          return;
        }
        const u = applySmokeRole(user.get());
        const post = posts.find((p) => String(p.id) === String(postId));
        if (!canAcceptPassengerRequest(u, post)) return;
        // One ride at a time: an unfinished ride is reopened instead of accepting another.
        const busy = busyDriverRide();
        if (busy) {
          go(`/active-ride?role=driver&tripId=${encodeURIComponent(busy.tripId)}`);
          return;
        }

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

  // #1186 — the post menu (⋮), like and comment controls were enabled stubs: they looked
  // tappable and did nothing. By the owner's decision they are not rendered until the features
  // exist (see renderCardHeader / renderPostActions); every control on a card now does something.

  refreshList(false);
  return root;
}

// ── Helpers ────────────────────────────────────────────────────

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="20" height="20">
  <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;

function normalizeQuery(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

// A post matches when every word of the query occurs somewhere in its visible text.
export function postMatchesQuery(p, normalizedQuery) {
  if (!normalizedQuery) return true;
  const haystack = normalizeQuery([
    p.author, p.role, p.title, p.body, p.from, p.to, p.when, p.price,
    ...(Array.isArray(p.tags) ? p.tags : []),
  ].filter(Boolean).join(' '));
  return normalizedQuery.split(/\s+/).every((word) => haystack.includes(word));
}

function postShareUrl(postId) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/post?id=${encodeURIComponent(postId)}`;
}

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

function renderCard(p, guestReadOnly = false) {
  switch (p.type) {
    case 'system':       return renderSystemCard(p);
    case 'trip':         return renderTripCard(p, guestReadOnly);
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
    </div>
  `;
}

// #1186 — share is the one post action that exists. Like and comment come back with their features.
function renderPostActions(p) {
  return `
    <div class="feed-post-actions">
      <button class="feed-post-actions__btn feed-post-actions__share" type="button" data-action="share" data-post-id="${escapeHtml(p.id || '')}" aria-label="Поделиться">
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

function renderTripCard(p, guestReadOnly = false) {
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
  const ownPassengerOrder = !guestReadOnly && p.passenger === true && canManageOwnOrder(p, u);
  const driverCanAccept = !guestReadOnly && canAcceptOrder(p, u);
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
    // #1176 — a driver who already responded from this device sees their offer, and the same
    // tap opens it for editing.
    // #1188 — the post's edit stamps say whether that offer still answers the order's terms.
    const mine = !guestReadOnly && isDriverMode(u) ? ownOfferLabel(p) : '';
    ctaAttrs = `data-action="respond" data-post-id="${postId}" aria-label="${mine ? 'Изменить своё предложение' : 'Откликнуться на заявку попутчика'}"`;
    ctaLabel = mine ? escapeHtml(mine) : 'Откликнуться';
  } else if (!guestReadOnly && canManageOwnOrder(p, u)) {
    // The author's own trip offer: nobody to write to, so no CTA (the card still opens).
    ctaAttrs = null;
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
      ${ctaAttrs ? `<button class="bd-btn primary feed-card-cta" type="button" ${ctaAttrs}>
        ${ctaLabel}
      </button>` : ''}
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
