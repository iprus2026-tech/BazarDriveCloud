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

## BD-PROFILE-01 — Profile V2 (universal, legacy umbrella)

> **Note.** Это исходный «общий» контракт Profile V2 (guest / passenger /
> driver вариации в одном файле). Он сохранён ради истории. Более детальные
> контракты позже разделили роли:
>
> - Passenger: см. **BD-PROFILE-01 Profile V2 — Passenger** ниже в этом
>   файле.
> - Driver: см. **BD-PROFILE-02 — Driver Dashboard Profile** ниже в этом
>   файле.
>
> Анкоры обеих секций различаются и не конфликтуют. При расхождении
> приоритет имеют BD-PROFILE-01 Passenger и BD-PROFILE-02 Driver.

### Identity

```text
Screen:       Profile V2 (universal)
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

## BD-RULES-01 — Rules

### Identity

```text
Screen:       Rules V2 — community rules + safety block
Route:        /rules
File:         public/src/screens/rules.js
Data source:  in-file `RULES` constant (no localStorage, no network)
Design ref:   Cloud Design — Rules V2
Parent issue: #28 (BD-RULES-01 Rules V2 render sync)
```

### Purpose

Статический экран правил сообщества. Гость может открыть его без
onboarding (см. router welcome-gate). Ничего не пишет в `localStorage`,
ничего не читает из `state.js` — чистый рендер.

### Layout

```text
1. bd-topbar         — title «Правила» + subtitle «Сообщество и безопасность»
2. intro card        — bd-card + badges «Сообщество» / «Безопасность»
3. section header    — «Правила сообщества» + счётчик
4. rules list        — карточки с номером, заголовком, описанием, tone-варианты
5. safety card       — info-блок про уважение, безопасность, мошенничество
6. CTA               — «Вернуться в ленту» → /feed
```

### UI states

```text
list      — массив RULES (>=1) → intro + список + safety + CTA
empty     — пустой массив RULES → bd-empty с CTA «Вернуться в ленту»
```

### Data

```text
const RULES = [
  { title, text, tone: 'default' | 'warning' | 'success' | 'danger' },
  ...
]
```

### Actions

```text
Bottom tabbar           → переходы /feed / /rules / /profile
data-go="/feed"         → router.go('/feed')   (safety CTA, empty CTA)
```

### Acceptance checklist

- [ ] `/rules` открывается через hash-роутер
- [ ] Bottom navigation подсвечивает «Правила» на `/rules`
- [ ] Список отрисовывается из `RULES` через `escapeHtml`
- [ ] Empty-состояние рендерится, если `RULES` пустой
- [ ] Кнопка «Вернуться в ленту» уходит на `/feed`
- [ ] Гость может открыть `/rules` без onboarding
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RULES-01

```text
Per-rule navigation, anchors, deep-linking
Real moderation / report submission backend
Editing rules from the client
Remote rules feed / CMS
```

## BD-RESPOND-01 — Respond

### Identity

```text
Screen:        Respond — водитель отвечает на passenger-заявку
Route:         /respond (опционально `?postId=…`)
File:          public/src/screens/respond.js
Data source:   `bazardrive.respond.v1` (localStorage) + mock request
Parent issue:  #19
```

### Purpose

Форма отклика водителя на passenger-заявку из ленты. Формирует mock
response с ценой, временем подачи и комментарием. Не отправляет ничего
в сеть — кладёт объект в `localStorage` и в дальнейшем виден пассажиру
через `/responses` (mock).

### Route contract

```text
Path:          /respond
Query:
  postId   string  default 'trip_anna_vnukovo_park_pobedy' (mock request id)
Chrome:        visible
```

### State / data contract

```text
Reads:    bazardrive.user.v1 — vehicleMake/vehicleModel/vehiclePlate/...
Writes:   bazardrive.respond.v1 — последний созданный response
Mock:     MOCK_REQUEST (in-file)         — карточка пассажирской заявки
          PRICE_CHIPS [1300, 1500, 1800] — варианты цены
          TIMING_OPTIONS                  — at_time | earlier | negotiate
          MAX_MSG = 300                   — лимит длины сообщения
```

### UI states

```text
form              — выбор цены / timing / комментария / авто
no-vehicle hint   — если у пользователя нет vehicleMake/Model/Plate
                    в `bazardrive.user.v1`, показывается подсказка
                    «добавьте авто в профиле»
submitting        — кнопка disabled пока response сохраняется
sent              — экран успеха с галочкой и CTA «Открыть чат»
                    (переход на /chat?responseId=<id>)
```

### Actions

```text
back            → /feed
choose price    → выбирается чип, фиксируется значение
choose timing   → at_time | earlier | negotiate
type message    → лимит MAX_MSG; ошибка на превышении
submit          → saveResponse() → переход в sent-состояние
open chat       → /chat?responseId=<id>
```

### Acceptance checklist

- [ ] `/respond` открывается через hash-роутер
- [ ] `?postId=` корректно подменяет id отклика
- [ ] Цена выбирается из чипов; кнопка submit активна только при валидном выборе
- [ ] Сообщение по умолчанию подставляется из vehicle (если есть)
- [ ] При превышении `MAX_MSG` показывается ошибка
- [ ] Submit сохраняет response в `bazardrive.respond.v1`
- [ ] После submit виден success-state с CTA «Открыть чат»
- [ ] CTA «Открыть чат» → `/chat?responseId=<id>`
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RESPOND-01

```text
Backend / real response submission
Real route geometry / pickup detection
Push to passenger
Payment hold / capture
```

## BD-RESPOND-02 — Context-aware Respond

### Identity

```text
Screen:        Respond — контекстный экран по типу публикации
Route:         /respond?postId=<id>
File:          public/src/screens/respond.js
Data source:   Feed V2 posts (`listFeedPosts()` из `../mock_api.js`)
               + `bazardrive.respond.v1` (localStorage)
Parent issue:  #155
```

### Purpose

После BD-POST-02 страница деталей публикации (`/post?id=<id>`)
показывает разные CTA в зависимости от типа поста. До BD-RESPOND-02
любой клик «Откликнуться / Написать продавцу» приводил на
исходный ride-oriented экран Анны М. (smoke-bug: `/respond?postId=mkt-1`
показывал mock пассажирской заявки вместо контекста продавца).

BD-RESPOND-02 разводит экран Respond на 4 ветки по `post.type`
без изменения роутера и backend:

```text
trip + passenger=true        → ride-response form (Анна М. → Реальный пассажир)
marketplace                  → seller message form (Нурлан / товар)
trip + passenger !== true    → redirect → /chat?tripId=<id>
announcement | system        → readonly fallback («отклик недоступен»)
missing / unknown postId     → safe missing state
```

Источник данных всегда — Feed V2 пост по `postId` из hash query
(`#/respond?postId=<id>`). `respond()` теперь async, router уже
умеет `await loader()` (см. `public/src/router.js`).

### Route contract

```text
Path:          /respond
Query:
  postId   string  REQUIRED — id Feed V2 поста
Chrome:        visible
Behavior:
  - postId отсутствует     → missing state
  - postId не найден       → missing state
  - trip non-passenger     → redirect → /chat?tripId=<id> (внутри loader)
  - announcement / system  → readonly fallback
  - marketplace            → seller message form
  - trip + passenger=true  → ride-response form
```

### Variant: passenger request (trip + passenger=true)

```text
Example:       /respond?postId=trip-2
Title:         «Ответ на заявку»
Passenger:     post.author / initial(author) / "Пассажир" [· ★ rating]
               rating парсится из post.role (например «Пассажир · ★ 4.86»)
Route:         post.from → post.to (если нет — «—»)
When:          post.when (или «Время не указано»)
Initial price: numeric(post.price) || 1500 (DEFAULT_PASSENGER_PRICE)
Price chips:   [1300, 1500, 1800]
Price hint:    «Пассажир предлагает <post.price>» (если задано)
Timing chips:  at_time | earlier | negotiate
Vehicle card:  как в BD-RESPOND-01 (с fallback «Автомобиль не добавлен»)
Submit:        «Отправить отклик»
Stored:        bazardrive.respond.v1 = {
                 kind: 'passenger_response', requestId: post.id,
                 driverPrice, pickupTiming, message, vehicleId, status, createdAt
               }
```

### Variant: marketplace

```text
Example:       /respond?postId=mkt-1
Title:         «Написать продавцу»
Seller card:   post.author (initials) · «Продавец»
               post.title, post.price, post.body, post.tags
Hidden:        Ваша цена, price chips, Когда подать машину,
               vehicle card / Автомобиль не добавлен,
               passenger commission copy
Form:          textarea «Сообщение продавцу»
               placeholder/default: «Здравствуйте! Товар ещё актуален?»
Submit:        «Отправить сообщение»
Stored:        bazardrive.respond.v1 = {
                 kind: 'marketplace_message', requestId: post.id,
                 message, status, createdAt
               }
Success:       «Сообщение отправлено» → «Готово» → /feed
```

### Variant: driver trip (trip + passenger !== true)

```text
Example:       /respond?postId=trip-1
Behavior:      loader сразу делает go(`/chat?tripId=<post.id>`)
               без рендера формы отклика; ride-response не показывается.
```

### Variant: announcement / system

```text
Examples:      /respond?postId=ann-1, /respond?postId=sys-1
Title:         «Отклик недоступен»
Body:          «Для этой публикации отклик недоступен»
Actions:       «Вернуться к публикации» → /post?id=<id>
               «Вернуться в ленту»      → /feed
Form:          не рендерится
```

### Variant: missing / unknown postId

```text
Examples:      /respond (без postId), /respond?postId=does-not-exist
Title:         «Публикация»
Body:          «Публикация не найдена» + «Возможно, объявление было удалено…»
Action:        «Вернуться в ленту» → /feed
```

### Navigation

```text
back / cancel  → /post?id=<post.id> (если post известен), иначе /feed
success «Готово» → /feed (как в BD-RESPOND-01)
```

### Acceptance checklist

- [ ] `/respond?postId=trip-2` рендерит ride-response flow
      на данных Feed V2 поста (Анна М. подставляется из post.author,
      route — из post.from/post.to, when — из post.when)
- [ ] `/respond?postId=mkt-1` показывает seller-context
      (Нурлан, Camry 70 — зимняя резина, 45 000 ₸), а не Анну М.
- [ ] `/respond?postId=mkt-1` скрывает ride-only controls
      (Ваша цена, price chips, Когда подать машину, vehicle card,
      passenger commission copy)
- [ ] `/respond?postId=mkt-1` показывает «Сообщение продавцу»
      и submit «Отправить сообщение»
- [ ] `/respond?postId=trip-1` НЕ рендерит passenger-response form
      (loader делает redirect → `/chat?tripId=trip-1`)
- [ ] `/respond?postId=ann-1` и `/respond?postId=sys-1`
      показывают readonly fallback с двумя кнопками
      («Вернуться к публикации», «Вернуться в ленту»)
- [ ] Missing/unknown postId показывает safe missing state
- [ ] Back, Cancel и success modal работают в поддерживаемых ветках
- [ ] Счётчик символов работает; лимит `MAX_MSG = 300`
- [ ] Футер остаётся mobile-safe (safe-area-inset-bottom)
- [ ] `public/sw.js` поднят до `VERSION = 'v29'`
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен; router / active-ride state machine не модифицируются
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RESPOND-02

```text
Backend / реальная доставка сообщений продавцу или пассажиру
Mapbox / реальная геометрия маршрута
Изменения post_detail.js / feed.js (CTA уже выбран в BD-POST-02)
Изменения active-ride state machine
APK / CSP / router
Push / payment hold
Контракт чата для marketplace
  (на marketplace success нет CTA «Открыть чат» — оставлен только
   «Готово» → /feed; чат-флоу для продавца — отдельный тикет)
```

## BD-RESPONSES-01 — Responses inbox

### Identity

```text
Screen:        Responses — passenger dispatch board for driver offers
Route:         /responses
File:          public/src/screens/responses.js
Data source:   canonical ride order when ?orderId resolves; safe local fallback otherwise; MOCK_DRIVERS for offer cards
Parent issues: #19, #305 / BD-ORDER-P-02
```

### Purpose

Экран после публикации пассажирского заказа. Он закрывает локальный
mock-флоу «Заказ опубликован → Ищем водителей → Отклик водителя →
пассажир выбирает водителя → безопасный handoff в active ride». Backend,
real-time sockets, реальные звонки и Mapbox не подключаются.

### Route contract

```text
Path:          /responses
Query:         ?state=empty          → ожидание откликов, default для bare /responses
               ?state=offer          → один реалистичный отклик водителя
               ?state=list           → 2–3 mock-отклика для сравнения
               ?state=selected       → legacy visual state, сохраняется для старых ссылок
               ?state=all-declined   → legacy declined notice
               ?orderId=<id>         → подтянуть published ride order summary, если есть
               ?driverId=<id>        → legacy selected visual marker
Chrome:        visible
```

### Order summary

Если `?orderId=<id>` находится в `bazardrive.ride_orders.v1`, карточка
показывает pickup → dropoff, цену/бюджет, время и комментарий пассажира.
Если `orderId` отсутствует или неизвестен, экран не падает: рендерится
безопасная fallback-карточка с пассажирским текстом и теми же действиями.

### Mock data shape

```text
MOCK_REQUEST {
  id, orderId, passengerId, status, pickupLabel, dropoffLabel,
  price, numericPrice, note, time, isFallback
}
MOCK_DRIVERS[] {
  id, responseId, name, initials, avatarTone, rating,
  car, carModel, carColor, plate, trips,
  price, priceDelta, priceTone (up | down | same),
  eta, etaBars (1-3), etaTone (good | mid | low),
  note, isBest
}
```

### UI states

```text
empty           — «Ищем водителей», published-order copy, order summary, CTA «Проверить отклики»
offer           — one driver offer card: name/rating/car/ETA/price/message + «Выбрать водителя», «Написать», «Позвонить»
list            — three mock offers for comparison; best offer is highlighted
selected        — legacy visual selected marker for old links
all-declined    — legacy declined notice
```

