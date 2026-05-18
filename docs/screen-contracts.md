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

## BD-ONBOARDING-01 — Welcome V2 + Onboarding V2

### Identity

```text
Screen:       Welcome V2 + Onboarding / Auth V2
Routes:       /welcome → public/src/screens/welcome.js
              /onboarding → public/src/screens/onboarding.js
Data source:  localStorage via public/src/state.js
Design ref:   Claude Design — section "Онбординг · регистрация и вход" (9 artboards)
Working issue: #27
Branch:       feature/welcome-onboarding-v2
```

### Cloud Design render/frame gate

Design section: **Онбординг · регистрация и вход**

Artboards used as visual reference:

```text
1   · Добро пожаловать       → /welcome
2   · Выбор роли             → /onboarding step: role
3   · Номер телефона         → /onboarding step: phone
4   · Код подтверждения      → /onboarding step: otp
5   · Профиль                → /onboarding step: profile
6   · Автомобиль (водитель)  → /onboarding step: car
7   · Документы (водитель)   → /onboarding step: docs
8а  · Готово — водитель      → /onboarding step: done (role=driver)
8б  · Готово — пассажир      → /onboarding step: done (role=passenger)
```

### State contract

Fields added to `bazardrive.user.v1` (localStorage):

```text
role        string | null   'passenger' | 'driver' | 'guest'
phone       string | null   digits only (mock, no real SMS)
firstName   string | null
lastName    string | null
vehicleMake   string | null  driver only
vehicleModel  string | null  driver only
vehicleYear   string | null  driver only
vehiclePlate  string | null  driver only
vehicleColor  string | null  driver only
vehicleBody   string | null  driver only
```

Existing fields preserved: `welcomeSeen`, `onboarded`, `displayName`, `city`.

### Step sequences

```text
Passenger: role → phone → otp → profile → done          (5 steps)
Driver:    role → phone → otp → profile → car → docs → done  (7 steps)
Guest:     role only → clears pending action → /feed
```

### Actions

```text
/welcome  "Начать"                  → set welcomeSeen=true → /onboarding
/welcome  "Войти без регистрации"   → set welcomeSeen=true, role=guest → /feed
/onboarding  back (step 0)          → /welcome
/onboarding  back (step > 0)        → previous step
/onboarding  role=guest → next      → clear pending action, /feed (not onboarded)
/onboarding  done → "Перейти"       → set onboarded=true + all draft fields
                                       → consumePendingAction() OR
                                       → /profile (driver) / /feed (passenger)
```

### Implemented states

```text
role step:    none selected (next disabled) | role selected (next enabled)
phone step:   any input (mock, no validation beyond clearing non-digits)
otp step:     6-box display, auto-advance after 6 digits entered (mock)
profile step: optional name fields + skip button
car step:     make/model/year/color/plate text fields + body type chips
docs step:    6-item toggle checklist, progress bar (data-pct CSS-driven)
              required docs: dl, osago, permit (3 of 6)
done step:    driver variant (doc/car/payments next steps)
              passenger variant (feed/notifications next steps)
```

### Mock / stub states

```text
Phone verification:  no real SMS — any digits accepted
OTP code:           no real validation — any 6 digits auto-advance
Document upload:    toggle UI only — no file input or upload
Camera / avatar:    button rendered, no file picker wired
"Включите уведомления" card on done: navigates nowhere (stub)
```

### CSS additions

All styles added to `public/styles/cloud.css` under section `BD-ONBOARDING-01`.
No inline styles, no style= attributes. All dynamic state driven by classList
and data-pct attribute selector rules.

### Pending action preservation

`requireOnboarding(fn)` (in app.js) saves a pending action before redirecting
to /onboarding. On `finish()`, `consumePendingAction()` runs the saved action
(e.g., go('/new') after user tried to create a post as guest). The guest path
clears the pending action without running it.

### Acceptance checklist

