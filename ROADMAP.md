# Roadmap

## Phase 1 — PWA-каркас (✓ готово)

- [x] Static shell в `public/`, без сборщика
- [x] Cloud Design: токены, компоненты, max-width 430 px shell
- [x] Welcome → Feed / Rules / Profile-lite (гость, без onboarding)
- [x] Onboarding запускается только из CTA (FAB `+`, переход в `/new`)
- [x] Pending intent: после onboarding → ровно на задуманное действие
- [x] Composer с автосохранением черновика в localStorage
- [x] Mock API (seed-посты + createPost) в localStorage
- [x] FAB только на ленте, динамический header, bottom navigation
- [x] Service Worker: precache + offline fallback на `index.html`
- [x] PWA manifest с PNG-иконками 192/512 (any + maskable)
- [x] Строгий CSP без `unsafe-inline`
- [x] CI: проверки CSP-инвариантов и синтаксиса JS
- [x] GitHub Pages deploy из `public/`

---

## Phase 2 — Реальный backend

- [ ] Замена `mock_api.js` на API-клиент (fetch + JWT / magic-link)
- [ ] Аутентификация: Telegram Login или magic-link по email
- [ ] Загрузка изображений к объявлениям
- [ ] Категории и теги в ленте — фильтрация и поиск
- [ ] Серверная модерация по правилам сообщества
- [ ] Пагинация / infinite scroll

---

## Phase 3 — Engagement

- [ ] Web Push уведомления (новые объявления по подпискам)
- [ ] Отклики и переписка по объявлению
- [ ] Геолокация — сортировка по расстоянию
- [ ] Избранное и сохранённые запросы
- [ ] Профиль с историей объявлений и рейтингом

---

## Phase 4 — За пределами PWA

- [ ] Telegram Mini App обёртка поверх того же кода
- [ ] Background Sync для офлайн-публикаций
- [ ] Web Share API для шеринга объявлений
- [ ] Нативные подписи (App Store / Play) при необходимости

---

## Дизайн (Cloud Design)

- [ ] Иллюстрации пустых состояний (empty state)
- [ ] Анимации переходов между экранами
- [ ] Гайдлайн по плотности и компонентам (storybook-lite)
- [ ] Переключатель тема тёмная / светлая (phase 2)
- [ ] Брендовый маскот / brand voice

---

## Технический долг

- `mock_api.js` → в phase 2 уезжает в IndexedDB или на сервер
- Hash-роутер прост, работает в Pages; при собственном домене — History API + 404-fallback
- Нет тестов; минимально — node:test для роутера и mock_api
- Иконки генерируются `scripts/build_icons.py`; при рефакторинге иконок — обновить и SW precache
