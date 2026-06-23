// BD-OPS / #732 — overlay a11y helper smoke (public/src/overlay.js).
//
// trapFocus() is the shared modal-overlay focus manager (the #732 top recommendation):
// capture the trigger, move focus into the overlay, trap Tab / Shift+Tab within the visible
// focusables, restore focus on release. This proves that behaviour against a minimal DOM
// stub (no jsdom), and statically pins that the passenger active-ride sheets wire it.

import fs from 'node:fs';
import { trapFocus } from '../public/src/overlay.js';

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── Minimal DOM stub ─────────────────────────────────────────────────────────
function makeBtn(doc, id) {
  const el = { id, offsetParent: {} /* visible */, focus() { doc.activeElement = el; } };
  return el;
}
function makeDoc() {
  const listeners = [];
  const inDoc = new Set();
  return {
    activeElement: null,
    _inDoc: inDoc,
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    removeEventListener(type, fn) { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
    contains(el) { return inDoc.has(el); },
    _lastStopped: false,
    _dispatchKeydown(key, shiftKey) {
      let prevented = false;
      this._lastStopped = false;
      const ev = { key, shiftKey, preventDefault() { prevented = true; }, stopImmediatePropagation: () => { this._lastStopped = true; } };
      for (const l of listeners.slice()) if (l.type === 'keydown') l.fn(ev);
      return prevented;
    },
    _keydownCount() { return listeners.filter((l) => l.type === 'keydown').length; },
  };
}

// ── Behaviour ────────────────────────────────────────────────────────────────
const doc = makeDoc();
const trigger = makeBtn(doc, 'trigger');
doc._inDoc.add(trigger);
const b1 = makeBtn(doc, 'b1');
const b2 = makeBtn(doc, 'b2');
const b3 = makeBtn(doc, 'b3');
const kids = [b1, b2, b3];
const overlay = {
  ownerDocument: doc,
  querySelectorAll() { return kids; },
  querySelector() { return null; },
  contains(el) { return kids.includes(el); },
  focus() { doc.activeElement = overlay; },
};

doc.activeElement = trigger;
const release = trapFocus(overlay);
expect('initial focus moves into the overlay (first visible focusable)', doc.activeElement === b1);
expect('a keydown listener is registered while trapped', doc._keydownCount() === 1);

doc.activeElement = b3;
const p1 = doc._dispatchKeydown('Tab', false);
expect('Tab at the last focusable wraps to the first (+ preventDefault)', p1 === true && doc.activeElement === b1);
expect('a handled Tab wrap consumes the event (stopImmediatePropagation) — no leak to a stacked modal (#738)',
  doc._lastStopped === true);

doc.activeElement = b1;
const p2 = doc._dispatchKeydown('Tab', true);
expect('Shift+Tab at the first focusable wraps to the last (+ preventDefault)', p2 === true && doc.activeElement === b3);

doc.activeElement = b2;
const p3 = doc._dispatchKeydown('Tab', false);
expect('Tab in the middle does NOT preventDefault (natural move)', p3 === false);
expect('an un-handled Tab does NOT stop propagation (only a handled key is consumed)', doc._lastStopped === false);

release();
expect('release restores focus to the trigger', doc.activeElement === trigger);
expect('release removes the keydown listener', doc._keydownCount() === 0);
release();
expect('release is idempotent (no throw, no double-restore listener)', doc._keydownCount() === 0);

// Escape only when the caller opts in (the active-ride sheets keep their own step-back Escape).
const doc2 = makeDoc();
let escFired = false;
const overlay2 = { ownerDocument: doc2, querySelectorAll: () => [], querySelector: () => null, contains: () => false, focus() {} };
const rel2 = trapFocus(overlay2, { onEscape: () => { escFired = true; } });
doc2._dispatchKeydown('Escape', false);
expect('Escape invokes opts.onEscape when provided', escFired === true);
expect('a handled Escape consumes the event (stopImmediatePropagation) so a stacked modal does not also close (#738)',
  doc2._lastStopped === true);
rel2();

const doc3 = makeDoc();
let esc3 = false;
const overlay3 = { ownerDocument: doc3, querySelectorAll: () => [], querySelector: () => null, contains: () => false, focus() {} };
const rel3 = trapFocus(overlay3); // no onEscape
doc3._dispatchKeydown('Escape', false);
expect('Escape is ignored by the helper when onEscape is absent (the sheet owns it)', esc3 === false);
rel3();

expect('trapFocus tolerates a null overlay (returns a no-op release)',
  typeof trapFocus(null) === 'function');

// #734 — if the overlay leaves the DOM WITHOUT close() (a route change replaceChildren()s
// #app while the sheet is open), the next keydown self-releases the trap and is NOT
// intercepted, so Tab is not captured on the screen that replaced it.
{
  const docL = makeDoc();
  const trig = makeBtn(docL, 't');
  docL._inDoc.add(trig);
  const kid = makeBtn(docL, 'k');
  const ovL = {
    ownerDocument: docL, isConnected: true,
    querySelectorAll: () => [kid], querySelector: () => null,
    contains: (e) => e === kid, focus() {},
  };
  docL.activeElement = trig;
  const relL = trapFocus(ovL);
  expect('the keydown trap is active while the overlay is connected', docL._keydownCount() === 1);
  ovL.isConnected = false; // simulate the replaceChildren() teardown on a route change
  const prevented = docL._dispatchKeydown('Tab', false);
  expect('after a no-close teardown, the next keydown self-releases the trap', docL._keydownCount() === 0);
  expect('and that keydown is NOT intercepted (Tab works on the next screen)', prevented === false);
  relL();
}

// ── Static integration: the passenger sheets wire the helper ────────────────
const sheetsSrc = fs.readFileSync(new URL('../public/src/screens/active_ride_passenger_sheets.js', import.meta.url), 'utf8');
expect('passenger sheets import trapFocus from ../overlay.js',
  /import \{ trapFocus \} from '\.\.\/overlay\.js'/.test(sheetsSrc));
expect('both passenger sheets (safety + cancel) install the trap after append',
  (sheetsSrc.match(/releaseTrap = trapFocus\(overlay\)/g) || []).length === 2);
expect('both sheets release the trap (focus restore) inside close()',
  (sheetsSrc.match(/releaseTrap\(\);/g) || []).length === 2);

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