### Actions

```text
back                  → /feed
На карту / Изменить   → /order-map-draft
Проверить отклики     → /responses?orderId=<id>&state=offer
Написать              → /chat?responseId=<id>&orderId=<id>
Позвонить             → safe toast; no real phone call
Выбрать водителя      → seeds bazardrive.active_ride.v1 with order, passenger, selected driver and vehicle snapshots;
                         navigates to /active-ride?role=passenger&tripId=trip_<orderId>&status=DRIVER_EN_ROUTE
```

### Acceptance checklist

- [ ] `/responses?state=empty` renders safe waiting state.
- [ ] `/responses?orderId=<id>&state=empty` preserves and displays order context when resolvable.
- [ ] Missing/unknown `orderId` renders fallback content, not an error stack.
- [ ] Empty state copy uses passenger-facing language: «Заказ опубликован», «Ищем водителей».
- [ ] `/responses?state=offer` shows a realistic driver offer card.
- [ ] `/responses?state=list` shows multiple mock offers and a highlighted best offer.
- [ ] Choosing a driver preserves selected driver/order/passenger snapshots in active ride handoff.
- [ ] Driver map and driver active ride flows remain unchanged.
- [ ] No visible technical state labels leak into UI.
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`.
- [ ] Нет `.style.<property>` присвоений в JS.
- [ ] CSP не ослаблен.
- [ ] `node scripts/check.mjs` проходит.

### Out of scope for BD-RESPONSES-01 / BD-ORDER-P-02

```text
Backend / реальный список откликов
Real-time sockets / push при новом отклике
Реальные звонки и платежи
Mapbox / реальные ETA
Driver-map accept-flow rewrite
Active ride driver-flow rewrite
Canonical order-status redesign beyond the existing local accept helper
```

## BD-CHAT-01 — Chat

### Identity

```text
Screen:        Chat — переписка по поездке / отклику
Route:         /chat (опциональные `?tripId=…` или `?responseId=…`)
File:          public/src/screens/chat.js
Data source:   `bazardrive.chat.v1` (общий store, формат `{ [chatId]: messages[] }`)
Parent issue:  #19
```

### Purpose

Mock-чат между пассажиром и водителем по конкретной поездке / отклику.
Хранит сообщения локально, без сервера. Используется и из `respond.js`
→ success state, и из `active_ride.js` (driver «Написать пассажиру»),
и автоматически — driver-side вызывает `appendDriverChatMessage` при
«Подъезжаю».

### Route contract

```text
Path:          /chat
Query:
  tripId       string  → chatId = `trip-${tripId}`
  responseId   string  → chatId = `response-${responseId}`
  (если оба отсутствуют, chatId = 'demo')
Chrome:        visible
```

### Storage contract

```text
Key:           bazardrive.chat.v1
Shape:         { [chatId]: Array<{ id, dir: 'in'|'out', text, time }> }
Legacy shape:  { chatId: string, messages: Array<…> }
               — мигрирует в новый формат при первой загрузке
Writers:       chat.js (handleSend), active_ride.js (appendDriverChatMessage)
```

### UI states

```text
mock messages    — если для chatId ничего не сохранено, используется MOCK_MESSAGES
loaded messages  — для chatId есть сохранённый список
quick replies    — 4 готовых ответа (QUICK_REPLIES)
sending          — компоновка input + send-кнопка
```

### Actions

```text
back            → history.back() / fallback /feed
call (mock)     → визуальный stub
attach (mock)   → визуальный stub (plus svg)
quick reply     → подставляет текст в input
send            → push в messages[], persist via saveMessages
```

### Acceptance checklist

- [ ] `/chat` открывается через hash-роутер
- [ ] `?tripId=` и `?responseId=` дают разные `chatId` и независимые истории
- [ ] Сообщения сохраняются в `bazardrive.chat.v1` под текущим chatId
- [ ] Legacy shape `{ chatId, messages }` корректно мигрирует в `{ [chatId]: ... }`
- [ ] `active_ride.js` пишет в тот же ключ без конфликта
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-CHAT-01

```text
Real-time канал (WebSocket / SSE)
Push при новом сообщении
Файлы / медиа / голос
Прочитано / typing indicator от собеседника
```

## BD-RIDE-D — Active ride driver flow

### Identity

```text
Screen group:  Active ride · driver — single multi-state screen
Route:         /active-ride?role=driver[&tripId=…][&status=…]
File:          public/src/screens/active_ride.js
Data source:   `bazardrive.active_ride.v1` (через `ride_state.js`)
               + URL query (?role, ?tripId, ?status)
Design ref:    Cloud Design — section «Активная поездка · водитель»
Parent docs:   docs/active-ride-plan.md §6, §7
```

### Role dispatch contract

```text
Маршрут /active-ride зарегистрирован в app.js один раз, на `activeRide`
из active_ride.js. Внутри `active_ride.js`:

  if (role === 'passenger') return activeRidePassenger(options);

Отдельного маршрута `/active-ride-passenger` НЕТ. Файл
`active_ride_passenger.js` подключается только как импорт из
`active_ride.js`. Контракт passenger-стороны живёт в BD-RIDE-P ниже.
```

### Supported driver states (как рендерит `active_ride.js`)

```text
NEW_ORDER                  — карточка нового заказа, таймер, accept/skip
DRIVER_EN_ROUTE            — еду к пассажиру, навигатор-card, «Я на месте»
WAITING_PASSENGER          — ожидание + таймер бесплатных минут
IN_PROGRESS                — везу пассажира, «Завершить поездку»
COMPLETED                  — earnings summary, рейтинг пассажира
CANCELED / NO_SHOW         — fallback / stub state
```

### Driver simulation overrides (`?status=…`)

`DRIVER_SIMULATION_STATUSES` whitelist в `active_ride.js`. NEW_ORDER —
полноценный reset (если ни один timestamp ещё не записан). Все
остальные значения — view-only override без перезаписи storage, чтобы
back-button / повторное открытие демо-ссылок не ломали реальную
state machine. Rollback past completedAt / canceledAt запрещён.

### Storage contract

```text
Reads/writes:  bazardrive.active_ride.v1 (через `ride_state.js`)
Helpers used:  findActiveRide, getActiveRide, updateActiveRideStatus,
               saveActiveRide, createDemoActiveRide, SIM_AUDIT_RIDE_OVERRIDES
Also writes:   bazardrive.chat.v1 — при действии «Написать «подъезжаю»»
               через `appendDriverChatMessage`
```

### Known gaps (требуют отдельных issues)

```text
BD-RIDE-D-07  Driver cancel sheet  — сейчас `#ar-cancel` показывает только toast
BD-RIDE-D-08  Driver problem sheet — отсутствует
BD-RIDE-D-09  Driver earnings sheet — отсутствует (есть только stat-row)
NO_SHOW flow  — `#ar-no-show` показывает только toast
Navigator     — «Навигатор» / «Карта» → toast «после Mapbox integration»
```

### Acceptance checklist (driver overall)

- [ ] `/active-ride?role=driver` рендерит driver renderer (не passenger)
- [ ] `?status=NEW_ORDER` без существующих timestamps делает reset
- [ ] `?status=DRIVER_EN_ROUTE` view-only override, не переписывает storage
- [ ] «Принять заказ» переводит state → `DRIVER_EN_ROUTE`
- [ ] «Я на месте» переводит state → `WAITING_PASSENGER`
- [ ] «Начать поездку» переводит state → `IN_PROGRESS`
- [ ] «Завершить поездку» переводит state → `COMPLETED`
- [ ] Rollback past completedAt / canceledAt невозможен через `?status=`
- [ ] Driver-side не пишет в storage при view-only override
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RIDE-D

```text
Backend / реальный диспетчер
Real-time pickup detection
Mapbox SDK / реальный навигатор
Платежи / hold карты
Push водителю
```

## BD-RIDE-P — Active ride passenger flow

### Identity

```text
Screen group:  Active ride · passenger — single multi-state screen
Route:         /active-ride?role=passenger[&tripId=…][&status=…]
File:          public/src/screens/active_ride_passenger.js
Mount via:     active_ride.js → activeRidePassenger(options)
Data source:   `bazardrive.active_ride.v1` (через `ride_state.js`)
               + URL query (?role, ?tripId, ?status)
Design ref:    Cloud Design — section «Активная поездка · пассажир»
Parent docs:   docs/active-ride-plan.md §6
```

### Supported passenger states (как рендерит `active_ride_passenger.js`)

```text
DRIVER_EN_ROUTE          — top driver card, ETA до подачи, sheet
WAITING_PASSENGER        — «Водитель ждёт», waiting timer
IN_PROGRESS              — поездка в пути
ARRIVING_DROPOFF         — подъезд к точке назначения
COMPLETED                — оплата + рейтинг + отчёт
CANCELED                 — fallback canceled-screen
```

### Sheets (sub-contracts to be written separately)

```text
BD-RIDE-P-06  PassengerCancelRideSheet — `openPassengerCancelSheet`
BD-RIDE-P-07  PassengerSafetySheet      — `openPassengerSafetySheet`
              Оба уже реализованы в `active_ride_passenger.js`. Контракты
              должны быть оформлены отдельными секциями BD-RIDE-P-06-CONTRACT
              и BD-RIDE-P-07-CONTRACT в этом файле.
```

### Storage contract

```text
Reads/writes:  bazardrive.active_ride.v1 (через `ride_state.js`)
View-only:     рендерер уважает `?status=…` как view-only override, не
               перезаписывая storage без явного действия пользователя
```

### Acceptance checklist (passenger overall)

- [ ] `/active-ride?role=passenger` рендерит passenger renderer
- [ ] Все 5 mock-state корректно отрисовываются по `?status=`
- [ ] Cancel sheet вызывается из passenger UI; close без выбора не пишет в storage
- [ ] Safety sheet открывается / закрывается без побочных эффектов
- [ ] State CANCELED не откатывается обратно через `?status=`
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RIDE-P

```text
Backend / real-time tracking
Mapbox SDK / реальная карта подачи
Реальный платёж / списание
Push пассажиру
Sub-contracts BD-RIDE-P-06 / BD-RIDE-P-07 — отдельные секции
```

## BD-RIDE-P-06-CONTRACT — PassengerCancelRideSheet

### Identity

```text
Sub-screen:    PassengerCancelRideSheet — bottom sheet поверх /active-ride passenger
Route:         /active-ride?role=passenger
File:          public/src/screens/active_ride_passenger.js
Hook:          openPassengerCancelSheet(root, { onConfirm })
Parent:        BD-RIDE-P — Active ride passenger flow
Design ref:    Cloud Design — «Активная поездка · пассажир · отмена»
Parent docs:   docs/active-ride-plan.md §6
```

### Purpose

Bottom sheet, которым пассажир может отменить поездку в активном
state. Контракт фиксирует поведение уже существующей реализации в
`active_ride_passenger.js` и закрывает gap, упомянутый в BD-RIDE-P.

### Entry points

```text
DRIVER_EN_ROUTE              — водитель в пути к точке подачи; en-route
                               sheet рендерит кнопку «Отменить»
                               (`#arp-cancel`), которая открывает
                               cancel sheet
DRIVER_APPROACHING_PICKUP    — alias to DRIVER_EN_ROUTE в passenger
                               renderer; рендерится тем же
                               `renderEnRouteSheet`, поэтому кнопка
                               отмены доступна
```

Sheet монтируется только поверх en-route листа. Точка входа из UI —
кнопка «Отменить» в `renderEnRouteSheet`.

### States WITHOUT cancel entry (negative / manual regression)

```text
WAITING_PASSENGER            — waiting sheet НЕ рендерит `#arp-cancel`;
                               cancel sheet недоступен в этом state
                               (manual regression target)
IN_PROGRESS                  — in-progress sheet НЕ рендерит
                               `#arp-cancel`; cancel sheet недоступен
                               в этом state (manual regression target)
ARRIVING_DROPOFF             — phase IN_PROGRESS; cancel недоступен
COMPLETED / CANCELED         — терминальные state, cancel недоступен
```

Эти state указаны как regression-чек: рендерер не должен внезапно
начать показывать кнопку отмены без отдельного PR. Если в будущем
понадобится cancel из waiting / in-progress — открыть новое issue и
расширить контракт.

### Expected implementation hook

```text
openPassengerCancelSheet(root, { onConfirm })
  root        — DOM-узел экрана /active-ride (passenger renderer)
  onConfirm   — callback, вызывается ТОЛЬКО при явном подтверждении
                отмены пользователем
```

### Required UI

```text
title                        «Отменить поездку?»
reason list                  radiogroup с причинами отмены
confirm cancellation         primary CTA «Подтвердить отмену»,
                             disabled пока не выбрана причина
close / return without cancel
                             secondary CTA «Назад к поездке»
                             + close-кнопка в header
                             + close по backdrop / Escape
safe canceled fallback       рендерер уважает state=CANCELED и
                             показывает canceled-screen без побочных
                             эффектов, если поездка уже отменена
```

### State contract

```text
Storage key:                 bazardrive.active_ride.v1 (через ride_state.js)
Close without reason         НЕ пишет в storage. Закрытие sheet
                             (backdrop / Escape / «Назад к поездке»)
                             не меняет state машины.
Confirm cancellation         может перевести state → CANCELED только
                             через явное действие пользователя
                             (выбор причины + Подтвердить отмену +
                             вторичное подтверждение «Да, отменить»).
?status= override            остаётся view-only. Открытие sheet через
                             симуляционный URL не разрешает переход в
                             CANCELED без явного действия пользователя.
                             Rollback из CANCELED через ?status= по-
                             прежнему запрещён (см. BD-RIDE-P).
```

### Safe stub behavior

```text
No driver notification       статус «передадим водителю» — текстовая
                             заглушка, реального push нет
