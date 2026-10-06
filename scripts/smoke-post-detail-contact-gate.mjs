// BD-POST-01 — static and behavioural smoke for the post-detail contact-block gate.
//
// renderContactBlock(p, onboarded) renders the author-contact atom on /post.
// PR #666 gated it so it renders ONLY for ride posts (type 'trip': driver offers
// and passenger requests). System / announcement / marketplace posts carry no
// real phone, so without the gate revealedPhone()'s mock «+7 (900) 000-00-00»
// fallback surfaced as a dialable, fabricated «Контакт автора» on administrative
// content. This smoke pins the gate so a refactor cannot silently drop it and
// re-leak a fake contact onto non-ride posts.
//
// BD-POST-BACKEND-CONTACT-TRUTH-01A: canonical orders without a supplied phone
// render no contact block. Non-canonical prototype fallback and supplied phones
// retain their presentation. Executes the source helpers without DOM or network.

import fs from 'node:fs';
import { FEED_POSTS_V2, rideOrderToFeedPost } from '../public/src/mock_api.js';
import { escapeHtml } from '../public/src/util.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const screen = read('../public/src/screens/post_detail.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Isolate renderContactBlock up to its column-0 closing brace so assertions do
// not accidentally match unrelated code elsewhere in the module.
const slice = (name, source = screen) => (source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0];
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

const renderContact = new Function('escapeHtml', 'SVG_PHONE', 'SVG_LOCK',
  `${slice('maskPhone')}\n${slice('revealedPhone')}\n${contactBody}\nreturn renderContactBlock;`,
)(escapeHtml, '', '');

for (const authority of ['backend', 'local']) {
  for (const [viewer, passenger] of [
    ['own', { isCurrentUser: true }],
    ['foreign', { isCurrentUser: false }],
    ['unknown', {}],
    ['missing snapshot', undefined],
  ]) {
    const post = rideOrderToFeedPost({ id: 'contact-order', status: 'CREATED', passenger }, { authority });
    const before = JSON.stringify(post);
    for (const onboarded of [false, true]) {
      expect(`${authority} canonical ${viewer}, onboarded=${onboarded}: no contact or disclosure promise`,
        renderContact(post, onboarded) === '');
    }
    expect(`${authority} canonical ${viewer}: contact rendering does not mutate the post`,
      JSON.stringify(post) === before);
  }
}

for (const authority of ['backend', 'local', undefined]) {
  for (const [label, phone] of [
    ['missing', undefined], ['null', null], ['empty', ''], ['whitespace', '   '],
    ['number', 79000000000], ['object', {}], ['boolean', true],
  ]) {
    const post = { type: 'trip', canonical: 'ride_order', orderAuthority: authority, phone };
    expect(`canonical ${authority || 'unspecified'} authority, ${label} phone: both contact states absent`,
      renderContact(post, false) === '' && renderContact(post, true) === '');
  }
}

for (const id of ['trip-1', 'trip-2']) {
  const post = FEED_POSTS_V2.find((p) => p.id === id);
  const locked = renderContact(post, false);
  const revealed = renderContact(post, true);
  expect(`non-canonical seed ${id}: prototype masked contact remains before onboarding`,
    locked.includes('+7 ••• ••• •• 00') && !locked.includes('href="tel:'));
  expect(`non-canonical seed ${id}: prototype dialable contact remains after onboarding`,
    revealed.includes('href="tel:+79000000000"') && revealed.includes('+7 (900) 000-00-00'));
}

const composer = read('../public/src/screens/composer.js');
const buildComposerPost = new Function(`${slice('buildFeedPost', composer)}\nreturn buildFeedPost;`)();
const composerPost = buildComposerPost({ type: 'trip', from: 'A', to: 'B', phone: '+7 (999) 123-45-67' });
const trimmedPhone = '+7 (999) 123-45-67';
for (const [label, post] of [
  ['Composer trip', composerPost],
  ['backend canonical with supplied phone', { type: 'trip', canonical: 'ride_order', orderAuthority: 'backend', phone: `  ${trimmedPhone}  ` }],
  ['local canonical with supplied phone', { type: 'trip', canonical: 'ride_order', orderAuthority: 'local', phone: trimmedPhone }],
]) {
  const locked = renderContact(post, false);
  const revealed = renderContact(post, true);
  expect(`${label}: supplied phone is masked before onboarding`,
    locked.includes('+7 ••• ••• •• 67') && !locked.includes('href="tel:') && !locked.includes(trimmedPhone));
  expect(`${label}: supplied phone is dialable after onboarding, without the mock fallback`,
    revealed.includes('href="tel:+79991234567"') && revealed.includes(trimmedPhone)
    && !revealed.includes('+7 (900) 000-00-00'));
}
const composerWithoutPhone = buildComposerPost({ type: 'trip', from: 'A', to: 'B', phone: '' });
expect('non-canonical Composer without phone retains the prototype fallback',
  renderContact(composerWithoutPhone, false).includes('+7 ••• ••• •• 00')
  && renderContact(composerWithoutPhone, true).includes('href="tel:+79000000000"'));

for (const type of ['system', 'announcement', 'marketplace']) {
  const post = { type, phone: trimmedPhone };
  expect(`${type}: a supplied phone does not bypass the non-trip gate`,
    renderContact(post, false) === '' && renderContact(post, true) === '');
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
