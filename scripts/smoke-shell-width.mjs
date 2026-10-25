// scripts/smoke-shell-width.mjs — BD-UX-ROLES-02 (#1139): one content width for every screen with
// the tab bar. Static invariants over public/styles/cloud.css and public/src/router.js:
//   - #shell is the 430px phone column; on wide windows only #shell.has-tabbar widens it, to 760px;
//   - no screen widens #shell on its own (the old feed 1120px / profile 760-1120px rules), except
//     the dev/docs ScreenOps tool, which is chrome-less and uses the full viewport;
//   - both profiles lay out in one column at every width;
//   - router.js sets .has-tabbar before the screen loads (so the width never follows the screen).
// No DOM, no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/styles/cloud.css', import.meta.url), 'utf8');
const router = readFileSync(new URL('../public/src/router.js', import.meta.url), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

let passed = 0;
function check(label, fn) {
  try { fn(); passed += 1; } catch (err) { console.error(`FAIL — ${label}\n${err.message}`); process.exit(1); }
}

// Every rule whose selector mentions #shell and whose block sets max-width.
const shellWidthRules = [...code.matchAll(/([^{}]*#shell[^{}]*)\{([^{}]*)\}/g)]
  .filter(([, , body]) => /(^|;|\s)max-width\s*:/.test(body))
  .map(([, selector, body]) => ({
    selector: selector.trim().replace(/\s+/g, ' '),
    maxWidth: /max-width\s*:\s*([^;]+)/.exec(body)[1].trim(),
  }));

check('#shell base is the 430px phone column', () => {
  const base = shellWidthRules.filter((r) => r.selector === '#shell');
  assert.deepEqual(base.map((r) => r.maxWidth), ['430px']);
});

check('only #shell.has-tabbar widens the shell, to 760px, from 431px', () => {
  const tabbar = shellWidthRules.filter((r) => r.selector === '#shell.has-tabbar');
  assert.deepEqual(tabbar.map((r) => r.maxWidth), ['760px']);
  assert.match(code, /@media \(min-width: 431px\) \{\s*#shell\.has-tabbar \{ max-width: 760px; \}\s*\}/);
});

check('no screen widens #shell on its own (only the chrome-less ScreenOps tool)', () => {
  const others = shellWidthRules.filter((r) => !['#shell', '#shell.has-tabbar'].includes(r.selector));
  assert.deepEqual(others, [{ selector: '#shell:has(.screen--ops-screens)', maxWidth: 'none' }]);
  assert.doesNotMatch(code, /1120px/, 'no 1120px layout is left');
});

check('both profiles lay out in one column at every width', () => {
  for (const selector of ['.pfp-experience .pfp-layout', '.pf2-dashboard-grid']) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const columns = [...code.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
      .map(([, body]) => /grid-template-columns\s*:\s*([^;]+)/.exec(body)?.[1].trim())
      .filter(Boolean);
    assert.ok(columns.length > 0, `${selector} has a grid`);
    assert.ok(columns.every((c) => c === 'minmax(0, 1fr)' || c === 'minmax(0,1fr)'), `${selector}: ${columns.join(' | ')}`);
  }
});

check('router.js sets .has-tabbar before the screen loads', () => {
  const toggle = router.indexOf("shell.classList.toggle('has-tabbar'");
  const load = router.indexOf('await loader(', toggle);
  assert.ok(toggle > 0, 'the has-tabbar toggle exists');
  assert.ok(load > toggle, 'the toggle comes before the screen loader');
});

console.log(`smoke-shell-width: ALL PASSED (${passed})`);
