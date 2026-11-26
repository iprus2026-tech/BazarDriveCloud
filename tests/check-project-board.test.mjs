import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareSnapshot, renderMarkdown } from '../scripts/check-project-board.mjs';

const REPOSITORY = 'iprus2026-tech/BazarDriveCloud';
const MATRIX = readFileSync(new URL('../docs-site/docs/processes/backend-spine-inspector.md', import.meta.url), 'utf8');
const CHECKER = fileURLToPath(new URL('../scripts/check-project-board.mjs', import.meta.url));
const PROVENANCE = {
  sourceSha: 'a'.repeat(40),
  currentMainSha: 'a'.repeat(40),
  observedAt: '2026-11-26T12:00:00.000Z',
  now: Date.parse('2026-11-26T12:01:00.000Z'),
};

function issue(number, repository = REPOSITORY) {
  return {
    content: { type: 'Issue', number, repository, url: 'https://github.com/' + repository + '/issues/' + number },
    'design State': number === 587 ? 'Shipped' : 'Designed (ADR)',
    status: 'In Progress',
  };
}

function fixture() {
  const items = [585, 586, 587, 588, 589, 590, 591].map((number) => issue(number));
  return { totalCount: items.length, items };
}

test('Phase #587 rejects Shipped when Orders has a DARK route', () => {
  const live = '| `GET /api/v1/orders` | LIVE |';
  assert.ok(MATRIX.includes(live));
  const matrix = MATRIX.replace(live, '| `GET /api/v1/orders` | DARK |');

  assert.throws(() => prepareSnapshot(fixture(), matrix, PROVENANCE), /#587 is Shipped but \/api\/v1\/orders is DARK/);
});

test('Phase #587 rejects Shipped when Matching has a DARK route', () => {
  const live = '| `POST /api/v1/matching/select` | LIVE / PILOT-BLOCKED |';
  assert.ok(MATRIX.includes(live));
  const matrix = MATRIX.replace(live, '| `POST /api/v1/matching/select` | DARK |');

  assert.throws(() => prepareSnapshot(fixture(), matrix, PROVENANCE), /#587 is Shipped but \/api\/v1\/matching\/select is DARK/);
});

test('a similarly named route cannot replace the Orders route group', () => {
  const matrix = MATRIX.replaceAll('/api/v1/orders', '/api/v1/orders-archive');
  assert.throws(() => prepareSnapshot(fixture(), matrix, PROVENANCE), /no BD-DOCS-042 rows for phase #587 \/api\/v1\/orders/);
});

test('a DARK grouped route row checks every route, including HEAD', () => {
  const live = '| `GET /api/v1/orders` | LIVE |';
  assert.ok(MATRIX.includes(live));
  const matrix = MATRIX.replace(live, '| `GET /api/v1/orders-archive`, `HEAD /api/v1/orders` | DARK |');

  assert.throws(() => prepareSnapshot(fixture(), matrix, PROVENANCE), /#587 is Shipped but \/api\/v1\/orders is DARK/);
});

test('an unrecognized matrix state fails closed', () => {
  const matrix = MATRIX.replace('| `GET /api/v1/orders` | LIVE |', '| `GET /api/v1/orders` | TBD |');
  assert.throws(() => prepareSnapshot(fixture(), matrix, PROVENANCE), /unknown BD-DOCS-042 state for phase #587/);
});

test('the existing DARK phase check still applies to Route & Price', () => {
  const board = fixture();
  board.items[3]['design State'] = 'Shipped';
  assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), /#588 is Shipped but \/api\/v1\/route-price/);
});

test('only allowlisted fields and canonical phases are rendered in both formats', () => {
  const board = fixture();
  board.items[2].content.body = 'BODY_SENTINEL';
  board.items[2].title = 'TITLE_SENTINEL';
  board.items[2].priority = 'PRIORITY_SENTINEL';
  board.items[2].assignees = ['ASSIGNEE_SENTINEL'];
  board.items.unshift(
    { content: { type: 'DraftIssue', title: 'DRAFT_SENTINEL' } },
    { ...issue(587, 'other/private-repo'), title: 'FOREIGN_SENTINEL' },
    { content: null, title: 'REDACTED_SENTINEL' },
    issue(584),
  );
  board.totalCount = board.items.length;

  const snapshot = prepareSnapshot(board, MATRIX, PROVENANCE);
  assert.deepEqual(snapshot, {
    schema_version: 1,
    repository: REPOSITORY,
    project_number: 1,
    source_sha: PROVENANCE.sourceSha,
    observed_at: PROVENANCE.observedAt,
    items: [585, 586, 587, 588, 589, 590, 591].map((issue_number) => ({
      issue_number,
      design_state: issue_number === 587 ? 'Shipped' : 'Designed (ADR)',
      status: 'In Progress',
    })),
  });
  const markdown = renderMarkdown(snapshot);
  assert.doesNotMatch(JSON.stringify(snapshot) + markdown, /SENTINEL|other\/private-repo|totalCount|#584/);
  for (const phase of snapshot.items) {
    assert.ok(markdown.includes('/issues/' + phase.issue_number + ') | ' + phase.design_state + ' | ' + phase.status));
  }
});

test('missing canonical phases fail even when a foreign issue has the same number', () => {
  const board = fixture();
  board.items[2] = issue(587, 'other/private-repo');
  assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), /missing phase #587/);
});

test('duplicate canonical phases fail', () => {
  const board = fixture();
  board.items.push(issue(587));
  board.totalCount += 1;
  assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), /duplicate phase #587/);
});

test('missing, ambiguous or unknown phase fields fail without echoing the value', () => {
  const board = fixture();
  delete board.items[2]['design State'];
  assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), /missing or unknown Design State\/Status for phase #587/);
  board.items[2]['design State'] = 'Shipped';
  board.items[2].designState = 'Todo';
  assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), /missing or unknown Design State\/Status for phase #587/);
  delete board.items[2].designState;
  board.items[2].status = 'PRIVATE_STATUS_SENTINEL';
  assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), {
    message: 'missing or unknown Design State/Status for phase #587',
  });
});

