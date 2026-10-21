// BD-AUTH-POLICY-01C-1 — smoke for the driver enrollment client seam and the session
// active-role transport (docs/driver-role-grant-contract.md §1, §3).
//
// Behavioural (Node, stubbed fetch — no network):
//   - driver_enrollment.js stays dark with the backend OFF (BACKEND_DISABLED, no fetch);
//   - POST/GET /drivers/enrollment parse the envelope strictly (malformed -> BAD_RESPONSE);
//   - the view model covers no application / PENDING / APPROVED / REJECTED / REVOKED, with and
//     without "continue as passenger"; a held driver grant reads as APPROVED;
//   - the card markup: heading focus target, escaping, busy and error states;
//   - api_client.putSessionActiveRole sends PUT { activeRole } and refuses a mismatched reply;
//   - (01C-2) the profile sheet variant: «Закрыть» in place of «Выйти», an h2 sheet layout.
// Static: the onboarding "Вход выполнен" wiring, app.js transport injection, the profile
// server switch (01C-2), the sw precache.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const issues = [];
let passed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('PASS — ' + label); }
  catch (err) { issues.push(label); console.log('FAIL — ' + label + ' :: ' + (err?.message ?? err)); }
}
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

// Minimal globals: api_config reads document for the meta tag; auth_token reads storage.
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
globalThis.document = globalThis.document || { querySelector: () => null };
const requests = [];
let reply = null;
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method || 'GET', body: init.body, headers: init.headers || {} });
  const { status = 200, payload } = typeof reply === 'function' ? reply(String(url), init) : reply;
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
};

const enrollment = await import(new URL('../public/src/driver_enrollment.js', import.meta.url).href);
const client = await import(new URL('../public/src/api_client.js', import.meta.url).href);
const rejects = async (fn) => { try { await fn(); return null; } catch (err) { return err; } };

await check('backend OFF: enrollment calls are dark and never fetch', async () => {
  delete globalThis.__BD_API_BASE__;
  for (const fn of [enrollment.submitDriverEnrollment, enrollment.readDriverEnrollment]) {
    assert.equal((await rejects(fn)).code, 'BACKEND_DISABLED');
  }
  assert.equal(requests.length, 0);
});

globalThis.__BD_API_BASE__ = 'https://api.example.invalid';

await check('submit POSTs /drivers/enrollment with no body and parses the envelope', async () => {
  requests.length = 0;
  reply = { status: 201, payload: { enrollment: { status: 'PENDING', requestedAt: 'x', decidedAt: null }, roles: ['passenger'] } };
  const model = await enrollment.submitDriverEnrollment();
  assert.deepEqual({ ...model, roles: [...model.roles] }, { status: 'PENDING', roles: ['passenger'], driverGranted: false });
  const [req] = requests;
  assert.equal(req.method, 'POST');
  assert.ok(req.url.endsWith('/api/v1/drivers/enrollment'));
  assert.equal(req.body, undefined, 'the applicant sends no fields');
});

await check('read GETs /drivers/enrollment; no application and a held grant are distinct', async () => {
  reply = { payload: { enrollment: null, roles: ['passenger'] } };
  assert.equal((await enrollment.readDriverEnrollment()).status, 'NONE');
  reply = { payload: { enrollment: null, roles: ['passenger', 'driver'] } };
  const granted = await enrollment.readDriverEnrollment();
  assert.equal(granted.driverGranted, true);
  assert.equal(requests.at(-1).method, 'GET');
});

await check('a malformed envelope is BAD_RESPONSE, never "no application"', async () => {
  for (const payload of [null, {}, { enrollment: null }, { enrollment: { status: 'MAYBE' }, roles: [] },
    { enrollment: null, roles: 'driver' }, { enrollment: null, roles: [1] }]) {
    reply = { payload };
    assert.equal((await rejects(enrollment.readDriverEnrollment)).code, 'BAD_RESPONSE', JSON.stringify(payload));
  }
});

await check('the view model covers every state; "continue as passenger" only when offered', async () => {
  const view = (status, opts) => enrollment.enrollmentView({ status, driverGranted: false, roles: [] }, opts);
  assert.deepEqual(view('NONE', { passengerAvailable: true }).actions, ['apply', 'continue-passenger', 'exit']);
  assert.deepEqual(view('NONE').actions, ['apply', 'exit']);
  assert.deepEqual(view('PENDING', { passengerAvailable: true }).actions, ['refresh', 'continue-passenger', 'exit']);
  assert.deepEqual(view('APPROVED').actions, ['continue-driver', 'exit']);
  assert.deepEqual(view('REJECTED', { passengerAvailable: true }).actions, ['apply', 'continue-passenger', 'exit']);
  assert.deepEqual(view('REVOKED').actions, ['apply', 'exit']);
  assert.equal(view('NONE').title, 'Роль водителя пока не выдана');
  assert.equal(view('PENDING').title, 'Заявка на рассмотрении');
  assert.equal(view('APPROVED').title, 'Доступ водителя открыт');
  assert.equal(view('REJECTED').title, 'Заявка отклонена');
  assert.equal(view('REVOKED').title, 'Доступ водителя отозван');
  assert.equal(enrollment.enrollmentView({ status: 'NONE', driverGranted: true }).status, 'APPROVED',
    'a held driver grant reads as approved');
});

