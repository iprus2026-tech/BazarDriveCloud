import { user } from '../state.js';
import { go, setPendingAction } from '../router.js';
import { createFeedPost, createRideOrder, LOCAL_USER_ID } from '../mock_api.js';
import { escapeHtml } from '../util.js';
import { consumeRepeatRouteDraft } from '../repeat_route.js';
import { isDriverMode, isPassengerMode } from '../ride_actions.js';

const DRAFT_KEY = 'bazardrive.draft.v2';

const POST_TYPES = [
  { key: 'trip',         label: 'Поездка' },
  { key: 'passenger',    label: 'Попутчик' },
  { key: 'announcement', label: 'Объявление' },
  { key: 'marketplace',  label: 'Маркет' },
  { key: 'service',      label: 'Услуга' },
];

// BD-ROLE-01 — Composer intent vocabulary. External `?type=` values (used by
// role-aware create links such as /new?type=driver_offer) map onto the
// internal chip keys above so the create-flow stays role-aware without
// leaking chip naming into URLs.
const INTENT_TO_TYPE = {
  passenger_request: 'passenger',
  driver_offer:      'trip',
  marketplace:       'marketplace',
  service:           'service',
};

// Read a recognised `?type=` intent from the current hash, mapped to an
// internal chip key. Returns null when the param is missing or unknown so
// callers fall back to the role default.
function readIntentTypeFromHash() {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  const raw = new URLSearchParams(hash.slice(qi + 1)).get('type');
  if (!raw) return null;
  return INTENT_TO_TYPE[raw] || null;
}

// Safe default composer intent by current role. Driver mode defaults to a
// driver offer (never silently a passenger request); passenger mode to a
// passenger request; guest / unknown role keeps the neutral trip default.
function defaultTypeForRole(u) {
  if (isDriverMode(u)) return 'trip';
  if (isPassengerMode(u)) return 'passenger';
  return 'trip';
}

function emptyDraft() {
  return {
    type: 'trip',
    from: '', to: '', when: '', price: '', seats: '', phone: '', comment: '',
    budget: '',
    title: '', description: '', category: '', location: '', listingPrice: '',
  };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    return { ...emptyDraft(), ...JSON.parse(raw) };
  } catch {
    return emptyDraft();
  }
}

function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

// BD-AUTH-BOUNDARY-01 — composer drafts can contain user-specific trip
// data (from/to/when/price for a trip post) so they participate in the
// clear-on-boundary set. Exposed as a named export so storage_boundary.js
// can wipe it without depending on the default screen factory.
export function clearComposerDraft() {
  clearDraft();
}

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : 'В';
}

// BD-RIDE-HISTORY-05 — map a sanitized repeat-route draft (repeat_route.js)
// onto a composer draft. A driver's completed ride becomes a trip offer
// (price), a passenger's becomes a passenger request (budget); the previous
// fare is carried only as a suggested value the user can freely edit.
// Identity / payment / earnings fields never reach this point.
function applyRepeatRoute(draft, repeat) {
  const isDriver = repeat.role === 'driver';
  draft.type = isDriver ? 'trip' : 'passenger';
  draft.from = repeat.pickup;
  draft.to = repeat.dropoff;
  if (repeat.suggestedFare != null) {
    const fare = String(repeat.suggestedFare);
    if (isDriver) draft.price = fare;
    else draft.budget = fare;
  }
}

// ── Preview card renderer (mirrors feed.js visual patterns) ────────