No backend call              отмена меняет только локальный state
No refund flow               платёж / возврат не вызываются
```

### Manual test URLs

Positive (cancel sheet must be reachable):

```text
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/active-ride?role=passenger&status=DRIVER_APPROACHING_PICKUP
```

Negative regression (cancel sheet/button must NOT appear):

```text
/active-ride?role=passenger&status=WAITING_PASSENGER
/active-ride?role=passenger&status=IN_PROGRESS
/active-ride?role=passenger&status=COMPLETED
/active-ride?role=passenger&status=CANCELED
```

Cross-flow regression (driver flow + feed must stay intact):

```text
/active-ride?role=driver
/feed
```

### Acceptance checklist

- [ ] Контракт оформлен отдельной секцией BD-RIDE-P-06-CONTRACT
- [ ] Entry points ограничены en-route: DRIVER_EN_ROUTE и
      DRIVER_APPROACHING_PICKUP — перечислены явно
- [ ] WAITING_PASSENGER, IN_PROGRESS, ARRIVING_DROPOFF, COMPLETED,
      CANCELED перечислены как negative regression — cancel
      sheet/button НЕ должен появляться
- [ ] Реализация повешена на `openPassengerCancelSheet`
- [ ] Кнопка `#arp-cancel` рендерится только в `renderEnRouteSheet`
- [ ] Click handler на `#arp-cancel` навешан только в en-route ветке
      passenger renderer
- [ ] Required UI: title + reason list + confirm + close/return +
      safe canceled fallback
- [ ] Close без выбора причины не пишет в `bazardrive.active_ride.v1`
- [ ] Confirm переводит state → CANCELED только через явное действие
- [ ] `?status=` override остаётся view-only
- [ ] Safe stub behavior зафиксирован: без backend, без real Mapbox,
      без real support call, без payment refund
- [ ] Driver flow (BD-RIDE-D) не изменён
- [ ] Manual test URLs перечислены (positive + negative regression)
- [ ] Раздел Documentation hygiene invariant ссылается на этот
      контракт (см. конец файла)
- [ ] Нет изменений в `public/src/screens/active_ride_passenger.js`
- [ ] Нет изменений в `public/styles/cloud.css`
- [ ] Нет изменений в `public/sw.js` / CSP
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RIDE-P-06-CONTRACT

```text
Backend / real cancel API
Real Mapbox / геометрия маршрута до отмены
Real support call / телефонный звонок
Payment refund / возврат средств
Push водителю
Реализация sheet (sheet уже существует — это только контракт)
Изменение driver active ride flow (BD-RIDE-D)
```

## BD-RIDE-P-07-CONTRACT — PassengerSafetySheet

### Identity

```text
Sub-screen:    PassengerSafetySheet — bottom sheet поверх /active-ride passenger
Route:         /active-ride?role=passenger
File:          public/src/screens/active_ride_passenger.js
Hook:          openPassengerSafetySheet(root, { toast })
Parent:        BD-RIDE-P — Active ride passenger flow
Design ref:    Cloud Design — «Активная поездка · пассажир · безопасность»
Parent docs:   docs/active-ride-plan.md §6
```

### Purpose

Bottom sheet «Центр безопасности» для пассажира в активной поездке.
Контракт фиксирует поведение уже существующей реализации в
`active_ride_passenger.js` и закрывает gap, упомянутый в BD-RIDE-P.

### Entry points

```text
DRIVER_EN_ROUTE        — водитель в пути к точке подачи
WAITING_PASSENGER      — водитель ждёт пассажира
IN_PROGRESS            — поездка в пути
ARRIVING_DROPOFF       — phase IN_PROGRESS; safety sheet остаётся
                         доступен через те же триггеры
COMPLETED              — экран завершения / рейтинга; safety sheet
                         доступен через top-card shield
```

Sheet монтируется поверх любого из этих passenger-state. Точки входа
из UI:

```text
#arp-sos          — кнопка SOS внутри passenger ride sheet
                    (en-route / waiting / in-progress / arriving-dropoff)
#arp-shield       — top-card shield-кнопка; также присутствует на
                    completed rating screen и открывает тот же sheet
```

### Expected implementation hook

```text
openPassengerSafetySheet(root, { toast })
  root        — DOM-узел экрана /active-ride (passenger renderer)
  toast       — функция-уведомление, используется для безопасных
                заглушек (SOS / Support / Share / Trusted contacts)
```

### Required UI

```text
SOS                  крупная SOS-плитка с явным «пока без реального вызова»
Share ride           строка «Поделиться поездкой»
Trusted contacts     строка «Доверенные контакты»
Support              строка «Связаться с поддержкой»
Help                 строка «Помощь / FAQ»
Close                close-кнопка в header + кнопка «Закрыть» внизу
                     + close по backdrop / Escape
```

### Safe stub behavior

```text
SOS                  тайл видим, нажатие переключает aria-pressed и
                     показывает toast; реального экстренного вызова нет
Support call         строка видима, нажатие показывает toast;
                     реального телефонного звонка нет
Share ride           mock / placeholder через toast, пока не появится
                     отдельный share flow
Trusted contacts     mock / placeholder через toast, пока нет
                     реального CRUD списка контактов
Help                 placeholder через toast
Close                возвращает к текущему ride state без записи в
                     `bazardrive.active_ride.v1` и без других storage
                     changes
```

### State contract

```text
Storage key:                 bazardrive.active_ride.v1 (через ride_state.js)
Open / close                 НЕ пишет в storage
Any safety action            НЕ пишет в `bazardrive.active_ride.v1`,
                             НЕ переводит state машину
?status= override            остаётся view-only. Sheet поверх симул-
                             URL не меняет state.
```

### Manual test URLs

Positive (safety sheet must be reachable):

```text
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/active-ride?role=passenger&status=WAITING_PASSENGER
/active-ride?role=passenger&status=IN_PROGRESS
/active-ride?role=passenger&status=IN_PROGRESS&phase=ARRIVING_DROPOFF
/active-ride?role=passenger&status=COMPLETED
```

Fallback (no active safety sheet expected):

```text
/active-ride?role=passenger&status=CANCELED
```

Cross-flow regression (driver flow + feed must stay intact):

```text
/active-ride?role=driver
/feed
```

### Acceptance checklist

- [ ] Контракт оформлен отдельной секцией BD-RIDE-P-07-CONTRACT
- [ ] Entry points DRIVER_EN_ROUTE / WAITING_PASSENGER / IN_PROGRESS /
      ARRIVING_DROPOFF / COMPLETED перечислены явно
- [ ] Триггеры зафиксированы: `#arp-sos` внутри ride sheets и
      `#arp-shield` top-card / completed screen
- [ ] Реализация повешена на `openPassengerSafetySheet`
- [ ] Required UI: SOS + Share ride + Trusted contacts + Support +
      Help + Close
- [ ] Safe stub behavior зафиксирован для каждого пункта
- [ ] Close возвращает к текущему ride state без storage changes
- [ ] Open / close / любое действие не пишут в
      `bazardrive.active_ride.v1`
- [ ] `?status=` override остаётся view-only
- [ ] Constraints зафиксированы: без backend, без push, без реальной
      emergency-интеграции, без реального телефонного звонка, без
      Mapbox
- [ ] Driver flow (BD-RIDE-D) не изменён
- [ ] Manual test URLs перечислены
- [ ] Раздел Documentation hygiene invariant ссылается на этот
      контракт (см. конец файла)
- [ ] Нет изменений в `public/src/screens/active_ride_passenger.js`
- [ ] Нет изменений в `public/styles/cloud.css`
- [ ] Нет изменений в `public/sw.js` / CSP
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-RIDE-P-07-CONTRACT

```text
Backend / real safety incidents API
Push при SOS
Real emergency integration (112 / экстренные службы)
Реальный телефонный звонок в поддержку
Mapbox / share ride с реальной геометрией
Реальный CRUD доверенных контактов
Реализация sheet (sheet уже существует — это только контракт)
Изменение driver active ride flow (BD-RIDE-D)
```

## BD-RIDE-D-07 — DriverCancelRideSheet

### Identity

```text
Sub-screen:    DriverCancelRideSheet — bottom sheet поверх /active-ride driver
Route:         /active-ride?role=driver
File:          public/src/screens/active_ride.js
Hook:          openDriverCancelSheet(root, { onConfirm })  (планируется в PR 4)
Parent:        BD-RIDE-D — Active ride driver flow
Design ref:    Cloud Design — «Активная поездка · водитель · отмена»
Parent docs:   docs/active-ride-plan.md §6, §7
                docs/project-health-audit.md §PR 3
```

### Purpose

Bottom sheet, которым водитель может отменить уже принятый заказ до
начала поездки. Контракт фиксирует поведение, которое должно прийти на
смену текущей toast-заглушке `#ar-cancel` (см. `renderEnRoute` в
`active_ride.js`, строка 506). Сейчас кнопка «Отменить» показывает
`showNotice('Отмена поездки будет реализована позже')` — это
временная заглушка, которая в PR 4 будет заменена на реальный sheet.

### Entry points

```text
DRIVER_EN_ROUTE              — водитель уже принял заказ и едет к
                               точке подачи; en-route sheet рендерит
                               кнопку «Отменить» (`#ar-cancel`),
                               которая открывает cancel sheet
DRIVER_APPROACHING_PICKUP    — alias к DRIVER_EN_ROUTE в driver
                               renderer; рендерится той же веткой
                               (см. `renderSheet()` switch в
                               `active_ride.js`)
```

Sheet монтируется только поверх en-route листа driver renderer. Точка
входа из UI — кнопка «Отменить» в `renderEnRoute` (id `#ar-cancel`).

### States WITHOUT cancel entry (negative / manual regression)

```text
NEW_ORDER                    — карточка нового заказа; кнопка
                               «Отменить» не рендерится (есть только
                               «Принять» / «Пропустить»)
WAITING_PASSENGER            — waiting sheet НЕ рендерит `#ar-cancel`;
                               для этого state работает `#ar-no-show`,
                               который покрывается BD-RIDE-D-08
IN_PROGRESS                  — in-progress sheet НЕ рендерит
                               `#ar-cancel`; после старта поездки
                               driver-инициированная отмена недоступна
                               (manual regression target)
COMPLETED                    — терминальный state, cancel недоступен
CANCELED / NO_SHOW           — терминальный fallback, cancel недоступен
```

Эти state указаны как regression-чек: рендерер не должен внезапно
начать показывать кнопку отмены в WAITING / IN_PROGRESS без отдельного
PR. Если в будущем понадобится driver-cancel из waiting / in-progress
— открыть новое issue и расширить контракт.

### UI states

```text
default                      sheet открыт, причина не выбрана,
                             «Подтвердить отмену» disabled
reason selected              выбрана одна причина (radiogroup),
                             primary CTA становится enabled
confirm pending              после первого «Подтвердить отмену» —
                             вторичное подтверждение «Вы уверены?»
                             (двух-шаговое подтверждение, как у
                             passenger cancel sheet)
canceled fallback            sheet закрывается, рендерер уважает
                             state=CANCELED и показывает
                             `renderCanceledStub` без побочных эффектов
```

### Data contract

```text
Storage key:                 bazardrive.active_ride.v1 (через ride_state.js)
Reads:                       getActiveRide(tripId) — текущая запись
                             поездки (passenger, route, order)
Writes (only on confirm):    updateActiveRideStatus(tripId,
                             RIDE_STATUS.CANCELED) — переводит
                             state машину в CANCELED;
                             `canceledAt` ставится из таблицы
                             RIDE_STATUS_TIMESTAMP_FIELD в
                             `ride_state.js`
Cancel reason storage:       mock-only внутри `active_ride.js` (или
                             в локальном модуле). НЕ расширяет схему
                             `ride_state.js` в этом PR
                             (см. «Storage schema decision» ниже)
Close without confirm:       НЕ пишет в storage; sheet закрывается
                             без изменения state машины
?status= override:           остаётся view-only. Открытие cancel sheet
                             через симул-URL не разрешает переход в
                             CANCELED без явного действия пользователя.
                             Rollback из CANCELED через ?status= по-
                             прежнему запрещён (см. BD-RIDE-D)
```

Минимальный список причин (radiogroup, mock-only):

```text
Пассажир не выходит на связь
Пассажир далеко / не успеваю
Адрес недоступен / закрытая территория
Проблема с автомобилем
Другое
```

### Actions

```text
select reason                radiogroup, single-select; enable primary CTA
confirm cancellation         primary CTA «Подтвердить отмену» →
                             вторичное подтверждение «Да, отменить» →
                             updateActiveRideStatus(…CANCELED) →
                             renderSheet() рендерит canceled stub
close / return without cancel
                             secondary CTA «Назад к поездке»
                             + close-кнопка в header
                             + close по backdrop / Escape
                             → НЕ меняет state машины
```

### A11y / hygiene

```text
- role="dialog" + aria-modal="true" + aria-labelledby на title
- radiogroup имеет aria-label «Причина отмены»
- focus trap внутри sheet пока он открыт
- Escape / backdrop закрывают sheet
- close-кнопка имеет видимый aria-label «Закрыть»
- primary CTA disabled, пока не выбрана причина
- Нет inline <script> / <style> / style="" / on*=
- Нет .style.<property> присвоений в JS
- Нет .setAttribute('style', …) в JS
- Нет style="…" в шаблонных строках JS
- CSP не ослаблен
- Service Worker не кеширует public/prototypes/
```

### Acceptance checklist

- [ ] Контракт оформлен отдельной секцией BD-RIDE-D-07
- [ ] Entry points ограничены en-route: DRIVER_EN_ROUTE и
      DRIVER_APPROACHING_PICKUP — перечислены явно
- [ ] NEW_ORDER, WAITING_PASSENGER, IN_PROGRESS, COMPLETED,
      CANCELED, NO_SHOW перечислены как negative regression —
      cancel sheet/button НЕ должен появляться
- [ ] Реализация повешена на `openDriverCancelSheet`
- [ ] Кнопка `#ar-cancel` рендерится только в `renderEnRoute`
- [ ] Click handler на `#ar-cancel` навешан только в en-route ветке
      driver renderer
