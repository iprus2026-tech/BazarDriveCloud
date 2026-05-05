# BazarDrive

Installable PWA для объявлений и сообщества водителей. Без шума и накруток.

**Cloud Design** — тёмная тема, оранжевый акцент `#FF6B35`, мобильный shell max-width 430 px.

Phase 1 — каркас на vanilla HTML / CSS / ES-модулях. Без сборщика, без фреймворка, без зависимостей в рантайме.

---

## Стек

| Слой | Технология |
|------|-----------|
| Хостинг | GitHub Pages (`public/` деплоится как есть) |
| Модули | ES-модули, без бандлера, без зависимостей в рантайме |
| Стили | `public/styles/cloud.css` — дизайн-токены + компоненты |
| Роутер | Hash-роутер (`#/feed`, `#/new`, …) |
| Состояние | `localStorage` (user + посты + черновик) |
| Офлайн | Service Worker, precache + offline fallback |
| PWA | `manifest.webmanifest`, PNG-иконки 192/512 (any + maskable) |
| CSP | Строгий без `unsafe-inline` |

---

## Структура

```
public/
  index.html              оболочка приложения (#shell + #app + tabbar + FAB)
  manifest.webmanifest    PWA-манифест
  sw.js                   Service Worker (precache v3)
  styles/
    cloud.css             дизайн-токены и компоненты Cloud Design
  src/
    app.js                bootstrap + регистрация SW + FAB-логика
    router.js             hash-роутер + welcome-gate + управление FAB/tabbar
    state.js              localStorage-обёртка (user)
    mock_api.js           seed-посты + listPosts / createPost
    util.js               escapeHtml
    screens/
      welcome.js          Welcome screen (первый запуск)
      feed.js             Feed screen (лента постов)
      composer.js         Composer screen (новое объявление)
      onboarding.js       Onboarding screen (создание профиля)
      profile.js          Profile screen
      rules.js            Rules screen
  icons/                  SVG-source + PNG 192/512 (any + maskable)
  assets/                 Копии иконок 192/512
  prototypes/             Визуальные эталоны (не кешируются SW)

scripts/
  check.mjs               CI-проверки: CSP-инварианты, JSON, синтаксис JS

.github/
  workflows/
    ci.yml                Статические проверки на push/PR
    pages.yml             Деплой public/ → GitHub Pages
  ISSUE_TEMPLATE/
    bug_report.yml
    feature_request.yml
    design_task.yml
```

---

## Cloud Design: токены

```css
--accent:  #FF6B35   /* оранжевый акцент */
--bg-0:    #0a0a0c   /* фон приложения */
--bg-1:    #131316   /* карточки */
--bg-2:    #1a1a1f   /* инпуты, вторичные кнопки */
--text:    #f3f3f5   /* основной текст */
--text-2:  #a8a8b3   /* вторичный */
--text-3:  #6c6c78   /* третичный / подсказки */
```

---

## Запустить локально

PWA требует `localhost` или HTTPS — Service Worker не регистрируется с `file://`.

```bash
# Python
python3 -m http.server 8000 --directory public

# Node
npx serve public
# или
npx http-server public -p 8000 -c-1
```

Открыть `http://localhost:8000/`.

## Тест на телефоне (та же сеть)

1. Узнайте IP: `ip a` / `ipconfig`
2. Откройте `http://<IP>:8000` в браузере телефона
3. Chrome/Safari покажет баннер «Добавить на экран» — установите как PWA

---

## Onboarding-гейт

- Гость может листать Feed, Rules и Profile-lite без регистрации.
- Onboarding запускается только при CTA-действиях (нажатие FAB `+`, переход в `/new`).
- После заполнения формы `pendingAction` возвращает пользователя ровно туда, откуда его унесли.

---

## Локальные проверки

```bash
node scripts/check.mjs
```

Проверяет: нет inline-`<script>`, `<style>`, `style=""`, `on*=` в `index.html`; валидный `manifest.webmanifest`; синтаксис всех `.js`.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) гоняет тот же скрипт на каждый PR.

---

## GitHub Pages

1. `Settings → Pages → Source → GitHub Actions`
2. При пуше в `main` workflow `pages.yml` деплоит папку `public/`
3. URL: `https://<org>.github.io/<repo>/`

## Roadmap

См. [ROADMAP.md](ROADMAP.md).
