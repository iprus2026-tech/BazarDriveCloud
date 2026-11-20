// #1185 — «Кто вы?» was asked twice on the first run with the backend ON: once on the welcome
// screen («Начать»), and again as the first step of onboarding, which the app opens straight
// after. Onboarding now opens on the phone step when the role was chosen a moment ago.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const { roleAlreadyChosen } = await import('../public/src/screens/onboarding.js');
const src = fs.readFileSync(new URL('../public/src/screens/onboarding.js', import.meta.url), 'utf8');

test('the first run: a role picked on the welcome screen, nothing else yet', () => {
  assert.equal(roleAlreadyChosen({ welcomeSeen: true, role: 'passenger', onboarded: false, phone: null }), true);
  assert.equal(roleAlreadyChosen({ welcomeSeen: true, role: 'driver', onboarded: false }), true);
});

test('no role yet (welcome «Войти») and a guest still get the role step', () => {
  assert.equal(roleAlreadyChosen({ welcomeSeen: true, role: null, onboarded: false }), false);
  assert.equal(roleAlreadyChosen({ welcomeSeen: true, role: 'guest', onboarded: false }), false);
  assert.equal(roleAlreadyChosen({}), false);
  assert.equal(roleAlreadyChosen(null), false);
});

test('a registered profile and an unfinished registration with a phone are not the first run', () => {
  assert.equal(roleAlreadyChosen({ role: 'passenger', onboarded: true, phone: '+79001234567' }), false);
  assert.equal(roleAlreadyChosen({ role: 'passenger', onboarded: true }), false);
  // someone coming back with a phone already stored: the role step stays the first screen
  assert.equal(roleAlreadyChosen({ role: 'passenger', onboarded: false, phone: '9990000001' }), false);
});

test('onboarding opens on the phone step for the first run, after the explicit entry points', () => {
  const init = src.slice(src.indexOf('// Explicit recovered authority resumes at profile'), src.indexOf('function returnToAuthVerification()'));
  // recovered login and ?step=phone keep their own first step, in that order
  assert.match(init, /if \(recoveredLogin\) \{[\s\S]*?\} else if \(startAtPhone\) \{[\s\S]*?\} else if \(roleAlreadyChosen\(currentUser\) && !reloadedLoginResumable\(\)\) \{\s*(?:\/\/[^\n]*\n\s*)*const phoneIdx = steps\(\)\.indexOf\('phone'\);\s*if \(phoneIdx >= 0\) step = phoneIdx;\s*\}/);
});

test('a reloaded, already verified login keeps the role step (#1177)', () => {
  // the resume happens from the role step's «Продолжить»; skipping the step would skip the resume
  assert.match(src, /roleAlreadyChosen\(currentUser\) && !reloadedLoginResumable\(\)/);
  assert.match(src, /if \(reloadedLoginResumable\(\)\) \{\s*void resumeReloadedLogin\(draft\.role\);/);
});

test('the chosen role is what the flow carries, and «Назад» reaches the role step', () => {
  assert.match(src, /role: knownRole \?\? \(startAtPhone \? 'passenger' : \(currentUser\.role \?\? null\)\),/);
  const back = src.slice(src.indexOf('function back() {'), src.indexOf('function finish() {'));
  assert.match(back, /if \(step === 0\) \{/);
  assert.match(back, /step--;\s*render\(\);/);
});
