// BD-RESPONSES-01 — static regression smoke for the /responses
// decline + sort slice.
//
// The responses board gained two in-screen interactions, both session-only
// (no backend, no localStorage):
//   • inline segmented sort chips (Лучшие / Быстрее / Дешевле / Рейтинг) that
//     reorder the board in place via a derived sort — never mutating the
//     `drivers` array built by buildDriversForOrder (the read-side board pin).
//   • per-driver decline / restore backed by an in-memory Set, plus an
//     all-declined notice with «Вернуть все».
//
// This pins those invariants: a refactor that re-points sort/decline at a stub
// toast, persists the declined Set to localStorage, makes restore reload the
// whole list, or drops the all-declined notice would still pass
// `node scripts/check.mjs` without this guard.
//
// Intentionally STATIC: reads source and asserts the contract. No DOM, no net.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const responses = read('../public/src/screens/responses.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}
const slice = (re) => { const m = responses.match(re); return m ? m[0] : ''; };

// ── A. read-side board source of truth is preserved ─────────
expect('responses() still builds the local/mock board via buildDriversForOrder(request, …)',
  /let\s+drivers[\s\S]{0,180}buildDriversForOrder\(\s*request\b/.test(responses));

// ── B. derived sort covers all four modes, never mutating drivers ───
const sortBody = slice(/function sortDrivers\(drivers, mode\)[\s\S]*?\n}/);
expect('sortDrivers(drivers, mode) is defined', sortBody.length > 0);
expect('sortDrivers handles eta / price / rating + best default',
  /'eta'/.test(sortBody) && /'price'/.test(sortBody) && /'rating'/.test(sortBody) && /isBest/.test(sortBody));
