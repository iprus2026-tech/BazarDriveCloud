// BD-OPS-03 — static regression smoke for the ScreenOps dev/docs route.
//
// ScreenOps (/ops/screens) is a net-new dev surface: a static screen registry,
// a localStorage MEL store, four pure prompt templates and a dashboard screen.
// A future refactor could silently drop the route registration, leak the dev
// route into the product tabbar, regress the registry seed, break a generator's
// route/file/id embedding, or hard-code a credential into a template. None of
// that would trip the generic checks. This script is intentionally STATIC: it
// reads source + imports the pure modules and asserts the contract holds. No
// browser, no DOM, no behaviour change.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const app = read('../public/src/app.js');
const router = read('../public/src/router.js');
const indexHtml = read('../public/index.html');
const sw = read('../public/sw.js');
const css = read('../public/styles/cloud.css');
const screenSrc = read('../public/src/screens/ops_screens.js');
const registrySrc = read('../public/src/ops/ops_registry.js');
const storeSrc = read('../public/src/ops/ops_mel_store.js');
const tplCloud = read('../public/src/ops/templates/cloud_design_prompt_template.js');
const tplGithub = read('../public/src/ops/templates/github_issue_template.js');
const tplClaude = read('../public/src/ops/templates/claude_code_prompt_template.js');
const tplMel = read('../public/src/ops/templates/screen_mel_card_template.js');

// Pure modules are safe to import in Node (no browser globals at module load).
const { getScreens } = await import(new URL('../public/src/ops/ops_registry.js', import.meta.url));
const { generateCloudDesignPrompt } = await import(new URL('../public/src/ops/templates/cloud_design_prompt_template.js', import.meta.url));
const { generateGithubIssueBody } = await import(new URL('../public/src/ops/templates/github_issue_template.js', import.meta.url));
const { generateClaudeCodePrompt } = await import(new URL('../public/src/ops/templates/claude_code_prompt_template.js', import.meta.url));
const { renderMelCard } = await import(new URL('../public/src/ops/templates/screen_mel_card_template.js', import.meta.url));

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) {
    issues.push(label + (detail ? ` — ${detail}` : ''));
  }
}

// ── A. Route registration ──
expect('app.js imports the ops_screens screen',
  /import\s+opsScreens\s+from\s+'\.\/screens\/ops_screens\.js'/.test(app));
expect("app.js registers '/ops/screens'",
  /register\(\s*'\/ops\/screens'\s*,\s*opsScreens\s*\)/.test(app));
