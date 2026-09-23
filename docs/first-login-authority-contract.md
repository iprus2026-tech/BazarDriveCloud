# BD-FIRST-LOGIN-AUTHORITY-01A — First-login authority contract

Status: contract-only / draft; target obligations below are not a shipped cutover.

Gate: `BD-FIRST-LOGIN-AUTHORITY-01A-CONTRACT-R1`.

Layers: PWA / Store / Backend API / DB / Smoke / Docs.

Audited baseline: [`main@1af6af0a860b117124c1bd63ad88d687f511bb1b`](https://github.com/iprus2026-tech/BazarDriveCloud/commit/1af6af0a860b117124c1bd63ad88d687f511bb1b).

## Scope and authority

This contract specializes [Auth & Identity, BD-DOCS-032](../docs-site/docs/decisions/auth-identity.md)
for first login and session restoration. It records the audited implementation,
then defines the target authority boundary, states and acceptance cases. It does
not enable the backend, change a route, introduce an endpoint or migration, or
establish pilot readiness. The docs-site ADR remains the identity decision record;
this document owns the first-login interpretation of that decision.

The authorized file set is this contract and the ADR's shipped/target boundary.
Runtime implementation, dependency changes, GitHub metadata writes, commit,
push and PR creation require separate gates. The new legacy document remains
outside the document registry in this slice: registration is a separate scope,
and the repository currently treats `UNACCOUNTED_DOCUMENT` as warn-only.

## Audited implementation at the baseline

These are repository facts, not proof of a deployed production service:

| Surface | Shipped behavior | Missing target boundary |
| --- | --- | --- |
| `public/src/screens/welcome.js` | Start selects a local role, records `welcomeSeen`, then opens `/feed` or `/driver-map`; Login opens `/onboarding`. Permissions are UI-only. | Neither path establishes backend authentication. Welcome does not mint a bearer or set `phoneVerified`/`onboarded`. |
| `public/src/router.js`, `public/src/app.js` | First-visit routing uses `welcomeSeen`; `requireOnboarding` checks local `onboarded`. | Boot does not call the session helper to reconcile a saved bearer. |
| `public/src/screens/onboarding.js` | Backend OFF uses mock OTP. Backend ON calls OTP request/verify, holds the returned token in the draft, and persists it on completion. | The completion writes the local draft role/profile; it does not reconcile returned grants and active role. |
| `public/src/auth_token.js`, `api_config.js`, `api_client.js` | `bazardrive.auth.v1` stores bearer/userId/phone; API calls attach the bearer. `getSession()` exists. API base defaults to empty, so the PWA backend path is OFF by default. | Stored token presence is not server confirmation. The session helper is unused by boot. |
| `public/src/state.js` | `bazardrive.user.v1` holds local profile, roles and readiness flags. Legacy migration can backfill `phoneVerified`; line readiness does not require a bearer or `phoneVerified`. | These values are prototype/cache data, not verified identity, grants or protected-action readiness. |
| Guest and logout | Guest changes local role without clearing an existing bearer. `mock_auth.js` logout clears local user-scoped data. | Guest can retain an old authenticated actor; local logout does not revoke the server session. |
| `server/src/services/auth/index.js` | DB-backed OTP request/verify and session lookup exist. Verify returns token plus `userId`, `activeRole`, `phoneVerified`, `roles`. | OTP delivery/abuse controls and pilot session policy remain blocked by #824/#829. |
| `server/src/repositories/users.js`, `sessions.js`, `server/src/plugins/auth.js` | OTP creates/resolves the phone identity; sessions store token hashes and filter revoked/expired rows. New users start with empty grants. | Session lookup reads the session snapshot without current user grants/readiness. Default session TTL permits no expiry. |
| Orders/matching writes | Missing session is rejected. Offers also reject self-offers and non-open orders. | Granted-role and driver-readiness enforcement is not yet implemented; #830 owns it. |

The current `GET /api/v1/auth/session` response is `{ user: null }` or a user
containing `userId`, `sessionId`, `activeRole`, `phoneVerified`; it does not
return grants or readiness. A session lookup failure returns retryable
`503 SESSION_LOOKUP_FAILED`, rather than pretending the user is anonymous.

Opening a public/demo screen after Welcome is not evidence of a server auth
bypass. Conversely, a successful OTP does not prove role selection or driver
readiness. Existing dark driver authority modules do not establish a first-login
HTTP projection merely because their code is present.

## Source-of-truth rules

| Value | Authority and allowed use |
| --- | --- |
| `welcomeSeen` | Local UX only: whether the introduction was seen. Never authentication. |
| `onboarded` | Local UX completion only. Never proof of server profile completion. |
| Authenticated identity | Backend session resolved to the canonical account. |
| `phoneVerified` | Backend fact produced by the approved verification flow. Mock flags and legacy backfills cannot become server facts. |
| `roles` / grants | Backend account policy under #830. Client selection cannot add a grant. |
| `activeRole` | Backend session choice, constrained to the account's current grants; `null` is valid before selection. |
| Local `role` | Pre-auth intent or cache projection of confirmed `activeRole`; never an independent authority. |
| Bearer presence | A credential candidate for reconciliation, not confirmed authentication. |
| Protected-action readiness | Backend projection of current domain facts and policy. Local flags cannot grant server authority. |

`roles` belongs to the account; `activeRole` is the choice for the current
session. Existing `users.role` / `users.active_role` fields must not become a
second independent authority competing with that session choice. Their exact
compatibility/migration treatment is deferred to #830, not changed here.

Authenticated cache must be scoped to the canonical `userId`. Phone-verification
and account-switch flows must reconcile the returned account identity before
reusing profile/readiness data. A browser's old profile cannot be attached to a
different backend user simply because an OTP succeeded.

## Session and data contract — target, not the current wire schema

OTP completion and session restoration must converge on the same logical
backend snapshot before any role/readiness elevation. This does not require
the existing OTP response to grow all fields: a subsequent session read may
provide them. Neither a partial response nor cached fields may fill missing
authority silently.

| Logical data | Required meaning |
| --- | --- |
| `user.userId`, `user.phoneVerified` | Canonical account identity and verified-phone fact. |
| `user.roles`, `user.activeRole` | Current grants and confirmed session choice; non-null active role must belong to grants. Empty grants still permit `AUTHENTICATED`. |
| Session identity and expiry | Server-owned identity/lifetime under #829. Do not infer validity from a browser timestamp or token shape. |
| Profile/registration projection | Server decision and missing prerequisites for the selected role. No registration policy is invented by this first-login contract. |
| Readiness projection | Role/action-specific verdict and blocking reasons from existing domain authorities. Unknown/unavailable cannot authorize an action. |
| Snapshot correlation | A response must belong to the current account/session/request generation. Exact wire versioning is deferred to the implementation contract. |

Transport, expiry duration, rotation, revoke and logout wire behavior remain
under #829. Role enrollment/grant policy and role-selection transport remain
under #830. This slice creates no candidate HTTP route or database schema.

### Boot reconciliation and invalidation

1. With backend ON and no credential, enter `ANONYMOUS` (or explicitly chosen
   `GUEST`). Local onboarding/profile flags cannot elevate this state.
2. With a saved bearer, enter technical reconciliation pending and read the
   server session contract before enabling authenticated operations. Pending is
   not a tenth business state and must not be rendered as confirmed login.
3. A valid current response establishes `AUTHENTICATED`; advance only as far as
   the confirmed grants, role and readiness permit.
4. `{ user: null }` means anonymous. Invalidate the rejected credential and its
   authenticated cache; do not reconstruct identity from `user.v1`.
5. Retryable `503` or a network failure means reconciliation is unavailable.
   Preserve the credential for retry, keep protected actions blocked and show a
   recoverable state. Do not silently log out or fall back to mock auth.
6. Logout, account switch, Guest entry or a changed credential invalidates the
   previous request generation. Late OTP/session/readiness responses from that
   generation must neither persist a token nor restore identity, role or cache.
   The same boundary applies when another tab changes the shared auth record.
7. Explicit Guest entry must detach the authenticated actor and prevent bearer
   attachment to Guest requests. Drop pending OTP credentials and authenticated
   projections. Server revoke completion/retry semantics remain under #829;
   local cleanup must never be reported as confirmed server revocation.
8. A rejected session during later API use follows the same auth invalidation
   boundary. A role/readiness denial is not automatically a logout: refresh the
   relevant projection. Server errors must not become successful local writes.

Local cancellation or abort is not sufficient protection from an already
completed old request: applying its result must also check the current generation.
Cached authenticated content may be presented only with its stale/unconfirmed
status; it cannot enable protected actions while reconciliation is unresolved.

## First-login states — target semantics

These names describe the most specific confirmed first-login state. They do not
replace order/ride, document, vehicle, shift or Presence state machines.

| State | Entry condition | Authority limit |
| --- | --- | --- |
| `ANONYMOUS` | No confirmed backend session. | Public access only; Welcome does not elevate it. |
| `GUEST` | Explicit unauthenticated browsing choice with no attached authenticated actor. | Guest is not a grant or an authenticated role. |
| `OTP_PENDING` | Backend accepted an OTP request bound to the intended phone/current login attempt; verification is incomplete. | No authenticated authority from requesting or typing a code. |
| `AUTHENTICATED` | Current backend session confirms identity. | No assumption that a role is granted/selected or that a profile is ready. |
| `ROLE_SELECTED` | Backend confirms a non-null session active role in current grants. | Readiness remains unconfirmed until its projection arrives. |
| `PASSENGER_READY` | Passenger role plus an affirmative backend passenger-readiness verdict. | Each protected mutation still enforces its server policy. |
| `DRIVER_PROFILE_INCOMPLETE` | Driver role plus a backend projection identifying incomplete driver registration/profile prerequisites. | No driver protected-action readiness. Unavailable projection is not evidence of incomplete profile. |
| `DRIVER_REGISTERED` | Backend confirms driver registration; current line readiness has not been affirmed. | Registration alone does not permit going online or accepting work. |
| `DRIVER_LINE_READY` | Backend affirms current driver line eligibility from the relevant authorities. | Not ONLINE, not an OPEN-shift command, not a ride assignment; per-action server checks remain required. |

Main progression:

```text
ANONYMOUS / GUEST -> OTP_PENDING -> AUTHENTICATED -> ROLE_SELECTED
ROLE_SELECTED -> PASSENGER_READY
ROLE_SELECTED -> DRIVER_PROFILE_INCOMPLETE -> DRIVER_REGISTERED -> DRIVER_LINE_READY
```

Returning users may restore directly to the state supported by a complete
current snapshot; wizard screens need not be replayed. An authenticated account
with empty grants remains `AUTHENTICATED`, even when the UI has a driver intent.
How it obtains a grant is #830's enrollment policy, not an implicit transition
from role selection. A profile that is already complete may skip incomplete
states only on server evidence.

OTP expiry/cancellation does not authenticate. Loss of readiness demotes to the
state justified by current server facts; revoked grants remove the affected
role; an invalid session returns to `ANONYMOUS`. Read failures instead suspend
protected operations while retaining the last snapshot as unconfirmed cache.
Changing first-login state never silently closes a shift or mutates a ride.

Driver eligibility consumes the existing
[document compliance](driver-document-compliance-contract.md),
[vehicle assignment](driver-vehicle-assignment-authority-contract.md) and
[shift authority](driver-shift-authority-contract.md) contracts. A local checkbox,
`uploaded` or `review_required` is not an affirmative backend compliance verdict.
`DRIVER_LINE_READY` must not collapse compliance, shift, Presence and occupancy
into one writable flag.

## Role policy and demo separation

- Choosing passenger/driver in UI records intent; it never issues a grant.
- Only #830's server policy grants roles and accepts a session role choice.
  A grant request/enrollment decision is separate from choosing an existing role.
- Wrong-role protected mutations must fail server-side even if the client
  bypasses routing or sends altered local flags. The operation must also enforce
  ownership and current readiness where required; a prior snapshot is not a
  reusable authorization permit.
- Backend OFF is an explicit demo/prototype mode. Its OTP, `phoneVerified`,
  `onboarded`, role and readiness values are simulated UX data and must never be
  presented as backend-confirmed states from the table above.
- Switching OFF -> ON requires server authentication/reconciliation. Mock
  profile/role/document flags cannot be promoted or uploaded as verified facts.
- Backend ON never falls back to demo authentication after `401`, `403`, `503`,
  timeout or malformed response. API configuration/CSP activation is a separate
  gate; this contract does not change the OFF default.

## Existing issue ownership and reconciliation

| Existing issue | Boundary retained by this contract |
| --- | --- |
| [#445 — Welcome](https://github.com/iprus2026-tech/BazarDriveCloud/issues/445) | UI/demo scope. Merged Welcome PRs #447/#448 do not establish auth or real permission grants. |
| [#585 — Auth & Identity](https://github.com/iprus2026-tech/BazarDriveCloud/issues/585) | Canonical account, server phone verification and identity ownership; ADR BD-DOCS-032 remains its decision record. |
| [#784 — Backend cutover](https://github.com/iprus2026-tech/BazarDriveCloud/issues/784) | OTP and the guarded frontend bearer path already shipped in #788/#799. Old pending checklist entries must not be read as evidence that this code is absent. Full cutover is still separate. |
| [#797 — Deploy/go-live](https://github.com/iprus2026-tech/BazarDriveCloud/issues/797) | Deployment, origins, CSP/CORS and SMS decisions. Merged auth code does not prove production activation. |
| [#820 — Backend pilot](https://github.com/iprus2026-tech/BazarDriveCloud/issues/820) | Pilot coordination; first-login contract approval does not clear pilot blockers. |
| [#824 — OTP hardening](https://github.com/iprus2026-tech/BazarDriveCloud/issues/824) | Real delivery, no production code echo, per-phone/IP abuse controls. Existing per-code attempt caps are insufficient. |
| [#829 — Session lifecycle](https://github.com/iprus2026-tech/BazarDriveCloud/issues/829) | Transport, expiry/rotation/revocation, logout and session restore. A retryable lookup failure remains distinct from anonymous. |
| [#830 — Auth policy](https://github.com/iprus2026-tech/BazarDriveCloud/issues/830) | Grants, session role choice, protected mutations and driver readiness. First-login UI cannot substitute for this enforcement. |
| [#893 — Staging readiness](https://github.com/iprus2026-tech/BazarDriveCloud/issues/893) | Planning/readiness evidence; this draft does not authorize deployment or backend activation. |

These are references and ownership reconciliation only. This gate does not
change, comment on or close any issue, and does not claim their blockers resolved.

## Acceptance and smoke plan

The following are acceptance requirements for future implementation, not tests
implemented or executed by this docs-only slice:

| Case | Required result |
| --- | --- |
| Fresh install; Welcome Start with either role | UX progresses without issuing authenticated identity, a grant or readiness. |
| Backend OFF mock OTP; later backend ON | Simulated flags cannot restore server authentication. |
| OTP wrong/expired/reused; cancelled or replaced attempt | No session elevation; old completions cannot install credentials. |
| Successful OTP with empty grants | `AUTHENTICATED` only; no implicit passenger/driver grant. |
| Boot with valid token and complete snapshot | Restore the confirmed account, role and supported readiness. |
| Expired/revoked/unknown token; `{ user: null }` | Anonymous, rejected bearer and authenticated projection invalidated. |
| Boot lookup `503`, offline or timeout | Retryable/unconfirmed state, protected actions blocked, no mock fallback or silent logout. |
| Logout/account switch/Guest during OTP or session read | Late completion cannot restore old token, role, profile or readiness. |
| Auth changes in another tab; verification returns another userId | Invalidate stale generation and prevent cross-account cache reuse. |
| Guest entered with an existing bearer | Guest requests carry no old authenticated authority; revoke outcome follows #829. |
| Tampered local role/readiness; direct wrong-role API mutation | Server denies operation under #830 regardless of UI gates. |
| Revoked role, incomplete/expired documents, unavailable readiness | No protected-action elevation; current backend/domain verdict governs. |
| Registered driver or OPEN shift without full eligibility | Neither registration nor shift alone implies line readiness or ONLINE. |
| Public navigation after failed auth | Remains possible only within the public/Guest boundary; no protected writes. |

Future UI integration must also cover actual navigation, console errors,
overflow/clipping and touch targets at 320/360/390/430 px and desktop. Browser
checks and PostgreSQL mutation/integration tests are outside this gate.

For this contract-only change, validation is the repository-required docs
frontmatter/registry/self/navigation checks and build, followed by
`node scripts/check.mjs`, `node scripts/dispatcher.mjs` and `git diff --check`.
Existing smoke success does not prove the target auth contract is implemented.

## Implementation and release boundary

Follow-up work proceeds through audit, backend/data contract, state-machine and
authority agreement, UI/runtime integration, store/backend reconciliation,
smoke/check evidence, then docs sync. These are separately scoped gates, not a
combined auth/runtime/deployment PR. No endpoint, grant policy or registration
criterion still owned by #824/#829/#830 may be invented inside a UI slice.

Release impact of this document: docs/reference only; no user-visible runtime,
configuration, migration, service-worker, cache-strategy or dependency change.
