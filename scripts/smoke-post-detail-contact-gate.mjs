// BD-POST-01 — static regression smoke for the post-detail contact-block gate.
//
// renderContactBlock(p, onboarded) renders the author-contact atom on /post.
// PR #666 gated it so it renders ONLY for ride posts (type 'trip': driver offers
// and passenger requests). System / announcement / marketplace posts carry no
// real phone, so without the gate revealedPhone()'s mock «+7 (900) 000-00-00»
// fallback surfaced as a dialable, fabricated «Контакт автора» on administrative
// content. This smoke pins the gate so a refactor cannot silently drop it and
// re-leak a fake contact onto non-ride posts.
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

// Isolate renderContactBlock up to its column-0 closing brace so assertions do
// not accidentally match unrelated code elsewhere in the module.
const slice = (name) => (screen.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
const contactBody = slice('renderContactBlock');

expect('renderContactBlock present', contactBody.length > 0);

// ── A. The gate: non-ride posts get no contact atom ──
expect("renderContactBlock returns '' for non-'trip' posts (the type gate)",
  /if\s*\(\s*p\.type\s*!==\s*'trip'\s*\)\s*return\s*'';/.test(contactBody));

// ── B. The gate must run BEFORE the reveal, so a system / announcement /
//        marketplace post can never reach the dialable contact ──
const iGate = contactBody.search(/p\.type\s*!==\s*'trip'/);
const iOnboarded = contactBody.indexOf('if (onboarded)');
expect('type gate precedes the onboarded reveal branch',
  iGate > -1 && iOnboarded > -1 && iGate < iOnboarded);

// ── C. The revealed branch is a dialable tel: link — exactly what the gate
//        keeps off non-ride posts ──
const iTel = contactBody.indexOf('href="tel:');
expect('revealed contact renders a dialable tel: link', iTel > -1);
expect('type gate precedes the revealed tel: contact',
  iGate > -1 && iTel > -1 && iGate < iTel);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
