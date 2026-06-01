# BD-ORDER-P-09 rerun — local post-merge passenger-driver lifecycle smoke

Date: 2026-06-01

Status: **PASS for real-browser (local Chrome) lifecycle click-through**,
**PASS for static-server availability + storage-level lifecycle fallback +
code-audit invariants check**, **BLOCKED only for real-phone (Scenario C)
mobile visual pass** — no physical device was available to this agent.
No production code change is recommended.

## 1. Environment

- Repository: `iprus2026-tech/BazarDriveCloud`
- Local working tree: `H:\тг скринщоты\CloudeCode\BazarDriveCloud`
- Branch: `main` (tracking `origin/main`, clean)
- Commit under test: `4dbc1b3 BD-ORDER-P-09 document blocked browser lifecycle smoke (#315)`
  - Full hash: `4dbc1b3cacc527733bed886aed6c4e181a6f9b95`
- OS: Windows 10 Pro 10.0.19045
- Shell: PowerShell + Bash (via Claude Code tool harness)
- Real browser used for the manual pass: **local Chrome / VS Code browser
  preview**, driven manually by the human reviewer against the same
  `http://127.0.0.1:4173/` static server this agent started.
- Phone used: **none — no physical device available for this rerun**; the
  mobile visual pass (Scenario C) remains BLOCKED.
- Local URLs exercised in Chrome during the manual pass (full list in
  section 4):
  - PC:    `http://127.0.0.1:4173/#/feed`
- Live identifiers from the manual Chrome pass (used in the URLs below):
  - Order id: `order-1780271386091`
  - Trip id:  `trip_order-1780271386091`

## 2. Commands run

| Command | Result |
|--------|--------|
| `git status` | `On branch main` / `nothing to commit, working tree clean` |
| `git branch --show-current` | `main` |
| `git log --oneline -5` | top is `4dbc1b3 BD-ORDER-P-09 document blocked browser lifecycle smoke (#315)` |
| `git rev-parse HEAD` | `4dbc1b3cacc527733bed886aed6c4e181a6f9b95` |
| `node scripts/check.mjs` | `All checks passed.` |
| `python -m http.server 4173 -d public` (background) | started OK |
| `curl http://127.0.0.1:4173/` | `200` |
| `curl http://127.0.0.1:4173/index.html` | `200` |
| `curl http://127.0.0.1:4173/src/app.js` | `200` |
| Storage-level lifecycle smoke (Node, in-memory localStorage, imports real `public/src/*.js`) | 28/28 PASS |

The storage smoke is local-only at `C:\Users\FX\AppData\Local\Temp\bd-order-p-09-rerun-storage-smoke.mjs`
and is NOT committed.

## 3. PASS / FAIL / BLOCKED matrix

Real-browser column = manual Chrome / VS Code browser preview pass
against `http://127.0.0.1:4173/`. Code + storage column = invariants
read out of `public/src/*.js` + the in-Node storage smoke (28/28 PASS).