- [ ] `/welcome` renders Welcome V2 with value props and two CTAs
- [ ] "Начать" sets `welcomeSeen=true` and goes to `/onboarding`
- [ ] "Войти без регистрации" sets `welcomeSeen=true, role=guest` and goes to `/feed`
- [ ] `/onboarding` shows step-based flow with dot progress indicator
- [ ] Back on step 0 returns to `/welcome`
- [ ] Role selection enables the Continue button
- [ ] Guest role selection goes to feed (not through phone/OTP)
- [ ] Passenger flow: 5 steps, no car/docs steps
- [ ] Driver flow: 7 steps, includes car and docs steps
- [ ] OTP auto-advances after 6 digits
- [ ] Docs checklist toggles card state and updates progress bar
- [ ] "Загружу позже" skips docs step
- [ ] Done screen shows driver or passenger variant correctly
- [ ] `finish()` writes all draft fields + `onboarded=true` to localStorage
- [ ] Pending action (e.g., /new) is restored after onboarding completes
- [ ] No inline `<script>` / `<style>` / `on*=` / `style=` attributes
- [ ] No `.style.<property>` assignments in JS
- [ ] `node scripts/check.mjs` passes

### Out of scope for BD-ONBOARDING-01

```text
Real SMS / OTP verification
Telegram Login Widget
Real document upload / camera
Backend API integration
Mapbox / location
Payments
APK / native Android
```

## BD-PROFILE-01 — Profile V2

### Identity

```text
Screen:       Profile V2
Route:        /profile
File:         public/src/screens/profile.js
Data source:  localStorage via public/src/state.js
Design ref:   Claude Design — section "Профиль"
Working issue: #26
Branch:       feature/profile-v2
```

### Cloud Design render/frame gate

Design section: **Профиль**

States used as visual reference:

```text
guest     — CTA card prompting registration
passenger — hero + stats + actions list
driver    — hero + stats + mode tabs + driver card (online toggle, car, checklist) + actions list
```

### State contract

Fields added to `bazardrive.user.v1` (localStorage):

```text
driverOnline          boolean   false    whether driver is currently on-duty
notificationsEnabled  boolean   false    notification toggle preference
```

Existing fields consumed (read-only in profile): `role`, `firstName`, `lastName`, `displayName`,
`phone`, `vehicleMake`, `vehicleModel`, `vehicleYear`, `vehiclePlate`, `vehicleColor`, `vehicleBody`.

### UI states

```text
guest            — .pf-guest-card with "Создать аккаунт" CTA (goes to /onboarding)
passenger        — hero + stats + actions
driver/passenger — mode tabs let driver view Passenger vs Driver pane
driver pane      — online toggle + car summary row + readiness checklist
```

### Implemented states

```text
guest CTA:       shows when !onboarded || role === 'guest'
hero:            avatar initials, full name, formatted phone, role badge
stats grid:      Публикации / Поездки / Отклики / Рейтинг (all 0 — stub data)
mode tabs:       Пассажир | Водитель (driver role only)
online toggle:   checkbox + CSS-driven track; persists driverOnline to state
car summary:     vehicleMake + vehicleModel + vehiclePlate from state; warning row if missing
checklist:       Телефон (done if phone), Автомобиль (done if vehicleMake),
                 Гос. номер (done if vehiclePlate), Документы (stub — always incomplete)
notifications:   checkbox toggle; persists notificationsEnabled to state
reset:           two-click confirmation via dataset.confirm='pending'
```

### Mock / stub states

```text
Stats:           all counts are 0 (no backend)
Replies action:  renders; no navigation (stub)
Car docs action: renders; no navigation (stub)
Rules action:    goes to /rules
```

### CSS additions

All styles added to `public/styles/cloud.css` under section `BD-PROFILE-01`.
CSS prefix: `pf-*`. No inline styles, no `style=` attributes. Toggle driven entirely
by `input:checked + .pf-toggle__track` adjacent-sibling selector.

### Acceptance checklist

