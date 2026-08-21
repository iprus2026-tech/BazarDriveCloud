// BD-PWA-SW-CONTRACT-01 — hermetic node:test coverage for the SW cache
// revision contract. No git, DOM, network, or process mutation.

import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SW_PATH,
  cacheNameDerivesFromVersion,
  evaluateSwCacheContract,
  parsePrecacheRepoPaths,
  parseSwVersion,
  splitNulPaths,
} from '../scripts/lib/sw-cache-contract.mjs';

function swSource({
  version = 'v305',
  precache = ['./', './src/app.js'],
  includeVersion = true,
  derivedCacheName = true,
} = {}) {
  return [
    includeVersion ? `const VERSION = '${version}';` : '',
    derivedCacheName
      ? 'const CACHE_NAME = `bazardrive-${VERSION}`;'
      : "const CACHE_NAME = 'bazardrive-fixed';",
    'const PRECACHE = [',
    ...precache.map((entry) => `  '${entry}',`),
    '];',
  ].filter(Boolean).join('\n');
}

function evaluate({ base = 'v305', head = 'v305', cached = false } = {}) {
  return evaluateSwCacheContract({
    baseSource: swSource({ version: base }),
    headSource: swSource({ version: head }),
    changedPaths: cached ? ['public/src/app.js'] : ['scripts/readme-note.mjs'],
  });
}

test('current public/sw.js owns a valid VERSION/CACHE_NAME/PRECACHE contract', () => {
  const current = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const result = evaluateSwCacheContract({
    baseSource: current,
    headSource: current,
    changedPaths: [],
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.match(result.baseVersion, /^v\d+$/);
  assert.equal(result.headVersion, result.baseVersion);
  assert.equal(cacheNameDerivesFromVersion(current), true);
});

test('parseSwVersion requires exactly one strict v<number> literal', () => {
  assert.deepEqual(parseSwVersion(swSource()), { raw: 'v305', number: 305n });
  for (const version of ['305', 'v-1', 'v1.2', 'vx']) {
    assert.throws(() => parseSwVersion(swSource({ version })), /must match/);
  }
  assert.throws(() => parseSwVersion(swSource({ includeVersion: false })), /exactly one/);
  assert.throws(() => parseSwVersion(swSource() + "\nconst VERSION = 'v306';"), /found 2/);
});

test('parsePrecacheRepoPaths maps app root and module URLs to repo paths', () => {
  assert.deepEqual(parsePrecacheRepoPaths(swSource()), [
    'public/index.html',
    'public/src/app.js',
  ]);
  assert.throws(() => parsePrecacheRepoPaths("const VERSION = 'v1';"), /exactly one/);
  assert.throws(() => parsePrecacheRepoPaths(swSource({ precache: [] })), /at least one/);
});

for (const row of [
  { base: 'v305', head: 'v305', cached: true, ok: false, label: 'same version + cached change' },
  { base: 'v305', head: 'v304', cached: true, ok: false, label: 'one-step rollback + cached change' },
  { base: 'v305', head: 'v1', cached: true, ok: false, label: 'large rollback + cached change' },
  { base: 'v305', head: 'v306', cached: true, ok: true, label: 'forward bump + cached change' },
  { base: 'v305', head: 'v305', cached: false, ok: true, label: 'same version + no cached change' },
  { base: 'v305', head: 'v306', cached: false, ok: true, label: 'version-only forward bump' },
  { base: 'v305', head: 'v304', cached: false, ok: false, label: 'rollback without cached change' },
]) {
  test(`acceptance matrix: ${row.label}`, () => {
    const result = evaluate(row);
    assert.equal(result.ok, row.ok, result.errors.join('\n'));
  });
}

test('missing or malformed head VERSION fails even when no cached file changed', () => {
  const missing = evaluateSwCacheContract({
    baseSource: swSource(),
    headSource: swSource({ includeVersion: false }),
    changedPaths: [],
  });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join('\n'), /exactly one/);

  const malformed = evaluateSwCacheContract({
    baseSource: swSource(),
    headSource: swSource({ version: 'not-a-version' }),
    changedPaths: [],
  });
  assert.equal(malformed.ok, false);
  assert.match(malformed.errors.join('\n'), /must match/);
});

test('head CACHE_NAME must derive from VERSION', () => {
  const result = evaluateSwCacheContract({
    baseSource: swSource(),
    headSource: swSource({ derivedCacheName: false }),
    changedPaths: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /CACHE_NAME must derive/);
});

test('base + head PRECACHE union catches changed entries removed in head', () => {
  const result = evaluateSwCacheContract({
    baseSource: swSource({ precache: ['./src/app.js'] }),
    headSource: swSource({ precache: ['./src/other.js'] }),
    changedPaths: ['public/src/app.js'],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.cachedPaths, ['public/src/app.js']);
});

test('public/vendor is guarded while sw.js itself is excluded', () => {
  const vendor = evaluateSwCacheContract({
    baseSource: swSource(),
    headSource: swSource(),
    changedPaths: ['public/vendor/mapbox-gl.js'],
  });
  assert.equal(vendor.ok, false);
  assert.deepEqual(vendor.cachedPaths, ['public/vendor/mapbox-gl.js']);

  const swOnly = evaluateSwCacheContract({
    baseSource: swSource(),
    headSource: swSource(),
    changedPaths: [SW_PATH],
  });
  assert.equal(swOnly.ok, true, swOnly.errors.join('\n'));
  assert.deepEqual(swOnly.cachedPaths, []);
});

test('NUL path parsing preserves both sides exposed by --no-renames', () => {
  assert.deepEqual(
    splitNulPaths('public/src/old.js\0public/src/new.js\0'),
    ['public/src/old.js', 'public/src/new.js'],
  );
});

test('contract failure reports the base, head, and rollback reason', () => {
  const result = evaluate({ base: 'v305', head: 'v1', cached: true });
  assert.equal(result.baseVersion, 'v305');
  assert.equal(result.headVersion, 'v1');
  assert.match(result.errors.join('\n'), /VERSION rollback/);
});
