// BD-RESPONSES-SAFETY-01 — static regression smoke for the /responses
// pre-ride safety sheet.
//
// #responses-shield (previously a toast stub) opens a standalone modal sheet
// over /responses with four in-memory views (default safety tips → report
// reason → submitted; default → help). It is a NEW component that DELIBERATELY
// does not import or reuse the in-ride BD-RIDE-P-07 PassengerSafetySheet:
// no driver card, no share-trip, no SOS, no in-ride call. Report submit is a
// UI stub (no backend, no localStorage).
//
// This pins both the feature and the boundary: a refactor that re-points the
// shield at a toast, persists the report, or pulls in the protected in-ride
// safety sheet would still pass `node scripts/check.mjs` without this guard.
//
// Intentionally STATIC: reads source and asserts the contract. No DOM, no net.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const responses = read('../public/src/screens/responses.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Isolate the sheet renderer body for boundary checks (robust slice between
// the function header and the next top-level function).
const sStart = responses.indexOf('function responsesSafetySheetHtml()');
const sEnd = responses.indexOf('function renderList(', sStart);
const sheetBody = sStart >= 0 && sEnd > sStart ? responses.slice(sStart, sEnd) : '';

// ── A. shield opens the sheet (no longer a toast stub) ──────
expect('#responses-shield opens the safety sheet (not a toast stub)',
  /#responses-shield'\)\.addEventListener\('click',\s*openSafetySheet\)/.test(responses));
expect('shield handler no longer toasts «Безопасность будет добавлена позже»',
  !/Безопасность будет добавлена позже/.test(responses));

// ── B. four-view machine ────────────────────────────────────
expect('sheet renderer responsesSafetySheetHtml() exists', sheetBody.length > 0);
expect('all four views are rendered',
  /responses-safety-view--default/.test(sheetBody)
  && /responses-safety-view--report/.test(sheetBody)
  && /responses-safety-view--submitted/.test(sheetBody)
  && /responses-safety-view--help/.test(sheetBody));
expect('view machine is driven by [data-view] in CSS',
  /\.responses-safety-overlay\[data-view="report"\]\s*\.responses-safety-view--report/.test(css));
expect('open/close + view transitions wired via data-rsafe',
  /data-rsafe="to-report"/.test(sheetBody) && /data-rsafe="to-help"/.test(sheetBody)
  && /data-rsafe="to-default"/.test(sheetBody) && /data-rsafe="submit"/.test(sheetBody)
  && /data-rsafe="dismiss"/.test(sheetBody));

// ── C. exact spec strings ───────────────────────────────────
const TIPS = ['Проверяйте рейтинг и данные водителя', 'Не переводите деньги заранее',
  'Согласуйте маршрут и цену в чате', 'Не сообщайте коды и личные данные'];
expect('all four safety tips present (exact)', TIPS.every((t) => responses.includes(t)));
const REASONS = ['Подозрительный профиль', 'Просит оплату заранее', 'Давит или торопит', 'Другое'];
expect('all four report reasons present (exact)', REASONS.every((r) => responses.includes(r)));
expect('default actions carry the exact labels',
  /Сообщить о подозрительном отклике/.test(sheetBody)
  && /Открыть правила безопасности/.test(sheetBody));
expect('submitted view carries the exact mock-explicit copy',
  /Спасибо, сигнал принят/.test(sheetBody)
  && /Мы сохраним это в модерации после подключения backend\./.test(sheetBody));

// ── D. report submit is a UI stub (no backend, no storage) ──
expect('report submit only switches to the submitted view',
  /if \(a === 'submit'\)\s*\{\s*setSafetyView\('submitted'\);/.test(responses));
expect('safety sheet writes nothing to localStorage',
  sStart >= 0 && !/setItem/.test(responses.slice(sStart - 1600, sEnd + 2000)));

// ── E. BD-RIDE-P-07 non-reuse boundary (the critical guard) ─
expect('safety sheet does NOT reuse the protected in-ride sheet (passenger-safety)',
  !/passenger-safety/.test(responses));
expect('no SOS / emergency element in the pre-ride sheet',
  !/\bSOS\b/i.test(sheetBody) && !/Экстренн/.test(sheetBody) && !/emergency/i.test(sheetBody));
expect('no share-trip element in the pre-ride sheet',
  !/Поделиться/.test(sheetBody) && !/share-?trip/i.test(sheetBody));
expect('no driver ride-card / in-ride coupling in the sheet',
  !/responses__driver/.test(sheetBody) && !/tripId/.test(sheetBody) && !/selectedDriver/.test(sheetBody));
expect('the sheet needs no selected driver (open takes no args)',
  /function openSafetySheet\(\)/.test(responses));

// ── E2. modal blocks background nav (tabbar is a sibling of #app) ──
expect('opening the sheet hides the #tabbar (so it cannot be clicked behind the modal)',
  /getElementById\('tabbar'\)/.test(responses)
  && /safetyTabbar\.hidden\s*=\s*true/.test(responses));
expect('closing the sheet restores the tabbar to its prior state',
  /safetyTabbar\.hidden\s*=\s*safetyTabbarPrevHidden/.test(responses));

// ── F. styles ported + namespaced ───────────────────────────
expect('overlay + ported .rsafe-* content styles exist',
  /\.responses-safety-overlay\s*\{/.test(css) && /\.rsafe-tip\s*\{/.test(css)
  && /\.rsafe-help-note\s*\{/.test(css) && /\.rsafe-done-ic\s*\{/.test(css));
expect('selected report reason uses the accent',
  /\.responses-safety-reason\.is-selected\s*\{[^}]*var\(--accent\)/.test(css));

// ── G. modal a11y (BD-OPS / #732) — the pre-ride safety sheet wires the shared overlay
// focus-trap (focus-trap + step-back Escape→close + focus restore + re-focus on view change).
// It shipped aria-modal=true with no focus management.
expect('responses imports the shared trapFocus helper',
  /import \{ trapFocus \} from '\.\.\/overlay\.js'/.test(responses));
expect('openSafetySheet installs the focus trap whose Escape owns step-back (sub-view → default → close)',
  /releaseSafetyTrap = trapFocus\(safetyOverlayEl,\s*\{[\s\S]{0,80}onEscape/.test(responses)
  && /dataset\.view !== 'default'[\s\S]{0,90}setSafetyView\('default'\)/.test(responses)
  && /onEscape:[\s\S]{0,280}closeSafetySheet\(\)/.test(responses));
expect('closeSafetySheet releases the trap (focus restore to #responses-shield)',
  /function closeSafetySheet\(\)\s*\{\s*releaseSafetyTrap\(\);/.test(responses));
expect('setSafetyView re-focuses into the now-visible view on each transition',
  /\.responses-safety-view--\$\{view\} button:not\(\[disabled\]\)[\s\S]{0,40}\.focus\(\)/.test(responses));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
