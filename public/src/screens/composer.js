import { user } from '../state.js';
import { go, setPendingAction } from '../router.js';
import { createPost } from '../mock_api.js';
import { escapeHtml } from '../util.js';

const DRAFT_KEY = 'bazardrive.draft.v1';

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : { title: '', body: '', tags: '' };
  } catch {
    return { title: '', body: '', tags: '' };
  }
}
function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

export default function composer() {
  if (!user.get().onboarded) {
    setPendingAction(() => go('/new'));
    go('/onboarding');
    const placeholder = document.createElement('section');
    placeholder.className = 'screen';
    return placeholder;
  }

  const draft = loadDraft();
  const root  = document.createElement('section');
  root.className = 'screen screen--composer';

  root.innerHTML = `
    <div class="composer__topbar">
      <button type="button" class="composer__back" id="composer-back" aria-label="Назад">
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="11 4 6 9 11 14"/>
        </svg>
        Назад
      </button>
      <span class="composer__back-title">Новое объявление</span>
    </div>
    <div class="composer__body">
      <form id="composer-form" novalidate>
        <div class="bd-field">
          <label class="bd-label" for="c-title">Заголовок</label>
          <input class="bd-input" id="c-title" name="title"
                 type="text" required minlength="5" maxlength="100"
                 value="${escapeHtml(draft.title || '')}" autocomplete="off"
                 placeholder="Аренда авто, запчасти, попутка…">
        </div>
        <div class="bd-field">
          <label class="bd-label" for="c-body">Описание</label>
          <textarea class="bd-textarea" id="c-body" name="body"
                    required minlength="10" maxlength="2000"
                    placeholder="Ключевые детали: состояние, цена, контакт…">${escapeHtml(draft.body || '')}</textarea>
        </div>
        <div class="bd-field">
          <label class="bd-label" for="c-tags">Теги (через запятую)</label>
          <input class="bd-input" id="c-tags" name="tags"
                 type="text" maxlength="120"
                 value="${escapeHtml(draft.tags || '')}"
                 placeholder="аренда, алматы, авто" autocomplete="off">
          <p class="composer__hint">До 5 тегов помогают другим найти ваше объявление</p>
        </div>
      </form>
    </div>
    <div class="composer__footer">
      <button type="submit" form="composer-form" class="bd-btn primary" id="composer-submit">Опубликовать</button>
      <button type="button" class="bd-btn ghost" id="composer-cancel">Отмена</button>
    </div>
  `;

  const form = root.querySelector('#composer-form');

  for (const name of ['title', 'body', 'tags']) {
    form.elements[name].addEventListener('input', () => {
      const d = new FormData(form);
      saveDraft({
        title: String(d.get('title') ?? ''),
        body:  String(d.get('body') ?? ''),
        tags:  String(d.get('tags') ?? ''),
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d     = new FormData(form);
    const title = String(d.get('title') ?? '').trim();
    const body  = String(d.get('body') ?? '').trim();
    const tags  = String(d.get('tags') ?? '').trim()
      .split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5);

    if (title.length < 5 || body.length < 10) return;

    const btn = root.querySelector('#composer-submit');
    btn.disabled = true;
    try {
      await createPost({ title, body, tags });
      clearDraft();
      go('/feed');
    } finally {
      btn.disabled = false;
    }
  });

  root.querySelector('#composer-back').addEventListener('click',   () => go('/feed'));
  root.querySelector('#composer-cancel').addEventListener('click', () => go('/feed'));

  return root;
}