expect('sortDrivers returns a copy (does not sort drivers in place)',
  /drivers\.map\(/.test(sortBody) && !/\bdrivers\.sort\(/.test(responses));
expect('rating parse is comma-decimal safe',
  /replace\(\s*','\s*,\s*'\.'\s*\)/.test(responses));

// ── C. inline segmented chips (not a single button / toast) ─
expect('SORT_MODES defines best/eta/price/rating with the four labels',
  /key:\s*'best'[\s\S]*'Лучшие'/.test(responses)
  && /key:\s*'eta'[\s\S]*'Быстрее'/.test(responses)
  && /key:\s*'price'[\s\S]*'Дешевле'/.test(responses)
  && /key:\s*'rating'[\s\S]*'Рейтинг'/.test(responses));
expect('renderList renders chips with data-sort and an active state',
  /class="responses__chip\$\{active \? ' is-active' : ''\}"/.test(responses)
  && /data-sort="\$\{m\.key\}"/.test(responses));
expect('the old single sort button (#responses-sort) is gone',
  !/id="responses-sort"/.test(responses));
expect('active chip uses the #FF6B35 accent token in CSS',
  /\.responses__chip\.is-active\s*\{[^}]*var\(--accent\)/.test(css));

// ── D. per-driver decline backed by an in-memory Set ────────
expect('an in-memory declined Set is the state', /const\s+declined\s*=\s*new Set\(\)/.test(responses));
expect('cards render per-driver declined from the Set',
  /renderDriverCard\(d,\s*selectedDriverId,\s*declined\.has\(d\.id\)\)/.test(responses));

const declineBlock = slice(/if \(action === 'decline'\) \{[\s\S]*?\}/);
expect('decline adds to the Set and re-renders (no stub toast)',
  /declined\.add\(driverId\)/.test(declineBlock) && !/toast\(/.test(declineBlock) && !/go\(/.test(declineBlock));

const restoreBlock = slice(/if \(action === 'restore'\) \{[\s\S]*?\}/);
expect('restore removes ONLY that driver from the Set (no list reload)',
  /declined\.delete\(driverId\)/.test(restoreBlock) && !/go\(/.test(restoreBlock));

// ── E. all-declined notice + restore-all ────────────────────
expect('all-declined notice gates on declined.size === drivers.length',
  /declined\.size\s*===\s*drivers\.length/.test(responses));
expect('notice carries the spec strings + «Вернуть все» action',
  /Все отклики отклонены/.test(responses)
  && /Можно вернуть водителя или дождаться новых предложений\./.test(responses)
  && /data-action="restore-all">Вернуть все/.test(responses));
expect('restore-all clears the whole Set', /declined\.clear\(\)/.test(responses));

// ── F. session-only: declined state is never persisted ──────
expect('declined Set is not written to localStorage',
  !/setItem\([^)]*declined/.test(responses) && !/declined[\s\S]{0,60}setItem/.test(responses));
expect('?state=all-declined seeds the Set once on first render',
  /if \(isAllDeclined && !declinedSeeded\)[\s\S]{0,120}drivers\.forEach\(\(driver\) => declined\.add\(driver\.id\)\)/.test(responses));

// ── G. out-of-scope guard — call stays a stub ───────────────
expect('call action remains a toast stub (out of scope)',
  /if \(action === 'call'\)[\s\S]{0,80}toast\('Звонок/.test(responses));

// ── H. delegated listener covers ALL card states (offer regression) ──
// The click delegation must bind to the cross-state scroll container, NOT to
// #responses-board (which only exists in list state) — otherwise the offer
// card's select/chat/call buttons go dead (Codex P1).
expect('the click delegation binds to the cross-state .responses__scroll',
  /const\s+scrollEl\s*=\s*root\.querySelector\('\.responses__scroll'\)/.test(responses)
  && /scrollEl\.addEventListener\(\s*'click'/.test(responses));
expect('the click delegation is NOT bound to #responses-board (offer state has none)',
  !/querySelector\('#responses-board'\)[\s\S]{0,40}addEventListener\(\s*'click'/.test(responses));

// ── I. «Дешевле» sorts by numeric price (real offers are all priceTone:same) ──
expect('price sort uses a numeric price value, not priceTone alone',
  /function priceValue\(driver\)/.test(responses)
  && /mode === 'price'[\s\S]{0,120}priceValue\(a\.driver\)\s*-\s*priceValue\(b\.driver\)/.test(responses));

// ── I2. «Быстрее» ranks real pickup timings (real offers share etaBars) ─────
expect('eta sort falls back to a pickup-timing rank for real offers',
  /const PICKUP_TIMING_RANK = \{ earlier: 0, at_time: 1, negotiate: 2 \}/.test(responses)
  && /function etaRank\(driver\)/.test(responses)
  && /mode === 'eta'[\s\S]{0,160}etaRank\(a\.driver\)\s*-\s*etaRank\(b\.driver\)/.test(responses));
expect('real response cards carry an etaRank derived from pickupTiming',
  /etaRank:\s*Number\.isInteger\(PICKUP_TIMING_RANK\[response\.pickupTiming\]\)/.test(responses));

// ── J. declining the selected driver clears the selection ───
expect('selectedDriverId is reassignable (let)', /\blet\s+selectedDriverId\b/.test(responses));
expect('declining the selected driver clears selectedDriverId',
  /if \(driverId === selectedDriverId\) selectedDriverId = null/.test(responses));

// ── K. header reconciles after sort/decline/restore ─────────
expect('refreshBoard reconciles the header via syncHeader()',
  /function syncHeader\(\{ reconcileBoard = false \} = \{\}\)/.test(responses)
  && /function refreshBoard\(\)[\s\S]{0,180}syncHeader\(\{ reconcileBoard: true \}\)/.test(responses));
expect('syncHeader updates subtitle + status chip + dataset.state',
  /root\.dataset\.state\s*=\s*effectiveState/.test(responses)
  && /\.responses__sub/.test(responses)
  && /renderStatusChip\(liveStatus, \{ announce: readState !== 'loading' \}\)/.test(responses));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