| Scenario | Real-browser (Chrome) | Code + storage audit |
|---|---|---|
| A1. Clean localStorage keys (5 keys per spec) | PASS (cleared via DevTools before the run) | n/a |
| A2. Persisted role becomes passenger | PASS (passenger onboarding completed) | PASS (`user.set({role:'passenger'})` confirmed in node) |
| A3. Passenger creates order via `/route-picker` → `/order-map-draft` | PASS — order id `order-1780271386091` published | PASS at storage level: `createRideOrder()` returns `{status:'CREATED',id:'order-...'}` |
| A4. Order surfaces in passenger flow | PASS — responses screen opened the order at `/#/responses?orderId=order-1780271386091&state=list` | PASS: `listRideOrdersAsFeedPosts()` projects the new CREATED order |
| A5. Switch persisted role to driver | PASS (re-onboarded as driver) | PASS (`user.set({role:'driver'})`) |
| A6. `/driver-map` lists the order | PASS at `/#/driver-map` (order card visible) | PASS: `listNearbyOrders()` includes it; DriverMap role guard at [driver_map.js:341-349](public/src/screens/driver_map.js#L341-L349) requires persisted role `driver` |
| A7. "Принять" works | PASS — driver accept rendered "Заказ принят" state | PASS: `acceptCanonicalRideOrder(orderId)` returns `{tripId:'trip_<orderId>', order, ride}` and flips order to `ACCEPTED` |
| A8. "К поездке" opens `/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED` | PASS — landed at `/#/active-ride?role=driver&tripId=trip_order-1780271386091&status=ACCEPTED` | PASS by code reading at [driver_map.js:404-409](public/src/screens/driver_map.js#L404-L409); seeded active-ride `tripId === 'trip_<orderId>'` |
| A9. Driver `/active-ride` resolves the same trip | PASS — driver sheet shows `trip_order-1780271386091` | PASS: `findActiveRide('trip_<orderId>').status === 'ACCEPTED'` and `orderId` backref present |
| A10. Passenger `/active-ride?role=passenger&tripId=trip_<orderId>` resolves same trip | PASS — `/#/active-ride?role=passenger&tripId=trip_order-1780271386091&status=ACCEPTED` rendered the same trip | PASS: `findLatestHandedOffOrderTripId()` returns the same `trip_<orderId>` for both roles |
| A11. ACCEPTED → DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED | PASS — full lifecycle walked in Chrome to COMPLETED | PASS: every transition succeeds; `syncCanonicalOrderStatus` bridge persists `IN_PROGRESS` and `COMPLETED` on the ride order |
| A12. After COMPLETED — `/driver-map` doesn't list it | PASS — `/#/driver-map` shows empty state "Заказов рядом пока нет" | PASS: `listNearbyOrders()` filters by `status==='CREATED'` |
| A13. After COMPLETED — `/feed` doesn't show as active | PASS — `/#/feed` no longer shows the created passenger order card | PASS: `listRideOrdersAsFeedPosts()` filters by `status==='CREATED'`, terminal orders are dropped |
| A14. After COMPLETED — driver profile/history shows the completed ride | PASS — `/#/profile` "Последняя поездка" shows driver role, cost 591 ₽, income 544 ₽ | PASS: `saveRideHistoryEntry(buildDriverHistoryEntry(ride, …))` runs from the COMPLETED render in [active_ride.js:713-741](public/src/screens/active_ride.js#L713-L741) |
| A15. After COMPLETED — `/active-ride?role=driver` (no `tripId`) doesn't reopen terminal | PASS by code path (resolver returns `null`); not separately re-opened in Chrome after the COMPLETED step. | PASS: `findLatestHandedOffOrderTripId()` returns `null` (terminal `COMPLETED/CANCELED/NO_SHOW` skipped) → driver entry falls back to empty placeholder per [active_ride.js:543-552](public/src/screens/active_ride.js#L543-L552) |
| A16. Terminal order can't be re-promoted | n/a (storage-level invariant) | PASS: `updateTripStatus(id, 'ACCEPTED')` and `updateTripStatus(id, 'IN_PROGRESS')` both return `null` for `COMPLETED` — transition table at [mock_api.js:608-614](public/src/mock_api.js#L608-L614) |
| A17. NO_SHOW propagates as `CANCELED` on the ride order, never as a live order | n/a (storage-level invariant) | PASS: storage smoke confirms `CANCELED` and absence from `listNearbyOrders()` |
| B1. Passenger opens `/driver-map?role=driver` → guard, not working map | not separately exercised in this Chrome pass (role boundary covered by A6/A8 + code) | PASS by code reading at [driver_map.js:252-264](public/src/screens/driver_map.js#L252-L264): hash/query role is intentionally NOT consulted; only `user.get().role` matters → passenger renders `renderPassengerGuard()` |
| B2. Driver opens `/order-map-draft` → redirect to `/driver-map` | not separately exercised in this Chrome pass | PASS by code reading at [router.js:9-48](public/src/router.js#L9-L48): `PASSENGER_ORDER_ROUTES` is exactly `{/route-picker, /route-preview, /order-map-draft}`; `redirectDriverPassengerOrderFlow` fires before render |
| B3. `?role=driver` on `/driver-map` does NOT change persisted role | implicitly PASS — driver `/driver-map` view never wrote a different role | PASS: `driverMapScreen()` never calls `user.set(...)`; only reads `user.get().role` |
| B4. `?role=driver` / `?role=passenger` on `/active-ride` only chooses view, never writes role | PASS — switching between the two `/active-ride?role=…&tripId=trip_order-1780271386091&status=ACCEPTED` URLs in Chrome did not flip persisted role | PASS: `activeRide()` at [active_ride.js:515-518](public/src/screens/active_ride.js#L515-L518) reads `query.get('role')` and dispatches to `activeRidePassenger()` or driver render; never `user.set(...)` |
| C1. Phone `/feed` no horizontal scroll | BLOCKED — no device | n/a |
| C2. Phone `/driver-map` bottom nav visible | BLOCKED — no device | n/a |
| C3. Phone `/active-ride?role=driver` map placeholder fits | BLOCKED — no device | n/a |
| C4. Phone `/active-ride?role=passenger` bottom sheets fit | BLOCKED — no device | n/a |

`scripts/check.mjs`: **PASS**.

## 4. Exact URLs

Manually opened in Chrome during the lifecycle pass:

- Passenger responses (after order create):
  `http://127.0.0.1:4173/#/responses?orderId=order-1780271386091&state=list`
- Driver map before accept:
  `http://127.0.0.1:4173/#/driver-map`
- Driver active ride (after accept):
  `http://127.0.0.1:4173/#/active-ride?role=driver&tripId=trip_order-1780271386091&status=ACCEPTED`
- Passenger active ride (same trip, cross-role view):
  `http://127.0.0.1:4173/#/active-ride?role=passenger&tripId=trip_order-1780271386091&status=ACCEPTED`
- Feed after completion:
  `http://127.0.0.1:4173/#/feed`
- DriverMap after completion:
  `http://127.0.0.1:4173/#/driver-map`
- Profile after completion:
  `http://127.0.0.1:4173/#/profile`

Additional planned URLs that were not separately exercised in this Chrome
pass but are covered by the code + storage audit (section 3, B1/B2):

- `http://127.0.0.1:4173/#/driver-map?role=driver` (B1: as passenger → expect guard)
- `http://127.0.0.1:4173/#/order-map-draft` (B2: as driver → expect redirect to `/driver-map`)
- `http://127.0.0.1:4173/#/active-ride?role=driver` (no `tripId`, post-COMPLETED → expect empty placeholder)

Mobile mirror (Scenario C, BLOCKED — no device): replace host with
`192.168.1.143`.

## 5. Storage-level lifecycle smoke (non-browser fallback)

Local script (NOT committed) loads `public/src/mock_api.js`,
`public/src/ride_actions.js`, `public/src/ride_state.js`, `public/src/state.js`
under an in-memory `localStorage` and walks the canonical lifecycle exactly
as the DriverMap accept → ActiveRide handoff would. 28 / 28 assertions
PASS, including:

- passenger order created with `status=CREATED`;
- driver sees it via `listNearbyOrders()` and Feed projection;
- `acceptCanonicalRideOrder()` returns `trip_<orderId>` and flips order to
  `ACCEPTED`, removes it from listNearbyOrders + Feed;
- active ride seeded with `tripId=trip_<orderId>`, `orderId` backref set,
  passenger snapshot used (no demo "Анна М." leak), price label matches
  the order;
- `findLatestHandedOffOrderTripId()` resolves the same `tripId` for both
  roles while live;
- full lifecycle `ACCEPTED → DRIVER_EN_ROUTE → WAITING_PASSENGER →
  IN_PROGRESS → COMPLETED` persists on the active-ride store; the
  `syncCanonicalOrderStatus` bridge mirrors `IN_PROGRESS` and `COMPLETED`
  on the canonical ride order;
- after `COMPLETED`: order is absent from `listNearbyOrders()` and from
  the Feed projection; `findLatestHandedOffOrderTripId()` returns `null`
  (so `/active-ride?role=driver` without `tripId` no longer reopens the
  terminal trip); `updateTripStatus(id, 'ACCEPTED'|'IN_PROGRESS')` is
  rejected for terminal orders;
- `NO_SHOW` on a fresh second order propagates as `CANCELED` on the
  ride-order spine and the order does not resurface in
  `listNearbyOrders()`.

## 6. Screenshots / manual evidence

Live identifiers from the manual pass:

- Order id: `order-1780271386091`
- Trip id:  `trip_order-1780271386091`

Manual Chrome observations (no screenshot files attached — notes only):

- Passenger order created via `/route-picker` → `/route-preview` →
  `/order-map-draft` → publish; opened the responses screen at
  `/#/responses?orderId=order-1780271386091&state=list`.
- `/#/driver-map` (after switching persisted role to driver) showed the
  newly created order in the "заказов рядом" sheet.
- Driver "Принять" succeeded — the sheet flipped to "Заказ принят" and
  exposed the "К поездке" CTA.
- "К поездке" navigated to
  `/#/active-ride?role=driver&tripId=trip_order-1780271386091&status=ACCEPTED`,
  rendering the driver active-ride view for `trip_order-1780271386091`.
- The same trip rendered for the passenger view at
  `/#/active-ride?role=passenger&tripId=trip_order-1780271386091&status=ACCEPTED`,
  confirming driver and passenger converge on the same trip identity.
- Driver lifecycle was walked to COMPLETED through the sheet CTAs.
- Post-completion checks:
  - `/#/feed` no longer shows the created passenger order card.
  - `/#/driver-map` shows the empty state "Заказов рядом пока нет".
  - `/#/profile` "Последняя поездка" shows driver role, cost **591 ₽**
    and income **544 ₽**, confirming the COMPLETED ride was persisted to
    driver history.

No screenshot files are attached to this report; the evidence above is
the human reviewer's observed notes during the Chrome pass. Screenshots
can be added by the reviewer if a future audit requires image evidence.

## 7. Bugs found

None. No runtime bug was confirmed from the code reading or from the
storage-level fallback. Every invariant the rerun was asked to verify
holds at the module level.

## 8. Final recommendation

**Recommend PASS with no production code change.** The real-browser
lifecycle pass through local Chrome confirmed end-to-end:

- passenger order created (`order-1780271386091`) and reachable from
  the responses screen;
- driver saw the order on `/driver-map` and accepted it;
- "К поездке" landed on
  `/active-ride?role=driver&tripId=trip_order-1780271386091&status=ACCEPTED`;
- both driver and passenger active-ride views resolved the same
  `trip_order-1780271386091`;
- the lifecycle ran to COMPLETED and the terminal trip cleaned up
  correctly — Feed and DriverMap no longer surface it as active, and
  driver Profile / history captured it (591 ₽ cost / 544 ₽ income).

Plus the non-browser invariants:

- `scripts/check.mjs` passes.
- Static server serves the app (`200 OK` on `/`, `/index.html`,
  `/src/app.js`).
- Storage-level smoke (28/28 PASS) confirms the canonical
  `trip_<orderId>` handoff, the `syncCanonicalOrderStatus` bridge,
  terminal-cleanup guards, and that `?role=` never mutates persisted
  role.
- DriverMap role guard and the `/order-map-draft` redirect are present
  and correct in source.

**Still BLOCKED, and not addressed by this rerun:**

- Scenario C (mobile visual pass) on the actual phone at
  `http://192.168.1.143:4173/`. No physical device was available to
  this agent; the mobile layout (no horizontal scroll, bottom nav
  visible, bottom sheets fit, map placeholder fits the viewport) still
  has to be verified by a human reviewer on a real phone. Cross-device
  lifecycle is out of scope by design (per-device localStorage, no
  backend).

**No fix PR is needed off this report.** If a later mobile pass surfaces
a layout bug, it should land as a fresh BD-ORDER-P-XX issue with the
exact URL, persisted role / localStorage state, expected vs. actual, and
the suspected file.