function renderPreviewCard(d) {
  const author = 'Вы';
  const time   = 'Только что';

  const header = `
    <div class="feed-card-header">
      <div class="feed-avatar" aria-hidden="true">${escapeHtml(initial(author))}</div>
      <div class="feed-card-header__info">
        <div class="feed-card-header__name">${escapeHtml(author)}</div>
        <div class="feed-card-header__meta">${escapeHtml(time)}</div>
      </div>
    </div>
  `;

  if (d.type === 'trip' || d.type === 'passenger') {
    const isPassenger = d.type === 'passenger';
    const clockSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" aria-hidden="true" width="12" height="12">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>`;
    const priceHtml = !isPassenger && d.price
      ? `<div class="feed-trip-price">${escapeHtml(d.price)} ₽</div>`
      : (isPassenger && d.budget ? `<div class="feed-trip-price">${escapeHtml(d.budget)} ₽</div>` : '');
    return `
      <article class="bd-card">
        ${header}
        <div class="feed-route-row">
          <div class="feed-route-track">
            <div class="feed-route-dot"></div>
            <div class="feed-route-line"></div>
            <div class="feed-route-sq"></div>
          </div>
          <div class="feed-route-places">
            <div class="feed-route-from">${escapeHtml(d.from || 'Откуда')}</div>
            <div class="feed-route-to">${escapeHtml(d.to || 'Куда')}</div>
          </div>
        </div>
        <div class="feed-trip-meta">
          <div class="feed-trip-meta__badges">
            ${d.when ? `<span class="bd-badge accent">${clockSvg}${escapeHtml(d.when)}</span>` : ''}
            ${!isPassenger && d.seats ? `<span class="bd-badge">${escapeHtml(d.seats)} мест</span>` : ''}
          </div>
          ${priceHtml}
        </div>
        ${d.comment ? `<p class="feed-card-body">${escapeHtml(d.comment)}</p>` : ''}
        <button class="bd-btn primary feed-card-cta" type="button">
          ${isPassenger ? 'Откликнуться' : 'Написать водителю'}
        </button>
      </article>
    `;
  }

  if (d.type === 'marketplace' || d.type === 'service') {
    return `
      <article class="bd-card">
        ${header}
        ${d.title ? `<h2 class="feed-card-mkt-title">${escapeHtml(d.title)}</h2>` : ''}
        ${d.listingPrice ? `<div class="feed-card-mkt-price">${escapeHtml(d.listingPrice)} ₽</div>` : ''}
        ${d.description ? `<p class="feed-card-body">${escapeHtml(d.description)}</p>` : ''}
        ${d.location ? `<div class="feed-card-tags"><span class="bd-badge">${escapeHtml(d.location)}</span></div>` : ''}
      </article>
    `;
  }

  // announcement
  return `
    <article class="bd-card">
      ${header}
      ${d.title ? `<h2 class="feed-card-ann-title">${escapeHtml(d.title)}</h2>` : ''}
      ${d.description ? `<p class="feed-card-body">${escapeHtml(d.description)}</p>` : ''}
    </article>
  `;
}

// ── Build feed post object from draft ─────────────────────────────

function buildFeedPost(d) {
  if (d.type === 'trip') {
    return {
      type: 'trip',
      author: 'Вы',
      role: 'Водитель',
      from:  d.from,
      to:    d.to,
      when:  d.when,
      price: d.price ? `${d.price} ₽` : null,
      seats: d.seats ? Number(d.seats) : null,
      body:  d.comment || null,
      phone: d.phone || null,
    };
  }
  if (d.type === 'marketplace' || d.type === 'service') {
    return {
      type: 'marketplace',
      // Preserve the original draft kind so «Мои публикации» can label
      // service posts as «Услуга» — Feed V2 still renders both as marketplace.
      subtype: d.type,
      author: 'Вы',
      role: null,
      title: d.title,
      price: d.listingPrice ? `${d.listingPrice} ₽` : null,
      body:  d.description || null,
      tags:  [d.category, d.location].filter(Boolean),
    };
  }
  return {
    type: 'announcement',
    author: 'Вы',
    role: null,
    title: d.title,
    body:  d.description || null,
  };
}

