#!/usr/bin/env node
// Validate the Project #1 export against the BD-DOCS-042 route matrix and prepare
// a local candidate. Publication requires a separate decision about board metadata.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'iprus2026-tech/BazarDriveCloud';
const ISSUE_URL = 'https://github.com/' + REPOSITORY + '/issues/';
const INSPECTOR = new URL('../docs-site/docs/processes/backend-spine-inspector.md', import.meta.url);
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PHASE_ROUTES = new Map([
  [585, ['/api/v1/auth']],
  [586, ['/api/v1/availability']],
  [587, ['/api/v1/orders', '/api/v1/matching']],
  [588, ['/api/v1/route-price']],
  [589, ['/api/v1/notifications']],
  [590, ['/api/v1/safety']],
  [591, ['/metrics']],
]);

const DESIGN_STATES = new Set(['Todo', 'Designed (ADR)', 'Shipped']);
const STATUSES = new Set(['Todo', 'In Progress', 'Done']);
const LIVE_STATES = new Set(['LIVE', 'LIVE / PILOT-BLOCKED']);

export function checkProvenance({ source_sha, observed_at }, currentMainSha, now = Date.now()) {
  if (typeof source_sha !== 'string' || !/^[0-9a-f]{40}$/.test(source_sha) || source_sha !== currentMainSha) {
    throw new Error('source_sha does not match the verified main SHA');
  }

  const timestamp = Date.parse(observed_at);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== observed_at) {
    throw new Error('observed_at must be a canonical UTC timestamp');
  }
  if (timestamp > now || now - timestamp > MAX_SNAPSHOT_AGE_MS) {
    throw new Error('observed_at is in the future or the snapshot is older than 7 days');
  }
}

function projectPhases(board) {
  if (!Array.isArray(board?.items) || !Number.isSafeInteger(board.totalCount)
      || board.totalCount !== board.items.length) {
    throw new Error('incomplete export: totalCount must equal the size of items');
  }

  const phases = new Map();
  for (const item of board.items) {
    const content = item?.content;
    if (!content || content.type !== 'Issue' || content.repository !== REPOSITORY
        || !PHASE_ROUTES.has(content.number) || content.url !== ISSUE_URL + content.number) {
      continue;
    }

    const issue = content.number;
    if (phases.has(issue)) throw new Error('duplicate phase #' + issue);

    // gh JSON can spell the field "design State". Reject missing or ambiguous values.
    const designKeys = Object.keys(item).filter((key) => /^design\s*state$/i.test(key));
    const designState = item[designKeys[0]];
    if (designKeys.length !== 1 || !DESIGN_STATES.has(designState) || !STATUSES.has(item.status)) {
      throw new Error('missing or unknown Design State/Status for phase #' + issue);
    }

    phases.set(issue, { issue_number: issue, design_state: designState, status: item.status });
  }

  return [...PHASE_ROUTES.keys()].map((issue) => {
    const phase = phases.get(issue);
    if (!phase) throw new Error('missing phase #' + issue);
    return phase;
  });
}

function checkPhaseRoutes(phases, inspector) {
  const section = inspector.split(/^## /m).find((part) => part.startsWith('Live baseline'));
  const rows = [];
  for (const line of (section ?? '').split('\n')) {
    const cells = line.match(/^\|\s*((?:`[^`]+`)(?:\s*,\s*`[^`]+`)*)\s*\|\s*([^|]+?)\s*\|/);
    if (!cells) continue;
    for (const [, route] of cells[1].matchAll(/`[A-Z]+\s+(\/[^`]+)`/g)) {
      rows.push({ route: route.trim(), state: cells[2].trim() });
    }
  }

  for (const { issue_number: issue, design_state: design } of phases) {
    for (const prefix of PHASE_ROUTES.get(issue)) {
      const service = rows.filter(({ route }) => {
        const routePath = route.split('?')[0];
        return routePath === prefix || (prefix !== '/metrics' && routePath.startsWith(prefix + '/'));
      });
      if (!service.length) throw new Error('no BD-DOCS-042 rows for phase #' + issue + ' ' + prefix);

      for (const { route, state } of service) {
        if (state !== 'DARK' && !LIVE_STATES.has(state)) {
          throw new Error('unknown BD-DOCS-042 state for phase #' + issue + ' ' + route);
        }
        if (design === 'Shipped' && state === 'DARK') {
          throw new Error('phase #' + issue + ' is Shipped but ' + route + ' is DARK');
        }
      }
    }
  }
}

export function prepareSnapshot(board, inspector, { sourceSha, currentMainSha, observedAt, now }) {
  const provenance = { source_sha: sourceSha, observed_at: observedAt };
  checkProvenance(provenance, currentMainSha, now);
  const items = projectPhases(board);
  checkPhaseRoutes(items, inspector);
  return { schema_version: 1, repository: REPOSITORY, project_number: 1, ...provenance, items };
}

export function renderMarkdown({ source_sha, observed_at, items }) {
  const rows = items.map(({ issue_number, design_state, status }) =>
    '| [#' + issue_number + '](' + ISSUE_URL + issue_number + ') | ' + design_state + ' | ' + status + ' |');
  return [
    '# Project #1 — Project board candidate',
    '',
    'Observed ' + observed_at + ' against `' + source_sha + '`.',
    'The listed phases are a limited view. The route check does not assess pilot or release readiness.',
    '',
    '| Issue | Design State | Status |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function main() {
  const [input, sourceSha, currentMainSha, observedAt, outputDir] = process.argv.slice(2);
  if (!outputDir) {
    throw new Error('usage: node scripts/check-project-board.mjs <raw.json> <source-sha> <current-main-sha> <observed-at> <output-dir>');
  }

  let board;
  try {
    board = JSON.parse(readFileSync(input, 'utf8'));
  } catch {
    throw new Error('cannot read Project JSON');
  }

  const candidate = prepareSnapshot(board, readFileSync(INSPECTOR, 'utf8'), {
    sourceSha, currentMainSha, observedAt,
  });
  mkdirSync(outputDir);
  writeFileSync(path.join(outputDir, 'project-board.json'), JSON.stringify(candidate, null, 2) + '\n');
  writeFileSync(path.join(outputDir, 'project-board.md'), renderMarkdown(candidate));
  console.log('project-board: validated ' + candidate.items.length + ' allowlisted phases');
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  try {
    main();
  } catch (error) {
    console.error('FAIL project-board: ' + error.message);
    process.exitCode = 1;
  }
}
