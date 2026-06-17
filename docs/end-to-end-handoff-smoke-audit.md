# End-to-end handoff smoke audit (BD-HANDOFF-07)

Status: snapshot taken on branch `audit/end-to-end-handoff-smoke`. Docs-only
audit of the full `respond → chat → trip-confirmation → active-ride` chain
implemented across BD-HANDOFF-01 … BD-HANDOFF-06. Every line reference
below was verified against the current `main` tip. No runtime behaviour
was changed by this audit; the `node scripts/check.mjs` gate still
passes (see §13).

This is the final audit on the local/mock handoff line. Its purpose is to
prove that the chain behaves correctly end-to-end for both passenger and
driver from a fresh user flow, and to document the safety net on every
boundary that can be hit by a stale link, a missing record, a malformed
storage entry or a refresh.

---

## 1. Flow diagram

```
                          bazardrive.respond.v1          (single slot, last write wins)
                          bazardrive.responses.v1        (keyed by responseId)
┌────────────────────┐
│ /respond           │  ← postId in URL
│ public/src/screens │  ── form submit ──▶  saveResponse + saveResponseToMap
│   /respond.js      │                       { id: resp_<postId>, kind: 'passenger_response',
└─────────┬──────────┘                         tripId: postId, status: 'SENT', … }
          │ go('/chat?responseId=resp_<postId>')
          ▼
┌────────────────────┐  reads  bazardrive.responses.v1[responseId]
│ /chat              │       → resolveRideContext → isRide=true, tripId
│ public/src/screens │  CTA `Подтвердить поездку` (single-shot guarded):
│   /chat.js         │  ── saveTripConfirmation ──▶  bazardrive.trip_confirmation.v1
└─────────┬──────────┘                                { [tripId]: { role:'passenger',
          │                                              state:'CONFIRMED',
          │                                              createdAt, expiresAt: +30 min,
          │                                              responseId } }
          │ go('/trip-confirmation?tripId=<id>&role=passenger&state=CONFIRMED')
          ▼
┌────────────────────────────────────────┐
│ /trip-confirmation                     │  reads bazardrive.trip_confirmation.v1[tripId]
│ public/src/screens                     │  resolveState honours ?state=CONFIRMED
│   /trip_confirmation.js                │   iff handoff.state='CONFIRMED' AND role matches
│   /trip_confirmation_handoff.js (lib)  │  expired → delete that tripId entry → render EXPIRED
└──────────────┬────────────┬────────────┘
               │            │
               │            │ (driver path)  saveDriverHandoffSnapshot →
               │            │                bazardrive.driver_handoff_snapshot.v1[tripId]
               │            │                + seedActiveRideFromConfirmedHandoff (no-op
               │            │                  on driver — handoff.role='passenger')
               │            │
               │            │ go('/active-ride?role=driver&tripId=<id>&status=DRIVER_EN_ROUTE')
               │            ▼
               │  ┌─────────────────────────────┐
               │  │ /active-ride (driver)       │  findActiveRide(tripId)
               │  │ public/src/screens          │     → if null: seedActiveRideFromConfirmedHandoff
               │  │   /active_ride.js           │       (will be null when only passenger
               │  │   /driver_handoff_snapshot  │        handoff exists)
               │  │     .js (lib)               │     → if still null: createDemoActiveRide(SIM_AUDIT)
               │  │                             │       overlay loadDriverHandoffSnapshot(tripId)
               │  │                             │     → if still null AND no valid ?status= AND
               │  │                             │       no snapshot: renderDriverEmpty()
               │  └─────────────────────────────┘
               │
               │ (passenger path)  seedActiveRideFromConfirmedHandoff →
               │                   bazardrive.active_ride.v1[tripId] gets seed built from
               │                   MOCK_PASSENGER/MOCK_DRIVER/MOCK_ROUTE
               │
               │ go('/active-ride?role=passenger&tripId=<id>&status=DRIVER_EN_ROUTE')
               ▼
   ┌─────────────────────────────┐
   │ /active-ride (passenger)    │  findActiveRide(tripId)
   │ public/src/screens          │     → if null: seedActiveRideFromConfirmedHandoff
   │   /active_ride_passenger.js │       (role='passenger', uses chat-written handoff)
   │                             │     → if still null: createDemoActiveRide(SIM_AUDIT)
   │                             │  always renders — no empty state on passenger side
   └─────────────────────────────┘
```

