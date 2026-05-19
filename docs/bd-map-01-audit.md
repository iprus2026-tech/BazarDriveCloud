# BD-MAP-01 — MapHome foundation post-merge audit

**Branch audited:** `main` @ `2bb0b6d` (PR #142,
"feat: implement BD-MAP-01 MapHome foundation with render-gate states")
**Audit branch:** `claude/audit-maphome-merge-LgH2k`
**Date:** 2026-05-19
**Scope:** read-only verification. No app code, CSS, CSP, or
`active_ride*.js` was touched.

## 1. `/map` route

| Check | File:line | Result |
|---|---|---|
| Screen module exists | `public/src/screens/map.js:1-384` | OK |
| Default export = screen factory | `public/src/screens/map.js:330` | OK |
| Registered in router | `public/src/app.js:20` — `register('/map', map)` | OK |
| Reachable from tabbar | `public/index.html:29` — `data-route="/map"` | OK |
| Chrome behaviour | `public/src/router.js:6` — `HIDE_CHROME` does NOT include `/map`, so tabbar stays visible | OK |

`go('/map?state=…')` is used by the screen itself to flip render-gate
states; the router parses the path before `?` (`router.js:31`) so the
querystring is preserved in `location.hash` for the screen to read via
`getHashQuery()` (`map.js:67-71`).

## 2. Five render-gate states

Canonical states are declared in
`public/src/mapbox/mapbox_state.js:7-13`:

```
MAP_STATE = { DEFAULT, PERMISSION, DENIED, NEARBY, TOKEN_MISSING }
```

`isValidMapState()` (`mapbox_state.js:38`) gates external override keys.
The `?state=` query whitelist in `map.js:18-25` allows
`default | permission | denied | nearby | token-missing | token_missing`.

| State | Resolver path | Action card builder | Map placeholder modifier |
|---|---|---|---|
| `default` | fallback when token present & permission granted (`map.js:89`) | `buildDefaultCard()` `map.js:179` | route + car + pickup + dropoff |
| `permission` | no `locationAllowed` pref AND `getPermissionStatus()` ∈ {UNKNOWN, PROMPT} (`map.js:86-88`) | `buildPermissionCard()` `map.js:198` | car only |
| `denied` | `getPermissionStatus() === DENIED` (`map.js:85`) | `buildDeniedCard()` `map.js:225` | car only |
| `nearby` | `?state=nearby` override (`map.js:79-82`) | `buildNearbyOrdersCard()` `map.js:257` | overlay with 5 numbered clusters + pulse |
| `token_missing` | `!hasMapboxToken()` (`map.js:83`) — token check wins over permission state | `buildTokenMissingCard()` `map.js:292` | lock SVG, no car |

Decision tree priority is documented in `map.js:73-90`:
override → token → geolocation permission → default.
Because `hasMapboxToken()` returns `false` in the stub
(`mapbox_config.js:17-19`), the natural runtime state on a fresh
install is `token_missing`; the other states surface only via `?state=`
override or via the explicit "Моё место" pref flip
(`map.js:367` writes `locationAllowed: true`, then re-renders).

Counter copy in the `nearby` card reads "5 заказов рядом"
(`map.js:273-278`) — a deliberate 5-vs-3 asymmetry (5 numbered
clusters on the map, top 3 fit in the bottom card). The
explanatory comment is `map.js:270-272`.

All five card builders share `makeCardRoot()` (`map.js:172`), and
data-action targets (`route`, `manual`, `my-location`, `nearby`,
`feed`, `settings`) are handled in the delegated click listener
`map.js:359-381`. `settings` is a deliberate no-op stub (no real
deep link from a PWA shell).

## 3. Bottom navigation order

`public/index.html:19-53` declares the tabbar in this order:

| # | Route | Label | Source |
|---|---|---|---|
| 1 | `/feed` | Лента | `index.html:20-28` |
| 2 | `/map` | Карта | `index.html:29-36` |
| 3 | `/rules` | Правила | `index.html:37-45` |
| 4 | `/profile` | Профиль | `index.html:46-52` |

Matches the required `Лента | Карта | Правила | Профиль` order.

`syncTabActive()` (`router.js:63-67`) toggles `.active` on the matching
`[data-route]` button after each navigation.

## 4. Service worker `v25` and precache

`public/sw.js:1`:

```
const VERSION = 'v25';
const CACHE_NAME = 'bazardrive-v25';
```

