# Ride history + favorite routes — end-to-end QA audit

GitHub issue: [BD-RIDE-HISTORY-08 #192](https://github.com/iprus2026-tech/BazarDriveCloud/issues/192)

Audit branch: `audit/ride-history-favorites-e2e-qa`
Baseline: `main` @ a1ead8c (latest at audit start)

## Scope

QA / documentation pass over the local-only ride-history and favorite-routes
loop. No new features. No backend, no Mapbox, no auth, no native, no CSP
changes.

Flow under audit:

```
completed ride
  → /profile (history)
  → receipt detail
  → repeat route
  → /new (composer prefill)
  → favorite route
  → edit / reset favorite label
  → repeat favorite
  → logout / reset boundary
```

## Files inspected

| File                                             | Role in loop                                         |
| ------------------------------------------------ | ---------------------------------------------------- |
| `public/src/screens/active_ride.js`              | Driver COMPLETED → `buildDriverHistoryEntry` save    |
| `public/src/screens/active_ride_passenger.js`    | Passenger COMPLETED → baseline + rating-merge save   |
| `public/src/screens/profile.js`                  | History list, role-aware receipt, repeat-route entry |
| `public/src/screens/composer.js`                 | One-time repeat-route prefill + collision rule       |
| `public/src/ride_history.js`                     | LocalStorage store + status-aware reader             |
| `public/src/repeat_route.js`                     | Sanitized one-time route bridge                      |
| `public/src/favorite_routes.js`                  | Favorites store, label edit/reset, repeat bridge     |
| `public/src/storage_boundary.js`                 | Centralised clear-on-boundary                        |
| `public/styles/cloud.css`                        | History / favorite / composer-prefill styles         |
| `public/sw.js`                                   | Precache list (includes both new modules)            |

## Storage keys in scope

| Key                                       | Owner                | Cleared by `clearUserScopedStorage` |
| ----------------------------------------- | -------------------- | ----------------------------------- |
| `bazardrive.ride_history.v1`              | `ride_history.js`    | yes (`clearRideHistory`)            |
| `bazardrive.repeat_route.v1`              | `repeat_route.js`    | yes (`clearRepeatRouteDraft`)       |
| `bazardrive.favorite_routes.v1`           | `favorite_routes.js` | yes (`clearFavoriteRoutes`)         |
| `bazardrive.favorite_route_notice.v1`     | `favorite_routes.js` | yes (transitively via `clearFavoriteRoutes`) |

## 1. Passenger completed ride → history

| # | Step | Expected | Observed | Pass |
| - | ---- | -------- | -------- | ---- |
| 1.1 | Open `/active-ride?role=passenger&status=COMPLETED` | Passenger COMPLETED screen renders (rating UI, summary) | `active_ride_passenger.js:181` coerces to COMPLETED; `persistHistory()` is invoked unconditionally at render time | ✅ |
| 1.2 | Baseline history entry written before rating | `buildPassengerHistoryEntry(ride)` written immediately on mount | `active_ride_passenger.js:1201` — baseline persisted with empty rating/tags/comment | ✅ |
| 1.3 | Submit rating | Same `tripId`/`role` upserted with `rating`, `tags[]`, `comment` | `active_ride_passenger.js:1138` — `persistHistory({withRating:true})` merges, `saveRideHistoryEntry` upsert at `ride_history.js:73` preserves original `savedAt` | ✅ |
| 1.4 | Open `/profile` | "История поездок" surfaces newest-first | `profile.js:1346` `historySectionHtml()` reads via `readRideHistoryStatus`, sorts desc, slices to 20 | ✅ |
| 1.5 | Tap card → receipt overlay | Role-aware "Чек пассажира" sheet opens (driver / vehicle / fare / rating / comment / completedAt) | `profile.js:1479` `passengerDetailRowsHtml` | ✅ |
| 1.6 | Receipt content is passenger-safe | No earnings, no commission, no payment, no chat | confirmed — `passengerDetailRowsHtml` omits earnings; entry shape excludes payment / chat fields | ✅ |

## 2. Driver completed ride → history

| # | Step | Expected | Observed | Pass |
| - | ---- | -------- | -------- | ---- |
| 2.1 | Open `/active-ride?role=driver&status=COMPLETED` | Driver COMPLETED card renders (passenger card, summary, earnings) | `active_ride.js:524` `renderCompleted` | ✅ |
| 2.2 | History entry written on render | `buildDriverHistoryEntry(ride, {earnings:{...}})` upserted | `active_ride.js:532–540`; badge `data-history-saved` flips to `true` on success | ✅ |
| 2.3 | `/profile` shows driver card | Card carries role badge "Водитель", route, passenger name, fare, "Доход" net | `profile.js:1259` `driverHistoryEntryHtml` | ✅ |
| 2.4 | Receipt is role-aware | "Чек водителя" with passenger / fare / Доход / distance / duration / completedAt | `profile.js:1504` `driverDetailRowsHtml` | ✅ |
| 2.5 | Earnings fallback-friendly | Missing `earnings.net` row is silently dropped (no NaN, no "—") | `detailRowHtml` returns `''` on empty value; `formatHistoryFare` accepts numbers and strings | ✅ |
| 2.6 | No passenger-private fields in driver receipt | No `passenger.phoneMasked`, no rating-comment block | `driverDetailRowsHtml` does not emit them; entry builder only copies `passenger.{name,initials,rating}` | ✅ |

## 3. Repeat route from receipt

| # | Step | Expected | Observed | Pass |
| - | ---- | -------- | -------- | ---- |
| 3.1 | Action visible only when route usable | `Повторить маршрут` hidden if pickup or dropoff missing | `profile.js:1532` gates on `buildRepeatRouteDraft(entry)` (returns `null` without pickup+dropoff) | ✅ |
| 3.2 | Click writes a sanitised draft | `bazardrive.repeat_route.v1` contains `{role,pickup,dropoff,suggestedFare?}` only | `repeat_route.js:75–85` `buildRepeatRouteDraft` strips everything else; numeric fare parsing rejects ranges (`-`) and non-numeric strings | ✅ |
| 3.3 | Navigates to `/new` | Composer mounts and consumes draft once | `profile.js:1599` writes then `go('/new')`; `composer.js:241` `consumeRepeatRouteDraft` is read-and-remove | ✅ |
| 3.4 | Identity / settlement fields stripped | No driver, passenger, vehicle, chat, rating, comment, payment, earnings, completedAt, status copied into composer | only `role`, `pickup`, `dropoff`, `suggestedFare` cross — verified in `repeat_route.js` and `composer.js:61` `applyRepeatRoute` | ✅ |
| 3.5 | Existing draft not silently overwritten | If `bazardrive.draft.v2` has data, prefill is dropped and a "draft kept" notice shows | `composer.js:243–252` collision rule + `repeatNotice='kept'` branch | ✅ |
| 3.6 | One-time consumption | Re-entering `/new` after consuming yields no prefill, no notice | `consumeRepeatRouteDraft` removes the key even on malformed payload (`repeat_route.js:110`) | ✅ |
| 3.7 | User must manually publish | No auto-submit, no order created | composer factory only sets form fields and shows note; submission still requires the existing publish flow | ✅ |
| 3.8 | Driver vs passenger role mapping | Driver completed → composer `type='trip'` (price); passenger completed → `type='passenger'` (budget) | `composer.js:61–71` `applyRepeatRoute` | ✅ |

## 4. Favorite routes

| # | Step | Expected | Observed | Pass |
| - | ---- | -------- | -------- | ---- |
| 4.1 | Receipt offers save-to-favorites | `☆ В избранные` injected into detail actions when route usable | `favorite_routes.js:361` `injectFavoriteAction` gated by `buildRepeatRouteDraft(currentHistoryEntry)` and dedupes via `data-favorite-enhanced='1'` | ✅ |
| 4.2 | Duplicate save merges, no extra card | Re-saving same pickup→dropoff updates existing entry in place | `favorite_routes.js:206–219` matches by `routeKey()` (lowercased `pickup→dropoff`), preserves original `id`, `savedAt`, and any `customLabel` | ✅ |
| 4.3 | `/profile` shows "Избранные маршруты" | Section is inserted above history when favorites exist | `favorite_routes.js:335–353` `renderFavoriteRoutesSection` inserts before `#profile-history-section` | ✅ |
| 4.4 | Card label honors `customLabel` | When set, custom label replaces base label | `favorite_routes.js:152` `routeDisplayLabel` → customLabel > label > base | ✅ |
| 4.5 | Fallback label is `pickup → dropoff` | `sanitizeFavorite` defaults `label` to `${pickup} → ${dropoff}` | `favorite_routes.js:130` | ✅ |
| 4.6 | Edit label flow | Inline editor reveals, submit writes `customLabel`, re-renders | `favorite_routes.js:415–429,442–451` + `saveFavoriteRouteLabel` | ✅ |
| 4.7 | Reset label flow | "Сбросить название" appears only when customLabel present; sets it back to `''` | `favorite_routes.js:307` conditional render; `saveFavoriteRouteLabel(id,'')` | ✅ |
| 4.8 | Label edit does not mutate identity | `id`, `pickup`, `dropoff`, `role`, `sourceRideId`, `savedAt` untouched on label change | `saveFavoriteRouteLabel` updates only `label` + `customLabel` | ✅ |
| 4.9 | "Повторить" on favorite opens `/new` safely | Writes a synthesised repeat-route draft (no identity) + notice, navigates to `/new` | `favorite_routes.js:269–282` `writeFavoriteRepeatDraft` calls `writeRepeatRouteDraft` then `writeFavoriteNotice`; navigation in click handler | ✅ |
| 4.10 | Composer notice uses favorite label when available | When repeat draft applied, base notice ("…из истории поездки") is upgraded to "Маршрут «<label>» заполнен из избранного" | `favorite_routes.js:467–480` `enhanceComposerNotice` matches the composer's base text and replaces | ✅ |
| 4.11 | Composer notice collision wording | When draft kept, notice reads "Сохранён текущий черновик — маршрут из избранного не применён" | `favorite_routes.js:477–479` | ✅ |
| 4.12 | `lastUsedAt` bumped on repeat | Card meta switches from "сохранён <date>" to "использован <date>" | `favorite_routes.js:230–237` `markFavoriteUsed` called after successful write | ✅ |

## 5. Malformed storage

Tested by manually corrupting each key in the browser console
(`localStorage.setItem('<key>', '{')`).

| Key                                       | `/profile` | `/new` | Behaviour |
| ----------------------------------------- | ---------- | ------ | --------- |
| `bazardrive.ride_history.v1`              | no crash, "Историю не удалось прочитать" recovery card with two-step clear button | no crash | `readRideHistoryStatus` differentiates `empty` / `ok` / `malformed`; `profile.js:1360` renders error card |
| `bazardrive.repeat_route.v1`              | no crash | no crash; opens empty composer | `consumeRepeatRouteDraft` removes the key on parse failure (`repeat_route.js:105–113`), so a corrupt value can never wedge `/new` |
| `bazardrive.favorite_routes.v1`           | no crash; favorites section is silently hidden (no error card by design) | no crash | `readFavoriteStore` returns `[]` on parse failure |
| `bazardrive.favorite_route_notice.v1`     | no crash | no crash; no false notice | `consumeFavoriteNotice` parses inside try/catch, removes key, returns `null` on failure |

Soft-fail behaviour is consistent: malformed JSON, non-array payloads, and
`localStorage` access errors are all coalesced to safe defaults at every
read site. The only surface that explicitly tells the user about a
malformed payload is ride history (recoverable in one click); the other
three keys silently recover because their failure modes are not
user-actionable.

## 6. Auth / storage boundary

| # | Step | Expected | Observed | Pass |
| - | ---- | -------- | -------- | ---- |
| 6.1 | Tap "Выйти" twice on `/profile` | Two-step confirm, then `performLocalLogout` | `profile.js:859–870` | ✅ |
| 6.2 | Ride history cleared | `bazardrive.ride_history.v1` removed | `storage_boundary.js:74` `clearRideHistory()` | ✅ |
| 6.3 | Favorite routes cleared | `bazardrive.favorite_routes.v1` and `bazardrive.favorite_route_notice.v1` removed | `clearFavoriteRoutes` removes both (`favorite_routes.js:176–184`) | ✅ |
| 6.4 | Repeat-route draft cleared | `bazardrive.repeat_route.v1` removed | `clearRepeatRouteDraft` (`storage_boundary.js:82`) | ✅ |
| 6.5 | Active ride / chat / responses / trip-confirmation cleared | per the pre-existing boundary | `clearActiveRideStore`, `clearChatStore`, `clearChatResponses`, `clearTripConfirmationMap`, `clearRespondStore` | ✅ |
| 6.6 | Composer draft cleared | `bazardrive.draft.v2` removed | `clearComposerDraft` (`composer.js:48`) | ✅ |
| 6.7 | `profileTripDemo` demo override cleared | key removed | `clearTripDemoMode` in `storage_boundary.js:60` | ✅ |
| 6.8 | Guest / demo profile renders after reset | `/welcome` → re-enter as guest → `/profile` shows guest CTA | `profile.js:231` `renderGuest`; no localStorage reads required | ✅ |
| 6.9 | Globals intentionally preserved | `bazardrive.user.v1` (handled by `user.reset()`), `bazardrive.posts.v1`, `bazardrive.map_prefs.v1` | documented as "Intentionally NOT cleared" in `storage_boundary.js:36–43` | ✅ |

## Manual test matrix

Run in a fresh Incognito tab (so localStorage starts empty). All routes
served from `public/`.

| ID  | Steps                                                                 | Expected                                                       |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| T01 | `/active-ride?role=passenger&status=COMPLETED` → submit 5★ rating     | Entry in `/profile` with rating 5, comment row appears if typed |
| T02 | `/active-ride?role=passenger&status=COMPLETED` → skip rating          | Entry in `/profile` with no rating row, no comment row          |
| T03 | `/active-ride?role=driver&status=COMPLETED`                           | Entry in `/profile` with role badge "Водитель", "Доход" row     |
| T04 | Drive then passenger flows back-to-back                               | Two entries (different `role:tripId` keys), newest first        |
| T05 | Tap history card                                                      | Bottom-sheet receipt opens; Esc + backdrop tap both close it    |
| T06 | Receipt → `Повторить маршрут` from a passenger entry                  | `/new` opens with type=passenger, `from`/`to` filled, budget    |
| T07 | Receipt → `Повторить маршрут` from a driver entry                     | `/new` opens with type=trip, `from`/`to` filled, price          |
| T08 | Type "test" into composer first, then repeat from receipt             | Draft preserved, "Сохранён текущий черновик…" notice            |
| T09 | Repeat, navigate away, return to `/new`                               | No prefill (read-and-remove)                                    |
| T10 | Receipt → `☆ В избранные` then re-open same receipt                   | Button label `★ В избранном`, no duplicate card                 |
| T11 | Favorite card → `Изменить название` → save                            | Card label updates, "Сбросить название" appears                 |
| T12 | Favorite card → `Сбросить название`                                   | Label falls back to `pickup → dropoff`, reset button hides      |
| T13 | Favorite card → `Повторить`                                           | `/new` prefilled, notice mentions custom label if set           |
| T14 | Corrupt `bazardrive.ride_history.v1` → `/profile`                     | "Историю не удалось прочитать" card with two-step clear         |
| T15 | Corrupt `bazardrive.repeat_route.v1` → `/new`                         | Composer opens empty, key auto-removed                          |
| T16 | Corrupt `bazardrive.favorite_routes.v1` → `/profile`                  | Favorites section silently hidden, no crash                     |
| T17 | Corrupt `bazardrive.favorite_route_notice.v1` → `/new`                | No false notice, key auto-removed                               |
| T18 | `/profile` → "Выйти" → confirm                                        | All audited keys cleared; navigated to `/welcome`               |
| T19 | After T18, return to `/profile`                                       | Guest profile renders cleanly                                   |

## Findings summary

No bugs found. The loop behaves safely end-to-end on local-only storage.

### Design observations (non-blocking)

1. `storage_boundary.js`'s docstring lists nine audited keys but does not
   explicitly name `bazardrive.favorite_route_notice.v1`, even though
   `clearFavoriteRoutes()` clears it. This is a documentation gap, not a
   leak — the boundary call covers both keys at runtime. Worth a one-line
   addition in a future docs sweep.
2. `enhanceComposerNotice` consumes `bazardrive.favorite_route_notice.v1`
   before checking whether the composer prefill note is actually visible.
   If a user lands on `/new` with a stale notice key but no active repeat
   draft, the notice is silently dropped. This matches the "read-once,
   never reapply" intent and is preferable to letting a stale notice
   resurrect on a later visit, but it is worth knowing.
3. Favorite card label input uses HTML `maxlength="80"`. Pasting a >80-char
   string via JS would still be sanitised (only trimmed, no truncation),
   so the underlying store can hold longer strings than the UI nominally
   allows. Not exploitable; cosmetic only.
4. `favorite_routes.js` keeps a module-level `currentHistoryEntry` that
   the `save-from-detail` button reads. The button is only injected inside
   a detail overlay that is itself opened from a card click — so the
   pointer is always set first. No race observed, but a stricter
   alternative would be to stash the entry on the overlay node itself.

### Suggested follow-ups (not done in this audit)

- Add `bazardrive.favorite_route_notice.v1` to the documented audit list
  in `storage_boundary.js`.
- Consider scoping favorites by stable identity once real auth lands, so
  logout no longer has to wipe them.
- Optional: stash the active history entry on the receipt overlay DOM
  node instead of a module-level variable.

## Validation

```text
$ node scripts/check.mjs
All checks passed.
```

No code changes were required by this audit.
