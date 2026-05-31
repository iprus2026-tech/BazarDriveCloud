# BD-ORDER-P-08 — Real device/browser passenger-driver lifecycle smoke

Date: 2026-05-31
Requested repo: `iprus2026-tech/BazarDriveCloud`
Requested working branch: `audit/bd-order-p-08-real-device-lifecycle-smoke`
Actual local branch: `audit/bd-order-p-08-real-device-lifecycle-smoke`
Base/local commit under test: `2428eccf71582f14659e656497f33e95ba4f7f45`
Task type: QA smoke / runtime audit, no feature implementation
Final verdict: **FAIL: lifecycle not executed because the environment has no real browser/device runtime available**

This audit does **not** claim a product lifecycle failure. It records that the requested real browser / Android Chrome smoke could not be executed in this container because no Chrome/Chromium/Firefox executable is installed, Playwright/Puppeteer are not installed, and both npm and apt acquisition paths are blocked by `403 Forbidden` responses from configured proxies. The local static server and repository preflight check were executed successfully.

## 1. Environment

- Device: container only; no attached Android phone/tablet and no local desktop browser executable available.
- OS: Ubuntu 24.04.4 LTS on Linux kernel `6.12.47`.
- Browser/version: **not available**.
  - `google-chrome --version`: command not found.
  - `google-chrome-stable --version`: command not found.
  - `chromium --version`: command not found.
  - `chromium-browser --version`: command not found.
  - `firefox --version`: command not found.
  - Browser binary scan under `/usr`, `/opt`, and `/root`: no `chrome`, `chromium`, `chromium-browser`, `firefox`, `chrome-headless-shell`, or `msedge` executable found.
- Automation/runtime packages: **not available**.
  - `require.resolve('playwright')`: not installed.
  - `require.resolve('puppeteer')`: not installed.
  - `require.resolve('@playwright/test')`: not installed.
- Package acquisition attempts:
  - `npm view playwright version` failed with `403 Forbidden - GET https://registry.npmjs.org/playwright`.
  - `apt-get update` failed with `403 Forbidden` for Ubuntu and auxiliary apt repositories through proxy `172.30.0.115:8080`.
- URL under test: `http://127.0.0.1:4173/` / `http://localhost:4173/`.
- Branch: `audit/bd-order-p-08-real-device-lifecycle-smoke`.
- Commit SHA: `2428eccf71582f14659e656497f33e95ba4f7f45`.
- Service worker version from source: `v68` (`CACHE_NAME = bazardrive-v68`). Runtime registration could not be inspected without a browser context.
- Local server command: `python3 -m http.server 4173 -d public`.
- Static server HTTP result: `curl -I http://127.0.0.1:4173/` returned `HTTP/1.0 200 OK` with `Content-type: text/html`.

## 2. Preflight

- Requested `git checkout main`: **failed** because the local repository has no `main` branch.
- Requested `git pull origin main`: **failed** because no `origin` remote is configured in this checkout.
- Working branch created locally from the only available branch/commit: `audit/bd-order-p-08-real-device-lifecycle-smoke`.
- `node scripts/check.mjs`: **PASS**, output: `All checks passed.`
- Local static server: **PASS**, `python3 -m http.server 4173 -d public` served `public/index.html` successfully.
- Console errors: **not available**; no browser session could be opened.
- Screenshots/video: **not attached**; no browser/device runtime was available.
- Application source code changes before/during smoke: **none**.

## 3. Scenario results

