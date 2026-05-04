import { escapeHtml } from '../util.js';

const RULES = [
  'Запрещены накрутки, боты и фейковые отклики.',
  'Объявление = реальное предложение по реальной цене.',
  'Спам, оскорбления и провокации удаляем без предупреждения.',
  'Контактные данные показываются только зарегистрированным.',
  'Жалобы рассматриваем в течение 24 часов.',
];

export default function rules() {
  const root = document.createElement('section');
  root.className = 'screen screen--rules';
  root.innerHTML = `
    <header class="screen__header">
      <h1 class="screen__title">Правила</h1>
      <p class="screen__subtitle">Чтобы лента оставалась чистой</p>
    </header>
    <ol class="rules">
      ${RULES.map((r) => `<li class="rules__item">${escapeHtml(r)}</li>`).join('')}
    </ol>
  `;
  return root;
}
