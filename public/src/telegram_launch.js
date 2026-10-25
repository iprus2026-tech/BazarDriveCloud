// BD-TG-MINIAPP-01 M1 (#1126) — Telegram Mini App launch capture.
// Contract: docs/telegram-mini-app-contract.md, section "M1 — launch capture".
//
// Telegram opens the Mini App with its launch params in the URL hash
// (#tgWebAppData=…&tgWebAppVersion=…&tgWebAppPlatform=…). The hash router would read
// that as a path: on a first run it redirects to /welcome and the params are lost.
// app.js imports this module FIRST, so the capture runs before router.js and before
// start(). The module imports nothing.
//
// - A Telegram launch keeps the launch environment and the raw initData per tab, in
//   sessionStorage only. It then rewrites the hash once, with replaceState, to an
//   allowlisted startapp route (or /feed). The router's guards apply unchanged.
// - A reload reads the stored environment back. Nothing is captured again.
// - Outside Telegram the module writes nothing and rewrites nothing.
//
// Raw initData handling, as an invariant:
// - It is never logged, never written to localStorage, never placed back in the URL
//   and never sent anywhere from here.
// - Only BD-AUTH-TELEGRAM-01 (#1127) reads it.
// - The client never parses its fields for display or decisions. The only exception
//   is start_param, used to pick a route.

const LAUNCH_KEY = 'bazardrive.tg_launch.v1';
const INIT_DATA_KEY = 'bazardrive.tg_init_data.v1';

const DEFAULT_ROUTE = '/feed';
const START_ROUTES = Object.freeze({
  feed: '/feed',
  map: '/map',
  rules: '/rules',
  profile: '/profile',
});
const POST_START = /^post_([A-Za-z0-9_-]{1,64})$/;
const START_PARAM = /^[A-Za-z0-9_-]{1,512}$/;
const VERSION = /^\d{1,3}(?:\.\d{1,3}){0,3}$/;
const PLATFORM = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_INIT_DATA = 16384;

let launch = null;
// This page load's copy, for when sessionStorage is unavailable. Cleared with the stored one.
let initDataInMemory = null;

// The route for a startapp value: an allowlist entry, otherwise the default route.
export function routeForStartParam(param) {
  if (typeof param !== 'string') return DEFAULT_ROUTE;
  if (Object.prototype.hasOwnProperty.call(START_ROUTES, param)) return START_ROUTES[param];
  const post = POST_START.exec(param);
  return post ? `/post?id=${post[1]}` : DEFAULT_ROUTE;
}

// tgWebAppStartParam (the GET param) first, else start_param inside initData. Kept only if
// it has the shape Telegram allows; it is used to pick a route and nothing else.
function readStartParam(search, initData) {
  let value = null;
  try {
    value = new URLSearchParams(typeof search === 'string' ? search : '').get('tgWebAppStartParam');
    if (!value) value = new URLSearchParams(initData).get('start_param');
  } catch {
    value = null;
  }
  return value && START_PARAM.test(value) ? value : null;
}

// Launch params from '#params' or '#path?params' (the official SDK accepts both). Returns
// null when the hash is not a well-formed Telegram launch; the router then sees it as today.
function readLaunchParams(hash, search) {
  let raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const q = raw.indexOf('?');
  if (q >= 0) raw = raw.slice(q + 1);
  if (!raw.includes('tgWebAppData=')) return null;
  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const initData = params.get('tgWebAppData');
  const version = params.get('tgWebAppVersion') || '';
  const platform = params.get('tgWebAppPlatform') || '';
  if (!initData || initData.length > MAX_INIT_DATA) return null;
  if (!VERSION.test(version) || !PLATFORM.test(platform)) return null;
  return { initData, version, platform, startParam: readStartParam(search, initData) };
}

function readStoredLaunch() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const stored = JSON.parse(sessionStorage.getItem(LAUNCH_KEY) || 'null');
    if (!stored || stored.v !== 1) return null;
    if (!VERSION.test(String(stored.version)) || !PLATFORM.test(String(stored.platform))) return null;
    const startParam = typeof stored.startParam === 'string' && START_PARAM.test(stored.startParam)
      ? stored.startParam : null;
    return Object.freeze({ version: stored.version, platform: stored.platform, startParam });
  } catch {
    return null;
  }
}

// The two records are written as one: if either write fails, both are dropped. Otherwise a reload
// could pair this launch with an older tab's initData (or the reverse). This page load keeps its
// in-memory copy.
function storeLaunch(env, initData) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(LAUNCH_KEY, JSON.stringify({ v: 1, ...env, capturedAt: Date.now() }));
    sessionStorage.setItem(INIT_DATA_KEY, initData);
  } catch {
    try { sessionStorage.removeItem(LAUNCH_KEY); } catch { /* storage unavailable */ }
    try { sessionStorage.removeItem(INIT_DATA_KEY); } catch { /* storage unavailable */ }
  }
}

// One rewrite, no new history entry. The hash never carries tgWebAppData again. This runs while
// app.js is being imported, so a throwing replaceState (a restricted WebView, a rate limit) falls
// back to a hash assignment and never aborts the import.
function restoreRoute(target) {
  const loc = globalThis.location;
  const hist = globalThis.history;
  try {
    if (hist && typeof hist.replaceState === 'function') {
      hist.replaceState(null, '', `${loc.pathname || ''}${loc.search || ''}#${target}`);
      return;
    }
  } catch {
    // fall through to the hash assignment
  }
  try {
    loc.hash = target;
  } catch {
    // leave the hash as it is; the router still renders its fallback
  }
}

function capture() {
  const loc = globalThis.location;
  const params = loc ? readLaunchParams(loc.hash, loc.search) : null;
  if (!params) {
    launch = readStoredLaunch();
    initDataInMemory = null;
    return launch;
  }
  const { initData, ...env } = params;
  launch = Object.freeze(env);
  initDataInMemory = initData;
  storeLaunch(env, initData);
  restoreRoute(routeForStartParam(env.startParam));
  return launch;
}

// Runs once at import (below). Exported so the smoke can drive it with fake globals. It never
// throws: a failure here must not stop app.js from loading.
export function captureTelegramLaunch() {
  try {
    return capture();
  } catch {
    launch = null;
    initDataInMemory = null;
    return null;
  }
}

// { version, platform, startParam } of this tab's Telegram launch, or null outside Telegram.
export function getTelegramLaunch() {
  return launch;
}

// The raw initData string for BD-AUTH-TELEGRAM-01 (#1127), or null. This page load's own capture
// wins over the stored copy, which only serves a reload.
export function getTelegramInitData() {
  if (!launch) return null;
  if (initDataInMemory) return initDataInMemory;
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(INIT_DATA_KEY);
  } catch {
    return null;
  }
}

// Called by the auth flow on every logout and local reset (mock_auth.resetLocalSession), so a
// logout never leads to a silent re-sign-in in the same tab. The launch environment stays.
export function clearTelegramInitData() {
  initDataInMemory = null;
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(INIT_DATA_KEY);
  } catch {
    // fail soft — same posture as the other session-scoped stores.
  }
}

captureTelegramLaunch();
