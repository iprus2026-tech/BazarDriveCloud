# Active ride implementation plan (D0)

Tracking issues:

- #52 BD-RIDE-PLAN-01 Active ride passenger/driver Mapbox implementation plan
- #53 BD-RIDE-D-01 Driver active ride flow — Cloud Design screen map and staged plan

This document is the D0 deliverable. **D0 is documentation only.** It does not add UI, routes, Mapbox, backend, dependencies, or service-worker entries.

---

## 1. Активная поездка — overview

Cloud Design уже содержит экраны активной поездки для двух ролей:

- пассажира
- водителя

В Cloud Design присутствует макет карты — позже он должен быть реализован через Mapbox. Сейчас раздел слишком большой для одной итерации:

- много экранов (passenger + driver + foundation),
- много кнопок и нижних шторок,
- разные роли с разными переходами,
- собственная state machine поездки,
- связь с существующим чатом и откликами,
- будущая Mapbox-интеграция, которую нужно изолировать.

Поэтому D0 фиксирует план внедрения, а не реализацию. Любая работа над экранами активной поездки и Mapbox должна сверяться с этим документом.

---

## 2. Текущие готовые flow

Уже реализовано в репозитории и доступно в Cloud Design:

- `/feed` — лента постов;
- `/respond` — экран отклика;
- `/chat` — чат водителя и пассажира;
- переход `/feed → Откликнуться → /respond?postId=<id>`;
- переход `/feed → Написать водителю → /chat?tripId=<id>`.

Активная поездка стыкуется именно с этими flow — она запускается после чата и временного подтверждения.

---

## 3. High-level flow

```text
Feed
  └─ Chat
       └─ temporary confirmation handoff
            └─ Active ride
                 └─ Ride completion
```

**Важно:** Cloud Design пока не содержит отдельный экран подтверждения поездки. Поэтому подтверждение поездки в первой итерации должно быть **временным мостом** (handoff), а не финальным дизайном. Финальный confirmation screen появится позже, когда дизайн будет отрисован в Cloud Design отдельным макетом.

---

## 4. Роли

### Passenger

- смотрит, где сейчас водитель (карта + статус);
- пишет водителю (переиспользует существующий `/chat`);
- инициирует звонок через **stub** (без реальной телефонии);
- может отменить поездку;
- видит блок «Безопасность» (stub);
- видит статус прибытия водителя (en route → approaching → arrived);
- видит статус самой поездки (waiting → in progress → completed).

### Driver

- принимает и ведёт активную поездку;
- едет к пассажиру;
- нажимает **«Я на месте»**;
- ждёт пассажира (с лимитом бесплатного ожидания);
- начинает поездку;
- завершает поездку;
- пишет или звонит пассажиру через stub;
- открывает внешний навигатор через stub;
- может открыть «Отменить» или «Проблема» — оба через stub-шторки.

Обе роли работают с одним и тем же `tripId` и одной и той же state machine, но видят разные действия и разные нижние шторки.

---

## 5. State machine

Полный список состояний поездки (используется в `status` data contract):

```text
DRAFT
REQUESTED
RESPONDED
CHAT_STARTED
CONFIRMATION_PENDING
CONFIRMED
DRIVER_EN_ROUTE
DRIVER_APPROACHING_PICKUP
DRIVER_ARRIVED
WAITING_PASSENGER
PASSENGER_ONBOARD
IN_PROGRESS
COMPLETED
CANCELED
NO_SHOW
```

### Минимальный happy path для первого driver prototype (D1/D2)

```text
DRIVER_EN_ROUTE
  → WAITING_PASSENGER
      → IN_PROGRESS
          → COMPLETED
```

Все остальные состояния валидны в контракте, но первая driver-итерация должна корректно работать только на этих четырёх. `CONFIRMATION_PENDING` обслуживает временный bridge (см. BD-CONFIRM-01).

---

## 6. Screen inventory

### Passenger side

- **BD-RIDE-P-01** PassengerActiveRideMap — корневой экран активной поездки пассажира с картой.
- **BD-RIDE-P-02** PassengerDriverEnRoute — состояние «водитель едет к вам».
- **BD-RIDE-P-03** PassengerDriverArrived — состояние «водитель на месте».
- **BD-RIDE-P-04** PassengerOnRide — состояние «в пути».
- **BD-RIDE-P-05** PassengerRideComplete — экран завершения поездки.
- **BD-RIDE-P-06** PassengerCancelRideSheet — нижняя шторка отмены.
- **BD-RIDE-P-07** PassengerSafetySheet — нижняя шторка «Безопасность» (stub).

### Driver side

