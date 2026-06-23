// BD-OPS / #684 #3 — ScreenOps registry↔contract variant-coverage guard.
//
// #722 gave the ScreenOps registry an optional `variants` fact: a screen's role-keyed
// render paths (e.g. /profile = guest | passenger | driver). This guard pins that every
// declared variant stays DOCUMENTED in docs/screen-contracts.md, within that screen's
// own contract region — catching the drift class that left the guest variant invisible
// to the contract (the #721 finding). It does NOT demand a particular doc shape, only
// that a registry-declared render path is not silently undocumented.
//
// Pure static text analysis: no DOM, no network, no runtime import of screen modules —
// it only reads the in-memory registry data + the contract markdown.

import fs from 'node:fs';
import { getScreens } from '../public/src/ops/ops_registry.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const contracts = read('../docs/screen-contracts.md');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A markdown `### ` section from its heading to the next `### ` (mirrors the
// smoke-order-detail-contract helper).
function sectionBody(source, heading) {
  const start = source.indexOf(heading);
  if (start === -1) return '';
  const after = source.indexOf('\n### ', start + heading.length);
  return after === -1 ? source.slice(start) : source.slice(start, after);
}

// Every index-table row (and inner `| Route | … |` row) that names a token.
function extractRows(src, token) {
  const re = new RegExp(`\\|[^\\n]*${escapeRegExp(token)}[^\\n]*\\|[^\\n]*`, 'gi');
  return (src.match(re) || []).join('\n');
}

// 'BD-PROFILE-01' -> 'BD-PROFILE' (the contract id family that groups the per-role
// sub-sections BD-PROFILE-01 / BD-PROFILE-02).
function idFamily(id) {
  return String(id).replace(/-\d+[A-Za-z]?$/, '');
}

// The screen's contract region: every `### ` section whose heading carries the id
// family, plus any table row that names the route or the id family.
function contractRegion(screen) {
  const fam = idFamily(screen.id);
  const sections = [...contracts.matchAll(/^### .+$/gm)]
    .map((m) => m[0])
    .filter((h) => h.includes(fam))
    .map((h) => sectionBody(contracts, h))
    .join('\n\n');
  const rows = [screen.route, fam]
    .filter(Boolean)
    .map((t) => extractRows(contracts, t))
    .join('\n');
  return sections + '\n' + rows;
}

// A variant is "documented" if its key, label, or render anchor appears in the region.
// Unicode-safe left boundary: JS `\b` is ASCII-only, so `\bГость` never matches a
// Cyrillic label (#684 #3 review). A negative look-behind on Unicode letters/numbers is
// a real word-start for both the Latin keys/anchors and the Cyrillic labels.
function variantDocumented(region, v) {
  return [v.key, v.label, v.anchor]
    .filter(Boolean)
    .some((t) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t)}`, 'iu').test(region));
}

const screens = getScreens();
const withVariants = screens.filter((s) => Array.isArray(s.variants) && s.variants.length);

expect('the guard has at least one variant-bearing screen to check',
  withVariants.length >= 1, `${withVariants.length} screen(s)`);

for (const s of withVariants) {
  const region = contractRegion(s);
  expect(`${s.id}: a contract region resolves in screen-contracts.md`, region.trim().length > 0);
  for (const v of (s.variants || [])) {
    expect(`${s.id}: variant '${v.key}' (${v.label}) is documented in the contract`,
      variantDocumented(region, v),
      `key/label/anchor: ${[v.key, v.label, v.anchor].filter(Boolean).join(' | ')}`);
  }
}

// Non-vacuity self-test — a green run must mean real coverage, not an always-true
// matcher: a fabricated variant must read UNDOCUMENTED, a real one DOCUMENTED.
{
  const profile = screens.find((s) => s.id === 'BD-PROFILE-01');
  const region = profile ? contractRegion(profile) : '';
  expect('self-test: a fabricated variant key reads as UNDOCUMENTED',
    !!profile && !variantDocumented(region, { key: 'zzfleetmanager', label: 'Флот-менеджер', anchor: 'renderFleet' }));
  expect('self-test: the real guest variant reads as DOCUMENTED',
    !!profile && variantDocumented(region, { key: 'guest', label: 'Гость', anchor: 'renderGuest' }));
  // Unicode-safety regression pin (#684 #3 review): a Cyrillic-only label must match
  // (an ASCII `\b` would miss it), and a Cyrillic label embedded mid-word must not.
  expect('self-test: a Cyrillic-only label is matched (Unicode-safe boundary)',
    variantDocumented('показывает Гость prompt', { label: 'Гость' }));
  expect('self-test: a Cyrillic label embedded in a larger word is NOT matched',
    !variantDocumented('предГостьслово', { label: 'Гость' }));
}

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