- [ ] `/profile` renders guest CTA when `role === 'guest'` or `!onboarded`
- [ ] Guest CTA "Создать аккаунт" goes to `/onboarding`
- [ ] Hero shows avatar initials, name, phone, role badge for onboarded users
- [ ] Stats grid shows 4 columns
- [ ] Mode tabs visible for driver role only
- [ ] Driver pane shows online toggle, car summary, readiness checklist
- [ ] Online toggle persists `driverOnline` to localStorage
- [ ] Car summary shows make/model/plate; shows warning row if no car data
- [ ] Checklist marks phone/car/plate items done when state fields are set
- [ ] Notifications toggle persists `notificationsEnabled` to localStorage
- [ ] "Сбросить аккаунт" requires second click to confirm
- [ ] Reset calls `user.reset()` and redirects to `/welcome`
- [ ] No inline `<script>` / `<style>` / `on*=` / `style=` attributes
- [ ] No `.style.<property>` assignments in JS
- [ ] `node scripts/check.mjs` passes

### Out of scope for BD-PROFILE-01

```text
Real stats / post counts from backend
Document upload / photo avatar
Real notifications (push / FCM)
Edit profile flow
Payments / wallet
```

## BD-PROFILE-01 Profile V2 — Passenger

### Identity

```text
Screen:        BD-PROFILE-01 Profile V2 — Passenger
Route:         /profile
File:          public/src/screens/profile.js
Data source:   localStorage via public/src/state.js
Design ref:    Cloud Design — Профиль (Пассажир)
Parent issue:  #19
Working issue: #84
Branch:        feature/profile-v2-passenger-audit
```

### Purpose

Профиль пассажира с верификацией телефона, статистикой, быстрыми
действиями, меню и центром безопасности. Экран собирает четыре scroll-
состояния из Cloud Design в один свиток без потери блоков.

### Required states

```text
Passenger profile  — карточка пользователя, статистика, быстрые действия
Phone not verified — баннер «Подтвердите номер телефона» + большая
                     карточка «ТРЕБУЕТСЯ ДЕЙСТВИЕ → Подтвердите телефон»
Menu section       — История поездок / Сохранённые адреса / Способы
                     оплаты / Промокоды и бонусы / Уведомления (toggle)
Safety section     — Центр безопасности, плитки доверенных контактов,
                     поделиться поездкой, кнопка SOS, помощь, выйти,
                     футер BazarDrive · v2.4.1
```

### State contract

Reads from `bazardrive.user.v1` (localStorage):

```text
profileStatus         'incomplete' | 'ready'
phoneVerified         boolean   default false   gate for verify banner + TRD card
phone                 string|null               masked for the banner sub-line
firstName / lastName  string|null               displayed as "Имя Ф."
displayName           string|null               fallback when first/last missing
tripCount             number    default 0       used in identity badge + menu sub
savedAddressCount     number    default 0       used in menu sub
trustedContactsCount  number    default 0       used in safety tile count
promoCount            number    default 0       used in menu sub
paymentLast4          string|null               drives menu sub
notificationsEnabled  boolean                   bound to menu toggle
```

Mock-only constants in `profile.js`:

```text
MOCK_PROFILE_STATS.savingsRub  6240
MOCK_PROFILE_STATS.co2Kg       52
MOCK_PLANNED_TRIP              Дом → Аэропорт Внуково · Завтра · 07:00
```

### UI structure (top to bottom)

```text
1.  Topbar         — «Профиль» / «Пассажир» + bell + gear icon buttons
1b. Verify banner  — only when !phoneVerified
2.  Identity card  — avatar initials, name, @handle, ★4.92 · N поездок, edit
2b. TRD action card — only when !phoneVerified
3.  Onboard card   — only when !ready && phoneVerified
4.  First-trip CTA — only when !ready && addrs===0 && phoneVerified
5.  Ready status   — only when ready && phoneVerified
6.  Stats grid     — Поездок / Сэкономлено / CO₂  (when ready)
7.  Quick actions  — Куда едем? · Запланировать · Избранные · Промокод
7b. Trip section   — active / planned / empty (when ready)
8.  Menu card      — History · Addresses · Payment · Promos · Notifications
9.  Safety card    — center + 3 tiles (contacts / share / SOS)
10. Support card   — Помощь и поддержка + Выйти (two-click confirm)
11. Footer         — BazarDrive · v2.4.1
```

