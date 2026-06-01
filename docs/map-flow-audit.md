# Map flow audit — #325 (BD-MAP-FLOW-AUDIT-01)

Аудит текущего map-flow против Cloud Design render states. Это
flashlight-проход: фиксирует что работает, что отличается, и что
требует маленьких follow-up PR. Функциональный код экранов в рамках
аудита не менялся.

- Issue: #325 — BD-MAP-FLOW-AUDIT-01 Map flow audit against Cloud Design
- Audit branch: `audit/map-flow-cloud-design`
- Docs-sync branch (этот PR): `docs/map-flow-contract-sync`
- Дата: 2026-06-01

## Проверенные routes

```text
/map
/location-permission
/route-picker
/route-preview
/order-map-draft
/driver-map
/feed       (bottom-nav «Карта» entry + driver redirect target)
/profile    (edit-phone handoff target)
```

## Current status per screen

| Screen | Route | Exists | Cloud Design match | Notes |
|---|---|---|---|---|
| BD-MAP-01 MapHome | /map | ✅ | High | 5 render-gate states (default / permission / denied / nearby / token_missing) с верным приоритетом (token > denied > permission > default); bottom action card; «Выбрать маршрут» → /route-picker |
| BD-MAP-02 LocationPermission | /location-permission | ✅ | High | объясняет ценность гео; mock-allow пишет только `locationAllowed`; ручной fallback; нет нативного prompt |
| BD-MAP-03 RoutePicker | /route-picker | ✅ | High | pickup/dropoff, search, manual form, clear; персист `bazardrive.route_draft.v1`; malformed safe reset; /active-ride guard; handoff → /route-preview |
| BD-MAP-04 RoutePreview | /route-preview | ✅ | High | valid / missing / malformed; summary + distance/duration/price; «Создать заказ» → /order-map-draft; read-only |
| BD-MAP-05 OrderMapDraft | /order-map-draft | ✅ | High | now/later/price/comment, validation, publish never silent (notice + pointerup fallback + dedup); createRideOrder() handoff; success state |
| BD-DRIVER-01 DriverMap | /driver-map | ✅ | High | role guard по `user.get().role` (URL-override-proof); passenger/guest fallback; list/empty/accepted; accept → /active-ride?role=driver |

## Safety boundaries — clean

| Boundary | Result |
|---|---|
| Real Mapbox SDK | не загружается — `mapbox_loader.js` no-op (`Promise.resolve(null)`), без инъекции `<script>` |
| Mapbox token / network | `mapbox_config.hasMapboxToken()` → false; нет `api.mapbox.com` / `tiles.mapbox.com` / `events.mapbox.com` |
| Native geolocation | `geolocation_service.js` не вызывает `navigator.geolocation`; возвращает `'unknown'` |
| CSP | `public/index.html` не изменён — `default-src 'self'`, `connect-src 'self'`, без mapbox-хостов |
| SW precache | все 6 экранов + 4 CSS присутствуют в `public/sw.js` |
| active_ride.js / ride_state.js | не модифицированы; route-picker только читает active-ride record для guard |
| inline script/style | отсутствуют |

## node scripts/check.mjs

```text
All checks passed.   (exit 0)
```

## Найденные gaps (конкретные)

- **BD-MAP-01:** token-missing action card показывал техническую копию
  пользователю (`token_missing`, `Fallback`, `Issue #105`) вместо Cloud
  passenger-копии. *Закрыто PR1 (`fix/bd-map-01-token-copy-polish`):*
  badge → «Демо-режим», title → «Карта временно недоступна», подзаголовок →
  «Можно выбрать маршрут вручную — заказ всё равно сохранится», CTA →
  «Выбрать маршрут» / «Ввести адрес вручную»; технический meta-card удалён.
- **BD-MAP-02:** экран реализован, но контракт отсутствовал в
  `docs/screen-contracts.md`. *Закрыто этим PR.*
- **BD-MAP-03:** контракт был помечен `implementation not started`,
  «no app.js registration», «no localStorage persistence» — противоречил
  реальному коду (экран реализован, зарегистрирован, персистит
  `route_draft.v1`). *Закрыто этим PR.*
- **BD-MAP-04:** экран реализован, но контракт отсутствовал в
  `docs/screen-contracts.md`. *Закрыто этим PR.*
- **BD-MAP-05:** wrapper `order_map_draft_handoff.js` — dead code:
  `localizeSuccessStatus` ждёт `textContent === 'CREATED'`, а
  `bindResponsesHandoff` ждёт `data-action="responses"`; базовый экран
  рендерит pill как `ОПУБЛИКОВАН` и success CTA как `data-action="my-order"`,
  поэтому оба хука не срабатывают. Безопасно, но вводит в заблуждение.
  *Low — cleanup, не функциональный баг.*
- **BD-DRIVER-01:** driver guard корректен и устойчив к URL-override
  (читает только `user.get().role`, игнорирует hash). Passenger не может
  достучаться до accept-actions. *No fix needed.*

## Follow-up PR

```text
PR1  BD-MAP-01 copy polish     — ✅ выполнено: dev-строки token-missing card
                                 заменены на passenger-копию (Cloud Design)
PR2  BD-MAP-05 wrapper cleanup — удалить/исправить dead-code хуки
                                 localizeSuccessStatus / bindResponsesHandoff
PR3  BD-DRIVER-01 guard smoke  — регрессионный тест: #/driver-map?role=driver
                                 у пассажира по-прежнему рендерит guard
PR4  docs sync                 — этот PR: BD-MAP-02 / BD-MAP-04 контракты +
                                 исправление stale BD-MAP-03 + этот документ
```

## Ограничения соблюдены

Docs-only PR. Не изменялись: `public/src/screens/*.js`, `public/styles/cloud.css`,
`public/sw.js`, `public/src/app.js`, `public/src/router.js`. Без функциональных
правок, без Mapbox SDK, без backend, без изменений CSP, без inline script/style.
