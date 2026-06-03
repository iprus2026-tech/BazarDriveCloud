# Регламент Cloud Design экранов

Документ фиксирует рабочую линию создания экранов в Cloud Design и добавления готового Cloud Design экрана в проект BazarDriveCloud.

Главная цепочка:

```text
Cloud Design render/frame
↓
Screen contract
↓
GitHub issue
↓
Feature branch
↓
Implementation in repo
↓
Local checks / smoke
↓
Pull Request
↓
Review against Cloud Design
↓
Merge to main
↓
Post-merge check / dispatcher
```

---

## 1. Регламент создания экрана в Cloud Design

### 1.1. Экран нельзя рисовать без паспорта

Перед созданием экрана Cloud Design должен получить паспорт задачи:

```text
Screen ID:
Screen name:
Role:
Route:
Source file:
Purpose:
User scenario:
Required states:
Main actions:
Empty state:
Loading state:
Error state:
Design dependencies:
Out of scope:
```

Пример:

```text
Screen ID: BD-MAP-03
Screen name: RoutePicker
Role: passenger / driver
Route: /route-picker
Source file: public/src/screens/route_picker.js
Purpose: выбор точки А и точки Б для поездки
State: routeDraft
Actions:
- выбрать точку подачи
- выбрать точку назначения
- поменять местами
- сбросить
- продолжить
Out of scope:
- real Mapbox
- backend
- auth
- APK
```

### 1.2. Один экран = один render gate

Cloud Design должен выдать не один красивый скрин, а набор состояний:

```text
Default
Empty
Loading
Error
Validation error
Success / saved
Role-specific states
Disabled buttons
Pressed / active states
```

Для BazarDrive важно явно разделять роли:

```text
guest
passenger
driver
```

### 1.3. Название frame строго по шаблону

```text
BD-<MODULE>-<NUMBER> <ScreenName> — Render Gate
```

Примеры:

```text
BD-FEED-01 Feed V2 — Render Gate
BD-COMPOSER-01 Composer V2 — Render Gate
BD-MAP-03 RoutePicker — Render Gate
BD-RIDE-P-01 Passenger Active Ride — Render Gate
BD-RIDE-D-02 Driver Active Ride — Render Gate
```

### 1.4. Что Cloud Design обязан отдать

После работы Cloud Design должен вернуть:

```text
1. Название frame/render gate
2. Список созданных состояний
3. Основные UI-компоненты
4. Какие компоненты переиспользуются
5. Какие компоненты нужно вынести в Design System
6. Рекомендации для screen contract
7. Что не входит в реализацию
```

### 1.5. Запреты для Cloud Design

```text
Не менять стиль всего приложения ради одного экрана.
Не придумывать новые цвета вместо #FF6B35.
Не ломать mobile shell max-width 430px.
Не рисовать экран без route/file/state.
Не смешивать passenger и driver flow без явного разделения.
Не тащить backend, Mapbox, оплату или авторизацию, если экран про UI.
```

---

## 2. Регламент добавления Cloud Design экрана в проект

### 2.1. Общая цепочка

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
Local checks / smoke
↓
Pull Request
↓
Review against Cloud Design
↓
Merge to main
↓
Post-merge dispatcher/check
```

Без render/contract экран не должен попадать сразу в `public/src/screens/`.

---

### 2.2. Шаг 1 — создать или обновить screen contract

Файл:

```text
docs/screen-contracts.md
```

Формат контракта:

```text
Screen:
Route:
File:
Purpose:
Role:
Data source:
State:
Actions:
Empty state:
Loading state:
Error state:
Cloud Design render:
Acceptance checklist:
Manual test URLs:
```

Пример:

```text
Screen: BD-COMPOSER-01 Composer V2
Route: /new
File: public/src/screens/composer.js
Purpose: создание публикации / поездки / объявления / услуги
Role: passenger / driver / marketplace
Data source: localStorage, mock_api.js
State: composerDraft, user profile
Actions:
- выбрать тип публикации
- заполнить поля
- сохранить черновик
- открыть предпросмотр
- опубликовать
Cloud Design render: BD-COMPOSER-01 Composer V2 — Render Gate
Acceptance:
- экран открывается по /new
- все состояния соответствуют render gate
- нет inline script/style
- CSP не ослаблен
- node scripts/check.mjs проходит
```

---

### 2.3. Шаг 2 — создать GitHub issue

Issue должен содержать:

```text
Title:
Context:
Parent issue:
Cloud Design render:
Route:
File:
Scope:
Files likely touched:
What to do:
What not to touch:
Acceptance checklist:
Manual test URLs:
Branch:
```

Пример title:

```text
BD-COMPOSER-01 Composer V2 implementation from Cloud Design
```

---

### 2.4. Шаг 3 — создать feature branch

```powershell
git checkout main
git pull origin main
git checkout -b feature/bd-composer-01
```

Нельзя работать прямо в `main`, если задача не является документационной правкой, явно разрешённой владельцем.

---

### 2.5. Шаг 4 — реализовать экран в правильном месте

Типовые файлы:

```text
public/src/screens/<screen>.js
public/styles/cloud.css
public/src/state.js
public/src/mock_api.js
public/sw.js
docs/screen-contracts.md
```

Если добавлен новый JS-файл в `public/src/screens/`, проверить `public/sw.js`, потому что runtime-файлы могут быть в precache.

---

### 2.6. Шаг 5 — не трогать лишнее

В каждом PR должно быть чётко:

```text
Что меняем:
- конкретный экран
- его CSS
- нужный state/mock API
- smoke/check при необходимости