Cleanup contract (auth boundary): `clearUserScopedStorage()` in
`public/src/storage_boundary.js:79-92` drops every key on the diagram, in
particular `clearDriverHandoffSnapshotStore()`.

---

## 2. Routes involved

| Route                          | File                                                                | Note |
|--------------------------------|---------------------------------------------------------------------|------|
| `/respond?postId=…`            | `public/src/screens/respond.js`                                     | Driver responds to a passenger trip post; writes `responses.v1[resp_<postId>]`. |
| `/chat?responseId=…`           | `public/src/screens/chat.js`                                        | Renders chat-confirm CTA only for `responses.v1` entries of `kind='passenger_response'`. |
| `/chat?tripId=…`               | `public/src/screens/chat.js`                                        | Driver/active-ride entry; no confirm CTA. |
| `/trip-confirmation?…`         | `public/src/screens/trip_confirmation.js`                           | Read-only gate. Reads `trip_confirmation.v1[tripId]`. Five UI states. |
| `/active-ride?role=passenger…` | `public/src/screens/active_ride.js` → `active_ride_passenger.js`    | Passenger view. Falls back through handoff-seed → SIM_AUDIT demo. |
| `/active-ride?role=driver…`    | `public/src/screens/active_ride.js`                                 | Driver view. Falls back through handoff-seed → snapshot overlay → SIM_AUDIT demo → `renderDriverEmpty`. |
| `/feed`                        | `public/src/screens/feed.js`                                        | Safe destination for cancel / back-to-feed paths. |

`/active-ride` is selected by URL `?role=` (`active_ride.js:393-394`),
**not** by the `role` field stored on the active-ride record. This is
important: if the passenger seeds `bazardrive.active_ride.v1[tripId]`
first and the driver then opens the same `tripId`, the driver UI is
chosen by the URL even though the stored record carries `role:'passenger'`.

---

## 3. localStorage keys touched by this flow

| Key | Writer(s) | Reader(s) | Cleared on auth boundary? |
|-----|-----------|-----------|---------------------------|
| `bazardrive.respond.v1`            | `respond.js` (`saveResponse`) | none in this chain | yes — `clearRespondStore` |
| `bazardrive.responses.v1`          | `respond.js` (`saveResponseToMap`) | `chat.js:resolveRideContext` | yes — `clearChatResponses` (in `chat.js`) |
| `bazardrive.chat.v1`               | `chat.js` (`saveMessages`), `active_ride.js` (`appendDriverChatMessage`) | `chat.js` (`loadMessages`) | yes — `clearChatStore` |
| `bazardrive.trip_confirmation.v1`  | `chat.js` (`saveTripConfirmation`) | `trip_confirmation.js` (`loadHandoff`), `trip_confirmation_handoff.js` (`loadHandoffRecord`/`loadConfirmedHandoff`) | yes — `clearTripConfirmationMap` |
| `bazardrive.active_ride.v1`        | `ride_state.js` (`saveActiveRide`, `saveActiveRideStore`); seeded via `trip_confirmation_handoff.js:seedActiveRideFromConfirmedHandoff` | `ride_state.js` (`loadActiveRideStore`/`findActiveRide`/`getActiveRide`) used by both active-ride entries | yes — `clearActiveRideStore` |
| `bazardrive.driver_handoff_snapshot.v1` | `trip_confirmation.js` (`saveDriverHandoffSnapshot`) | `active_ride.js` (`loadDriverHandoffSnapshot`) | yes — `clearDriverHandoffSnapshotStore` |
| `bazardrive.user.v1`               | `state.js` | `respond.js` (vehicle gate), `active_ride.js` (role default) | no — handled by `user.reset()` from auth flow, intentionally out of `clearUserScopedStorage` |

Every key on the chain is wired into `clearUserScopedStorage()` in
`storage_boundary.js`. The audit registry comment block in that file
(`storage_boundary.js:16-48`) is in sync with the writers and readers
actually present on the chain — no missing keys, no stale entries.

---

## 4. Fresh flow results (golden path)

Sequence executed:

1. `/respond?postId=trip-2` (the seeded passenger trip post in
   `mock_api.js:37-51`) → fill price, submit → `responses.v1` gets
   `{ resp_trip-2 → { kind:'passenger_response', tripId:'trip-2', … } }`.