### Phone-verify behaviour (mock)

```text
Trigger:  user.phoneVerified === false
Banner:   warm gradient .pfp-verify-banner, phone icon, masked phone,
          "Получить код" primary button
TRD card: .pfp-verify-action-card with yellow eyebrow ТРЕБУЕТСЯ ДЕЙСТВИЕ,
          22px title, body text, full-width "Подтвердить телефон" CTA
Action:   both CTAs mock-set user.set({ phoneVerified: true }) and
          re-render — no real SMS provider, no auth route yet
Mask:     u.phone is masked to "+7 (XXX) ••• XX-XX"; falls back to
          "+7 (905) ••• 12-34" when phone is empty (matches Cloud Design)
```

### CSS additions

```text
.pfp-verify-banner          warm-yellow gradient card with row layout
.pfp-verify-banner-icon     square icon chip in --warning soft tint
.pfp-verify-banner-text     title + sub stack
.pfp-verify-banner-btn      compact 38px primary CTA
.pfp-verify-action-card     bigger ТРЕБУЕТСЯ ДЕЙСТВИЕ card
.pfp-verify-action-eyebrow  uppercase 11px label with warning dot
.pfp-verify-action-title    22px hero title
.pfp-verify-action-text     14px secondary description
.pfp-verify-action-btn      full-width primary CTA
```

Wraps to a stacked layout at `max-width: 360px` so the banner CTA can
grow full-width on narrow phones.

### Bottom navigation

```text
Tabs:           Лента · Правила · Профиль
Active:         Профиль (driven by router.js syncTabActive on /profile)
Content shift:  .bd-scroll has bottom padding (shell .has-tabbar) so the
                footer "BazarDrive · v2.4.1" does not hide under the nav
```

### Acceptance checklist

- [ ] `/profile` renders passenger view (after onboarding) with topbar
      «Профиль / Пассажир» and bell + gear icon buttons
- [ ] When `phoneVerified === false`, the verify banner and TRD card
      both appear
- [ ] «Получить код» and «Подтвердить телефон» mock-set
      `phoneVerified: true` and the verify cards disappear without a
      page reload
- [ ] Identity card shows avatar initials, name «Алексей В.», @alex_v,
      ★4.92 · 38 поездок and edit pencil
- [ ] Stats grid shows 38 / 6 240 ₽ / 52 кг in ready state
- [ ] Quick actions: Куда едем? · Запланировать · Избранные · Промокод
- [ ] Menu shows История поездок (38) · Сохранённые адреса (3) ·
      Способы оплаты (Не настроено / карта) · Промокоды и бонусы
      (2 активных) · Уведомления toggle
- [ ] Safety card has Центр безопасности · Активно + 3 tiles
      (Доверенные контакты 2, Поделиться поездкой Авто, Кнопка SOS 112)
- [ ] Footer renders `BazarDrive · v2.4.1`
- [ ] Bottom navigation highlights «Профиль» on `/profile`
- [ ] Bottom navigation does not cover the footer / last scroll item
- [ ] No real SMS provider is wired; verify CTAs are mock-only
- [ ] No inline `<script>` / `<style>` / `style=""` / `on*=` attributes
- [ ] No `.style.<property>` assignments in JS
- [ ] `node scripts/check.mjs` passes

### Out of scope for BD-PROFILE-01 Profile V2 — Passenger

```text
Real SMS / OTP / auth backend
Real ride orchestration from quick actions
Real notifications (push / FCM)
Real payments / wallet setup
Mapbox integration (separate screen)
APK / Android shell packaging
```

