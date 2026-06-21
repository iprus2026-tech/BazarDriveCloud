// BD-PROFILE-01 (F5) — complete the driver-profile ARIA tab pattern. Tabs gained
// id + aria-controls + roving tabindex; panes gained role=tabpanel +
// aria-labelledby + tabindex; a shared activateTab() drives both click and a new
// Arrow/Home/End roving keyboard nav. The deep-link / programmatic .click() path
// is preserved. Static source pins; no DOM, no events.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const src = read('../public/src/screens/profile.js');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Tab buttons carry id + aria-controls + roving tabindex (rendered from tabsHtml).
expect('F5: tab button carries id="pf2-tab-${t.id}"', src.includes('id="pf2-tab-${t.id}"'));
expect('F5: tab button carries aria-controls="pf2-pane-${t.id}"', src.includes('aria-controls="pf2-pane-${t.id}"'));
expect('F5: tab button has roving tabindex (active 0, others -1)',
  src.includes("tabindex=\"${selected ? '0' : '-1'}\""));

// The loading skeleton reuses the row decoratively (no #pf2-pane panels, no
// keyboard handler), so it must render INERT tabs — no dangling aria-controls,
// out of the tab order. The live ARIA is gated behind `interactive`.
expect('F5: tabsHtml accepts an { interactive } option', src.includes('{ interactive = true } = {}'));
expect('F5: the loading skeleton renders inert tabs (interactive: false)',
  src.includes("tabsHtml('overview', { interactive: false })"));
expect('F5: the inert branch omits aria-controls and stays out of tab order',
  src.includes(": ' tabindex=\"-1\"'"));

// Each pane is a labelled tabpanel.
for (const p of ['overview', 'ip', 'docs', 'payouts', 'security']) {
  expect(`F5: pane "${p}" is role=tabpanel + aria-labelledby="pf2-tab-${p}"`,
    new RegExp(`id="pf2-pane-${p}"[^>]*role="tabpanel"[^>]*aria-labelledby="pf2-tab-${p}"`).test(src));
}

// Shared activation + roving keyboard navigation.
expect('F5: a shared activateTab() helper exists', src.includes('function activateTab('));
expect('F5: click routes through activateTab', src.includes('() => activateTab(tab)'));
expect('F5: activateTab maintains the roving tabindex',
  src.includes("setAttribute('tabindex', on ? '0' : '-1')"));
expect('F5: keydown roving nav is bound on the tablist',
  src.includes("'.pf2-tabs-row')?.addEventListener('keydown'"));
expect('F5: nav handles Arrow/Home/End',
  src.includes("'ArrowRight'") && src.includes("'ArrowLeft'") && src.includes("'Home'") && src.includes("'End'"));
expect('F5: keyboard nav moves focus to the activated tab', src.includes('tabs[next].focus()'));

// Deep-link / programmatic click path preserved (unchanged routing).
expect('F5: deep-link .pf2-tab[data-pane="${resolvedPane}"] click path preserved',
  src.includes('.pf2-tab[data-pane="${resolvedPane}"]'));

// Precached profile.js changed → VERSION bumped.
expect('sw.js VERSION bumped to v172+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 172);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
