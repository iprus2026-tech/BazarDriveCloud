// New-tab session continuity (backend ON). On a phone every app relaunch is a fresh tab, and the
// per-tab ownership marker (sessionStorage) used to make every fresh tab sign in again: a retained
// bearer was never offered to the server. Now a record the SERVER CONFIRMED (its ownerVersion is
// named by `bazardrive.auth.confirmed.v1`) is taken back as a candidate and must be confirmed again
// by /auth/session — same user, verified phone — before it is trusted. Everything else stays as it
// was: an unconfirmed (abandoned) candidate, a stale confirmation, a revoked session, a foreign
// user, an unverified phone and a tab that already decided are never adopted.
//
// Runs the real auth_token.js and auth_session_bootstrap.js against in-memory Web Storage, one fresh
// module instance per "tab". The browser run of the same scenarios is in the PR description.

import assert from 'node:assert/strict';

const failures = [];
let passed = 0;
async function check(label, run) {
  try {
    await run();
    passed += 1;
    console.log(`PASS — ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL — ${label}: ${error?.stack || error}`);
  }
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (k) => (values.has(k) ? values.get(k) : null),
    setItem: (k, v) => values.set(k, String(v)),
    removeItem: (k) => values.delete(k),
    snapshot: () => Object.fromEntries(values),
  };
}

const AUTH_KEY = 'bazardrive.auth.v1';
const CONFIRMED_KEY = 'bazardrive.auth.confirmed.v1';
const MARKER_KEY = 'bazardrive.auth.rejected_projection.v1';
const OWNER = '11111111-2222-4333-8444-555555555555';
const OTHER_OWNER = '99999999-2222-4333-8444-555555555555';
const record = (extra = {}) => JSON.stringify({ token: 'tok-a', userId: 'user-a', phone: '+79050000000', ownerVersion: OWNER, ...extra });
const userDTO = (over = {}) => ({ user: { userId: 'user-a', sessionId: 'sess-a', activeRole: 'passenger', phoneVerified: true, ...over } });

let tabSeq = 0;
// A fresh tab: shared localStorage, its own (empty unless given) sessionStorage, fresh modules.
async function freshTab(local, { session = storage(), requestSession }) {
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  tabSeq += 1;
  const auth = await import(`../public/src/auth_token.js?tab=${tabSeq}`);
  const { createAuthSessionBootstrap } = await import(`../public/src/auth_session_bootstrap.js?tab=${tabSeq}`);
  const calls = [];
  const c = createAuthSessionBootstrap({
    backendEnabled: () => true,
    readToken: auth.getAuthToken, readUserId: auth.getAuthUserId, readPhone: auth.getAuthPhone,
    writeAuth: auth.setAuth, dropAuth: auth.clearAuth, pinTabUser: auth.pinAuthTabUser,
    readOwnerVersion: auth.getAuthOwnerVersion, authCandidate: auth.isAuthCandidate,
    commitCandidate: auth.commitAuthCandidate, tabRejected: auth.isAuthTabRejected,
    detachAuth: auth.detachRejectedAuth, adoptConfirmed: auth.adoptConfirmedAuth,
    requestSession: async (opts) => { calls.push(auth.getAuthToken()); return requestSession(opts); },
  });
  return { auth, c, calls, session };
}

await check('a server-confirmed record is taken back by a fresh tab after the server confirms it again', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OWNER });
  const before = local.getItem(AUTH_KEY);
  const t = await freshTab(local, { requestSession: async () => userDTO() });
  const s = await t.c.reconcile();
  assert.equal(s.state, 'AUTHENTICATED');
  assert.deepEqual(t.calls, ['tok-a'], 'exactly one session read, with the retained bearer');
  assert.equal(t.auth.getAuthUserId(), 'user-a');
  assert.equal(t.session.getItem(MARKER_KEY), `bound:${OWNER}`, 'this tab now owns it, bound');
  assert.equal(local.getItem(AUTH_KEY), before, 'the shared record is not rewritten (no extra cross-tab broadcast)');
});

