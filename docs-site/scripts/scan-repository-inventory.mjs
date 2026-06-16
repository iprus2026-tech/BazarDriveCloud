#!/usr/bin/env node
// BD-DOCS-SITE-05 — Repository file inventory + code awareness.
//
// Scans the repository tree, classifies every file onto a "shelf", and reports
// code/docs awareness: which files are Mini-Yonder core, which legacy docs are
// unaccounted in the registry, and which runtime files no docs-site document
// links to. It is the first step toward a future Mini-Yonder impact graph.
//
// REPORT-ONLY / WARN-ONLY by design:
//   • it never enforces and never fails the build — it exits 0 unless the
//     scanner itself hits a structural/runtime error,
//   • it reads only (mini-yonder-core.json, document-registry.json, doc
//     frontmatter) and NEVER writes any file (no generated inventory output).
//
// Standard: docs-site/docs/governance/repository-file-inventory.md.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SITE_ROOT = join(SCRIPTS_DIR, '..'); // docs-site/
const REPO_ROOT = join(SITE_ROOT, '..'); // repository root
const CORE_MANIFEST = join(SITE_ROOT, 'governance', 'mini-yonder-core.json');
const DOC_REGISTRY = join(SITE_ROOT, 'governance', 'document-registry.json');
const DOCS_DIR = join(SITE_ROOT, 'docs');

// Keep YAML dates as raw strings (no Date coercion) when reading frontmatter.
const MATTER_OPTS = {
  engines: { yaml: (s) => yaml.load(s, { schema: yaml.JSON_SCHEMA }) },
};

// Directories never walked — generated/dependency artifacts (POSIX, repo-rel,
// trailing slash). Mirrors mini-yonder-core.json generated/ignored paths.
const IGNORE_PREFIXES = [
  '.git/',
  'node_modules/',
  'docs-site/node_modules/',
  'build/',
  'docs-site/build/',
  'docs-site/.docusaurus/',
  'docs-site/.cache/',
  'coverage/',
];

// File classes (shelves). Order of classify() matters — most specific first.
const CLASSES = [
  'mini-yonder-core',
  'docs-site-doc',
  'template',
  'legacy-doc',
  'runtime',
  'smoke',
  'workflow',
  'config',
  'asset',
  'generated',
  'unknown',
];

const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.mp3', '.wav',
]);
const CONFIG_EXT = new Set(['.json', '.yml', '.yaml', '.toml', '.ini', '.lock', '.webmanifest']);
const CONFIG_NAMES = new Set([
  '.gitignore', '.gitattributes', '.npmrc', '.nvmrc', '.editorconfig',
  '.eslintrc', '.prettierrc', 'browserslist', '.babelrc',
]);

function toPosix(p) {
  return String(p).split(sep).join('/');
}
function repoRel(abs) {
  return toPosix(relative(REPO_ROOT, abs));
}

// --- Inputs ----------------------------------------------------------------

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label}: not found at ${repoRel(path)}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Known generated/ignored prefixes from the manifest, for the `generated` class.
function generatedPrefixesFrom(manifest) {
  const g = Array.isArray(manifest.generatedPaths) ? manifest.generatedPaths : [];
  const i = Array.isArray(manifest.ignoredPaths) ? manifest.ignoredPaths : [];
  return [...g, ...i].map(toPosix);
}

// The legacy universe (mirrors validate-document-registry.mjs):
// root README/ROADMAP plus docs/**/*.{md,json}. docs-site/ is excluded — it is
// governed by frontmatter passports, not the legacy registry.
function isLegacyDoc(rel) {
  if (rel === 'README.md' || rel === 'ROADMAP.md') return true;
  return rel.startsWith('docs/') && (rel.endsWith('.md') || rel.endsWith('.json'));
}

// Underscore-prefixed names under docs-site/docs are templates/partials —
// authoring scaffolds, not governed pages. collectSiteDocs() and the frontmatter
// validator both skip them; classify them separately so they never inflate the
// docs-site-doc shelf.
const SITE_DOCS_PREFIX = 'docs-site/docs/';
function isSiteTemplate(rel) {
  if (!rel.startsWith(SITE_DOCS_PREFIX)) return false;
  return rel
    .slice(SITE_DOCS_PREFIX.length)
    .split('/')
    .some((seg) => seg.startsWith('_'));
}

// --- Tree walk -------------------------------------------------------------

function walk(absDir, files) {
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // unreadable / dangling — skip, never throw on one entry
    }
    if (st.isDirectory()) {
      const rd = repoRel(abs) + '/';
      if (IGNORE_PREFIXES.some((p) => rd === p || rd.startsWith(p))) continue;
      walk(abs, files);
    } else if (st.isFile()) {
      files.push(abs);
    }
  }
}

// Markdown/MDX docs under docs-site/docs (skip _templates/_partials scaffolds),
// to read their related.files links — Docusaurus' own convention.
function collectSiteDocs(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_')) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) collectSiteDocs(abs, out);
    else if (name.endsWith('.md') || name.endsWith('.mdx')) out.push(abs);
  }
}

// --- Classification --------------------------------------------------------