- **BD-RIDE-D-01** DriverActiveRideMap — корневой экран активной поездки водителя.
- **BD-RIDE-D-02** DriverToPickup — «Еду к пассажиру».
- **BD-RIDE-D-03** DriverApproachingPickup — «Подъезжаете к точке».
- **BD-RIDE-D-04** DriverWaitingPassenger — «Ожидание пассажира» с таймером.
- **BD-RIDE-D-05** DriverRideInProgress — «Везёте пассажира».
- **BD-RIDE-D-06** DriverRideComplete — экран завершения для водителя.
- **BD-RIDE-D-07** DriverCancelRideSheet — нижняя шторка отмены.
- **BD-RIDE-D-08** DriverProblemSheet — нижняя шторка «Проблема» (stub).
- **BD-RIDE-D-09** DriverEarningsSheet — заработок за поездку и за день.

### Foundation / shared

- **BD-RIDE-F-01** ActiveRideStateContract — единый контракт состояния поездки.
- **BD-RIDE-F-02** MapShellPlaceholder — placeholder карты без Mapbox.
- **BD-RIDE-F-03** RouteLineMock — мок маршрутной линии поверх placeholder.
- **BD-RIDE-F-04** BottomSheetLayout — переиспользуемая нижняя шторка.
- **BD-RIDE-F-05** TripStatusBanner — баннер статуса поездки.
- **BD-RIDE-F-06** SafetyAndProblemStubs — stub-шторки для безопасности и проблем.
- **BD-RIDE-F-07** ActiveRideStorage — слой над localStorage.

### Missing temporary bridge

- **BD-CONFIRM-01** TripConfirmationHandoff — временный экран подтверждения поездки между чатом и активной поездкой. Финального дизайна в Cloud Design ещё нет.

---

## 7. Driver Cloud Design screen map

Раздел: **Активная поездка · водитель**.

Состояния (соответствуют скринам Cloud Design):

1. Новый заказ
2. Еду к пассажиру
3. Подъезжаете к точке
4. Ожидание пассажира
5. Везёте пассажира

### 1 · Новый заказ

- **Title:** Новый заказ
- **Details:** короткая сводка маршрута (откуда → куда), цена, расстояние.
- **Passenger:** имя, инициалы, рейтинг, маска телефона, багаж.
- **Primary action:** Принять заказ
- **Secondary actions:** Отказаться · Открыть детали
- **Transition:** `REQUESTED → CONFIRMED → DRIVER_EN_ROUTE`

### 2 · Еду к пассажиру

- **Title:** Едете к пассажиру
- **Details:** `1,2 км · ул. Малая Бронная, 28`
- **Instruction:** `Через 350 м направо` / `на Тверской бульвар`
- **Passenger:** `Анна М. · ★ 4,86` / `+7 ... 23-45 · 1 чемодан`
- **Primary action:** Я на месте
- **Secondary actions:** Написать «подъезжаю» · Отменить · Навигатор · Message · Phone
- **Transition:** `DRIVER_EN_ROUTE → WAITING_PASSENGER` (через `DRIVER_APPROACHING_PICKUP` при подъезде)

### 3 · Подъезжаете к точке

- **Title:** Подъезжаете к точке
- **Details:** оставшееся расстояние/время до пикапа.
- **Instruction:** последняя инструкция перед прибытием.
- **Passenger:** те же данные, что и в состоянии 2.
- **Primary action:** Я на месте
- **Secondary actions:** Написать · Позвонить · Навигатор · Отменить
- **Transition:** `DRIVER_APPROACHING_PICKUP → DRIVER_ARRIVED → WAITING_PASSENGER`

### 4 · Ожидание пассажира

- **Title:** Ожидание пассажира
- **Details:** таймер свободного ожидания, момент начала платного ожидания, ставка.
- **Passenger:** имя, рейтинг, контакт.
- **Primary action:** Начать поездку
- **Secondary actions:** Написать · Позвонить · Пассажир не пришёл · Отменить
- **Transition:** `WAITING_PASSENGER → IN_PROGRESS` (или `NO_SHOW` через secondary action)

### 5 · Везёте пассажира

- **Title:** Везёте пассажира
- **Details:** ETA до точки назначения, текущая улица/инструкция.
- **Passenger:** имя, рейтинг.
- **Primary action:** Завершить поездку
- **Secondary actions:** Навигатор · Сообщение · Проблема
- **Transition:** `IN_PROGRESS → COMPLETED`

Каждое состояние позже мапится на один и тот же экран `DriverActiveRideMap` (BD-RIDE-D-01) с переключаемой нижней шторкой.

---

## 8. Routes

