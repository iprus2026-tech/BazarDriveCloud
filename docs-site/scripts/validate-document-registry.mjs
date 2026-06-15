#!/usr/bin/env node
// BD-DOCS-SITE-03 — legacy document registry validator.
//
// The Mini-Yonder governance layer governs docs-site/docs/** via
// validate-frontmatter.mjs. This validator covers the *other* half: the legacy
// root/`docs/` documents that have NOT yet been migrated into docs-site. It:
//
//   • validates the structure of docs-site/governance/document-registry.json
//     (STRICT — exits 1 on any structural error), and
//   • scans the legacy document set and reports any file missing from the
//     registry as UNACCOUNTED_DOCUMENT (WARN-ONLY in this first pass — it does
//     not fail the build).
//
// docs-site/docs/**/*.{md,mdx} are intentionally NOT scanned here — they are
// already governed by their frontmatter passport, so they must not be
// duplicated into this legacy registry.
//
// Standard: docs-site/docs/governance/legacy-docs-registry.md.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SITE_ROOT = join(SCRIPTS_DIR, '..'); // docs-site/
const REPO_ROOT = join(SITE_ROOT, '..'); // repository root
const REGISTRY_PATH = join(SITE_ROOT, 'governance', 'document-registry.json');

// Controlled vocabularies for registry entries.
const DOC_TYPES = [
  'project-overview',
  'roadmap',
  'screen-contract',
  'flow-contract',
  'audit',
  'design-registry',
  'process',
  'runbook',
  'release-note',
];
const STATUSES = ['current', 'legacy-source', 'superseded', 'archived', 'draft'];
const VERIFICATIONS = ['pending', 'verified', 'superseded', 'ignored-with-reason'];

const REQUIRED = [
  'id',
  'path',
  'title',
  'docType',
  'status',
  'verification',
  'owner',
  'sourceOfTruth',
  'reviewAfter',
  'reason',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Directories never scanned for legacy documents.
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.docusaurus']);

function isRealDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isEmpty(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

// Repo-root-relative POSIX path for stable comparison and display.
function repoRel(absPath) {
  return relative(REPO_ROOT, absPath).split(sep).join('/');
}

// --- Structural validation (STRICT) ---------------------------------------

function validateRegistry(registry) {
  const errors = [];

  if (!Array.isArray(registry)) {
    return { errors: ['document-registry.json: top-level value must be an array'], paths: [] };
  }

  const seenIds = new Map();
  const paths = [];

  registry.forEach((entry, i) => {
    const at = `entry[${i}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at}: must be an object`);
      return;
    }

    for (const field of REQUIRED) {
      if (isEmpty(entry[field])) {
        errors.push(`${at}: missing required field "${field}"`);
      }
    }

    // id: string, BD- prefix, unique.
    if (entry.id !== undefined && entry.id !== null) {
      if (typeof entry.id !== 'string') {
        errors.push(`${at}: id must be a string`);
      } else {
        if (!entry.id.startsWith('BD-')) {
          errors.push(`${at}: id "${entry.id}" must start with "BD-"`);
        }
        if (seenIds.has(entry.id)) {
          errors.push(
            `${at}: duplicate id "${entry.id}" — already used by entry[${seenIds.get(entry.id)}]`,
          );
        } else {
          seenIds.set(entry.id, i);
        }
      }
    }

    // path: string that exists in the repo.
    if (entry.path !== undefined && entry.path !== null) {
      if (typeof entry.path !== 'string') {
        errors.push(`${at}: path must be a string`);
      } else {
        paths.push(entry.path);
        const abs = join(REPO_ROOT, entry.path);
        if (!existsSync(abs)) {
          errors.push(`${at}: path "${entry.path}" does not exist in the repo`);
        }
      }
    }

    // Controlled vocabularies.
    if (!isEmpty(entry.docType) && !DOC_TYPES.includes(entry.docType)) {
      errors.push(`${at}: docType "${entry.docType}" is not one of ${DOC_TYPES.join(', ')}`);
    }
    if (!isEmpty(entry.status) && !STATUSES.includes(entry.status)) {
      errors.push(`${at}: status "${entry.status}" is not one of ${STATUSES.join(', ')}`);
    }
    if (!isEmpty(entry.verification) && !VERIFICATIONS.includes(entry.verification)) {
      errors.push(
        `${at}: verification "${entry.verification}" is not one of ${VERIFICATIONS.join(', ')}`,
      );
    }

    // reviewAfter must be a real calendar date.
    if (!isEmpty(entry.reviewAfter) && !isRealDate(String(entry.reviewAfter))) {
      errors.push(`${at}: reviewAfter "${entry.reviewAfter}" must be a real YYYY-MM-DD date`);
    }
  });

  return { errors, paths };
}

// --- Legacy document scan (WARN-ONLY) -------------------------------------

function walk(dir, predicate, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
}

// The legacy universe: root README/ROADMAP plus docs/**/*.{md,json}.
// docs-site/ is deliberately excluded — it is governed by frontmatter.
function collectLegacyDocs() {
  const out = [];
  for (const name of ['README.md', 'ROADMAP.md']) {
    const abs = join(REPO_ROOT, name);
    if (existsSync(abs)) out.push(abs);
  }
  const docsDir = join(REPO_ROOT, 'docs');
  walk(docsDir, (f) => f.endsWith('.md') || f.endsWith('.json'), out);
  return out;
}

function main() {
  // Registry must exist and parse.
  if (!existsSync(REGISTRY_PATH)) {
    console.error(`document-registry.json: not found at ${repoRel(REGISTRY_PATH)}`);
    process.exit(1);
  }

  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    console.error(`document-registry.json: invalid JSON — ${err.message}`);
    process.exit(1);
  }

  const { errors, paths } = validateRegistry(registry);

  // Scan legacy docs and diff against registered paths.
  const registered = new Set(paths.map((p) => p.split(sep).join('/')));
  const legacy = collectLegacyDocs().map(repoRel);
  const unaccounted = legacy.filter((p) => !registered.has(p)).sort();

  // Report.
  if (errors.length > 0) {
    console.error('Document registry validation failed:\n');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`\n${errors.length} structural error(s).`);
    process.exit(1);
  }

  console.log(`✓ Registry OK — ${registry.length} registered legacy document(s).`);

  if (unaccounted.length > 0) {
    console.log(
      `\n⚠ ${unaccounted.length} UNACCOUNTED_DOCUMENT (warn-only — not yet in the registry):`,
    );
    for (const p of unaccounted) console.log(`  UNACCOUNTED_DOCUMENT: ${p}`);
    console.log(
      '\nThis first pass is warn-only; unaccounted legacy docs do not fail the build.',
    );
  } else {
    console.log('No unaccounted legacy documents.');
  }

  process.exit(0);
}

main();
