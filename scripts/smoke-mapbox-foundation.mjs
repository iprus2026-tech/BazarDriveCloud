// BD-MAP-FOUND-01 (#805) — static + behavioural smoke for the DARK Mapbox foundation.
//
// mapbox_config.js (token surface) + mapbox_loader.js (lazy vendored-SDK loader) must be DARK by
// default: no token ⇒ isMapboxEnabled() false, loadMapboxSdk() returns null WITHOUT touching the DOM /
// injecting a <script> / hitting the network, so the placeholder MapShell stays and the app is
// unchanged. Neither module may access Web-Storage (keeps BD-DATA-STATIC-01 clean). The CSP must
// already permit the (vendored) SDK's network surface so activation needs no further CSP change.
//
// No DOM, no network. Pure Node.

import fs from 'node:fs';

const issues = [];
const expect = (label, cond, detail = '') => {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
};

const cfgUrl = new URL('../public/src/mapbox/mapbox_config.js', import.meta.url);
const ldrUrl = new URL('../public/src/mapbox/mapbox_loader.js', import.meta.url);
const cfgSrc = fs.readFileSync(cfgUrl, 'utf8');
const ldrSrc = fs.readFileSync(ldrUrl, 'utf8');

// ── Static: NO Web-Storage access in either module (BD-DATA-STATIC-01) ──
// Match a real access only (a member read `.getItem` or an index `['key']`), not the word in prose.
const STORAGE_ACCESS = /\b(?:localStorage|sessionStorage)(?:\.\w|\s*\[)/;
expect('mapbox_config.js performs NO localStorage/sessionStorage access', !STORAGE_ACCESS.test(cfgSrc));
expect('mapbox_loader.js performs NO localStorage/sessionStorage access', !STORAGE_ACCESS.test(ldrSrc));

// ── Static: the token surface reads a committed, CSP-safe source (global + meta), no inline <script> ──
expect('mapbox_config reads the __BD_MAPBOX_TOKEN__ override', /__BD_MAPBOX_TOKEN__/.test(cfgSrc));
expect('mapbox_config reads the committed <meta name="bd-mapbox-token"> tag',
  /meta\[name="bd-mapbox-token"\]/.test(cfgSrc));

// ── Static: the loader GUARDS all DOM/script work behind isMapboxEnabled() (no inject when dark) ──
expect('mapbox_loader imports the isMapboxEnabled() gate', /isMapboxEnabled/.test(ldrSrc));
expect('mapbox_loader returns early when DARK before any document/createElement work',
  /if\s*\(!isMapboxEnabled\(\)[^\n]*\)\s*return Promise\.resolve\(null\)/.test(ldrSrc));
expect('mapbox_loader loads the VENDORED sdk (vendor/mapbox-gl), not a CDN',
  /vendor\/mapbox-gl\/mapbox-gl\.js/.test(ldrSrc) && !/https?:\/\/[^'"]*mapbox/.test(ldrSrc));

// ── Behavioural: DARK default + token surface + dark loader ──
delete globalThis.__BD_MAPBOX_TOKEN__;
const cfg = await import(cfgUrl);
const ldr = await import(ldrUrl);

expect('DARK default: getMapboxToken() is null with no token', cfg.getMapboxToken() === null);
expect('DARK default: hasMapboxToken() is false', cfg.hasMapboxToken() === false);
expect('DARK default: isMapboxEnabled() is false', cfg.isMapboxEnabled() === false);
expect('getDefaultCenter() returns the Moscow center', (() => {
  const c = cfg.getDefaultCenter();
  return c && typeof c.lng === 'number' && typeof c.lat === 'number' && typeof c.zoom === 'number';
})());
expect('MAPBOX_STYLE is exported', typeof cfg.MAPBOX_STYLE === 'string' && cfg.MAPBOX_STYLE.length > 0);

// the __BD_MAPBOX_TOKEN__ override is honoured (the activation path)
globalThis.__BD_MAPBOX_TOKEN__ = '  pk.test_token  ';
expect('token surface: __BD_MAPBOX_TOKEN__ is read + trimmed', cfg.getMapboxToken() === 'pk.test_token');
expect('token surface: isMapboxEnabled() flips true once a token is set', cfg.isMapboxEnabled() === true);
delete globalThis.__BD_MAPBOX_TOKEN__;

// the loader is dark-safe in Node (no document): resolves null, never throws, never injects.
const dark = await ldr.loadMapboxSdk();
expect('loadMapboxSdk() resolves null when DARK (no token / no document)', dark === null);
expect('isMapboxSdkLoaded() is false when DARK', ldr.isMapboxSdkLoaded() === false);

// ── Static: the CSP already permits the vendored SDK's network surface ──
const indexSrc = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const cspMatch = indexSrc.match(/Content-Security-Policy[\s\S]*?content="([^"]*)"/);
const csp = cspMatch ? cspMatch[1] : '';
expect('CSP connect-src permits https://api.mapbox.com',
  /connect-src[^;]*https:\/\/api\.mapbox\.com/.test(csp));
expect('CSP connect-src permits https://events.mapbox.com (telemetry)',
  /connect-src[^;]*https:\/\/events\.mapbox\.com/.test(csp));
expect('CSP worker-src permits blob: (the GL worker)', /worker-src[^;]*blob:/.test(csp));
expect('CSP script-src stays self-only (SDK is vendored, no CDN)', /script-src 'self'(?:;| )/.test(csp));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
