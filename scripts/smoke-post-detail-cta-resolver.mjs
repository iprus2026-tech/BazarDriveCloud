// BD-POST-01 — static regression smoke for the post-detail primary-action resolver.
//
// post_detail.js owns the primary-action decision for /post?id=... : pickCtaSpec
// maps a post (type + ownership) to one of { none | own | accept | respond |
// chat }, and runCtaAction routes each kind. The BD-AUDIT-CODEX-01 audit (#455)
// flagged that this resolver — which decides respond vs chat vs accept vs own vs
// no-CTA — had no behavioural pin (only an error-trigger smoke). A future
// refactor could silently reorder the own/accept/respond gate, send the wrong
// kind to the wrong route, drop the announcement/system no-primary branch, or
// strip the canonical accept handoff — none of which the generic checks catch.
//
// STATIC: reads source and asserts the contract holds. No browser, no DOM, no
// network, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const screen = read('../public/src/screens/post_detail.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Isolate each function body (up to its column-0 closing brace) so assertions do
// not accidentally match unrelated code elsewhere in the module.
const slice = (name) => (screen.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
const pickBody = slice('pickCtaSpec');
const runBody = slice('runCtaAction');
const footerBody = slice('renderFooter');

expect('pickCtaSpec resolver present', pickBody.length > 0);
expect('runCtaAction router present', runBody.length > 0);
expect('renderFooter present', footerBody.length > 0);

// ── A. pickCtaSpec → kinds ──
expect("announcement / system → kind 'none'",
  /post\.type === 'announcement' \|\| post\.type === 'system'/.test(pickBody)
  && /\{ kind: 'none' \}/.test(pickBody));
expect("driver trip post → kind 'chat'",
  /post\.type === 'trip'[\s\S]*?\{ kind: 'chat'/.test(pickBody));
expect("marketplace → kind 'respond'",
  /post\.type === 'marketplace'[\s\S]*?\{ kind: 'respond'/.test(pickBody));
expect('passenger trip exposes own / accept / respond kinds',
  /kind: 'own'/.test(pickBody) && /kind: 'accept'/.test(pickBody) && /kind: 'respond'/.test(pickBody));

// ── B. Passenger-trip gate ORDER: own (manage) → accept → respond fallback ──
expect('own gate (canManageOwnOrder) is checked before the accept gate (canAcceptOrder)',
  /canManageOwnOrder\(/.test(pickBody) && /canAcceptOrder\(/.test(pickBody)
  && pickBody.indexOf('canManageOwnOrder') < pickBody.indexOf('canAcceptOrder'));
const iOwn = pickBody.indexOf("kind: 'own'");
const iAccept = pickBody.indexOf("kind: 'accept'");
const iRespondFallback = pickBody.lastIndexOf("kind: 'respond'");
expect('own → accept → respond decision order preserved',
  iOwn > -1 && iAccept > iOwn && iRespondFallback > iAccept);

// ── C. runCtaAction → route per kind ──
expect("kind 'own' + canonical ride_order → /responses?orderId=",
  /spec\.kind === 'own'/.test(runBody)
  && /post\.canonical === 'ride_order' && post\.orderId/.test(runBody)
  && /go\(`\/responses\?orderId=\$\{encodeURIComponent\(post\.orderId\)\}`\)/.test(runBody));
expect("kind 'chat' → /chat?tripId=",
  /spec\.kind === 'chat'/.test(runBody)
  && /go\(postId \? `\/chat\?tripId=\$\{encodeURIComponent\(postId\)\}` : '\/chat'\)/.test(runBody));
expect("kind 'accept' canonical → acceptCanonicalRideOrder + /active-ride?role=driver…&status=ACCEPTED",
  /acceptCanonicalRideOrder\(post\.orderId/.test(runBody)
  && /\/active-ride\?role=driver&tripId=\$\{encodeURIComponent\(accepted\.tripId\)\}&status=ACCEPTED/.test(runBody));
expect("kind 'accept' non-canonical → acceptPassengerRequestFromPost + /active-ride?role=driver (no status=ACCEPTED)",
  /acceptPassengerRequestFromPost\(post\)/.test(runBody)
  && /\/active-ride\?role=driver&tripId=\$\{encodeURIComponent\(ride\.tripId\)\}`/.test(runBody));
expect('default (respond) → /respond?postId=',
  /go\(postId \? `\/respond\?postId=\$\{encodeURIComponent\(postId\)\}` : '\/respond'\)/.test(runBody));
expect('respond never routes a post straight to /order (feed→post→respond contract)',
  !/go\([^)]*\/order[^I]/.test(runBody));

// ── D. onboarding gate precedes any CTA routing ──
expect('runCtaAction gates on onboarding (setPendingAction → /onboarding) before routing',
  /if \(!fresh\.onboarded\)/.test(runBody)
  && /setPendingAction\(/.test(runBody)
  && /go\('\/onboarding'\)/.test(runBody));

// ── E. no-primary footer (announcement/system) = single Назад, no respond CTA ──
expect("kind 'none' footer is the single Назад (#pd-cancel), no #pd-respond",
  /spec\.kind === 'none'/.test(footerBody)
  && /post-detail__footer--single/.test(footerBody)
  && /id="pd-cancel"/.test(footerBody));
expect('non-none footer renders the #pd-respond primary CTA',
  /id="pd-respond"/.test(footerBody));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
