// BD-MOD-01 — static regression smoke for the Order Detail moderation report
// sheet.
//
// The «Пожаловаться» CTA (data-action="report-order") was an inert stub that
// fell through to the generic STUB_TOAST_ACTION notice. It now opens a small
// standalone modal sheet over /order: report reasons → submitted (a UI stub,
// no backend, no localStorage). It is a STANDALONE moderation surface — it does
// NOT touch or reroute the in-ride BD-RIDE-P-07 safety report, and Order
// Detail's primary actions still re-render in place.
//
// This pins both the wiring and the boundary: a refactor that re-points
// report-order back at the stub toast, persists the report, or pulls in the
// protected in-ride safety sheet would still pass `node scripts/check.mjs`
// without this guard.
//
// Intentionally STATIC: reads source and asserts the contract. No DOM, no net.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const od = read('../public/src/screens/order_detail.js');
const css = read('../public/styles/cloud.css');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Isolate the sheet renderer body for boundary checks.
const sStart = od.indexOf('function reportSheetHtml()');
const sEnd = od.indexOf('function bindEvents(', sStart);
const sheetBody = sStart >= 0 && sEnd > sStart ? od.slice(sStart, sEnd) : '';

// ── A. report-order opens the sheet (no longer a stub toast) ─
expect('report-order action opens the report sheet',
  /if \(action === 'report-order'\)\s*\{\s*openReportSheet\(\);/.test(od));
expect('report-order no longer falls through to STUB_TOAST_ACTION',
  /data-action="report-order"|dataAction: 'report-order'/.test(od)
  && /if \(action === 'report-order'\)/.test(od));

// ── B. two-view machine (report → submitted) ────────────────
expect('reportSheetHtml() renderer exists', sheetBody.length > 0);
expect('both views are rendered',
  /od-report-view--report/.test(sheetBody) && /od-report-view--submitted/.test(sheetBody));
expect('view machine driven by [data-view] in CSS',
  /\.od-report-overlay\[data-view="submitted"\]\s*\.od-report-view--submitted/.test(css));
expect('controls wired via data-report (dismiss / submit) + data-report-reason',
  /data-report="dismiss"/.test(sheetBody) && /data-report="submit"/.test(sheetBody)
  && /data-report-reason=/.test(sheetBody));
expect('submit only switches to the submitted view',
  /if \(a === 'submit'\)\s*\{\s*setReportView\('submitted'\);/.test(od));

// ── C. exact strings + mock-explicit submitted copy ─────────
const REASONS = ['Мошеннический или подозрительный заказ', 'Оскорбления или угрозы',
  'Спам или реклама', 'Другое'];
expect('all report reasons present', REASONS.every((r) => od.includes(r)));
expect('submitted view carries the mock-explicit backend copy',
  /Спасибо, жалоба отправлена/.test(sheetBody)
  && /Мы рассмотрим её в модерации после подключения backend\./.test(sheetBody));

// ── D. session-only stub (no backend, no storage) ───────────
expect('report sheet writes nothing to localStorage',
  sStart >= 0 && !/setItem/.test(od.slice(sStart, sEnd + 2400)));

// ── E. BD-RIDE-P-07 non-reuse + standalone boundary ─────────
expect('does NOT reuse the in-ride safety sheet (passenger-safety)', !/passenger-safety/.test(od));
expect('does NOT reroute to /report', !/go\(\s*['"`]\/report/.test(od));
expect('no SOS / share-trip / in-ride coupling in the sheet',
  !/\bSOS\b/i.test(sheetBody) && !/Поделиться/.test(sheetBody) && !/tripId/.test(sheetBody));

// ── F. modal blocks background nav (tabbar hidden while open) ─
expect('opening the sheet hides #tabbar (sibling of #app, /order shows chrome)',
  /getElementById\('tabbar'\)/.test(od) && /reportTabbar\.hidden\s*=\s*true/.test(od));
expect('closing the sheet restores the tabbar to its prior state',
  /reportTabbar\.hidden\s*=\s*reportTabbarPrevHidden/.test(od));
expect('an in-place re-render restores the tabbar if a stray overlay is open',
  /querySelector\('\.od-report-overlay'\)[\s\S]{0,120}tb\.hidden\s*=\s*false/.test(od));

// ── G. styles present + above the toast ─────────────────────
expect('od-report overlay + reason styles exist',
  /\.od-report-overlay\s*\{/.test(css) && /\.od-report-reason\s*\{/.test(css)
  && /\.od-report-done-ic\s*\{/.test(css));
expect('overlay z-index is above .od-notice (200)',
  /\.od-report-overlay\s*\{[^}]*z-index:\s*210/.test(css));
expect('selected reason uses the accent',
  /\.od-report-reason\.is-selected\s*\{[^}]*var\(--accent\)/.test(css));

// #732 — modal a11y: the report sheet wires the shared overlay focus-trap (focus-trap +
// Escape→close + focus restore) via public/src/overlay.js, since it shipped aria-modal=true
// without any focus management. (role=radio on the reason rows is a separate a11y card.)
expect('order_detail imports the shared trapFocus helper',
  /import \{ trapFocus \} from '\.\.\/overlay\.js'/.test(od));
expect('openReportSheet installs the focus trap with Escape→closeReportSheet',
  /releaseReportTrap = trapFocus\(\s*reportOverlayEl\s*,\s*\{\s*onEscape:\s*closeReportSheet\s*\}\s*\)/.test(od));
expect('closeReportSheet releases the trap (focus restore) before removing the overlay',
  /function closeReportSheet\(\)\s*\{\s*releaseReportTrap\(\);/.test(od));
expect('submit moves focus into the submitted view (not stranded on the hidden submit button)',
  /setReportView\('submitted'\)[\s\S]{0,400}\.od-report-view--submitted \[data-report="dismiss"\][\s\S]{0,80}\.focus\(\)/.test(od));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