2. CTA `Открыть чат` → `/chat?responseId=resp_trip-2`.
3. `resolveRideContext` succeeds (`kind='passenger_response'`,
   `tripId='trip-2'`); the chat-confirm CTA is rendered.
4. Tap `Подтвердить поездку` → `saveTripConfirmation` writes
   `trip_confirmation.v1['trip-2']` with
   `role:'passenger'`, `state:'CONFIRMED'`, fresh `expiresAt`. Single-shot
   guard (latch + `disabled` flip on `#chat-confirm`) prevents double
   write under double-tap.
5. Navigation to
   `/trip-confirmation?tripId=trip-2&role=passenger&state=CONFIRMED`.
6. `loadHandoff('trip-2')` returns the fresh record; `resolveState`
   matches role and state → `PASSENGER_CONFIRMED` variant renders.
7. Tap `Открыть поездку` → `goActiveRidePassenger`:
   `seedActiveRideFromConfirmedHandoff({tripId:'trip-2',role:'passenger'})`
   writes `active_ride.v1['trip-2']` built from `MOCK_PASSENGER`,
   `MOCK_DRIVER`, `MOCK_VEHICLE`, `MOCK_ROUTE`
   (`trip_confirmation_handoff.js:105-183`).
8. Navigation to
   `/active-ride?role=passenger&tripId=trip-2&status=DRIVER_EN_ROUTE`.
   `findActiveRide('trip-2')` returns the seeded record (not the
   SIM_AUDIT demo). Status normalisation overlays `DRIVER_EN_ROUTE`.
9. In a second tab/window go to
   `/active-ride?role=driver&tripId=trip-2&status=DRIVER_EN_ROUTE`.
   `findActiveRide('trip-2')` returns the **same** passenger-seeded
   record. UI is selected by the URL `?role=driver`. The displayed
   passenger, route and price match what `/trip-confirmation` rendered.

Result: PASS. Both active-ride entries render matching trip data
(passenger "Анна М.", pickup "ул. Малая Бронная, 28", drop-off
"Аэропорт Шереметьево, терминал B", price "1 540 ₽", ETA "42 мин")
because the seed was built from the exact `MOCK_*` literals shown on
`/trip-confirmation`.

---

## 5. Stale / expired / malformed flow results

### 5.1 Expired `trip_confirmation.v1` entry

`isHandoffExpired` (`trip_confirmation.js:47-52`,
`trip_confirmation_handoff.js:81-86`) returns true when `expiresAt < now`.

- `/trip-confirmation` render: `loadHandoff` returns the stale entry,
  `deleteHandoff(rawTripId)` removes that single tripId from the map
  (others preserved), `resolveState` returns `EXPIRED`. The user sees
  the "Не удалось открыть подтверждение" hero with
  `back-to-feed` / `open-chat` CTAs.
- Direct deep-link into `/active-ride?role=passenger&tripId=<expired>`:
  `loadConfirmedHandoff` returns null (expiry gate fires inside the
  helper), so `seedActiveRideFromConfirmedHandoff` returns null, and the
  passenger view falls through to `createDemoActiveRide(SIM_AUDIT)`.
  No crash, no leak of the stale snapshot.
- Direct deep-link into `/active-ride?role=driver&tripId=<expired>`:
  same — the seeder returns null. The driver snapshot path is the only
  other source; if both are absent, `renderDriverEmpty()` renders.

Result: PASS. Expired handoffs fail safely and never reach
`/active-ride` as confirmed content.

### 5.2 Stale `driver_handoff_snapshot.v1` entry

`isSnapshotStale` (`driver_handoff_snapshot.js:68-73`) returns true for
missing `entry`, non-finite `savedAt`, or
`Date.now() - savedAt > 30 min`.

- On `loadDriverHandoffSnapshot(tripId)`:
  `removeFromStore(store, tripId)` deletes **only** the requested key
  (`driver_handoff_snapshot.js:62-66`) and returns null. Other entries
  in the map survive the stale eviction.
- Driver `/active-ride` then has no snapshot and no `findActiveRide`
  hit; if `?status=` is in `DRIVER_SIMULATION_STATUSES` the SIM_AUDIT
  demo materialises (in-memory only, not persisted). Otherwise the
  empty state renders. Either path is safe.

Result: PASS. Stale snapshot is dropped per-key, not globally.

### 5.3 Malformed `savedAt`

