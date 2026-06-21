// BD-PROFILE-01 — inert-control feedback parity (F1/F6/F7/F11). Four UI-only
// driver-profile stubs that previously did nothing on tap now flash a transient
// label ("Скоро здесь" / upload-deferred copy), mirroring their live sibling
// stubs. Each stays inert — no navigation, no state mutation, no storage write.
// Static source pins; no DOM, no events.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const src = read('../public/src/screens/profile.js');
const sw = read('../public/sw.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// F6 — «Продлить разрешение» reached by a handler.
expect('F6: a handler reaches .pf2-ip-permit-btn',
  /closest\(\s*['"]\.pf2-ip-permit-btn['"]\s*\)/.test(src));

// F7 — «Подключить парк» chevron row reached by a handler.
expect('F7: a handler reaches #pf2-ip-park-fleet',
  /closest\(\s*['"]#pf2-ip-park-fleet['"]\s*\)/.test(src));

// F1 — «Добавить документ» reached, and its flash restores innerHTML (keeps icon).
expect('F1: a handler reaches #pf2-doc-add',
  /closest\(\s*['"]#pf2-doc-add['"]\s*\)/.test(src));
expect('F1: the doc-add flash restores innerHTML (preserves the + icon)',
  /#pf2-doc-add[\s\S]{0,400}innerHTML\s*=\s*orig/.test(src));

// F11 — saved method rows reached via a delegated handler on the methods block,
// excluding the add-card row (which keeps its own handler).
expect('F11: a delegated #pf2-po-methods-block handler reaches .pf2-po-method-row',
  /#pf2-po-methods-block['"]\s*\)\s*\?\.\s*addEventListener[\s\S]{0,400}closest\(\s*['"]\.pf2-po-method-row['"]\s*\)/.test(src));
expect('F11: the add-card row is excluded from the delegated handler',
  /pf2-po-methods-block[\s\S]{0,400}row\.id\s*===\s*['"]pf2-po-add-card-btn['"]/.test(src));

// All four are inert acknowledgments — the transient feedback copy is present.
expect('inert-feedback: «Скоро здесь» flash copy present (>=3 incl. the new stubs)',
  (src.match(/Скоро здесь/g) || []).length >= 3);
expect('inert-feedback: doc-add uses the upload-deferred copy',
  /Загрузка файлов появится в следующей версии/.test(src));

// Precached profile.js changed → VERSION bumped.
expect('sw.js VERSION bumped to v171+',
  Number((sw.match(/VERSION\s*=\s*'v(\d+)'/) || [])[1] || 0) >= 171);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
