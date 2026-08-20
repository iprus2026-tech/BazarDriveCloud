// BD-RIDE-D-NOSHOW-01 / BD-RIDE-D-NOSHOW-ACK-01 (V2-04C2) — static regression smoke for
// the driver no-show sub-flow.
//
// The flow (active_ride_driver_noshow.js) is a 7-state in-layout sheet sequence
// (action → confirm → submitting → result → compensation → done, with failure as an
// alternate branch off submitting) opened from the WAITING_PASSENGER «Не приехал»
// (#ar-no-show) action. A refactor could drop a state, leak ride-state persistence into
// the flow module (the ONLY persist is the screen's onConfirmNoShow callback, gated by
// commitDriverNoShow in active_ride.js), re-route #ar-no-show, regress the ACK-first
// contract (rendering success before the backend confirms), or reopen the double-submit
// window an async confirm handler creates. STATIC source assertions only — no browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const flow = read('../public/src/screens/active_ride_driver_noshow.js');
const screen = read('../public/src/screens/active_ride.js');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. Module surface + 7 states ──
expect('module exports openDriverNoShowFlow', /export\s+function\s+openDriverNoShowFlow\s*\(/.test(flow));
for (const fn of ['renderAction', 'renderConfirm', 'submitNoShow', 'renderSubmitting',
  'renderResult', 'renderFailure', 'renderCompensation', 'renderDone']) {
  expect(`flow has the '${fn}' state`, new RegExp(`function\\s+${fn}\\s*\\(`).test(flow));
}

// ── B. Copy (one per state) ──
for (const copy of [
  'Пассажир не вышел?',
  'Подтвердить, что пассажир не вышел?',
  'Да, пассажир не вышел',
  'Отмечаем «не вышел»…',
  'Отмечено: пассажир не вышел',
  'Не получилось отметить «не вышел»',
  'Компенсация за ожидание',
  'Вы снова на линии',
]) {
  expect(`flow carries copy «${copy}»`, flow.includes(copy));
}
// Codex P2 (PR #545) — the «платное ожидание» line is the live amount passed in,
// not a hardcoded figure, so it matches the paid-wait sheet.
expect('compensation paid-wait is computed from opts.paidWaitAmount (not hardcoded 180)',
  /opts\.paidWaitAmount/.test(flow) && !/paidWait:\s*'180/.test(flow));
expect('net is derived (paidWait + pickup − commission)',
  /paidWaitNum\s*\+\s*PICKUP_COMP\s*-\s*COMMISSION/.test(flow));
expect('paid wait is frozen at the confirm step (counts dwell time) [Codex P2]',
  /comp\s*=\s*buildComp\(resolvePaidWait\(\)\)/.test(flow) && /typeof p === 'function'/.test(flow));

// ── C. Persistence isolation — the ONLY mutation is the onConfirmNoShow hook ──
expect('flow module never imports ride_state', !/from\s+'[^']*ride_state/.test(flow));
expect('flow module never persists ride state directly',
  !/persistDriver/.test(flow) && !/updateActiveRideStatus/.test(flow) && !/saveActiveRide/.test(flow));

// ── C2. BD-RIDE-D-NOSHOW-ACK-01 (V2-04C2) — ACK-first confirm contract ──
// onConfirmNoShow may be backend-ACK-first (a Promise); submitNoShow must AWAIT it and
// gate result/failure on the outcome — never fire-and-forget advance to result.
expect('submitNoShow is async and awaits onConfirmNoShow',
  /async function submitNoShow/.test(flow) && /await confirmNoShow\(\)/.test(flow));
expect('renderResult only follows a successful await (not fired alongside/before it)',
  /await confirmNoShow\(\);[\s\S]{0,80}renderResult\(\)/.test(flow)
  && !/confirmNoShow\(\);\s*renderResult\(\)/.test(flow));
expect('a rejected onConfirmNoShow renders failure, not result',
  /catch\s*\(err\)\s*\{[\s\S]{0,80}renderFailure\(err\)/.test(flow));
expect('double-submit guard: submitNoShow no-ops while already submitting',
  /if\s*\(submitting\)\s*return;/.test(flow) && /submitting\s*=\s*true;/.test(flow));
const submittingBody = (flow.match(/function renderSubmitting\(\)[\s\S]{0,400}/) || [''])[0];
expect('renderSubmitting view has no confirm/retry control (closes the double-submit window)',
  Boolean(submittingBody) && !/id="ns-confirm"/.test(submittingBody) && !/id="ns-retry"/.test(submittingBody));
expect('failure retry re-invokes the same submitNoShow (single call site, no parallel path)',
  /#ns-retry['"]\)\.addEventListener\('click',\s*submitNoShow\)/.test(flow));

// ── C3. BD-RIDE-D-NOSHOW-ACK-01 P1 — stale-settlement guard via isFlowOwner ──
// Ownership is a caller-owned (active_ride.js noShowFlowOpen) read-only snapshot, checked
// AFTER the awaited confirmNoShow() settles, so a stale attempt superseded by a retry or by
// reconciliation discovering an authoritative terminal ride can never render over whoever
// currently owns the sheet. No extra PATCH either way — confirmNoShow() has already run.
expect('isFlowOwner is extracted with a safe always-owner (true) fallback',
  /const isFlowOwner = typeof opts\.isFlowOwner === 'function' \? opts\.isFlowOwner : \(\) => true;/.test(flow));
expect('a stale resolve cannot render success: isFlowOwner() is checked AFTER await, BEFORE renderResult',
  /await confirmNoShow\(\);\s*submitting = false;\s*if\s*\(!isFlowOwner\(\)\)\s*return;\s*renderResult\(\);/.test(flow));
expect('a stale reject cannot render failure: isFlowOwner() is checked AFTER the catch, BEFORE renderFailure',
  /catch\s*\(err\)\s*\{\s*submitting = false;\s*if\s*\(!isFlowOwner\(\)\)\s*return;\s*renderFailure\(err\);/.test(flow));

// ── D. UI-only boundary ──
expect('flow imports only escapeHtml (no data/backend layer)',
  /import\s+\{\s*escapeHtml\s*\}\s+from\s+'\.\.\/util\.js'/.test(flow)
  && !/mock_api/.test(flow) && !/data_layer/.test(flow));
expect('flow performs no fetch / localStorage / native API',
  !/\bfetch\s*\(/.test(flow) && !/localStorage/.test(flow) && !/Notification\b/.test(flow));

// ── E. Screen wiring — #ar-no-show opens the flow + persists NO_SHOW ──
expect('active_ride.js imports openDriverNoShowFlow',
  /import\s+\{\s*openDriverNoShowFlow\s*\}\s+from\s+'\.\/active_ride_driver_noshow\.js'/.test(screen));
expect('#ar-no-show opens the no-show flow (no longer the cancel-sheet preset)',
  /ar-no-show'\)[\s\S]{0,320}openDriverNoShowFlow\s*\(\s*sheet/.test(screen));
expect('#ar-no-show wires onConfirmNoShow through commitDriverNoShow (not an inline persist)',
  /ar-no-show'\)[\s\S]{0,400}onConfirmNoShow:\s*\(\)\s*=>\s*commitDriverNoShow\(\)/.test(screen));
expect('#ar-no-show no longer opens the cancel sheet with the passenger_no_show preset',
  !/ar-no-show'\)[\s\S]{0,320}openDriverCancelSheet\s*\(/.test(screen));
expect('BOTH #ar-no-show entry points pass isFlowOwner: () => noShowFlowOpen (active_ride.js stays the owner)',
  (screen.match(/isFlowOwner:\s*\(\)\s*=>\s*noShowFlowOpen,/g) || []).length === 2);

// ── E2. commitDriverNoShow — ACK-first backend/client contract (BD-RIDE-D-NOSHOW-ACK-01) ──
const commitNoShowBody = (screen.match(/function commitDriverNoShow\(\)[\s\S]{0,1700}/) || [''])[0];
expect('commitDriverNoShow is defined', Boolean(commitNoShowBody));
expect('exactly one patchRideStatus(..., NO_SHOW) call exists (single PATCH per confirmation)',
  (screen.match(/patchRideStatus\(ride\.tripId,\s*RIDE_STATUS\.NO_SHOW\)/g) || []).length === 1);
expect('backendRide=false keeps the existing local-only persistDriverCancel(NO_SHOW, passenger_no_show)',
  /if\s*\(!backendRide\)\s*\{[\s\S]{0,80}persistDriverCancel\(RIDE_STATUS\.NO_SHOW,\s*'passenger_no_show'\)/.test(commitNoShowBody));

// ── E2a. P1 — a resolved PATCH Promise alone is not ACK. Reject a malformed/mismatched
// server response BEFORE any local write; only a confirmed serverRide.status === NO_SHOW
// may proceed to mergeServerRide/saveActiveRide.
expect('resolved PATCH is validated: missing serverRide OR serverRide.status !== NO_SHOW is rejected',
  /if\s*\(\s*!serverRide\s*\|\|\s*serverRide\.status\s*!==\s*RIDE_STATUS\.NO_SHOW\s*\)\s*\{[\s\S]{0,60}throw new Error\('NO_SHOW_ACK_INVALID'\)/.test(commitNoShowBody));
{
  const guardIdx = commitNoShowBody.indexOf('NO_SHOW_ACK_INVALID');
  const saveIdx = commitNoShowBody.indexOf('saveActiveRide(ride)');
  const mergeIdx = commitNoShowBody.indexOf('mergeServerRide(serverRide)');
  expect('the ACK-validity guard is textually BEFORE saveActiveRide (checked before any local write)',
    guardIdx > -1 && saveIdx > -1 && guardIdx < saveIdx);
  expect('the ACK-validity guard is textually BEFORE mergeServerRide (checked before any local write)',
    guardIdx > -1 && mergeIdx > -1 && guardIdx < mergeIdx);
}
expect('an invalid ACK is thrown as a real Error (routes through the existing .catch(), not swallowed)',
  /throw new Error\('NO_SHOW_ACK_INVALID'\)/.test(commitNoShowBody));

expect('backendRide=true success path rebuilds `ride` from the AUTHORITATIVE server response',
  /ride\s*=\s*mergeServerRide\(serverRide\)/.test(commitNoShowBody));
expect('backendRide=true success path saves the authoritative snapshot via saveActiveRide()',
  /ride\s*=\s*saveActiveRide\(ride\)/.test(commitNoShowBody));
expect('backendRide=true success path syncs canonical order status after the authoritative save',
  /syncCanonicalOrderStatus\(ride,\s*RIDE_STATUS\.NO_SHOW\)/.test(commitNoShowBody));
expect('success path never calls persistDriverCancel (would fire a second PATCH)',
  !/\.then\([\s\S]{0,500}persistDriverCancel/.test(commitNoShowBody));
expect('success path never calls updateActiveRideStatus (server owns timestamps.canceledAt)',
  !/\.then\([\s\S]{0,500}updateActiveRideStatus/.test(commitNoShowBody));
expect('commitDriverNoShow returns a Promise the caller can await (sync and async branches)',
  /return\s+Promise\.resolve\(\)/.test(commitNoShowBody) && /return\s+patchRideStatus/.test(commitNoShowBody));

// ── E3. Reconciliation must still run on failure, and must not clobber the sub-flow's own view ──
expect('failure still triggers reconciliation (refetchRideAndRender is not skipped)',
  /\.catch\(\(err\)\s*=>\s*\{[\s\S]{0,300}refetchRideAndRender\(\)/.test(commitNoShowBody));
expect('noShowFlowOpen guard exists and is set true when the sub-flow opens',
  /let noShowFlowOpen = false;/.test(screen) && /noShowFlowOpen = true;/.test(screen));
expect('onBack clears noShowFlowOpen before re-rendering the parent sheet',
  /onBack:\s*\(\)\s*=>\s*\{\s*noShowFlowOpen = false;\s*renderSheet\(\);\s*\}/.test(screen));

// ── E4. BD-RIDE-D-NOSHOW-ACK-01 P1 — a TERMINAL status must take sheet ownership back from
// an open no-show sub-flow (the earlier PATCH may have actually succeeded despite a
// client-side failure, or the ride was terminalized elsewhere); a non-terminal update still
// defers to the open sub-flow. This must hold in BOTH places that merge a fresh server ride
// and can render: refetchRideAndRender() (the post-failure reconciliation) AND the regular
// pollRideOnce() interval, which keeps running independently — it is only skipped while
// pendingStatus is set mid-PATCH, not once a failed ACK clears it — so without the same guard
// there it could clobber an open submitting/failure view with a stale unconditional render.
const refetchBody = (screen.match(/async function refetchRideAndRender\(\)[\s\S]{0,1600}/) || [''])[0];
expect('refetchRideAndRender is defined', Boolean(refetchBody));
expect('refetchRideAndRender: terminal status clears noShowFlowOpen and always renders',
  /if\s*\(isTerminalRideStatus\(ride\.status\)\)\s*\{\s*noShowFlowOpen = false;\s*renderSheet\(true\);\s*\}/.test(refetchBody));
expect('refetchRideAndRender: non-terminal still defers to an open sub-flow',
  /else if\s*\(!noShowFlowOpen\)\s*\{\s*renderSheet\(true\);\s*\}/.test(refetchBody));

const pollOnceBody = (screen.match(/async function pollRideOnce\(\)[\s\S]{0,1700}/) || [''])[0];
expect('pollRideOnce is defined', Boolean(pollOnceBody));
expect('pollRideOnce: terminal status clears noShowFlowOpen and always renders',
  /if\s*\(isTerminalRideStatus\(ride\.status\)\)\s*\{\s*noShowFlowOpen = false;\s*renderSheet\(true\);\s*\}/.test(pollOnceBody));
expect('pollRideOnce: non-terminal still defers to an open sub-flow (regular poll no longer clobbers it unconditionally)',
  /else if\s*\(!noShowFlowOpen\)\s*\{\s*renderSheet\(true\);\s*\}/.test(pollOnceBody));

// ── F. Service worker precache ──
expect('sw.js precaches active_ride_driver_noshow.js',
  /\.\/src\/screens\/active_ride_driver_noshow\.js/.test(sw));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