await check('the card: focusable heading, re-apply label, busy and error states, escaping', async () => {
  const view = enrollment.enrollmentView({ status: 'REJECTED', driverGranted: false }, { passengerAvailable: true });
  const html = enrollment.renderEnrollmentCard(view, { idPrefix: 'ob', lead: 'Вход выполнен.' });
  assert.match(html, /<h1 class="ob-title" id="ob-title" tabindex="-1">Заявка отклонена<\/h1>/);
  assert.match(html, /id="ob-apply"[^>]*>Подать заявку снова</);
  assert.match(html, /id="ob-continue-passenger"/);
  assert.match(html, /id="ob-exit"/);
  assert.match(html, /id="ob-err" role="alert" hidden/);
  assert.match(html, /data-enroll-status="REJECTED"/);
  const busy = enrollment.renderEnrollmentCard(view, { idPrefix: 'ob', busy: true, error: '<b>нет связи</b>' });
  assert.equal((busy.match(/disabled aria-disabled="true"/g) || []).length, view.actions.length, 'busy disables every action');
  assert.ok(busy.includes('&lt;b&gt;нет связи&lt;/b&gt;') && !busy.includes('<b>'), 'the error text is escaped');
  assert.doesNotMatch(busy, /id="ob-err" role="alert" hidden/);
});

await check('01C-2: dismiss "close" replaces «Выйти» in every state and is never the primary action', async () => {
  for (const status of ['NONE', 'PENDING', 'APPROVED', 'REJECTED', 'REVOKED']) {
    const view = enrollment.enrollmentView({ status, driverGranted: false, roles: [] }, { dismiss: 'close' });
    assert.equal(view.actions.at(-1), 'close', status);
    assert.equal(view.actions.includes('exit'), false, status);
    assert.equal(view.actions.includes('continue-passenger'), false, status + ': the profile is already passenger');
  }
  const only = enrollment.enrollmentView({ status: 'NONE', driverGranted: false }, { dismiss: 'close' });
  const html = enrollment.renderEnrollmentCard({ ...only, actions: ['close'] }, { idPrefix: 'pfe' });
  assert.match(html, /class="bd-btn ghost" id="pfe-close" data-enroll-action="close">Закрыть</);
  assert.deepEqual(enrollment.enrollmentView({ status: 'NONE' }).actions, ['apply', 'exit'], 'the default stays «Выйти»');
});

await check('01C-2: the sheet layout is an h2 card with the same focus, error and status hooks', async () => {
  const view = enrollment.enrollmentView({ status: 'PENDING', driverGranted: false }, { dismiss: 'close' });
  const html = enrollment.renderEnrollmentCard(view, { idPrefix: 'pfe', layout: 'sheet' });
  assert.match(html, /<h2 class="pf-enroll-sheet__title" id="pfe-title" tabindex="-1">Заявка на рассмотрении<\/h2>/);
  assert.match(html, /class="pf-enroll-sheet__body" data-enroll-status="PENDING"/);
  assert.match(html, /id="pfe-err" role="alert" hidden/);
  assert.match(html, /class="bd-btn primary" id="pfe-refresh"/);
  assert.match(html, /id="pfe-close"/);
  assert.doesNotMatch(html, /ob-scroll|ob-footer|<h1/, 'no onboarding chrome inside the profile sheet');
  const busy = enrollment.renderEnrollmentCard(view, { idPrefix: 'pfe', layout: 'sheet', busy: true, error: '<i>x</i>' });
  assert.equal((busy.match(/disabled aria-disabled="true"/g) || []).length, view.actions.length);
  assert.ok(busy.includes('&lt;i&gt;x&lt;/i&gt;') && !busy.includes('<i>'));
});

await check('error texts: network, not granted, generic (no raw codes shown)', async () => {
  assert.match(enrollment.enrollmentErrorText({ code: 'NETWORK' }), /связаться с сервером/);
  assert.match(enrollment.enrollmentErrorText({ code: 'ROLE_NOT_GRANTED' }), /ещё не выдана/);
  assert.match(enrollment.enrollmentErrorText({ code: 'BAD_RESPONSE', status: 0 }), /Не удалось выполнить запрос/);
});

await check('putSessionActiveRole sends PUT { activeRole } and refuses a mismatched reply', async () => {
  requests.length = 0;
  reply = { payload: { user: { userId: 'u1', sessionId: 's1', activeRole: 'driver', phoneVerified: true, roles: ['passenger', 'driver'] } } };
  const out = await client.putSessionActiveRole('driver');
  assert.deepEqual({ ...out, roles: [...out.roles] }, { userId: 'u1', activeRole: 'driver', roles: ['passenger', 'driver'] });
  assert.equal(requests[0].method, 'PUT');
  assert.ok(requests[0].url.endsWith('/api/v1/auth/session/active-role'));
  assert.deepEqual(JSON.parse(requests[0].body), { activeRole: 'driver' });
  for (const user of [{ userId: 'u1', activeRole: 'passenger', roles: [] }, { activeRole: 'driver', roles: [] }, null]) {
    reply = { payload: { user } };
    assert.equal((await rejects(() => client.putSessionActiveRole('driver'))).code, 'SESSION_PROTOCOL', JSON.stringify(user));
  }
  reply = { status: 403, payload: { error: 'x', code: 'ROLE_NOT_GRANTED', retryable: false } };
  assert.equal((await rejects(() => client.putSessionActiveRole('driver'))).code, 'ROLE_NOT_GRANTED');
});

