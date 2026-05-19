import { go } from '../router.js';
import { escapeHtml } from '../util.js';

const RULES = [
  {
    title: 'Честные публикации',
    text: 'Размещайте только реальные поездки, объявления и предложения. Никаких фейков и накруток.',
    tone: 'default',
  },
  {
    title: 'Реальные цены',
    text: 'Указывайте цену, по которой вы действительно готовы поехать или предложить услугу.',
    tone: 'default',
  },
  {
    title: 'Без спама и оскорблений',
    text: 'Спам, оскорбления, провокации и троллинг удаляем без предупреждения.',
    tone: 'warning',
  },
  {
    title: 'Контакты — только для участников',
    text: 'Телефон и контактные данные показываются только зарегистрированным участникам и после отклика.',
    tone: 'default',
  },
  {
    title: 'Безопасность поездок',
    text: 'Соблюдайте ПДД, не садитесь за руль уставшим, проверяйте документы попутчиков перед поездкой.',
    tone: 'success',
  },
  {
    title: 'Жалобы — 24 часа',
    text: 'Жалобы и спорные ситуации рассматриваем в течение 24 часов. Будьте конкретны в описании.',
    tone: 'default',
  },
];

function renderRule(rule, index) {
  const tone = rule.tone === 'warning' || rule.tone === 'success' || rule.tone === 'danger'
    ? rule.tone
    : 'default';

  return `
    <li class="rules-v2-item rules-v2-item--${tone}">
      <span class="rules-v2-item__num" aria-hidden="true">${index + 1}</span>
      <div class="rules-v2-item__body">
        <h3 class="rules-v2-item__title">${escapeHtml(rule.title)}</h3>
        <p class="rules-v2-item__text">${escapeHtml(rule.text)}</p>
      </div>
    </li>
  `;
}

function renderList(rules) {
  if (!rules.length) {
    return `
      <div class="bd-empty rules-v2-empty">
        <div class="bd-empty__title">Правила пока недоступны</div>
        <p>Мы обновляем свод правил сообщества. Вернитесь чуть позже или загляните в ленту.</p>
        <div class="rules-v2-empty__actions">
          <button type="button" class="bd-btn primary" data-go="/feed">Вернуться в ленту</button>
        </div>
      </div>
    `;
  }

  return `
    <ol class="rules-v2-list" aria-label="Правила сообщества">
      ${rules.map(renderRule).join('')}
    </ol>
  `;
}

export default function rules() {
  const root = document.createElement('section');
  root.className = 'screen';

  const hasRules = Array.isArray(RULES) && RULES.length > 0;

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Правила</h1>
        <p class="bd-topbar__sub">Сообщество и безопасность</p>
      </div>
    </div>

    <div class="bd-scroll">
      <article class="bd-card rules-v2-intro">
        <div class="rules-v2-intro__badges">
          <span class="bd-badge accent">Сообщество</span>
          <span class="bd-badge">Безопасность</span>
        </div>
        <h2 class="rules-v2-intro__title">Чтобы лента оставалась полезной</h2>
        <p class="rules-v2-intro__text">
          BazarDrive — это маркетплейс реальных поездок и объявлений.
          Несколько простых правил помогают сохранять доверие между
          водителями и пассажирами.
        </p>
      </article>

      ${hasRules ? `
        <div class="bd-section-h">
          <h2>Правила сообщества</h2>
          <span class="muted">${RULES.length}</span>
        </div>
      ` : ''}

      ${renderList(RULES)}

      ${hasRules ? `
        <article class="bd-card rules-v2-safety">
          <div class="rules-v2-safety__head">
            <span class="rules-v2-safety__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
            </span>
            <div class="rules-v2-safety__titles">
              <h2 class="rules-v2-safety__title">Безопасность и уважение</h2>
              <p class="rules-v2-safety__sub">Главное, что мы просим помнить</p>
            </div>
          </div>
          <ul class="rules-v2-safety__list">
            <li>Общайтесь уважительно — без угроз, оскорблений и давления.</li>
            <li>Не передавайте предоплату незнакомым водителям и пассажирам.</li>
            <li>Сообщайте о мошенничестве и подозрительных объявлениях.</li>
            <li>Берегите личные данные — не публикуйте чужие телефоны и адреса.</li>
          </ul>
          <button type="button" class="bd-btn primary rules-v2-safety__cta" data-go="/feed">
            Вернуться в ленту
          </button>
        </article>
      ` : ''}
    </div>
  `;

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (!btn) return;
    const target = btn.dataset.go;
    if (target) go(target);
  });

  return root;
}
