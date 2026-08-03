// BD-A11Y-FOCUS-SWAP-01 (OD-MEL-4 of #779) — focus-after-content-swap guard.
//
// An imperative FULL screen-root content swap — `root.replaceChildren(<new content>)`
// / `rootEl.replaceChildren(<new content>)` — removes the activated control from the
// DOM. Without focus management `document.activeElement` falls back to <body>, so
// keyboard / screen-reader users lose their place: an aria-live notice may announce
// the result, but the WAI-recommended pattern for a major content change is to MOVE
// FOCUS into the new content. This was the OD-MEL-4 defect on Order Detail
// (rerenderInPlace) and recurs as a class across the runtime.
//
// Two guards:
//   1. PRECISE — the OD-MEL-4 fix: order_detail.js rerenderInPlace moves focus to the
//      new primary `.od-action` (fallback `.od-back`) right AFTER replaceChildren — the
//      real `.focus()` effect, not just its presence (the smoke-omd-success-a11y idiom).
//   2. PER-INSTANCE COVERAGE — scans ALL of public/src and counts, per file, the
//      full-root content-swap SITES vs how each is accounted (the smoke-overlay-coverage
//      model): rootSwaps(file) <= proofs.matched + benign + gap. A new swap SITE — in a
//      brand-new file OR added to an already-listed one — that does not focus the new
//      content then fails here, so this form of the regression class cannot return
//      silently (#684 R7).
//
// SCOPE (honest bound — no silent cap). This guard covers the FULL-ROOT
// `root|rootEl.replaceChildren(<content>)` form ONLY. The SAME "focus not moved after an
// imperative content change" class also lives in forms this guard does NOT police, left
// as tracked #779 follow-ups:
//   - sub-container innerHTML re-renders (active_ride.js / active_ride_driver_noshow.js sheets)
//   - hidden-toggle success reveals (respond.js success panel)
//   - sub-container replaceChildren on a persistent container (driver_map.js stage/sheetSlot)
// `root.replaceChildren()` with NO argument (router.js clearing #app on navigation) is not
// a content swap — the matcher requires a non-empty argument, excluding app-shell teardown.
// The matcher keys on the `root`/`rootEl` receiver names (the uniform repo convention); a
// future full-root swap via a differently-named variable would escape — documented limit.
//
// Static source analysis only — no DOM, no network, no computed layout.

import fs from 'node:fs';

