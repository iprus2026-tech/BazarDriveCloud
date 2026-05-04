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

function saveDraft(draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
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

  const root = document.createElement('section');
  root.className = 'screen screen--composer';
  const draft = loadDraft();

  root.innerHTML = `
    <header class="screen__header">
      <h1 class="screen__title">Новое объявление</h1>
      <p class="screen__subtitle">Заголовок и пара деталей — этого хватит</p>
    </header>
    <form class="form" id="composer-form" novalidate>
      <label class="field">
        <span class="field__label">Заголовок</span>
        <input class="field__input" name="title" type="text" required minlength="5" maxlength="100"
               value="${escapeHtml(draft.title || '')}" autocomplete="off">
      </label>
      <label class="field">
        <span class="field__label">Описание</span>
        <textarea class="field__input field__input--multi" name="body" required minlength="10" maxlength="2000">${escapeHtml(draft.body || '')}</textarea>
      </label>
      <label class="field">
        <span class="field__label">Теги (через запятую)</span>
        <input class="field__input" name="tags" type="text" maxlength="120"
               value="${escapeHtml(draft.tags || '')}" placeholder="аренда, алматы, авто" autocomplete="off">
        <span class="composer__hint">До 5 тегов помогают чужим находить ваше объявление.</span>
      </label>
      <div class="composer__actions">
        <button type="submit" class="btn btn--primary">Опубликовать</button>
        <button type="button" class="btn btn--ghost" id="composer-cancel">Отмена</button>
      </div>
    </form>
  `;

  const form = root.querySelector('#composer-form');
  const fields = ['title', 'body', 'tags'];

  for (const name of fields) {
    const el = form.elements[name];
    el.addEventListener('input', () => {
      const data = new FormData(form);
      saveDraft({
        title: String(data.get('title') ?? ''),
        body: String(data.get('body') ?? ''),
        tags: String(data.get('tags') ?? ''),
      });
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const title = String(data.get('title') ?? '').trim();
    const body = String(data.get('body') ?? '').trim();
    const tagsRaw = String(data.get('tags') ?? '').trim();
    if (title.length < 5 || body.length < 10) return;

    const tags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5)
      : [];

    await createPost({ title, body, tags });
    clearDraft();
    go('/feed');
  });

  root.querySelector('#composer-cancel').addEventListener('click', () => {
    go('/feed');
  });

  return root;
}
