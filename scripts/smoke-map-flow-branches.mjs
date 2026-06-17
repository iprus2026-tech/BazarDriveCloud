// BD-MAP-01 / BD-MAP-02 — static regression smoke for the map-flow branch routing.
//
// The BD-AUDIT-CODEX-01 audit (#455) flagged that the /map and /location-permission
// branch destinations had no dedicated pin. CLAUDE.md route truth is explicit:
//   /map               my-location (permission state) → /location-permission
//                      route / manual                 → /route-picker
//   /location-permission  allow  → /map?state=default
//                         manual → /route-picker
//                         back   → /map
//   "Do not collapse allow and manual into the same destination."
// A refactor could silently reroute a branch (e.g. allow → /route-picker, or
// my-location skipping the permission gate) and the generic checks would not catch
// it. This script is STATIC: it reads source and asserts the contract. No browser,
// no DOM, no network.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const map = read('../public/src/screens/map.js');
const locPerm = read('../public/src/screens/location_permission.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── A. /map branch routing ──
expect('map: my-location in PERMISSION state → /location-permission',
  /action === 'my-location'[\s\S]{0,160}MAP_STATE\.PERMISSION[\s\S]{0,80}go\('\/location-permission'\)/.test(map));
expect('map: my-location (granted/non-permission) flips pref → /map?state=default',
  /saveMapPrefs\(\{ locationAllowed: true \}\)[\s\S]{0,80}go\('\/map\?state=default'\)/.test(map));
expect('map: route / manual → /route-picker',
  /action === 'route' \|\| action === 'manual'[\s\S]{0,80}go\('\/route-picker'\)/.test(map));
expect('map: nearby → /map?state=nearby',
  /action === 'nearby'[\s\S]{0,80}go\('\/map\?state=nearby'\)/.test(map));
expect('map: feed → /feed',
  /action === 'feed'[\s\S]{0,80}go\('\/feed'\)/.test(map));

// ── B. /location-permission branch routing ──
expect('loc-perm: allow → /map?state=default',
  /action === 'allow'[\s\S]{0,160}go\('\/map\?state=default'\)/.test(locPerm));
expect('loc-perm: manual → /route-picker',
  /action === 'manual'[\s\S]{0,120}go\('\/route-picker'\)/.test(locPerm));
expect('loc-perm: back → /map (exact, not the ?state=default url)',
  /action === 'back'[\s\S]{0,120}go\('\/map'\)/.test(locPerm));

// ── C. allow and manual must NOT collapse to the same destination (CLAUDE.md) ──
expect('loc-perm: allow (/map?state=default) and manual (/route-picker) are distinct destinations',
  /go\('\/map\?state=default'\)/.test(locPerm)
  && /go\('\/route-picker'\)/.test(locPerm)
  && !/action === 'allow'[\s\S]{0,120}go\('\/route-picker'\)/.test(locPerm));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