Bumped from `v24` (introduced by PR #139) to `v25` as part of the
MapHome merge (`git show 2bb0b6d -- public/sw.js`).

PRECACHE list (`sw.js:4-42`) covers every `.js` under `public/src/`:

- App shell — `./`, `./index.html`, `./manifest.webmanifest`
- Styles — `./styles/cloud.css`, `./styles/driver_sheets.css`
- Core — `app.js`, `router.js`, `state.js`, `util.js`, `mock_api.js`, `sw-update.js`, `ride_state.js`
- Screens (13) — `welcome`, `feed`, `map`, `rules`, `profile`, `onboarding`, `composer`, `respond`, `chat`, `active_ride`, `active_ride_passenger`, `responses`, `trip_confirmation`
- Mapbox stubs (7) — `map_shell`, `mapbox_config`, `mapbox_loader`, `mapbox_state`, `geolocation_service`, `route_service`, `price_estimator`
- Icons / assets

Cross-checked against `find public/src -name '*.js'`: every JS module
in the tree is listed in PRECACHE. No drift.

Activation handler (`sw.js:54-62`) deletes every cache whose key is not
`bazardrive-v25`, so the v24 cache is cleaned on activate.

Fetch handler (`sw.js:64-83`) is same-origin only
(`url.origin !== self.location.origin` short-circuits external
requests), and skips `/prototypes/` paths.

## 5. No real Mapbox SDK / domains / token

Static search for any external Mapbox surface
(`mapbox-gl`, `api.mapbox.com`, `events.mapbox.com`, `mapbox.com`,
`pk.eyJ`, `sk.eyJ`, `MAPBOX_TOKEN`, `access_token`) across
`public/**/*.{js,html,css,json,webmanifest}`:

- Only hit: `public/src/mapbox/mapbox_loader.js:2` — a comment that
  reads "No-op. Does not fetch mapbox-gl…". No actual fetch / import.

Stub contracts:

| Module | Surface | Behaviour |
|---|---|---|
| `mapbox_config.js:13-19` | `getMapboxToken()`, `hasMapboxToken()` | returns `null` / `false` |
| `mapbox_loader.js:11-21` | `loadMapboxSdk()`, `isMapboxSdkLoaded()`, `unloadMapboxSdk()` | resolves `null` / `false` / no-op |
| `geolocation_service.js:17-23` | `getPermissionStatus()`, `requestPosition()` | returns `'unknown'` / resolves `null`; documents that `navigator.geolocation` is **not** invoked |
| `mapbox_state.js` | local prefs only | `localStorage` key `bazardrive.map_prefs.v1` |
| `route_service.js`, `price_estimator.js` | mock-only | no network |

`map.js` itself reads from these stubs only; the only side-effect on
mount is `saveMapPrefs` when the user clicks "Моё место" — pure
`localStorage`, no native prompt.

CSP unchanged (`index.html:7-8`):

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data:; font-src 'self'; connect-src 'self';
manifest-src 'self'; worker-src 'self'; base-uri 'none';
object-src 'none'; form-action 'none';
```

No `https://*.mapbox.com`, no `'unsafe-eval'`, no `blob:` worker
source. The CSP would actively block the real SDK if it were ever
loaded — which confirms the "stub only" posture.

## 6. Active ride screens not regressed

`git diff 2bb0b6d^..2bb0b6d -- public/src/screens/active_ride.js public/src/screens/active_ride_passenger.js`
returns **empty** — the MapHome merge did not touch either file.

Spot-check of `active_ride.js`:

- Import surface intact (`active_ride.js:1-20`): imports
  `createMapShell` from `../mapbox/map_shell.js` (still present,
  unchanged by the merge — verified via `git log` on `map_shell.js`,
  no commits in the MapHome PR range).
- Routes registered (`app.js:14, 27`): `import activeRide` and
  `register('/active-ride', activeRide)` — unchanged.
- Chrome rules (`router.js:6`): `/active-ride` and
  `/trip-confirmation` still in `HIDE_CHROME` — tabbar stays hidden
  on those screens, MapHome did not alter that set.
- Precache (`sw.js:25-26`): both `active_ride.js` and
  `active_ride_passenger.js` remain in the offline manifest.
- The existing legacy notice strings ("Детальная карта будет доступна
  после Mapbox integration", "Навигатор будет доступен после Mapbox
  integration" at `active_ride.js:471, 482, 513`) are untouched and
  remain stubs — no behavioural change.

No regression introduced by BD-MAP-01.

## Conclusion

All six post-merge audit items pass:

1. `/map` route is registered, reachable from the tabbar, and uses
   the documented render-gate decision tree.
2. The five render-gate states (`default`, `permission`, `denied`,
   `nearby`, `token_missing`) are implemented end-to-end, with
   token-missing correctly winning priority over permission state.
3. Bottom nav order matches `Лента | Карта | Правила | Профиль`.
4. Service worker is at `v25` and precaches the full module + styles
   surface, including the new `mapbox/*` stubs and `screens/map.js`.
5. No real Mapbox SDK, domain, or token is present in the bundle;
   CSP is unchanged and would block one anyway.
6. `active_ride.js` and `active_ride_passenger.js` are byte-identical
   to the pre-merge revision.

Open items (out of scope for BD-MAP-01, tracked elsewhere):

- BD-MAP-FOUND-01 will need to extend CSP (`script-src`,
  `connect-src`, `worker-src`, possibly `style-src 'unsafe-inline'`)
  before the real Mapbox SDK can load.
- `/route-picker` is referenced by the MapHome card actions
  (`map.js:371-375` comment) but is not yet registered — both
  "Выбрать маршрут" and "Ввести вручную" currently rest at `/map`.
- The `settings` action in the `denied` card is a deliberate no-op
  (`map.js:379-381`); a real "open browser settings" deep link
  is not available in a PWA shell.
