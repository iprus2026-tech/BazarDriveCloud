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
const blastSrc = read('../public/src/ops/blast_radius.js');
const connRepo = read('../public/src/ops/connectors/repo_connector.js');
const connContracts = read('../public/src/ops/connectors/screen_contracts_connector.js');
const connCloud = read('../public/src/ops/connectors/cloud_design_connector.js');
const connGithub = read('../public/src/ops/connectors/github_issue_connector.js');
const connClaude = read('../public/src/ops/connectors/claude_code_connector.js');
const connChecks = read('../public/src/ops/connectors/checks_connector.js');
const tplAudit = read('../public/src/ops/templates/audit_recipe_template.js');
const connAudit = read('../public/src/ops/connectors/audit_recipe_connector.js');

// Pure modules are safe to import in Node (no browser globals at module load).
const { getScreens } = await import(new URL('../public/src/ops/ops_registry.js', import.meta.url));
const { generateCloudDesignPrompt } = await import(new URL('../public/src/ops/templates/cloud_design_prompt_template.js', import.meta.url));
const { generateGithubIssueBody } = await import(new URL('../public/src/ops/templates/github_issue_template.js', import.meta.url));
const { generateClaudeCodePrompt } = await import(new URL('../public/src/ops/templates/claude_code_prompt_template.js', import.meta.url));
const { renderMelCard } = await import(new URL('../public/src/ops/templates/screen_mel_card_template.js', import.meta.url));
const { computeBlastRadius, SHARED_SURFACE_MAP } = await import(new URL('../public/src/ops/blast_radius.js', import.meta.url));
const { getScreenFacts, listScreenFacts } = await import(new URL('../public/src/ops/connectors/repo_connector.js', import.meta.url));
const { getContractFacts } = await import(new URL('../public/src/ops/connectors/screen_contracts_connector.js', import.meta.url));
const { buildCloudDesignPrompt } = await import(new URL('../public/src/ops/connectors/cloud_design_connector.js', import.meta.url));
const { buildGithubIssue } = await import(new URL('../public/src/ops/connectors/github_issue_connector.js', import.meta.url));
const { buildClaudeCodePrompt } = await import(new URL('../public/src/ops/connectors/claude_code_connector.js', import.meta.url));
const { buildCheckCommands } = await import(new URL('../public/src/ops/connectors/checks_connector.js', import.meta.url));
const { generateAuditRecipe } = await import(new URL('../public/src/ops/templates/audit_recipe_template.js', import.meta.url));
const { buildAuditRecipe } = await import(new URL('../public/src/ops/connectors/audit_recipe_connector.js', import.meta.url));

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

// ── B2. Dev/docs route policy (BD-OPS-03/09) ──
// Focused source pins: allowlist exists, the guard NEGATES it (so dev/docs
// routes are exempted, not redirected), and the same allowlist hides product
// chrome/tabbar/FAB without broadening the product HIDE_CHROME list.
expect('router defines dev/docs route allowlist containing /ops/screens',
  /const\s+DEV_DOCS_ROUTES\s*=\s*new\s+Set\(\s*\[\s*['"]\/ops\/screens['"]\s*\]\s*\)/.test(router));
expect('welcome guard exempts dev/docs routes via negated allowlist',
  /const\s+isDevDocsRoute\s*=\s*DEV_DOCS_ROUTES\.has\(path\)/.test(router)
  && /!\s*isDevDocsRoute/.test(router));
expect('/ops/screens hides product chrome via the dev/docs route policy',
  /const\s+noChrome\s*=\s*!\s*u\.welcomeSeen\s*\|\|\s*HIDE_CHROME\.has\(path\)\s*\|\|\s*isDevDocsRoute/.test(router));
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
// BD-OPS — the Claude Code prompt bakes in the smoke-suite intent guard: a
// "confirmed" MEL can be intentionally-pinned behavior, so cross-check before fixing.
const ccPrompt = generateClaudeCodePrompt(sample, mel);
expect('claude-code prompt embeds the smoke cross-check step (grep -rlE, file OR route)',
  /cross-check the smoke suite/i.test(ccPrompt)
  && /grep -rlE "[^"]+" scripts\/smoke-\*\.mjs/.test(ccPrompt)
  && ccPrompt.includes('sample\\.js') && ccPrompt.includes('/sample'));
expect('claude-code prompt warns against editing a pin to force the fix',
  /never edit a pin/i.test(ccPrompt));
const card = { id: 'mel_x', screenId: 'BD-SAMPLE-01', route: '/sample', file: 'f.js' };
const cardOut = renderMelCard(card);
expect('mel card renderer embeds screen id + route + file',
  typeof renderMelCard === 'function'
  && cardOut.includes(card.screenId) && cardOut.includes(card.route) && cardOut.includes(card.file));

// ── D2. MEL reachability field (BD-OPS / #684 #3) — triage by real impact ──
// reachability is SEPARATE from severity: a code-severe MEL reachable only via a
// dev/QA param is lower-priority than a user-path one. Pinned end-to-end:
// store vocab + validation, the card renderer, and the dashboard editor select.
expect('store exports MEL_REACHABILITY = [user-path, dev-param, edge]',
  /export const MEL_REACHABILITY\s*=\s*\[[^\]]*'user-path'[^\]]*'dev-param'[^\]]*'edge'[^\]]*\]/.test(storeSrc));
expect('createMelCard validates + defaults reachability to user-path',
  /reachability:\s*MEL_REACHABILITY\.includes\(input\.reachability\)\s*\?\s*input\.reachability\s*:\s*'user-path'/.test(storeSrc));
