# BD-ORDER-P-07 — Real browser passenger-driver lifecycle rerun

Date: 2026-05-31
Branch: `audit/bd-order-p-07-real-browser-rerun`
Base commit: `ce0d480a9e260d8aadc67aa2b4236e0a6d39bd2a`
Result: **BLOCKED**

This rerun was requested specifically because BD-ORDER-P-06 was a docs-only browser-runtime smoke attempt. In this environment, the real browser rerun is still **blocked before application interaction**: no Chrome/Chromium/Firefox binary is installed, no Playwright/Puppeteer package is available, and temporary installation attempts are blocked by `403 Forbidden` responses from the configured package proxies.

This report does **not** claim PASS. The passenger → driver lifecycle was not executed in a real browser runtime.

## 1. Environment

- OS: Ubuntu 24.04.4 LTS (`Linux db895383dfa6 6.12.47 #1 SMP Mon Oct 27 10:01:15 UTC 2025 x86_64`).
- Node.js: `v24.15.0`.
- npm: `11.4.2`.
- Python: `Python 3.14.4`.
- Browser name/version: **not available**.
  - `google-chrome --version`: `/bin/bash: google-chrome: command not found`.
  - `google-chrome-stable --version`: `/bin/bash: google-chrome-stable: command not found`.
  - `chromium --version`: `/bin/bash: chromium: command not found`.
  - `chromium-browser --version`: `/bin/bash: chromium-browser: command not found`.
  - `firefox --version`: `/bin/bash: firefox: command not found`.
  - `find /usr /opt /root -maxdepth 5 -type f \( -name chrome -o -name chromium -o -name chromium-browser -o -name firefox -o -name chrome-headless-shell -o -name msedge \)` returned no browser executable.
- Automation tool: **not available**.
  - `require.resolve('playwright')`: not installed.
  - `require.resolve('puppeteer')`: not installed.
  - Temporary Playwright install attempted outside the repo in `/tmp/bd-order-p-07-playwright` and failed with `npm error 403 403 Forbidden - GET https://registry.npmjs.org/playwright`.
- System package installation: unavailable through the current proxy.
  - `apt-get update` failed with `403 Forbidden` for Ubuntu archive/security repositories and the configured proxy endpoint `172.30.4.195:8080`.
- Local server command checked: `python3 -m http.server 8000 --directory public`.
  - `curl -I http://127.0.0.1:8000/` returned `HTTP/1.0 200 OK`.

## 2. Clean state procedure

A clean browser context could not be opened, so browser storage cleanup could not be executed.

Planned real-browser cleanup for the next runnable environment:

```js
localStorage.clear();
sessionStorage.clear();
await navigator.serviceWorker.getRegistrations().then((registrations) =>
  Promise.all(registrations.map((registration) => registration.unregister())),
);
await caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
```

- localStorage keys cleared: **not executed** because no browser context was available.
- caches cleared: **not executed** because no browser context was available.
- service worker status: **not observed** because no browser context was available.
- Service worker interference: **not assessed**; no SW registration could be inspected or removed.

## 3. Scenario transcript

### Passenger steps

| Step | Target | Browser result |
| --- | --- | --- |
| 1 | Open app in a clean browser context | Blocked — no browser runtime. |
| 2 | Clear `localStorage`, caches, service workers | Blocked — no browser runtime. |
| 3 | Open `/profile?role=passenger` | Not executed. |
| 4 | Verify passenger-specific actions and no driver leakage | Not executed. |
| 5 | Open `/map?role=passenger` | Not executed. |
| 6 | Create a passenger order through `/route-picker`, `/route-preview` if used, and `/order-map-draft?role=passenger` | Not executed. |
| 7 | Publish the order | Not executed. |
| 8 | Capture `orderId`/`tripId` from UI, URL, or localStorage | Not available. |
| 9 | Verify `/active-ride?role=passenger` and `/active-ride?role=passenger&tripId=<id>` | Not executed. |

### Driver steps

| Step | Target | Browser result |
| --- | --- | --- |
| 10 | Open `/profile?role=driver` | Not executed. |
| 11 | Verify driver profile does not create a passenger order by default | Not executed. |
| 12 | Open `/driver-map?role=driver` | Not executed. |
| 13 | Verify the passenger order is visible to the driver | Not executed. |
| 14 | Accept the order | Not executed. |
| 15 | Verify transition to `/active-ride?role=driver&tripId=<id>` | Not executed. |
| 16 | Verify passenger snapshot/order data persist | Not executed. |
| 17 | Verify passenger side `/active-ride?role=passenger&tripId=<id>` shows accepted/driver en route state | Not executed. |

### Lifecycle/status steps

| Status/guard | Browser result |
| --- | --- |
| `ACCEPTED` | Not executed. |
| `DRIVER_EN_ROUTE` | Not executed. |
| `WAITING_PASSENGER` | Not executed. |
| `IN_PROGRESS` | Not executed. |
| `COMPLETED` | Not executed. |
| Terminal guard: `COMPLETED`/`CANCELED`/`NO_SHOW` absent from active DriverMap/Passenger lookup | Not executed. |
| Driver active ride refresh persistence | Not executed. |
| Passenger active ride refresh persistence | Not executed. |

