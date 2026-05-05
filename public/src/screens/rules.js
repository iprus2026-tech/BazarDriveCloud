import { escapeHtml } from '../util.js';

const RULES = [
  { text: 'Запрещены накрутки, боты и фейковые отклики.' },
  { text: 'Объявление — это реальное предложение по реальной цене.' },
  { text: 'Спам, оскорбления и провокации удаляем без предупреждения.' },
  { text: 'Контактные данные показываются только зарегистрированным участникам.' },
  { text: 'Жалобы рассматриваем в течение 24 часов.' },
];

export default function rules() {
  const root = document.createElement('section');
  root.className = 'screen';

  root.innerHTML = `
    <div class="bd-topbar">
      <div class="bd-topbar__titles">
        <h1 class="bd-topbar__title">Правила</h1>
        <p class="bd-topbar__sub">Чтобы лента оставалась чистой</p>
      </div>
    </div>
    <div class="bd-scroll">
      <ol class="rules-list" aria-label="Правила сообщества">
        ${RULES.map((r, i) => `
          <li class="rules-list__item">
            <span class="rules-list__num" aria-hidden="true">${i + 1}</span>
            ${escapeHtml(r.text)}
          </li>
        `).join('')}
      </ol>
    </div>
  `;

  return root;
}
