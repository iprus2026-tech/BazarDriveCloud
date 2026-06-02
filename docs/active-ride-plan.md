# Active ride contract

> **BD-DOCS-01 note:** this document was refreshed after the routines/storage-boundary audit. It is no longer a D0-only implementation plan. It now documents the current implemented mock active-ride flow and the boundaries that future Mapbox/backend work must preserve.

Tracking history:

- #52 BD-RIDE-PLAN-01 Active ride passenger/driver Mapbox implementation plan
- #53 BD-RIDE-D-01 Driver active ride flow - Cloud Design screen map and staged plan

---

## 1. Current implementation status

Active ride is implemented as a mock-only PWA flow.

| Area | Current status |
|---|---|
| Route | `/active-ride` is registered in `public/src/app.js`. |
| Driver renderer | `public/src/screens/active_ride.js`. |
| Passenger renderer | `public/src/screens/active_ride_passenger.js`, imported by `active_ride.js`. |
| State contract | `public/src/ride_state.js`. |
| Storage key | `bazardrive.active_ride.v1`. |
| Map | `public/src/mapbox/map_shell.js` DOM placeholder only. |
| Real Mapbox | Not connected. No SDK, token, tiles, Directions API or network calls. |
| Backend | Not present. |
| Chrome | Router hides tabbar/FAB on `/active-ride`. |

There is no separate `/active-ride-passenger` route. Passenger UI is selected by `?role=passenger` on the same route.

---

## 2. Role split

### Passenger

Passenger active ride:

- watches driver progress on the placeholder map;
- opens chat with the driver;
- uses phone/safety stubs;
- can cancel through the passenger cancel sheet;
- sees en-route, approaching, waiting, in-progress, completed, canceled and no-show surfaces;
- reads the same trip store as the driver view.

### Driver

Driver active ride:

- accepts a new order;
- moves through the lifecycle;
- opens chat/phone/navigation stubs;
- uses cancel/problem/earnings sheets;
- writes canonical status transitions through `ride_state.js`;
- can render simulation overlays via `?status=` for audit without corrupting the canonical store.

---

## 3. Canonical status contract

Defined in `public/src/ride_state.js` as `RIDE_STATUS`.

```text
NEW_ORDER
CONFIRMATION_PENDING
CONFIRMED
CHAT_STARTED
DRIVER_EN_ROUTE
DRIVER_APPROACHING_PICKUP
WAITING_PASSENGER
IN_PROGRESS
COMPLETED
CANCELED
NO_SHOW
```

### Driver happy path

```text
NEW_ORDER
  ↓
DRIVER_EN_ROUTE
  ↓
DRIVER_APPROACHING_PICKUP
  ↓
WAITING_PASSENGER
  ↓
IN_PROGRESS
  ↓
COMPLETED
```

### Terminal states

```text
COMPLETED
CANCELED
NO_SHOW
```

Terminal states must not reopen into active Feed/DriverMap flows unless a dedicated migration or backend state-machine issue explicitly changes the contract.

---

## 4. Screen inventory

### Passenger side

| ID | Surface | Current file/status |
|---|---|---|
| BD-RIDE-P-01 | PassengerActiveRideMap | `active_ride_passenger.js` |
| BD-RIDE-P-02 | PassengerDriverEnRoute | `active_ride_passenger.js` |
| BD-RIDE-P-03 | PassengerDriverArrived / waiting | `active_ride_passenger.js` |
| BD-RIDE-P-04 | PassengerOnRide | `active_ride_passenger.js` |
| BD-RIDE-P-05 | PassengerRideComplete | `active_ride_passenger.js` |
| BD-RIDE-P-06 | PassengerCancelRideSheet | `active_ride_passenger.js` |
| BD-RIDE-P-07 | PassengerSafetySheet | `active_ride_passenger.js` |

### Driver side

