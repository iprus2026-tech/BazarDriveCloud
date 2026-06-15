// BD-NOTIF-01 — static regression smoke for the /inbox push-permission prompt.
//
// The prompt is the remaining BD-NOTIF-01 state (list + empty already shipped).
// A refactor could silently drop it, unbind «Включить»/«Позже», stop binding to
// the notificationsEnabled flag, or leak a real native-push call into a UI-only
// surface. STATIC source assertions only — no browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const inbox = read('../public/src/screens/inbox.js');
const app = read('../public/src/app.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. Wiring to existing user state ──
expect('inbox imports the user store', /import\s+\{\s*user\s*\}\s+from\s+'\.\.\/state\.js'/.test(inbox));
expect('prompt visibility binds to notificationsEnabled',
  /user\.get\(\)\.notificationsEnabled/.test(inbox) && /function\s+promptShown/.test(inbox));
expect('«Включить» flips notificationsEnabled (UI-only, no native registration)',
  /user\.set\(\{\s*notificationsEnabled:\s*true\s*\}\)/.test(inbox));
expect('?prompt=1 force-shows the prompt for QA',
  /getRouteParam\('prompt'\)\s*===\s*'1'/.test(inbox));

// ── B. Markup + controls + copy ──
expect('renders the .inbox-pushprompt banner via promptHtml', /function\s+promptHtml/.test(inbox) && inbox.includes('inbox-pushprompt'));
for (const copy of ['Включите push-уведомления', 'Включить', 'Позже', 'Push-уведомления включены']) {
  expect(`prompt carries copy «${copy}»`, inbox.includes(copy));
}
expect('prompt controls use the dedicated data-notif-prompt attribute (enable + later)',
  /data-notif-prompt="enable"/.test(inbox) && /data-notif-prompt="later"/.test(inbox));
expect('prompt has two views (prompt → done) toggled by data-view',
  /data-view="\$\{escapeHtml\(view\)\}"/.test(inbox) && /promptDone \? 'done' : 'prompt'/.test(inbox));
expect('«Позже» dismisses for the session; «Включить» shows the done confirmation',
  /promptDismissed\s*=\s*true/.test(inbox) && /promptDone\s*=\s*true/.test(inbox));

// ── C. UI-only boundary ──
expect('inbox never calls a native push API',
  !/Notification\b/.test(inbox) && !/pushManager/.test(inbox)
  && !/serviceWorker/.test(inbox) && !/navigator\.push/.test(inbox));

// ── D. Reuse /inbox — do NOT split a /notifications route ──
expect("app.js does not register a separate /notifications route",
  !/register\(\s*'\/notifications'/.test(app));

// ── E. CSS present ──
expect('cloud.css defines the push-prompt banner',
  /\.inbox-pushprompt\s*\{/.test(css) && /\.inbox-pushprompt\[data-view="done"\]/.test(css));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