// ── Static wiring ─────────────────────────────────────────────────────────────
const onboarding = read('../public/src/screens/onboarding.js');
const app = read('../public/src/app.js');
const sw = read('../public/sw.js');
const bootstrap = read('../public/src/auth_session_bootstrap.js');

await check('onboarding: the "Вход выполнен" state renders before steps, from the installed identity only', async () => {
  assert.match(onboarding, /import \{[\s\S]*?submitDriverEnrollment[\s\S]*?\} from '\.\.\/driver_enrollment\.js'/);
  assert.match(onboarding, /function render\(\) \{\s*if \(access\) \{\s*root\.innerHTML = renderAccess\(\);/);
  assert.match(onboarding, /result\.handoffInstalled === true && \(!verifyPhoneOnly \|\| rebuildProfileAfterVerify\)/);
  assert.match(onboarding, /lead: 'Вход выполнен\.'/);
});

await check('onboarding: actions — apply/refresh, adoptRole for both roles, server-first exit, focus', async () => {
  assert.match(onboarding, /apply: \(\) => runAccess\(\(\) => submitDriverEnrollment\(\)\)/);
  assert.match(onboarding, /refresh: \(\) => runAccess\(\(\) => readDriverEnrollment\(\)\)/);
  assert.match(onboarding, /'continue-driver': \(\) => adoptAccessRole\('driver'\)/);
  assert.match(onboarding, /'continue-passenger': \(\) => adoptAccessRole\('passenger'\)/);
  assert.match(onboarding, /auth\.adoptRole\(role\)/);
  assert.match(onboarding, /auth\?\.detach\?\.\(\{ intent: 'abandon', isCurrent: ownsScreen \}\)/);
  assert.match(onboarding, /root\.querySelector\('#ob-title'\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(onboarding, /ecode === 'ROLE_SWITCH_FAILED' \? 'Не удалось переключить роль\. Повторите попытку\.'/);
});

await check('app.js injects the switch transport and exposes adoptRole; the bootstrap stays transport-free', async () => {
  assert.match(app, /import \{ putSessionActiveRole \} from '\.\/api_client\.js'/);
  assert.match(app, /bootSession\.beginLogin\(\{ \.\.\.options, switchRole: role => putSessionActiveRole\(role\) \}\)/);
  assert.match(app, /adoptRole: role => bootSession\.adoptRole\(role\)/);
  assert.doesNotMatch(bootstrap, /from '\.\/api_client\.js'[\s\S]*putSessionActiveRole|apiFetch\(/,
    'the bootstrap never calls the network itself');
});

const profileSrc = read('../public/src/screens/profile.js');
await check('01C-2: profile backend-ON switches through the injected server capability; OFF keeps smokeRole', async () => {
  assert.match(app, /switchRole: role => switchProfileRole\(context, role\)/);
  assert.match(app, /if \(profileSwitchOwner\?\.isCurrent\(\)\) return;/, 'the listener leaves the switching profile mounted');
  assert.match(app, /clearSmokeRole\(\);\s*user\.set\(\{ role \}\);/, 'the local role changes only after the confirmed read');
  assert.match(profileSrc, /export default function profile\(renderContext, \{ logout = performLocalLogout, switchRole = null(?:, syncRole = null)? \} = \{\}\)/);
  assert.match(profileSrc, /if \(model\.backend\) \{\s*wireServerRoleSwitch\(root, root\.querySelector\('#pfp-role-switch'\)/);
  assert.match(profileSrc, /\} else \{\s*root\.querySelector\('#pfp-role-switch'\)\?\.addEventListener\('click', \(\) => \{ setSmokeRole\('driver'\); go\('\/profile'\); \}\);/);
  assert.match(profileSrc, /if \(isBackendEnabled\(\)\) \{\s*wireServerRoleSwitch\(root, root\.querySelector\('#pf2-act-role-switch'\)/);
  assert.match(profileSrc, /result\.code === 'ROLE_NOT_GRANTED' && role === 'driver'\) \{\s*openEnrollmentSheet\(/);
  assert.match(profileSrc, /enrollmentView\(state\.model, \{ dismiss: 'close' \}\)/);
  assert.match(profileSrc, /layout: 'sheet'/);
});

await check('sw.js precaches driver_enrollment.js', async () => {
  assert.match(sw, /'\.\/src\/driver_enrollment\.js',/);
});

console.log(`driver-enrollment-client: ${passed} checks PASS${issues.length ? `, ${issues.length} FAIL` : ''}`);
if (issues.length) process.exitCode = 1;
