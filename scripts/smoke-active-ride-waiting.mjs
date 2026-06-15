// BD-RIDE-D-WAITING-01 — static smoke for the driver waiting redesign.
//
// renderWaiting now shows a circular ns-timer ring (free wait) and gains a
// paid-wait variant (renderWaitingExpired) reachable via ?wait=expired. A
// refactor could drop the ring, the expired variant, or unwire its actions.
// STATIC source assertions only — no browser, no DOM.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const screen = read('../public/src/screens/active_ride.js');
const css = read('../public/styles/cloud.css');

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

// ── A. ?wait=expired entry + the two renderers ──
expect('driver factory reads ?wait= into a mutable waitExpired',
  /query\.get\('wait'\)/.test(screen) && /let\s+waitExpired\s*=/.test(screen));
const waiting = functionBody(screen, 'renderWaiting');
const expired = functionBody(screen, 'renderWaitingExpired');
expect('renderWaiting() resolved', waiting.length > 0);
expect('renderWaitingExpired() resolved', expired.length > 0);
expect('renderWaiting guards into the expired variant',
  /if\s*\(\s*waitExpired\s*\)\s*\{\s*renderWaitingExpired\(\);\s*return;/.test(waiting));

// ── B. Free state — circular timer ring ──
expect('free wait renders the success-tone ns-timer ring',
  /ns-timer tone-success/.test(waiting) && /stroke-dashoffset="\$\{/.test(waiting));
expect('ring value is the remaining free time', /ns-timer-val">\$\{escapeHtml\(remaining\)\}/.test(waiting));

// ── C. Paid/expired variant ──
expect('expired variant shows the paid-wait alert',
  /ns-alert warning/.test(expired) && expired.includes('Бесплатное ожидание закончилось'));
expect('expired variant uses the warning-tone ring + status copy',
  /ns-timer tone-warning/.test(expired) && expired.includes('Пассажир не выходит'));
expect('expired keeps a direct start-trip path (#ar-start → IN_PROGRESS) [Codex P2]',
  /ar-start['"]\)[\s\S]{0,200}RIDE_STATUS\.IN_PROGRESS/.test(expired));
expect('expired «Пассажир не вышел» opens the no-show flow + persists NO_SHOW',
  /ar-no-show['"]\)[\s\S]{0,400}openDriverNoShowFlow\s*\(\s*sheet/.test(expired)
  && /persistDriverCancel\(RIDE_STATUS\.NO_SHOW,\s*'passenger_no_show'\)/.test(expired));

// ── D. Free state keeps its existing contract ──
expect('free wait keeps #ar-start → IN_PROGRESS',
  /ar-start['"]\)[\s\S]{0,160}RIDE_STATUS\.IN_PROGRESS/.test(waiting));
expect('free wait keeps the no-show entry (#ar-no-show → flow)',
  /ar-no-show['"]\)[\s\S]{0,400}openDriverNoShowFlow\s*\(\s*sheet/.test(waiting));

// ── E. CSS ──
expect('cloud.css defines the timer ring', /\.ns-timer\s*\{/.test(css) && /\.ns-timer\.tone-warning\b/.test(css));
expect('cloud.css defines the paid-wait alert', /\.ns-alert\s*\{/.test(css) && /\.ns-alert\.warning\b/.test(css));

// ── F. Live free-wait countdown (BD-RIDE-D-WAIT-TIMER-01) ──
expect('screen has start/clear wait-timer helpers',
  /function\s+startWaitTimer\s*\(/.test(screen) && /function\s+clearWaitTimer\s*\(/.test(screen));
expect('renderWaiting starts the live timer', /startWaitTimer\(\);/.test(waiting));
expect('renderSheet clears the timer on every dispatch',
  /function\s+renderSheet[\s\S]{0,60}clearWaitTimer\(\)/.test(screen));
const timerBody = functionBody(screen, 'startWaitTimer');
expect('timer ticks via setInterval and auto-transitions to the paid view at 0:00',
  /setInterval\(/.test(timerBody) && /waitFreeSec\s*<=\s*0[\s\S]{0,140}renderWaitingExpired\(\)/.test(timerBody));
expect('timer self-clears on detach or leaving WAITING_PASSENGER (no leak)',
  /root\.isConnected/.test(timerBody) && /ride\.status\s*!==\s*RIDE_STATUS\.WAITING_PASSENGER/.test(timerBody));
expect('free ring exposes .ns-timer-arc for live offset updates', /ns-timer-arc/.test(waiting));
// Codex P2 fixes (PR #544 review).
expect('timer computes remaining from a wall-clock deadline (not callback count)',
  /Date\.now\(\)/.test(timerBody) && !/waitFreeSec\s*-=\s*1/.test(timerBody));
expect('timer stops if a subflow replaced the free-wait ring (no overwrite)',
  /!sheet\.querySelector\('\.ns-timer-arc'\)/.test(timerBody));
expect('tick keeps the progressbar aria-valuenow in sync',
  /aria-valuenow/.test(timerBody));
expect('deadline anchored to the persisted arrival time (survives reload) [Codex P2]',
  /function\s+waitDeadlineMs/.test(screen) && /timestamps[\s\S]{0,40}arrivedAt/.test(screen));
expect('renderWaiting short-circuits an already-expired ride to the paid view (no 0:00 flash)',
  /remSec\s*<=\s*0[\s\S]{0,80}renderWaitingExpired\(\)/.test(waiting));

// ── G. Live paid-wait counter (BD-RIDE-D-PAID-TIMER-01) ──
expect('screen has startPaidTimer + waitPaidStart anchor',
  /function\s+startPaidTimer\s*\(/.test(screen) && /let\s+waitPaidStart\s*=/.test(screen));
expect('renderWaitingExpired starts the paid timer + exposes #ar-paid-accrued',
  /startPaidTimer\(\);/.test(expired) && /id="ar-paid-accrued"/.test(expired));
const paidBody = functionBody(screen, 'startPaidTimer');
expect('paid timer ticks elapsed up + accrues at the displayed rate',
  /Date\.now\(\)\s*-\s*waitPaidStart/.test(paidBody) && /ratePerMin/.test(paidBody) && /ar-paid-accrued/.test(paidBody));
expect('paid timer self-clears on detach / leaving WAITING_PASSENGER / subflow',
  /root\.isConnected/.test(paidBody) && /!sheet\.querySelector\('\.ns-timer-val'\)/.test(paidBody));
expect('both no-show entries pass the same live-accrual resolver [Codex P2]',
  /paidWaitAmount:\s*liveAccruedPaid/.test(expired) && /paidWaitAmount:\s*liveAccruedPaid/.test(waiting));
expect('liveAccruedPaid anchors to waitPaidStart or the free deadline [Codex P2]',
  /function\s+liveAccruedPaid/.test(screen) && /waitPaidStart\s*\|\|\s*waitDeadlineMs\(\)/.test(screen));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