function classify(rel, coreSet, registeredSet, generatedPrefixes) {
  const ext = extname(rel).toLowerCase();
  const base = basename(rel);
  // Mini-Yonder governs its own core files first — they take precedence over
  // their underlying doc/workflow/config shape.
  if (coreSet.has(rel)) return 'mini-yonder-core';
  if (base === 'package-lock.json' || generatedPrefixes.some((p) => rel === p || rel.startsWith(p))) {
    return 'generated';
  }
  // Templates/partials (underscore-prefixed) are scaffolds, not governed pages.
  if (isSiteTemplate(rel)) return 'template';
  if (rel.startsWith('docs-site/docs/') && (ext === '.md' || ext === '.mdx')) return 'docs-site-doc';
  if (isLegacyDoc(rel)) return 'legacy-doc';
  // Non-doc artifacts under docs/ (design PDFs, prototype HTML exports, images)
  // are reference assets, not governed legacy docs.
  if (rel.startsWith('docs/')) return 'asset';
  if (rel.startsWith('.github/workflows/') && (ext === '.yml' || ext === '.yaml')) return 'workflow';
  if (rel.startsWith('scripts/') && ext === '.mjs') return 'smoke';
  // public/prototypes/** are Cloud Design reference artifacts (HTML/PDF exports),
  // not SW-cached PWA runtime — scripts/check.mjs skips this directory too, so
  // they must not pollute the runtime / UNLINKED_RUNTIME signal.
  if (rel.startsWith('public/prototypes/')) return 'asset';
  if (rel.startsWith('public/')) return ASSET_EXT.has(ext) ? 'asset' : 'runtime';
  if (rel.startsWith('docs-site/src/') || rel.startsWith('docs-site/static/')) {
    return ASSET_EXT.has(ext) ? 'asset' : 'config';
  }
  if (ASSET_EXT.has(ext)) return 'asset';
  if (CONFIG_EXT.has(ext) || CONFIG_NAMES.has(base)) return 'config';
  return 'unknown';
}

// --- Main ------------------------------------------------------------------

function main() {
  const manifest = readJson(CORE_MANIFEST, 'mini-yonder-core.json');
  const registry = readJson(DOC_REGISTRY, 'document-registry.json');

  const coreSet = new Set(
    (Array.isArray(manifest.coreFiles) ? manifest.coreFiles : [])
      .map((e) => (e && typeof e.path === 'string' ? toPosix(e.path) : null))
      .filter(Boolean),
  );
  const generatedPrefixes = generatedPrefixesFrom(manifest);
  const registeredSet = new Set(
    (Array.isArray(registry) ? registry : [])
      .map((e) => (e && typeof e.path === 'string' ? toPosix(e.path) : null))
      .filter(Boolean),
  );

  // docs-site related.files links (the runtime-awareness signal).
  const linked = new Set();
  const siteDocs = [];
  collectSiteDocs(DOCS_DIR, siteDocs);
  for (const abs of siteDocs) {
    let data;
    try {
      ({ data } = matter(readFileSync(abs, 'utf8'), MATTER_OPTS));
    } catch {
      continue; // a malformed doc is the frontmatter validator's job, not ours
    }
    const files = data && data.related && data.related.files;
    if (Array.isArray(files)) {
      for (const f of files) if (typeof f === 'string') linked.add(toPosix(f));
    }
  }

  // Walk + classify.
  const files = [];
  walk(REPO_ROOT, files);

  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const unaccountedLegacy = [];
  const runtimeFiles = [];
  const unlinkedRuntime = [];

  for (const abs of files) {
    const rel = repoRel(abs);
    const cls = classify(rel, coreSet, registeredSet, generatedPrefixes);
    counts[cls] += 1;
    if (cls === 'legacy-doc' && !registeredSet.has(rel)) unaccountedLegacy.push(rel);
    if (cls === 'runtime') {
      runtimeFiles.push(rel);
      if (!linked.has(rel)) unlinkedRuntime.push(rel);
    }
  }
  unaccountedLegacy.sort();
  unlinkedRuntime.sort();

  // --- Report -------------------------------------------------------------
  console.log('Mini-Yonder repository inventory (report-only)\n');
  console.log(`  total files scanned        ${files.length}`);
  console.log('  by class:');
  for (const c of CLASSES) console.log(`    ${c.padEnd(18)} ${counts[c]}`);
  console.log('');
  console.log(`  mini-yonder core files     ${counts['mini-yonder-core']}`);
  console.log(`  registered legacy docs     ${counts['legacy-doc'] - unaccountedLegacy.length}`);
  console.log(`  unaccounted legacy docs    ${unaccountedLegacy.length}`);
  console.log(`  runtime files              ${runtimeFiles.length}`);
  console.log(`  unlinked runtime files     ${unlinkedRuntime.length}`);

  if (unaccountedLegacy.length > 0) {
    console.log(`\n⚠ ${unaccountedLegacy.length} UNACCOUNTED_DOCUMENT (warn-only — not in the legacy registry):`);
    for (const p of unaccountedLegacy) console.log(`  UNACCOUNTED_DOCUMENT: ${p}`);
  }
  if (unlinkedRuntime.length > 0) {
    console.log(`\n⚠ ${unlinkedRuntime.length} UNLINKED_RUNTIME (warn-only — no docs-site document links this file):`);
    for (const p of unlinkedRuntime) console.log(`  UNLINKED_RUNTIME: ${p}`);
  }
  console.log('\nReport-only: inventory warnings never fail the build.');
  process.exit(0);
}

try {
  main();
} catch (err) {
  // Only a scanner-internal failure is fatal; classification warnings are not.
  console.error(`scan-repository-inventory: ${err && err.message ? err.message : err}`);
  process.exit(1);
}
