# BazarDrive

PWA для объявлений и сообщества водителей. Без шума и накруток.

Phase 1 — каркас на vanilla HTML / CSS / ES-модулях. Без сборщика, без фреймворка, без зависимостей в рантайме.

## Стек

- Static-host: всё лежит в [public/](public/), эта папка деплоится как есть на GitHub Pages.
- ES-модули с относительными путями (`./src/...`).
- Service Worker с precache + offline fallback.
- localStorage для состояния пользователя, черновика и mock-постов.
- Строгий CSP без `unsafe-inline`: никаких `<script>` в HTML, `onclick=""`, `<style>`, `style=""`.

## Структура

```
public/
  index.html              static root
  manifest.webmanifest    PWA-манифест (PNG-иконки)
  sw.js                   Service Worker
  styles/cloud.css        дизайн-токены и компоненты
  src/
    app.js                bootstrap + регистрация SW
    router.js             hash-router + welcome-gate
    state.js              user.welcomeSeen / user.onboarded
    mock_api.js           seed posts + listPosts/createPost
    util.js               escapeHtml
    screens/              welcome / feed / rules / profile / onboarding / composer
  icons/                  SVG-source + PNG 192/512 (any + maskable)
  prototypes/             визуальный референс — не часть рантайма
scripts/
  check.mjs               статические проверки для CI
  build_icons.py          PNG из SVG через Pillow
.github/
  workflows/              CI + Pages
  ISSUE_TEMPLATE/         bug / feature / design
```

## Запустить локально

PWA требует `localhost` или HTTPS — Service Worker не регистрируется с `file://`.

```powershell
# Python
python -m http.server 8000 --directory public

# или Node
npx http-server public -p 8000 -c-1
```

Открыть http://localhost:8000/.

## Гость и onboarding

- После Welcome (`user.welcomeSeen = true`) гость может листать Feed, Rules и Profile-lite без регистрации.
- Onboarding запускается только из CTA-действий, в первую очередь "Опубликовать объявление" (`#/new`). После заполнения формы pendingAction возвращает пользователя ровно туда, откуда его унесли.

## Локальные проверки

```bash
node scripts/check.mjs
```

Проверяет:
- В `index.html` нет inline `<script>`, `<style>`, `style=""`, `onclick=""`.
- `manifest.webmanifest` — валидный JSON с обязательными полями.
- Прототип не попал в precache `sw.js`.
- Все JS-файлы парсятся (`node --check`).

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) гоняет тот же скрипт на каждый PR.

## Иконки

SVG в [public/icons/](public/icons/) — source. PNG (192/512, any + maskable) генерируются скриптом:

```bash
python scripts/build_icons.py
```

Манифест ссылается только на PNG. Favicon в `index.html` — SVG, как resolution-independent fallback.

## Деплой

[.github/workflows/pages.yml](.github/workflows/pages.yml) пушит [public/](public/) на GitHub Pages при пуше в `main`. Включить Pages в настройках репозитория → Source: GitHub Actions.

## Roadmap

См. [ROADMAP.md](ROADMAP.md).
