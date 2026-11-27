#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'iprus2026-tech/BazarDriveCloud';
const GITHUB_API = 'https://api.github.com';
const API_REPOSITORY_PATH = '/repos/' + REPOSITORY;
const PHASES = [584, 585, 586, 587, 588, 589, 590, 591, 820];
const INSPECTOR_PATH = 'docs-site/docs/processes/backend-spine-inspector.md';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUTE_PREFIXES = new Map([
  [585, ['/api/v1/auth']],
  [586, ['/api/v1/availability']],
  [587, ['/api/v1/orders', '/api/v1/matching']],
  [588, ['/api/v1/route-price']],
  [589, ['/api/v1/notifications']],
  [590, ['/api/v1/safety']],
  [591, ['/metrics']],
]);
const REQUIRED_MATRIX_ROWS = new Map([
  [585, ['GET /api/v1/auth/session', 'POST /api/v1/auth/logout',
    'POST /api/v1/auth/otp/request', 'POST /api/v1/auth/otp/verify']],
  [586, ['ALL /api/v1/availability/*']],
  [587, ['GET /api/v1/orders', 'POST /api/v1/orders', 'PATCH /api/v1/orders/:orderId',
    'POST /api/v1/orders/:orderId/cancel', 'GET /api/v1/matching/offers?orderId=…',
    'POST /api/v1/matching/offers', 'POST /api/v1/matching/select']],
  [588, ['ALL /api/v1/route-price/*']],
  [589, ['ALL /api/v1/notifications/*']],
  [590, ['ALL /api/v1/safety/*']],
  [591, ['GET /metrics']],
]);
const RUNTIME_STATES = new Map([
  ['DARK', 'DARK'],
  ['LIVE', 'LIVE'],
  ['LIVE / PILOT-BLOCKED', 'PILOT_BLOCKED'],
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function validSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value);
}

function timestamp(value, label) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  const canonical = Number.isFinite(ms) && new Date(ms).toISOString();
  requireCondition(canonical && (value === canonical || value === canonical.replace('.000Z', 'Z')),
    label + ' must be a canonical UTC timestamp');
  return ms;
}

function requireKeys(value, keys, label) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
  'invalid ' + label + ' schema');
}

function belongsToRoute(route, prefix) {
  const routePath = route.split('?')[0];
  return routePath === prefix || (prefix !== '/metrics' && routePath.startsWith(prefix + '/'));
}