test('absent, noninteger or mismatching source counts fail closed', () => {
  for (const totalCount of [undefined, '7', 7.5, 6, 8]) {
    const board = { ...fixture(), totalCount };
    assert.throws(() => prepareSnapshot(board, MATRIX, PROVENANCE), /incomplete export/);
  }
});

test('missing SHA or drift from verified main fails', () => {
  for (const sourceSha of [undefined, 'b'.repeat(40)]) {
    assert.throws(() => prepareSnapshot(fixture(), MATRIX, { ...PROVENANCE, sourceSha }), /source_sha does not match/);
  }
});

test('missing, malformed, future or stale timestamps fail', () => {
  for (const observedAt of [undefined, '2026-11-26', '2026-11-27T00:00:00.000Z', '2026-11-18T00:00:00.000Z']) {
    assert.throws(() => prepareSnapshot(fixture(), MATRIX, { ...PROVENANCE, observedAt }), /observed_at/);
  }
});

test('CLI writes only a checked candidate and leaves no output on failure', (context) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'project-board-test-'));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const raw = path.join(dir, 'raw.json');
  const output = path.join(dir, 'candidate');
  const observedAt = new Date().toISOString();
  const args = [CHECKER, raw, PROVENANCE.sourceSha, PROVENANCE.currentMainSha, observedAt, output];

  writeFileSync(raw, '{ PRIVATE_JSON_SENTINEL');
  const invalid = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /cannot read Project JSON/);
  assert.doesNotMatch(invalid.stderr + invalid.stdout, /SENTINEL/);
  assert.equal(existsSync(output), false);

  writeFileSync(raw, JSON.stringify(fixture()));
  const valid = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  const json = JSON.parse(readFileSync(path.join(output, 'project-board.json'), 'utf8'));
  assert.equal(json.observed_at, observedAt);
  assert.equal(readFileSync(path.join(output, 'project-board.md'), 'utf8'), renderMarkdown(json));
});