expect('updateMelCard validates reachability against the vocab',
  /reachability:\s*MEL_REACHABILITY\.includes\(reachCandidate\)/.test(storeSrc));
expect('renderMelCard renders the Reachability line (value + default)',
  renderMelCard({ id: 'mel_r', screenId: 'BD-X', route: '/x', file: 'x.js', reachability: 'dev-param' }).includes('Reachability: dev-param')
  && renderMelCard({}).includes('Reachability: user-path'));
expect('dashboard imports MEL_REACHABILITY and renders the reachability select',
  /MEL_REACHABILITY/.test(screenSrc)
  && /id="mel-reachability"[\s\S]{0,90}optionList\(MEL_REACHABILITY/.test(screenSrc));
expect('dashboard mirrors the reachability select into form state + the save payload',
  /mel-reachability'\)\s*state\.melForm\.reachability\s*=/.test(screenSrc)
  && /reachability:\s*read\('#mel-reachability'\)/.test(screenSrc));

// ── D3. Blast-radius / shared-state map (BD-OPS / #684 #9) — what ELSE a repair
// touches. The #685 cross-check confirms a behavior is SAFE to change (not pinned);
// it does NOT enumerate the downstream consumers of a shared store/id a repair
// writes — the class that took BD-RESPONSES-01 (#688) three Codex rounds. Pinned:
// the curated map, the detection, the MEL-card block, and the prompt Step 0c + the
// strengthened Step 0 clause.
expect('blast_radius maps ride_orders -> Feed + DriverMap + Responses and tripId -> chat/history/receipts',
  Array.isArray(SHARED_SURFACE_MAP)
  && SHARED_SURFACE_MAP.some((e) => e.key === 'ride_orders'
    && /Feed/.test(e.surfaces.join(' ')) && /DriverMap/.test(e.surfaces.join(' ')) && /Responses/.test(e.surfaces.join(' ')))
  && SHARED_SURFACE_MAP.some((e) => e.key === 'tripId'
    && /chat/i.test(e.surfaces.join(' ')) && /history/i.test(e.surfaces.join(' ')) && /receipt/i.test(e.surfaces.join(' '))));
expect('computeBlastRadius matches free-text + mutation-API mentions, and nothing for an unrelated one',
  computeBlastRadius({ requiredRepair: 'point the seed at a real ride-order id' }).some((e) => e.key === 'ride_orders')
  && computeBlastRadius({ problem: 'fix updateTripStatus terminal handling' }).some((e) => e.key === 'ride_orders')
  && computeBlastRadius({ problem: 'reuses a fixed trip id across lifecycles' }).some((e) => e.key === 'tripId')
  && computeBlastRadius({ problem: 'pure visual spacing tweak' }).length === 0);
const cardShared = renderMelCard({ id: 'mel_b', screenId: 'BD-X', route: '/x', file: 'x.js', requiredRepair: 'write the ride_orders store' });
expect('renderMelCard renders a Blast radius block (named surfaces when matched, reminder when not)',
  cardShared.includes('Blast radius') && /Feed|DriverMap/.test(cardShared)
  && renderMelCard({ id: 'mel_c', screenId: 'BD-X', route: '/x', file: 'x.js' }).includes('Blast radius'));
expect('claude-code prompt embeds Step 0c + the safe-to-change/not-blast-radius clause',
  /Step 0c[^\n]*blast radius/i.test(ccPrompt)
  && /safe to change[\s\S]{0,90}not[\s\S]{0,50}blast radius/i.test(ccPrompt));
expect('claude-code prompt lists the shared consumer surfaces when the repair writes a shared store',
  /Feed|DriverMap/.test(generateClaudeCodePrompt(sample, { requiredRepair: 'write the ride_orders store' })));

// ── D4. Data-model viability (BD-OPS / #684 #8) — is the fix CONSTRUCTIBLE?
// The audit can confirm a defect against the code, but BD-RESPONSES-01 (#688)
// showed it can still propose a non-viable repair (point a seed at a runtime-
// created order id that has no static value). The registry now carries an optional
// data-model fact, and the repair prompt emits a Step 0b viability slice.
expect('registry seeds a runtime ride_orders data-model fact (order-map-draft is the creator)',
  /ride_orders/.test((getScreenFacts('BD-MAP-05').dataModel || {}).store || '')
  && getScreenFacts('BD-MAP-05').dataModel.runtimeCreated === true);
const ccPromptDM = generateClaudeCodePrompt(getScreenFacts('BD-MAP-05'), mel);
expect('claude-code Step 0b names the store + runtime-created when the screen declares a data model',
  /Step 0b[^\n]*repair viability/i.test(ccPromptDM)
  && /ride_orders/.test(ccPromptDM) && /CREATED AT RUNTIME/i.test(ccPromptDM));
expect('claude-code Step 0b falls back to a generic static-seed-vs-runtime-store reminder when none is declared',
  /Step 0b[^\n]*repair viability/i.test(ccPrompt)
  && /static seed[\s\S]{0,60}runtime store/i.test(ccPrompt));
// Codex #691 — the facts must be ACCURATE, not coarse: Order Detail is a STATIC
// fixture (not runtime ride_orders); Responses spans the order + offer stores; an
// active ride can also be keyed feed-<postId>.
expect('Order Detail declares a STATIC fixture model (not runtime ride_orders)',
  getScreenFacts('BD-ORDER-DETAIL-01').dataModel.runtimeCreated === false
  && /fixture/i.test(getScreenFacts('BD-ORDER-DETAIL-01').dataModel.store || ''));
expect('Responses + active-ride facts name their full data surfaces (offer store; both tripId namespaces)',
  /respons|offer/i.test(JSON.stringify(getScreenFacts('BD-RESPONSES-01').dataModel))
  && /feed-/.test(JSON.stringify(getScreenFacts('BD-RIDE-P-01').dataModel)));

// ── D5. Selector/symbol anchoring (BD-OPS / #684 #2) — findings drift off line
// numbers. Every Driver-Profile fix this series started by re-grepping the selector
// because the audit's line was stale. The MEL now carries a stable selector anchor,
// the card + prompt render it, and the prompt bakes in a grep-locate so the agent
// re-resolves the CURRENT line instead of trusting a recorded one.
expect('mel store seeds an optional selector anchor on createMelCard',
  /selector:\s*typeof input\.selector === 'string'\s*\?\s*input\.selector\s*:\s*''/.test(storeSrc));
expect('renderMelCard renders the Anchor line (value when set, reminder when not)',
  renderMelCard({ id: 'mel_s', screenId: 'BD-X', route: '/x', file: 'x.js', selector: '#pf2-doc-add' }).includes('#pf2-doc-add')
  && /Anchor/.test(renderMelCard({ id: 'mel_s', screenId: 'BD-X', route: '/x', file: 'x.js', selector: '#pf2-doc-add' }))
  && /Anchor[^\n]*none/i.test(renderMelCard({ id: 'mel_s2', screenId: 'BD-X', route: '/x', file: 'x.js' })));
expect('claude-code prompt anchors on the selector + bakes in a LITERAL grep-locate (no stale line, no regex pitfalls)',
  /Anchor:\s*markGarageVehicleActive[\s\S]{0,90}grep -nF -- 'markGarageVehicleActive'/.test(
    generateClaudeCodePrompt(sample, { selector: 'markGarageVehicleActive', problem: 'p' }))
  && generateClaudeCodePrompt(sample, { selector: '[data-action="report-order"]', problem: 'p' })
    .includes(`grep -nF -- '[data-action="report-order"]'`)
  && /Anchor:[^\n]*none recorded/i.test(generateClaudeCodePrompt(sample, { problem: 'p' })));
expect('dashboard exposes a #mel-selector input + mirrors it into form state and the save payload',
  /id="mel-selector"/.test(screenSrc)
  && /mel-selector'\)\s*state\.melForm\.selector\s*=/.test(screenSrc)
  && /selector:\s*read\('#mel-selector'\)\.trim\(\)/.test(screenSrc));

// ── D6. MEL → PR / commit link (BD-OPS / #684 #4) — the DETECTED…DONE lifecycle
// had no link to what shipped; the MEL→ship trail (F4 → #683 → merged) lived only
// in chat. The MEL now carries a pr/commit reference, rendered on the card.
expect('mel store seeds an optional pr (resolution) reference on createMelCard',
  /pr:\s*typeof input\.pr === 'string'\s*\?\s*input\.pr\s*:\s*''/.test(storeSrc));
expect('renderMelCard renders the Resolved-by (PR / commit) line (value when set, unresolved when not)',
  renderMelCard({ id: 'mel_p', screenId: 'BD-X', route: '/x', file: 'x.js', pr: '#683' }).includes('#683')
  && /Resolved by/.test(renderMelCard({ id: 'mel_p', screenId: 'BD-X', route: '/x', file: 'x.js', pr: '#683' }))
  && /Resolved by[^\n]*unresolved/i.test(renderMelCard({ id: 'mel_p2', screenId: 'BD-X', route: '/x', file: 'x.js' })));
expect('dashboard exposes a #mel-pr input + mirrors it into form state and the save payload',
  /id="mel-pr"/.test(screenSrc)
  && /mel-pr'\)\s*state\.melForm\.pr\s*=/.test(screenSrc)
  && /pr:\s*read\('#mel-pr'\)\.trim\(\)/.test(screenSrc));
expect('saved MEL cards expose a Set-PR path so pr is settable when the fix ships (not only at creation)',
  /data-action="set-pr"/.test(screenSrc)
  && /case 'set-pr'\s*:/.test(screenSrc)
  && /updateMelCard\(\s*id\s*,\s*\{\s*pr:/.test(screenSrc));

// ── D7. Audit recipe (BD-OPS / #684 #5) — a reproducible FIND-MELs brief per
// screen (the multi-agent audit was re-improvised each session). It enumerates the
// audit dimensions incl. the data-model (#8) + lifecycle (#10) lenses, bakes in the
// smoke cross-check (#1), adversarial verify, the selector anchor (#2) and a
// severity+reachability (#3) synthesis; the connector appends the contract anchor.
const auditRecipe = generateAuditRecipe(getScreenFacts('BD-RESPONSES-01'));
expect('audit recipe embeds screen id + route + file',
  auditRecipe.includes('BD-RESPONSES-01') && auditRecipe.includes('/responses') && auditRecipe.includes('responses.js'));
expect('audit recipe enumerates explicit dimensions incl. data-model (#8) + lifecycle (#10 entry-states) + blast-radius (#9)',
  /Dimensions/i.test(auditRecipe)
  && /data-model viability/i.test(auditRecipe)
  && /lifecycle\s*\/\s*entry-state/i.test(auditRecipe)
  && /blast-radius/i.test(auditRecipe)
  && /first-entry[\s\S]*terminal[\s\S]*re-entry/i.test(auditRecipe));
expect('audit recipe bakes in the smoke cross-check (#1), adversarial verify, selector anchor (#2) + reachability synthesis (#3)',
  /cross-check[\s\S]*grep -rlE "[^"]+" scripts\/smoke-\*\.mjs/i.test(auditRecipe)
  && /adversarial[\s\S]*refute/i.test(auditRecipe)
  && /selector\s*\/\s*symbol/i.test(auditRecipe)
  && /reachability[\s\S]*user-path[\s\S]*dev-param[\s\S]*edge/i.test(auditRecipe));
expect('audit recipe embeds the screen data-model fact (responses → ride_orders order context)',
  /ride_orders/i.test(auditRecipe));
expect('buildAuditRecipe connector returns the recipe + a contract anchor',
  buildAuditRecipe('BD-RESPONSES-01').includes('Audit recipe: BD-RESPONSES-01')
  && /Contract:/.test(buildAuditRecipe('BD-RESPONSES-01')));
expect('dashboard wires the gen-audit button + handler to buildAuditRecipe',
  /data-action="gen-audit"/.test(screenSrc)
  && /case 'gen-audit'/.test(screenSrc)
  && /buildAuditRecipe\(s\.id\)/.test(screenSrc));

// ── D8. Lifecycle / entry-state field (BD-OPS / #684 #10) — which entry-states the
// audit PROBED, separate from #3 reachability (HOW it's reached). All three
// BD-RESPONSES-01 (#688) rounds were entry-state edges the single-tap audit missed.
// Pinned end-to-end: store vocab + validation, the card checklist, the dashboard
// multi-select.
expect('store exports MEL_LIFECYCLE_STATES = [first-entry, live-mid-flow, terminal, re-entry]',
  /export const MEL_LIFECYCLE_STATES\s*=\s*\[[^\]]*'first-entry'[^\]]*'live-mid-flow'[^\]]*'terminal'[^\]]*'re-entry'[^\]]*\]/.test(storeSrc));