// ── Build ride-order input from passenger draft ────────────────────
// BD-RIDE-ORDER-UNIFY-01 PR2 — Composer passenger requests write
// canonical ride orders, so Feed (PR1 projection) and DriverMap
// (listNearbyOrders) surface the same entity.
//
// Composer budget is free text (placeholder `1 500`), so `Number('1 500')`
// is NaN. parseMoneyLike strips non-digits before parsing so the numeric
// estimate stays usable for DriverMap; the raw typed string is preserved
// separately in estimatedPriceLabel so Feed renders what the user actually
// typed instead of `0 ₽`. Same idea for `when`: free text is kept in
// scheduledLabel and the projection prefers it over parsing scheduledAt.
function parseMoneyLike(value) {
  const normalized = String(value || '').replace(/[^\d]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

// BD-ACTIVE-07 — Mirror order_map_draft.js phone masking so a composer
// passenger request carries the same phoneMasked shape that the
// driver-side ActiveRide row already expects. Tiny duplicate kept local
// on purpose: no shared util module touched in this PR.
function maskedPhoneForSnapshot(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (digits.length < 11) return '';
  const last4 = digits.slice(-4);
  return `+7 (${digits.slice(-10, -7)}) ··· ${last4.slice(0, 2)}-${last4.slice(2)}`;
}

// BD-ACTIVE-07 — Capture the order author's identity at publish time so
// composer-created passenger requests hand the right passenger to the
// driver-side accept path (instead of the generic "Пассажир" fallback).
// Same shape as the order_map_draft snapshot.
function buildPassengerSnapshotFromUser(u, commentText) {
  const first = typeof u.firstName === 'string' ? u.firstName.trim() : '';
  const last = typeof u.lastName === 'string' ? u.lastName.trim() : '';
  const composed = [first, last].filter(Boolean).join(' ');
  const displayName = typeof u.displayName === 'string' ? u.displayName.trim() : '';
  const name = composed || displayName || 'Вы';
  const initials = name === 'Вы'
    ? 'В'
    : (composed
        ? `${first ? first.charAt(0).toUpperCase() : ''}${last ? last.charAt(0).toUpperCase() : ''}` || name.charAt(0).toUpperCase()
        : name.charAt(0).toUpperCase());
  return {
    name,
    initials,
    phoneMasked: maskedPhoneForSnapshot(u.phone),
    comment: commentText,
    authorId: LOCAL_USER_ID,
    isCurrentUser: true,
  };
}

function buildRideOrderFromComposerDraft(d, u) {
  const whenLabel = String(d.when || '').trim();
  const commentText = typeof d.comment === 'string' ? d.comment.trim() : '';
  return {
    type: 'passenger_request',
    source: 'feed',
    pickup: { id: null, label: d.from },
    dropoff: { id: null, label: d.to },
    distanceKm: 0,
    durationMin: 0,
    estimatedPrice: parseMoneyLike(d.budget),
    estimatedPriceLabel: String(d.budget || '').trim(),
    scheduledMode: 'later',
    scheduledAt: whenLabel || new Date().toISOString(),
    scheduledLabel: whenLabel,
    comment: d.comment,
    passenger: u ? buildPassengerSnapshotFromUser(u, commentText) : null,
  };
}

// ── Validate draft ─────────────────────────────────────────────────

function validate(d) {
  if (d.type === 'trip' || d.type === 'passenger') {
    if (d.from.length < 2) return 'Укажите откуда (минимум 2 символа)';
    if (d.to.length < 2)   return 'Укажите куда (минимум 2 символа)';
    if (!d.when)            return 'Укажите время отправления';
  } else {
    if (d.title.length < 3) return 'Укажите название (минимум 3 символа)';
  }
  return null;
}

// ── Main screen factory ─────────────────────────────────────────────

export default function composer() {
  if (!user.get().onboarded) {
    setPendingAction(() => go('/new'));
    go('/onboarding');
    const placeholder = document.createElement('section');
    placeholder.className = 'screen';
    return placeholder;
  }

  const draft = loadDraft();

  // BD-RIDE-HISTORY-05 — apply a one-time "repeat route" prefill from ride
  // history if one is waiting. consumeRepeatRouteDraft() is read-and-remove,
  // so this fires at most once regardless of the branch taken below.
  //
  // Draft-collision rule (explicit — never silently destroy user work): the
  // prefill is applied ONLY when the existing composer draft is empty. If the
  // user already has unsaved draft data, we keep it untouched and surface a
  // note explaining the route was not applied. Either way the repeat draft is
  // consumed so it can't leak into a later, unrelated composer session.
  const repeat = consumeRepeatRouteDraft();
  let repeatNotice = null; // 'applied' | 'kept' | null
  if (repeat) {
    const existingHasData = Object.entries(draft).some(([k, v]) => k !== 'type' && v);
    if (existingHasData) {
      repeatNotice = 'kept';
    } else {
      applyRepeatRoute(draft, repeat);
      saveDraft(draft);
      repeatNotice = 'applied';
    }
  }

  // BD-ROLE-01 — Resolve the initial intent. Precedence:
  //   1. explicit ?type= intent (role-aware create links) always wins and
  //      overrides any persisted draft type;
  //   2. otherwise keep an in-progress draft's type (never silently discard
  //      the user's unsaved work just to honor a role default);
  //   3. otherwise fall back to the safe default for the current role.
  const intentType = readIntentTypeFromHash();
  const hasExistingDraftData = Object.entries(draft).some(([k, v]) => k !== 'type' && v);
  let activeType;
  if (intentType) {
    activeType = intentType;
  } else if (hasExistingDraftData) {
    activeType = draft.type || defaultTypeForRole(user.get());
  } else {
    activeType = defaultTypeForRole(user.get());
  }
  draft.type = activeType;
  let isPreview  = false;

  const root = document.createElement('section');
  root.className = 'screen screen--composer';

  const isTripLike  = activeType === 'trip' || activeType === 'passenger';
  const isPassenger = activeType === 'passenger';
  const isAnnounce  = activeType === 'announcement';

  root.innerHTML = `
    <div class="composer__topbar">
      <button type="button" class="composer__back" id="composer-back" aria-label="Назад">
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="11 4 6 9 11 14"/>
        </svg>
      </button>
      <span class="composer__title">Новая публикация</span>
      <span class="composer__draft-badge" id="composer-draft-badge" hidden>Черновик</span>
    </div>

    <div class="composer__type-row" role="tablist" aria-label="Тип публикации">
      ${POST_TYPES.map((t) => `
        <button class="composer-type-chip${t.key === activeType ? ' active' : ''}"
                data-type="${escapeHtml(t.key)}" role="tab" type="button"
                aria-selected="${t.key === activeType ? 'true' : 'false'}">
          ${escapeHtml(t.label)}
        </button>
      `).join('')}
    </div>

    <div class="composer__body bd-scroll" id="composer-edit">
      <div class="bd-alert composer-prefill__note" id="composer-prefill-note" role="status" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
             width="20" height="20" class="composer-prefill__note-icon">
          <path d="M3 12a9 9 0 1 0 9-9"/>
          <polyline points="3 4 3 9 8 9"/>
        </svg>
        <p class="composer-prefill__note-text" id="composer-prefill-note-text"></p>
      </div>
      <div class="bd-alert warning composer-role__note" id="composer-role-note" role="status" hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
             width="20" height="20" class="composer-role__note-icon">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <p class="composer-role__note-text" id="composer-role-note-text"></p>
        <button type="button" class="bd-btn ghost sm composer-role__note-btn" id="composer-role-switch">Создать как водитель</button>
      </div>
      <form id="composer-form" novalidate>

        <fieldset class="composer-fieldset" id="fields-trip-passenger"${isTripLike ? '' : ' hidden'}>
          <legend class="sr-only">Поля для поездки или попутчика</legend>
          <div class="bd-field">
            <label class="bd-label" for="c-from">Откуда</label>
            <input class="bd-input" id="c-from" name="from" type="text"
                   placeholder="Например, Аэропорт Внуково"
                   value="${escapeHtml(draft.from || '')}" autocomplete="off">
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-to">Куда</label>
            <input class="bd-input" id="c-to" name="to" type="text"
                   placeholder="м. Парк Победы"
                   value="${escapeHtml(draft.to || '')}" autocomplete="off">
          </div>
          <div class="composer__row">
            <div class="bd-field">
              <label class="bd-label" for="c-when">Когда</label>
              <input class="bd-input" id="c-when" name="when" type="text"
                     placeholder="Сегодня, 18:30"
                     value="${escapeHtml(draft.when || '')}" autocomplete="off">
            </div>
            <div class="bd-field" id="seats-field"${isPassenger ? ' hidden' : ''}>
              <label class="bd-label" for="c-seats">Мест</label>
              <input class="bd-input" id="c-seats" name="seats"
                     type="number" min="1" max="8" placeholder="1–8"
                     value="${escapeHtml(draft.seats || '')}">
            </div>
          </div>
          <div class="bd-field" id="price-field"${isPassenger ? ' hidden' : ''}>
            <label class="bd-label" for="c-price">Цена, ₽</label>
            <input class="bd-input" id="c-price" name="price" type="text"
                   placeholder="2 500"
                   value="${escapeHtml(draft.price || '')}" autocomplete="off">
          </div>
          <div class="bd-field" id="budget-field"${isPassenger ? '' : ' hidden'}>
            <label class="bd-label" for="c-budget">Бюджет, ₽</label>
            <input class="bd-input" id="c-budget" name="budget" type="text"
                   placeholder="1 500"
                   value="${escapeHtml(draft.budget || '')}" autocomplete="off">
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-phone">Телефон</label>
            <input class="bd-input" id="c-phone" name="phone" type="tel"
                   placeholder="+7 999 000-00-00"
                   value="${escapeHtml(draft.phone || '')}" autocomplete="tel">
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-comment">Комментарий</label>
            <textarea class="bd-textarea" id="c-comment" name="comment"
                      placeholder="Уточнения по маршруту, багаж, пожелания…"
                      rows="3">${escapeHtml(draft.comment || '')}</textarea>
          </div>
        </fieldset>

        <fieldset class="composer-fieldset" id="fields-listing"${isTripLike ? ' hidden' : ''}>
          <legend class="sr-only">Поля для объявления, маркета или услуги</legend>
          <div class="bd-field">
            <label class="bd-label" for="c-title">Название</label>
            <input class="bd-input" id="c-title" name="title" type="text"
                   placeholder="Кратко о чём объявление"
                   value="${escapeHtml(draft.title || '')}" autocomplete="off">
          </div>
          <div class="bd-field" id="listing-price-field"${isAnnounce ? ' hidden' : ''}>
            <label class="bd-label" for="c-listing-price">Цена, ₽</label>
            <input class="bd-input" id="c-listing-price" name="listingPrice" type="text"
                   placeholder="45 000"
                   value="${escapeHtml(draft.listingPrice || '')}" autocomplete="off">
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-description">Описание</label>
            <textarea class="bd-textarea" id="c-description" name="description"
                      placeholder="Расскажите подробнее…"
                      rows="4">${escapeHtml(draft.description || '')}</textarea>
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-category">Категория</label>
            <input class="bd-input" id="c-category" name="category" type="text"
                   placeholder="Авто, Запчасти, Услуги…"
                   value="${escapeHtml(draft.category || '')}" autocomplete="off">
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-location">Локация</label>
            <input class="bd-input" id="c-location" name="location" type="text"
                   placeholder="Город или район"
                   value="${escapeHtml(draft.location || '')}" autocomplete="off">
          </div>
          <div class="bd-field">
            <label class="bd-label" for="c-photo-btn">Фото</label>
            <button type="button" class="composer-photo-btn bd-card-tight" id="c-photo-btn"
                    aria-describedby="photo-hint">
              <div class="bd-list-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                     width="20" height="20">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <div class="composer-photo-label">
                <span class="composer-photo-label__main">Добавить фото</span>
                <span class="composer-photo-label__sub" id="photo-hint">До 6 изображений</span>
              </div>
            </button>
          </div>
        </fieldset>

        <div class="bd-alert info composer-info-alert" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
               width="20" height="20" class="composer-info-icon">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p class="composer-info-text">
            Перед публикацией ознакомьтесь с <strong>правилами сообщества</strong>
          </p>
        </div>

        <div class="composer__error" id="composer-error" hidden role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" aria-hidden="true" width="16" height="16">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span id="composer-error-text"></span>
        </div>

      </form>
    </div>

    <div class="composer__preview-area bd-scroll" id="composer-preview" hidden aria-live="polite">
      <p class="composer__preview-label">Предпросмотр</p>
      <div id="composer-preview-card"></div>
      <p class="composer__preview-hint">Так карточка будет выглядеть в ленте</p>
    </div>

    <div class="composer__footer">
      <div class="composer__footer-actions">
        <button type="button" class="bd-btn ghost sm" id="composer-draft-btn">Черновик</button>
        <button type="button" class="bd-btn ghost sm" id="composer-preview-btn">Предпросмотр</button>
      </div>
      <button type="submit" form="composer-form" class="bd-btn primary" id="composer-submit">
        Опубликовать
      </button>
    </div>
  `;

  // ── DOM refs ────────────────────────────────────────────────────
  const form               = root.querySelector('#composer-form');
  const typeRow            = root.querySelector('.composer__type-row');
  const editArea           = root.querySelector('#composer-edit');
  const previewArea        = root.querySelector('#composer-preview');
  const previewCard        = root.querySelector('#composer-preview-card');
  const draftBadge         = root.querySelector('#composer-draft-badge');
  const submitBtn          = root.querySelector('#composer-submit');
  const previewBtn         = root.querySelector('#composer-preview-btn');
  const draftBtn           = root.querySelector('#composer-draft-btn');
  const errorBox           = root.querySelector('#composer-error');
  const errorText          = root.querySelector('#composer-error-text');
  const fieldsTripPass     = root.querySelector('#fields-trip-passenger');
  const fieldsListing      = root.querySelector('#fields-listing');
  const seatsField         = root.querySelector('#seats-field');
  const priceField         = root.querySelector('#price-field');
  const budgetField        = root.querySelector('#budget-field');
  const listingPriceField  = root.querySelector('#listing-price-field');
  const prefillNote        = root.querySelector('#composer-prefill-note');
  const prefillNoteText    = root.querySelector('#composer-prefill-note-text');
  const roleNote           = root.querySelector('#composer-role-note');
  const roleNoteText       = root.querySelector('#composer-role-note-text');
  const roleSwitchBtn      = root.querySelector('#composer-role-switch');

  // BD-ROLE-01 — Driver-mode guard. When a driver lands on the passenger
  // request chip (e.g. via the explicit "Перейти в режим пассажира" intent),
  // surface a visible notice so the cross-role publication is never silent,
  // plus a one-tap switch back to the driver-native offer.
  const driverMode = isDriverMode(user.get());
  function updateRoleNote() {
    if (!roleNote) return;
    if (driverMode && activeType === 'passenger') {
      roleNoteText.textContent =
        'Вы в режиме водителя. Эта публикация будет создана как пассажирский запрос.';
      roleNote.hidden = false;
    } else {
      roleNote.hidden = true;
    }
  }

  // ── Collect current form values into draft object ───────────────
  function collectDraft() {
    const fd = new FormData(form);
    return {
      type:         activeType,
      from:         String(fd.get('from')         ?? '').trim(),
      to:           String(fd.get('to')           ?? '').trim(),
      when:         String(fd.get('when')         ?? '').trim(),
      price:        String(fd.get('price')        ?? '').trim(),
      seats:        String(fd.get('seats')        ?? '').trim(),
      phone:        String(fd.get('phone')        ?? '').trim(),
      comment:      String(fd.get('comment')      ?? '').trim(),
      budget:       String(fd.get('budget')       ?? '').trim(),
      title:        String(fd.get('title')        ?? '').trim(),
      description:  String(fd.get('description')  ?? '').trim(),
      category:     String(fd.get('category')     ?? '').trim(),
      location:     String(fd.get('location')     ?? '').trim(),
      listingPrice: String(fd.get('listingPrice') ?? '').trim(),
    };
  }

  // ── Apply field visibility for given type ───────────────────────
  function applyType(type) {
    const tripLike   = type === 'trip' || type === 'passenger';
    const passenger  = type === 'passenger';
    const announce   = type === 'announcement';

    fieldsTripPass.hidden    = !tripLike;
    fieldsListing.hidden     = tripLike;
    seatsField.hidden        = passenger;
    priceField.hidden        = passenger;
    budgetField.hidden       = !passenger;
    listingPriceField.hidden = announce;
    updateRoleNote();
  }

  // ── Validation error helpers ────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorBox.hidden = false;
  }
  function clearError() {
    errorBox.hidden = true;
    errorText.textContent = '';
  }

  // ── Draft badge flash ───────────────────────────────────────────
  let draftTimer = null;
  function flashDraftSaved() {
    draftBadge.textContent = 'Черновик сохранён';
    draftBadge.hidden = false;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftBadge.hidden = true;
    }, 2200);
  }

  // ── Preview helpers ─────────────────────────────────────────────
  function enterPreview() {
    isPreview = true;
    editArea.hidden = true;
    previewArea.hidden = false;
    previewBtn.textContent = 'Редактировать';
    previewCard.innerHTML = renderPreviewCard(collectDraft());
  }
  function exitPreview() {
    isPreview = false;
    editArea.hidden = false;
    previewArea.hidden = true;
    previewBtn.textContent = 'Предпросмотр';
  }

  // ── Submit loading helpers ──────────────────────────────────────
  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.textContent = on ? 'Публикуем…' : 'Опубликовать';
    submitBtn.classList.toggle('loading', on);
  }

  // ── Event: type chip ────────────────────────────────────────────
  typeRow.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    activeType = chip.dataset.type;
    for (const c of typeRow.querySelectorAll('[data-type]')) {
      const sel = c.dataset.type === activeType;
      c.classList.toggle('active', sel);
      c.setAttribute('aria-selected', String(sel));
    }
    applyType(activeType);
    if (isPreview) exitPreview();
    saveDraft({ ...collectDraft(), type: activeType });
    clearError();
  });

  // ── Event: auto-save on any input ──────────────────────────────
  form.addEventListener('input', () => {
    saveDraft(collectDraft());
  });

  // ── Event: manual draft save ────────────────────────────────────
  draftBtn.addEventListener('click', () => {
    saveDraft(collectDraft());
    flashDraftSaved();
  });

  // ── Event: preview toggle ───────────────────────────────────────
  previewBtn.addEventListener('click', () => {
    if (isPreview) exitPreview();
    else enterPreview();
  });

  // ── Event: photo placeholder (no-op, scope-defined stub) ────────
  root.querySelector('#c-photo-btn').addEventListener('click', () => {});

  // ── Event: driver role-guard switch → back to driver offer chip ──
  roleSwitchBtn?.addEventListener('click', () => {
    const chip = typeRow.querySelector('[data-type="trip"]');
    if (chip) chip.click();
  });

  // ── Event: submit ───────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const d = collectDraft();
    const err = validate(d);
    if (err) {
      showError(err);
      return;
    }

    setLoading(true);
    try {
      if (d.type === 'passenger') {
        createRideOrder(buildRideOrderFromComposerDraft(d, user.get()));
      } else {
        createFeedPost(buildFeedPost(d));
      }
      clearDraft();
      go('/feed');
    } catch {
      showError('Не удалось опубликовать. Попробуйте ещё раз.');
      setLoading(false);
    }
  });

  // ── Event: back button ──────────────────────────────────────────
  root.querySelector('#composer-back').addEventListener('click', () => go('/feed'));

  // ── Init ────────────────────────────────────────────────────────
  applyType(activeType);

  // BD-RIDE-HISTORY-05 — surface the repeat-route prefill outcome. The route
  // is only ever prefilled into editable fields; nothing is auto-submitted.
  if (repeatNotice) {
    prefillNoteText.textContent = repeatNotice === 'applied'
      ? 'Маршрут заполнен из истории поездки'
      : 'Сохранён текущий черновик — маршрут из истории не применён';
    prefillNote.classList.add(repeatNotice === 'applied' ? 'success' : 'warning');
    prefillNote.hidden = false;
  }

  const hasDraftData = Object.entries(draft).some(([k, v]) => k !== 'type' && v);
  if (hasDraftData) {
    draftBadge.textContent = 'Черновик';
    draftBadge.hidden = false;
  }

  return root;
}