- [ ] UI states: default / reason selected / confirm pending /
      canceled fallback — перечислены
- [ ] Close без выбора причины не пишет в `bazardrive.active_ride.v1`
- [ ] Confirm переводит state → CANCELED через
      `updateActiveRideStatus(tripId, RIDE_STATUS.CANCELED)`
- [ ] `?status=` override остаётся view-only
- [ ] Cancel reason mock-only, НЕ расширяет `ride_state.js`
      (см. Storage schema decision)
- [ ] Safe stub behavior зафиксирован: без backend, без push
      пассажиру, без real cancel API, без payment refund
- [ ] Passenger flow (BD-RIDE-P) не изменён
- [ ] Manual test URLs перечислены (positive + negative regression)
- [ ] Раздел Documentation hygiene invariant покрывает этот
      контракт (см. конец файла)
- [ ] Нет изменений в `public/src/screens/active_ride_passenger.js`
      в рамках этого contract PR
- [ ] Нет изменений в `public/src/ride_state.js` в рамках этого
      contract PR
- [ ] Нет изменений в `public/styles/cloud.css` в рамках этого
      contract PR
- [ ] Нет изменений в `public/sw.js` / CSP в рамках этого
      contract PR
- [ ] `node scripts/check.mjs` проходит

### Manual test URLs

Positive (cancel sheet must be reachable in PR 4 impl):

```text
/active-ride?role=driver&status=DRIVER_EN_ROUTE
```

Negative regression (cancel sheet/button must NOT appear):

```text
/active-ride?role=driver&status=WAITING_PASSENGER
/active-ride?role=driver&status=IN_PROGRESS
/active-ride?role=driver&status=COMPLETED
/active-ride?role=driver&status=CANCELED
/active-ride?role=driver&status=NO_SHOW
```

Cross-flow regression (passenger flow + feed must stay intact):

```text
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/feed
```

### Out of scope for BD-RIDE-D-07

```text
Backend / real cancel API
Real penalty / штраф водителю
Push пассажиру при отмене
Real Mapbox / геометрия маршрута до отмены
Payment refund / возврат пассажиру
Реализация sheet (это PR 4)
Расширение схемы `ride_state.js` (см. Storage schema decision)
Изменение passenger active ride flow (BD-RIDE-P)
NO_SHOW flow (покрывается BD-RIDE-D-08)
```

## BD-RIDE-D-08 — DriverProblemSheet

### Identity

```text
Sub-screen:    DriverProblemSheet — bottom sheet поверх /active-ride driver
Route:         /active-ride?role=driver
File:          public/src/screens/active_ride.js
Hook:          openDriverProblemSheet(root, { type, onResolve })
               (планируется в PR 4)
Parent:        BD-RIDE-D — Active ride driver flow
Design ref:    Cloud Design — «Активная поездка · водитель · проблема»
Parent docs:   docs/active-ride-plan.md §6, §7
                docs/project-health-audit.md §PR 3
```

### Purpose

Bottom sheet, через который водитель сообщает о проблеме в активной
поездке. Контракт покрывает две существующие toast-заглушки в
`active_ride.js`:

```text
#ar-no-show   — `renderWaiting`, строка 577: «Отметка „не приехал“
                будет реализована позже»
#ar-issue     — `renderInProgress`, строка 630: «Раздел помощи
                будет добавлен позже»
```

В PR 4 обе кнопки должны открывать DriverProblemSheet с разной
дефолтной категорией проблемы (см. Problem types ниже).

### Entry points

```text
WAITING_PASSENGER            — waiting sheet рендерит «Не приехал»
                               (`#ar-no-show`); открывает problem sheet
                               с дефолтной категорией
                               «Пассажир не приехал»
IN_PROGRESS                  — in-progress sheet рендерит «Проблема»
                               (`#ar-issue`); открывает problem sheet
                               без преселекта (или с дефолтом «Другое»)
```

Sheet монтируется поверх waiting / in-progress листа driver renderer.
Точки входа из UI — кнопки `#ar-no-show` и `#ar-issue`.

### States WITHOUT problem entry (negative / manual regression)

```text
NEW_ORDER                    — карточка нового заказа; problem sheet
                               недоступен
DRIVER_EN_ROUTE              — en-route sheet НЕ рендерит ни
                               `#ar-no-show`, ни `#ar-issue`; для
                               отмены до подачи работает BD-RIDE-D-07
COMPLETED                    — терминальный state, problem sheet
                               недоступен
CANCELED / NO_SHOW           — терминальный fallback, problem sheet
                               недоступен
```

### Problem types

Список problem-категорий (radiogroup, single-select, mock-only):

```text
PASSENGER_NO_SHOW            «Пассажир не приехал»
                             — дефолт при входе через `#ar-no-show`
                             — после подтверждения переводит state
                               → NO_SHOW
PASSENGER_UNREACHABLE        «Не могу связаться с пассажиром»
                             — state НЕ меняется (показывает toast
                               «передадим в поддержку», заглушка)
ROUTE_ISSUE                  «Проблема с маршрутом / адресом»
                             — state НЕ меняется
CAR_TROUBLE                  «Проблема с автомобилем»
                             — state НЕ меняется
SAFETY_INCIDENT              «Опасная ситуация / конфликт»
                             — state НЕ меняется (показывает toast
                               «связались с поддержкой», заглушка;
                               реального вызова нет)
OTHER                        «Другое»
                             — дефолт при входе через `#ar-issue`
                             — state НЕ меняется
```

Важно: только `PASSENGER_NO_SHOW` переводит state машину
(`RIDE_STATUS.NO_SHOW`). Остальные категории — safe stubs через toast
без записи в storage.

### UI states

```text
default                      sheet открыт, категория не выбрана,
                             primary CTA disabled (если вход без
                             преселекта)
preselected                  при входе через `#ar-no-show` категория
                             PASSENGER_NO_SHOW преселектится; primary
                             CTA enabled
category selected            выбрана одна категория; primary CTA
                             enabled, текст CTA зависит от категории
confirm pending (no-show)    для PASSENGER_NO_SHOW — вторичное
                             подтверждение «Отметить, что пассажир
                             не приехал?» (двух-шаговое подтверждение
                             как у cancel sheet)
toast resolved (other)       для прочих категорий — toast через
                             showNotice / `onResolve` без перехода
                             state машины
no_show fallback             sheet закрывается, рендерер уважает
                             state=NO_SHOW и показывает
                             `renderCanceledStub` без побочных эффектов
```

### Data contract

```text
Storage key:                 bazardrive.active_ride.v1 (через ride_state.js)
Reads:                       getActiveRide(tripId) — текущая запись
Writes (only on no-show confirm):
                             updateActiveRideStatus(tripId,
                             RIDE_STATUS.NO_SHOW) — переводит
                             state машину; `canceledAt` ставится по
                             таблице RIDE_STATUS_TIMESTAMP_FIELD
                             (NO_SHOW использует поле canceledAt)
All other categories:        НЕ пишут в storage; только toast
Problem reason / комментарий:
                             mock-only внутри `active_ride.js`. НЕ
                             расширяет схему `ride_state.js` в этом
                             PR (см. «Storage schema decision»)
Close without confirm:       НЕ пишет в storage; sheet закрывается
                             без изменения state машины
?status= override:           остаётся view-only. Открытие problem
                             sheet через симул-URL не разрешает
                             переход в NO_SHOW без явного действия.
                             Rollback из NO_SHOW через ?status=
                             запрещён (см. BD-RIDE-D)
```

### Actions

```text
select category              radiogroup, single-select; enable primary CTA
confirm no-show              для PASSENGER_NO_SHOW — primary CTA
                             «Отметить» → вторичное подтверждение →
                             updateActiveRideStatus(…NO_SHOW) →
                             renderSheet() рендерит no-show stub
                             через `renderCanceledStub`
send other report            для прочих категорий — primary CTA
                             «Сообщить» / «Связаться с поддержкой» →
                             showNotice (заглушка) → close sheet
close / cancel                secondary CTA «Назад к поездке»
                             + close-кнопка в header
                             + close по backdrop / Escape
                             → НЕ меняет state машины
```

### A11y / hygiene

```text
- role="dialog" + aria-modal="true" + aria-labelledby на title
- radiogroup имеет aria-label «Тип проблемы»
- focus trap внутри sheet пока он открыт
- Escape / backdrop закрывают sheet
- close-кнопка имеет видимый aria-label «Закрыть»
- primary CTA disabled, пока не выбрана категория
  (кроме случая preselected через `#ar-no-show`)
- Текст CTA меняется по категории; aria-описание актуально
- Нет inline <script> / <style> / style="" / on*=
- Нет .style.<property> присвоений в JS
- Нет .setAttribute('style', …) в JS
- Нет style="…" в шаблонных строках JS
- CSP не ослаблен
- Service Worker не кеширует public/prototypes/
```

### Acceptance checklist

- [ ] Контракт оформлен отдельной секцией BD-RIDE-D-08
- [ ] Entry points ограничены: WAITING_PASSENGER через
      `#ar-no-show` и IN_PROGRESS через `#ar-issue`
- [ ] NEW_ORDER, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP,
      COMPLETED, CANCELED, NO_SHOW перечислены как negative
      regression — problem sheet/button НЕ должен появляться
- [ ] Реализация повешена на `openDriverProblemSheet`
- [ ] Кнопка `#ar-no-show` рендерится только в `renderWaiting`
- [ ] Кнопка `#ar-issue` (или `#ar-problem` после rename)
      рендерится только в `renderInProgress`
- [ ] Click handler `#ar-no-show` навешан только в waiting ветке
- [ ] Click handler `#ar-issue` навешан только в in-progress ветке
- [ ] Problem types перечислены явно (6 категорий), включая
      PASSENGER_NO_SHOW как дефолт для `#ar-no-show`
- [ ] Только PASSENGER_NO_SHOW переводит state → NO_SHOW
- [ ] Прочие категории — safe stubs через toast, без записи в
      `bazardrive.active_ride.v1`
- [ ] Close без подтверждения не пишет в storage
- [ ] `?status=` override остаётся view-only
- [ ] Problem reason mock-only, НЕ расширяет `ride_state.js`
      (см. Storage schema decision)
- [ ] Safe stub behavior зафиксирован: без backend, без real
      support call, без real emergency integration, без push
- [ ] Passenger flow (BD-RIDE-P) не изменён
- [ ] Manual test URLs перечислены (positive + negative regression)
- [ ] Раздел Documentation hygiene invariant покрывает этот
      контракт (см. конец файла)
- [ ] Нет изменений в `public/src/screens/active_ride_passenger.js`
      в рамках этого contract PR
- [ ] Нет изменений в `public/src/ride_state.js` в рамках этого
      contract PR
- [ ] Нет изменений в `public/styles/cloud.css` в рамках этого
      contract PR
- [ ] Нет изменений в `public/sw.js` / CSP в рамках этого
      contract PR
- [ ] `node scripts/check.mjs` проходит

### Manual test URLs

Positive (problem sheet must be reachable in PR 4 impl):

```text
/active-ride?role=driver&status=WAITING_PASSENGER
/active-ride?role=driver&status=IN_PROGRESS
```

Negative regression (problem sheet/button must NOT appear):

```text
/active-ride?role=driver&status=DRIVER_EN_ROUTE
/active-ride?role=driver&status=COMPLETED
/active-ride?role=driver&status=CANCELED
/active-ride?role=driver&status=NO_SHOW
```

Cross-flow regression (passenger flow + feed must stay intact):

```text
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/feed
```

### Out of scope for BD-RIDE-D-08

```text
Backend / real support API
Real emergency integration (112 / экстренные службы)
Real phone call / телефонный звонок в поддержку
Real penalty / штраф для PASSENGER_NO_SHOW
Push пассажиру / в поддержку
Real Mapbox / геометрия проблемного участка
Payment refund при NO_SHOW
Реализация sheet (это PR 4)
Расширение схемы `ride_state.js` (см. Storage schema decision)
Изменение passenger active ride flow (BD-RIDE-P)
Driver cancel before pickup (покрывается BD-RIDE-D-07)
```

## BD-RIDE-D-09 — DriverEarningsSheet

### Identity

```text
Sub-screen:    DriverEarningsSheet — bottom sheet поверх /active-ride driver
Route:         /active-ride?role=driver
File:          public/src/screens/active_ride.js
Hook:          openDriverEarningsSheet(root, { onClose })
               (планируется в PR 4)
Parent:        BD-RIDE-D — Active ride driver flow
Design ref:    Cloud Design — «Активная поездка · водитель · доход»
Parent docs:   docs/active-ride-plan.md §6, §7
                docs/project-health-audit.md §PR 3
```

### Purpose

Bottom sheet с детализацией заработка по завершённой поездке.
Расширяет существующий earnings-блок внутри `renderCompleted` (см.
`active_ride.js`, строки 651–700), который сейчас показывает только
inline-карточку «Поездка завершена» с тремя строками breakdown и
shift summary. Контракт фиксирует выделение детального просмотра в
отдельный bottom sheet, который открывается из completion screen
кнопкой «Подробнее» (или эквивалентным CTA, который добавит PR 4).

### Entry point

```text
COMPLETED                    — completion sheet рендерит ссылку
                               «Подробнее о доходе» (`#ar-earnings`,
                               добавляется в PR 4); открывает earnings
                               sheet с детальным breakdown за поездку
                               + смену
```

Sheet монтируется только поверх completion листа driver renderer.
Любая другая driver-state НЕ должна давать точку входа.

### States WITHOUT earnings entry (negative / manual regression)

```text
NEW_ORDER                    — карточка нового заказа; earnings sheet
                               недоступен
DRIVER_EN_ROUTE              — en-route sheet; earnings sheet
                               недоступен
DRIVER_APPROACHING_PICKUP    — alias к DRIVER_EN_ROUTE; недоступен
WAITING_PASSENGER            — waiting sheet; earnings sheet
                               недоступен
IN_PROGRESS                  — in-progress sheet; earnings sheet
                               недоступен (поездка ещё не завершена;
                               итог не зафиксирован)