| ID | Surface | Current file/status |
|---|---|---|
| BD-RIDE-D-01 | DriverActiveRideMap | `active_ride.js` |
| BD-RIDE-D-02 | DriverToPickup | `active_ride.js` |
| BD-RIDE-D-03 | DriverApproachingPickup | `active_ride.js` |
| BD-RIDE-D-04 | DriverWaitingPassenger | `active_ride.js` |
| BD-RIDE-D-05 | DriverRideInProgress | `active_ride.js` |
| BD-RIDE-D-06 | DriverRideComplete | `active_ride.js` |
| BD-RIDE-D-07 | DriverCancelRideSheet | `active_ride.js` |
| BD-RIDE-D-08 | DriverProblemSheet | `active_ride.js` |
| BD-RIDE-D-09 | DriverEarningsSheet | `active_ride.js` |

### Foundation/shared

| ID | Surface | Current file/status |
|---|---|---|
| BD-RIDE-F-01 | ActiveRideStateContract | `public/src/ride_state.js` |
| BD-RIDE-F-02 | MapShellPlaceholder | `public/src/mapbox/map_shell.js` |
| BD-RIDE-F-03 | RouteLineMock | inside MapShell / ride renderers |
| BD-RIDE-F-04 | BottomSheetLayout | CSS + active ride DOM |
| BD-RIDE-F-05 | TripStatusBanner | active ride renderers |
| BD-RIDE-F-06 | SafetyAndProblemStubs | passenger/driver sheets |
| BD-RIDE-F-07 | ActiveRideStorage | `ride_state.js` helpers |
| BD-CONFIRM-01 | TripConfirmationHandoff | `public/src/screens/trip_confirmation.js` |

---

## 5. Driver Cloud Design mapping

| State | User-facing title | Primary action | Transition |
|---|---|---|---|
| `NEW_ORDER` | Новый заказ | Принять заказ | `NEW_ORDER → DRIVER_EN_ROUTE` |
| `DRIVER_EN_ROUTE` | Едете к пассажиру | Я на месте / approaching path | `DRIVER_EN_ROUTE → DRIVER_APPROACHING_PICKUP` or `WAITING_PASSENGER` |
| `DRIVER_APPROACHING_PICKUP` | Подъезжаете к точке | Я на месте | `DRIVER_APPROACHING_PICKUP → WAITING_PASSENGER` |
| `WAITING_PASSENGER` | Ожидание пассажира | Начать поездку | `WAITING_PASSENGER → IN_PROGRESS` |
| `IN_PROGRESS` | Везёте пассажира | Завершить поездку | `IN_PROGRESS → COMPLETED` |
| `COMPLETED` | Поездка завершена | Закрыть / earnings | terminal |
| `CANCELED` | Поездка отменена | Вернуться | terminal |
| `NO_SHOW` | Пассажир не пришёл | Вернуться | terminal |

---

## 6. Routes and audit URLs

Implemented route:

```text
/active-ride?tripId=<id>&role=driver
/active-ride?tripId=<id>&role=passenger
```

Fallback/demo URLs:

```text
/active-ride?role=driver
/active-ride?role=passenger
```

### Role simulation / audit URLs

The `?status=` query parameter is supported for parallel passenger/driver audits.

Passenger side:

```text
/active-ride?role=passenger
/active-ride?role=passenger&status=DRIVER_EN_ROUTE
/active-ride?role=passenger&status=DRIVER_APPROACHING_PICKUP
/active-ride?role=passenger&status=WAITING_PASSENGER
/active-ride?role=passenger&status=IN_PROGRESS
/active-ride?role=passenger&status=COMPLETED
/active-ride?role=passenger&status=CANCELED
/active-ride?role=passenger&status=NO_SHOW
```

Driver side:

```text
/active-ride?role=driver
/active-ride?role=driver&status=NEW_ORDER
/active-ride?role=driver&status=DRIVER_EN_ROUTE
/active-ride?role=driver&status=DRIVER_APPROACHING_PICKUP
/active-ride?role=driver&status=WAITING_PASSENGER
/active-ride?role=driver&status=IN_PROGRESS
/active-ride?role=driver&status=COMPLETED
/active-ride?role=driver&status=CANCELED
/active-ride?role=driver&status=NO_SHOW
```

Simulation rules:

- Passenger `?status=` is view-only and should not write to localStorage.
- Driver `NEW_ORDER` can reset the demo ride, but lifecycle buttons must still use `updateActiveRideStatus()` for canonical transitions.
- Other driver `?status=` values are audit overlays and must not silently roll back timestamps.

---

## 7. localStorage keys

Current active-ride adjacent keys:

| Key | Owner | Current purpose |
|---|---|---|
| `bazardrive.active_ride.v1` | `ride_state.js` | Current active ride map keyed by `tripId`. |
| `bazardrive.ride_history.v1` | `ride_history.js` | Completed ride history. |
| `bazardrive.chat.v1` | `chat.js`, active ride | Trip/response messages. |
| `bazardrive.trip_confirmation.v1` | `trip_confirmation.js`, `chat.js` | Confirmation handoff state. |
| `bazardrive.driver_handoff_snapshot.v1` | `driver_handoff_snapshot.js` | Driver-side confirmed handoff pin. |
| `bazardrive.route_draft.v1` | `route_picker.js` | Passenger route draft before order/ride. |
| `bazardrive.order_form.v1` | `order_map_draft.js` | Pending order form details. |
| `bazardrive.ride_orders.v1` | `mock_api.js` | Local passenger orders visible to DriverMap/feed. |
| `bazardrive.map_prefs.v1` | map layer | Device-level map preference, not identity-scoped. |

`bazardrive.trip_status.v1` is not part of the current authoritative implementation. Do not introduce it unless a new issue defines why it is needed and how it relates to `bazardrive.active_ride.v1`.

---

## 8. Data contract shape

Representative active ride object:

```js
{
  tripId: 'trip_moscow_tula_demo',
  role: 'driver',
  status: 'DRIVER_EN_ROUTE',
  passenger: {
    name: 'Анна М.',
    initials: 'АМ',
    rating: '4,86',
    phoneMasked: '+7 ... 23-45',
    luggage: '1 чемодан'
  },
  driver: {
    name: 'Рустам К.',
    initials: 'РК',
    rating: '4,92'
  },
  route: {
    pickupLabel: 'ул. Малая Бронная, 28',
    dropoffLabel: 'Шереметьево, терминал В',
    currentInstruction: 'Через 350 м направо',
    currentStreet: 'на Тверской бульвар',
    distanceToPickup: '1,2 км',
    etaToPickup: '3 мин',
    etaToDestination: '17 мин',
    pickup: { lng: 37.6173, lat: 55.7558 },
    dropoff: { lng: 37.4146, lat: 55.9726 }
  },
  ride: {
    price: '1 540 ₽',
    todayEarnings: '4 720 ₽',
    tripsToday: 7,
    rating: '4,92'
  },
  waiting: {
    freeLimit: '3:00',
    remaining: '2:30',
    paidStartsAt: '14:18',
    paidRate: '8 ₽ за каждую минуту'
  },
  timestamps: {
    createdAt: 'ISO_DATE',
    acceptedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null
  }
}
```

Coordinates stay in `{ lng, lat }` format so future Mapbox integration can consume them without a migration.

---

## 9. Mapbox boundary

Current active ride and map screens use:

```text
public/src/mapbox/map_shell.js
```

MapShell must keep working without:

```text
Mapbox token
Mapbox SDK
network requests
native geolocation prompt
external tile cache
```

Real Mapbox integration is a separate future issue: **BD-MAP-FOUND-01 Mapbox integration foundation**. That work must update token handling, CSP, service worker behavior, error states and fallback states together.

---

## 10. Future work

| Item | Status |
|---|---|
| Driver no-show full flow | Open. Current no-show work still needs a dedicated full-flow issue. |
| Real Mapbox integration | Open Phase 4 work. |
| Backend/server ride state machine | Phase 2 work. |
| Automated unit tests for `ride_state.js` | Technical debt. |
| `driver_markers.js` and `trip_status_layer.js` | Remaining mapbox stub gap. |

---

## 11. Boundaries

```text
no backend/API in active ride UI work
no real Mapbox until BD-MAP-FOUND-01
no route split for passenger active ride
no CSP weakening
no inline scripts/styles/on* handlers
no new active-ride storage key without storage_boundary review
no rewriting driver and passenger renderers into one giant branch
```
