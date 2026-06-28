// BD-API-CLIENT-01 / R12 of #784 — cross-device backend seam guard (api_config + api_client).
//
// The two new modules (public/src/api_config.js, api_client.js) are the DARK seam to the
// in-repo backend. They touch no DOM and no Web-Storage, so this guard both STATICALLY
// pins the storage-gate invariant and BEHAVIOURALLY imports + exercises them in Node with a
// stubbed fetch. Asserts: default OFF; apiFetch throws BACKEND_DISABLED (before any fetch)
// while OFF; correct URL/headers/credentials when ON; non-2xx maps to the server's uniform
// { error, code, retryable } shape; ApiError carries status/code/retryable; and NEITHER
// module reads localStorage/sessionStorage (so BD-DATA-STATIC-01 stays clean — no new key).
//
// No network, no DOM. Pure Node.

import fs from 'node:fs';

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

const cfgUrl = new URL('../public/src/api_config.js', import.meta.url);
const cliUrl = new URL('../public/src/api_client.js', import.meta.url);
const cfgSrc = fs.readFileSync(cfgUrl, 'utf8');
const cliSrc = fs.readFileSync(cliUrl, 'utf8');

// ── Static: the BD-DATA-STATIC-01 invariant — neither module ACCESSES Web-Storage ──
// Match a real access only — a member read (`.getItem`) or an index (`['key']`) — so the
// guard pins behaviour, not the words in prose comments (e.g. a sentence ending
// "…on localStorage." must NOT trip it). `.\w` excludes a sentence-ending period.
const STORAGE_ACCESS = /\b(?:localStorage|sessionStorage)(?:\.\w|\s*\[)/;
expect('api_config.js performs NO localStorage/sessionStorage access',
  !STORAGE_ACCESS.test(cfgSrc));
expect('api_client.js performs NO localStorage/sessionStorage access',
  !STORAGE_ACCESS.test(cliSrc));
expect('api_config exposes the /api/v1 prefix constant',
  /API_VERSION_PREFIX\s*=\s*['"]\/api\/v1['"]/.test(cfgSrc));
expect('api_client builds the URL from API_VERSION_PREFIX (not a re-hardcoded path)',
  /API_VERSION_PREFIX/.test(cliSrc));
expect('api_client has the Authorization: Bearer attach path',
  /Authorization/.test(cliSrc) && /Bearer/.test(cliSrc));

// ── Behavioural: import the pure modules and exercise the contract ──
delete globalThis.__BD_API_BASE__;
const cfg = await import(cfgUrl);
const cli = await import(cliUrl);

expect('default OFF: isBackendEnabled() is false with no override', cfg.isBackendEnabled() === false);
expect('default OFF: getApiBase() is empty', cfg.getApiBase() === '');
expect('getSessionToken() is null (dark token source, no storage)', cfg.getSessionToken() === null);
expect('API_VERSION_PREFIX === /api/v1', cfg.API_VERSION_PREFIX === '/api/v1');

// apiFetch must throw BACKEND_DISABLED *before* any fetch while OFF.
globalThis.fetch = () => { throw new Error('fetch must NOT be called while the backend is OFF'); };
let offErr = null;
try { await cli.apiFetch('/auth/session'); } catch (e) { offErr = e; }
expect('apiFetch rejects with ApiError BACKEND_DISABLED (status 0) while OFF',
  offErr instanceof cli.ApiError && offErr.code === 'BACKEND_DISABLED' && offErr.status === 0);

// Turn the backend ON via the override (trailing slash on purpose to test trimming).
globalThis.__BD_API_BASE__ = 'https://api.example.com/';
expect('isBackendEnabled() is true once an API base is set', cfg.isBackendEnabled() === true);
expect('getApiBase() trims the trailing slash', cfg.getApiBase() === 'https://api.example.com');

let captured = null;
globalThis.fetch = async (url, opts) => {
  captured = { url, opts };
  return { ok: true, status: 200, async text() { return JSON.stringify({ user: null }); } };
};
const okBody = await cli.apiFetch('/auth/session');
expect('ON: targets <base>/api/v1<path>',
  !!captured && captured.url === 'https://api.example.com/api/v1/auth/session', captured && captured.url);
expect('ON: sends Accept: application/json', !!captured && captured.opts.headers.Accept === 'application/json');
expect('ON: credentials: include', !!captured && captured.opts.credentials === 'include');
expect('ON: NO Authorization header while token is null', !!captured && !('Authorization' in captured.opts.headers));
expect('ON: 2xx returns the parsed JSON body', okBody && okBody.user === null);

// Non-2xx maps to ApiError carrying the server's uniform { error, code, retryable } shape.
globalThis.fetch = async () => ({
  ok: false, status: 503,
  async text() { return JSON.stringify({ error: 'session lookup failed', code: 'SESSION_LOOKUP_FAILED', retryable: true }); },
});
let upErr = null;
try { await cli.getSession(); } catch (e) { upErr = e; }
expect('non-2xx maps to ApiError with the server code + retryable',
  upErr instanceof cli.ApiError && upErr.status === 503 && upErr.code === 'SESSION_LOOKUP_FAILED' && upErr.retryable === true);

// A network throw becomes a retryable status-0 NETWORK ApiError (not an unhandled throw).
globalThis.fetch = async () => { throw new Error('boom'); };
let netErr = null;
try { await cli.apiFetch('/auth/session'); } catch (e) { netErr = e; }
expect('a fetch throw becomes ApiError NETWORK (status 0, retryable)',
  netErr instanceof cli.ApiError && netErr.code === 'NETWORK' && netErr.status === 0 && netErr.retryable === true);

// An intentional abort is terminal — ABORTED, NOT a retryable NETWORK error.
globalThis.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
let abortErr = null;
try { await cli.apiFetch('/auth/session'); } catch (e) { abortErr = e; }
expect('an AbortError maps to ApiError ABORTED (status 0, NOT retryable)',
  abortErr instanceof cli.ApiError && abortErr.code === 'ABORTED' && abortErr.status === 0 && abortErr.retryable === false);

// A path missing the leading slash is normalized (never '<base>/api/v1auth/...').
let capPath = null;
globalThis.fetch = async (url) => { capPath = url; return { ok: true, status: 200, async text() { return '{}'; } }; };
await cli.apiFetch('auth/session');
expect('a leading-slash-less path is normalized to <base>/api/v1/auth/session',
  capPath === 'https://api.example.com/api/v1/auth/session', capPath);

// ApiError shape.
const sample = new cli.ApiError({ status: 400, code: 'VALIDATION', retryable: false, message: 'x' });
expect('ApiError carries status/code/retryable and name=ApiError',
  sample.status === 400 && sample.code === 'VALIDATION' && sample.retryable === false && sample.name === 'ApiError');

// Don't leak the override (each smoke runs in its own process, but be tidy).
delete globalThis.__BD_API_BASE__;

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
