# BD-TG-MINIAPP-01 — Telegram Mini App client contract

Status: contract-only / draft. Nothing below is shipped behavior. M1 and M2 implement it in later slices.

Gate: `BD-TG-MINIAPP-01-CONTRACT` (M0 of [#1126](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1126), part of [#635](https://github.com/iprus2026-tech/BazarDriveCloud/issues/635)).

Layers: PWA / Docs. No backend, no DB, no bot process.

Audited baseline: [`main@6351007ebf5e7bf6f7e83320f120c96d270ef5ba`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/6351007ebf5e7bf6f7e83320f120c96d270ef5ba).

## Scope and authority

This contract defines how the existing static PWA runs as the Mini App of the bot
`@BazarDriveBot`. It covers:

- launch-parameter capture;
- route restoration;
- per-tab storage;
- the bridge to the Telegram client;
- back navigation;
- viewport and safe area;
- colours;
- the manual verification checklist.

Decisions taken on 2026-10-24 that this contract follows:

- **Bridge.** We use our own minimal bridge. There is no Telegram SDK and no CSP or `public/index.html` change.
- **Client-only.** The work is verified on GitHub Pages with the backend OFF.
- **Mini App URL.** It is the application root, with no hash route.
- **Order.** M0 (this contract), then M1 (launch capture), then M2 (bridge). The security slices follow: [#1124](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1124), [#824](https://github.com/iprus2026-tech/BazarDriveCloud/issues/824), [#825](https://github.com/iprus2026-tech/BazarDriveCloud/issues/825), [#1125](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1125).

Out of this contract:

- sign-in with `initData` — BD-AUTH-TELEGRAM-01, [#1127](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1127);
- the bot transport — BD-TG-BOT-01, [#1128](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1128);
- tunnel hosting, Telegram theme adoption, fullscreen, CloudStorage, DeviceStorage and geolocation.

The new legacy document stays outside the document registry in this slice. Registration is a separate scope, and `UNACCOUNTED_DOCUMENT` is warn-only.

## Audited facts at the baseline

| Surface | Fact | Evidence |
|---|---|---|
| Router | The path is `location.hash` up to `?`. An unknown path falls back to `/feed`. Without `welcomeSeen`, every path redirects to `/welcome` except `/welcome` itself, dev/docs routes and an admission that sets `skipWelcome`. | `public/src/router.js:187-231`, `:210-212` |
| Boot | Before and after the router starts, `app.js` re-enters `go((location.hash \|\| '#/welcome').slice(1))`. | `public/src/app.js:379`, `:422` |
| Import order | No module reads `location.hash` at import time. Reads happen inside functions only. | grep over `public/src` |
| CSP | `script-src 'self'`; `connect-src 'self' https://*.mapbox.com`. The CSP lives in a `<meta>` only. | `public/index.html:13` |
| Framing | GitHub Pages sends no `X-Frame-Options` and no CSP header (`curl -I`, 2026-10-24). `frame-ancestors` is ignored in a `<meta>` CSP. helmet's `X-Frame-Options`/`frame-ancestors` apply to the API's JSON responses only. | `server/src/plugins/helmet.js` |
| Service worker | Registration is guarded by `'serviceWorker' in navigator`. `controllerchange` reloads the page. | `public/src/sw-update.js:4`, `:38-40` |
| Session token | `localStorage['bazardrive.auth.v1']`. | `public/src/auth_token.js:12` |
| Height | The shell uses `100dvh`. | `public/styles/cloud.css:72-73`, `:443`, `:491`, `:499` |
| Safe area | 45 uses of `env(safe-area-inset-*)`. | `public/styles/cloud.css` |
| Theme | Dark only. `--bg-0: #0a0a0c`, `--accent: #FF6B35`, no `prefers-color-scheme`. | `public/styles/cloud.css` `:root` |
| Mapbox | The committed token is honoured only on `iprus2026-tech.github.io`. On any other host the map shows its dark placeholder. | `public/src/mapbox/mapbox_config.js:37-50` |
| Geolocation | A stub. `navigator.geolocation` is never called. | `public/src/mapbox/geolocation_service.js` |
| Back controls | There is no shared selector. Ten screen modules label a back control `aria-label="Назад"`: onboarding (`#ob-back`), chat, composer, post detail, respond, responses (including its safety sheet), settings, trip confirmation, trip receipt, and the passenger active-ride safety sheet. | `public/src/screens/*` |
| Tab roots | `/feed`, `/map`, `/rules`, `/profile`. The driver's map tab is `/driver-map`. | `public/index.html` tabbar, `router.js:285` |

## Telegram facts this contract relies on

Sources: [core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps) and the official SDK `https://telegram.org/js/telegram-web-app.js`. The SDK was read as the reference implementation of the client protocol; it is not vendored.

### Launch parameters

- The client opens the Mini App URL with parameters in the hash:
  - `tgWebAppData` — the raw `initData`, URL-encoded;
  - `tgWebAppVersion`;
  - `tgWebAppPlatform`;
  - optional `tgWebAppThemeParams` (JSON).
- A `startapp` value arrives as the GET parameter `tgWebAppStartParam` and as `start_param` inside `initData`.
- The SDK parses either `#params` or `#path?params`. It keeps them in `sessionStorage['__telegram__initParams']` and never rewrites the hash.
- `initData` is empty for keyboard-button and inline-mode launches. The supported entries are Main Mini App, menu button, inline button and direct link.
- Client-side parsed `initData` fields (the SDK's `initDataUnsafe`) are never trusted. Only the server verifies `initData` ([#1127](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1127)).

### Transport

Outgoing events:

1. Mobile: `window.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData))`.
2. Windows Phone / legacy desktop: `window.external.notify(JSON.stringify({ eventType, eventData }))`.
3. Telegram Web iframe: `window.parent.postMessage(JSON.stringify({ eventType, eventData }), targetOrigin)`. The SDK posts `iframe_ready` (`{ reload_supported }`) once at start.

Incoming events:

- the client calls `window.Telegram.WebView.receiveEvent(eventType, eventData)`;
- in the iframe, `message` events come from `window.parent`.

### Events used by this contract

| Direction | Event | Payload | Min version |
|---|---|---|---|
| out | `web_app_ready` | — | — |
| out | `web_app_expand` | — | — |
| out | `web_app_request_viewport` | — | — |
| out | `web_app_request_theme` | — | — |
| out | `web_app_request_safe_area`, `web_app_request_content_safe_area` | — | 8.0 |
| out | `web_app_setup_back_button` | `{ is_visible }` | 6.1 |
| out | `web_app_set_background_color` | `{ color: '#rrggbb' }` | 6.1 |
| out | `web_app_set_header_color` | `{ color: '#rrggbb' }`; before 6.9 only `{ color_key }` | 6.9 for a hex colour |
| out | `web_app_setup_closing_behavior` | `{ need_confirmation }` | 6.2 |
| out | `web_app_setup_swipe_behavior` | `{ allow_vertical_swipe }` | 7.7 |
| in | `viewport_changed` | `{ height, is_expanded, is_state_stable }` | — |
| in | `safe_area_changed`, `content_safe_area_changed` | `{ top, bottom, left, right }` | 8.0 |
| in | `theme_changed` | `{ theme_params }` | — |
| in | `back_button_pressed` | — | 6.1 |

## M1 — launch capture

### Module and order

- A new module `public/src/telegram_launch.js` is the **first import** of `public/src/app.js`.
- ES modules evaluate in import order. The capture therefore runs before `router.js`, before the body of `app.js`, and before `start()`.
- The module imports nothing from the app (no router, no state), so importing it has no other side effects.

### Detection and parsing

- A Telegram launch is detected when the hash, without `#`, carries a non-empty `tgWebAppData` parameter.
- Both forms are accepted, as in the SDK:
  - `#tgWebAppData=…&…`;
  - `#<path>?tgWebAppData=…&…`.
- The module reads `tgWebAppData`, `tgWebAppVersion` and `tgWebAppPlatform`.
- The start parameter is `tgWebAppStartParam` from `location.search`; if absent, `start_param` inside `tgWebAppData`. It is used only to choose a route and is never trusted for anything else.
- Malformed input (no version or platform, an undecodable value) is not a Telegram launch. The module does nothing, and the router handles the hash exactly as today.

### Storage

Two per-tab `sessionStorage` keys. `localStorage` is never used for either.

| Key | Content | Lifetime and boundary |
|---|---|---|
| `bazardrive.tg_launch.v1` | `{ v: 1, version, platform, startParam, capturedAt }` — the launch environment, no identity data. | Transient per tab, like `bd-reloading`. Not user data, not cleared at logout. Classified as a dev/transient key in the static-data gate (`documented: false`, kept out of `storage_boundary.js`). |
| `bazardrive.tg_init_data.v1` | The raw `initData` string, unchanged. | Credential-like. Removed on every logout and local reset, so a logout never leads to a silent re-sign-in in the same tab. Classified as a boundary key: documented in `public/src/storage_boundary.js`, with the clear asserted by the gate. Nothing reads it before BD-AUTH-TELEGRAM-01 M5. |

### Route restoration

- After a successful capture the module rewrites the hash once, with `history.replaceState(null, '', location.pathname + location.search + '#' + target)`. This adds no history entry.
- The hash never carries `tgWebAppData` again.
- `target` comes from this allowlist only:

| Start parameter | Target |
|---|---|
| absent, empty or unknown | `/feed` |
| `feed` | `/feed` |
| `map` | `/map` |
| `rules` | `/rules` |
| `profile` | `/profile` |
| `post_<id>` with `<id>` matching `[A-Za-z0-9_-]{1,64}` | `/post?id=<id>` |

- The allowlist is the only mapping. A new target is a contract change.
- The restored route then goes through the router unchanged:
  - the first-run welcome guard still redirects to `/welcome`;
  - the driver order-flow redirect and admission still apply.
- M1 does not carry a start target past the welcome guard.

### Reload and outside Telegram

- **Reload.** After a reload (an SW `controllerchange`, pull-to-refresh) the hash no longer carries the parameters. The launch environment is read back from `bazardrive.tg_launch.v1`, and the capture does not run again.
- **Outside Telegram** (no `tgWebAppData` and no stored launch environment): the module writes nothing, rewrites nothing and exposes `null`.

### Read API (for M2 and later slices)

- `getTelegramLaunch()` returns a frozen `{ version, platform, startParam }` or `null`.
- `getTelegramInitData()` returns the stored raw string or `null`. Its only consumer is BD-AUTH-TELEGRAM-01 M5.

### Invariants

- The raw `initData` is never logged, never written to `localStorage`, never placed back in the URL and never sent anywhere in M1 or M2.
- No `initData` field (user, name, id) is parsed for display or decisions on the client.
- No CSP, `index.html`, router or guard change.

## M2 — bridge

### Module and transport

- A new module `public/src/telegram_bridge.js` is active only when `getTelegramLaunch()` is not `null`. Outside Telegram it does nothing and defines no globals.
- Transport selection, in order:
  1. `window.TelegramWebviewProxy.postEvent` exists → native proxy.
  2. `window.external` exposes `notify` → `window.external.notify`.
  3. `window.parent !== window` → Telegram Web iframe. The target origin is `https://web.telegram.org` (the SDK uses `*`; we do not). `iframe_ready` with `{ reload_supported: false }` is posted once, since `reload_iframe` is not implemented.
  4. Otherwise → no transport. The app works as a normal PWA.

### Incoming events

- **Native and legacy clients.** The bridge defines `window.Telegram.WebView.receiveEvent(eventType, eventData)` only inside Telegram.
- **Iframe.** It accepts a `message` only when `event.source === window.parent` and `event.origin === 'https://web.telegram.org'`, and the data parses as JSON with a string `eventType`. Everything else is ignored.
- Payloads are validated by shape. Numbers must be finite and non-negative. An invalid payload is ignored.

### Startup sequence (once, after the router has started)

Steps 4–6 are version-gated per the event table:

1. `web_app_request_theme`
2. `web_app_request_viewport`
3. `web_app_request_safe_area` and `web_app_request_content_safe_area` (8.0+)
4. Colours:
   - `web_app_set_background_color` with `--bg-0` (`#0a0a0c`), 6.1+;
   - `web_app_set_header_color` with `{ color: '#0a0a0c' }`, 6.9+ only. Below 6.9 the header event is not sent, so Telegram keeps its own header colour. A `color_key` is not used: it follows Telegram's theme, which may be light while the app is dark.
5. `web_app_setup_swipe_behavior` with `{ allow_vertical_swipe: false }` (7.7+), so map pans and list scrolls do not collapse or close the app
6. `web_app_expand`
7. `web_app_ready`

Version comparison is numeric per dot segment of `tgWebAppVersion`. An event below its minimum version is not sent.

### Viewport and safe area

- The bridge marks `<html>` with the class `bd-telegram` and maintains these CSS custom properties on `document.documentElement`:
  - `--bd-tg-viewport-stable-height`: the last `viewport_changed.height` with `is_state_stable: true`, in px;
  - `--bd-tg-safe-top|right|bottom|left`;
  - `--bd-tg-content-safe-top|right|bottom|left`, in px.
- `public/styles/cloud.css` uses them only under `.bd-telegram`:
  - the shell height becomes `var(--bd-tg-viewport-stable-height, 100dvh)`;
  - insets become `max(env(safe-area-inset-*), var(--bd-tg-*-…, 0px))`.
- Outside Telegram no rule changes.

### Back navigation

- **Visibility.** It follows the route the router actually rendered, not the raw hash:
  - an unknown path renders the `/feed` fallback and keeps its hash (`public/src/router.js:227-231`), so it counts as `/feed`;
  - `/order/<id>` counts as `/order`.
  
  `web_app_setup_back_button` is `{ is_visible: false }` when the rendered route is one of the roots `/welcome`, `/feed`, `/map`, `/driver-map`, `/rules`, `/profile`, and `{ is_visible: true }` otherwise. It is re-evaluated after every mount.
  
  For this, M2 adds one read-only router seam: the rendered route plus a notification after each mount. Routing behaviour does not change.
- **`back_button_pressed`** acts like the screen's own back control:
  1. If a visible `[aria-label="Назад"]` control exists in the current screen, the bridge activates the topmost one (the last visible one in document order). This keeps every screen's existing semantics, including onboarding step Back versus root abandonment.
  2. Otherwise, if the app has navigated within this launch, it calls `history.back()`. Launch depth is tracked in memory, so it never steps out of the launch.
  3. Otherwise it navigates to the role's root tab: `/driver-map` in driver mode, `/feed` otherwise.
- **Known limitation.** On a root path the Telegram back button is hidden even while a sheet is open there. The hardware back may then close the Mini App. To verify on devices.

### Closing confirmation

Requires 6.2+. Telegram keeps the last closing-behaviour setting, so it is not part of the one-time startup sequence. After every mount, `web_app_setup_closing_behavior` is sent from the rendered route, the same one the back button uses:

- `{ need_confirmation: true }` only for `/active-ride`;
- `{ need_confirmation: false }` for every other rendered route, including the `/feed` fallback and `/order/<id>` rendered as `/order`.

### Colours and theme

- The app keeps its own dark palette. `themeParams` and `theme_changed` are not adopted.
- The background (6.1+) and the header (6.9+ only, see the startup sequence) are set to `#0a0a0c`, so the Telegram chrome matches the app.

### Non-goals in M2

MainButton and SecondaryButton, SettingsButton, fullscreen, haptics, CloudStorage, DeviceStorage and SecureStorage, `requestContact` (that is the bot's, [#1128](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1128)), LocationManager, popups and QR.

## Hosting and BotFather — the owner's steps, not code

- **Mini App URL** (Main Mini App and/or Menu Button): `https://iprus2026-tech.github.io/BazarDriveCloud/`. It is the root, with no `#/route`.
  - BotFather accepts only https URLs (observed practice; the docs do not state it).
  - How clients merge their hash with an existing one is undocumented, so the URL must not carry one.
- **Start links.** Per the BotFather configuration:
  - Main Mini App: `https://t.me/BazarDriveBot?startapp=<param>`;
  - a named app: `https://t.me/BazarDriveBot/<short_name>?startapp=<param>`.
  - `<param>` comes from the allowlist above.
- **Tokens.** No bot token or server is needed for M0–M2. The token is never placed in the PWA, the repo or screenshots.
- **Mapbox.** Works on the Pages origin. Any other host shows the dark map placeholder by design.

## Manual verification checklist (against GitHub Pages, backend OFF)

Run on Android, iOS, Telegram Desktop and Telegram Web (`/k` and `/a`):

| # | Check | Expected |
|---|---|---|
| 1 | First launch from the bot | Welcome screen. No junk hash. The app opens expanded. |
| 2 | Relaunch after the welcome | `/feed`. |
| 3 | `startapp=map`, `startapp=post_<id>`, `startapp=bogus` | `/map`; the post; `/feed`. |
| 4 | Vertical drag on the map and a long list | The app neither closes nor collapses. |
| 5 | Telegram back on post detail, chat, onboarding step 2 | Same result as the screen's «Назад». |
| 6 | Telegram back on `/feed` | The button is hidden. |
| 7 | Trying to close during `/active-ride` | Confirmation is asked. |
| 8 | Reload (pull-to-refresh / SW update) | Same screen, still treated as a Telegram launch. |
| 9 | iPhone with a notch | No content under the status bar or home indicator. |
| 10 | Telegram Web iframe | The app loads (no frame block); events work. |
| 11 | The same URL in a normal browser | Behaviour unchanged. No `bd-telegram` class, no `bazardrive.tg_*` keys. |

## Acceptance and smoke plan

**M1 — `scripts/smoke-telegram-launch.mjs`.** Node only, with fake `location`, `history` and `sessionStorage`. It pins:

- a Telegram hash yields both keys and a single `replaceState` to the mapped target;
- each allowlist row, and an unknown or malformed start parameter, yields `/feed`;
- a malformed launch and a non-Telegram hash produce no writes and no rewrite;
- a reload reads the stored environment without a new capture;
- `app.js` imports `telegram_launch.js` first;
- the module contains no `console` call that could carry `initData`;
- the static-data gate classifies both keys as above, and a logout clears `bazardrive.tg_init_data.v1`.

**M2 — `scripts/smoke-telegram-bridge.mjs`.** It pins:

- transport selection, including the iframe target origin;
- incoming source and origin checks;
- version gating;
- the startup sequence order;
- BackButton visibility per rendered route, including an unknown hash that renders the `/feed` fallback (hidden);
- back-press resolution (labelled control, then launch history, then the role root);
- closing behaviour re-sent after every mount by rendered route (true only on `/active-ride`, false after leaving it and on the `/feed` fallback);
- CSS variables and `bd-telegram` set only inside Telegram.

**Negative controls.** Each new smoke must fail against the baseline runtime and pass with the slice.

**Precache.** Each new module goes into `public/sw.js` PRECACHE with a VERSION bump (sw-offline-agent).

## Implementation and release boundary

| Slice | Files | Not touched |
|---|---|---|
| M0 | this document | everything else |
| M1 | `public/src/telegram_launch.js` (new), `public/src/app.js` (first import), `public/src/storage_boundary.js`, `scripts/smoke-static-data-inventory.mjs` (manifest), `scripts/smoke-telegram-launch.mjs` (new), `scripts/check.mjs` (register), `public/sw.js` (PRECACHE + VERSION) | `index.html`, CSP, `router.js`, guards, backend |
| M2 | `public/src/telegram_bridge.js` (new), `public/src/app.js` (init after `start()`), `public/src/router.js` (read-only seam only: rendered route + after-mount notification), `public/styles/cloud.css` (rules under `.bd-telegram` only), `scripts/smoke-telegram-bridge.mjs` (new), `scripts/check.mjs`, `public/sw.js` | `index.html`, CSP, routing behaviour and guards, screens, backend |

M0 release impact: none at runtime. Docs/reference only. No cache, service worker or CSP impact.

## Open points to verify on devices

- Whether iOS WKWebView in Telegram exposes a service worker (expected: no; the app must not depend on it).
- Whether `localStorage` persists across launches on each platform. The session must be treated as short-lived (BD-AUTH-TELEGRAM-01 re-signs in from `initData`).
- How Telegram Web reacts to `iframe_ready` with `reload_supported: false`.
- What the hardware back does with the BackButton hidden on each platform.
- Whether Mapbox URL restrictions see the page origin as `Referer` inside Telegram webviews.
- Whether direct-link launches carry `user` in `initData` (relevant to [#1127](https://github.com/iprus2026-tech/BazarDriveCloud/issues/1127)).