| Step | URL | Expected | Actual | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- |
| A. Preflight `/feed` | `http://localhost:4173/#/feed` or routed equivalent | App opens, no white screen, no uncaught console errors, bottom nav visible, hard reload survives. | Not executed in a browser; only static server root was reachable via `curl`. | FAIL | Environment blocked by missing browser/runtime. |
| A. FAB guard on active ride | `http://localhost:4173/#/active-ride?role=driver` and passenger equivalent | FAB is hidden on active ride. | Not executed. | FAIL | Requires browser rendering and DOM inspection. |
| B. Passenger order creation | Passenger create-order flow, including `pickup=Лобня`, `dropoff=Катуар`, `comment=smoke BD-ORDER-P-08` | Order is saved to mock/localStorage and visible as `CREATED` / new order. | Not executed. | FAIL | No localStorage context available. |
| B. localStorage changed keys | Browser storage after passenger publish | Changed keys captured. | Not executed. | FAIL | Expected keys likely include `bazardrive.ride_orders.v1`, route draft, and active ride/order handoff keys, but runtime state was not created. |
| C. Driver open order | `http://localhost:4173/#/driver-map` | Driver sees passenger-created order, route, pickup/dropoff, price/meta/status. | Not executed. | FAIL | Requires shared browser storage between passenger and driver role legs. |
| C. Accept order | Driver open-order card/action | First accept succeeds; duplicate accept is blocked or harmless; order becomes accepted active trip. | Not executed. | FAIL | No click/runtime path available. |
| D. Passenger accepted-driver state | `http://localhost:4173/#/active-ride?role=passenger` and `...&status=DRIVER_EN_ROUTE` | Passenger sees accepted driver and no driver-only copy. | Not executed. | FAIL | Requires accepted trip state. |
| E. Driver lifecycle | `http://localhost:4173/#/active-ride?role=driver` | Statuses advance through `DRIVER_EN_ROUTE`, `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`; primary actions match state; reload does not reset unexpectedly. | Not executed. | FAIL | Requires browser state and UI action handling. |
| F. Passenger mirrored lifecycle | `http://localhost:4173/#/active-ride?role=passenger&status=DRIVER_EN_ROUTE`, `WAITING_PASSENGER`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`, `NO_SHOW` | Passenger copy mirrors driver status; write/call/safety/cancel controls do not white-screen. | Not executed. | FAIL | Requires browser rendering and navigation/button checks. |
| G. Cross-role reload | Passenger and driver active ride URLs after driver acceptance | Reload on each role preserves accepted/current state; state does not revert to `CREATED`; terminal trips do not reappear as active feed/driver-map orders. | Not executed. | FAIL | Requires accepted/terminal persisted storage. |
| H. Navigation smoke | `/feed`, `/chat`, `/respond`, `/driver-map`, `/active-ride?role=driver`, `/active-ride?role=passenger` | No white screen, no uncaught errors, back/navigation keeps shell stable, active ride hides chrome/tabbar where expected. | Not executed. | FAIL | Requires browser navigation. |
| I. Browser/device checks | Android Chrome portrait; desktop Chrome responsive 390–430 px; reload; offline/online; site data clear | Real-device/runtime checks complete. | Not executed. | FAIL | No real browser/device present in the environment. |

## 4. Bugs found

No application bugs were confirmed because the smoke did not reach application interaction in a browser. The only blockers recorded are environment/setup blockers.

### Environment blocker 1 — No real browser executable available

- Severity: blocker for this QA task.
- Reproduction steps:
  1. Run `google-chrome --version`, `google-chrome-stable --version`, `chromium --version`, `chromium-browser --version`, and `firefox --version`.
  2. Search expected browser install locations with `find /usr /opt /root -maxdepth 5 -type f \( -name chrome -o -name chromium -o -name chromium-browser -o -name firefox -o -name chrome-headless-shell -o -name msedge \)`.
- Expected: at least one Chrome/Chromium/Firefox executable is available for the requested real browser smoke.
- Actual: all version commands returned `command not found`; the filesystem scan returned no browser executable.
- Console error: not available; no browser console exists.
- localStorage keys/state: not available; no browser context exists.
- Screenshot/video: not attached.

### Environment blocker 2 — Browser automation packages unavailable and cannot be fetched

- Severity: blocker for this QA task in the current container.
- Reproduction steps:
  1. Run `node -e "for (const p of ['playwright','puppeteer','@playwright/test']) { try { console.log(p, require.resolve(p)); } catch(e) { console.log('no '+p); } }"`.
  2. Run `npm view playwright version`.
- Expected: Playwright/Puppeteer is installed or can be acquired temporarily outside the repo.
- Actual: none of the packages are installed; npm registry access for Playwright returns `403 Forbidden`.
- Console error: not available.
- localStorage keys/state: not available.
- Screenshot/video: not attached.

### Environment blocker 3 — System package installation path blocked

- Severity: blocker for installing a browser in the current container.
- Reproduction steps:
  1. Run `apt-get update`.
- Expected: apt indices update so Chromium/Firefox can be installed if absent.
- Actual: Ubuntu archive/security repositories and auxiliary apt repositories return `403 Forbidden` through proxy `172.30.0.115:8080`; apt exits with code `100`.
- Console error: not available.
- localStorage keys/state: not available.
- Screenshot/video: not attached.

### Environment blocker 4 — Requested main/origin preflight unavailable in checkout

- Severity: medium for reproducing the exact requested branch setup.
- Reproduction steps:
  1. Run `git checkout main`.
  2. Run `git pull origin main`.
- Expected: local `main` exists and `origin` remote points to `iprus2026-tech/BazarDriveCloud`.
- Actual: `main` pathspec is unknown and no `origin` remote is configured.
- Console error: not applicable.
- localStorage keys/state: not applicable.
- Screenshot/video: not applicable.

## 5. Final verdict

**FAIL: lifecycle broken by environment blockers, not by a confirmed application defect.**

The passenger → driver → active ride lifecycle remains **unverified** for BD-ORDER-P-08. A valid rerun needs either:

1. a real desktop Chrome/Chromium/Firefox browser attached to this environment,
2. an Android device reachable from the local server URL, or
3. preinstalled Playwright/Puppeteer plus a browser binary/cache.

## 6. Requested no-code-change state

- Implementation code changed: **no**.
- Audit report created: `docs/audits/bd-order-p-08-real-device-lifecycle-smoke.md`.
- Expected git state after report creation: only this docs audit file should be modified/added.

## 7. Evidence and command log

```bash
git status --short --branch
# Initial: ## work
```

```bash
git checkout main
# error: pathspec 'main' did not match any file(s) known to git
```

```bash
git pull origin main
# fatal: 'origin' does not appear to be a git repository
# fatal: Could not read from remote repository.
```

```bash
git checkout -B audit/bd-order-p-08-real-device-lifecycle-smoke
# Switched to a new branch 'audit/bd-order-p-08-real-device-lifecycle-smoke'
```

```bash
node scripts/check.mjs
# All checks passed.
```

```bash
python3 -m http.server 4173 -d public
# Started successfully and served http://127.0.0.1:4173/
```

```bash
curl -I http://127.0.0.1:4173/
# HTTP/1.0 200 OK
# Content-type: text/html
# Content-Length: 3918
```

```bash
for c in google-chrome google-chrome-stable chromium chromium-browser firefox playwright npx node npm python3; do printf '%-24s' "$c"; command -v "$c" || true; done
# Only npx, node, npm, and python3 were found.
```

```bash
(google-chrome --version || google-chrome-stable --version || chromium --version || chromium-browser --version || firefox --version) 2>&1 | head -20
# All browser version commands returned command not found.
```

```bash
node -e "for (const p of ['playwright','puppeteer','@playwright/test']) { try { console.log(p, require.resolve(p)); } catch(e) { console.log('no '+p); } }"
# no playwright
# no puppeteer
# no @playwright/test
```

```bash
npm view playwright version
# npm error 403 403 Forbidden - GET https://registry.npmjs.org/playwright
```

```bash
apt-get update
# Failed with 403 Forbidden for Ubuntu repositories through proxy 172.30.0.115:8080.
```

```bash
find /usr /opt /root -maxdepth 5 -type f \( -name chrome -o -name chromium -o -name chromium-browser -o -name firefox -o -name chrome-headless-shell -o -name msedge \) 2>/dev/null | head -100
# No browser executable found.
```

## 8. URLs checked or targeted

Actually checked without a browser:

- `http://127.0.0.1:4173/` — `curl -I` returned `HTTP/1.0 200 OK`.

Targeted but not browser-opened because no browser/device runtime exists:

- `http://localhost:4173/#/feed`
- `http://localhost:4173/#/chat`
- `http://localhost:4173/#/respond`
- `http://localhost:4173/#/driver-map`
- `http://localhost:4173/#/active-ride?role=driver`
- `http://localhost:4173/#/active-ride?role=passenger`
- `http://localhost:4173/#/active-ride?role=passenger&status=DRIVER_EN_ROUTE`
- `http://localhost:4173/#/active-ride?role=passenger&status=WAITING_PASSENGER`
- `http://localhost:4173/#/active-ride?role=passenger&status=IN_PROGRESS`
- `http://localhost:4173/#/active-ride?role=passenger&status=COMPLETED`
- `http://localhost:4173/#/active-ride?role=passenger&status=CANCELED`
- `http://localhost:4173/#/active-ride?role=passenger&status=NO_SHOW`

## 9. End-of-audit commands

To be run immediately before commit/PR:

```bash
git status --short --branch
```

```bash
git diff --stat
```

```bash
node scripts/check.mjs
```

Final verdict repeated: **FAIL: lifecycle not executed because no real browser/device runtime is available in this environment.**
