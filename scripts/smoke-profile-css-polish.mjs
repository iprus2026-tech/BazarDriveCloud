// BD-PROFILE-01 — static regression pins for the driver-profile CSS polish:
//   F8  — `--text-1` token defined in :root (was an undefined var across ~10 rules).
//   F2  — `.pf2-garage-ready` readiness-hint card has CSS backing (was unstyled).
//   F9  — driver Garage action buttons carry a 44px comfortable tap target.
//   F10 — the infinite online-dot pulse is gated behind prefers-reduced-motion.
// Plus the SW VERSION bump (cloud.css is precached). Static only: reads source
// and asserts the contract holds — no DOM, no computed style, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const css = read('../public/styles/cloud.css');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Extract a single rule body by its exact selector head.
function ruleBody(src, selectorHead) {
  const i = src.indexOf(selectorHead);
  if (i === -1) return '';
  const open = src.indexOf('{', i);
  const close = src.indexOf('}', open);
  return (open === -1 || close === -1) ? '' : src.slice(open, close + 1);
}

// F8 — the missing token is now defined in :root with a real value.
expect('F8: --text-1 is defined in cloud.css with a hex value', /--text-1\s*:\s*#[0-9a-fA-F]{3,6}\s*;/.test(css));

// F2 — the readiness-hint card and its helper text have CSS backing.
expect('F2: .pf2-garage-ready has card chrome (border-radius)',
  /\.pf2-garage-ready\s*\{[^}]*border-radius/.test(css));
expect('F2: .pf2-garage-ready__helper is styled', /\.pf2-garage-ready__helper\s*\{/.test(css));

// F9 — comfortable tap target on the live garage action buttons.
expect('F9: .pf2-garage__action has min-height: 44px',
  /min-height:\s*44px/.test(ruleBody(css, '.pf2-garage__action {')));
expect('F9: .pf2-garage__archived-restore has min-height: 44px',
  /min-height:\s*44px/.test(ruleBody(css, '.pf2-garage__archived-restore {')));
expect('F9: the confirm row buttons have min-height: 44px',
  /min-height:\s*44px/.test(ruleBody(css, '.pf2-garage__confirm-cancel,')));

// F10 — the infinite online-dot pulse is gated behind reduced-motion
// (mirrors the feed/receipt shimmer gates pinned in smoke-feed-loading.mjs).
expect('F10: the online dot pulse is disabled under prefers-reduced-motion',
  /prefers-reduced-motion:\s*reduce[\s\S]{0,200}pf2-ip-scard-dot[\s\S]{0,80}animation:\s*none/.test(css));

// SW — a precached file (cloud.css) changed, so VERSION must be bumped.
expect('sw.js VERSION bumped to v169+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 169);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
