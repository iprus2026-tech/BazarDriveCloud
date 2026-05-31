# BD-ORDER-P-09 — post-merge real browser passenger-driver lifecycle smoke

Date: 2026-05-31 UTC

## Result

**Final status: BLOCKED for the required real-browser / real-device smoke.**

The public app was served through a static HTTP server and the lifecycle was
checked with a storage-level module smoke, but the requested real browser/device
execution could not be completed in this container because no browser runtime is
installed and network/package repositories are blocked by policy.

No runtime application bug was confirmed from the available checks.

## Environment

- Repository: `iprus2026-tech/BazarDriveCloud`
- Working tree path: `/workspace/BazarDriveCloud`
- Commit under test: `e1a0db4 BD-ORDER-P-08 fix active ride handoff and terminal cleanup (#314)`
- Static server: `python3 -m http.server 4173 --directory public`
- Base URL: `http://127.0.0.1:4173/`
- Exact app URLs planned for the browser pass:
  - `http://127.0.0.1:4173/#/order-map-draft`
  - `http://127.0.0.1:4173/#/driver-map`
  - `http://127.0.0.1:4173/#/feed`
  - `http://127.0.0.1:4173/#/active-ride?role=driver&tripId=trip_<orderId>&status=ACCEPTED`
  - `http://127.0.0.1:4173/#/active-ride?role=driver`

## Update-main attempt

`git fetch origin main --prune` was attempted after adding the expected GitHub
remote, but the environment proxy returned `403 Forbidden` for GitHub. The local
branch was already at the post-merge PR #314 commit available in the workspace.

## Browser/device availability

Real-browser execution was blocked by the container environment:

- `node -e "require('playwright')"` failed: module not installed.
- `node -e "require('puppeteer')"` failed: module not installed.
- `which chromium || which chromium-browser || which google-chrome` found no browser binary.
- `npm install playwright@latest --no-save` failed with `403 Forbidden` from the npm registry.
- `apt-get update && apt-get install -y chromium` failed with `403 Forbidden` from apt repositories.

Because of that, no screenshot could be captured and no real-browser/manual
device evidence is available from this run.

## Static server check

The public app was served from `public/` and returned `200 OK` for
`http://127.0.0.1:4173/`.

## Storage-level lifecycle evidence (non-browser fallback)

A temporary Node smoke (`/tmp/bd-order-p-09-storage-smoke.mjs`) used a memory
`localStorage` and imported the app modules directly to exercise the same local
mock stores used by Feed, DriverMap, and ActiveRide.

Covered fallback steps:

1. Passenger creates a canonical ride order.
2. Driver projections see the `CREATED` order through `listNearbyOrders()` and Feed projections.
3. Driver accepts the order through `acceptCanonicalRideOrder()`.
4. Active ride is seeded with canonical `trip_<orderId>`.
5. Lifecycle progresses through:
   - `ACCEPTED`
   - `DRIVER_EN_ROUTE`
   - `WAITING_PASSENGER`
   - `IN_PROGRESS`
   - `COMPLETED`
6. Completed order remains absent from DriverMap/listNearbyOrders and Feed projections.
7. `/active-ride?role=driver` latest-handoff equivalent (`findLatestHandedOffOrderTripId()`) resolves the latest live handed-off trip while live.
8. Terminal `COMPLETED`, `CANCELED`, and `NO_SHOW` active rides are not reopened by the latest-handoff resolver.
9. `NO_SHOW` maps to canonical `CANCELED` for the ride-order store.

Fallback command result: PASS.

## Programmatic checks

- `node scripts/check.mjs`: PASS (`All checks passed.`)

## Screenshots / manual evidence notes

- Screenshots: not captured; blocked by absence of a real browser/device in the container.
- Manual browser/device notes: not available; real browser/device execution was blocked before app interaction.

## Final assessment

- Required real-browser / real-device smoke: **BLOCKED**
- Static server availability: **PASS**
- Storage-level lifecycle fallback: **PASS**
- `scripts/check.mjs`: **PASS**
- Runtime bug found: **No confirmed runtime bug from available checks**
