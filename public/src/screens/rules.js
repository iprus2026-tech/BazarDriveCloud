import { go } from '../router.js';
import { escapeHtml } from '../util.js';

// Static content — no localStorage, no network. Cloud Design: «Правила и документы».
const SECTIONS = [
  {
    id: 'community',
    title: 'Правила сообщества',
    subtitle: 'Обязательно к прочтению',
    icon: 'shield',
    tone: 'accent',
    chips: ['Запрет демпинга', 'Этика общения', 'Безопасность поездок', 'Запрещённые товары'],
  },
  {
    id: 'driver-memo',
    title: 'Памятка водителю',
    subtitle: 'Что делать перед выездом',
    icon: 'car',
    tone: 'info',
    chips: ['Проверка автомобиля', 'Медосмотр', 'Действия при ДТП', 'Спорные ситуации'],
  },
  {
    id: 'taxes',
    title: 'Налоги и отчётность',
    subtitle: 'Самозанятость, НПД и УСН',
    icon: 'receipt',
    tone: 'success',
    chips: ['Как платить налог', 'Чеки в «Мой налог»', 'Лимит 2,4 млн ₽', 'УСН 6% / 15%'],
  },
];

const DOCUMENT_TEMPLATES = [
  { id: 'passenger-contract', title: 'Договор перевозки пассажира', size: '24 КБ', format: 'DOCX', updated: 'Обновлён 12.03' },
  { id: 'waybill', title: 'Путевой лист (электронный)', size: '12 КБ', format: 'PDF', updated: 'Обновлён 02.04' },
  { id: 'cash-receipt', title: 'Расписка о получении наличных', size: '8 КБ', format: 'DOCX', updated: 'Обновлён 02.02' },
  { id: 'inspection-act', title: 'Акт осмотра автомобиля', size: '16 КБ', format: 'PDF', updated: 'Обновлён 18.01' },
];

const ICONS = {
  search: '<path d="M21 21l-4.3-4.3"/><circle cx="11" cy="11" r="7"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  car: '<path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M5 13h14v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="15.5" r="0.6"/><circle cx="16.5" cy="15.5" r="0.6"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h4"/>',
  doc: '<path d="M7 2h7l5 5v15a0 0 0 0 1 0 0H7a0 0 0 0 1 0 0z"/><path d="M14 2v5h5"/>',
  spark: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M18.5 15l.8 2 .8-2"/>',
};

function svg(name, size = 22) {
  const body = ICONS[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function renderSection(section) {
  const tone = section.tone === 'info' || section.tone === 'success' || section.tone === 'danger'
    ? section.tone
    : 'accent';
  const chips = section.chips
    .map((chip) => `<span class="bd-badge">${escapeHtml(chip)}</span>`)
    .join('');

  return `
    <article class="bd-card rules-v2-section">
      <div class="rules-v2-section__head">
        <span class="rules-v2-section__icon rules-v2-section__icon--${tone}">${svg(section.icon, 22)}</span>
        <div class="rules-v2-section__titles">
          <h3 class="rules-v2-section__title">${escapeHtml(section.title)}</h3>
          <p class="rules-v2-section__sub">${escapeHtml(section.subtitle)}</p>
        </div>
        <span class="rules-v2-section__chevron">${svg('chevron', 18)}</span>
      </div>
      <div class="rules-v2-section__chips">${chips}</div>
    </article>
  `;
}

function renderTemplate(doc) {
  const meta = `${doc.size} · ${doc.format} · ${doc.updated}`;
  return `
    <article class="bd-card-tight rules-v2-doc">
      <span class="rules-v2-doc__icon">${svg('doc', 20)}</span>
      <div class="rules-v2-doc__body">
        <div class="rules-v2-doc__title">${escapeHtml(doc.title)}</div>
        <div class="rules-v2-doc__meta">${escapeHtml(meta)}</div>
      </div>
      <button type="button" class="bd-btn sm rules-v2-doc__action" data-doc="${escapeHtml(doc.id)}">
        Скачать
      </button>
    </article>
  `;
}

function renderEmpty() {
  return `
    <div class="bd-empty rules-v2-empty">
      <div class="bd-empty__title">Правила пока недоступны</div>
      <p>Мы обновляем свод правил и шаблоны документов. Вернитесь чуть позже или загляните в ленту.</p>
      <div class="rules-v2-empty__actions">
        <button type="button" class="bd-btn primary" data-go="/feed">Вернуться в ленту</button>
      </div>
    </div>
  `;
}

export default function rules() {
  const root = document.createElement('section');
  root.className = 'screen';

  const hasSections = Array.isArray(SECTIONS) && SECTIONS.length > 0;
  const hasTemplates = Array.isArray(DOCUMENT_TEMPLATES) && DOCUMENT_TEMPLATES.length > 0;
  const hasContent = hasSections || hasTemplates;

  const body = hasContent ? `
    ${hasSections ? `
      <div class="bd-section-h">
        <h2>Разделы</h2>
      </div>
      ${SECTIONS.map(renderSection).join('')}
    ` : ''}

    ${hasTemplates ? `
      <div class="bd-section-h">
        <h2>Шаблоны документов</h2>
        <button type="button" data-noop>Все</button>
      </div>
      ${DOCUMENT_TEMPLATES.map(renderTemplate).join('')}
    ` : ''}

    <article class="bd-card rules-v2-support">
      <span class="rules-v2-support__icon">${svg('spark', 20)}</span>
      <div class="rules-v2-support__body">
        <h3 class="rules-v2-support__title">Не нашли нужный шаблон?</h3>
        <p class="rules-v2-support__text">
          Напишите в поддержку — мы добавим его в течение 24 часов.
        </p>
      </div>
    </article>
  ` : renderEmpty();

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Правила</h1>
        <p class="bd-topbar__sub">Документы и шаблоны</p>
      </div>
      <button type="button" class="bd-iconbtn" data-noop aria-label="Поиск">
        ${svg('search', 20)}
      </button>
    </div>

    <div class="bd-scroll">
      ${body}
    </div>
  `;

  root.addEventListener('click', (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn && goBtn.dataset.go) {
      go(goBtn.dataset.go);
      return;
    }
    // Document download and search are mock/no-op (no backend, no real files).
    const docBtn = e.target.closest('[data-doc]');
    if (docBtn) {
      e.preventDefault();
      return;
    }
    const noop = e.target.closest('[data-noop]');
    if (noop) {
      e.preventDefault();
    }
  });

  return root;
}
