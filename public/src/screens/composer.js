import { user } from '../state.js';
import { go, setPendingAction } from '../router.js';
import { createFeedPost } from '../mock_api.js';
import { escapeHtml } from '../util.js';

const DRAFT_KEY = 'bazardrive.draft.v2';

const POST_TYPES = [
  { key: 'trip',         label: 'Поездка' },
  { key: 'passenger',    label: 'Попутчик' },
  { key: 'announcement', label: 'Объявление' },
  { key: 'marketplace',  label: 'Маркет' },
  { key: 'service',      label: 'Услуга' },
];

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

function initial(name) {
  return name ? String(name).trim().charAt(0).toUpperCase() : 'В';
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
    };
  }
  if (d.type === 'passenger') {
    const bodyParts = [];
    if (d.comment) bodyParts.push(d.comment);
    return {
      type: 'trip',
      passenger: true,
      author: 'Вы',
      role: 'Пассажир',
      from:  d.from,
      to:    d.to,
      when:  d.when,
      price: d.budget ? `${d.budget} ₽` : null,
      seats: null,
      body:  bodyParts.join('. ') || null,
    };
  }
  if (d.type === 'marketplace' || d.type === 'service') {
    return {
      type: 'marketplace',
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
  let activeType = draft.type || 'trip';
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
      createFeedPost(buildFeedPost(d));
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

  const hasDraftData = Object.entries(draft).some(([k, v]) => k !== 'type' && v);
  if (hasDraftData) {
    draftBadge.textContent = 'Черновик';
    draftBadge.hidden = false;
  }

  return root;
}
