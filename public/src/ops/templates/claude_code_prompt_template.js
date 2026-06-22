// BD-OPS-03 — Claude Code prompt generator (pure text, no I/O).
//
// Produces a scoped code-agent prompt for a screen repair. Always embeds the
// screen id, route and source file, plus an explicit must-not-touch block.

import { blastRadiusLines } from '../blast_radius.js';

function branchFor(screen = {}) {
  const raw = String(screen.id || 'screen')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screen';
  return `fix/${raw}-repair`;
}

// Regex-escape a term for a `grep -E` alternation.
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Shell single-quote a string so it is a safe LITERAL argument — a selector can
// contain regex/shell metachars ([, ], ., #, ", …), so the locate-grep uses
// `grep -nF -- <this>` to avoid "Invalid range end" / wrong matches.
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// #684 #8 — repair-viability lines from the screen's optional data-model fact.
// With no fact, a generic reminder; with one, name the store, runtime-created
// nature and what it is keyed by, so a fix that assumes a non-existent static
// anchor is caught before it is attempted.
function dataModelLines(screen = {}) {
  const dm = screen.dataModel;
  if (!dm || typeof dm !== 'object') {
    return ['- identify where the entity your repair touches LIVES: a static seed (editable in place) or a runtime store (created at runtime — no static id to point at).'];
  }
  const lines = [
    `- backed by ${dm.store || '(unnamed store)'}${dm.runtimeCreated ? ' — CREATED AT RUNTIME (no static seed)' : ' — STATIC (editable in place)'}.`,
  ];
  if (dm.keyedBy) lines.push(`- keyed by ${dm.keyedBy}.`);
  if (dm.note) lines.push(`- ${dm.note}`);
  return lines;
}

// #684 #7 — screen-specific must-not-touch guardrails from the registry, appended
// to the generic list so a per-screen contract (e.g. the garage no-mutation rule)
// no longer has to be re-typed into every repair prompt by hand.
function guardrailLines(screen = {}) {
  const g = Array.isArray(screen.guardrails) ? screen.guardrails.filter((x) => typeof x === 'string' && x.trim()) : [];
  return g.map((x) => `- [${screen.id || 'screen'}] ${x}`);
}

// #684 #13 — a repair that edits a PRECACHED file must bump the SW cache name, or installed
// clients keep serving the stale copy. The PRECACHE list lives in sw.js and a pure template
// can't read it, but public/styles/cloud.css (ALWAYS an allowed file) and every screen source
// under public/src/**.js are precached. cloud.css alone means EVERY repair can touch a
// precached file, so the section ALWAYS emits — a CSS-only repair on a non-precached screen
// file still changes the precached stylesheet (Codex #706). The bump must clear the current
// main VERSION; parallel precached PRs must SEQUENCE their bumps (the #701 / #705 lesson: two
// PRs sharing a vN means the second to merge ships no cache change).
function isPrecachedPath(file) {
  return /^public\/(src\/.*\.js|styles\/.*\.css)$/.test(String(file || ''));
}

function serviceWorkerLines(screen = {}) {
  const file = screen.file || '';
  const fileIsPrecached = isPrecachedPath(file);
  const precached = fileIsPrecached ? `${file} and public/styles/cloud.css` : `public/styles/cloud.css`;
  return [
    ``,
    `Service worker / cache (this repair edits precached files)`,
    `- ${precached} ${fileIsPrecached ? 'are' : 'is'} in the sw.js PRECACHE list, so installed clients keep serving the OLD cached copy until the cache name changes.`,
    `- After the edit, bump 'const VERSION' in public/sw.js ABOVE the current main VERSION (the VERSION line ONLY — do not otherwise alter the PRECACHE list or CSP).`,
    `- If a parallel PR also bumps a precached file, sequence your VERSION ABOVE it: two PRs sharing the same vN means the second to merge ships NO cache change (#701 / #705).`,
  ];
}

export function generateClaudeCodePrompt(screen = {}, mel = {}) {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  const problem = mel.problem || '(describe the defect)';
  const repair = mel.requiredRepair || '(describe the required repair)';
  // #684 #2 — anchor on a stable selector/symbol, never a (drifting) line number.
  const selector = (typeof mel.selector === 'string' && mel.selector.trim()) ? mel.selector.trim() : '';
  const fileBase = String(file).split('/').pop() || file;
  // Search by file OR route — some smokes pin a screen by its route, not its file.
  const routeTerm = (typeof screen.route === 'string' && screen.route.startsWith('/')) ? screen.route : '';
  const pinPattern = [fileBase, routeTerm].filter(Boolean).map(escapeRe).join('|') || escapeRe(fileBase);

  return [
    `Task: repair ${id} — ${title}`,
    ``,
    `Route: ${route}`,
    `File: ${file}`,
    selector
      ? `Anchor: ${selector}  —  locate (line numbers drift, re-resolve now): grep -nF -- ${shQuote(selector)} ${file}`
      : `Anchor: (none recorded — anchor the defect on a stable selector/symbol, not a line number)`,
    `Suggested branch: ${branchFor(screen)}`,
    ``,
    `Step 0 — cross-check the smoke suite (intent guard)`,
    `A "confirmed" defect can be intentionally-pinned behavior. Before changing anything:`,
    `- find the smokes that pin this screen (file or route):  grep -rlE "${pinPattern}" scripts/smoke-*.mjs || echo '(no file/route pin — check by selector)'`,
    `- read them (and the selectors you are about to touch); if one pins the behavior as INTENDED, stop — this may be WONTFIX or need a different fix.`,
    `- never edit a pin to force the fix through; if your change breaks a pin, reconsider the fix, not the test.`,
    `- NOTE: this cross-check confirms the behavior is SAFE TO CHANGE (not pinned) — it does NOT map the blast radius. For a repair that writes a shared store/id, see Step 0c.`,
    ``,
    `Step 0b — repair viability (data model, #684 #8)`,
    `Confirm the fix is CONSTRUCTIBLE against how the data actually lives — a repair that assumes a static anchor which does not exist is non-viable (the BD-RESPONSES-01 audit proposed pointing a seed at a runtime-created order id that has no static value).`,
    ...dataModelLines(screen),
    ``,
    `Step 0c — blast radius (shared-state consumers, #684 #9)`,
    `A repair that writes a shared store or shared id does not stay on this screen — other screens read the same data. Before writing:`,
    ...blastRadiusLines(mel),
    `- verify each listed consumer still behaves correctly after the change (this is the class of miss that took BD-RESPONSES-01 / #688 three review rounds).`,
    ``,
    `What to change`,
    repair,
    ``,
    `Context / problem`,
    problem,
    ``,
    `Allowed files`,
    `- ${file}`,
    `- public/styles/cloud.css (scoped atoms for this screen only)`,
    `- public/sw.js (the VERSION line ONLY — bump it; see Service worker below)`,
    ``,
    `Must not touch`,
    `- route registration in public/src/app.js (unless the task is the route)`,
    `- public/sw.js PRECACHE list + CSP, public/index.html (the VERSION bump itself is required, not forbidden)`,
    `- localStorage keys, state machines, mock_api semantics`,
    `- backend, Mapbox, auth, payment, push, APK`,
    `- do not add real credentials or private keys`,
    ...guardrailLines(screen),
    ...serviceWorkerLines(screen),
    ``,
    `Verify`,
    `- node scripts/check.mjs`,
    `- node scripts/dispatcher.mjs`,
    `- manual: open ${route} and confirm the repair`,
  ].join('\n');
}