expect('createMelCard validates lifecycleAudited against the vocab (array, dedup + canonical order)',
  /lifecycleAudited:\s*sanitizeLifecycle\(input\.lifecycleAudited\)/.test(storeSrc)
  && /function sanitizeLifecycle[\s\S]{0,160}MEL_LIFECYCLE_STATES\.filter/.test(storeSrc));
expect('updateMelCard validates lifecycleAudited against the vocab',
  /lifecycleAudited:\s*sanitizeLifecycle\(lcCandidate\)/.test(storeSrc));
expect('renderMelCard renders the Lifecycle-audited checklist (probed [x], gaps [ ])',
  renderMelCard({ id: 'mel_l', screenId: 'BD-X', route: '/x', file: 'x.js', lifecycleAudited: ['first-entry', 'terminal'] }).includes('Lifecycle audited')
  && /first-entry \[x\][\s\S]*live-mid-flow \[ \][\s\S]*terminal \[x\][\s\S]*re-entry \[ \]/.test(
    renderMelCard({ id: 'mel_l', screenId: 'BD-X', route: '/x', file: 'x.js', lifecycleAudited: ['first-entry', 'terminal'] })));
expect('renderMelCard canonicalises the checklist (junk values render no extra marks; order is the vocab order)',
  /first-entry \[ \] · live-mid-flow \[ \] · terminal \[ \] · re-entry \[ \]/.test(
    renderMelCard({ id: 'mel_l2', screenId: 'BD-X', route: '/x', file: 'x.js', lifecycleAudited: ['bogus', 'not-a-state'] })));