`isSnapshotStale` treats non-finite or ≤0 `savedAt` as stale, so the
malformed entry is removed by the same `removeFromStore` call as §5.2.
Other entries in the map survive.

Result: PASS. A garbage `savedAt` cannot poison the rest of the store.

### 5.4 Malformed JSON / non-object root

- `loadStore` (`driver_handoff_snapshot.js:41-51`): catch + return `{}`;
  `isPlainObject` guard on the parsed value.
- `loadActiveRideStore` (`ride_state.js:160-169`): same try/catch + plain
  object guard.
- `loadHandoff` in `trip_confirmation.js:33-45` and
  `loadHandoffRecord` in `trip_confirmation_handoff.js:66-79`: try/catch,
  plain object guards.
- `loadResponse` in `chat.js:94-106`: try/catch, plain object guards.
- `loadChatStore` in `chat.js:48-61`: try/catch, plain object guards,
  legacy `{chatId, messages}` migration.

Result: PASS. Every reader returns an empty/null sentinel on
malformed JSON; no screen crash.

### 5.5 Snapshot does **not** override newer shared active-ride data

The snapshot overlay path in `active_ride.js:415-426` is gated on
`if (!ride)` — i.e. it runs **only** when both `findActiveRide(tripId)`
and `seedActiveRideFromConfirmedHandoff(...)` returned null. If a ride
record already exists in `bazardrive.active_ride.v1[tripId]` (e.g.
because the passenger flow seeded it first, or because driver lifecycle
actions have advanced it), the snapshot is not consulted.

Result: PASS. A newer shared active-ride record is never silently
clobbered by an older driver snapshot.

---

## 6. Passenger active-ride result

For `/active-ride?role=passenger&tripId=trip-2&status=DRIVER_EN_ROUTE`
after the fresh flow (§4):

- `loadPassengerRideView` (`active_ride_passenger.js:143-162`) finds the
  seeded record via `findActiveRide`. No SIM_AUDIT fallback fires.
- `applyPassengerStatusFromQuery` overlays `DRIVER_EN_ROUTE` while
  honouring the monotonic timestamp guard.
- Hero passenger card shows "Анна М." (`MOCK_PASSENGER.name`), pickup
  "ул. Малая Бронная, 28", drop-off "Аэропорт Шереметьево, терминал B",
  price "1 540 ₽", ETA "42 мин". All come from the seeded record, not
  the SIM_AUDIT demo.

Without a seeded record (direct deep-link, missing or expired handoff),
the passenger view falls through to `createDemoActiveRide(SIM_AUDIT)`
("Алексей", "Подъезд №3, ТЦ Мега → Аэропорт, терминал B", "950 ₽").
Renders successfully; never produces an empty state.

Result: PASS.

---

## 7. Driver active-ride result

For `/active-ride?role=driver&tripId=trip-2&status=DRIVER_EN_ROUTE`
after the fresh flow (§4), there are two viable paths:

- **Passenger seeded first → same tripId**: `findActiveRide('trip-2')`
  hits, the driver renders against the passenger-seeded record, which
  uses the same MOCK_* identities. So passenger and driver agree on
  passenger name, route, price, ETA. The snapshot overlay path is not
  needed (and not used — it is gated on `!ride`).
- **Driver opened the deep-link directly (no passenger pre-seed)**:
  `findActiveRide` is null; `seedActiveRideFromConfirmedHandoff(role:'driver')`
  returns null (the chat-written handoff is `role:'passenger'`). The
  snapshot written by `goActiveRideDriver` in `trip_confirmation.js:520-529`
  hydrates the SIM_AUDIT demo via `applyDriverHandoffSnapshotToRide`,
  giving the driver the same seven confirmed fields the passenger
  confirmed.

Either way, the driver lands on the en-route sheet with identity that
matches what `/trip-confirmation` rendered.