## 4. Evidence

### URLs opened

No application URL was opened in a browser. The local server was smoke-checked only via HTTP headers:

- `http://127.0.0.1:8000/` — returned `HTTP/1.0 200 OK` via `curl -I`.

Intended browser URLs for the rerun:

- `http://127.0.0.1:8000/#/profile?role=passenger`
- `http://127.0.0.1:8000/#/map?role=passenger`
- `http://127.0.0.1:8000/#/route-picker?role=passenger`
- `http://127.0.0.1:8000/#/route-preview?role=passenger`
- `http://127.0.0.1:8000/#/order-map-draft?role=passenger`
- `http://127.0.0.1:8000/#/active-ride?role=passenger`
- `http://127.0.0.1:8000/#/active-ride?role=passenger&tripId=<id>`
- `http://127.0.0.1:8000/#/profile?role=driver`
- `http://127.0.0.1:8000/#/driver-map?role=driver`
- `http://127.0.0.1:8000/#/active-ride?role=driver&tripId=<id>`

### Console error summary

Unavailable. No browser session was created, so no console stream could be captured.

### Network/runtime summary

Unavailable for JS/CSS browser loading. The only runtime-adjacent network check was the local static server header request:

```text
HTTP/1.0 200 OK
Server: SimpleHTTP/0.6 Python/3.14.4
Content-type: text/html
Content-Length: 3918
```

Package/browser acquisition failures:

```text
npm error 403 403 Forbidden - GET https://registry.npmjs.org/playwright
```

```text
E: Failed to fetch http://security.ubuntu.com/ubuntu/dists/noble-security/InRelease  403  Forbidden [IP: 172.30.4.195 8080]
E: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/noble/InRelease  403  Forbidden [IP: 172.30.4.195 8080]
E: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/noble-updates/InRelease  403  Forbidden [IP: 172.30.4.195 8080]
E: Failed to fetch http://archive.ubuntu.com/ubuntu/dists/noble-backports/InRelease  403  Forbidden [IP: 172.30.4.195 8080]
```

### Screenshots/video paths

None. No browser runtime was available to capture screenshots or video.

### Relevant localStorage snapshot snippets

None. No browser context was opened, so no `localStorage` snapshot exists for this rerun.

Expected snippets to capture in the next runnable browser environment:

```json
{
  "bazardrive.user.v1": "passenger or driver role snapshot",
  "bazardrive.route_draft.v1": "route draft used to publish the passenger order",
  "bazardrive.ride_orders.v1": "created passenger order and terminal guard state",
  "bazardrive.active_ride.v1": "accepted trip snapshot with preserved passenger identity"
}
```

## 5. Result

**BLOCKED** — real browser lifecycle rerun could not start because no browser binary or automation runtime is available and temporary installation is blocked by package proxy `403` responses.

This is not a PASS and not an application lifecycle FAIL. The requested browser-only verification remains unverified.

## 6. Findings

- Role leaks: **not assessed**.
- Lifecycle gaps: **not assessed**.
- Terminal guard issues: **not assessed**.
- Refresh persistence issues: **not assessed**.
- Driver history contamination by passenger order: **not assessed**.
- Accepted order passenger identity preservation: **not assessed**.
- Browser console uncaught errors: **not assessed**.
- JS/CSS browser load failures: **not assessed**.
- Service worker/cache interference: **not assessed**.

## 7. Commands run

```bash
git checkout -B audit/bd-order-p-07-real-browser-rerun
```

```bash
node scripts/check.mjs
# All checks passed.
```

```bash
for c in google-chrome google-chrome-stable chromium chromium-browser firefox playwright npx node npm python3; do printf '%-24s' "$c"; command -v "$c" || true; done
```

```bash
(google-chrome --version || google-chrome-stable --version || chromium --version || chromium-browser --version || firefox --version) 2>&1 | head -20
```

```bash
node -e "try{console.log('playwright',require.resolve('playwright'))}catch(e){console.log('no playwright')} try{console.log('puppeteer',require.resolve('puppeteer'))}catch(e){console.log('no puppeteer')}"
```

```bash
mkdir -p /tmp/bd-order-p-07-playwright && cd /tmp/bd-order-p-07-playwright && npm init -y >/dev/null && npm install playwright@latest
# Failed: npm error 403 403 Forbidden - GET https://registry.npmjs.org/playwright
```

```bash
apt-get update
# Failed: Ubuntu package repository requests returned 403 Forbidden through the configured proxy.
```

```bash
find /usr /opt /root -maxdepth 5 -type f \( -name chrome -o -name chromium -o -name chromium-browser -o -name firefox -o -name chrome-headless-shell -o -name msedge \) 2>/dev/null | head -100
# No browser executable found.
```

```bash
python3 -m http.server 8000 --directory public
# Started successfully for the header check; stopped after curl verification.
```

```bash
curl -I http://127.0.0.1:8000/
# HTTP/1.0 200 OK
```

## 8. Required pre-PR checks

To be run immediately before PR creation:

```bash
node scripts/check.mjs
```

```bash
git diff --stat
```

```bash
git status --short --branch
```
