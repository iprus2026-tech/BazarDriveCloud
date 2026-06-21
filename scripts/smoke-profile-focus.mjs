// BD-PROFILE-01 (F3) — static pin for driver-dashboard focus-visible parity.
// The pf2 button controls (action rows, edit, permit, check-row, ip-go,
// ip-permit, doc-add) gained the branded accent focus ring that their
// profile-history / feed-card / inbox-item siblings already carry — they had
// fallen back to the UA default outline, not the themed ring. Static only.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const css = read('../public/styles/cloud.css');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// The grouped :focus-visible rule exists and carries the branded accent ring.
const ruleMatch = css.match(/\.pf2-action-row:focus-visible[\s\S]{0,400}?\{([\s\S]*?)\}/);
expect('F3: a :focus-visible rule anchored on .pf2-action-row exists', !!ruleMatch);
expect('F3: the focus ring is outline 2px solid var(--accent) + 2px offset',
  !!ruleMatch
  && /outline:\s*2px solid var\(--accent\)/.test(ruleMatch[1])
  && /outline-offset:\s*2px/.test(ruleMatch[1]));

// Parity coverage: the other driver-dashboard buttons share the same ring.
for (const sel of ['pf2-edit-btn', 'pf2-permit-btn', 'pf2-check-row--action', 'pf2-ip-go-btn', 'pf2-ip-permit-btn', 'pf2-doc-add-btn']) {
  expect(`F3: .${sel}:focus-visible is covered`, new RegExp('\\.' + sel + ':focus-visible').test(css));
}

// Precached cloud.css changed → VERSION must be bumped.
expect('sw.js VERSION bumped to v170+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 170);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