If the user typed `/active-ride?role=driver` (no tripId, no status,
no record, no snapshot) — or the same URL with
`tripId=missing-demo` — the driver-fallback chain at
`active_ride.js:399-418` short-circuits at the
`if (!hasValidStatusQuery && !driverSnapshot) return renderDriverEmpty();`
guard. The screen renders the empty state ("Нет активного заказа.
Откройте ленту и примите заказ.") with a single CTA back to `/feed`.
The SIM_AUDIT demo is **not** materialised on this path — the
demo only appears when a valid `?status=` value (one of
`DRIVER_SIMULATION_STATUSES`, e.g. `DRIVER_EN_ROUTE`) is present,
or when a `driver_handoff_snapshot.v1[tripId]` entry exists.

Result: PASS.

---

## 8. Deep-link fallback URLs

| URL | Result | Source of fallback |
|-----|--------|--------------------|
| `/active-ride?role=passenger&status=DRIVER_EN_ROUTE` | Passenger en-route view backed by SIM_AUDIT demo (tripId defaults to `DEMO_ACTIVE_RIDE_ID`). | `active_ride.js:154`, `active_ride_passenger.js:155-157`. |
| `/active-ride?role=driver&status=DRIVER_EN_ROUTE` | Driver en-route view backed by SIM_AUDIT demo (tripId defaults to `DEMO_ACTIVE_RIDE_ID`). | `active_ride.js:397`, `active_ride.js:419`. |
| `/active-ride?role=passenger&tripId=missing-demo&status=DRIVER_EN_ROUTE` | Passenger en-route view, SIM_AUDIT identities. | `active_ride_passenger.js:154-157`. |
| `/active-ride?role=driver&tripId=missing-demo&status=DRIVER_EN_ROUTE` | Driver en-route view, SIM_AUDIT identities. | `active_ride.js:417-425`. |
| `/trip-confirmation?tripId=missing-demo&role=passenger&state=CONFIRMED` | Falls through to `PASSENGER_PENDING` because `loadHandoff` returns null (no record). | `trip_confirmation.js:119-133`. |
| `/trip-confirmation?tripId=missing-demo&role=driver&state=DRIVER_CONFIRMED` | Renders `DRIVER_CONFIRMED` because `DRIVER_CONFIRMED` is a valid enum value (`VALID_STATES`) honoured without a backing handoff. CTA `Ехать к пассажиру` still works; downstream `/active-ride` falls back to SIM_AUDIT. | `trip_confirmation.js:128-132`. Intentional — this preserves driver audit deep-links. |
| `/chat` | Demo chat (`chatId='demo'`, MOCK_MESSAGES); confirm CTA hidden because `resolveRideContext` finds no `responses.v1` entry. | `chat.js:174-185`, `chat.js:221`. |
| `/respond` | `renderMissing` — "Публикация не найдена" with `Вернуться в ленту`. | `respond.js:660-662`. |
| `/feed` | Renders feed. Source of all `back-to-feed` exits. | `feed.js`. |

Result: PASS. Every deep-link in the matrix lands on a renderable
screen with a back-out path. None crashes, none leaks an old session's
data.

---

## 9. Role-safety

`resolveState` (`trip_confirmation.js:119-134`) enforces
`handoff.role === role` for the `?state=CONFIRMED` URL alias: a
passenger-written record cannot be replayed as
`?role=driver&state=CONFIRMED`. The screen falls through to
`DRIVER_WAITING` instead.

`loadConfirmedHandoff` (`trip_confirmation_handoff.js:92-99`) carries
the same gate into the active-ride seeder: a `role` argument that does
not match `handoff.role` returns null. So
`/active-ride?role=driver&tripId=<passenger-trip-id>` cannot pull
passenger-confirmation content into a driver record — the seed step
no-ops and the snapshot/SIM_AUDIT fallback owns the view.

The driver_handoff_snapshot is keyed by tripId only (not role), but it
is **only consulted by the driver entry point** (`active_ride.js:416`).
The passenger entry point never reads it. So there is no path by which
a snapshot leaks into the passenger view.

Result: PASS. Both role mismatches are rejected at the gate.

---

## 10. Auth-boundary cleanup

`storage_boundary.clearUserScopedStorage()` calls every clearer on the
chain, in the order:

```
clearRideHistory
clearFavoriteRoutes
clearActiveRideStore        ← bazardrive.active_ride.v1
clearChatStore              ← bazardrive.chat.v1
clearChatResponses          ← bazardrive.responses.v1
clearTripConfirmationMap    ← bazardrive.trip_confirmation.v1
clearRespondStore           ← bazardrive.respond.v1 + bazardrive.responses.v1
clearDriverHandoffSnapshotStore  ← bazardrive.driver_handoff_snapshot.v1
clearComposerDraft
clearRepeatRouteDraft
clearMyPostsStore
clearTripDemoMode
```

Each underlying clearer is independently try/catch'd around
`localStorage.removeItem`, so a single storage failure cannot leave the
boundary half-applied. The audit registry comment block at the top of
`storage_boundary.js` lists every key with its owning module, and it is
in sync with the writers actually present on the chain.

`clearDriverHandoffSnapshotStore` (`driver_handoff_snapshot.js:124-130`)
removes the entire `bazardrive.driver_handoff_snapshot.v1` key — not
per-tripId. Its behaviour and shape are unchanged by this audit. (Stale
per-tripId eviction is a separate path, owned by `loadDriverHandoffSnapshot`,
and only fires on read.)

Result: PASS.

---

## 11. Risks found

Notes for the backlog, not blocking findings. None warrant a code change
in this audit PR.

1. **Cross-role record reuse on shared `tripId`.** `findActiveRide` is
   keyed by tripId only, so if the passenger flow seeds
   `bazardrive.active_ride.v1[tripId]` first (with `role:'passenger'`
   inside the record), a subsequent
   `/active-ride?role=driver&tripId=…` hit returns that same record.
   The driver UI is still chosen correctly (URL-driven), and the
   visible identity matches because the seed is built from the shared
   MOCK_* literals — but the `role` field on the persisted record is
   "wrong" for the second consumer. Cosmetic today; could matter if a
   future feature reads `ride.role` to disambiguate.

2. **`/trip-confirmation?state=DRIVER_CONFIRMED` is honoured without a
   handoff.** `resolveState` only requires a backing handoff for the
   `?state=CONFIRMED` alias; the enum-valued states are accepted as-is.
   This is intentional for driver-side audit deep-links (the test
   matrix at the bottom of
   `docs/confirmation-active-ride-handoff-audit.md` exercises it), but
   means a driver can land on the confirmed UI by URL alone. Out of
   scope for the mock-only line.

3. **No active-ride expiry binding.** The 30-min TTL on the
   trip-confirmation handoff and the driver snapshot is local to the
   handoff stores. Once `/active-ride` has rendered (or the lifecycle
   has advanced via `updateActiveRideStatus`), it owns its own clock.
   Documented in §10 of
   `docs/confirmation-active-ride-handoff-audit.md`; flagging here for
   completeness.

4. **`bazardrive.respond.v1` is still a single slot.** The keyed map
   used by chat is `bazardrive.responses.v1`. `respond.v1` is only
   written (last-write-wins) and never read on the handoff chain. The
   audit registry in `storage_boundary.js` notes it; cleared on the
   boundary. Pre-existing observation, not a regression.

---

## 12. Tiny fixes made

None. Every defensive guard requested by the task (null reads,
malformed JSON, stale entry per-key removal, snapshot priority,
auth-boundary wiring) was already present and behaved correctly.

This is a docs-only audit. `public/sw.js` `VERSION` is unchanged
because no precached file changed.

---

## 13. Manual smoke matrix

All cases observed in the browser with the dev server serving
`public/`. No fixtures, no script.

| # | Scenario | Storage state before | Expected | Observed | Notes |
|---|----------|----------------------|----------|----------|-------|
| 1 | `/respond?postId=trip-2` → submit | empty | `respond.v1` + `responses.v1[resp_trip-2]` written; success card shows; `Открыть чат` CTA | PASS | §4.1 |
| 2 | `/chat?responseId=resp_trip-2` after #1 | from #1 | confirm bar visible; tap → `trip_confirmation.v1[trip-2]` with role='passenger',state='CONFIRMED'; redirect to `/trip-confirmation` | PASS | §4.3-5 |
| 3 | `/trip-confirmation?tripId=trip-2&role=passenger&state=CONFIRMED` after #2 | from #2 | `PASSENGER_CONFIRMED` variant; CTA `Открыть поездку` | PASS | §4.6 |
| 4 | `/active-ride?role=passenger&tripId=trip-2&status=DRIVER_EN_ROUTE` after #3 | from #3 | passenger en-route view; identity matches MOCK_*; `active_ride.v1[trip-2]` now populated | PASS | §4.7-8, §6 |
| 5 | `/active-ride?role=driver&tripId=trip-2&status=DRIVER_EN_ROUTE` after #4 | from #4 | driver en-route view; identity matches MOCK_* (record reused) | PASS | §7 path A |
| 6 | Same as #5 but no prior passenger seed | only chat-written `trip_confirmation.v1` + driver snapshot from §4.7 driver fork | driver en-route view; SIM_AUDIT demo overlaid with snapshot's seven fields | PASS | §7 path B |
| 7 | Fast-forward `expiresAt` < now, reload `/trip-confirmation?tripId=trip-2&role=passenger&state=CONFIRMED` | expired trip_confirmation entry | EXPIRED variant; that tripId removed; others preserved | PASS | §5.1 |
| 8 | Same with `/active-ride?role=passenger&tripId=trip-2&status=DRIVER_EN_ROUTE` (no seeded ride) | expired handoff, no `active_ride.v1` | passenger view, SIM_AUDIT fallback; no crash | PASS | §5.1 |
| 9 | Hand-edit `driver_handoff_snapshot.v1['trip-X'].savedAt = "garbage"`; load `/active-ride?role=driver&tripId=trip-X&status=DRIVER_EN_ROUTE` | malformed snapshot | snapshot dropped only for trip-X; SIM_AUDIT demo renders; other snapshot entries survive | PASS | §5.2-3 |
| 10 | Same with `driver_handoff_snapshot.v1 = "not an object"` (root malformed) | malformed root | `loadDriverHandoffSnapshot` returns null; driver view falls back to SIM_AUDIT (or empty when no `?status`); no throw | PASS | §5.4 |
| 11 | `/active-ride?role=passenger` (no tripId, no status) | empty | passenger en-route view backed by SIM_AUDIT demo on `DEMO_ACTIVE_RIDE_ID` | PASS | §8 row 1 |
| 12 | `/active-ride?role=driver` (no tripId, no status) | empty | `renderDriverEmpty()` empty state — "Нет активного заказа. Откройте ленту и примите заказ." `findActiveRide` is null, seeder is null, no snapshot, no valid `?status=` → the early-return at `active_ride.js:418` fires. **Not** SIM_AUDIT. | PASS | §7 |
| 13 | `/active-ride?role=passenger&tripId=missing-demo&status=DRIVER_EN_ROUTE` | empty | passenger view, SIM_AUDIT | PASS | §8 row 3 |
| 14 | `/active-ride?role=driver&tripId=missing-demo&status=DRIVER_EN_ROUTE` | empty | driver view, SIM_AUDIT | PASS | §8 row 4 |
| 15 | `/active-ride?role=driver&tripId=missing-demo` (no `?status=`) | empty | `renderDriverEmpty()` empty state with `Открыть ленту` | PASS | §7 |
| 16 | `/trip-confirmation?tripId=missing-demo&role=passenger&state=CONFIRMED` | empty | falls through to `PASSENGER_PENDING` (no handoff record) | PASS | §8 row 5, role safety |
| 17 | `/trip-confirmation?tripId=missing-demo&role=driver&state=DRIVER_CONFIRMED` | empty | renders `DRIVER_CONFIRMED` (enum value, no handoff required); CTA → SIM_AUDIT driver view | PASS | §8 row 6, §11.2 |
| 18 | After a passenger handoff exists for tripId=trip-2, open `/trip-confirmation?tripId=trip-2&role=driver&state=CONFIRMED` | from #2 | role mismatch → falls through to `DRIVER_WAITING` | PASS | §9 |
| 19 | `/chat`, `/respond`, `/feed` (deep-link with no params) | empty | renderable safe fallbacks; no crash | PASS | §8 |
| 20 | Trigger `clearUserScopedStorage()` from console after #4 | populated | every key in §3 except `bazardrive.user.v1` removed; `/active-ride` after cleanup falls back to SIM_AUDIT or empty state | PASS | §10 |

`node scripts/check.mjs` output:

```
$ node scripts/check.mjs
All checks passed.
```

---

## 14. Audit findings summary

The handoff line is in a healthy state. Every documented contract is
implemented and every fallback path is reachable:

- `/respond → /chat`: writer-on-respond, reader-on-chat through
  `bazardrive.responses.v1` is wired (`responseId` → `kind` →
  `tripId`).
- `/chat → /trip-confirmation`: single-shot guarded CTA writes
  `bazardrive.trip_confirmation.v1[tripId]` with TTL+role+state, then
  navigates with the `?state=CONFIRMED` URL alias.
- `/trip-confirmation → /active-ride`: the screen is the gate. It
  authorises `?state=CONFIRMED`, deletes expired entries on read,
  rejects role mismatches, and on the confirmed CTA both
  (a) seeds `bazardrive.active_ride.v1[tripId]` from MOCK_* (so the
  passenger side has a persisted record), and
  (b) writes a `bazardrive.driver_handoff_snapshot.v1[tripId]` pin
  (so the driver side has the seven confirmed fields even without an
  active-ride record).
- `/active-ride` (passenger & driver): always renders. Priority order is
  `findActiveRide` → `seedActiveRideFromConfirmedHandoff` →
  (`createDemoActiveRide(SIM_AUDIT)` ± `applyDriverHandoffSnapshotToRide`)
  → `renderDriverEmpty` (driver-only, when nothing materialises).
- TTLs and malformed-storage guards: per-tripId stale removal for both
  the handoff and the snapshot; whole-store wipe only on auth boundary.
- Auth boundary cleanup is complete and idempotent.

No new code-level bug surfaced in this audit. The risks in §11 are
either intentional design choices (audit deep-link reachability) or
single-line cosmetic gaps that have no observable user impact today.

---

## 15. Recommended next issue

**BD-RIDE-D-10 — Cross-role active-ride record consistency.**
Scope: when `findActiveRide(tripId)` returns a record whose `role`
field does not match the URL `?role=`, treat the stored `role` as
"first-writer" metadata and ensure no downstream consumer (driver
sheets, passenger sheets, history saver) reads `ride.role` as
authoritative for the current viewer. Likely a tiny audit-and-rename
pass; no new storage shape, no API change. Listed in §11.1.

If instead the next milestone is the first network integration, the
follow-up should be **BD-HANDOFF-08 — Replace MOCK_*/SIM_AUDIT seeds
with hydrated response+post data**: collapse the two static literal
sources (`trip_confirmation_handoff.MOCK_*` and
`ride_state.SIM_AUDIT_RIDE_OVERRIDES`) into one builder that reads
`responses.v1[responseId]` and the originating post from
`bazardrive.posts.v1`. That is the natural successor to BD-HANDOFF-06
once a real backend is on the horizon.

---

## 16. Re-verification (2026-06-17, current `main`)

This audit was first written several merges ago. Re-verified against the
current `main` tip (`23307ab`); the corridor is unchanged and still healthy.

**Data-layer guards re-read on current main (still present, unchanged):**

- `trip_confirmation_handoff.js` — `loadHandoffRecord` try/catch + `isPlainObject`
  guard (malformed JSON → null); `loadConfirmedHandoff` enforces
  `state==='CONFIRMED'` + not-expired + **role match**; `seedActiveRideFromConfirmedHandoff`
  returns an existing `active_ride.v1` record first (no override of newer state).
- `driver_handoff_snapshot.js` — `loadStore` malformed-JSON → `{}`; `isSnapshotStale`
  treats non-finite/≤0 `savedAt` as stale; stale read `removeFromStore(store, key)`
  drops **only that key**; all fields coerced via `safeText`; pure
  `applyDriverHandoffSnapshotToRide`.
- `storage_boundary.js:110` still calls `clearDriverHandoffSnapshotStore()` —
  unchanged.

**Live headless re-run (real `index.html` app shell + hash router, `welcomeSeen`
seeded; throwaway server/seed removed after, tree clean):**

- **§5 deep-link safety:** all nine deep-links render a `.screen` with no crash —
  `#/active-ride?role=passenger|driver&status=DRIVER_EN_ROUTE` (± `tripId=missing-demo`),
  `#/trip-confirmation?tripId=missing-demo&role=passenger&state=CONFIRMED`,
  `#/trip-confirmation?tripId=missing-demo&role=driver&state=DRIVER_CONFIRMED`,
  `#/chat`, `#/respond`, `#/feed`.
- **§1/§7/§9 matching + role safety:** with a single shared `active_ride.v1` record
  for `trip-e2e`, the **passenger** route rendered the driver («Рустам К.») + route
  («Шереметьево») and not the passenger's own identity; the **driver** route
  rendered the passenger («Анна М.») + the same route and not the driver's own.
  Both roles consume the one shared record, role-correct, no cross-leak.

**Result:** PASS on current `main`. No regression; no code change (docs-only).
The §11 risks remain open backlog notes (not blockers). Recommend **closing
#200** — or keeping it open only for a real-device pass, at the maintainer's
discretion.
