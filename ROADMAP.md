# Roadmap

## Phase 1 — PWA-каркас (сейчас)

Готово:
- Static shell в `public/`, без сборщика.
- Welcome → Feed / Rules / Profile-lite без onboarding (гость).
- Onboarding запускается только из CTA-действий ("+").
- Composer (`#/new`) с черновиком в localStorage.
- Mock API (`mock_api.js`) с seed-постами и `createPost`.
- Service Worker: precache + offline fallback на `index.html`.
- Манифест с PNG-иконками 192/512 (any + maskable).
- Строгий CSP без `unsafe-inline`.
- CI с проверками CSP-инвариантов и синтаксиса JS.
- GitHub Pages деплой из `public/`.

## Phase 2 — Реальный backend

- Замена `mock_api.js` на API-клиент.
- Аутентификация (telegram-login или magic-link).
- Загрузка изображений к объявлениям.
- Категории и фильтры в ленте.
- Серверная модерация по правилам.

## Phase 3 — Engagement

- Push-уведомления через Web Push API.
- Отклики и переписка по объявлению.
- Геолокация и сортировка по расстоянию.
- Избранное и подписки на запросы.
- Профиль с историей и рейтингом.

## Phase 4 — За пределами PWA

- Telegram Mini App обёртка поверх того же кода.
- Нативные подписи (App Store / Play) при необходимости.
- Background sync для офлайн-публикаций.
- Sharing API для шеринга объявлений.

## Дизайн

Cloud Design — основа задана, но требует расширения:
- Иллюстрации пустых состояний.
- Маскот / brand voice.
- Темная тема как единственная (для phase 1) → переключатель в phase 2.
- Гайдлайн по тонам оранжевого и плотности интерфейса.

## Технический долг

- `mock_api.js` использует localStorage — на phase 2 уезжает в IndexedDB или на сервер.
- Hash-роутер — простой и работает в Pages, но при переходе на свой домен можно перейти на History API + 404-fallback.
- Нет тестов. Минимально — vitest или native node:test для роутера и mock_api.
