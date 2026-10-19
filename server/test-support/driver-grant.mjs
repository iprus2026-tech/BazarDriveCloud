// /server/test-support/driver-grant.mjs — shared DB-gated test helper (BD-RIDE-AUTHORITY-01B-A).
// Every OTP login creates a passenger-only account (repositories/users.js resolveVerifiedLoginUser)
// and no API grants the driver role yet (#1042 / #830), so suites that create offers over HTTP
// grant it in SQL. Both sides are written: the account grant (users.roles / active_role), which
// POST /matching/offers re-reads as the CURRENT grant, and the live sessions' active_role, which
// carries the role the session was minted with. It lives OUTSIDE test/ on purpose: node --test
// treats every file under a test/ directory as a test file, so it would inflate the test count.

// Grant the driver role to an OTP-minted session ({ token, user: { userId } }).
export async function grantDriverRole(db, session, { roles = ['passenger', 'driver'], activeRole = 'driver' } = {}) {
  const userId = session?.user?.userId;
  if (!userId) throw new Error('grantDriverRole: session.user.userId is required');
  await db.query('UPDATE users SET roles = $2::text[], active_role = $3 WHERE id = $1', [userId, roles, activeRole]);
  await db.query('UPDATE auth_session SET active_role = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, activeRole]);
  return session;
}