await check('a revoked session (logout / Guest revoke on the server first) is refused and the tab detaches', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OWNER });
  const before = local.getItem(AUTH_KEY);
  const t = await freshTab(local, { requestSession: async () => ({ user: null }) });
  const s = await t.c.reconcile();
  assert.equal(s.state, 'ANONYMOUS');
  assert.equal(t.calls.length, 1);
  assert.equal(t.auth.getAuthToken(), null, 'no bearer after the refusal');
  assert.equal(t.session.getItem(MARKER_KEY), '1', 'tab-local rejection, as before');
  assert.equal(local.getItem(AUTH_KEY), before, 'shared storage is not touched by a tab-local rejection');
});

await check('an unconfirmed record (an abandoned login / Guest candidate) is never offered to the server', async () => {
  const local = storage({ [AUTH_KEY]: record() });
  const t = await freshTab(local, { requestSession: async () => userDTO() });
  const s = await t.c.reconcile();
  assert.equal(s.state, 'ANONYMOUS');
  assert.equal(t.calls.length, 0);
  assert.equal(t.auth.getAuthToken(), null);
});

await check('a confirmation of an older login does not adopt a newer record', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OTHER_OWNER });
  const t = await freshTab(local, { requestSession: async () => userDTO() });
  assert.equal((await t.c.reconcile()).state, 'ANONYMOUS');
  assert.equal(t.calls.length, 0);
});

await check('the server naming another user is a mismatch, never a sign-in', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OWNER });
  const t = await freshTab(local, { requestSession: async () => userDTO({ userId: 'user-b', sessionId: 'sess-b' }) });
  const s = await t.c.reconcile();
  assert.notEqual(s.state, 'AUTHENTICATED');
  assert.equal(s.error?.code, 'AUTH_IDENTITY_MISMATCH');
});

await check('an unverified phone is not enough to take a session back', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OWNER });
  const t = await freshTab(local, { requestSession: async () => userDTO({ phoneVerified: false }) });
  const s = await t.c.reconcile();
  assert.notEqual(s.state, 'AUTHENTICATED');
});

await check('a tab that already decided (rejected, or holding its own marker) never adopts', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OWNER });
  const rejected = await freshTab(local, { session: storage({ [MARKER_KEY]: '1' }), requestSession: async () => userDTO() });
  assert.equal(rejected.auth.adoptConfirmedAuth(), false);
  assert.equal((await rejected.c.reconcile()).state, 'ANONYMOUS');
  assert.equal(rejected.calls.length, 0);
  const foreign = await freshTab(local, { session: storage({ [MARKER_KEY]: `bound:${OTHER_OWNER}` }), requestSession: async () => userDTO() });
  assert.equal(foreign.auth.adoptConfirmedAuth(), false);
});

await check('a network failure keeps the candidate for a retry and grants nothing', async () => {
  const local = storage({ [AUTH_KEY]: record(), [CONFIRMED_KEY]: OWNER });
  const t = await freshTab(local, { requestSession: async () => { throw Object.assign(new TypeError('offline'), { code: 'NETWORK' }); } });
  const s = await t.c.reconcile();
  assert.equal(s.state, 'SESSION_UNKNOWN');
  assert.equal(t.auth.isAuthCandidate(), true, 'still only a candidate');
  assert.equal(local.getItem(CONFIRMED_KEY), OWNER);
});

await check('confirming a login names its record; the token record itself is written once', async () => {
  const local = storage();
  const t = await freshTab(local, { requestSession: async () => userDTO() });
  const writes = [];
  const rawSet = local.setItem;
  local.setItem = (k, v) => { if (k === AUTH_KEY) writes.push(v); rawSet(k, v); };
  assert.equal(t.auth.setAuth({ token: 'tok-a', userId: 'user-a', phone: '+79050000000' }), true);
  const owner = JSON.parse(local.getItem(AUTH_KEY)).ownerVersion;
  assert.equal(local.getItem(CONFIRMED_KEY), null, 'a fresh candidate is not confirmed');
  assert.equal(t.auth.commitAuthCandidate(owner), true);
  assert.equal(local.getItem(CONFIRMED_KEY), owner);
  assert.equal(writes.length, 1, 'one write to the broadcast token key');
});

if (failures.length) {
  console.error(`FAIL ${failures.length} expectation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${passed} passed; 0 failed`);
