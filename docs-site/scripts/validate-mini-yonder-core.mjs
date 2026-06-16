#!/usr/bin/env node
// BD-DOCS-SITE-04B — Mini-Yonder self-inventory validator.
//
// Validates docs-site/governance/mini-yonder-core.json — the manifest of
// Mini-Yonder's own core files (validators, registry, governance docs, config,
// workflow, policy). It lets Mini-Yonder *see* its own files without creating a
// self-reference loop:
//
//   • the manifest may list itself (kind: core-manifest), but
//   • generated output (build/, node_modules/, .docusaurus/, …) must NOT be a
//     core file, and
//   • this validator only READS and VALIDATES — it never generates or rewrites
//     an inventory file.
//
// STRICT: any structural error exits 1.
//
// Standard: docs-site/docs/governance/mini-yonder-self-inventory.md.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SITE_ROOT = join(SCRIPTS_DIR, '..'); // docs-site/
const REPO_ROOT = join(SITE_ROOT, '..'); // repository root
const MANIFEST_PATH = join(SITE_ROOT, 'governance', 'mini-yonder-core.json');

const KINDS = [
  'core-manifest',
  'validator',
  'registry',
  'governance-doc',
  'workflow',
  'policy',
  'config',
  'docusaurus-shell',
  'template',
];
const CRITICALITY = ['high', 'medium', 'low'];

const REQUIRED = ['id', 'path', 'kind', 'area', 'criticality', 'requires', 'reason'];
const ID_PREFIX = 'BD-MY-CORE-';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isNonEmptyStringArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);
}

function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function manifestRel() {
  return relative(REPO_ROOT, MANIFEST_PATH).split(sep).join('/');
}

// Canonical repo-relative path: resolves `.`/`..` and POSIX-normalizes it.
// Returns null when the path escapes the repository root. Uniqueness,
// generated/ignored prefix checks and self-entry detection all compare on this
// canonical form, so two spellings of one file collide and a path such as
// `docs-site/../docs-site/node_modules/x` cannot slip past the prefixes.
function canonRel(p) {
  if (typeof p !== 'string') return null;
  const rel = relative(REPO_ROOT, resolve(REPO_ROOT, p));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return toPosix(rel);
}

