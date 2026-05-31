# BD-ORDER-P-06 — Browser runtime passenger-driver lifecycle smoke

Date: 2026-05-31
Branch: audit/bd-order-p-06-browser-runtime-smoke
Base commit: bc3f561473baf85b0290e11413b60ac78ef3f855
Browser: **Not executed** — no Chromium/Chrome/Firefox binary or Playwright package was available in the container, and temporary installation was blocked by 403 responses from the configured package proxies.
Viewport: Intended mobile viewport 390x844; not reached because no real browser runtime could be launched.
Server URL: http://127.0.0.1:4173/

## PASS/FAIL summary

**FAIL / BLOCKED (environment):** the requested real-browser smoke could not be completed in this execution environment.

This is **not recorded as an application runtime regression** because the app was not opened in a real browser. The blocker was the absence of a browser runtime and the inability to install one temporarily without changing project dependencies.

Preparation results:

- `git checkout main` could not be performed because the local checkout only had the `work` branch and no `main` ref.
- `git pull origin main` could not be performed because no remote was configured in this checkout.
- The audit branch was created locally from the available base commit with `git checkout -B audit/bd-order-p-06-browser-runtime-smoke`.
- `node scripts/check.mjs` passed before creating this report.
- A local static server was started with `python3 -m http.server 4173 --directory public`.
- Playwright was not already installed.
- `npx -y playwright@1.53.0 --version` failed with `403 Forbidden - GET https://registry.npmjs.org/playwright`.
- `apt-get update && apt-get install -y chromium` failed with 403 responses from the configured apt proxy/mirrors.
- No executable `chromium`, `chromium-browser`, `google-chrome`, `chrome`, or `firefox` binary was found under the checked paths.

## What was actually runtime-tested

- [ ] real browser
- [ ] DOM clicks
- [ ] hash router
- [ ] localStorage lifecycle mutations through browser context
- [ ] service worker/cache cleanup in browser context
- [x] local static server startup attempt
- [x] baseline project check
- [x] no backend / no real Mapbox
- [x] no permanent Playwright/package dependency added

Because no browser could be launched, the passenger-driver lifecycle was **not** validated in a browser runtime in this run.

## Scenario

1. Passenger setup — **not executed in browser**.
2. Route draft seed — **not executed in browser**.
3. Order publish — **not executed in browser**.
4. Responses handoff — **not executed in browser**.
5. Driver setup — **not executed in browser**.
6. DriverMap acceptance — **not executed in browser**.
7. Active ride driver lifecycle — **not executed in browser**.
8. Passenger same-trip view — **not executed in browser**.
9. Terminal guard — **not executed in browser**.
10. Console/network observations — **not available from a browser session**.

## Runtime evidence

### orderId

Not available. The passenger publish click was not executed in a browser, so no runtime order was created.

### tripId

Not available. Driver acceptance was not executed in a browser, so no canonical `trip_<orderId>` active ride was seeded.

### Relevant URL list intended for the smoke

- `http://127.0.0.1:4173/#/order-map-draft`
- `http://127.0.0.1:4173/#/responses?orderId=<orderId>&state=empty`
- `http://127.0.0.1:4173/#/driver-map`
- `http://127.0.0.1:4173/#/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED`
- `http://127.0.0.1:4173/#/active-ride?role=passenger&tripId=trip_<orderId>`
- `http://127.0.0.1:4173/#/active-ride?role=passenger`
- `http://127.0.0.1:4173/#/feed`

### localStorage snapshots before/after

No browser `localStorage` snapshots were produced because the browser runtime could not be launched.

#### Intended cleanup script

```js
localStorage.clear();
sessionStorage.clear();
await navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister())));
await caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
```

#### Intended initial `bazardrive.user.v1` passenger snapshot

```json
{
  "welcomeSeen": true,
  "onboarded": true,
  "role": "passenger",
  "firstName": "Алексей",
  "lastName": "Пассажир",
  "displayName": "Алексей Пассажир",
  "city": "Москва",
  "phone": "+79990001122",
  "phoneVerified": true,
  "profileStatus": "ready",
  "notificationsEnabled": true
}
```

#### Intended `bazardrive.route_draft.v1` snapshot

```json
{
  "pickup": { "id": "pickup-runtime", "label": "Лобня, станция" },
  "dropoff": { "id": "dropoff-runtime", "label": "Катуар, станция" },
  "route": {
    "distanceKm": 18.4,
    "durationMin": 27,
    "estimatedPrice": 850
  }
}
```

#### Intended `bazardrive.ride_orders.v1` after publish

Not available. Expected condition for a passing browser run: a newly created order with `status === "CREATED"` and `passenger.name === "Алексей Пассажир"`.

#### Intended `bazardrive.active_ride.v1` after accept

Not available. Expected condition for a passing browser run: a `trip_<orderId>` entry with `status === "ACCEPTED"`, `orderId === orderId`, and `passenger.name === "Алексей Пассажир"`.

## Lifecycle matrix

| Transition | Browser result |
| --- | --- |
| CREATED | Not executed — browser unavailable |
| ACCEPTED | Not executed — browser unavailable |
| DRIVER_EN_ROUTE | Not executed — browser unavailable |
| WAITING_PASSENGER | Not executed — browser unavailable |
| IN_PROGRESS | Not executed — browser unavailable |
| COMPLETED | Not executed — browser unavailable |

Expected persisted sequence for the next runnable browser environment:

`CREATED → ACCEPTED → DRIVER_EN_ROUTE → WAITING_PASSENGER → IN_PROGRESS → COMPLETED`

## PASS/FAIL details

### Environment blocker

The browser-runtime portion failed before application interaction:

```text
$ command -v chromium || command -v chromium-browser || command -v google-chrome
# no output

$ node -e "try{console.log(require.resolve('playwright'))}catch(e){process.exit(1)}"
# exit 1

$ npm_config_cache=/tmp/npm-cache npx -y playwright@1.53.0 --version
npm error 403 403 Forbidden - GET https://registry.npmjs.org/playwright

$ apt-get update && apt-get install -y chromium
E: Failed to fetch http://security.ubuntu.com/ubuntu/dists/noble-security/InRelease  403  Forbidden
E: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/noble/InRelease  403  Forbidden
```

### Application regression status

No application regression was proven in this run. The smoke remains **unverified** until it is rerun in an environment with a real browser runtime available.

### Minimal recommendation

Rerun this smoke on the same branch in an environment that has either:

1. preinstalled Playwright/Chromium, or
2. a system Chrome/Chromium/Firefox executable, or
3. temporary package/browser downloads allowed through the package proxy.

Do not add Playwright or browser dependencies permanently to this repository for this smoke.

## Console / network result

Browser console and page network results are unavailable because no browser session was created.

Observed environment/package network failures:

- npm registry request for temporary Playwright package returned 403.
- apt package index requests for Chromium installation returned 403.

The local static server command itself started successfully at `http://127.0.0.1:4173/` during the attempt.

## node scripts/check.mjs result

Initial run before the report:

```text
All checks passed.
```

Final run after the report:

```text
All checks passed.
```

## git diff --stat

```text
...ser-runtime-passenger-driver-lifecycle-smoke.md | 208 +++++++++++++++++++++
1 file changed, 208 insertions(+)
```
