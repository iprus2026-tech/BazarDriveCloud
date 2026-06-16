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

import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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

  // coreFiles: array.
  if (!Array.isArray(manifest.coreFiles)) {
    errors.push('mini-yonder-core.json: coreFiles must be an array');
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

    // path: string, unique, exists, and not a generated path.
    if (entry.path !== undefined && entry.path !== null) {
      if (typeof entry.path !== 'string') {
        errors.push(`${at}: path must be a string`);
      } else {
        const norm = toPosix(entry.path);
        if (seenPaths.has(norm)) {
          errors.push(`${at}: duplicate path "${entry.path}" — already used by coreFiles[${seenPaths.get(norm)}]`);
        } else {
          seenPaths.set(norm, i);
        }
        if (!existsSync(join(REPO_ROOT, entry.path))) {
          errors.push(`${at}: path "${entry.path}" does not exist in the repo`);
        }
        // Self-reference guard: generated output must never be a core file.
        const gen = generated.find((g) => norm === g || norm.startsWith(g));
        if (gen) {
          errors.push(`${at}: path "${entry.path}" is a generated path ("${gen}") and must not be a core file`);
        }
      }
    }

    // kind / area / criticality.
    if (isNonEmptyString(entry.kind) && !KINDS.includes(entry.kind)) {
      errors.push(`${at}: kind "${entry.kind}" is not one of ${KINDS.join(', ')}`);
    }
    if (entry.area !== undefined && entry.area !== 'mini-yonder') {
      errors.push(`${at}: area must be "mini-yonder", got "${entry.area}"`);
    }
    if (isNonEmptyString(entry.criticality) && !CRITICALITY.includes(entry.criticality)) {
      errors.push(`${at}: criticality "${entry.criticality}" is not one of ${CRITICALITY.join(', ')}`);
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
