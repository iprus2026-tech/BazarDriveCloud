// BD-CLOUD-DESIGN-LOADING-02A (#866) — focused static smoke for the
// Responses initial matching-offers read boundary.
//
// Pins the four primary request states, deterministic production-data-free
// fixtures, the persistent aria-busy owner, structural skeleton accessibility,
// one guarded read + retry, detached/superseded completion protection, existing
// backend-OFF fallback, and the version-only Service Worker bump.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const responses = read('../public/src/screens/responses.js');
const css = read('../public/styles/cloud.css');
const sw = read('../public/sw.js');

const failures = [];
function expect(label, condition) {
  const passed = Boolean(condition);
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} — ${label}\n`);
  if (!passed) failures.push(label);
}

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 && to > from ? source.slice(from, to) : '';
}

const fixtureHelper = between(responses, 'const RESPONSE_FIXTURES', 'function markFeedTabActive');
const loadingMarkup = between(responses, 'function renderOffersLoading()', 'function renderResponsesFooter');
const loader = between(responses, 'async function loadServerOffers', 'function refreshBoard');
const fixtureActionGuard = between(responses, '// Fixture cards are representative', "if (action === 'select'");

// A. Loader returns the stable shell before the guarded read settles.
expect('responses loader is synchronous (no top-level await before first paint)',
  /export default function responses\(\)/.test(responses)
  && !/export default async function responses\(\)/.test(responses));
expect('stable request card is outside the persistent read owner',
  responses.indexOf('class="bd-card responses__request"') >= 0
  && responses.indexOf('id="responses-read-region"') > responses.indexOf('class="bd-card responses__request"'));
expect('smallest persistent read owner exposes aria-busy',
  /id="responses-read-region"[\s\S]{0,180}aria-busy="\$\{readState === 'loading' \? 'true' : 'false'\}"/.test(responses)
  && /readRegion\.setAttribute\('aria-busy', readState === 'loading' \? 'true' : 'false'\)/.test(responses));

// B. Structural skeleton and accessibility.
expect('loading markup has exactly one concise status outside decorative bones',
  (loadingMarkup.match(/role="status"/g) || []).length === 1
  && /responses__loading-status" role="status">Загружаем отклики…/.test(loadingMarkup)
  && /responses__skeleton" aria-hidden="true"/.test(loadingMarkup));
expect('skeleton approximates toolbar and two offer cards without fake controls/data',
  /responses__skeleton-toolbar/.test(loadingMarkup)
  && (loadingMarkup.match(/\$\{card\}/g) || []).length === 2
  && !/<button\b|<input\b|Рустам|₽|рейтинг/i.test(loadingMarkup));
expect('skeleton is static by default and only animates when motion is allowed',
  /\.responses__skeleton-bone\s*\{[\s\S]*?background: var\(--bg-2\)/.test(css)
  && /@media \(prefers-reduced-motion: no-preference\)\s*\{[\s\S]*?\.responses__skeleton-bone::after[\s\S]*?animation: responses-skeleton-shimmer/.test(css));

// C. Four deterministic fixtures, independent from domain state.
expect('fixture allowlist is exactly loading/loaded/empty/error',
  /new Set\(\['loading', 'loaded', 'empty', 'error'\]\)/.test(fixtureHelper));
expect('unknown fixture values fall back to normal runtime',
  /return RESPONSE_FIXTURES\.has\(value\) \? value : ''/.test(fixtureHelper));
expect('known fixtures bypass canonical store and backend authority',
  /const canonicalOrder = fixture \? null : resolveCanonicalOrder\(\)/.test(responses)
  && /const backendAuthoritative = !fixture && isBackendEnabled\(\)/.test(responses)
  && /const handoffTripId = !fixture && request\.orderId/.test(responses));
expect('loaded fixture uses synthetic cards; other fixtures start with no drivers',
  /let drivers = fixture === 'loaded'[\s\S]{0,100}\? buildDrivers\(request\)[\s\S]{0,120}: \(fixture \|\| backendAuthoritative[\s\S]{0,60}\? \[\]/.test(responses));
expect('fixture card actions cannot write/select/navigate into network-backed chat',
  /if \(fixture && \(action === 'select'/.test(fixtureActionGuard)
  && /action === 'continue'/.test(fixtureActionGuard)
  && /action === 'chat'/.test(fixtureActionGuard)
  && /action === 'call'/.test(fixtureActionGuard));

// D. Normal guarded read transitions and retry.
expect('live path starts at loading without fabricated drivers',
  /fixture \|\| backendAuthoritative[\s\S]{0,60}\? \[\]/.test(responses)
  && /backendAuthoritative \? 'loading' : 'loaded'/.test(responses));
expect('one guarded offers-read call settles to loaded or empty',
  (responses.match(/listOrderOffers\s*\(/g) || []).length === 1
  && /readState = drivers\.length \? 'loaded' : 'empty'/.test(loader));
expect('rejected or unusable read settles to explicit error, not empty',
  /catch \{[\s\S]*?readState = 'error'/.test(loader)
  && /readState === 'error'[\s\S]{0,180}renderEmptyState\(request, \{ error: true \}\)/.test(responses));
expect('retry repeats only loadServerOffers and carries button-local aria-busy',
  /data-action="retry-offers"/.test(responses)
  && /await loadServerOffers\(\{ isRetry: true \}\)/.test(responses)
  && /retryBtn\.setAttribute\('aria-busy', busy \? 'true' : 'false'\)/.test(responses));
expect('late/superseded completions cannot paint a detached screen',
  (loader.match(/runId !== offersReadRunId \|\| !document\.body\.contains\(root\)/g) || []).length >= 2);
expect('accepted ride handoff is not replaced when the read settles',
  /if \(isAccepted\) return/.test(loader));
expect('backend-OFF local/mock source remains buildDriversForOrder',
  /buildDriversForOrder\(request, null, false\)/.test(responses));

// E. Version-only SW refresh for changed precached assets.
expect('Service Worker VERSION is bumped exactly to v262 for #866',
  /v262 \(BD-CLOUD-DESIGN-LOADING-02A #866\)/.test(sw)
  && /const VERSION\s*=\s*'v262'/.test(sw));
expect('responses.js and cloud.css remain precached',
  sw.includes("'./src/screens/responses.js'")
  && sw.includes("'./styles/cloud.css'"));

if (failures.length) {
  process.stderr.write(`\nFAIL ${failures.length} expectation(s):\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}

process.stdout.write('\nALL PASSED\n');