expect('dashboard exposes a #mel-lifecycle multi-select + mirrors it (selectedOptions) into form state + save',
  /id="mel-lifecycle"[^>]*multiple/.test(screenSrc)
  && /MEL_LIFECYCLE_STATES/.test(screenSrc)
  && /mel-lifecycle'\)\s*state\.melForm\.lifecycleAudited\s*=\s*Array\.from\(t\.selectedOptions\)/.test(screenSrc)
  && /lifecycleAudited:\s*Array\.from\(\(detailEl\.querySelector\('#mel-lifecycle'\)/.test(screenSrc));

// ── D9. Screen-aware must-not-touch guardrails (BD-OPS / #684 #7) — the repair
// prompt's must-not list was generic; every garage/profile fix re-typed the
// no-mutation guardrail by hand. The registry now carries per-screen guardrails,
// appended (tagged by screen id) to the prompt's must-not-touch list.
expect('registry seeds screen-specific guardrails (profile garage no-mutation, responses select-handoff)',
  Array.isArray(getScreenFacts('BD-PROFILE-01').guardrails)
  && /garage[\s\S]*S24/i.test(getScreenFacts('BD-PROFILE-01').guardrails.join(' '))
  && /!canonicalOrder/.test((getScreenFacts('BD-RESPONSES-01').guardrails || []).join(' '))
  && Array.isArray(getScreenFacts('BD-RIDE-P-01').guardrails));
expect('claude-code prompt appends the screen-specific guardrails to Must-not-touch (tagged by screen id)',
  /Must not touch[\s\S]*- \[BD-PROFILE-01\][\s\S]*garage/i.test(generateClaudeCodePrompt(getScreenFacts('BD-PROFILE-01'), mel)));
expect('claude-code prompt omits screen guardrails for a screen with none (generic list only)',
  !/- \[BD-SAMPLE-01\]/.test(generateClaudeCodePrompt({ id: 'BD-SAMPLE-01', route: '/x', file: 'x.js' }, mel)));

// ── D10. Cloud Design prompt injects tokens + the screen's CSS atoms (BD-OPS / #684 #11) ──
// The generic "reuse existing tokens" line let the BD-CHAT-01 port land cleanly only
// because the Claude Design prototype happened to match token names. The prompt now
// injects the real :root palette + the screen's cssAtoms reuse contract, so a returned
// design maps onto the runtime instead of forking a parallel class system.
const cdChatFacts = getScreenFacts('BD-CHAT-01');
const cdChat = generateCloudDesignPrompt(cdChatFacts, mel);
expect('registry seeds BD-CHAT-01 cssAtoms (the reuse contract)',
  Array.isArray(cdChatFacts.cssAtoms) && cdChatFacts.cssAtoms.length >= 6);
expect('cloud-design prompt injects the runtime token palette (not a generic reuse line)',
  /--bg-2/.test(cdChat) && /--text-3/.test(cdChat) && /--accent\b/.test(cdChat) && /--line-strong/.test(cdChat));
expect('cloud-design prompt injects each of the screen cssAtoms as the reuse contract',
  cdChatFacts.cssAtoms.every((a) => cdChat.includes(a)));
expect('cloud-design prompt degrades to a generic atoms line when a screen has no cssAtoms',
  !/restyle in place/.test(generateCloudDesignPrompt({ id: 'BD-SAMPLE-01', route: '/x', file: 'x.js', role: 'shared' }, mel)));
// Anti-drift: every token the palette advertises must actually exist in cloud.css :root.
const cdPaletteLine = (cdChat.match(/--bg-0[^\n]*/) || [''])[0];
const cdTokens = [...new Set(cdPaletteLine.match(/--[a-z0-9-]+/g) || [])];
expect('every Cloud-Design-advertised token exists in cloud.css :root (no drift)',
  cdTokens.length >= 10 && cdTokens.every((t) => new RegExp('\\' + t + '\\s*:').test(css)));

// ── D11. Cloud Design "Required states" driven by the MEL lifecycle audit (BD-OPS / #684 #12) ──
// The generic "default/loading/empty/error" list didn't name the lifecycle states the
// audit actually found missing (BD-CHAT-01: first-entry empty, terminal). The prompt now
// derives the required states from mel.lifecycleAudited (#10); every store lifecycle state
// must have a design brief here (anti-drift), and it degrades without the field.
const lifeMatch = storeSrc.match(/MEL_LIFECYCLE_STATES\s*=\s*\[([^\]]*)\]/);
const lifeStates = (lifeMatch ? (lifeMatch[1].match(/'[^']+'/g) || []) : []).map((s) => s.replace(/'/g, ''));
const cdAllStates = generateCloudDesignPrompt(
  { id: 'BD-X', route: '/x', file: 'x.js', role: 'shared' },
  { problem: 'p', requiredRepair: 'r', lifecycleAudited: lifeStates });
expect('Required-states renders a brief for every store lifecycle state (driven by mel.lifecycleAudited, #12)',
  lifeStates.length >= 4 && lifeStates.every((s) => cdAllStates.includes(s)));
const cdNoStates = generateCloudDesignPrompt(
  { id: 'BD-X', route: '/x', file: 'x.js', role: 'shared' }, { problem: 'p', requiredRepair: 'r' });
expect('Required-states degrades to the generic checklist without mel.lifecycleAudited (#12)',
  /default \/ loading \/ empty \/ error/.test(cdNoStates)
  && /lifecycle entry-states this screen must cover/i.test(cdAllStates)
  && !/lifecycle entry-states this screen must cover/i.test(cdNoStates));

// ── D12. Repair prompt flags SW-precache membership + the VERSION-bump rule (BD-OPS / #684 #13) ──
// A repair editing a precached file must bump the SW cache or installed clients keep the
// stale copy (the #701 / #705 v-collision lesson). cloud.css is ALWAYS allowed + precached,
// so the Service-worker section always emits (Codex #706); it names the screen file too when
// that is precached, adds public/sw.js (VERSION only) to Allowed files, and carries the
// bump-above-main + parallel-sequence rule.
const ccPrecached = generateClaudeCodePrompt(
  { id: 'BD-CHAT-01', route: '/chat', file: 'public/src/screens/chat.js', role: 'shared' }, mel);
expect('claude-code prompt emits the SW VERSION-bump obligation, naming the precached screen file (#13)',
  /Service worker \/ cache/i.test(ccPrecached)
  && ccPrecached.includes('public/src/screens/chat.js')
  && /bump '?const VERSION'?[\s\S]{0,80}ABOVE the current main VERSION/i.test(ccPrecached));
expect('claude-code prompt SW note warns about parallel-PR version sequencing (#13)',
  /sequence your VERSION ABOVE it/i.test(ccPrecached)
  && /second to merge ships NO cache change/i.test(ccPrecached));
expect('claude-code prompt adds public/sw.js (VERSION only) to Allowed files (#13, Codex #706)',
  /Allowed files[\s\S]*public\/sw\.js[\s\S]{0,40}VERSION/i.test(ccPrecached));
// cloud.css is always allowed + precached, so the SW section must STILL emit even when the
// screen file itself is not precached (a CSS-only repair changes the precached stylesheet).
const ccCssOnly = generateClaudeCodePrompt(
  { id: 'BD-X', route: '/x', file: 'docs/x.md', role: 'shared' }, mel);
expect('claude-code prompt STILL emits the SW section for a non-precached screen file via cloud.css (#13, Codex #706)',
  /Service worker \/ cache/i.test(ccCssOnly) && /public\/styles\/cloud\.css/.test(ccCssOnly));

// ── D13. Repair prompt carries a pre-PR self-review of the Codex-caught classes (BD-OPS / #684 #16) ──
// The two mechanical defect classes that each cost a review round — a smoke pin matching a
// DECLARATION not the call site (#697), and an un-bumped / colliding SW VERSION (#701 / #705)
// — are checkable before opening the PR. The prompt now appends a "Before you push" self-review.
const ccReview = generateClaudeCodePrompt(
  { id: 'BD-CHAT-01', route: '/chat', file: 'public/src/screens/chat.js', role: 'shared' }, mel);
expect('claude-code prompt appends a "Before you push" self-review block (#16)',
  /Before you push \(self-review\)/i.test(ccReview));
expect('self-review flags the call-site (not declaration) smoke-pin class #697 and the SW-bump class #701/#705',
  /CALL SITE[\s\S]{0,220}regress[\s\S]{0,160}#697/i.test(ccReview)
  && /Service worker[\s\S]{0,160}VERSION[\s\S]{0,160}#701 \/ #705/i.test(ccReview));

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
  ['blast_radius.js', blastSrc],
  ['cloud_design_prompt_template.js', tplCloud],
  ['github_issue_template.js', tplGithub],
  ['claude_code_prompt_template.js', tplClaude],
  ['screen_mel_card_template.js', tplMel],
  ['connectors/repo_connector.js', connRepo],
  ['connectors/screen_contracts_connector.js', connContracts],
  ['connectors/cloud_design_connector.js', connCloud],
  ['connectors/github_issue_connector.js', connGithub],
  ['connectors/claude_code_connector.js', connClaude],
  ['connectors/checks_connector.js', connChecks],
  ['templates/audit_recipe_template.js', tplAudit],
  ['connectors/audit_recipe_connector.js', connAudit],
]) {
  expect(`no hard-coded credential assignment in ${name}`, !CRED.test(src));
}