CANCELED / NO_SHOW           — терминальный fallback без оплаты;
                               earnings sheet недоступен
```

### UI states

```text
default                      sheet открыт, breakdown по текущей
                             завершённой поездке + смена сегодня
breakdown                    блок «Поездка»: gross, commission rate,
                             commission amount, net (та же формула,
                             что в `renderCompleted`)
shift summary                блок «Смена сегодня»: previousToday →
                             nextToday, previousTrips → nextTrips
                             (как уже считается в `renderCompleted`)
closed                       sheet закрыт, completion screen остаётся
                             видимым без побочных эффектов
```

### Data contract

```text
Storage key:                 bazardrive.active_ride.v1 (через ride_state.js)
Reads:                       getActiveRide(tripId) — поля
                             ride.ride.price (gross),
                             ride.order.commission (rate),
                             ride.ride.todayEarnings (shift baseline),
                             ride.ride.tripsToday (shift trip count)
Computations:                gross = parseMoney(ride.ride.price)
                             commissionRate = parsePercent(
                               ride.order.commission)
                             commissionAmount = round(gross *
                               commissionRate)
                             net = gross - commissionAmount
                             nextToday = previousToday + net
                             nextTrips = previousTrips + 1
                             (идентично текущему `renderCompleted`)
Writes:                      sheet НЕ пишет в storage. Открытие /
                             закрытие / любой просмотр не меняют
                             state машины и не модифицируют
                             `bazardrive.active_ride.v1`. Запись
                             shift summary в постоянный earnings
                             history — out of scope (см. ниже)
?status= override:           остаётся view-only. Открытие earnings
                             sheet через симул-URL `?status=COMPLETED`
                             использует моковую `SIM_AUDIT_RIDE_OVERRIDES`
                             demo-ride без записи в storage
```

### Actions

```text
open                         клик «Подробнее о доходе» (`#ar-earnings`)
                             на completion screen → openDriverEarningsSheet
close                        close-кнопка в header
                             + close по backdrop / Escape
                             + secondary CTA «Закрыть» внизу sheet
                             → возвращает к completion screen без
                               побочных эффектов
next order (passthrough)     primary CTA «Следующий заказ» остаётся
                             на completion screen (`#ar-next-order`);
                             earnings sheet ничего не делает с этим
                             потоком (это passthrough, не CTA sheet)
```

### A11y / hygiene

```text
- role="dialog" + aria-modal="true" + aria-labelledby на title
- breakdown оформлен через role="list" / role="listitem"
  (как в `renderCompleted`)
- focus trap внутри sheet пока он открыт
- Escape / backdrop закрывают sheet
- close-кнопка имеет видимый aria-label «Закрыть»
- Денежные значения читаются через formatRub; aria-label на total
  для скринридеров (например «Ваш доход: 312 рублей»)
- Нет inline <script> / <style> / style="" / on*=
- Нет .style.<property> присвоений в JS
- Нет .setAttribute('style', …) в JS
- Нет style="…" в шаблонных строках JS
- CSP не ослаблен
- Service Worker не кеширует public/prototypes/
```

### Acceptance checklist

- [ ] Контракт оформлен отдельной секцией BD-RIDE-D-09
- [ ] Entry point ограничен COMPLETED через `#ar-earnings`
- [ ] NEW_ORDER, DRIVER_EN_ROUTE, DRIVER_APPROACHING_PICKUP,
      WAITING_PASSENGER, IN_PROGRESS, CANCELED, NO_SHOW
      перечислены как negative regression — earnings sheet/CTA
      НЕ должен появляться
- [ ] Реализация повешена на `openDriverEarningsSheet`
- [ ] Триггер `#ar-earnings` рендерится только в `renderCompleted`
- [ ] Click handler `#ar-earnings` навешан только в completion ветке
- [ ] UI states: default / breakdown / shift summary / closed —
      перечислены
- [ ] Breakdown использует те же формулы (gross / commission rate /
      commission amount / net), что и текущий `renderCompleted`
- [ ] Shift summary использует те же поля (previousToday,
      tripsToday) и считает delta так же, как `renderCompleted`
- [ ] Sheet НЕ пишет в `bazardrive.active_ride.v1` ни при открытии,
      ни при закрытии, ни при просмотре
- [ ] `?status=` override остаётся view-only; sheet поверх
      `?status=COMPLETED` использует demo-ride без записи в storage
- [ ] Earnings history (за сегодня / за неделю / за месяц) — out
      of scope, в этом sheet только текущая поездка + смена сегодня
- [ ] Safe stub behavior зафиксирован: без backend, без push,
      без real payout / withdraw, без real tax / commission API
- [ ] Passenger flow (BD-RIDE-P) не изменён
- [ ] Manual test URLs перечислены (positive + negative regression)
- [ ] Раздел Documentation hygiene invariant покрывает этот
      контракт (см. конец файла)
- [ ] Нет изменений в `public/src/screens/active_ride_passenger.js`
      в рамках этого contract PR
- [ ] Нет изменений в `public/src/ride_state.js` в рамках этого
      contract PR
- [ ] Нет изменений в `public/styles/cloud.css` в рамках этого
      contract PR
- [ ] Нет изменений в `public/sw.js` / CSP в рамках этого
      contract PR
- [ ] `node scripts/check.mjs` проходит

### Manual test URLs

Positive (earnings sheet must be reachable in PR 4 impl):

```text
/active-ride?role=driver&status=COMPLETED
```

Negative regression (earnings sheet/CTA must NOT appear):

```text
/active-ride?role=driver&status=DRIVER_EN_ROUTE
/active-ride?role=driver&status=WAITING_PASSENGER
/active-ride?role=driver&status=IN_PROGRESS
/active-ride?role=driver&status=CANCELED
/active-ride?role=driver&status=NO_SHOW
```

Cross-flow regression (passenger flow + feed must stay intact):

```text
/active-ride?role=passenger&status=COMPLETED
/feed
```

### Out of scope for BD-RIDE-D-09

```text
Backend / real payout API
Real withdraw / вывод средств
Real tax / commission backend
Push при зачислении
Earnings history за неделю / за месяц / экспорт CSV
Bonus / промо логика
Mapbox / геометрия завершённой поездки
Реализация sheet (это PR 4)
Расширение схемы `ride_state.js` (см. Storage schema decision)
Изменение passenger active ride flow (BD-RIDE-P)
Driver cancel / problem flow (BD-RIDE-D-07 / BD-RIDE-D-08)
```

## Storage schema decision (BD-RIDE-D-07 / 08 / 09)

Explicit decision, фиксируемый этим PR (docs-only, no code):

```text
В рамках BD-RIDE-D-07, BD-RIDE-D-08, BD-RIDE-D-09 схема
`public/src/ride_state.js` НЕ расширяется.

Обоснование:
- `ride_state.js` уже содержит RIDE_STATUS.CANCELED и
  RIDE_STATUS.NO_SHOW + поле `canceledAt` через
  RIDE_STATUS_TIMESTAMP_FIELD. Этого достаточно для перевода
  driver-state машины через updateActiveRideStatus(...).
- Поля «причина отмены» (cancel.reason), «тип проблемы»
  (problem.type), «комментарий водителя» — нужны только UI и
  считаются mock-only в рамках PR 4. Хранятся локально в
  `active_ride.js` (или в отдельном sheet-state модуле), без
  записи в bazardrive.active_ride.v1.
- Earnings breakdown в BD-RIDE-D-09 — производное от уже
  имеющихся полей ride.ride.price, ride.order.commission,
  ride.ride.todayEarnings, ride.ride.tripsToday. Новые поля
  схемы не требуются.

Условный follow-up: если PR 4 в процессе имплементации
обнаружит, что без расширения схемы пройти невозможно
(например, потребуется persist cancel.reason между сессиями
для дальнейших экранов), он НЕ должен править `ride_state.js`
напрямую. Вместо этого открывается отдельный issue:

  BD-RIDE-STATE-CONTRACT-01 — расширение схемы ride_state.js
  для driver sheets (cancel.reason / problem.type / comment).

Issue ведёт к отдельному PR, который меняет схему вместе с
миграцией существующих записей и обновлением acceptance
checklist BD-RIDE-D.
```

---

## BD-MAP-01 — MapHome foundation

### Identity

```text
Screen:        MapHome foundation — standalone /map home screen
Route:         /map  (опциональный query `?state=…` только для render-gate показа)
File:          public/src/screens/map.js
Data source:   localStorage `bazardrive.map_prefs.v1`
               (managed by `public/src/mapbox/mapbox_state.js`)
Design ref:    Cloud Design — BD-MAP-01 MapHome foundation — Render Gate
               (см. issue #140, render-gate verification от 2026-05-18)
Parent issue:  #19
Related:       #105 (Mapbox data-boundary), #140 (render gate)
```

### Purpose

Самостоятельный экран «Карта», открываемый из bottom nav между
`Лента` и `Правила`. На этом этапе реальный Mapbox SDK не подключён —
экран отрисовывает 5 render-gate состояний поверх существующего
`MapShell` placeholder и safe-stub-модулей `public/src/mapbox/*`.

Никаких сетевых вызовов. Никакого нативного prompt на геолокацию при
монтировании экрана. Token-missing fallback имеет приоритет над
permission-состоянием.

### Route contract

```text
Path:          /map
Query:
  state    string  default '' (фактический режим вычисляется по stubs).
                   Разрешённые значения для render-gate показа:
                   default | permission | denied | nearby | token-missing
                   (синоним: token_missing). Неизвестные значения
                   игнорируются.
Chrome:        visible (tabbar + welcome-gate)
```

### State / data contract

```text
Reads:    bazardrive.map_prefs.v1 — { locationAllowed, lastCenter, zoom }
          mapbox_config.hasMapboxToken()    — стаб, всегда false
          geolocation_service.getPermissionStatus() — стаб, 'unknown'
Writes:   bazardrive.map_prefs.v1 — { locationAllowed: true } при клике
          по «Моё место». Никаких других ключей не трогаем.
Mock:     route_service.estimateRoute(...)  → Promise<null>
          price_estimator.estimatePrice(...) → null
```

### Render-gate states

```text
1. default       — карта без маршрута, видимы pickup/dropoff/route,
                   sheet с «Выбрать маршрут / Моё место / Заказы рядом».
2. permission    — баннер «Включите Моё место», карта приглушена.
3. denied        — баннер «Геолокация выключена», кнопка «Моё место»
                   неактивна.
4. nearby        — заглушки точек заказов поверх карты.
5. token_missing — Mapbox token отсутствует. Карта серая, кнопка
                   «Моё место» неактивна. Этот state имеет приоритет
                   над permission/denied.
```

### Actions

```text
«Выбрать маршрут» — placeholder; пока ведёт на /map (BD-MAP-03 RoutePicker
                    не реализован).
«Моё место»       — выставляет mapPrefs.locationAllowed=true и
                    пере-рендерит экран. Реальный
                    navigator.geolocation НЕ вызывается.
«Заказы рядом»    — переход в state=nearby (демо-плейсхолдер).
Bottom tabbar     — `/feed`, `/map`, `/rules`, `/profile` (active state
                    подсвечивает «Карта»).
```

### A11y

```text
- Map placeholder контейнер: role="img" aria-label="Карта-заглушка".
- Inner MapShell помечен aria-hidden="true" чтобы скринридер не
  читал декоративные маркеры дважды.
- Кнопка «Моё место»: aria-label="Моё место".
- Status banner: role="status" aria-live="polite".
- Watermark «Mapbox SDK пока не подключён» — pointer-events:none,
  визуальный.
```

### Acceptance checklist

- [ ] `/map` зарегистрирован в `public/src/app.js`.
- [ ] Экран открывается через hash-роутер; chrome (tabbar) виден.
- [ ] Bottom navigation подсвечивает «Карта» на `/map`
      (`router.js#syncTabActive`).
- [ ] По умолчанию (token отсутствует в stubs) рендерится state
      `token_missing`. Token-missing приоритетнее permission/denied.
- [ ] При наличии `?state=…` для каждого из пяти значений отрисовывается
      соответствующий гейт.
- [ ] Видимый watermark/label `Mapbox SDK пока не подключён` на всех
      состояниях.
- [ ] `navigator.geolocation` не вызывается при монтировании.
- [ ] Стаб-модули из `public/src/mapbox/` не делают сетевых вызовов
      и не подключают реальный Mapbox SDK.
- [ ] `public/sw.js` содержит новые JS-файлы в `PRECACHE` и поднят
      `VERSION`.
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`.
- [ ] Нет `.style.<property>` присвоений в JS.
- [ ] CSP не ослаблен (никаких `api.mapbox.com` / `events.mapbox.com`
      / `tiles.mapbox.com`).
- [ ] `node scripts/check.mjs` проходит.

### Manual test URLs

```text
/map                          → token_missing (default boot, token нет в stubs)
/map?state=default            → default / no route
/map?state=permission         → location permission needed
/map?state=denied             → location denied fallback
/map?state=nearby             → nearby orders placeholder
/map?state=token-missing      → Mapbox token missing fallback
/feed                         → проверить, что bottom nav содержит «Карта»
/rules                        → проверить, что «Правила» по-прежнему активны
```

### Out of scope for BD-MAP-01

```text
Реальный Mapbox SDK / token / CSP-расширение под Mapbox
Реальный navigator.geolocation prompt
Directions API, маршруты, цены
Backend / API / driver markers / live navigation
Подключение стабов к другим экранам
Любые изменения active ride flow (BD-RIDE-D / BD-RIDE-P)
```

---

## BD-MAP-03 — RoutePicker

### Identity

```text
Screen ID:           BD-MAP-03
Name:                RoutePicker
Route:               /route-picker
Future file:         public/src/screens/route_picker.js
Data source:         in-memory `routeDraft` (passenger session draft);
                     no localStorage write in this contract pass