const SRC = new URL('../public/src/', import.meta.url);
const od = fs.readFileSync(new URL('screens/order_detail.js', SRC), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

// Full screen-root CONTENT swap: `root`/`rootEl.replaceChildren(` with a non-empty arg.
// The first non-whitespace char after `(` must NOT be `)` — so `replaceChildren()`
// (router.js clearing #app on navigation) is excluded by construction.
const ROOT_SWAP = /\b(?:root|rootEl)\.replaceChildren\(\s*[^\s)]/g;

// The OD-MEL-4 fix proof, reused as both the PRECISE pin and order_detail's ledger proof:
// after replaceChildren, focus the new `.od-action…` (any variant), fallback `.od-back`.
const ORDER_DETAIL_FOCUS =
  /rootEl\.replaceChildren\([\s\S]{0,600}querySelector\('\.od-action[^']*'\)[\s\S]{0,260}querySelector\('\.od-back'\)[\s\S]{0,160}\.focus\(\)/;

// Per-FILE ledger. Each file performing full-root content swaps declares how each swap
// SITE is accounted:
//   proofs  — precise focus-after-swap proofs (each matches once = one verified site, the
//             REAL effect, so an unrelated .focus() elsewhere gives no false credit),
//   benign  — swap sites that strand NO focus (initial mount / first paint — no prior
//             focus to lose),
//   gap     — tracked pre-existing #779 follow-up gaps (no focus move yet).
// Invariant per file: rootSwaps <= proofs.matched + benign + gap.
const LEDGER = {
  'screens/order_detail.js': { proofs: [ORDER_DETAIL_FOCUS], benign: 0, gap: 0 },
  'screens/order_map_draft.js': {
    // 926 publish-success path focuses .omd-success__title (also pinned precisely by
    // smoke-omd-success-a11y.mjs); 1072 is the initial mount (first paint) → benign.
    proofs: [/querySelector\('\.omd-success__title'\)[\s\S]{0,140}\.focus\(\)/],
    benign: 1,
    gap: 0,
  },
  'screens/route_picker.js': {
    // rerender() (interaction re-renders) now moves focus into the fresh content
    // after replaceChildren; the initial mount call is first paint → benign.
    proofs: [/replaceChildren\(buildBody\(\)\)[\s\S]{0,420}querySelector\('\.rp-ready__cta[^']*'\)[\s\S]{0,120}querySelector\('\.rp-topbar__back'\)[\s\S]{0,120}\.focus\(\)/],
    benign: 1,
    gap: 0,
  },
  'screens/route_preview.js': {
    // Only swap site is the initial mount (first paint) → benign, no fix needed.
    proofs: [],
    benign: 1,
    gap: 0,
  },
};

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};
const count = (src, re) => (src.match(re) || []).length;

// Recursively collect .js files under public/src, as paths relative to public/src.
function listJs(dirUrl, prefix = '') {
  const out = [];
  for (const ent of fs.readdirSync(dirUrl, { withFileTypes: true })) {
    if (ent.isDirectory()) out.push(...listJs(new URL(ent.name + '/', dirUrl), prefix + ent.name + '/'));
    else if (ent.name.endsWith('.js')) out.push({ rel: prefix + ent.name, url: new URL(ent.name, dirUrl) });
  }
  return out;
}

// ── 1. PRECISE — the OD-MEL-4 fix on Order Detail ───────────────────────────
// .od-back is the always-present fallback target (header renders on every state).
expect('order_detail: .od-back fallback target is always rendered in the header',
  /class="od-back"/.test(od));
expect('order_detail: rerenderInPlace moves focus into the new content right AFTER replaceChildren',
  ORDER_DETAIL_FOCUS.test(od),
  'querySelector(.od-action…) || .od-back → .focus() after the swap — the real effect, not just a .focus() somewhere');

// ── 2. PER-INSTANCE COVERAGE — every full-root content swap SITE is accounted ─
let swapFiles = 0;
const seenGaps = [];
for (const { rel, url } of listJs(SRC)) {
  const src = fs.readFileSync(url, 'utf8');
  const swaps = count(src, ROOT_SWAP);
  if (!swaps) continue;
  swapFiles++;
  const led = LEDGER[rel];
  const verified = led ? led.proofs.filter((re) => re.test(src)).length : 0;
  const benign = led ? led.benign : 0;
  const gap = led ? led.gap : 0;
  const covered = verified + benign + gap;
  expect(`${rel}: ${swaps} full-root content swap site${swaps > 1 ? 's' : ''} accounted (${covered} = ${verified} verified + ${benign} benign + ${gap} known-gap)`,
    swaps <= covered,
    'a NEW full-root content swap must focus the new content (add a proof), be a benign first-paint mount, or be tracked in gap with a TODO');
  if (gap) seenGaps.push(`${rel} (×${gap})`);
}

if (seenGaps.length) {
  console.log('NOTE — KNOWN_GAP root content swaps exempted, TODO #779 focus retrofit: ' + seenGaps.join(', '));
}

// The guard actually scanned the runtime and found the known swap surfaces (non-vacuity).
expect('the guard scanned the runtime and found full-root content swaps', swapFiles >= 4, `${swapFiles} files`);

// ── 3. Hygiene — no stale ledger entry ──────────────────────────────────────
// Every ledger file must still exist, still perform ≥1 root content swap, and every
// declared proof must still match — so an exemption / proof can't silently outlive what
// it covers.
for (const [rel, led] of Object.entries(LEDGER)) {
  const url = new URL(rel, SRC);
  const src = fs.existsSync(url) ? fs.readFileSync(url, 'utf8') : '';
  expect(`ledger hygiene: ${rel} still performs a full-root content swap`, count(src, ROOT_SWAP) > 0,
    'stale ledger entry — remove it when the swap is gone');
  led.proofs.forEach((re, i) =>
    expect(`ledger hygiene: ${rel} focus proof #${i + 1} still matches`, re.test(src),
      'stale proof regex — update the ledger to the current focus code'));
}

// Precached order_detail.js changed for the OD-MEL-4 fix → VERSION bumped.
expect('sw.js VERSION bumped to v247+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 247);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