// ── G. Service worker precache (EVERY new BD-OPS-03 runtime file) ──
const OPS_PRECACHE = [
  './src/screens/ops_screens.js',
  './src/ops/ops_registry.js',
  './src/ops/ops_mel_store.js',
  './src/ops/blast_radius.js',
  './src/ops/templates/cloud_design_prompt_template.js',
  './src/ops/templates/github_issue_template.js',
  './src/ops/templates/claude_code_prompt_template.js',
  './src/ops/templates/screen_mel_card_template.js',
  './src/ops/templates/audit_recipe_template.js',
  './src/ops/connectors/repo_connector.js',
  './src/ops/connectors/screen_contracts_connector.js',
  './src/ops/connectors/cloud_design_connector.js',
  './src/ops/connectors/github_issue_connector.js',
  './src/ops/connectors/claude_code_connector.js',
  './src/ops/connectors/checks_connector.js',
  './src/ops/connectors/audit_recipe_connector.js',
];
for (const p of OPS_PRECACHE) {
  expect(`sw.js precaches ${p}`, sw.includes(`'${p}'`));
}
// VERSION must be bumped whenever precached file contents change, or installed
// clients keep serving the stale cache (house convention: other precache smokes
// pin a VERSION floor). Floor is raised each time the ops runtime changes.
const swVer = sw.match(/const\s+VERSION\s*=\s*'v(\d+)'/);
expect('sw.js VERSION is present and >= v194 (floor raised with the pre-push self-review bump)',
  !!swVer && Number(swVer[1]) >= 194);