Что не меняем:
- backend
- APK
- CSP без необходимости
- prototype как index.html
- соседние экраны
- real Mapbox, если задача не про Mapbox
```

Прототип Cloud Design должен оставаться визуальным эталоном, а не превращаться в основной `index.html`.

---

### 2.7. Шаг 6 — проверить локально

Перед PR:

```powershell
node scripts/check.mjs
node scripts/dispatcher.mjs
git status
git diff --stat
```

Если есть smoke для экрана:

```powershell
node scripts/smoke-<screen>.mjs
```

---

### 2.8. Шаг 7 — указать Manual test URLs

В issue и PR обязательно указать адреса проверки.

Пример для Composer:

```text
/new
/new?type=trip
/new?type=passenger
/new?type=marketplace
/feed
/profile
```

Пример для Active Ride:

```text
/active-ride?role=driver
/active-ride?role=passenger
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/active-ride?role=passenger&status=WAITING_PASSENGER
/active-ride?role=passenger&status=IN_PROGRESS
/active-ride?role=passenger&status=COMPLETED
```

---

### 2.9. Шаг 8 — открыть PR

PR template:

```text
Title:
BD-XXXX ScreenName from Cloud Design

Summary:
- implemented screen from Cloud Design render gate
- updated screen contract
- added/updated state and mock API if needed

Changed files:
- ...

Not touched:
- backend
- APK
- CSP
- prototype
- unrelated screens

Checks:
- node scripts/check.mjs PASS
- node scripts/dispatcher.mjs PASS

Manual test URLs:
- ...

Cloud Design:
- frame/render gate name
```

---

### 2.10. Шаг 9 — review against Cloud Design

Сверять надо по чеклисту:

```text
Mobile shell max-width 430px
Dark theme
Accent #FF6B35
Topbar
Bottom nav / chrome visibility
Buttons
Text labels
Empty state
Loading state
Error state
Validation state
Role-specific state
Safe-area bottom spacing
No inline script
No inline style
CSP unchanged or justified
```

---

### 2.11. Шаг 10 — merge и post-merge

После merge:

```powershell
git checkout main
git pull origin main
node scripts/check.mjs
node scripts/dispatcher.mjs
```

Только после зелёного post-merge берём следующий экран.

---

## 3. Короткая формула для команды

```text
Render есть?
  Нет → ждём Cloud Design.
  Да → пишем screen contract.

Contract есть?
  Нет → нельзя кодить.
  Да → создаём GitHub issue.

Issue есть?
  Нет → создаём.
  Да → создаём ветку.

Ветка есть?
  Да → кодим только scope issue.

Код готов?
  node scripts/check.mjs
  node scripts/dispatcher.mjs
  PR
  Review against Cloud Design
  Merge
  Post-merge check
```

---

## 4. Готовый промпт для Cloud Design

```text
Create a Cloud Design render gate for BazarDriveCloud.

Screen:
BD-XXXX ScreenName

Route:
/route-name

Source file:
public/src/screens/screen_name.js

Role:
guest / passenger / driver

Goal:
Create a mobile-first Cloud Design screen for this user scenario:
[описать сценарий]

Required layout:
- dark mobile shell, max-width 430px
- topbar with title and back/action button if needed
- main content area
- bottom action area if needed
- use accent #FF6B35
- Russian UI labels

Required states:
- default
- empty
- loading
- error
- validation error
- success/saved
- role-specific states if applicable

Required actions:
- [action 1]
- [action 2]
- [action 3]

Reusable components:
- TopBar
- PrimaryButton
- SecondaryButton
- StatusBadge
- Card
- BottomSheet if needed

Out of scope:
- backend API
- real Mapbox
- APK / Android
- payment
- auth implementation unless this screen is auth
- redesigning unrelated screens

Output:
- Create/update frame named:
  BD-XXXX ScreenName — Render Gate

- Provide:
  1. list of created states
  2. short summary
  3. reused components
  4. components to extract into Design System
  5. recommended screen-contract notes
```

---

## 5. Готовый промпт для Claude Code / Copilot

```text
Repo:
iprus2026-tech/BazarDriveCloud

Task:
Implement BD-XXXX ScreenName from Cloud Design render gate.

Branch:
feature/bd-xxxx-screen-name

Context:
Cloud Design render gate exists:
BD-XXXX ScreenName — Render Gate

Screen contract:
docs/screen-contracts.md

Route:
/route-name

Source file:
public/src/screens/screen_name.js

Do:
1. Implement the screen according to the Cloud Design render gate.
2. Keep mobile shell and existing Cloud Design theme.
3. Add/update state only if required by the screen contract.
4. Add/update mock_api only if required by the screen contract.
5. Add CSS in public/styles/cloud.css using namespaced classes.
6. Update public/sw.js only if new public runtime files are added.
7. Run node scripts/check.mjs.
8. Run node scripts/dispatcher.mjs.

Do not:
- do not change backend
- do not add APK
- do not weaken CSP
- do not use inline script
- do not use inline style
- do not replace prototype as index.html
- do not rewrite unrelated screens
- do not add real Mapbox unless this issue explicitly says so

Acceptance:
- route opens
- UI matches Cloud Design render gate
- all required states exist
- buttons/actions work or show safe mock behavior
- node scripts/check.mjs passes
- node scripts/dispatcher.mjs passes

Final report:
- changed files
- git diff --stat
- checks result
- manual test URLs
```

---

## 6. Главное правило

Сначала паспорт экрана, потом дизайн, потом контракт, потом issue, потом маленький PR.

Так BazarDriveCloud растёт как нормальное приложение: секция за секцией, болт за болтом, без дымящегося капота.
