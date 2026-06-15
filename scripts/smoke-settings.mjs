// BD-SETTINGS-01 — static regression smoke for the Settings screen.
//
// Settings is a net-new screen (public/src/screens/settings.js) reached from
// both profile gears. A future refactor could silently drop the route
// registration, unwire an entry point, regress the gate states (theme segment,
// language list, toggle, delete confirm, error banner, save toast), or leak a
// real backend/push call into a UI-only surface — none of which would trip the
// generic checks. This script is intentionally STATIC: it reads source and
// asserts the contract holds. No browser, no DOM, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const screen = read('../public/src/screens/settings.js');
const app = read('../public/src/app.js');
const profile = read('../public/src/screens/profile.js');
const sw = read('../public/sw.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. Route registration ──
expect('app.js imports the settings screen',
  /import\s+settings\s+from\s+'\.\/screens\/settings\.js'/.test(app));
expect("app.js registers '/settings'",
  /register\(\s*'\/settings'\s*,\s*settings\s*\)/.test(app));

// ── B. Screen module + role-awareness ──
expect('settings.js has a default export',
  /export\s+default\s+function\s+settings\s*\(/.test(screen));
expect('settings screen is role-aware (reads ?role= → role-correct profile back)',
  /getParam\(\s*'role'\s*\)/.test(screen) && /function\s+profileRoute/.test(screen)
  && /role === 'driver' \? '\/profile\?role=driver' : '\/profile'/.test(screen));

// ── C. Entry points wired (both gears) ──
expect('passenger #pfp-settings-btn opens /settings (was inert)',
  /#pfp-settings-btn'\)[\s\S]{0,90}go\('\/settings'\)/.test(profile));
expect('driver #pf2-gear opens /settings (no longer switches to the security pane)',
  /#pf2-gear'\)[\s\S]{0,140}go\('\/settings\?role=driver'\)/.test(profile)
  && !/#pf2-gear'\)[\s\S]{0,140}data-pane="security"/.test(profile));
expect('driver security pane stays reachable (tab entry + pane still present, not orphaned by the gear repoint)',
  /\{\s*id:\s*'security'/.test(profile) && /id="pf2-pane-security"/.test(profile));

// ── D. Gate states + copy ──
for (const cls of ['settings__row', 'settings__seg-btn', 'settings__lang-list', 'settings__toggle', 'settings__confirm', 'settings__banner--error', 'settings__toast']) {
  expect(`screen renders .${cls}`, screen.includes(cls));
}
for (const copy of ['Настройки', 'Язык', 'Тема', 'Push-уведомления', 'Удалить аккаунт', 'Сохранить', 'Сохранено', 'Не удалось сохранить']) {
  expect(`screen carries copy «${copy}»`, screen.includes(copy));
}
expect('theme segmented control has the 3 options',
  screen.includes('Светлая') && screen.includes('Тёмная') && screen.includes('Системная'));
expect('error banner is gated behind ?state=error (QA hint, no real failure path)',
  /stateParam === 'error'/.test(screen));

// ── E. UI-only boundary ──
expect('settings screen imports no data/backend layer',
  !/from\s+'\.\.\/mock_api/.test(screen)
  && !/from\s+'\.\.\/ride_state/.test(screen)
  && !/from\s+'\.\.\/data_layer/.test(screen));
expect('settings screen performs no fetch / localStorage / real push registration',
  !/\bfetch\s*\(/.test(screen)
  && !/localStorage/.test(screen)
  && !/Notification\b/.test(screen)
  && !/pushManager|serviceWorker/.test(screen));

// ── F. Service worker precache ──
expect('sw.js precaches settings.js',
  /\.\/src\/screens\/settings\.js/.test(sw));

// ── G. CSS — the settings-scoped toggle atom exists ──
expect('cloud.css defines the settings toggle atom',
  /\.settings__toggle\s*\{/.test(css) && /\.settings__toggle--on\b/.test(css));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