// ── H. Scoped CSS atoms exist ──
expect('cloud.css defines the ScreenOps atoms',
  /\.screen--ops-screens\s*\{/.test(css) && /\.ops-reg__item\b/.test(css));
// ScreenOps breaks out of the 430px phone shell to full width (tablet/landscape).
expect('cloud.css lets the ScreenOps shell use the full viewport width',
  /#shell:has\(\.screen--ops-screens\)\s*\{[^}]*max-width:\s*none/.test(css));

// ── I. Clipboard copy reports success only after the write resolves (P3) ──
expect('copy() reports success only after writeText resolves (then-branch)',
  /writeText\([^)]*\)\s*\.then\(/.test(screenSrc));
expect('copy() surfaces a manual-fallback message on clipboard failure',
  /Copy failed\. Select the text manually\./.test(screenSrc));
expect('copy() does not swallow clipboard failure as success (no empty catch)',
  !/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(screenSrc));

// ── J. "Open screen" works from a clean profile WITHOUT broadly exempting product routes (P3) ──
expect('ops_screens imports user state from state.js',
  /import\s*\{[^}]*\buser\b[^}]*\}\s*from\s*'\.\.\/state\.js'/.test(screenSrc));
expect('open-screen seeds welcomeSeen so a clean-profile dev navigation is not bounced to /welcome',
  /user\.set\(\s*\{\s*welcomeSeen:\s*true\s*\}\s*\)/.test(screenSrc));
