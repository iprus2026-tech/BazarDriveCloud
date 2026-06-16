#!/usr/bin/env node
// BD-DOCS-SITE-06 — Mini-Yonder docs-site navigation validator.
//
// Locks the repository file inventory page into docs-site navigation so it can
// never silently become a hidden, slug-only URL that works only when someone
// already knows the address. It also guards the sidebar itself: every sidebar
// entry must resolve to a real governed document, never to a dangling id or an
// underscore-prefixed scaffold under _templates/_partials.
//
// Concretely it asserts:
//   • every sidebar item resolves to a governed doc (no dangling / template id),
//   • the inventory page is present in the docs-site sidebar navigation,
//   • the inventory page is linked from the docs-site index (landing page), and
//   • the inventory page keeps its clean slug.
//
// STRICT: any failure exits 1 (with per-error detail) so `npm run check` and CI
// gate on it. Standard: docs-site/docs/governance/repository-file-inventory.md.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const require = createRequire(import.meta.url);

const SCRIPTS_DIR = fileURLToPath(new URL('.', import.meta.url));
const SITE_ROOT = join(SCRIPTS_DIR, '..'); // docs-site/
const DOCS_DIR = join(SITE_ROOT, 'docs');
const SIDEBARS_PATH = join(SITE_ROOT, 'sidebars.js');
const INDEX_DOC = join(DOCS_DIR, 'index.md');

// The page this slice locks into navigation. Identified by its file (the stable
// anchor) — its Docusaurus id and slug are read from frontmatter, never guessed.
const INVENTORY_REL = 'governance/repository-file-inventory.md'; // under docs/
const INVENTORY_SLUG = '/governance/repository-file-inventory';

// Keep YAML dates as raw strings (no Date coercion), matching the other validators.
const MATTER_OPTS = {
  engines: { yaml: (s) => yaml.load(s, { schema: yaml.JSON_SCHEMA }) },
};

function toPosix(p) {
  return String(p).split(sep).join('/');
}

// Build the governed-doc universe: a map of Docusaurus doc id -> { rel, slug }.
// Mirrors Docusaurus' own id derivation — <dirFromDocs>/<frontmatter id ||
// filename> — and skips underscore-prefixed scaffolds (templates/partials),
// exactly like validate-frontmatter.mjs and the inventory scanner. A sidebar
// entry that points at a scaffold therefore resolves to nothing and is reported.
function collectDocs() {
  const map = new Map();
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('_')) continue; // scaffolds are not governed pages
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(md|mdx)$/.test(name)) continue;
      let data = {};
      try {
        ({ data } = matter(readFileSync(abs, 'utf8'), MATTER_OPTS));
      } catch {
        continue; // malformed frontmatter is validate-frontmatter.mjs' job
      }
      const dirFromDocs = toPosix(relative(DOCS_DIR, dirname(abs)));
      const idSeg =
        typeof data.id === 'string' && data.id.trim() !== ''
          ? data.id.trim()
          : basename(name, extname(name));
      const docId = dirFromDocs ? `${dirFromDocs}/${idSeg}` : idSeg;
      map.set(docId, {
        rel: toPosix(relative(DOCS_DIR, abs)),
        slug: typeof data.slug === 'string' ? data.slug : null,
      });
    }
  })(DOCS_DIR);
  return map;
}

// Collect every doc id referenced anywhere in sidebars.js, across all sidebars.
function flattenSidebar(node, out) {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) flattenSidebar(n, out);
    return;
  }
  if (node && typeof node === 'object') {
    if ((node.type === 'doc' || node.type === 'ref') && typeof node.id === 'string') {
      out.push(node.id);
    }
    if (node.link && node.link.type === 'doc' && typeof node.link.id === 'string') {
      out.push(node.link.id);
    }
    if (Array.isArray(node.items)) flattenSidebar(node.items, out);
  }
}

// A sidebar id that looks like it points at a scaffold (underscore-prefixed
// segment), for a precise message instead of a generic "unknown id".
function looksLikeTemplate(id) {
  return id.split('/').some((seg) => seg.startsWith('_'));
}

function main() {
  const errors = [];

  // --- Inputs -------------------------------------------------------------
  if (!existsSync(SIDEBARS_PATH)) {
    console.error(`validate-navigation: sidebars.js not found at ${toPosix(relative(SITE_ROOT, SIDEBARS_PATH))}`);
    process.exit(1);
  }
  let sidebars;
  try {
    sidebars = require(SIDEBARS_PATH);
  } catch (err) {
    console.error(`validate-navigation: cannot load sidebars.js — ${err.message}`);
    process.exit(1);
  }

  const docMap = collectDocs();

  // sidebars.js exports an object keyed by sidebar name (e.g. { docsSidebar:
  // [...] }); flatten every named sidebar's item tree.
  const sidebarIds = [];
  if (sidebars && typeof sidebars === 'object') {
    for (const sidebar of Object.values(sidebars)) flattenSidebar(sidebar, sidebarIds);
  }
  const sidebarSet = new Set(sidebarIds);

  // --- 1. Every sidebar entry must resolve to a governed, non-template doc.
  for (const id of sidebarIds) {
    if (!docMap.has(id)) {
      errors.push(
        looksLikeTemplate(id)
          ? `sidebar entry "${id}" points at an underscore/template scaffold — templates must not appear in navigation`
          : `sidebar entry "${id}" does not resolve to any governed doc (dangling navigation id)`,
      );
    }
  }

  // --- 2. Locate the inventory page by its file (stable anchor).
  let inventoryId = null;
  let inventorySlug = null;
  for (const [docId, info] of docMap) {
    if (info.rel === INVENTORY_REL) {
      inventoryId = docId;
      inventorySlug = info.slug;
      break;
    }
  }

  if (inventoryId === null) {
    errors.push(`inventory page not found / not governed at docs/${INVENTORY_REL}`);
  } else {
    // --- 3. Clean slug intact.
    if (inventorySlug !== INVENTORY_SLUG) {
      errors.push(
        `inventory page slug is "${inventorySlug}" — must be the clean slug "${INVENTORY_SLUG}"`,
      );
    }
    // --- 4. Present in the docs-site sidebar navigation.
    if (!sidebarSet.has(inventoryId)) {
      errors.push(
        `inventory page ("${inventoryId}") is missing from the docs-site sidebar (sidebars.js) — it would be a hidden, slug-only URL`,
      );
    }
  }

  // --- 5. Linked from the docs-site index (landing page).
  if (!existsSync(INDEX_DOC)) {
    errors.push('docs-site index (docs/index.md) not found');
  } else {
    const indexText = readFileSync(INDEX_DOC, 'utf8');
    const linksInventory = /\]\([^)]*repository-file-inventory[^)]*\)/.test(indexText);
    if (!linksInventory) {
      errors.push('docs-site index (docs/index.md) does not link to the repository file inventory page');
    }
  }

  // --- Report -------------------------------------------------------------
  if (errors.length > 0) {
    console.error('Docs-site navigation validation failed:\n');
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`\n${errors.length} error(s).`);
    process.exit(1);
  }

  console.log(
    `✓ Navigation OK — ${sidebarIds.length} sidebar entr(y/ies) resolve; ` +
      `inventory page "${inventoryId}" is in the sidebar, linked from the index, and keeps its clean slug.`,
  );
  process.exit(0);
}

main();
