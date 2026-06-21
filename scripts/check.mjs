import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const errors = [];

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function walk(dir, exts) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'prototypes') continue;
      out.push(...walk(p, exts));
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

const indexPath = path.join(root, 'public', 'index.html');
if (!exists(indexPath)) {
  errors.push('public/index.html not found');
} else {
  const html = fs.readFileSync(indexPath, 'utf8');
  if (/<script(?![^>]*\bsrc\b)[^>]*>[\s\S]*?<\/script>/i.test(html)) {
    errors.push('public/index.html contains inline <script>');
  }
  if (/<style[\s>]/i.test(html)) {
    errors.push('public/index.html contains <style> tag');
  }
  if (/\sstyle\s*=/i.test(html)) {
    errors.push('public/index.html contains style="" attribute');
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) {
    errors.push('public/index.html contains inline event handler (on*=)');
  }
}

const manifestPath = path.join(root, 'public', 'manifest.webmanifest');
if (exists(manifestPath)) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const key of ['name', 'start_url', 'display', 'theme_color', 'background_color', 'icons']) {
      if (!(key in m)) errors.push(`manifest.webmanifest missing field: ${key}`);
    }
    if (m.theme_color && m.theme_color.toUpperCase() !== '#FF6B35') {
      errors.push(`manifest.webmanifest theme_color expected #FF6B35, got ${m.theme_color}`);
    }
    if (m.background_color && m.background_color.toLowerCase() !== '#0a0a0c') {
      errors.push(`manifest.webmanifest background_color expected #0a0a0c, got ${m.background_color}`);
    }
  } catch (e) {
    errors.push('manifest.webmanifest is not valid JSON: ' + e.message);
  }
}

const swPath = path.join(root, 'public', 'sw.js');
if (exists(swPath)) {
  const sw = fs.readFileSync(swPath, 'utf8');
  const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
  if (precacheMatch && /prototypes\//.test(precacheMatch[1])) {
    errors.push('public/sw.js precache list must not contain prototype reference');
  }
}

