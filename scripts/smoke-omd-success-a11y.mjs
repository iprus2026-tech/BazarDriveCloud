// BD-MAP-05 — Order Map Draft publish-success a11y guard (#732).
//
// Publishing an order re-renders the success card ("Заказ опубликован") in place. Without focus
// management the swap was SILENT to screen-reader / keyboard users — focus was stranded where the
// now-removed «Опубликовать заказ» button had been. The fix moves focus to the success heading on
// the publish-success path (a major content change → focus management, the WAI-recommended pattern,
// rather than a quiet aria-live region).
//
// Static source pin — no DOM, no network.

import fs from 'node:fs';

const omd = fs.readFileSync(new URL('../public/src/screens/order_map_draft.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

expect('the success heading is focusable (tabindex="-1")',
  /<h2 class="omd-success__title" tabindex="-1">Заказ опубликован<\/h2>/.test(omd));
expect('publishOrder moves focus to the success heading after the success re-render',
  /rerender\(root,\s*\{[^}]*order\s*\}\)[\s\S]{0,400}querySelector\('\.omd-success__title'\)[\s\S]{0,140}\.focus\(\)/.test(omd));
expect('the focus move is on the publish-success path (after lastOrder = order)',
  /lastOrder = order[\s\S]{0,700}\.omd-success__title'\)[\s\S]{0,140}\.focus\(\)/.test(omd));

// Precached order_map_draft.js changed → VERSION bumped.
expect('sw.js VERSION bumped to v226+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 226);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
