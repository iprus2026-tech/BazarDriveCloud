// BD-RIDE-P-06/07 — static regression smoke for the passenger NO_SHOW terminal.
//
// The BD-AUDIT-CODEX-01 audit (#455) noted driver no-show is pinned but the
// passenger terminal NO_SHOW path was thin. Passenger NO_SHOW must:
//   • be reachable from the audit URL ?status=NO_SHOW,
//   • dispatch to the terminal renderPassengerCanceledFallback(ride, 'no_show')
//     BEFORE the active/supported-status layouts (a terminal ride never renders
//     the live ride or any non-terminal action),
//   • render the neutral "Поездка закрыта" copy + a NO_SHOW badge derived from
//     the canonical ride-state label (resolveRideStatusLabel) with a truthful
//     "driver didn't wait" line (not pretend the user cancelled), and
//   • expose NO primary "create new trip" action — only a single return-home CTA
//     to /feed.
// A refactor could regress any of these and the generic checks would not catch
// it. STATIC: reads source and asserts the contract. No browser, no DOM, no net.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const screen = read('../public/src/screens/active_ride_passenger.js');
const dispatcher = read('../public/src/screens/active_ride.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

const fallback = (screen.match(/function renderPassengerCanceledFallback\([\s\S]*?\n\}/) || [''])[0];
expect('renderPassengerCanceledFallback present', fallback.length > 0);

// ── A. Reachability + dispatch ──
expect('active_ride.js dispatcher forwards the URL ?status= into the passenger render as statusQuery',
  /import activeRidePassenger from '\.\/active_ride_passenger\.js'/.test(dispatcher)
  && /return activeRidePassenger\(\{[\s\S]{0,200}statusQuery: query\.get\('status'\)/.test(dispatcher));
expect('passenger status resolver honors statusQuery === NO_SHOW (audit-URL reachable)',
  /statusQuery === RIDE_STATUS\.CANCELED \|\| statusQuery === RIDE_STATUS\.NO_SHOW/.test(screen));
expect("NO_SHOW is RETURNED to the terminal fallback (variant 'no_show')",
  /ride\.status === RIDE_STATUS\.NO_SHOW[\s\S]{0,80}return renderPassengerCanceledFallback\(ride, 'no_show'\)/.test(screen));

// ── B. Terminal short-circuit: NO_SHOW returns BEFORE supported-status/active layout ──
const iNoShowReturn = screen.indexOf("renderPassengerCanceledFallback(ride, 'no_show')");
const iSupported = screen.indexOf('PASSENGER_SUPPORTED_STATUSES.has(ride.status)');
expect('NO_SHOW terminal return precedes the supported-status/active render',
  iNoShowReturn > -1 && iSupported > iNoShowReturn);

// ── C. no_show copy: neutral title + literal badge + truthful description ──
expect("no_show variant flag derived from variant === 'no_show'",
  /isNoShow = variant === 'no_show'/.test(fallback));
expect('no_show badge uses the canonical NO_SHOW label (not the raw enum)',
  /badgeText = isNoShow \? resolveRideStatusLabel\(RIDE_STATUS\.NO_SHOW\)/.test(fallback));
expect("no_show title (const title) is the neutral «Поездка закрыта»",
  /const title = isNoShow \? 'Поездка закрыта'/.test(fallback));
expect('no_show description is truthful (driver did not wait), not a self-cancel',
  fallback.includes('Водитель отметил, что не дождался вас.'));

// ── D. Terminal action policy: no «create new trip» primary; single return-home CTA ──
// no_show gets an empty primaryHtml; the create-new button markup exists ONLY in
// the CANCELED (else) branch of that ternary, and the actions block injects it via
// ${primaryHtml}. Tie all three together so an unconditional button added to the
// markup (count > 1) or a removed ${primaryHtml} injection would fail.
const newBtnMarkupCount = (fallback.match(/id="arp-canceled-new"/g) || []).length;
expect('no_show primaryHtml is empty (no «Создать новую поездку» for no_show)',
  /const primaryHtml = isNoShow\s*\?\s*''/.test(fallback));
expect('the create-new button lives only in the primaryHtml CANCELED branch (single markup occurrence)',
  newBtnMarkupCount === 1
  && /const primaryHtml = isNoShow\s*\?\s*''\s*:\s*`<button[\s\S]{0,120}id="arp-canceled-new"/.test(fallback));
expect('the actions block injects the gated ${primaryHtml} (no hard-coded primary button)',
  /passenger-cancel-fallback__actions[\s\S]{0,40}\$\{primaryHtml\}/.test(fallback));
expect('the only fallback CTAs route home to /feed (goHome)',
  /const goHome = \(\) => \{ go\('\/feed'\); \};/.test(fallback)
  && /#arp-canceled-top-back'\)\.addEventListener\('click', goHome\)/.test(fallback)
  && /#arp-canceled-feed'\)\.addEventListener\('click', goHome\)/.test(fallback));
expect('fallback binds no non-terminal active-ride action (no #arp-start / cancel / pay)',
  !/id="arp-start"/.test(fallback)
  && !/id="arp-cancel"/.test(fallback)
  && !/data-action="pay"/.test(fallback));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
