// BD-PWA-SW-CONTRACT-01 — pure Service Worker cache-revision contract.
//
// This module deliberately has no git, filesystem, network, or process-exit
// side effects. The CLI guard supplies source snapshots + changed repo paths;
// node:test can therefore exercise the full decision matrix hermetically.

export const SW_PATH = 'public/sw.js';

function normalizeRepoPath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '');
}

export function splitNulPaths(output) {
  return String(output || '')
    .split('\0')
    .filter(Boolean)
    .map(normalizeRepoPath);
}

export function parseSwVersion(source, { label = SW_PATH } = {}) {
  if (typeof source !== 'string') {
    throw new TypeError(`${label} source must be a string`);
  }

  const assignments = [...source.matchAll(/const\s+VERSION\s*=\s*'([^']+)'/g)];
  if (assignments.length !== 1) {
    throw new Error(`${label} must contain exactly one const VERSION = 'v<number>' assignment (found ${assignments.length})`);
  }

  const raw = assignments[0][1];
  const match = /^v(\d+)$/.exec(raw);
  if (!match) {
    throw new Error(`${label} VERSION '${raw}' must match /^v\\d+$/`);
  }

  return { raw, number: BigInt(match[1]) };
}

// PRECACHE entries are './…' URLs relative to public/. Map them to repo paths
// so a base/head union can be intersected with git's changed-path set. A bare
// './' is the app-shell index document.
export function parsePrecacheRepoPaths(source, { label = SW_PATH } = {}) {
  if (typeof source !== 'string') {
    throw new TypeError(`${label} source must be a string`);
  }

  const blocks = [...source.matchAll(/const\s+PRECACHE\s*=\s*\[([\s\S]*?)\]/g)];
  if (blocks.length !== 1) {
    throw new Error(`${label} must contain exactly one const PRECACHE = […] declaration (found ${blocks.length})`);
  }

  const paths = [];
  for (const match of blocks[0][1].matchAll(/'(\.\/[^']*)'/g)) {
    const relative = match[1].replace(/^\.\//, '');
    paths.push('public/' + (relative === '' ? 'index.html' : relative));
  }
  if (!paths.length) {
    throw new Error(`${label} PRECACHE must contain at least one literal './…' entry`);
  }

  return [...new Set(paths.map(normalizeRepoPath))];
}

export function cacheNameDerivesFromVersion(source) {
  return typeof source === 'string'
    && /const\s+CACHE_NAME\s*=\s*`bazardrive-\$\{VERSION\}`\s*;/.test(source);
}

export function evaluateSwCacheContract({
  baseSource,
  headSource,
  changedPaths = [],
} = {}) {
  const errors = [];
  let baseVersion = null;
  let headVersion = null;
  let basePrecache = [];
  let headPrecache = [];

  try {
    baseVersion = parseSwVersion(baseSource, { label: `base ${SW_PATH}` });
  } catch (error) {
    errors.push(error.message);
  }
  try {
    headVersion = parseSwVersion(headSource, { label: `head ${SW_PATH}` });
  } catch (error) {
    errors.push(error.message);
  }
  try {
    basePrecache = parsePrecacheRepoPaths(baseSource, { label: `base ${SW_PATH}` });
  } catch (error) {
    errors.push(error.message);
  }
  try {
    headPrecache = parsePrecacheRepoPaths(headSource, { label: `head ${SW_PATH}` });
  } catch (error) {
    errors.push(error.message);
  }

  if (!cacheNameDerivesFromVersion(headSource)) {
    errors.push(`head ${SW_PATH} CACHE_NAME must derive from VERSION as bazardrive-\${VERSION}`);
  }

  const precache = new Set([...basePrecache, ...headPrecache]);
  const cachedPaths = [...new Set(changedPaths.map(normalizeRepoPath).filter(Boolean))]
    .filter((file) => file !== SW_PATH
      && (precache.has(file) || file.startsWith('public/vendor/')))
    .sort();

  if (baseVersion && headVersion) {
    if (headVersion.number < baseVersion.number) {
      errors.push(`VERSION rollback: head '${headVersion.raw}' is lower than base '${baseVersion.raw}'`);
    } else if (cachedPaths.length && headVersion.number === baseVersion.number) {
      errors.push(`${cachedPaths.length} cached file(s) changed but VERSION did not increase (still '${headVersion.raw}')`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    baseVersion: baseVersion?.raw || null,
    headVersion: headVersion?.raw || null,
    cachedPaths,
  };
}
