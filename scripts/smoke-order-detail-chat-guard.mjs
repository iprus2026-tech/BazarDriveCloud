// BD-ORDER-DETAIL-CHAT-GUARD-01 — static regression smoke for the «Написать»
// state-aware guard notices on BOTH role sides: the driver message-passenger
// CTA and the passenger message-driver CTA.
//
// Product decision: do NOT create a driver↔passenger marketplace chat handoff
// yet — chat stays responseId / active-ride only. The driver message-passenger
// CTA (D1/D2/D3 bodies) and the passenger message-driver CTA (the P2 offer card)
// both previously fell through to the generic STUB_TOAST_ACTION notice. Each now
// shows a state-aware notice explaining when messaging opens, WITHOUT navigating
// to /chat or creating any chat thread.
//
// This pins the decision: a refactor that re-points either CTA at the generic
// stub, or wires it to /chat / a chat store, would still pass
// `node scripts/check.mjs` without this guard.
//
// Intentionally STATIC: reads source and asserts the contract. No DOM, no net.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const od = read('../public/src/screens/order_detail.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Isolate the message-passenger handler branch.
const hStart = od.indexOf("if (action === 'message-passenger')");
const hEnd = hStart >= 0 ? od.indexOf('}', hStart) + 1 : -1;
const handler = hStart >= 0 ? od.slice(hStart, hEnd) : '';

// ── A. dedicated handler, not the generic stub ──────────────
expect('message-passenger has its own handler branch', hStart >= 0);
expect('handler shows a state-keyed guard notice (not the generic stub fallthrough)',
  /showNotice\(rootEl,\s*MESSAGE_GUARD_NOTICES\[ctx\.state\]/.test(handler));

// ── B. all three state notices, exact copy ──────────────────
expect('D1 notice exact',
  /D1:\s*'Сначала отправьте отклик, чтобы открыть связь с пассажиром\.'/.test(od));
expect('D2 notice exact',
  /D2:\s*'Предложение отправлено\. Чат откроется после выбора водителя пассажиром\.'/.test(od));
expect('D3 notice exact',
  /D3:\s*'Чат поездки будет доступен через активную поездку\.'/.test(od));

// ── C. boundary — no chat handoff invented ──────────────────
expect('handler does NOT navigate to /chat', !/go\(/.test(handler));
expect('handler creates no chat thread / store write',
  !/chat/i.test(handler) && !/setItem/.test(handler) && !/saveActiveRide/.test(handler));

// ── PASSENGER PARITY: message-driver «Написать» on the P2 offer card ──
// Isolate the message-driver handler branch.
const pStart = od.indexOf("if (action === 'message-driver')");
const pEnd = pStart >= 0 ? od.indexOf('}', pStart) + 1 : -1;
const pHandler = pStart >= 0 ? od.slice(pStart, pEnd) : '';

// ── D. dedicated handler, not the generic stub ──────────────
expect('message-driver has its own handler branch', pStart >= 0);
expect('handler shows a state-keyed passenger guard notice (not the generic stub fallthrough)',
  /showNotice\(rootEl,\s*PASSENGER_MESSAGE_GUARD_NOTICES\[ctx\.state\]/.test(pHandler));
expect('handler falls back to the honest default, NOT STUB_TOAST_ACTION',
  /PASSENGER_MESSAGE_GUARD_DEFAULT/.test(pHandler) && !/STUB_TOAST_ACTION/.test(pHandler));

// ── E. passenger notices, exact copy ────────────────────────
expect('P2 notice exact',
  /P2:\s*'Выберите водителя — чат откроется в активной поездке\.'/.test(od));
expect('honest default notice exact',
  /PASSENGER_MESSAGE_GUARD_DEFAULT\s*=\s*'Чат с водителем откроется через активную поездку\.'/.test(od));

// ── F. boundary — no chat handoff invented ──────────────────
expect('passenger handler does NOT navigate to /chat', !/go\(/.test(pHandler));
expect('passenger handler creates no chat thread / store write',
  !/chat/i.test(pHandler) && !/setItem/.test(pHandler) && !/saveActiveRide/.test(pHandler));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