expect('ops_screens.js has a default export',
  /export\s+default\s+function\s+opsScreens\s*\(/.test(screenSrc));

// ── B. NOT in the product tabbar ──
expect('/ops/screens is NOT a tabbar data-route in index.html',
  !/data-route="\/ops\/screens"/.test(indexHtml));

// ── B2. Welcome guard bypass (BD-OPS-03) — opens from a clean profile ──
// Focused source pins: allowlist exists, the guard NEGATES it (so dev/docs
// routes are exempted, not redirected), and the product guard is untouched.
expect('router defines dev/docs route allowlist containing /ops/screens',
  /const\s+DEV_DOCS_ROUTES\s*=\s*new\s+Set\(\s*\[\s*['"]\/ops\/screens['"]\s*\]\s*\)/.test(router));
expect('welcome guard exempts dev/docs routes via negated allowlist',
  /!\s*DEV_DOCS_ROUTES\.has\(path\)/.test(router));
expect('welcome guard still redirects first-run non-welcome routes to /welcome',
  /!\s*u\.welcomeSeen/.test(router)
  && /path\s*!==\s*['"]\/welcome['"]/.test(router)
  && /go\(\s*['"]\/welcome['"]\s*\)/.test(router));

// ── C. Registry seed (the 9 MVP screens from #623) ──
const MVP_IDS = ['BD-FEED-01', 'BD-COMPOSER-01', 'BD-PROFILE-01', 'BD-RESPOND-01',
  'BD-CHAT-01', 'BD-RULES-01', 'BD-RIDE-D-02', 'BD-RIDE-P-01', 'BD-MAP-01'];
const have = getScreens().map((s) => s.id);
for (const id of MVP_IDS) expect(`registry includes ${id}`, have.includes(id));
const REQ_FIELDS = ['id', 'title', 'route', 'file', 'role', 'contractStatus', 'designStatus', 'melStatus', 'implementationStatus'];
expect('every registry entry carries the required fields',
  getScreens().every((s) => REQ_FIELDS.every((k) => s[k] !== undefined && s[k] !== '')));

// ── D. Templates export generators that embed route/file/id ──
const sample = { id: 'BD-SAMPLE-01', title: 'Sample', route: '/sample', file: 'public/src/screens/sample.js', role: 'shared' };
const mel = { problem: 'p', requiredRepair: 'r', operationalDecision: 'd' };
for (const [name, fn] of [
  ['cloud-design', generateCloudDesignPrompt],
  ['github-issue', generateGithubIssueBody],
  ['claude-code', generateClaudeCodePrompt],
]) {
  expect(`${name} template exports a generator`, typeof fn === 'function');
  const out = fn(sample, mel);
  expect(`${name} prompt embeds screen id + route + file`,
    out.includes(sample.id) && out.includes(sample.route) && out.includes(sample.file));
}
const card = { id: 'mel_x', screenId: 'BD-SAMPLE-01', route: '/sample', file: 'f.js' };
const cardOut = renderMelCard(card);
expect('mel card renderer embeds screen id + route + file',
  typeof renderMelCard === 'function'
  && cardOut.includes(card.screenId) && cardOut.includes(card.route) && cardOut.includes(card.file));

// ── E. MEL store key + dev-only clear is NOT wired into the screen UI ──
expect('mel store uses the bazardrive.ops.mel.v1 key',
  /bazardrive\.ops\.mel\.v1/.test(storeSrc));
expect('store exports clearOpsMel for explicit dev use',
  /export\s+function\s+clearOpsMel\s*\(/.test(storeSrc));
expect('screen does NOT wire destructive clearOpsMel into the UI',
  !/clearOpsMel/.test(screenSrc) && !/data-action="clear-mel"/.test(screenSrc));

// ── F. No hard-coded credentials (assignment-like patterns, not prose) ──
// Detects `apiKey = "…"`, `token: "…"`, `password = '…'` with a real value —
// NOT the mere mention of those words, so templates can warn about credentials.
const CRED = /\b(api[_-]?key|secret|passwd|password|token|client[_-]?secret|private[_-]?key)\s*[:=]\s*['"`][^'"`]+['"`]/i;
for (const [name, src] of [
  ['ops_screens.js', screenSrc],
  ['ops_registry.js', registrySrc],
  ['ops_mel_store.js', storeSrc],
  ['cloud_design_prompt_template.js', tplCloud],
  ['github_issue_template.js', tplGithub],
  ['claude_code_prompt_template.js', tplClaude],
  ['screen_mel_card_template.js', tplMel],
]) {
  expect(`no hard-coded credential assignment in ${name}`, !CRED.test(src));
}

// ── G. Service worker precache (EVERY new BD-OPS-03 runtime file) ──
const OPS_PRECACHE = [
  './src/screens/ops_screens.js',
  './src/ops/ops_registry.js',
  './src/ops/ops_mel_store.js',
  './src/ops/templates/cloud_design_prompt_template.js',
  './src/ops/templates/github_issue_template.js',
  './src/ops/templates/claude_code_prompt_template.js',
  './src/ops/templates/screen_mel_card_template.js',
];
for (const p of OPS_PRECACHE) {
  expect(`sw.js precaches ${p}`, sw.includes(`'${p}'`));
}

// ── H. Scoped CSS atoms exist ──
expect('cloud.css defines the ScreenOps atoms',
  /\.screen--ops-screens\s*\{/.test(css) && /\.ops-reg__item\b/.test(css));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