function validate(manifest) {
  const errors = [];

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['mini-yonder-core.json: top-level value must be an object'];
  }

  // version: positive integer.
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    errors.push(`mini-yonder-core.json: version must be a positive integer`);
  }

  // generatedPaths / ignoredPaths: arrays of strings.
  if (!isStringArray(manifest.generatedPaths)) {
    errors.push('mini-yonder-core.json: generatedPaths must be an array of strings');
  }
  if (!isStringArray(manifest.ignoredPaths)) {
    errors.push('mini-yonder-core.json: ignoredPaths must be an array of strings');
  }
  const generated = isStringArray(manifest.generatedPaths)
    ? manifest.generatedPaths.map(toPosix)
    : [];
  const ignored = isStringArray(manifest.ignoredPaths)
    ? manifest.ignoredPaths.map(toPosix)
    : [];
  // Generated build output AND ignored repo artifacts (.git/, node_modules/, …)
  // must never be inventoried as a core file.
  const forbiddenPrefixes = [
    ...generated.map((g) => ['generated', g]),
    ...ignored.map((g) => ['ignored', g]),
  ];

  // coreFiles: a NON-EMPTY array. An empty inventory would exit 0 while
  // silently protecting nothing — that defeats the whole validator.
  if (!Array.isArray(manifest.coreFiles)) {
    errors.push('mini-yonder-core.json: coreFiles must be an array');
    return errors;
  }
  if (manifest.coreFiles.length === 0) {
    errors.push('mini-yonder-core.json: coreFiles must inventory at least one core file (empty inventory disables the guard)');
    return errors;
  }

  const seenIds = new Map();
  const seenPaths = new Map();

  manifest.coreFiles.forEach((entry, i) => {
    const at = `coreFiles[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at}: must be an object`);
      return;
    }

    for (const field of REQUIRED) {
      const v = entry[field];
      const empty =
        v === undefined ||
        v === null ||
        (typeof v === 'string' && v.trim() === '') ||
        (Array.isArray(v) && v.length === 0);
      if (empty) errors.push(`${at}: missing required field "${field}"`);
    }

    // id: BD-MY-CORE- prefix, unique.
    if (entry.id !== undefined && entry.id !== null) {
      if (typeof entry.id !== 'string') {
        errors.push(`${at}: id must be a string`);
      } else {
        if (!entry.id.startsWith(ID_PREFIX)) {
          errors.push(`${at}: id "${entry.id}" must start with "${ID_PREFIX}"`);
        }
        if (seenIds.has(entry.id)) {
          errors.push(`${at}: duplicate id "${entry.id}" — already used by coreFiles[${seenIds.get(entry.id)}]`);
        } else {
          seenIds.set(entry.id, i);
        }
      }
    }

    // path: string, unique, a real file inside the repo, and not
    // generated/ignored. All comparisons use the canonical repo-relative path.
    if (entry.path !== undefined && entry.path !== null) {
      if (typeof entry.path !== 'string') {
        errors.push(`${at}: path must be a string`);
      } else {
        const canon = canonRel(entry.path);
        if (canon === null) {
          // Escapes the repo root (../.. or absolute) — never a core file.
          errors.push(`${at}: path "${entry.path}" escapes the repository root`);
        } else {
          // Uniqueness on the canonical path, so two spellings of the same file
          // collide instead of both being accepted.
          if (seenPaths.has(canon)) {
            errors.push(`${at}: duplicate path "${entry.path}" — already used by coreFiles[${seenPaths.get(canon)}]`);
          } else {
            seenPaths.set(canon, i);
          }
          const abs = resolve(REPO_ROOT, entry.path);
          if (!existsSync(abs)) {
            errors.push(`${at}: path "${entry.path}" does not exist in the repo`);
          } else if (!statSync(abs).isFile()) {
            errors.push(`${at}: path "${entry.path}" is not a file`);
          }
          // Self-reference guard: generated output AND ignored artifacts must
          // never be a core file (compared on the canonical path).
          const hit = forbiddenPrefixes.find(([, prefix]) => canon === prefix || canon.startsWith(prefix));
          if (hit) {
            errors.push(`${at}: path "${entry.path}" is a ${hit[0]} path ("${hit[1]}") and must not be a core file`);
          }
        }
      }
    }

    // kind / area / criticality. A truthy non-string (e.g. ["validator"]) must
    // be rejected too, not just unknown strings.
    if (entry.kind !== undefined && entry.kind !== null) {
      if (typeof entry.kind !== 'string' || !KINDS.includes(entry.kind)) {
        errors.push(`${at}: kind "${entry.kind}" is not one of ${KINDS.join(', ')}`);
      }
    }
    if (entry.area !== undefined && entry.area !== 'mini-yonder') {
      errors.push(`${at}: area must be "mini-yonder", got "${entry.area}"`);
    }
    if (entry.criticality !== undefined && entry.criticality !== null) {
      if (typeof entry.criticality !== 'string' || !CRITICALITY.includes(entry.criticality)) {
        errors.push(`${at}: criticality "${entry.criticality}" is not one of ${CRITICALITY.join(', ')}`);
      }
    }

    // requires: array of non-empty strings.
    if (entry.requires !== undefined && !isNonEmptyStringArray(entry.requires)) {
      errors.push(`${at}: requires must be a non-empty array of non-empty strings`);
    }

    // reason: non-empty string.
    if (entry.reason !== undefined && entry.reason !== null && !isNonEmptyString(entry.reason)) {
      errors.push(`${at}: reason must be a non-empty string`);
    }
  });

  // Bounded self-reference: the manifest's own entry, if present, must be
  // kind core-manifest, and no other file may claim that kind. This enforces
  // the "may list itself only once as core-manifest" contract.
  const manifestPath = manifestRel();
  const selfEntry = manifest.coreFiles.find(
    (e) => e && canonRel(e.path) === manifestPath,
  );
  if (selfEntry && selfEntry.kind !== 'core-manifest') {
    errors.push(`coreFiles: the manifest's own entry ("${manifestPath}") must have kind "core-manifest"`);
  }
  manifest.coreFiles.forEach((e, i) => {
    if (e && e.kind === 'core-manifest' && canonRel(e.path) !== manifestPath) {
      errors.push(`coreFiles[${i}]: only "${manifestPath}" may have kind "core-manifest" (got "${e && e.path}")`);
    }
  });

  return errors;
}

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`mini-yonder-core.json: not found at ${manifestRel()}`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    console.error(`mini-yonder-core.json: invalid JSON — ${err.message}`);
    process.exit(1);
  }

  const errors = validate(manifest);

  if (errors.length > 0) {
    console.error('Mini-Yonder core inventory validation failed:\n');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`\n${errors.length} structural error(s).`);
    process.exit(1);
  }

  const n = Array.isArray(manifest.coreFiles) ? manifest.coreFiles.length : 0;
  console.log(`✓ Mini-Yonder core OK — ${n} core file(s) inventoried (no self-reference loop).`);
  process.exit(0);
}

main();
