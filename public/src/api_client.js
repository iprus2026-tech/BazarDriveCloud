// public/src/api_client.js — BD-API-CLIENT-01 / R12 of #784 (cross-device cutover).
//
// Thin, token-attaching JSON fetch wrapper over the in-repo backend (/server, ADR
// BD-DOCS-041). DARK today: imported by NOTHING, and apiFetch() throws immediately while
// the backend is OFF (isBackendEnabled() === false), so it can never make a network call
// until the cutover PRs wire it in behind the existing async seam (data_layer.js
// loadResource).
//
// On a non-2xx it rejects with ApiError carrying the server's UNIFORM problem shape
// ({ error, code, retryable } — see server/src/plugins/error-handler.js). A thrown
// ApiError is caught by the existing data_layer.js loadResource and raises the
// server_error overlay (BD-ERROR-02A) — graceful degradation, no new error plumbing.
// NOTE: today loadResource gates the «Повторить» button on whether the CALLER passes
// `onRetry`, NOT on err.retryable; wiring `retryable` -> a conditional retry is a cutover
// concern (a later epic-#784 PR), not automatic here.
//
// NO Web-Storage access — the token comes from api_config.getSessionToken() (null until R17).

import { getApiBase, isBackendEnabled, getSessionToken, API_VERSION_PREFIX } from './api_config.js';

// A failed API call. `status` is the HTTP status (0 = never sent: disabled / network /
// abort), `code` mirrors the server's machine code, `retryable` whether a retry may help.
export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', retryable = false, message } = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// Perform a JSON request against `<apiBase>/api/v1<path>`. ALWAYS resolves to the parsed
// JSON body on 2xx, or REJECTS with ApiError (never returns a non-2xx). While the backend
// is OFF this throws BACKEND_DISABLED before any fetch is attempted.
export async function apiFetch(path, { method = 'GET', body, headers, signal } = {}) {
  if (!isBackendEnabled()) {
    throw new ApiError({
      status: 0,
      code: 'BACKEND_DISABLED',
      retryable: false,
      message: 'backend is disabled (no API base configured)',
    });
  }

  // Normalize so a caller passing 'auth/session' (no leading slash) can't yield
  // '/api/v1auth/session'.
  const rel = path.startsWith('/') ? path : '/' + path;
  const url = getApiBase() + API_VERSION_PREFIX + rel;
  const token = getSessionToken();
  const finalHeaders = {
    Accept: 'application/json',
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : null),
    ...(token ? { Authorization: `Bearer ${token}` } : null),
    ...headers,
  };

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: finalHeaders,
      credentials: 'include',
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : null),
    });
  } catch (err) {
    // An intentional abort (AbortController) is terminal, not a retryable failure — keep it
    // distinct from a genuine network error.
    if (err && err.name === 'AbortError') {
      throw new ApiError({ status: 0, code: 'ABORTED', retryable: false, message: 'request aborted' });
    }
    // Network failure — request never completed.
    throw new ApiError({ status: 0, code: 'NETWORK', retryable: true, message: err && err.message });
  }

  const payload = await readBody(res);
  if (!res.ok) {
    throw new ApiError({
      status: res.status,
      code: (payload && payload.code) || `HTTP_${res.status}`,
      retryable: !!(payload && payload.retryable),
      message: (payload && payload.error) || `request failed (${res.status})`,
    });
  }
  return payload;
}

// Parse a JSON body; empty (204) -> null; a non-JSON body is surfaced as { error: <text> }
// rather than throwing, so error mapping above stays robust.
async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { error: text }; }
}

// Typed helper — the one LIVE server endpoint today: GET /api/v1/auth/session -> { user }
// (null when anonymous). The canonical example of how product reads get added later: one
// small helper per resource, all funnelled through apiFetch.
export function getSession() {
  return apiFetch('/auth/session');
}