## BD-PROFILE-02 — Driver Dashboard Profile

### Identity

```text
Screen:       Driver Dashboard Profile
Route:        /profile (role === 'driver')
File:         public/src/screens/profile.js
Data source:  localStorage via public/src/state.js
Design ref:   Claude Design — section "Профиль водителя"
Working issue: #28
Branch:       feature/profile-driver-dashboard-v3
```

### Cloud Design render/frame gate

Design section: **Профиль водителя — Dashboard**

States used as visual reference:

```text
guest           — inherited from BD-PROFILE-01 (unchanged)
passenger       — inherited from BD-PROFILE-01 (unchanged)
driver/Обзор    — pf2-hero + status-card (online toggle) + stats grid + readiness checklist + quick actions
driver/Такси·ИП — placeholder pane
driver/Документы — placeholder pane
driver/Выплаты  — placeholder pane
driver/Безопасность — placeholder pane
```

### State contract

Fields read from `bazardrive.user.v1` (localStorage):

```text
onboarded, role, firstName, lastName, displayName
phone, vehicleMake, vehicleModel, vehiclePlate, vehicleColor, vehicleBody
driverOnline          boolean  — persisted on toggle
notificationsEnabled  boolean  — persisted on toggle
```

### Tab structure

```text
Обзор        — full dashboard (default active)
Такси·ИП     — placeholder stub
Документы    — placeholder stub
Выплаты      — placeholder stub
Безопасность — placeholder stub
```

### Readiness checklist items

```text
1. Телефон подтверждён   — done: !!u.phone
2. Данные автомобиля     — done: !!(u.vehicleMake && u.vehicleModel)
3. Госномер              — done: !!u.vehiclePlate
4. Документы и ОСАГО     — done: false (stub — document upload not implemented)
5. Разрешение такси      — done: false (stub — permit verification not implemented)
```

### Status-card ready state

The status card ready state is **not** gated on all 5 checklist items.
Items 4 and 5 are permanent stubs and must not block the ready state.

Ready state logic uses `canShowReadyStatus(u)`:

```text
ready = u.phone && u.vehicleMake && u.vehicleModel && u.vehiclePlate && u.driverOnline
```

Status card subtitles:
```text
ready            → "Все требования выполнены"
action, base ok  → "Можно проверить готовность и документы перед сменой"
action, missing  → "Заполните телефон, автомобиль и госномер"
```

The readiness checklist still shows 5 items and tracks progress (e.g. 3/5),
but its `allDone` value does not control the status card.

### CSS

All styles added to `public/styles/cloud.css` under section `BD-PROFILE-02`.
CSS prefix: `pf2-*`. No inline styles, no `style=` attributes. Toggle driven entirely
by `input:checked + .pf2-toggle__track` adjacent-sibling selector. Progress bar fill
driven by discrete `data-done` attribute selectors (no inline width).

### Acceptance checklist

- [ ] `/profile` renders driver dashboard for `role === 'driver'` and `onboarded === true`
- [ ] 5 tabs render in horizontal scroll row; Обзор active by default
- [ ] Tab switch shows correct pane, hides others; non-Обзор tabs show placeholder
- [ ] Hero shows gradient avatar with initials, name, ★4.8, car make+model, edit button
- [ ] Status card shows "Готов принимать заказы" when phone+car+plate are set and driverOnline is true
- [ ] Status card shows "Нужно действие" with accurate subtitle when base fields are missing or driver is offline
- [ ] Online toggle persists `driverOnline` to localStorage; syncCardState() updates card without style mutations
- [ ] Stats grid shows 3 columns (earnings / trips / replies)
- [ ] Readiness card shows progress bar driven by `data-done` attribute; 5-item checklist
- [ ] Done checklist items have strikethrough label and green icon; pending items show outline icon
- [ ] "Заполнить анкету" CTA scrolls to readiness card
- [ ] Quick actions section renders 4 rows including danger "Выйти"
- [ ] "Выйти" requires second click to confirm (dataset.confirm='pending'); label changes to "Подтвердить выход" on first click
- [ ] Reset calls `user.reset()` and redirects to `/welcome`
- [ ] Guest and Passenger views unchanged from BD-PROFILE-01
- [ ] No inline `<script>` / `<style>` / `on*=` / `style=` attributes
- [ ] No `.style.<property>` assignments in JS
- [ ] `node scripts/check.mjs` passes