expect('router still exempts ONLY /ops/screens (no product routes added to DEV_DOCS_ROUTES)',
  /const\s+DEV_DOCS_ROUTES\s*=\s*new\s+Set\(\s*\[\s*['"]\/ops\/screens['"]\s*\]\s*\)/.test(router)
  && !/DEV_DOCS_ROUTES\s*=\s*new\s+Set\(\s*\[[^\]]*\/(feed|profile|map|active-ride|chat|respond|new|order|responses|rules|inbox)\b/.test(router));

// ── K. Connector layer (BD-OPS-03b) — dashboard talks to connectors, not templates ──
expect('repo_connector exports getScreenFacts + listScreenFacts',
  typeof getScreenFacts === 'function' && typeof listScreenFacts === 'function');
expect('screen_contracts_connector exports getContractFacts',
  typeof getContractFacts === 'function');
expect('cloud_design_connector exports buildCloudDesignPrompt',
  typeof buildCloudDesignPrompt === 'function');
expect('github_issue_connector exports buildGithubIssue',
  typeof buildGithubIssue === 'function');
expect('claude_code_connector exports buildClaudeCodePrompt',
  typeof buildClaudeCodePrompt === 'function');
expect('checks_connector exports buildCheckCommands',
  typeof buildCheckCommands === 'function');

// Prompt connectors embed route+file+id for a real registry screen and append the contract ref.
const cid = 'BD-FEED-01';
const cmel = { problem: 'p', requiredRepair: 'r' };
for (const [name, fn] of [
  ['cloud_design', buildCloudDesignPrompt],
  ['github_issue', buildGithubIssue],
  ['claude_code', buildClaudeCodePrompt],
]) {
  const out = fn(cid, cmel);
  expect(`${name} connector output embeds id + route + file`,
    out.includes('BD-FEED-01') && out.includes('/feed') && out.includes('public/src/screens/feed.js'));
  expect(`${name} connector appends the contract reference`,
    out.includes('Contract: docs/screen-contracts.md#bd-feed-01'));
}
expect('prompt connector returns empty string for an unknown screen id',
  buildCloudDesignPrompt('NOPE-404', {}) === '');
expect('checks_connector returns the check command set',
  /node scripts\/check\.mjs/.test(buildCheckCommands(cid)));
const feedChecks = buildCheckCommands(cid);
expect('checks_connector prepends a smoke cross-check grep (by file AND route)',
  /grep -rlE "/.test(feedChecks) && feedChecks.includes('feed\\.js') && feedChecks.includes('/feed'));
// Codex #685 — route-pinned screens (e.g. Route Picker) must be searched by route
// too, not just filename, or the guard silently misses the pin.
expect('checks_connector cross-check searches by route for route-pinned screens',
  buildCheckCommands('BD-MAP-03').includes('/route-picker'));
expect('repo_connector surfaces registry facts (route + file) for a screen',
  (getScreenFacts(cid) || {}).route === '/feed' && (getScreenFacts(cid) || {}).file === 'public/src/screens/feed.js');
expect('screen_contracts_connector derives a contract anchor',
  (getContractFacts(cid) || {}).contractAnchor === 'docs/screen-contracts.md#bd-feed-01');

// ops_screens.js talks to the connectors, NOT the prompt templates directly.
expect('ops_screens imports the prompt + checks connectors',
  /from\s+'\.\.\/ops\/connectors\/cloud_design_connector\.js'/.test(screenSrc)
  && /from\s+'\.\.\/ops\/connectors\/github_issue_connector\.js'/.test(screenSrc)
  && /from\s+'\.\.\/ops\/connectors\/claude_code_connector\.js'/.test(screenSrc)
  && /from\s+'\.\.\/ops\/connectors\/checks_connector\.js'/.test(screenSrc));
expect('ops_screens no longer imports the 3 prompt templates directly (renderMelCard display import may remain)',
  !/from\s+'\.\.\/ops\/templates\/cloud_design_prompt_template\.js'/.test(screenSrc)
  && !/from\s+'\.\.\/ops\/templates\/github_issue_template\.js'/.test(screenSrc)
  && !/from\s+'\.\.\/ops\/templates\/claude_code_prompt_template\.js'/.test(screenSrc));

// ── L. Registry integrity (review #9) — ops_registry's header promises the
// file/route values are pinned by the Node smoke/check, so actually pin them. ──
const REGISTERED = new Set([...app.matchAll(/register\(\s*'([^']+)'/g)].map((m) => m[1]));
for (const sc of getScreens()) {
  expect(`registry file exists on disk: ${sc.id} → ${sc.file}`,
    fs.existsSync(new URL('../' + sc.file, import.meta.url)));
  const base = String(sc.route).split('?')[0];
  expect(`registry route base is registered in app.js: ${sc.id} → ${base}`,
    REGISTERED.has(base));
}

// ── L2. Reverse drift (BD-OPS-07 / #646) — every route registered in app.js must
// be covered by the registry OR explicitly allowlisted, so a screen added to the
// app without a ScreenOps registry decision fails the gate (not just silent rot). ──
const KNOWN_UNREGISTERED = new Set([
  '/ops/screens', // the ScreenOps dev tool itself — not a product screen to triage
  '/onboarding',  // onboarding step host — same family as BD-ONBOARDING-01 (/welcome)
]);
const registryRouteBases = new Set(getScreens().map((s) => String(s.route).split('?')[0]));
for (const r of REGISTERED) {
  expect(`app.js route is covered by the ScreenOps registry or allowlist: ${r}`,
    registryRouteBases.has(r) || KNOWN_UNREGISTERED.has(r));
}

// ── M. Review follow-up invariants (A + B + D) ──
expect('copy() guards the async clipboard result against a stale screen selection',
  /const\s+forScreen\s*=\s*state\.selectedId/.test(screenSrc)
  && /state\.selectedId\s*!==\s*forScreen/.test(screenSrc));
expect('save() reports success/failure instead of swallowing it',
  /return\s+true/.test(storeSrc) && /return\s+false/.test(storeSrc));
expect('createMelCard returns null when persistence fails',
  /return\s+save\(cards\)\s*\?\s*card\s*:\s*null/.test(storeSrc));
expect('createMelCard validates severity/status against the canonical vocab',
  /MEL_SEVERITIES\.includes\(input\.severity\)/.test(storeSrc)
  && /MEL_STATUSES\.includes\(input\.status\)/.test(storeSrc));
expect('mark-crooked dedupes the default flag and surfaces a save failure',
  /Already flagged as crooked/.test(screenSrc) && /Could not save the MEL card/.test(screenSrc));
expect('getContractFacts accepts an already-fetched facts object (no double lookup)',
  /typeof\s+screenOrFacts\s*===\s*'string'/.test(connContracts));
expect('prompt connectors pass facts (not the id) to getContractFacts',
  /getContractFacts\(facts\)/.test(connCloud)
  && /getContractFacts\(facts\)/.test(connGithub)
  && /getContractFacts\(facts\)/.test(connClaude));
// ── M2. BD-OPS-08 (#647) — MEL lifecycle: the store re-exports its editor/lifecycle
// API (now consumed by the dashboard), and the screen wires the editor + controls. ──
expect('ops_mel_store exports the MEL lifecycle API (vocab + update/delete/next)',
  /export\s+const\s+MEL_SEVERITIES/.test(storeSrc)
  && /export\s+const\s+MEL_STATUSES/.test(storeSrc)
  && /export\s+function\s+updateMelCard\s*\(/.test(storeSrc)
  && /export\s+function\s+deleteMelCard\s*\(/.test(storeSrc)
  && /export\s+function\s+nextMelStatus\s*\(/.test(storeSrc));
expect('updateMelCard refreshes updatedAt and validates severity/status',
  /updatedAt:\s*new Date\(\)\.toISOString\(\)/.test(storeSrc)
  && /MEL_SEVERITIES\.includes\(sevCandidate\)/.test(storeSrc)
  && /MEL_STATUSES\.includes\(statusCandidate\)/.test(storeSrc));
expect('deleteMelCard removes the card by id',
  /filter\(\(c\)\s*=>\s*c\.id\s*!==\s*id\)/.test(storeSrc));
expect('screen renders the MEL editor form (severity/status selects + fields)',
  /id="mel-severity"/.test(screenSrc) && /id="mel-status"/.test(screenSrc)
  && /id="mel-problem"/.test(screenSrc) && /id="mel-decision"/.test(screenSrc)
  && /id="mel-repair"/.test(screenSrc));
expect('screen wires the MEL editor actions (new / save / cancel)',
  /data-action="new-mel"/.test(screenSrc)
  && /data-action="mel-form-save"/.test(screenSrc)
  && /data-action="mel-form-cancel"/.test(screenSrc));
expect('screen wires per-card status-advance and confirmed delete',
  /data-action="advance-mel"/.test(screenSrc)
  && /data-action="delete-mel"/.test(screenSrc)
  && /window\.confirm\(/.test(screenSrc));
// The headline invariant: an open MEL form's input is mirrored into state and
// re-rendered from it, so an unrelated re-render does not discard typed text.
expect('screen mirrors open MEL form input into state.melForm (survives re-render)',
  /addEventListener\('input'/.test(screenSrc)
  && /state\.melForm\.problem\s*=/.test(screenSrc)
  && /state\.melForm\.severity\s*=/.test(screenSrc));
expect('renderMelForm re-renders field values from state.melForm',
  /function\s+renderMelForm/.test(screenSrc) && /esc\(f\.problem\)/.test(screenSrc));
expect('mel-form-save requires a problem before creating a card',
  /Add a problem description/.test(screenSrc));

// ── M3. BD-OPS-09 (#648) — registry open-MEL badges + role/severity/status filters. ──
expect('ops_mel_store exports listAllMel (one read for per-row badges)',
  /export\s+function\s+listAllMel\s*\(/.test(storeSrc));
expect('screen wires the registry filters (role/severity chips + status select)',
  /id="ops-filters"/.test(screenSrc)
  && /action === 'filter-role'/.test(screenSrc)
  && /action === 'filter-severity'/.test(screenSrc)
  && /id="ops-filter-status"/.test(screenSrc));
expect('screen renders a per-row open-MEL badge from cards grouped by screen',
  /ops-pill--mel/.test(screenSrc) && /ops-reg__pills/.test(screenSrc)
  && /function\s+melByScreen/.test(screenSrc));
expect('cloud.css defines the filter + MEL-badge atoms',
  /\.ops-filters\b/.test(css) && /\.ops-chip\b/.test(css) && /\.ops-pill--mel\b/.test(css));
// Codex #652 P2s: MEL mutations must refresh the badge source (renderList), and
// combined severity+status filters must be satisfied by the SAME card.
expect('MEL create + delete refresh the registry list so badges stay in sync',
  /createMelCard\([\s\S]*?renderList\(\)/.test(screenSrc)
  && /deleteMelCard\(id\)[\s\S]*?renderList\(\)/.test(screenSrc));
expect('combined severity+status filters are matched against the same MEL card',
  /\(f\.severity \|\| f\.status\)[\s\S]*?cards\.some/.test(screenSrc));
// The open-MEL badge and severity chips signal DEFECTS only — WAITING/OK are
// MEL states, not defects, so they must not drive the badge or the chips.
expect('open-MEL badge + severity chips are defect-only (WAITING/OK excluded)',
  /DEFECT_SEVERITIES\s*=\s*MEL_SEVERITIES\.filter/.test(screenSrc)
  && /status !== 'DONE' && DEFECT_SEVERITIES\.includes/.test(screenSrc));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