Design ref:          Cloud Design — BD-MAP-03 RoutePicker — Render Gate
Cloud Design render: https://claude.ai/design/p/5906cb18-3016-4c57-879c-d1f89a532a34?file=BazarDrive+Prototype.html&via=share
Parent issue:        #19
Render gate issue:   #144
Status:              docs-only contract (implementation not yet started)
```

### Purpose

Экран, на котором пассажир задаёт пару адресов (точка подачи и точка
назначения) перед оформлением заказа. RoutePicker — следующий шаг
после `/map` (BD-MAP-01): пользователь нажимает «Выбрать маршрут» на
MapHome и попадает в этот экран. Здесь он выбирает pickup / dropoff
из подсказок поиска или вручную, может задействовать «Моё место» как
pickup, и формирует объект `routeDraft`, который затем передаётся в
BD-MAP-04 RoutePreview.

Этот контракт — render-gate sync с Cloud Design. Реальный поиск
адресов, Mapbox SDK / Geocoding API, сетевые вызовы и сохранение в
localStorage сюда **не входят** — экран описывается через mock
suggestions и in-memory draft.

### User role

```text
passenger    основной пользователь экрана
guest        может видеть экран; «Продолжить» уведёт на /onboarding
             через существующий welcome-gate (поведение наследуется
             от router.js — без изменений роутера в этом контракте)
driver       вне scope; для водительского флоу есть отдельный
             BD-DRIVER-01
```

### Route contract

```text
Path:          /route-picker
Query:         (нет; route-state живёт в in-memory `routeDraft`)
Chrome:        visible (tabbar + welcome-gate, как у /map)
Boot:          экран открывается с пустым routeDraft, если в session
               нет ранее заданных pickup / dropoff
```

### State / data contract

In-memory `routeDraft` (живёт в модуле `route_picker.js`, не пишется
в localStorage в рамках этого контракта):

```text
routeDraft {
  pickup:   RoutePoint | null    выбранная точка подачи
  dropoff:  RoutePoint | null    выбранная точка назначения
  focus:    'pickup' | 'dropoff' какое поле сейчас активно
  query:    string                текст поиска в активном поле
  results:  RoutePoint[]          mock-suggestions для текущего query
  source:   'search' | 'manual' | 'current' | null
                                   как был задан последний point
  status:   'empty'
          | 'pickup-selected'
          | 'dropoff-selected'
          | 'search-results'
          | 'manual-fallback'
          | 'route-draft-ready'
}

RoutePoint {
  id:       string                 mock id, стабильный в течение сессии
  label:    string                 человеко-читаемый адрес
  hint:     string | null          вторичная строка (район / город)
  source:   'search' | 'manual' | 'current'
  coords:   null                   не используется в этом контракте
                                   (нет реальной карты)
}
```

Reads / writes:

```text
Reads:    Cloud Design mock suggestions (in-file MOCK_SUGGESTIONS).
          Никаких чтений `bazardrive.map_prefs.v1` / геолокации в
          этом контракте.
Writes:   только in-memory `routeDraft`. Никаких ключей в
          localStorage не создаётся и не обновляется.
Mock:     route_service.estimateRoute / price_estimator не вызываются
          здесь — оценка маршрута живёт в BD-MAP-04 RoutePreview.
```

### Required states

```text
1. Empty pickup/dropoff   — оба поля пусты, список suggestions пуст,
                            CTA «Продолжить» неактивен.
2. Pickup selected        — pickup задан, dropoff пуст, фокус
                            автоматически переходит на dropoff.
3. Dropoff selected       — dropoff задан, pickup пуст; пользователь
                            может вернуться к pickup тапом по полю.
4. Search results         — пользователь печатает в активном поле,
                            под полем рендерится список mock
                            suggestions (Cloud Design — search list).
5. Manual address fallback — пользователь вводит адрес, которого нет
                            в suggestions; показывается строка
                            «Использовать как адрес» с иконкой.
6. Route draft ready      — pickup и dropoff заданы; CTA
                            «Продолжить» активен, snippet маршрута
                            (from → to) отрисован поверх карты-
                            заглушки.
```

### Actions

```text
back to /map               — стрелка назад в topbar → router.go('/map').
                              Текущий routeDraft теряется (или
                              сохраняется в module-scope, см.
                              «Out of scope» ниже).
select pickup              — тап по pickup-полю или по suggestion в
                              режиме focus=pickup. Обновляет
                              routeDraft.pickup и переводит status в
                              `pickup-selected`. Если dropoff уже
                              задан → `route-draft-ready`.
select dropoff             — тап по dropoff-полю или по suggestion в
                              режиме focus=dropoff. Обновляет
                              routeDraft.dropoff. Если pickup уже
                              задан → `route-draft-ready`.
use current location       — кнопка «Моё место» в pickup-поле.
                              Mock: подставляет MOCK_CURRENT_LOCATION
                              как pickup с source='current'. Реальный
                              `navigator.geolocation` НЕ вызывается.
clear route                — кнопка / иконка крестика рядом с
                              заполненным полем. Сбрасывает только
                              соответствующий point. Двойной clear
                              возвращает экран в `empty`.
continue to route preview  — основной CTA «Продолжить». Активен
                              только в `route-draft-ready`. В этом
                              контракте действие описано как «уведёт
                              на /route-preview», но сам переход и
                              регистрация маршрута — out of scope
                              (см. BD-MAP-04).
```

### A11y

```text
- Поля pickup / dropoff: <input> с aria-label, focus-state виден.
- Suggestion-список: role="listbox", элементы role="option".
- Manual fallback row: role="option" с явной подписью
  «Использовать как адрес».
- Кнопка «Моё место»: aria-label="Использовать моё место" + иконка.
- Кнопка очистки поля: aria-label="Очистить точку".
- CTA «Продолжить»: aria-disabled="true" в неготовых state.
- Map snippet поверх заглушки: aria-hidden="true" (декоративно).
```

### Acceptance checklist

- [ ] Cloud Design render для BD-MAP-03 RoutePicker зафиксирован
      (см. ссылку выше) и сверен с шестью required-state выше.
- [ ] Контракт BD-MAP-03 присутствует в `docs/screen-contracts.md`
      и содержит все требуемые поля (Screen ID, Name, Route, Future
      file, Parent, Render gate issue, Cloud Design render link,
      Purpose, User role, Data/state contract, Required states,
      Actions, Acceptance checklist, Out of scope).
- [ ] BD-MAP-03 удалён из «Planned screens» и больше не значится
      как «not yet implemented» в этом файле.
- [ ] Никакой реальной реализации `/route-picker` в этом PR нет
      (файл `public/src/screens/route_picker.js` не создаётся).
- [ ] `public/src/app.js` не модифицируется — маршрут
      `/route-picker` не регистрируется.
- [ ] `public/src/router.js` не модифицируется (нет HIDE_CHROME,
      нет welcome-gate изменений).
- [ ] `public/sw.js` PRECACHE и VERSION не трогаются.
- [ ] CSP (`<meta http-equiv="Content-Security-Policy">`) не
      ослабляется.
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
      изменений в HTML (этот PR docs-only).
- [ ] Нет `.style.<property>` присвоений в JS (этот PR docs-only).
- [ ] Active-ride flow (BD-RIDE-D / BD-RIDE-P) не затрагивается.
- [ ] `node scripts/check.mjs` проходит на этом PR.

### Out of scope for BD-MAP-03

```text
no /route-picker implementation
  (контракт описывает экран, но `public/src/screens/route_picker.js`
   в этом PR не создаётся)
no app.js route registration
  (route `/route-picker` пока НЕ зарегистрирован в router-таблице
   `public/src/app.js`)
no router.js changes
  (HIDE_CHROME, welcome-gate, syncTabActive — без изменений)
no real Mapbox SDK
  (никаких подключений к `api.mapbox.com` / `events.mapbox.com` /
   `tiles.mapbox.com`; safe-stubs `public/src/mapbox/*` не трогаются)
no backend / API
  (нет реального Geocoding / Search / Directions; suggestions —
   mock-массив в будущем файле экрана)
no CSP changes
  (`<meta http-equiv="Content-Security-Policy">` в
   `public/index.html` не редактируется)
no Service Worker changes
  (`public/sw.js` PRECACHE и VERSION не обновляются — implementation
   PR поднимет VERSION и добавит файл в PRECACHE отдельно)
no active ride changes
  (active_ride.js / active_ride_passenger.js / ride_state.js не
   модифицируются; routeDraft не перетекает в active-ride state
   machine в рамках BD-MAP-03)
no localStorage persistence
  (routeDraft живёт только в module-scope; персистентность маршрута —
   отдельный вопрос для BD-MAP-04 / BD-MAP-05)
no real navigator.geolocation prompt
  («Моё место» подставляет MOCK_CURRENT_LOCATION; реальный prompt —
   отдельный гейт, см. BD-MAP-02 LocationPermission)
no /route-preview implementation
  (CTA «Продолжить» — placeholder в этом контракте; экран
   назначения описывается отдельно в BD-MAP-04)
```

---

## BD-PROFILE-MY-POSTS-01 — My publications from Profile

### Identity

```text
Screen:        Profile → inline section «Мои публикации»
Route:         /profile  (нет отдельного маршрута — секция встроена в Profile)
File:          public/src/screens/profile.js
Data source:   listMyPostsSync() из public/src/mock_api.js
               (localStorage `bazardrive.myposts.v1` + in-memory FEED_POSTS_V2,
               отфильтрованные по `createdByCurrentUser === true`)
Parent issue:  #19
Working issue: #149
Recommended branch: feature/profile-my-posts
```

### Purpose

Дать пассажиру / водителю простую точку входа из Profile к своим
локально созданным публикациям (поездки, попутчик, объявление, маркет,
услуга), созданным через `/new` (composer). Без backend, без редактора,
без удаления — только инвентарь.

### Placement

- Inline-секция внутри `/profile`. Отдельного маршрута `/my-posts` нет.
- Passenger view: секция отрисовывается между блоком поездок и
  меню (раздел 7c).
- Driver view: секция отрисовывается в табе «Обзор», после
  `taxiPermitPanel` и перед `quickActions`.
- Guest view: секция скрыта — экран guest содержит только CTA
  «Начать регистрацию» (`/onboarding`).

### Ownership contract

Composer создаёт пост через `createFeedPost(post)`. Функция
дополняет посту полями `authorId: 'local-user'`,
`createdByCurrentUser: true`, `createdAt: Date.now()` и сохраняет
копию в localStorage (`bazardrive.myposts.v1`). При загрузке модуля
`mock_api.js` персистентные посты прокидываются обратно в
`FEED_POSTS_V2`, чтобы они оставались видимыми в ленте после
перезагрузки. Существующие сид-посты не трогаются.

Marketplace и service драфты композер сериализует как
`type: 'marketplace'` (Feed V2 рендерит их одинаковым marketplace-кардом),
но добавляет дискриминатор `subtype: 'service' | 'marketplace'`, чтобы
секция «Мои публикации» подписывала service-посты бейджем `Услуга`.

### Render

```text
Header:   "Мои публикации" + count badge (если есть посты)
List:     bd-card-tight × N
          - type badge (Поездка / Попутчик / Объявление / Маркет / Услуга)
          - summary (route `from → to` для trip-like, иначе title / body)
          - price (если есть)
          - time / createdAt
Empty:    bd-card с заголовком "Пока нет публикаций"
          текст "Создайте поездку, объявление или услугу — они появятся здесь."
          CTA primary "Создать публикацию" → /new
```

### Acceptance

```text
- [x] /profile содержит секцию «Мои публикации» (passenger + driver)
- [x] Пост, созданный через /new, появляется в секции после возврата на /profile
- [x] Пост помечается ownership-полями authorId / createdByCurrentUser
- [x] Пустое состояние показывает CTA «Создать публикацию» → /new
- [x] Feed V2 категории (Всё / Поездки / Попутчики / Объявления / Маркет)
       не изменены
- [x] /feed, /new, /profile продолжают работать
- [x] no inline <script> / <style> / style="" / on*=
- [x] no `.style.<property>` mutations
- [x] CSP не ослабляется, новых файлов нет (SW PRECACHE не трогаем)
- [x] node scripts/check.mjs проходит
```

### Out of scope for BD-PROFILE-MY-POSTS-01

```text
Backend / API (нет реального хранилища публикаций)
Реальная авторизация (authorId захардкожен как 'local-user')
Детальный экран публикации
Редактирование публикации
Архивирование / удаление / снятие с публикации
Модерация / статус публикации
Реакции / комментарии в секции «Мои публикации»
Отдельный маршрут /my-posts
Изменение чипов Feed V2 (Маркет / Поездки / Попутчики и т.п.)
```

---

## BD-POST-01 — Post details

### Identity

```text
Screen:        Post details — экран деталей публикации
Route:         /post (hash-router equivalent of /post/:id)
File:          public/src/screens/post_detail.js
Data source:   listFeedPosts() from public/src/mock_api.js
Parent issue:  #9
```

### Cloud Design render/frame gate

Status: deferred.

Frontend-only MVP, no new visual language. Использует существующие
Feed V2 / Cloud Design компоненты (`bd-card`, `feed-card-header`,
`feed-route-row`, `feed-trip-meta`, `bd-badge`, `bd-btn`, `bd-alert`).
Полноценный Cloud Design render/frame будет привязан в следующем
проходе вместе с остальным dispatcher line.

### Route contract

```text
Path:          /post
Query:
  id     string   id поста в FEED_POSTS_V2; обязателен
Chrome:        visible (tabbar шоу)
Note:          канонический URL — `#/post?id=<postId>`. Это hash-router
               equivalent для `/post/:id`; параметризованные сегменты
               пути в текущем router.js не поддерживаются.
```

### Data contract

Reads `FEED_POSTS_V2` через `listFeedPosts()`. Используются поля поста:

```text
id, type, passenger, author, role, time,
from, to, when, price, seats, body,
title, tags, city / location, phone (если есть)
```

`type` мапится в человекочитаемую метку:

```text
trip (passenger != true)  → «Поездка»
trip (passenger === true) → «Попутчик»
announcement              → «Объявление»
marketplace               → «Маркет»
system                    → «Системное»
```

### UI states

```text
loaded         — карточка с author / type / city / route / when /
                 price / описанием / контактом