export function parseRuntime(inspector, sourceSha) {
  requireCondition(validSha(sourceSha), 'invalid Inspector source SHA');
  requireCondition(typeof inspector === 'string', 'missing BD-DOCS-042 evidence');
  const lines = inspector.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => /^## Live baseline(?:\s|$)/.test(line) ? [index] : []);
  const heading = starts[0];
  const header = lines.findIndex((line, index) => index > heading && line.trim());
  requireCondition(starts.length === 1
    && /^\| Module \/ route \| State \|/.test(lines[header] ?? '')
    && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[header + 1] ?? ''),
  'missing or invalid BD-DOCS-042 route matrix');

  const ref = (line) => 'https://github.com/' + REPOSITORY + '/blob/' + sourceSha
    + '/' + INSPECTOR_PATH + '#L' + (line + 1);
  const rows = [];
  const seen = new Set();
  for (let index = header + 2; lines[index]?.trim(); index++) {
    const row = /^\| `([A-Z]+ \/[^`\s]+)` \| ([^|]+) \|/.exec(lines[index]);
    requireCondition(row && !seen.has(row[1]), 'invalid or duplicate BD-DOCS-042 row at line ' + (index + 1));
    seen.add(row[1]);
    rows.push({ route: row[1].split(' ')[1], state: RUNTIME_STATES.get(row[2].trim()), ref: ref(index) });
  }

  const result = new Map();
  for (const [issue, prefixes] of ROUTE_PREFIXES) {
    const evidence = rows.filter(({ route }) => prefixes.some((prefix) => belongsToRoute(route, prefix)));
    let state = 'NOT_VERIFIED';
    if (REQUIRED_MATRIX_ROWS.get(issue).every((row) => seen.has(row)) && evidence.every((row) => row.state)) {
      const states = evidence.map((row) => row.state);
      if (states.includes('DARK')) state = 'DARK';
      else if (states.includes('PILOT_BLOCKED')) state = 'PILOT_BLOCKED';
      else state = 'LIVE';
    }
    result.set(issue, { state, evidence: evidence.map((row) => row.ref) });
  }

  const pilotHeading = lines.indexOf('## Pilot blockers and delivery slices');
  const pilotEnd = lines.findIndex((line, index) => index > pilotHeading && /^## /.test(line));
  const activationRow = lines.findIndex((line, index) => index > pilotHeading
    && (pilotEnd === -1 || index < pilotEnd)
    && /^\| \*\*BD-BACKEND-ACTIVATE-01\*\* \(#828\) \| All prior gates \|/.test(line));
  const auth = result.get(585);
  if (pilotHeading !== -1 && activationRow !== -1 && auth.state === 'PILOT_BLOCKED') {
    result.set(820, { state: 'PILOT_BLOCKED', evidence: [ref(activationRow), ...auth.evidence] });
  }
  return result;
}

function measureTasks(phase, seenChildren, observedAt) {
  const { issue_number: issue, direct_total: total, direct_sub_issues: children } = phase;
  requireCondition(Number.isSafeInteger(total) && total >= 0
    && Array.isArray(children) && children.length === total, 'incomplete direct sub-issues for #' + issue);

  let completed = 0;
  let notPlanned = 0;
  for (const child of children) {
    requireKeys(child, ['number', 'state', 'state_reason'], 'direct sub-issue of #' + issue);
    const { number, state, state_reason: reason } = child;
    requireCondition(Number.isSafeInteger(number) && number > 0 && number !== issue,
      'invalid direct sub-issue number for #' + issue);
    requireCondition(!seenChildren.has(number), 'duplicate direct sub-issue #' + number);
    seenChildren.add(number);
    const validOpen = state === 'open' && (reason === null || reason === 'reopened');
    const validClosed = state === 'closed' && (reason === 'completed' || reason === 'not_planned');
    requireCondition(validOpen || validClosed, 'invalid state or state_reason for #' + number);
    if (state === 'closed' && reason === 'completed') completed++;
    if (state === 'closed' && reason === 'not_planned') notPlanned++;
  }

  const closed = completed + notPlanned;
  return {
    task_progress: {
      status: total === 0 ? 'N/A' : 'MEASURED',
      closed,
      total,
      denominator: total,
      percent: total === 0 ? null : Math.round(closed * 10000 / total) / 100,
      observed_at: observedAt,
    },
    closed_completed: completed,
    closed_not_planned: notPlanned,
  };
}

export function calculateProgress(snapshot, { expectedSha, asOf, inspector } = {}) {
  requireKeys(snapshot, ['schema_version', 'repository', 'source_sha', 'observed_at', 'phases'], 'snapshot');
  const { source_sha: sourceSha, observed_at: observedAt } = snapshot;
  requireCondition(snapshot.schema_version === 1 && snapshot.repository === REPOSITORY, 'unexpected snapshot source');
  requireCondition(validSha(sourceSha) && sourceSha === expectedSha, 'source_sha does not match the verified main SHA');
  const age = timestamp(asOf, 'asOf') - timestamp(observedAt, 'observed_at');
  requireCondition(age >= 0 && age <= MAX_AGE_MS, 'snapshot is stale or its observed_at is in the future');
  requireCondition(Array.isArray(snapshot.phases) && snapshot.phases.length === PHASES.length, 'missing or extra phases');

  const phases = new Map();
  for (const phase of snapshot.phases) {
    requireKeys(phase, ['issue_number', 'direct_total', 'direct_sub_issues'], 'phase');
    const issue = phase.issue_number;
    requireCondition(PHASES.includes(issue), 'unexpected phase number');
    requireCondition(!phases.has(issue), 'duplicate phase #' + issue);
    phases.set(issue, phase);
  }

  const runtime = parseRuntime(inspector, sourceSha);
  const seenChildren = new Set();
  return {
    source_sha: sourceSha,
    observed_at: observedAt,
    phases: PHASES.map((issue) => {
      const phaseRuntime = runtime.get(issue) ?? { state: 'NOT_VERIFIED', evidence: [] };
      const parent = GITHUB_API + API_REPOSITORY_PATH + '/issues/' + issue;
      return {
        issue_number: issue,
        ...measureTasks(phases.get(issue), seenChildren, observedAt),
        runtime_state: phaseRuntime.state,
        runtime_evidence: phaseRuntime.evidence,
        gate_progress: 'NOT_MEASURED',
        project_design_state: 'NOT_VERIFIED',
        project_status: 'NOT_VERIFIED',
        source_sha: sourceSha,
        observed_at: observedAt,
        evidence_refs: [parent, parent + '/sub_issues', ...phaseRuntime.evidence],
      };
    }),
  };
}

const PAGE_SIZE = 100;

async function githubGet(endpoint) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.authorization = 'Bearer ' + token;

  let response;
  try {
    response = await fetch(GITHUB_API + endpoint, {
      method: 'GET',
      headers,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('GitHub REST request failed: ' + endpoint);
  }
  requireCondition(response.ok, 'GitHub REST HTTP ' + response.status + ': ' + endpoint);

  try {
    return await response.json();
  } catch {
    throw new Error('Invalid GitHub REST response: ' + endpoint);
  }
}

function isRepositoryIssue(issue, number) {
  return Number.isSafeInteger(number) && number > 0
    && issue?.number === number
    && issue.repository_url === GITHUB_API + API_REPOSITORY_PATH
    && issue.html_url === 'https://github.com/' + REPOSITORY + '/issues/' + number
    && issue.pull_request == null;
}

async function readDirectTotal(request, issueNumber, parentPath) {
  const issue = await request(parentPath);
  requireCondition(isRepositoryIssue(issue, issueNumber), 'Unexpected GitHub phase #' + issueNumber);
  const total = issue.sub_issues_summary?.total;
  requireCondition(Number.isSafeInteger(total) && total >= 0,
    'Missing GitHub direct total for phase #' + issueNumber);
  return total;
}

async function readDirectIssues(request, issueNumber) {
  const parentPath = API_REPOSITORY_PATH + '/issues/' + issueNumber;
  const directTotal = await readDirectTotal(request, issueNumber, parentPath);
  const directSubIssues = [];
  // A full page requires the following page, even when the expected count is exact.
  for (let page = 1; page <= Math.floor(directTotal / PAGE_SIZE) + 1; page++) {
    const batch = await request(parentPath + '/sub_issues?per_page=' + PAGE_SIZE + '&page=' + page);
    const expectedSize = Math.min(PAGE_SIZE, directTotal - directSubIssues.length);
    requireCondition(Array.isArray(batch) && batch.length === expectedSize,
      'Incomplete or inconsistent GitHub direct sub-issues for phase #' + issueNumber + ', page ' + page);
    for (const issue of batch) {
      requireCondition(isRepositoryIssue(issue, issue?.number) && issue.parent_issue_url === GITHUB_API + parentPath,
        'Unexpected GitHub direct sub-issue for phase #' + issueNumber + ', page ' + page);
      directSubIssues.push({ number: issue.number, state: issue.state, state_reason: issue.state_reason });
    }
  }

  requireCondition(await readDirectTotal(request, issueNumber, parentPath) === directTotal,
    'GitHub direct total changed during observation for phase #' + issueNumber);
  return { issue_number: issueNumber, direct_total: directTotal, direct_sub_issues: directSubIssues };
}

async function verifyGitHubMain(request, expectedSha) {
  const main = await request(API_REPOSITORY_PATH + '/git/ref/heads/main');
  requireCondition(main?.ref === 'refs/heads/main' && main.object?.type === 'commit'
    && main.object.sha === expectedSha, 'GitHub main does not match expected SHA');
}

export async function collectIssueSnapshot(expectedSha, {
  request = githubGet, now = () => new Date().toISOString(),
} = {}) {
  requireCondition(validSha(expectedSha), 'Expected a full main SHA');
  await verifyGitHubMain(request, expectedSha);
  const observedAt = now();
  const phases = await Promise.all(PHASES.map((issueNumber) => readDirectIssues(request, issueNumber)));
  await verifyGitHubMain(request, expectedSha);

  return {
    schema_version: 1,
    repository: REPOSITORY,
    source_sha: expectedSha,
    observed_at: observedAt,
    phases,
  };
}

function readInspector(expectedSha) {
  try {
    return execFileSync('git', ['--no-replace-objects', 'show', expectedSha + ':' + INSPECTOR_PATH], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('BD-DOCS-042 is unavailable at the expected main SHA');
  }
}

function readSnapshot(pathname) {
  try {
    return JSON.parse(readFileSync(pathname, 'utf8'));
  } catch {
    throw new Error('cannot read the issue snapshot as JSON');
  }
}

async function main(args) {
  const [mode] = args;
  const offline = mode === '--snapshot' && args.length === 4;
  const live = mode === '--live' && args.length === 2;
  requireCondition(offline || live,
    'usage: node scripts/project-progress.mjs --snapshot <path> <main-sha> <as-of-utc> | --live <main-sha>');

  const expectedSha = offline ? args[2] : args[1];
  requireCondition(validSha(expectedSha), 'expected a full main SHA');
  const inspector = readInspector(expectedSha);
  const snapshot = offline ? readSnapshot(args[1]) : await collectIssueSnapshot(expectedSha);
  const asOf = offline ? args[3] : new Date().toISOString();
  const report = calculateProgress(snapshot, { expectedSha, asOf, inspector });
  console.log(JSON.stringify({ issue_source: offline ? 'OFFLINE_INPUT' : 'LIVE_REST', ...report }, null, 2));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error('FAIL project-progress: ' + error.message);
    process.exitCode = 1;
  }
}
