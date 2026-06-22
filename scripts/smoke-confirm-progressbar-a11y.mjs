// BD-CONFIRM-01 — static a11y smoke for the /trip-confirmation auto-cancel progressbar.
//
// The .cf-progress bar is a DETERMINATE role=progressbar (aria-valuemin/max = 0/60).
// A determinate progressbar must expose a current value, and that value must track the
// 60s auto-cancel countdown — every sibling progressbar (active-ride waiting, onboarding)
// keeps aria-valuenow in sync. A refactor could drop aria-valuenow from the markup or
// stop updating it inside the tick loop, silently regressing the announced progress.
// STATIC source assertions only — no browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const screen = read('../public/src/screens/trip_confirmation.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return '';
}

// ── A. Markup: the determinate progressbar exposes a current value ──
const progressTag = (screen.match(/<div class="cf-progress"[^>]*>/) || [''])[0];
expect('cf-progress is a role=progressbar', /role="progressbar"/.test(progressTag));
expect('cf-progress declares a determinate range (aria-valuemin/max)',
  /aria-valuemin="0"/.test(progressTag) && /aria-valuemax="60"/.test(progressTag));
expect('cf-progress markup carries an initial aria-valuenow',
  /aria-valuenow="\d+"/.test(progressTag));

// ── B. The countdown tick keeps aria-valuenow in sync (live, not just the initial value) ──
const countdown = functionBody(screen, 'startCountdown');
expect('startCountdown() resolved', countdown.length > 0);
expect('startCountdown resolves the .cf-progress bar', /querySelector\('\.cf-progress'\)/.test(countdown));
expect('tick keeps the progressbar aria-valuenow in sync with the countdown',
  /setAttribute\('aria-valuenow',\s*String\(remaining\)\)/.test(countdown));
// The router appends the section AFTER the loader returns, so the first tick must
// be deferred past mount — a synchronous first tick tears the countdown down on
// the pre-mount isConnected guard, freezing the bar at its initial value (Codex #713 P2).
expect('startCountdown defers the first tick past mount (no pre-mount teardown)',
  /setTimeout\(tick, 0\)|requestAnimationFrame\(tick\)/.test(countdown));

if (issues.length) {
  console.error('\nFAILURES:\n- ' + issues.join('\n- '));
  process.exit(1);
}
console.log('\nsmoke-confirm-progressbar-a11y: OK');
