// #762 — Rules screen (/rules, BD-RULES-01) honest-affordances smoke.
//
// The screen used to ship a topbar search ICON and per-document DOWNLOAD buttons wired
// as silent no-ops (they looked interactive but did nothing — read as broken). This pins
// the honest redesign: a REAL client-side search field that filters sections + documents
// with a no-results state, and documents that present an honest «Скоро» pill instead of a
// fake download. Source-text pins (the screen module is DOM-bound, like the other screen
// smokes) — they guard the invariant, not a snapshot.

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/src/screens/rules.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles/cloud.css', import.meta.url), 'utf8');

const issues = [];
function expect(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!cond) issues.push(label);
}

// The honesty invariant: no silent no-op controls remain (the defect this screen fixes).
expect('rules.js carries no silent no-op controls (no data-noop / data-doc / «Скачать»)',
  !/data-noop/.test(src) && !/data-doc/.test(src) && !/Скачать/.test(src));

// A real search INPUT, wired to a client-side re-render.
expect('rules.js renders a real search input wired to a client-side filter',
  /id="rules-search"[\s\S]*rules-v2-search__input/.test(src)
  && /addEventListener\(\s*'input'/.test(src)
  && /renderBody\(/.test(src));

// The filter actually narrows BOTH sections and documents.
expect('rules.js filters both sections and documents by query',
  /SECTIONS\.filter\(\(s\)\s*=>\s*matchSection/.test(src)
  && /DOCUMENT_TEMPLATES\.filter\(\(d\)\s*=>\s*matchDoc/.test(src));

// Documents present an honest «Скоро» pill, not a fake download button.
expect('rules.js documents present an honest «Скоро» pill (not a download button)',
  /rules-v2-doc__soon">\s*Скоро/.test(src));

// A no-results state with a clear control.
expect('rules.js shows a no-results state with a clear control',
  /Ничего не найдено/.test(src) && /data-rules-reset/.test(src));

// CSS: the search field + the soon pill are styled, and the clear button keeps a >=44px touch target.
expect('cloud.css styles the rules search field + the honest «Скоро» pill',
  /\.rules-v2-search__input\b/.test(css) && /\.rules-v2-doc__soon\b/.test(css));
expect('the search clear button keeps a >=44px touch target (::after hit area)',
  /\.rules-v2-search__clear::after\s*\{[\s\S]{0,200}44px/.test(css));

console.log(issues.length ? `\n${issues.length} FAILED` : '\nALL PASSED');
process.exit(issues.length ? 1 : 0);