### Out of scope for BD-PROFILE-02

```text
Real earnings / trip counts from backend
Document upload / photo avatar
Taxi permit verification
Payments / wallet integration
Real-time map / active ride
Non-Обзор tab implementations
```

## BD-CONFIRM-01 — TripConfirmationHandoff

### Identity

```text
Screen:        TripConfirmationHandoff — render gate
Route:         /trip-confirmation
File:          public/src/screens/trip_confirmation.js
Data source:   URL query (?role, ?tripId, ?state) — no localStorage write
Design ref:    Cloud Design — BD-CONFIRM-01 (5 frames)
Parent issue:  #19
Working issue: #123
Branch:        feature/trip-confirmation-handoff
```

### Purpose

Временный мост между чатом/откликом и активной поездкой. Закрывает
зазор в lifecycle между `respond` (отклик отправлен) и `/active-ride`
(`DRIVER_EN_ROUTE`). Финального дизайна в Cloud Design ещё нет, поэтому
экран реализован как render gate без backend, без Mapbox, без push,
без платежей и без real-time таймеров (countdown — pure UI mock).

### Cloud Design render/frame gate

Design section: **BD-CONFIRM-01 · TripConfirmationHandoff**

Frames used as visual reference:

```text
1 · Passenger confirmation pending  → state=PASSENGER_PENDING
2 · Driver waiting for passenger    → state=DRIVER_WAITING
3 · Trip confirmed · passenger      → state=PASSENGER_CONFIRMED
4 · Trip confirmed · driver         → state=DRIVER_CONFIRMED
5 · Error / expired confirmation    → state=EXPIRED
```

### Route contract

```text
Path:          /trip-confirmation
Query:
  role     'passenger' | 'driver'   default: 'passenger'
  tripId   string                    default: '48-321' (mock demo id)
  state    PASSENGER_PENDING | DRIVER_WAITING |
           PASSENGER_CONFIRMED | DRIVER_CONFIRMED | EXPIRED
           default: role=driver → DRIVER_WAITING,
                    otherwise   → PASSENGER_PENDING
Chrome:        hidden (added to HIDE_CHROME in router.js)
```

### UI states

```text
PASSENGER_PENDING    — водитель готов выехать, пассажир подтверждает поездку
DRIVER_WAITING       — отклик отправлен, ждём подтверждение пассажира
                       (countdown 0:60 → 0:00, прогресс-бар pure CSS animation)
PASSENGER_CONFIRMED  — поездка подтверждена, CTA «Открыть поездку»
DRIVER_CONFIRMED     — поездка подтверждена, CTA «Ехать к пассажиру»
EXPIRED              — ссылка устарела / другая сторона отменила, summary-card
```

### Actions

```text
PASSENGER_PENDING    «Подтвердить поездку» →
                     /trip-confirmation?role=passenger&tripId=<id>&state=PASSENGER_CONFIRMED
                     «Вернуться в чат»     → /chat
PASSENGER_CONFIRMED  «Открыть поездку»     →
                     /active-ride?role=passenger&tripId=<id>&status=DRIVER_EN_ROUTE
DRIVER_WAITING       «Открыть чат»         → /chat
                     «Отменить отклик»     → /feed
DRIVER_CONFIRMED     «Ехать к пассажиру»   →
                     /active-ride?role=driver&tripId=<id>&status=DRIVER_EN_ROUTE
                     «Открыть чат»         → /chat
EXPIRED              «Вернуться в ленту»   → /feed
                     «Открыть чат»         → /chat
Back button          → /chat (passenger states) | /feed (driver states)
```

