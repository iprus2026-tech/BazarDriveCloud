#!/usr/bin/env node
// BD-DOCS-SITE-02 — Mini-Yonder frontmatter validator.
//
// Walks docs-site/docs/**/*.md (skipping _templates/**) and enforces the
// metadata-passport standard: every governed document must carry a complete,
// well-formed frontmatter block. Exits 1 (with per-file errors) on any failure
// so `npm run check` and CI can gate the build.
//
// Standard: docs/governance/frontmatter-standard.md.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SITE_ROOT = join(SCRIPTS_DIR, '..');
const DOCS_DIR = join(SITE_ROOT, 'docs');

// Allowed controlled-vocabulary values (see governance/document-types.md).
const DOC_TYPES = [
  'project-overview',
  'screen-contract',
  'flow-contract',
  'process',
  'audit',
  'decision-record',
  'release-note',
  'runbook',
];
const STATUSES = ['draft', 'review', 'current', 'superseded', 'archived'];
const VISIBLE = [
  'developer',
  'designer',
  'dispatcher',
  'product',
  'qa',
  'driver',
  'passenger',
  'public',
];

// Fields that must be present and non-empty on every governed document.
const REQUIRED = [
  'id',
  'docType',
  'title',
  'owner',
  'status',
  'revision',
  'effectiveFrom',
  'visibleFor',
  'tags',
];

// Fields validated as ISO calendar dates when present.
const DATE_FIELDS = ['revision', 'effectiveFrom', 'reviewAfter'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// gray-matter (js-yaml default schema) turns an unquoted YYYY-MM-DD into a JS
// Date. Normalise such values back to a UTC date string before the regex test
// so authors may quote or not quote dates without breaking validation.
function asDateStr(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return typeof v === 'string' ? v : String(v);
}

// A YYYY-MM-DD string can match the shape yet be an impossible calendar date
// (e.g. 2026-99-99). Confirm the components round-trip through a real UTC date.
function isRealDate(str) {
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

// Recursively collect Markdown/MDX docs, skipping the _templates scaffolds.
// Docusaurus serves both .md and .mdx, so both must be governed — otherwise an
// .mdx page would skip the frontmatter gate while still being built.
function collectMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '_templates') continue;
      out.push(...collectMarkdown(full));
    } else if (entry.endsWith('.md') || entry.endsWith('.mdx')) {
      out.push(full);
    }
  }
  return out;
}

function validateFile(file) {
  const errors = [];
  const rel = relative(SITE_ROOT, file).split(sep).join('/');

  let data;
  try {
    ({ data } = matter(readFileSync(file, 'utf8')));
  } catch (err) {
    return { rel, errors: [`${rel}: cannot parse frontmatter — ${err.message}`], id: null };
  }

  // Required presence.
  for (const field of REQUIRED) {
    if (isEmpty(data[field])) {
      errors.push(`${rel}: missing required field "${field}"`);
    }
  }

  // id must be a BazarDrive passport id.
  if (typeof data.id === 'string' && !data.id.startsWith('BD-')) {
    errors.push(`${rel}: id "${data.id}" must start with "BD-"`);
  }

  // Controlled vocabularies.
  if (!isEmpty(data.docType) && !DOC_TYPES.includes(data.docType)) {
    errors.push(
      `${rel}: docType "${data.docType}" is not one of ${DOC_TYPES.join(', ')}`,
    );
  }
  if (!isEmpty(data.status) && !STATUSES.includes(data.status)) {
    errors.push(
      `${rel}: status "${data.status}" is not one of ${STATUSES.join(', ')}`,
    );
  }

  // visibleFor must be an array drawn from the allowed audiences.
  if (data.visibleFor !== undefined) {
    if (!Array.isArray(data.visibleFor)) {
      errors.push(`${rel}: visibleFor must be an array`);
    } else {
      for (const v of data.visibleFor) {
        if (!VISIBLE.includes(v)) {
          errors.push(
            `${rel}: visibleFor entry "${v}" is not one of ${VISIBLE.join(', ')}`,
          );
        }
      }
    }
  }

  // tags must be an array.
  if (data.tags !== undefined && !Array.isArray(data.tags)) {
    errors.push(`${rel}: tags must be an array`);
  }

  // Date-shaped fields, when present, must be a real YYYY-MM-DD calendar date.
  for (const field of DATE_FIELDS) {
    if (data[field] === undefined || data[field] === null) continue;
    const str = asDateStr(data[field]);
    if (!DATE_RE.test(str)) {
      errors.push(`${rel}: ${field} "${str}" must match YYYY-MM-DD`);
    } else if (!isRealDate(str)) {
      errors.push(`${rel}: ${field} "${str}" is not a valid calendar date`);
    }
  }

  return { rel, errors, id: typeof data.id === 'string' ? data.id : null };
}

function main() {
  let files;
  try {
    files = collectMarkdown(DOCS_DIR);
  } catch (err) {
    console.error(`validate-frontmatter: cannot read ${DOCS_DIR} — ${err.message}`);
    process.exit(1);
  }

  const allErrors = [];
  const idOwners = new Map(); // passport id -> first file that claimed it
  for (const file of files) {
    const { rel, errors, id } = validateFile(file);
    allErrors.push(...errors);
    // Passport ids are the machine-readable document identity and must be
    // unique across the whole site, even though Docusaurus would route two
    // same-id docs in different folders without complaint.
    if (id !== null) {
      if (idOwners.has(id)) {
        allErrors.push(
          `${rel}: duplicate passport id "${id}" — already used by ${idOwners.get(id)}`,
        );
      } else {
        idOwners.set(id, rel);
      }
    }
  }

  if (allErrors.length > 0) {
    console.error('Frontmatter validation failed:\n');
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    console.error(`\n${allErrors.length} error(s) across ${files.length} file(s).`);
    process.exit(1);
  }

  console.log(`✓ Frontmatter OK — ${files.length} document(s) validated.`);
}

main();