contact-locked — пользователь не прошёл онбординг; телефон скрыт под
                 маской и показывается `bd-alert info` с подсказкой
                 «Контакты автора откроются после онбординга»
contact-ready  — пользователь онбордирован; `bd-alert success` с
                 кликабельным телефоном и подписью «Контакт доступен»
missing        — `?id=` пустой или пост не найден в FEED_POSTS_V2;
                 показывается `bd-empty` с CTA «Вернуться в ленту»
```

### Actions

```text
back / cancel  → /feed
respond CTA    → если user.onboarded === true:
                   /respond?postId=<id>
                 если user.onboarded !== true:
                   setPendingAction(() => go('/post?id=<id>'))
                   go('/onboarding')
                 — после онбординга пользователь возвращается на
                 этот же экран деталей с раскрытым контактом
open from feed → клик по `[data-post-card]` карточке в /feed
                 (но НЕ по вложенным [data-action] / button / a)
                 → go('/post?id=<id>')
```

### Onboarding gate

Контакт и реальный submit отклика недоступны до онбординга. Сами
детали поста (author, route, цена, описание) видны всегда — чтобы
неонбордированный пользователь мог оценить публикацию перед тем,
как пройти онбординг.

### Acceptance checklist

- [ ] `/post?id=<id>` открывается через hash-роутер
- [ ] Клик по карточке в `/feed` ведёт на `/post?id=<id>`
- [ ] Клики по [data-action]-кнопкам внутри карточки НЕ открывают детали
- [ ] Показываются author, city (если есть), type, from/to (для trip),
      price, описание (body), дата (time)
- [ ] CTA «Откликнуться» для онбордированного пользователя ведёт на
      `/respond?postId=<id>`
- [ ] CTA «Откликнуться» для неонбордированного пользователя
      открывает `/onboarding`, и после его завершения возвращает
      обратно на `/post?id=<id>`
- [ ] Контакт автора скрыт под маской до онбординга
- [ ] Контакт автора раскрывается только после онбординга
- [ ] При отсутствии поста (`?id=` пустой или не найден) показывается
      missing-fallback с CTA «Вернуться в ленту»
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `public/sw.js` precache содержит `./src/screens/post_detail.js`
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-POST-01

```text
Backend / реальный API
Реальные контакты автора (mock-номер для seed-постов)
Параметризованные сегменты пути /post/:id (текущий router.js
  использует exact-match — используется `?id=` query)
Like / comment / share действия на экране деталей
Cloud Design render/frame gate (deferred)
Mapbox / геометрия маршрута
APK / push
```

---

## BD-POST-02 — Role-aware Post Details CTA

### Identity

```text
Screen:        Post details — primary CTA, зависящий от типа поста и роли
Route:         /post (hash-router equivalent of /post/:id)
File:          public/src/screens/post_detail.js
Data source:   listFeedPosts() from public/src/mock_api.js
Parent issue:  #9
Working issue: #153
Recommended branch: feature/post-detail-role-aware-cta
```

### Cloud Design render/frame gate

Status: deferred (наследуется от BD-POST-01).

Визуально переиспользуются существующие компоненты футера
(`respond__footer`, `bd-btn primary`, `bd-btn ghost`). Добавляется
модификатор `.post-detail__footer--single` для случая, когда
primary-CTA отсутствует (announcement / system) и в футере остаётся
только полноширинная кнопка «Назад».

### CTA matrix

```text
post.type === 'trip' && post.passenger !== true
  → label:  «Написать водителю»
  → action: /chat?tripId=<post.id>

post.type === 'trip' && post.passenger === true
  ready driver (user.role === 'driver' && driver-line-ready):
    → label:  «Принять заказ»
    → action: build active ride from post,
              saveActiveRide(ride),
              go('/active-ride?role=driver&tripId=<ride.tripId>')
  иначе:
    → label:  «Откликнуться»
    → action: /respond?postId=<post.id>

post.type === 'marketplace'
  → label:  «Написать продавцу»
  → action: /respond?postId=<post.id>
             (chat-контракт для маркета ещё не определён)

post.type === 'announcement' || post.type === 'system'
  → primary CTA отсутствует;
  → футер содержит только полноширинную кнопку «Назад» → /feed.
```

«Driver-line-ready» совпадает с проверкой из Feed V2 (`feed.js`):
`user.phone && vehicleMake && vehicleModel && vehiclePlate
 && documentsReady === true && waybillOpen === true
 && medicalCheckPassed === true`.

### Onboarding gate

Поведение онбординга наследуется от BD-POST-01:

```text
если user.onboarded !== true и CTA требует действия:
  setPendingAction(() => go('/post?id=<id>'))
  go('/onboarding')