### CSS additions

All styles added to `public/styles/cloud.css` under section `BD-CONFIRM-01`.
CSS namespace: `cf-*` and `.screen--trip-confirmation`. No inline styles,
no `style=` attributes, no `.style.<property>` assignments in JS.

```text
cf-countdown            font-variant-numeric: tabular-nums (цифры не дёргаются)
cf-confirmed-ring       чистый CSS animation, pointer-events: none — не блокирует CTA
cf-progress-fill        @keyframes cf-progress-deplete 60s linear forwards
cf-state-<state>        root class hook per state for debugging/audit
```

### A11y / hygiene

```text
cf-pill              role="status"
cf-countdown         aria-live="polite" added only when remaining ≤ 5s
                     (no announcements during the full 60s window)
cf-progress          role="progressbar" + aria-valuemin/aria-valuemax
cf-back / cf-shield  aria-label
hero icons           aria-hidden="true"
```

### Mock / stub

```text
Trip id              '48-321' (demo)
Passenger            Анна М. · @anna_m · ★4,86 · 87 поездок · оплата картой · 4417
Driver               Рустам К. · ★4,92 · Toyota Camry · серый · A 124 ВВ ·
                     1 248 поездок · 4 года на платформе
Route                ул. Малая Бронная, 28 → Аэропорт Шереметьево, терминал B
Meta                 1 540 ₽ · 4 мин подача · 38 км · 42 мин в пути
Sent / Expired       14:04 / 14:21 · 7 мин назад
Countdown            60 → 0, текст обновляется через setTimeout + textContent
                     (нет real-time auto-cancel, нет setInterval-driven state machine)
```

### Acceptance checklist

- [ ] `/trip-confirmation` открывается через hash-роутер
- [ ] Chrome (tabbar) скрыт на этом экране
- [ ] `?state=PASSENGER_PENDING` рендерит экран 1 (CTA «Подтвердить поездку»)
- [ ] `?state=DRIVER_WAITING` рендерит экран 2 (countdown + progress bar)
- [ ] `?state=PASSENGER_CONFIRMED` рендерит экран 3 (зелёная галочка + ring)
- [ ] `?state=DRIVER_CONFIRMED` рендерит экран 4 (зелёная галочка + ring)
- [ ] `?state=EXPIRED` рендерит экран 5 (error summary-card)
- [ ] Без `?state`: passenger → PASSENGER_PENDING, driver → DRIVER_WAITING
- [ ] CTA passenger confirmed →
      `/active-ride?role=passenger&tripId=<id>&status=DRIVER_EN_ROUTE`
- [ ] CTA driver confirmed →
      `/active-ride?role=driver&tripId=<id>&status=DRIVER_EN_ROUTE`
- [ ] Countdown в DRIVER_WAITING тикает 60→0 через textContent (без `.style`)
- [ ] Прогресс-бар DRIVER_WAITING — CSS animation, без inline styles
- [ ] `cf-confirmed-ring` не блокирует тап по CTA (pointer-events: none)
- [ ] `public/sw.js` precache содержит `./src/screens/trip_confirmation.js`
- [ ] Нет inline `<script>` / `<style>` / `on*=` / `style=` атрибутов
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-CONFIRM-01

```text
Real-time backend (WebSocket / push)
Real auto-cancel after countdown expiry
Mapbox / route geometry
Payment hold / capture
Push notification of confirmation
Phone call between parties
Driver / passenger state machine outside this bridge
```

## Planned minimum screens

These screens are tracked by #19 and should receive their own render/frame and contract before implementation:

```text
BD-MAP-01 — MapHome foundation
BD-MAP-02 — LocationPermission
BD-MAP-03 — RoutePicker
BD-MAP-04 — RoutePreview
BD-MAP-05 — OrderMapDraft
BD-DRIVER-01 — DriverMap
BD-RIDE-01 — ActiveRide
```
