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
  /register\(\s*'\/settings'\s*,\s*context => settings\(context, \{ logout: options => authLogout.logout\(options\) \}\)/.test(app));

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
expect('settings delegates logout without direct fetch / localStorage / real push registration',
  !/\bfetch\s*\(/.test(screen)
  && !/localStorage/.test(screen)
  && !/Notification\b/.test(screen)
  && !/pushManager|serviceWorker/.test(screen));
expect('Settings backend OFF retains demo logout; ON uses injected shared control',
  /if \(!isBackendEnabled\(\)\)/.test(screen)
  && screen.includes('Демо-режим: выход не выполняется')
  && /createLogoutControl\(\{ logout,/.test(screen));
expect('Delete Account remains demo-only', screen.includes('Демо-режим: аккаунт не удаляется'));

// ── F. Service worker precache ──
expect('sw.js precaches settings.js',
  /\.\/src\/screens\/settings\.js/.test(sw));

// ── G. CSS — the settings-scoped toggle atom exists ──
expect('cloud.css defines the settings toggle atom',
  /\.settings__toggle\s*\{/.test(css) && /\.settings__toggle--on\b/.test(css));

// ── H. #1185 — controls that used to be silent or forgot their state ──
expect('the push toggle reads and writes the stored notificationsEnabled preference [#1185]',
  /paintPush\(user\.get\(\)\.notificationsEnabled === true\)/.test(screen)
    && /user\.set\(\{\s*notificationsEnabled:\s*on\s*\}\)/.test(screen));
const confirmation = read('../public/src/screens/trip_confirmation.js');
expect('the /trip-confirmation shield toggles a safety note instead of a no-op [#1185]',
  /id="cf-safety-note"[^>]*hidden/.test(confirmation)
    && /#cf-shield'\)\.addEventListener\('click',\s*\(e\)\s*=>\s*\{[\s\S]{0,200}note\.hidden = !note\.hidden/.test(confirmation)
    && !/no-op stub here/.test(confirmation));
expect('the collapsed safety note is really hidden: .bd-alert display:flex needs a [hidden] override [#1185]',
  /\.cf-safety-note\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css));
expect('«Проверить отметки» answers when the permit is already marked [#1185]',
  /checkReadyBtn && user\.get\(\)\.taxiPermit[\s\S]{0,260}Разрешение отмечено/.test(profile));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