const JS_INLINE_STYLE_PATTERNS = [
  { re: /style\s*=\s*["'`]/, label: 'style= attribute in template literal or string' },
  { re: /\.setAttribute\s*\(\s*['"`]style['"`]/, label: '.setAttribute("style", ...)' },
  { re: /\.style\.(?!cssText\s*=\s*''|cssText\s*=\s*"")/, label: '.style.<property> assignment' },
];

const srcDir = path.join(root, 'public', 'src');
for (const f of walk(srcDir, ['.js'])) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  for (const { re, label } of JS_INLINE_STYLE_PATTERNS) {
    if (re.test(src)) {
      errors.push(`${rel}: forbidden inline style pattern — ${label}`);
    }
  }
}


const activeRidePath = path.join(srcDir, 'screens', 'active_ride.js');
if (exists(activeRidePath)) {
  const activeRideSrc = fs.readFileSync(activeRidePath, 'utf8');
  if (!/const\s+latestHandedOffTripId\s*=\s*rawTripId\s*\?\s*null\s*:\s*findLatestHandedOffOrderTripId\(\)/.test(activeRideSrc)) {
    errors.push('active_ride.js driver branch must resolve latest handed-off order tripId before demo fallback');
  }
  if (!/const\s+tripId\s*=\s*rawTripId\s*\|\|\s*latestHandedOffTripId\s*\|\|\s*DEMO_ACTIVE_RIDE_ID/.test(activeRideSrc)) {
    errors.push('active_ride.js driver branch must prefer explicit tripId, then latest handed-off tripId, then demo fallback');
  }
  if (!/!hasValidStatusQuery\s*&&\s*!driverSnapshot\s*&&\s*!hasExplicitTripId\s*&&\s*!hasLatestHandedOffTripId/.test(activeRideSrc)) {
    errors.push('active_ride.js driver empty state must not render when a latest handed-off tripId exists');
  }
  if (!/updateTripStatus/.test(activeRideSrc) || !/function\s+syncCanonicalOrderStatus/.test(activeRideSrc)) {
    errors.push('active_ride.js driver lifecycle must sync canonical ride order status');
  }
  if (!/\[RIDE_STATUS\.NO_SHOW\]:\s*RIDE_STATUS\.CANCELED/.test(activeRideSrc)) {
    errors.push('active_ride.js must map NO_SHOW active rides to CANCELED canonical ride orders');
  }
  if (!/persistDriverRideStatus\(RIDE_STATUS\.IN_PROGRESS[,)]/.test(activeRideSrc)
      || !/persistDriverRideStatus\(RIDE_STATUS\.COMPLETED[,)]/.test(activeRideSrc)
      || !/persistDriver(?:RideStatus|Cancel)\(RIDE_STATUS\.CANCELED[,)]/.test(activeRideSrc)) {
    errors.push('active_ride.js driver lifecycle actions must persist and sync in-progress, completed, and canceled statuses');
  }
}

for (const f of walk(path.join(root, 'public'), ['.js'])) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).slice(0, 400);
    errors.push(`Syntax error in ${path.relative(root, f)}\n${msg}`);
  }
}

// BD-ONBOARDING-02 — static/behavioural smoke for the Welcome render gate
// and the loading timer stale-navigation guard.
const welcomeLoadingTimerSmoke = path.join(root, 'scripts', 'smoke-welcome-loading-timer.mjs');
if (exists(welcomeLoadingTimerSmoke)) {
  try {
    execFileSync(process.execPath, [welcomeLoadingTimerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-welcome-loading-timer.mjs failed\n${msg}`);
  }
}

// BD-SETTINGS-01 — static regression smoke for the new Settings screen
// (route registration, both profile-gear entry points, gate states, UI-only
// boundary, SW precache).
const settingsSmoke = path.join(root, 'scripts', 'smoke-settings.mjs');
if (exists(settingsSmoke)) {
  try {
    execFileSync(process.execPath, [settingsSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-settings.mjs failed\n${msg}`);
  }
}

// BD-OPS-03 — static regression smoke for the ScreenOps dev/docs route
// (route registration, not-in-tabbar, registry seed, generator route/file/id
// embedding, MEL store key, no hard-coded credentials, SW precache of every new
// ops runtime file).
const opsScreensSmoke = path.join(root, 'scripts', 'smoke-ops-screens.mjs');
if (exists(opsScreensSmoke)) {
  try {
    execFileSync(process.execPath, [opsScreensSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-ops-screens.mjs failed\n${msg}`);
  }
}

// BD-DATA-STATIC-01 (#636) — backend-readiness gate: lock the static-data surface
// so the Phase-1 data-layer migration (#584) proceeds with a green/red signal. Fails
// if a localStorage store appears in public/src that is not classified in the
// manifest (orphan, e.g. the old order_overlay.v1 gap) or if a user-data key is not
// documented in storage_boundary.js.
const staticDataSmoke = path.join(root, 'scripts', 'smoke-static-data-inventory.mjs');
if (exists(staticDataSmoke)) {
  try {
    execFileSync(process.execPath, [staticDataSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-static-data-inventory.mjs failed\n${msg}`);
  }
}

// BD-POST-01 — static regression smoke for the post-detail primary-action
// resolver (pickCtaSpec kinds + runCtaAction per-kind routing). Audit #455
// flagged this resolver had no behavioural pin.
const postDetailCtaSmoke = path.join(root, 'scripts', 'smoke-post-detail-cta-resolver.mjs');
if (exists(postDetailCtaSmoke)) {
  try {
    execFileSync(process.execPath, [postDetailCtaSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-post-detail-cta-resolver.mjs failed\n${msg}`);
  }
}

// BD-POST-01 — static regression smoke for the post-detail contact-block gate
// (PR #666): the author-contact atom renders only for ride posts (type 'trip'),
// so system / announcement / marketplace posts never surface revealedPhone()'s
// mock fallback as a fabricated dialable «Контакт автора».
const postDetailContactGateSmoke = path.join(root, 'scripts', 'smoke-post-detail-contact-gate.mjs');
if (exists(postDetailContactGateSmoke)) {
  try {
    execFileSync(process.execPath, [postDetailContactGateSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-post-detail-contact-gate.mjs failed\n${msg}`);
  }
}

// BD-MAP-01 / BD-MAP-02 — static regression smoke for the /map and
// /location-permission branch destinations. Audit #455 flagged the map-flow
// branches had no dedicated pin.
const mapFlowSmoke = path.join(root, 'scripts', 'smoke-map-flow-branches.mjs');
if (exists(mapFlowSmoke)) {
  try {
    execFileSync(process.execPath, [mapFlowSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-map-flow-branches.mjs failed\n${msg}`);
  }
}

// BD-RIDE-P-06/07 — static regression smoke for the passenger NO_SHOW terminal
// fallback (audit URL reachability, terminal short-circuit, copy, single
// return-home CTA). Audit #455 flagged the passenger no-show parity was thin.
const passengerNoShowSmoke = path.join(root, 'scripts', 'smoke-passenger-noshow-terminal.mjs');
if (exists(passengerNoShowSmoke)) {
  try {
    execFileSync(process.execPath, [passengerNoShowSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-passenger-noshow-terminal.mjs failed\n${msg}`);
  }
}

// BD-RIDE-D-WAITING-01 — static regression smoke for the driver waiting redesign.
const waitingSmoke = path.join(root, 'scripts', 'smoke-active-ride-waiting.mjs');
if (exists(waitingSmoke)) {
  try {
    execFileSync(process.execPath, [waitingSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-active-ride-waiting.mjs failed\n${msg}`);
  }
}

// BD-RIDE-D-NOSHOW-01 — static regression smoke for the driver no-show sub-flow.
const noShowSmoke = path.join(root, 'scripts', 'smoke-active-ride-noshow.mjs');
if (exists(noShowSmoke)) {
  try {
    execFileSync(process.execPath, [noShowSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-active-ride-noshow.mjs failed\n${msg}`);
  }
}

// BD-NOTIF-01 — static regression smoke for the /inbox push-permission prompt.
const notifPromptSmoke = path.join(root, 'scripts', 'smoke-notif-prompt.mjs');
if (exists(notifPromptSmoke)) {
  try {
    execFileSync(process.execPath, [notifPromptSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-notif-prompt.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-01 — static regression smoke for the driver-map role guard.
const driverMapGuardSmoke = path.join(root, 'scripts', 'smoke-driver-map-guard.mjs');
if (exists(driverMapGuardSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapGuardSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-guard.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-02 — static regression smoke for the driver-map readiness gate.
const driverMapReadinessSmoke = path.join(root, 'scripts', 'smoke-driver-map-readiness.mjs');
if (exists(driverMapReadinessSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapReadinessSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-readiness.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-DOCS-01 — behavioural smoke for the driver document readiness
// contract (registration docs vs shift docs). Guards against onboarding's
// 3 required docs being reported as documentsReady:false again.
const driverDocsReadinessSmoke = path.join(root, 'scripts', 'smoke-driver-docs-readiness.mjs');
if (exists(driverDocsReadinessSmoke)) {
  try {
    execFileSync(process.execPath, [driverDocsReadinessSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-docs-readiness.mjs failed\n${msg}`);
  }
}

// BD-RIDE-P-12 — static regression smoke for the passenger active ride contract.
const passengerActiveRideSmoke = path.join(root, 'scripts', 'smoke-passenger-active-ride.mjs');
if (exists(passengerActiveRideSmoke)) {
  try {
    execFileSync(process.execPath, [passengerActiveRideSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-passenger-active-ride.mjs failed\n${msg}`);
  }
}

// BD-RIDE-D-SHEETS-01 — static regression smoke for the driver active ride
// cancel + problem bottom sheets (own module, in-sheet state machines,
// safety visual state, placeholder problem sheet never persists ride state).
const driverSheetsSmoke = path.join(root, 'scripts', 'smoke-active-ride-driver-sheets.mjs');
if (exists(driverSheetsSmoke)) {
  try {
    execFileSync(process.execPath, [driverSheetsSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-active-ride-driver-sheets.mjs failed\n${msg}`);
  }
}

// BD-RIDE-D-09 — static regression smoke for the driver earnings /
// completion polish sheet (seven ?state= stages, cash confirm gate,
// optimistic close timer, data-free isolation, inline-card replacement).
const driverEarningsSmoke = path.join(root, 'scripts', 'smoke-active-ride-driver-earnings.mjs');
if (exists(driverEarningsSmoke)) {
  try {
    execFileSync(process.execPath, [driverEarningsSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-active-ride-driver-earnings.mjs failed\n${msg}`);
  }
}

// BD-ACTIVE-RIDE-TERM-01 — actor-aware cancel + terminal-regression
// guard for the post-handoff active-ride lifecycle. Locks the
// cancelActiveRide helper contract, the terminal-status frozen set
// inside updateActiveRideStatus, and the driver / passenger terminal
// render branches (cancel.by differentiation, no active CTAs in
// terminal stubs, no Order Detail helper leakage into ride_state).
const activeRideCancelTerminalSmoke = path.join(root, 'scripts', 'smoke-active-ride-cancel-terminal.mjs');
if (exists(activeRideCancelTerminalSmoke)) {
  try {
    execFileSync(process.execPath, [activeRideCancelTerminalSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-active-ride-cancel-terminal.mjs failed\n${msg}`);
  }
}

// BD-RIDE-HISTORY-TERM-01 — downstream propagation contract for the
// ride history + driver receipt surfaces. Pins ride_history.js
// builder fallbacks (no demo identity leak), mock_api receipt
// sanitizer, trip_receipt.js read-only / no-recompute contract, and
// the caller-site COMPLETED gates inside active_ride.js /
// active_ride_passenger.js so canceled / no-show paths never write a
// history entry or a settled receipt.
const rideHistoryTerminalSmoke = path.join(root, 'scripts', 'smoke-ride-history-terminal.mjs');
if (exists(rideHistoryTerminalSmoke)) {
  try {
    execFileSync(process.execPath, [rideHistoryTerminalSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-ride-history-terminal.mjs failed\n${msg}`);
  }
}

// BD-ROUTE-TEMPLATE-TERM-01 — route-template bridge contract for the
// «Повторить маршрут» and «В избранные» actions. Pins repeat_route.js
// + favorite_routes.js as route-template-only bridges: terminal
// actor / identity / payment / receipt / earnings / chat / vehicle
// metadata never crosses from a completed-or-canceled history entry
// into a fresh composer draft. Locks builder whitelist shape, storage
// round-trip sanitizers (peek + consume both re-sanitize), favorite
// notice payload (`{source, label}` only), and source-level isolation
// (no mock_api / ride_state / active_ride / driver_offer_store imports;
// canonical storage-key allow-list per module).
const routeTemplateTerminalSmoke = path.join(root, 'scripts', 'smoke-route-template-terminal.mjs');
if (exists(routeTemplateTerminalSmoke)) {
  try {
    execFileSync(process.execPath, [routeTemplateTerminalSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-route-template-terminal.mjs failed\n${msg}`);
  }
}

// BD-COMPOSER-PREFILL-TERM-01 — consumer audit for the route-template
// bridge. BD-ROUTE-TEMPLATE-TERM-01 locked the writers; this smoke
// locks the consumer: `composer.js` reads the sanitized repeat-route
// draft via `consumeRepeatRouteDraft()`, applies it through the
// whitelist mapping in `applyRepeatRoute()`, preserves user work on
// collision, and publishes a clean `createRideOrder()` payload that
// carries no stale identity / payment / receipt / cancel-actor /
// chat / vehicle metadata from the prior ride. Pins the composer's
// source isolation (no ride_state / active_ride* / driver_offer_store
// / trip_receipt / favorite_routes imports), the publish-path field
// whitelist, and the favorite-notice UI-only flow.
const composerPrefillTerminalSmoke = path.join(root, 'scripts', 'smoke-composer-prefill-terminal.mjs');
if (exists(composerPrefillTerminalSmoke)) {
  try {
    execFileSync(process.execPath, [composerPrefillTerminalSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-composer-prefill-terminal.mjs failed\n${msg}`);
  }
}

// BD-PROFILE-D-03 (P2) — pane deep-link alias safety: a prototype key such as
// ?pane=constructor must not resolve to an inherited value or make the profile
// render throw; valid aliases keep activating the right pane.
const profilePaneAliasSmoke = path.join(root, 'scripts', 'smoke-profile-pane-alias.mjs');
if (exists(profilePaneAliasSmoke)) {
  try {
    execFileSync(process.execPath, [profilePaneAliasSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-profile-pane-alias.mjs failed\n${msg}`);
  }
}

// BD-ROLE-05 — per-tab profile role isolation: setSmokeRole() must flip the
// rendered view without mutating persisted user.role, so passenger and driver
// tabs of the same onboarded user stay independent.
const profileRoleIsolationSmoke = path.join(root, 'scripts', 'smoke-profile-role-isolation.mjs');
if (exists(profileRoleIsolationSmoke)) {
  try {
    execFileSync(process.execPath, [profileRoleIsolationSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-profile-role-isolation.mjs failed\n${msg}`);
  }
}

// BD-PROFILE-D-05A — Driver Garage section: derives a single-vehicle card
// from the legacy fields on the user record; driver-only; ?garage=empty is
// a render-gate preview that forces the empty state without wiping data.
const profileDriverGarageSmoke = path.join(root, 'scripts', 'smoke-profile-driver-garage.mjs');
if (exists(profileDriverGarageSmoke)) {
  try {
    execFileSync(process.execPath, [profileDriverGarageSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-profile-driver-garage.mjs failed\n${msg}`);
  }
}

// BD-PROFILE-D-05E — Driver snapshot reads from active garage vehicle.
// Both /respond (getUserVehicle) and the accept-handoff
// (buildAcceptedDriverSnapshot) consume the shared resolver from
// garage.js; neither writes storage or triggers a lifecycle transition.
const driverSnapshotActiveGarageSmoke = path.join(root, 'scripts', 'smoke-driver-snapshot-active-garage.mjs');
if (exists(driverSnapshotActiveGarageSmoke)) {
  try {
    execFileSync(process.execPath, [driverSnapshotActiveGarageSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-snapshot-active-garage.mjs failed\n${msg}`);
  }
}

// BD-RIDE-ORDER-02 — passenger/driver order lifecycle smoke: order creation,
// driver response, accept, handoff invariants, role-aware history filter.
// Locks down the "same user, different jacket" bug class: order.passenger
// must never collapse with response.driverSnapshot under acceptOrder, and
// history must stay role-split under the BD-RIDE-ORDER-01 smoke filter.
const rideOrder02Smoke = path.join(root, 'scripts', 'smoke-ride-order-02-passenger-driver-lifecycle.mjs');
if (exists(rideOrder02Smoke)) {
  try {
    execFileSync(process.execPath, [rideOrder02Smoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-ride-order-02-passenger-driver-lifecycle.mjs failed\n${msg}`);
  }
}

// BD-RIDE-HISTORY-D-01 — no-drift guard for the driver completed-ride receipt
// (issue #381): net computed once, persisted as one canonical receipt object,
// and read (never recomputed) by ride history, Driver payouts and /receipt.
const driverReceiptNoDriftSmoke = path.join(root, 'scripts', 'smoke-driver-receipt-no-drift.mjs');
if (exists(driverReceiptNoDriftSmoke)) {
  try {
    execFileSync(process.execPath, [driverReceiptNoDriftSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-receipt-no-drift.mjs failed\n${msg}`);
  }
}

// BD-CONFIRM-01 — confirm/chat → active-ride handoff guard. Behavioural
// round-trip over the /trip-confirmation handoff store (CONFIRMED record →
// loadCanonicalActiveRide → seeded active ride) plus a static contract pin
// on the dispatcher's role gate, the handoff module's exported surface,
// and the BD-LIFE-07 demo-fallback cleanup.
const confirmHandoffSmoke = path.join(root, 'scripts', 'smoke-confirm-handoff-active-ride.mjs');
if (exists(confirmHandoffSmoke)) {
  try {
    execFileSync(process.execPath, [confirmHandoffSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-confirm-handoff-active-ride.mjs failed\n${msg}`);
  }
}

// BD-DRIVER-MAP-X-15 — static regression smoke for the DriverMap accept order
// handoff (CREATED → Принять → one active trip → driver active ride → passenger
// accepted-driver handoff, with no empty search after acceptance).
const driverMapAcceptHandoffSmoke = path.join(root, 'scripts', 'smoke-driver-map-accept-handoff.mjs');
if (exists(driverMapAcceptHandoffSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapAcceptHandoffSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-accept-handoff.mjs failed\n${msg}`);
  }
}

// BD-RIDE-ORDER-UNIFY-GUARD-01 — static regression guard for the unified ride
// order model (#238): canonical store ownership, feed projection, Composer
// passenger_request, CREATED-only nearby list, shared canonical accept path,
// accepted/terminal drop-out, active-ride status sync mapping, and the legacy
// seed-post demo contour staying separate.
const rideOrderUnifySmoke = path.join(root, 'scripts', 'smoke-ride-order-unify.mjs');
if (exists(rideOrderUnifySmoke)) {
  try {
    execFileSync(process.execPath, [rideOrderUnifySmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-ride-order-unify.mjs failed\n${msg}`);
  }
}

// BD-RESPOND-ORDER-LINK-GUARD-01 — static guard for the /respond → canonical
// ride order write-side bridge (#367): /respond additively pins
// orderId + canonical:'ride_order' on the stored passenger_response for
// canonical ride-order posts only (legacy/seed posts unchanged), preserves
// tripId/requestId, keeps persisting via saveResponseToMap into
// bazardrive.responses.v1, never mutates the canonical ride-order store, and
// keeps the respond → chat link free of orderId.
const respondOrderLinkSmoke = path.join(root, 'scripts', 'smoke-respond-order-link.mjs');
if (exists(respondOrderLinkSmoke)) {
  try {
    execFileSync(process.execPath, [respondOrderLinkSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-respond-order-link.mjs failed\n${msg}`);
  }
}

// BD-RESPOND-ORDER-LINK-READSIDE-GUARD-01 — static guard for the /responses
// read-side canonical response integration (#369): /responses surfaces real
// passenger_response records from bazardrive.responses.v1 keyed by the
// canonical orderId, maps them into the existing responses__driver card shape
// with a real responseId, preserves the MOCK_DRIVERS fallback, stays read-only
// (no responses.v1 write, no canonical ride-order mutation), and leaves the
// accept → active-ride handoff intact.
const respondOrderLinkReadsideSmoke = path.join(root, 'scripts', 'smoke-respond-order-link-readside.mjs');
if (exists(respondOrderLinkReadsideSmoke)) {
  try {
    execFileSync(process.execPath, [respondOrderLinkReadsideSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-respond-order-link-readside.mjs failed\n${msg}`);
  }
}

// BD-ORDER-P-02A — /responses empty/order-context hardening: renderEmptyState
// accepts request + branches on isFallback; requestFromOrder null path provides
// context-aware fallback copy; order context fields rendered from request.
const responsesEmptyContextSmoke = path.join(root, 'scripts', 'smoke-responses-empty-context.mjs');
if (exists(responsesEmptyContextSmoke)) {
  try {
    execFileSync(process.execPath, [responsesEmptyContextSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-responses-empty-context.mjs failed\n${msg}`);
  }
}

// BD-INBOX-03 — static regression smoke for the inbox screen contract.
const inboxSmoke = path.join(root, 'scripts', 'smoke-inbox.mjs');
if (exists(inboxSmoke)) {
  try {
    execFileSync(process.execPath, [inboxSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-inbox.mjs failed\n${msg}`);
  }
}

// BD-CHAT-HANDOFF-01 — static regression smoke for the chat → trip-confirmation
// → active-ride → driver-handoff chain.
const chatHandoffSmoke = path.join(root, 'scripts', 'smoke-chat-handoff.mjs');
if (exists(chatHandoffSmoke)) {
  try {
    execFileSync(process.execPath, [chatHandoffSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-chat-handoff.mjs failed\n${msg}`);
  }
}

// BD-ORDER-DETAIL-01A — Order Detail contract gate. Cloud Design (#454) and
// the Codex screen audit (#455) flagged a P0 gap: no runtime route for an
// Order Detail screen. Implementation is deferred; this smoke guards the
// contract in docs/screen-contracts.md (route, role split, required states,
// out-of-scope list, unresolved driver "Принять" decision) so a future
// implementation cannot drift, and so no runtime route / screen file ships
// before the contract is re-graded.
const orderDetailContractSmoke = path.join(root, 'scripts', 'smoke-order-detail-contract.mjs');
if (exists(orderDetailContractSmoke)) {
  try {
    execFileSync(process.execPath, [orderDetailContractSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-order-detail-contract.mjs failed\n${msg}`);
  }
}

// BD-ORDER-DETAIL-01D-2B-F — audit smoke for the passenger active-ride
// seed consumption path. Pins the data-side invariant: a 01D-2B seed
// built from a unique order survives the saveActiveRide ->
// findActiveRide / loadCanonicalActiveRide round-trip intact, the
// passenger renderer reads from the exact seed keys, and every banned
// demo fallback string in active_ride_passenger.js is either absent
// (BD-LIFE-07 cleanup) or a positional `||` fallback that the seed
// short-circuits.
const orderDetailSeedConsumptionSmoke = path.join(root, 'scripts', 'smoke-order-detail-active-ride-passenger-seed.mjs');
if (exists(orderDetailSeedConsumptionSmoke)) {
  try {
    execFileSync(process.execPath, [orderDetailSeedConsumptionSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-order-detail-active-ride-passenger-seed.mjs failed\n${msg}`);
  }
}

// BD-ORDER-DETAIL-01D-3 — selected-driver / active-ride consistency
// audit. Spans the passenger select-driver commit (01D-2A), the
// open-trip seed (01D-2B), and the active-ride terminal contract
// (BD-ACTIVE-RIDE-TERM-01) in one place. Pins: only sent DriverOffers
// are selectable; the chosen offer's snapshot (driverName / car /
// rating / etaMin / price) lands verbatim in the active-ride seed (no
// demo fallback identity); peer sent offers flip to rejected and stop
// being selectable; terminal offers (withdrawn / expired / rejected)
// stay verbatim and cannot pose as the selected driver through any
// stale-snapshot path; terminal orders hide every select-driver CTA;
// cancel does NOT recreate or revive the active-ride record;
// driver_offer_store.js never imports active_ride / receipt / history.
const orderDetailConsistencySmoke = path.join(root, 'scripts', 'smoke-order-detail-active-ride-consistency.mjs');
if (exists(orderDetailConsistencySmoke)) {
  try {
    execFileSync(process.execPath, [orderDetailConsistencySmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-order-detail-active-ride-consistency.mjs failed\n${msg}`);
  }
}

// BD-LIFECYCLE-01 — headless lifecycle smoke. Exercises mock_api.js +
// ride_state.js + ride_actions.js + trip_confirmation_handoff.js against an
// in-memory localStorage shim and walks COMPLETED / NO_SHOW / CANCELED
// transitions, role-canonical convergence, and the "no demo passenger leak"
// guarantee on accepted orders.
const lifecycleSmoke = path.join(root, 'scripts', 'smoke-lifecycle.mjs');
if (exists(lifecycleSmoke)) {
  try {
    execFileSync(process.execPath, [lifecycleSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-lifecycle.mjs failed\n${msg}`);
  }
}

// BD-CHAT-BRIDGE-01 — chat → trip-confirmation handoff bridge smoke. Pins
// the message-thread → confirmation row link so a refactor of chat.js or
// trip_confirmation.js can't silently drop the responseId / tripId mapping
// the confirmation seed depends on.
const chatBridgeSmoke = path.join(root, 'scripts', 'smoke-chat-bridge.mjs');
if (exists(chatBridgeSmoke)) {
  try {
    execFileSync(process.execPath, [chatBridgeSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-chat-bridge.mjs failed\n${msg}`);
  }
}

// BD-MAP-FOUND-03 / BD-MAP-FOUND-04 — static regression smoke for the Mapbox
// foundation stubs (driver_markers + trip_status_layer): export contract,
// no real Mapbox SDK / network / CDN / dynamic import, RIDE_STATUS coverage,
// SW precache + VERSION bump, and valid design-registry JSON.
const mapboxFoundationStubsSmoke = path.join(root, 'scripts', 'smoke-mapbox-foundation-stubs.mjs');
if (exists(mapboxFoundationStubsSmoke)) {
  try {
    execFileSync(process.execPath, [mapboxFoundationStubsSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-mapbox-foundation-stubs.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01A — static regression smoke for the Global Error / Offline
// runtime overlay: singleton app-shell mount, five-state whitelist + safe
// unknown-state no-op, window.BD.GlobalError API, recovered auto-dismiss
// pinned by source wording, non-mutating contract (no ride/order/storage/
// backend imports or vocabulary), app.js wiring with no /error route,
// .bd-error-* CSS namespace, and SW precache (without the prototype gate).
const globalErrorOverlaySmoke = path.join(root, 'scripts', 'smoke-global-error-overlay.mjs');
if (exists(globalErrorOverlaySmoke)) {
  try {
    execFileSync(process.execPath, [globalErrorOverlaySmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-global-error-overlay.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01B — static regression smoke for the app-shell connection trigger
// wiring: online/offline listeners forward offline / retrying / recovered to
// window.BD.GlobalError, initial offline state is reflected, init is
// idempotent (no duplicate listeners), the reconnection timer is always
// cleared, and the module stays decoupled (no fetch / storage / ride-order
// mutation, no /error route), with app.js init ordered after the overlay and
// the module precached.
const appConnectionStatusSmoke = path.join(root, 'scripts', 'smoke-app-connection-status.mjs');
if (exists(appConnectionStatusSmoke)) {
  try {
    execFileSync(process.execPath, [appConnectionStatusSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-app-connection-status.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-A — static regression smoke for the fetch-failure trigger
// adapter contract: reportAppShellError(kind, options) maps a flow's error kind
// to window.BD.GlobalError, validates the unknown-kind no-op BEFORE the offline
// override, coerces any valid kind to 'offline' while the device is offline,
// resolves the overlay lazily (no direct overlay import), and stays decoupled
// (no fetch / storage / ride-order mutation, no app.js wiring, no /error
// route), with the module precached.
const appErrorTriggersSmoke = path.join(root, 'scripts', 'smoke-app-error-triggers.mjs');
if (exists(appErrorTriggersSmoke)) {
  try {
    execFileSync(process.execPath, [appErrorTriggersSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-app-error-triggers.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-B — static regression smoke for the first real flow trigger:
// feed.js wraps its listFeedPosts() data load in a try/catch that routes a
// failure through reportAppShellError('server_error') while preserving the
// feed's own empty state via the [] fallback (additive global overlay, not a
// replacement), both load sites go through the wrapper, and no /error route is
// introduced.
const feedErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-feed-error-trigger.mjs');
if (exists(feedErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [feedErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-feed-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-ERROR-02A — unified data-load adapter smoke. Guards the loadResource
// contract in public/src/data_layer.js (the single guarded-retry wrapper that
// replaces the per-screen 01C copies): awaits fn() in a try, retrying on retry,
// onlyIfState dismiss on success, server_error + guarded onRetry on failure, and
// the fallback return. Per-screen smokes now only assert delegation.
const dataLayerSmoke = path.join(root, 'scripts', 'smoke-data-layer.mjs');
if (exists(dataLayerSmoke)) {
  try {
    execFileSync(process.execPath, [dataLayerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-data-layer.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-C — inbox flow trigger smoke. Guards that an inbox data-load
// failure is routed through the global app-shell overlay (reportAppShellError)
// with a working guarded retry, the inbox empty state is preserved (additive,
// not replacement), both load sites go through the wrapper, and no /error route
// is introduced.
const inboxErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-inbox-error-trigger.mjs');
if (exists(inboxErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [inboxErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-inbox-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-D — post-detail flow trigger smoke. Guards that a post-detail
// data-load failure is routed through the global app-shell overlay
// (reportAppShellError) with a working guarded retry, the screen's own missing
// state is preserved (additive, not replacement), the load+render closure runs
// both load sites through the wrapper, and no /error route is introduced.
const postDetailErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-post-detail-error-trigger.mjs');
if (exists(postDetailErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [postDetailErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-post-detail-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-E — respond flow trigger. Asserts respond.js routes its
// post-lookup load failure through the global overlay adapter, the screen's own
// missing state is preserved (additive, not replacement), the load+render
// closure runs both load sites through the wrapper, and no /error route is
// introduced.
const respondErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-respond-error-trigger.mjs');
if (exists(respondErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [respondErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-respond-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-F — driver-map flow trigger. Asserts driver_map.js routes its
// nearby-orders load through the global overlay adapter (awaited so the wrapper
// holds when the read becomes a real backend call), all three reads go through
// loadNearbyOrders, the screen's own empty state is preserved (additive, not
// replacement), the load+render closure runs through the wrapper, and no /error
// route is introduced.
const driverMapErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-driver-map-error-trigger.mjs');
if (exists(driverMapErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [driverMapErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-driver-map-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-H — trip-receipt flow trigger. Asserts trip_receipt.js routes its
// primary getReceipt read through the shared data_layer.loadResource adapter
// (fallback null), the resolve is async + re-invokable for retry, and the
// screen's own missing state is preserved (additive, not replacement).
const tripReceiptErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-trip-receipt-error-trigger.mjs');
if (exists(tripReceiptErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [tripReceiptErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-trip-receipt-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-ERROR-01C-G — profile driver-receipts flow trigger. Asserts the payouts
// pane's listDriverReceipts() load reports server_error through the global
// overlay adapter on failure (sync-minimal variant), the retry dismisses our own
// server_error (guarded) and re-renders the pane, the screen's own empty/balance
// cards are preserved, and no /error route is introduced.
const profileReceiptsErrorTriggerSmoke = path.join(root, 'scripts', 'smoke-profile-receipts-error-trigger.mjs');
if (exists(profileReceiptsErrorTriggerSmoke)) {
  try {
    execFileSync(process.execPath, [profileReceiptsErrorTriggerSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-profile-receipts-error-trigger.mjs failed\n${msg}`);
  }
}

// BD-HISTORY-P-01 — passenger profile history menu row. Asserts #pfp-menu-history
// opens the inline trip-history section (scrollIntoView #profile-history-section)
// instead of navigating to /feed.
const profileHistoryMenuSmoke = path.join(root, 'scripts', 'smoke-profile-history-menu.mjs');
if (exists(profileHistoryMenuSmoke)) {
  try {
    execFileSync(process.execPath, [profileHistoryMenuSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-profile-history-menu.mjs failed\n${msg}`);
  }
}

// BD-NOTIF-01 — passenger profile notification bell entry point. Asserts
// #pfp-notif-btn opens the existing /inbox hub (reuse, not a split route).
const profileNotifBellSmoke = path.join(root, 'scripts', 'smoke-profile-notif-bell.mjs');
if (exists(profileNotifBellSmoke)) {
  try {
    execFileSync(process.execPath, [profileNotifBellSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-profile-notif-bell.mjs failed\n${msg}`);
  }
}

// BD-RESPONSES-01 — /responses decline + sort. Asserts the segmented sort
// chips, the in-memory per-driver declined Set (session-only, no localStorage),
// single-driver restore + restore-all, and the all-declined notice.
const responsesDeclineSortSmoke = path.join(root, 'scripts', 'smoke-responses-decline-sort.mjs');
if (exists(responsesDeclineSortSmoke)) {
  try {
    execFileSync(process.execPath, [responsesDeclineSortSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-responses-decline-sort.mjs failed\n${msg}`);
  }
}

// BD-RESPONSES-SAFETY-01 — pre-ride safety sheet on /responses. Asserts the
// shield opens the 4-view sheet, the exact strings, the report-submit stub, and
// the BD-RIDE-P-07 non-reuse boundary (no SOS / share-trip / driver coupling).
const responsesSafetySheetSmoke = path.join(root, 'scripts', 'smoke-responses-safety-sheet.mjs');
if (exists(responsesSafetySheetSmoke)) {
  try {
    execFileSync(process.execPath, [responsesSafetySheetSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-responses-safety-sheet.mjs failed\n${msg}`);
  }
}

// BD-MOD-01 — Order Detail moderation report sheet. Asserts report-order opens
// the 2-view sheet, the report-submit stub, and the standalone boundary (no
// in-ride safety reuse, no /report reroute, tabbar blocked while open).
const orderDetailReportSheetSmoke = path.join(root, 'scripts', 'smoke-order-detail-report-sheet.mjs');
if (exists(orderDetailReportSheetSmoke)) {
  try {
    execFileSync(process.execPath, [orderDetailReportSheetSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-order-detail-report-sheet.mjs failed\n${msg}`);
  }
}

// BD-ORDER-DETAIL-CHAT-GUARD-01 — driver «Написать» state-aware guard notices.
// Asserts message-passenger shows a D1/D2/D3 notice instead of the generic
// stub, and never navigates to /chat or invents a chat thread.
const orderDetailChatGuardSmoke = path.join(root, 'scripts', 'smoke-order-detail-chat-guard.mjs');
if (exists(orderDetailChatGuardSmoke)) {
  try {
    execFileSync(process.execPath, [orderDetailChatGuardSmoke], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stdout ? e.stdout.toString() : e.message).slice(-400);
    errors.push(`smoke-order-detail-chat-guard.mjs failed\n${msg}`);
  }
}

// Dispatcher routine — self-test the orchestrator so the routine itself
// stays in a working state under CI (no project mutation in --selftest mode).
const dispatcherSelftest = path.join(root, 'scripts', 'dispatcher.mjs');
if (exists(dispatcherSelftest)) {
  try {
    execFileSync(process.execPath, [dispatcherSelftest, '--selftest'], { stdio: 'pipe' });
  } catch (e) {
    const msg = ((e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : e.message)).slice(-400);
    errors.push(`dispatcher.mjs --selftest failed\n${msg}`);
  }
}

// BD-TEST-01 — node:test behavioural coverage. Runs every tests/*.test.mjs
// through Node's built-in test runner, complementing the static smoke pins
// above with real behavioural assertions (e.g. the ride-state terminal freeze).
// Pure Node, no browser/DOM/network; modules under test mock localStorage.
const testsDir = path.join(root, 'tests');
if (exists(testsDir)) {
  const testFiles = fs.readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => path.join(testsDir, f));
  if (testFiles.length) {
    try {
      execFileSync(process.execPath, ['--test', ...testFiles], { stdio: 'pipe' });
    } catch (e) {
      const msg = ((e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : e.message)).slice(-600);
      errors.push(`node:test (tests/) failed\n${msg}`);
    }
  }
}

if (errors.length) {
  console.error('CHECK FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('All checks passed.');