после онбординга пользователь возвращается на тот же экран деталей
контакт автора по-прежнему скрыт под маской до онбординга
```

Для announcement / system primary-CTA отсутствует, поэтому
onboarding-gate на этом экране не срабатывает.

### Active ride

При CTA «Принять заказ»:

```text
ride = createDemoActiveRide({
  tripId: `feed-${post.id}`,
  status: RIDE_STATUS.NEW_ORDER,
  passenger: { name: post.author, initials: <первая буква> },
  order:     { offerPrice: post.price || '—' },
  route:     { pickupLabel: post.from, dropoffLabel: post.to },
});
saveActiveRide(ride);
go('/active-ride?role=driver&tripId=' + ride.tripId);
```

Active-ride state machine как таковая не модифицируется — используется
существующий `createDemoActiveRide` / `saveActiveRide` из
`public/src/ride_state.js` (тот же путь, что и в Feed V2).

### Acceptance checklist

- [ ] `/post?id=trip-1` (driver offer trip) показывает CTA
      «Написать водителю» и ведёт на `/chat?tripId=trip-1`
- [ ] `/post?id=trip-2` (passenger request) для онбордированного
      не-водителя показывает «Откликнуться» → `/respond?postId=trip-2`
- [ ] `/post?id=trip-2` для ready-driver показывает «Принять заказ»;
      action сохраняет active ride и открывает
      `/active-ride?role=driver&tripId=feed-trip-2`
- [ ] `/post?id=mkt-1` (marketplace) показывает «Написать продавцу»
      → `/respond?postId=mkt-1`
- [ ] `/post?id=ann-1` (announcement) не показывает CTA
      «Откликнуться»; футер содержит только «Назад» → `/feed`
- [ ] `/post?id=sys-1` (system) не показывает CTA «Откликнуться»;
      футер содержит только «Назад» → `/feed`
- [ ] Не-онбордированный пользователь при клике по любому
      интерактивному CTA уходит на `/onboarding` через
      `setPendingAction(() => go('/post?id=<id>'))`
- [ ] Контакт автора по-прежнему скрыт под маской до онбординга
- [ ] Футер остаётся mobile-safe (safe-area-inset-bottom)
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен; router не модифицируется
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-POST-02

```text
Backend / реальный API
Реальная отправка сообщений в /chat (mock UI)
Изменения active-ride state machine
Контракт чата для marketplace (используется /respond?postId=)
Mapbox / APK / push / CSP / router
Like / comment / share действия на экране деталей
```

---

## Planned screens (not yet implemented)

These screens are tracked by #19 and should receive their own
render/frame and contract before implementation:

```text
BD-MAP-02 — LocationPermission
BD-DRIVER-01 — DriverMap (полноценная карта в driver-режиме)
BD-MAP-FOUND-01 — Mapbox integration foundation (SDK + CSP + SW)
```

> BD-MAP-05 удалён из этого списка — контракт описан ниже (см.
> «BD-MAP-05 — OrderMapDraft»). Имплементация — без backend, без
> реального Mapbox SDK, без push и без driver-assignment, только
> локальный mock-заказ через `createRideOrder()` в `mock_api.js`.

> BD-MAP-01 удалён из этого списка — контракт описан выше (см.
> «BD-MAP-01 — MapHome foundation»). Имплементация — без реального
> Mapbox SDK, только safe stubs в `public/src/mapbox/*`.

> BD-MAP-03 удалён из этого списка — контракт описан выше (см.
> «BD-MAP-03 — RoutePicker»). Сам экран `/route-picker` пока не
> реализован: контракт зафиксирован как docs-only render gate
> (см. issue #144).

> BD-MAP-04 удалён из этого списка — экран `/route-preview`
> реализован и смёржен через PR #214. Closeout отслеживается в #213.

> `/active-ride` уже реализован двумя файлами
> (`active_ride.js`, `active_ride_passenger.js`) и поэтому удалён
> из этого списка. См. BD-RIDE-D и BD-RIDE-P выше.
>
> BD-RIDE-D-07 / BD-RIDE-D-08 / BD-RIDE-D-09 удалены из этого
> списка после оформления контрактов (этот PR — docs-only). Их
> имплементация трекается отдельно в PR 4 (см.
> `docs/project-health-audit.md` §PR 4).

---

## BD-RIDE-INBOX-02 — Inbox polish

### Identity

```text
Screen:        Inbox — единая лента откликов, сообщений и поездок
Route:         /inbox (опционально `?tab=responses|messages|rides`)
File:          public/src/screens/inbox.js
Data source:   listInboxItems() из public/src/mock_api.js
               INBOX_STATUS_LABEL / INBOX_STATUS_TONE (нормализованный язык)
Parent issue:  BD-RIDE-INBOX-02
```

### Purpose

Полировочный pass поверх существующего inbox-хаба. Не добавляет backend,
не вводит push, не трогает active-ride state-machine — только приводит
карточки откликов / сообщений / поездок к одному визуальному контракту
Cloud Design и нормализует статусы под язык ride-флоу.

### Card hierarchy

```text
[avatar]  [имя · роль]                 [status badge]
          [тип · вторичная мета]       [время]
[маршрут from → to]
[summary последнего сообщения / отклика]
[primary CTA]                          [secondary CTA]
```

Unread-state — карточка получает `.inbox-item--unread` (мягкий оранжевый
оттенок) и точку рядом с именем.

### Normalized status palette

```text
NEW_RESPONSE    → «Новый отклик»  (accent)
WAITING_REPLY   → «Ждём ответа»   (warning)
ACCEPTED        → «Принят»        (success)
DRIVER_EN_ROUTE → «Водитель едет» (info)
IN_PROGRESS     → «В пути»        (info)
COMPLETED       → «Завершено»     (muted)
CANCELED        → «Отменено»      (danger)
```

Тот же язык используется в chat trip-bar (status pill) — чтобы
переход inbox → chat не разрывал контекст.

### Role-aware actions

```text
Пассажир:
  Новый отклик     → primary «Посмотреть отклик» → /responses
                     secondary «В чат»            → /chat
  Активная поездка → primary «К поездке»         → /active-ride?role=passenger
                     secondary «Открыть чат»     → /chat

Водитель:
  Ожидание ответа  → primary «Ответить пассажиру» → /respond
                     secondary «В чат»            → /chat
  Активная поездка → primary «Продолжить поездку» → /active-ride?role=driver
                     secondary «В чат»            → /chat
```

### Empty state

Calm Cloud Design card (`.inbox-empty`) с круглым accent-глифом,
объясняющей подсказкой по активной вкладке и CTA «Перейти в ленту» —
без тупиков.

### Out of scope for BD-RIDE-INBOX-02

```text
backend API / real-time канал
push-уведомления
изменения active_ride.js / active_ride_passenger.js
изменения ride_state.js
Mapbox / payment / auth
```

### Acceptance checklist

- [ ] `/inbox` рендерит карточки с consistent Cloud Design hierarchy
      (avatar + name/role + status badge + route + summary + actions)
- [ ] Status badges используют нормализованный язык ride-флоу
- [ ] Unread state виден (точка у имени + мягкий accent-фон)
- [ ] Empty state имеет CTA «Перейти в ленту»
- [ ] Primary / secondary actions route в /respond, /chat, /active-ride,
      /responses, /post — без тупиков
- [ ] Passenger / driver копия чётко разведена
- [ ] active_ride.js и active_ride_passenger.js не модифицированы
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

---

## Documentation hygiene invariant

Этот раздел применяется ко всем контрактам выше и совпадает с
проверками `scripts/check.mjs`. Любой новый контракт обязан включать
их в acceptance checklist.

```text
- no inline <script>
- no inline <style>
- no style="" attributes in HTML
- no on*= handlers in HTML
- no `.style.<property>` mutations in JS
- no `.setAttribute('style', …)` in JS
- no style="…" в шаблонных строках JS
- CSP не ослабляется (см. <meta http-equiv="Content-Security-Policy"> в index.html)
- Service Worker не кеширует public/prototypes/
- node scripts/check.mjs проходит локально и в CI
```

## BD-MAP-05 — OrderMapDraft

### Identity

```text
Screen:        BD-MAP-05 OrderMapDraft
Route:         /order-map-draft
File:          public/src/screens/order_map_draft.js
Styles:        public/styles/order_map_draft.css
Data source:   routeDraft из localStorage (`bazardrive.route_draft.v1`)
               + createRideOrder() из public/src/mock_api.js
Draft key:     bazardrive.order_form.v1 (форма «Сохранить черновик»)
Orders key:    bazardrive.ride_orders.v1 (опубликованные mock-заказы)
Design ref:    Cloud Design — BD-MAP-05 OrderMapDraft — Render Gate
Parent issue:  #19
Working issue: #215
Branch:        feature/order-map-draft
```

### Purpose

Следующий шаг после BD-MAP-04 RoutePreview. Берёт подтверждённый
routeDraft (pickup, dropoff, distanceKm, durationMin, estimatedPrice) и
превращает его в локальный mock пассажирский заказ. Никакого backend,
реального Mapbox SDK, geocoding, payments, auth или driver-assignment
здесь нет — `createRideOrder()` пишет объект в `localStorage` и
success-стейт визуально подтверждает публикацию.

### Cloud Design render/frame gate

Design section: **BD-MAP-05 · OrderMapDraft**

Frames used as visual reference:

```text
1 · Default — готов к публикации       → routeDraft валиден, mode=now
2 · Schedule later — на завтра          → mode=later + date/time fields
3 · Validation error                    → ошибки order.schedule / order.price
4 · Publishing loading                  → CTA «Публикуем…» + spinner
5 · Success — заказ опубликован         → success card + сводка заказа
6 · Missing routeDraft (отсутствует)    → empty-state + diag-card
```

### Route contract

```text
Path:          /order-map-draft
Query:         нет
Chrome:        visible (tabbar не скрыт)
Entry points:
  - /route-preview → CTA «Создать заказ» (BD-MAP-04)
  - прямой переход (анализируется как missing routeDraft)
```

### Data contract — routeDraft (in)

```text
Reads:   bazardrive.route_draft.v1 (см. BD-MAP-03 RoutePicker)
Shape:   {
  pickup:  { id, label, hint, source, coords }
  dropoff: { id, label, hint, source, coords }
  route:   { distanceKm:number, durationMin:number, estimatedPrice:number }
}
Validation (defensive):
  - JSON.parse failure         → state=missing
  - !isPlainObject              → state=missing
  - pickup/dropoff invalid     → state=missing
  - route.distanceKm == null    → state=missing
  - route.durationMin == null   → state=missing
  - route.estimatedPrice == null → state=missing
```

### Data contract — order (out)

`createRideOrder()` (in `public/src/mock_api.js`) пишет в
`bazardrive.ride_orders.v1` (newest-first):

```text
{
  id:             `order-<timestamp>`
  type:           'passenger_request' | 'ride_order'
  pickup:         { id, label }
  dropoff:        { id, label }
  distanceKm:     number
  durationMin:    number
  estimatedPrice: number
  scheduledMode:  'now' | 'later'
  scheduledAt:    ISO string (now() для 'now', `${date}T${time}:00` для 'later')
  comment:        string
  status:         'CREATED'
  createdAt:      ISO string
}
```

`listNearbyOrders()` — helper, который вернёт до 20 опубликованных
заказов со `status === 'CREATED'` (для будущего BD-DRIVER-01 DriverMap,
сейчас не используется UI).

### UI states

```text
1 · default        — routeDraft валиден; форма Сейчас/Позже + цена + комментарий
2 · schedule-later — mode='later'; раскрыты поля date / time
3 · validation     — после клика «Опубликовать» с ошибками; список
                     {order.schedule, order.price} остаётся видимым,
                     mode остаётся прежним
4 · publishing     — form.publishing = true; CTA disabled + spinner
5 · success        — после createRideOrder(); success-card + сводка
6 · missing        — routeDraft отсутствует / malformed; empty + diag
```

### Form fields

```text
mode:     'now' | 'later'         tabs «Сейчас» / «Позже»
date:     <input type="date">     виден только в mode='later'
time:     <input type="time">     виден только в mode='later'
price:    number ≥ 0              stepper −50 / input / +50, fallback = estimatedPrice
comment:  string, 0..200          textarea + counter
phone:    маска из user.phone     read-only, CTA «Изменить» → /profile
```

Поле «Сохранить черновик» пишет текущее состояние формы в
`bazardrive.order_form.v1` (mode/date/time/price/comment/fingerprint).
Fingerprint = `pickup.label→dropoff.label`. Если маршрут изменился —
поле price сбрасывается к estimatedPrice, остальные поля сохраняются.

### Validation

```text
mode='later' и !date || !time   → { copy: 'Укажите время поездки',  path: 'order.schedule' }
currentPrice(draft) <= 0         → { copy: 'Проверьте цену или контакт', path: 'order.price' }
```

Ошибки рендерятся в `.omd-errors` (role="alert") между phone-row и
lock-hint. Mode не сбрасывается, поля не очищаются.

### Actions

```text
back              → /route-preview
close (×)         → /feed
edit-route        → /route-picker
pick-route        → /route-picker (missing state)
edit-phone        → /profile
price-down / -up  → ±50 ₽ (clamp 0..100000)
save-draft        → persist form in bazardrive.order_form.v1
publish           → validate → form.publishing=true → setTimeout 700ms
                    → createRideOrder() → clearFormDraft() → success state
responses         → /responses (success CTA)
```

### Success state copy

```text
Pill:     «ОПУБЛИКОВАН» (topbar subtitle, success tone)
Badge:    «ЗАКАЗ № <last6 chars> · ОПУБЛИКОВАН»
Title:    «Заказ опубликован»
Status:   «Ищем водителей»
Hint:     «Водители увидят маршрут и смогут откликнуться.»
Summary:  Маршрут (pickup → dropoff)
          Время (Сейчас · подача 4–8 мин | DD.MM.YYYY · HH:MM)
          Цена (estimatedPrice ₽)
          Статус («Ищем водителей», success-pill)
Actions:  «Смотреть отклики» (data-action=my-order)
            → /responses?orderId=<id>&state=empty
          «В ленту»          → /feed
```

### Missing state copy

```text
Pill:     «МАРШРУТ НЕ ВЫБРАН» (topbar subtitle, missing tone)
Title:    «Маршрут не выбран»
Hint:     «Сначала выберите точки поездки, затем создайте заказ.»
Diag:     Источник = localStorage · пусто
          Ключ     = bazardrive.route_draft.v1
          Шаг назад = /route-picker
Actions:  «Выбрать маршрут» → /route-picker
          «В ленту»          → /feed
```

### CSS

All styles added to `public/styles/order_map_draft.css` under section
`BD-MAP-05`. CSS prefix: `omd-*`. No inline styles, no `style=`
attributes. Tab/mode state driven by `.is-active` class and
`data-mode="now|later"` selectors. Publishing state driven by
`data-publishing="0|1"` selector + `.is-loading` class. Spinner is
pure CSS `@keyframes omd-spin`.

### Acceptance checklist

- [ ] `/order-map-draft` открывается через hash-роутер
- [ ] Без routeDraft (или повреждённый) → missing-стейт с diag-карточкой
- [ ] С валидным routeDraft → default-стейт со сводкой маршрута
- [ ] Метрики (мин / км / ₽) рендерятся из `route.distanceKm` /
      `durationMin` / `estimatedPrice`
- [ ] Tabs «Сейчас» / «Позже» переключают форму без перезагрузки
- [ ] В режиме «Позже» появляются поля date + time
- [ ] Stepper цены ±50 ₽ работает, ручной ввод сохраняется
- [ ] Комментарий ограничен 200 символами; counter обновляется
- [ ] Телефон из профиля показывается как `+7 (XXX) ··· XX-XX`,
      CTA «Изменить» уходит на `/profile`
- [ ] Validation: «Опубликовать» с `mode='later'` без даты/времени
      показывает `order.schedule` ошибку
- [ ] Validation: `price ≤ 0` показывает `order.price` ошибку
- [ ] Publishing-стейт: CTA disabled + spinner «Публикуем…»
- [ ] Success-стейт показывает badge с id, сводку заказа и CTA
      «→ Посмотреть отклики» / «В ленту»
- [ ] `createRideOrder()` пишет в `bazardrive.ride_orders.v1`
      объект с id, type, pickup, dropoff, distanceKm, durationMin,
      estimatedPrice, scheduledMode, scheduledAt, comment,
      status='CREATED', createdAt
- [ ] `listNearbyOrders()` возвращает опубликованные CREATED-заказы
- [ ] Save-draft пишет форму в `bazardrive.order_form.v1` и
      переживает rerender
- [ ] BD-MAP-04 RoutePreview не модифицирован
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-MAP-05

```text
Реальный Mapbox SDK (route geometry / tiles)
Geocoding / reverse geocoding
Backend / реальная публикация заказа
Driver assignment / matching
Push-уведомления (push в success-копии — mock)
Платёж / hold карты
Auth / реальная верификация телефона
DriverMap (BD-DRIVER-01) — listNearbyOrders() заведён здесь,
  но потребитель появится позже
APK / Android shell
```

## BD-DRIVER-01 — DriverMap

### Identity

```text
Screen:        BD-DRIVER-01 DriverMap — driver-side nearby orders
Route:         /driver-map
File:          public/src/screens/driver_map.js
Data source:   listNearbyOrders() + acceptNearbyOrder() из
               public/src/mock_api.js (store ride_orders.v1)
Design ref:    Cloud Design — BD-DRIVER-01 DriverMap (render gate)
Parent issue:  #19
Working issue: #217
Branch:        feature/driver-map
```

### Purpose

Первый безопасный driver-side экран карты. Показывает водителю
mock-заказы рядом, опубликованные через BD-MAP-05 OrderMapDraft, и
даёт принять заказ локально (мок status flip без backend / push /
driver assignment service). Реальный Mapbox SDK, токен и нативная
геолокация в этот контракт не входят — экран наследует визуальный
язык BD-MAP-01 MapHome (`createMapShell({ variant: 'driver' })`).

### Route contract

```text
Path:          /driver-map
Query:         (нет в этой ревизии — внутренние состояния живут в DOM)
Chrome:        tabbar visible, FAB hidden (SHOW_FAB ограничен '/feed')
Boot:          listNearbyOrders() читается на каждом рендере;
               если store пустой — карта-заглушка рисуется без cluster-пинов,
               снизу — empty-card (см. BD-DRIVER-03 polish)
```

### Data contract

```text
Reads:    bazardrive.ride_orders.v1 через listNearbyOrders()
          (status === 'CREATED', верхние 20 записей)
Writes:   bazardrive.ride_orders.v1 через acceptNearbyOrder(id)
          (status CREATED → ACCEPTED, добавляется acceptedAt ISO string)
          bazardrive.active_ride.v1 — на accept seedим запись через
          createDemoActiveRide() + saveActiveRide() из ride_state.js,
          tripId = `trip_<order.id>`, status = DRIVER_EN_ROUTE,
          route.pickupLabel / route.dropoffLabel / route.etaToDestination,
          order.destinationDistance / order.destinationEta /
          order.offerPrice, ride.price, timestamps.acceptedAt
Mock:     нет встроенных DEMO_ORDERS — empty-стейт держит карту
          без cluster-пинов, чтобы placeholder и empty-sheet
          сообщали одно и то же (см. BD-DRIVER-03 polish).
```

### UI states

```text
1 · list     — listNearbyOrders().length > 0 → карточка с count + список +
               ряд chip-кнопок «Открыть карту» / «В ленту»
2 · empty    — live-список пуст; карта-заглушка без cluster-пинов
               (watermark «Демо-фон · Mapbox SDK пока не подключён»),
               карточка снизу — empty с CTA «Создать тестовый заказ»
3 · accepted — после успешного acceptNearbyOrder(): success-badge,
               сводка маршрута, CTA «К поездке» → /active-ride?role=driver
               (карта-заглушка идёт в variant=accepted: без cluster-пинов,
               aria-label «Карта-заглушка водителя · заказ принят»,
               watermark «Карта водителя · Mapbox SDK пока не подключён»)
```

### Actions

```text
accept (live order)  → acceptNearbyOrder(id) → seedActiveRideFromAcceptedOrder()
                       → accepted state (CTA carries tripId)
create-order         → /order-map-draft
map                  → /map (BD-MAP-01 MapHome)
feed                 → /feed
active-ride          → /active-ride?role=driver&tripId=<trip_<id>>&status=DRIVER_EN_ROUTE
                       (loadCanonicalActiveRide материализует именно
                       принятый заказ, а не generic DEMO_ACTIVE_RIDE_ID)
driver-map (back)    → перерисовка списка in-place
```

### CSS

Новые правила добавлены в `public/styles/cloud.css` под секцией
`BD-DRIVER-01 DriverMap`. CSS prefix: `driver-map__*`. Карта и
карточки переиспользуют существующие классы `bd-map-shell`,
`map-home__map`, `map-home__sheet`, `map-home__order-*`, `bd-btn`,
`bd-badge`, `bd-empty`. Нет inline styles, нет `style=` атрибутов,
нет `.style.<property>` мутаций.

### Acceptance checklist

- [ ] `/driver-map` открывается через hash-роутер
- [ ] Tabbar виден, FAB скрыт (SHOW_FAB ограничен '/feed')
- [ ] При непустом `listNearbyOrders()` рендерится list-стейт со
      счётчиком и кнопкой «Принять» на каждой строке
- [ ] При пустом store карта-заглушка не содержит cluster-пинов и
      empty-card снизу — с CTA «Создать тестовый заказ» → /order-map-draft
- [ ] «Принять» на live-заказе вызывает `acceptNearbyOrder(id)`,
      сидит запись в `bazardrive.active_ride.v1` с маршрутом и
      ценой заказа, экран переходит в accepted-стейт, заказ
      исчезает из `listNearbyOrders()`
- [ ] CTA «К поездке» в accepted-стейте →
      `/active-ride?role=driver&tripId=trip_<order.id>&status=DRIVER_EN_ROUTE`,
      `loadCanonicalActiveRide` находит сидeд-запись и рендерит
      именно принятый заказ (а не generic DEMO_ACTIVE_RIDE_ID)
- [ ] Карта-заглушка использует `createMapShell({ variant: 'driver' })`
      без реального Mapbox SDK и без токена
- [ ] `public/sw.js` precache содержит `./src/screens/driver_map.js`
- [ ] `/active-ride?role=driver` и `/active-ride?role=passenger`
      продолжают работать (active_ride.js не модифицирован)
- [ ] Нет inline `<script>` / `<style>` / `style=""` / `on*=`
- [ ] Нет `.style.<property>` присвоений в JS
- [ ] CSP не ослаблен
- [ ] `node scripts/check.mjs` проходит

### Out of scope for BD-DRIVER-01

```text
Реальный Mapbox SDK (tiles / route geometry / clustering)
Mapbox token / CSP relaxation
Native Geolocation API запрос на маунте
Backend API / driver assignment service
Push-уведомления (новый заказ / отмена пассажиром)
Платёж / hold карты
Переписывание active_ride.js / ride_state.js
APK / Android shell
```

