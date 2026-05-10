# BazarDriveCloud screen contracts

This document keeps the dispatcher development line grounded: every screen must have a Cloud Design render/frame, route, file path, state contract, actions, and acceptance checklist before implementation or audit work moves forward.

Parent tracking issue: #19
First audit issue: #20

## Dispatcher line

```text
Cloud Design render/frame
↓
Screen contract
↓
GitHub issue
↓
Feature branch
↓
Implementation
↓
node scripts/check.mjs
↓
Pull Request
↓
Review against Cloud Design
↓
Merge to main
```

## BD-FEED-01 — Feed V2

### Identity

```text
Screen: Feed V2
Route: /feed
File: public/src/screens/feed.js
Data source: listFeedPosts() from public/src/mock_api.js
State: local active category inside feed.js
Parent issue: #19
Working issue: #20
Recommended branch: audit/feed-dispatch-line
```

### Cloud Design render/frame gate

Status: needs explicit render/frame confirmation.

Feed V2 already exists in code and is treated as the first control screen for the dispatcher line. Before deeper visual polish, attach or confirm the current Cloud Design render/frame used as the visual reference.

### Related shell files

```text
public/index.html
public/src/app.js
public/src/router.js
public/styles/cloud.css
```

### Data contract

Feed V2 consumes `listFeedPosts()` from `public/src/mock_api.js`.

Expected post types:

```text
system
trip
announcement
marketplace
```

Expected trip variants:

```text
driver trip: type = trip, passenger != true
passenger request: type = trip, passenger = true
```

### UI states

```text
all posts
trip posts
passenger trip requests
announcement posts
marketplace posts
empty filtered state
```

### User actions

```text
select category chip
open create publication from the topbar plus button
open create publication from the global FAB on /feed only
use card CTAs: Откликнуться / Написать водителю
view like/comment/share placeholder actions
```

### Acceptance checklist

- [ ] `/feed` opens through the hash router.
- [ ] Bottom navigation highlights `Лента` on `/feed`.
- [ ] Category chips switch without a page reload.
- [ ] `Всё` shows all Feed V2 post types.
- [ ] `Поездки` shows driver trip cards.
- [ ] `Попутчики` shows passenger trip request cards.
- [ ] `Объявления` shows announcement cards.
- [ ] `Маркет` shows marketplace cards.
- [ ] Empty filtered state renders correctly.
- [ ] Topbar plus button opens `/new`.
- [ ] Global FAB is visible only on `/feed`.
- [ ] No inline `<script>` or `<style>` is introduced.
- [ ] CSP is not weakened.
- [ ] `node scripts/check.mjs` passes before PR merge.

### Out of scope for BD-FEED-01

```text
Mapbox integration
backend API
Android / APK
Service Worker changes
prototype replacement as public/index.html
major refactor outside Feed V2 audit
```

## BD-COMPOSER-01 — Composer V2

### Identity

```text
Screen:      Composer V2
Route:       /new
File:        public/src/screens/composer.js
Purpose:     создание публикации / поездки / объявления
Data source: localStorage + createFeedPost() from public/src/mock_api.js
Draft key:   bazardrive.draft.v2
Parent issue: #22
```

### States

```text
driver offer      — type=trip: поля from/to/when/price/seats/phone/comment
passenger request — type=passenger: поля from/to/when/budget/phone/comment (seats скрыты)
marketplace item  — type=marketplace: поля title/listingPrice/description/category/location/photo
announcement      — type=announcement: поля title/description/category/location/photo (price скрыт)
service           — type=service: поля title/listingPrice/description/category/location/photo
preview           — editArea hidden, previewArea visible с карточкой Feed V2
validation error  — .composer__error полоса с текстом ошибки
draft saved       — badge «Черновик сохранён» в topbar на 2.2 сек
submit loading    — кнопка disabled + класс .loading + текст «Публикуем…»
```

### Actions

```text
save draft   — кнопка «Черновик» → flashDraftSaved() + saveDraft()
preview      — кнопка «Предпросмотр» / «Редактировать» переключает режим
publish      — validate → createFeedPost() → clearDraft() → go('/feed')
back         — go('/feed')
type switch  — обновляет activeType, показывает нужные поля, выходит из preview
auto-save    — form input → saveDraft() при каждом вводе
```

### Data contract

```text
Читает:  localStorage[bazardrive.draft.v2]
Пишет:   localStorage[bazardrive.draft.v2]
Удаляет: localStorage[bazardrive.draft.v2] при публикации
Инжектит в ленту: FEED_POSTS_V2.unshift(post) через createFeedPost()
```

### Preview card

Карточка в режиме предпросмотра использует те же CSS-классы, что и Feed V2:
`.bd-card`, `.feed-card-header`, `.feed-route-row`, `.feed-trip-meta`, `.feed-card-mkt-title`, etc.

### Out of scope

```text
backend, Mapbox, auth, payment, APK, реальная загрузка фото
```

### Acceptance checklist

- [ ] `/new` открывается через hash-роутер
- [ ] Редирект в onboarding если `user.onboarded === false`, pending action сохраняется
- [ ] Все 5 типов публикации переключаются чипами
- [ ] Поля отображаются корректно для каждого типа
- [ ] Поле «Мест» скрыто для типа «Попутчик»
- [ ] Поле «Цена» скрыто для типа «Объявление» в листинге
- [ ] Черновик сохраняется автоматически при любом вводе
- [ ] Кнопка «Черновик» показывает badge «Черновик сохранён» на 2.2 сек
- [ ] Кнопка «Предпросмотр» показывает карточку Feed V2
- [ ] Кнопка «Редактировать» возвращает к форме
- [ ] Валидация: ошибка если from/to пустые для поездки
- [ ] Валидация: ошибка если title < 3 символов для листинга
- [ ] «Опубликовать» добавляет пост в ленту и переходит на /feed
- [ ] Черновик очищается после публикации
- [ ] Новый пост виден в ленте сразу после публикации
- [ ] Нет inline `<script>` / `<style>` / `on*=` / `style=`
- [ ] `node scripts/check.mjs` проходит

## Planned minimum screens

These screens are tracked by #19 and should receive their own render/frame and contract before implementation:

```text
BD-PROFILE-01 — Profile V2
BD-MAP-01 — MapHome foundation
BD-MAP-02 — LocationPermission
BD-MAP-03 — RoutePicker
BD-MAP-04 — RoutePreview
BD-MAP-05 — OrderMapDraft
BD-DRIVER-01 — DriverMap
BD-RIDE-01 — ActiveRide
```