Для первого этапа реализации (D1) предполагаются hash-маршруты в существующем роутере:

```text
/active-ride?tripId=<id>&role=driver
/active-ride?tripId=<id>&role=passenger
```

Fallback (если `tripId` отсутствует — используется демо-поездка из localStorage):

```text
/active-ride?role=driver
/active-ride?role=passenger
```

Позже, когда роли разойдутся по разным шеллам, возможно:

```text
/ride/driver
/ride/passenger
```

В D0 ни один из этих маршрутов в `router.js` не регистрируется.

---

## 9. localStorage keys

Зарезервированные ключи для активной поездки и сопутствующего состояния:

```text
bazardrive.active_ride.v1     — текущий объект активной поездки
bazardrive.trip_status.v1     — последний статус (для быстрого восстановления)
bazardrive.route_draft.v1     — черновик маршрута до активации поездки
bazardrive.map_prefs.v1       — настройки карты (zoom, центр, тема)
```

Версия `v1` зафиксирована, чтобы поздние миграции могли вводить `v2` без коллизий.

---

## 10. Data contract

Пример JS-объекта активной поездки (используется в `bazardrive.active_ride.v1`):

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
    confirmedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null
  }
}
```

Поля `pickup` и `dropoff` хранятся в формате `{ lng, lat }` сразу, чтобы при подключении Mapbox их можно было передать в API без преобразований.

---

## 11. Mapbox boundary

**Важно:** в D1 и D2 реальный Mapbox не подключается.

Вместо него используется placeholder. Будущий файл:

```text
public/src/mapbox/map_shell.js
```

В D0 этот файл **не создаётся** — он только описывается.

### MapShell placeholder должен позже поддерживать

- тёмную сетку карты в стилистике Cloud Design;
- mock route line поверх сетки;
- маркер pickup;
- маркер dropoff;
- маркер машины;
- стабильный sizing контейнера (без layout shift);
- работу без Mapbox-токена;
- работу без внешних сетевых запросов;
- fallback-режим при будущем сбое Mapbox.

Реальная интеграция Mapbox — отдельный issue: **BD-MAP-FOUND-01 Mapbox integration foundation**. Туда же выносится загрузка токена, CSP-исключения, dependency и SW-обновления.

---

## 12. Phased implementation

### Phase D0 (этот этап)

- только документация;
- нет UI, нет routes, нет Mapbox, нет backend, нет CSS, нет SW-изменений.

### Phase D1

- `/active-ride` route stub в существующем hash-роутере;
- mock map shell (placeholder без Mapbox);
- верхняя driver-панель (контекст поездки);
- нижняя шторка, переключаемая по статусу;
- состояние поездки в localStorage по ключам из §9.

### Phase D2

- driver status transitions (en route → waiting → in progress);
- кнопка «Я на месте»;
- кнопка «Начать поездку»;
- кнопка «Завершить поездку»;
- stub-действия: навигатор, сообщение, звонок, проблема.

### Phase D3

- экран/шторка завершения поездки;
- earnings summary (BD-RIDE-D-09);
- возврат к `/feed`.

### Phase P1

- passenger-сторона активной поездки (BD-RIDE-P-01 … P-07);
- та же state machine, разная нижняя шторка.

### Phase M1

- Mapbox foundation (BD-MAP-FOUND-01);
- замена MapShell placeholder на реальную карту;
- обновление CSP и SW в рамках именно этого issue.

---

## 13. Follow-up issues

После D0 ожидается следующий список issues / PR:

- **BD-RIDE-F-01** Active ride contracts and storage — implemented in `public/src/ride_state.js`
- **BD-RIDE-F-02** MapShell placeholder — implemented in `public/src/mapbox/map_shell.js`
- **BD-RIDE-D-01** Driver active ride foundation
- **BD-RIDE-D-02** Driver state transitions
- **BD-RIDE-D-03** Driver completion sheet
- **BD-RIDE-P-01** Passenger active ride foundation
- **BD-CONFIRM-01** Trip confirmation bridge
- **BD-MAP-FOUND-01** Mapbox integration foundation

---

## 14. D0 boundaries (что НЕ делается в этом этапе)

- не создаётся JS-экран активной поездки;
- не регистрируется route `/active-ride`;
- не меняется `public/sw.js`;
- не меняется `public/styles/cloud.css`;
- не меняется `public/src/app.js` и `public/src/router.js`;
- не добавляется Mapbox (ни SDK, ни токен, ни CSP-исключения);
- не добавляется backend / network-слой;
- не добавляются package-зависимости;
- не ослабляется CSP, не вводятся inline `<script>` / `<style>`;
- не копируется Cloud Design prototype в `public/`.
