import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { calculateProgress, collectIssueSnapshot } from '../scripts/project-progress.mjs';

const SHA = 'b80539fe982bf3ebcd25718029ebbd30fa189cae';
const REPOSITORY = 'iprus2026-tech/BazarDriveCloud';
const OBSERVED_AT = '2026-11-26T16:00:00.000Z';
const AS_OF = '2026-11-26T17:00:00.000Z';
const PHASE_NUMBERS = [584, 585, 586, 587, 588, 589, 590, 591, 820];
const INSPECTOR = readFileSync(new URL('../docs-site/docs/processes/backend-spine-inspector.md', import.meta.url), 'utf8');
const OPTIONS = { expectedSha: SHA, asOf: AS_OF, inspector: INSPECTOR };

function issue(number, state, state_reason) {
  return { number, state, state_reason };
}

function phase(issue_number, direct_sub_issues) {
  return { issue_number, direct_total: direct_sub_issues.length, direct_sub_issues };
}

// Every issue state and direct relationship here is synthetic.
function syntheticSnapshot() {
  return {
    schema_version: 1,
    repository: REPOSITORY,
    source_sha: SHA,
    observed_at: OBSERVED_AT,
    phases: [
      phase(584, [issue(820, 'open', null)]),
      phase(585, [issue(1501, 'open', null)]),
      phase(586, [
        issue(1601, 'closed', 'completed'),
        issue(1602, 'closed', 'completed'),
        issue(1603, 'closed', 'completed'),
      ]),
      phase(587, [
        issue(1701, 'closed', 'completed'),
        issue(1702, 'closed', 'not_planned'),
        issue(1703, 'open', 'reopened'),
        issue(1704, 'open', null),
      ]),
      phase(588, [issue(1801, 'closed', 'completed'), issue(1802, 'open', null)]),
      phase(589, [issue(1901, 'open', null)]),
      phase(590, []),
      phase(591, []),
      phase(820, [issue(2001, 'closed', 'completed'), issue(2002, 'closed', 'completed')]),
    ],
  };
}

function getPhase(report, number) {
  const phase = report.phases.find(({ issue_number }) => issue_number === number);
  assert.ok(phase, `missing phase #${number}`);
  return phase;
}

function assertMetrics(phase, { closed, total, percent, completed, notPlanned }) {
  assert.equal(phase.task_progress.status, total ? 'MEASURED' : 'N/A');
  assert.equal(phase.task_progress.closed, closed);
  assert.equal(phase.task_progress.total, total);
  assert.equal(phase.task_progress.denominator, total);
  assert.equal(phase.task_progress.percent, percent);
  assert.equal(phase.task_progress.observed_at, OBSERVED_AT);
  assert.equal(phase.closed_completed, completed);
  assert.equal(phase.closed_not_planned, notPlanned);
}

test('#586 has 100% task closure with independent DARK runtime and no readiness verdict', () => {
  const report = calculateProgress(syntheticSnapshot(), OPTIONS);
  const presence = getPhase(report, 586);
  assertMetrics(presence, { closed: 3, total: 3, percent: 100, completed: 3, notPlanned: 0 });
  assert.equal(presence.runtime_state, 'DARK');
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /"release_gate"|"ALLOW_SCOPED_IMPLEMENTATION"|"Shipped"/);
});

test('#587 counts not-planned closure separately and reopened issues stay open', () => {
  const dispatch = getPhase(calculateProgress(syntheticSnapshot(), OPTIONS), 587);
  assertMetrics(dispatch, { closed: 2, total: 4, percent: 50, completed: 1, notPlanned: 1 });
});

test('#584 counts #820 once and #820 direct children only appear in their own phase', () => {
  const report = calculateProgress(syntheticSnapshot(), OPTIONS);
  assertMetrics(getPhase(report, 584), { closed: 0, total: 1, percent: 0, completed: 0, notPlanned: 0 });
  assertMetrics(getPhase(report, 820), { closed: 2, total: 2, percent: 100, completed: 2, notPlanned: 0 });
});

test('#590 and #591 with verified empty direct lists return N/A with null percentages', () => {
  const report = calculateProgress(syntheticSnapshot(), OPTIONS);
  for (const number of [590, 591]) {
    const phase = getPhase(report, number);
    assertMetrics(phase, { closed: 0, total: 0, percent: null, completed: 0, notPlanned: 0 });
    assert.equal(phase.runtime_state, 'DARK');
  }
});

test('#588 task and runtime results are independent of Presence and Dispatch task closure', () => {
  const snapshot = syntheticSnapshot();
  const before = calculateProgress(snapshot, OPTIONS);
  getPhase(snapshot, 586).direct_sub_issues = getPhase(snapshot, 586).direct_sub_issues
    .map(({ number }) => issue(number, 'open', null));
  getPhase(snapshot, 587).direct_sub_issues = getPhase(snapshot, 587).direct_sub_issues
    .map(({ number }) => issue(number, 'closed', 'completed'));
  const after = calculateProgress(snapshot, OPTIONS);
  assert.equal(getPhase(after, 586).task_progress.percent, 0);
  assert.equal(getPhase(after, 587).task_progress.percent, 100);
  const routePrice = getPhase(after, 588);
  assert.deepEqual(routePrice, getPhase(before, 588));
  assertMetrics(routePrice, { closed: 1, total: 2, percent: 50, completed: 1, notPlanned: 0 });
  assert.equal(routePrice.runtime_state, 'DARK');
});

test('every phase retains provenance and exposes separate Gates and Project fields', () => {
  const input = syntheticSnapshot();
  const report = calculateProgress(input, OPTIONS);
  assert.deepEqual(calculateProgress(input, OPTIONS), report);
  assert.deepEqual(input, syntheticSnapshot());
  assert.equal(report.source_sha, SHA);
  assert.equal(report.observed_at, OBSERVED_AT);
  assert.deepEqual(report.phases.map(({ issue_number }) => issue_number), PHASE_NUMBERS);
  for (const phase of report.phases) {
    assert.equal(phase.source_sha, SHA);
    assert.equal(phase.observed_at, OBSERVED_AT);
    assert.ok(phase.evidence_refs && Object.keys(phase.evidence_refs).length > 0);
    assert.equal(phase.gate_progress, 'NOT_MEASURED');
    assert.equal(phase.project_design_state, 'NOT_VERIFIED');
    assert.equal(phase.project_status, 'NOT_VERIFIED');
  }
  for (const number of [586, 588, 589, 590, 591]) {
    const phase = getPhase(report, number);
    assert.equal(phase.runtime_state, 'DARK');
    assert.ok(phase.runtime_evidence && Object.keys(phase.runtime_evidence).length > 0);
  }
});

const invalidSnapshots = {
  'wrong schema version': (input) => { input.schema_version = 2; },
  'unexpected repository': (input) => { input.repository = 'example/other'; },
  'missing phase': (input) => { input.phases.pop(); },
  'duplicate phase': (input) => { input.phases[8] = input.phases[0]; },
  'missing direct list': (input) => { delete getPhase(input, 586).direct_sub_issues; },
  'missing direct issue': (input) => { getPhase(input, 586).direct_sub_issues.pop(); },
  'missing count for empty direct list': (input) => { delete getPhase(input, 590).direct_total; },
  'unverified zero with missing direct list': (input) => { delete getPhase(input, 590).direct_sub_issues; },
  'invalid direct count': (input) => { getPhase(input, 586).direct_total = '3'; },
  'duplicate within direct list': (input) => {
    const direct = getPhase(input, 586).direct_sub_issues;
    direct[1] = { ...direct[0] };
  },
  'duplicate across direct parents': (input) => {
    getPhase(input, 585).direct_sub_issues[0] = { ...getPhase(input, 586).direct_sub_issues[0] };
  },
  'phase listed as its own child': (input) => { getPhase(input, 585).direct_sub_issues[0].number = 585; },
  'unknown state': (input) => { getPhase(input, 586).direct_sub_issues[0].state = 'done'; },
  'unknown state_reason': (input) => { getPhase(input, 586).direct_sub_issues[0].state_reason = 'fixed'; },
  'closed issue without state_reason': (input) => { delete getPhase(input, 586).direct_sub_issues[0].state_reason; },
  'closed issue with null state_reason': (input) => { getPhase(input, 586).direct_sub_issues[0].state_reason = null; },
  'unsupported duplicate closure': (input) => { getPhase(input, 586).direct_sub_issues[0].state_reason = 'duplicate'; },
  'closed issue with reopened state_reason': (input) => { getPhase(input, 586).direct_sub_issues[0].state_reason = 'reopened'; },
  'open issue with completed state_reason': (input) => { getPhase(input, 585).direct_sub_issues[0].state_reason = 'completed'; },
  'malformed SHA': (input) => { input.source_sha = 'b80539f'; },
  'well-formed source SHA from a different revision': (input) => { input.source_sha = '1'.repeat(40); },
  'missing source observation': (input) => { delete input.observed_at; },
  'noncanonical observation with timezone offset': (input) => { input.observed_at = '2026-11-26T16:00:00+00:00'; },
  'invalid calendar observation': (input) => { input.observed_at = '2026-11-31T16:00:00.000Z'; },
  'future observation': (input) => { input.observed_at = '2026-11-26T17:00:00.001Z'; },
  'stale observation': (input) => { input.observed_at = '2026-11-25T16:59:59.999Z'; },
  'untrusted Project payload': (input) => { input.project = { design_state: 'Shipped', status: 'Done' }; },
  'untrusted per-phase Project field': (input) => { getPhase(input, 586).project_status = 'Done'; },
  'untrusted per-phase runtime field': (input) => { getPhase(input, 586).runtime_state = 'LIVE'; },
};

for (const [name, invalidate] of Object.entries(invalidSnapshots)) {
  test(`rejects ${name}`, () => {
    const input = syntheticSnapshot();
    invalidate(input);
    assert.throws(() => calculateProgress(input, OPTIONS));
  });
}

test('insufficient Inspector evidence cannot yield verified runtime for #586', () => {
  const inspector = INSPECTOR.split('\n').filter((line) => !line.includes('ALL /api/v1/availability/*')).join('\n');
  const report = calculateProgress(syntheticSnapshot(), { ...OPTIONS, inspector });
  assert.equal(getPhase(report, 586).runtime_state, 'NOT_VERIFIED');
});

test('a partial Orders and Matching matrix cannot promote #587 to LIVE', () => {
  const inspector = INSPECTOR.split('\n')
    .filter((line) => !/^\| `(?:POST \/api\/v1\/(?:orders|matching)|PATCH \/api\/v1\/orders)/.test(line))
    .join('\n');
  const report = calculateProgress(syntheticSnapshot(), { ...OPTIONS, inspector });
  assert.equal(getPhase(report, 587).runtime_state, 'NOT_VERIFIED');
  assert.equal(getPhase(report, 588).runtime_state, 'DARK');
});

const API_REPOSITORY = 'https://api.github.com/repos/' + REPOSITORY;
const REPOSITORY_PATH = '/repos/' + REPOSITORY;
const REF_PATH = REPOSITORY_PATH + '/git/ref/heads/main';

function restIssue(number) {
  return {
    number,
    repository_url: API_REPOSITORY,
    html_url: 'https://github.com/' + REPOSITORY + '/issues/' + number,
    body: 'unused fixture field',
  };
}

function restMock(input, modify = (_path, response) => response) {
  const responses = new Map([[REF_PATH, { ref: 'refs/heads/main', object: { type: 'commit', sha: SHA } }]]);
  const requests = [];

  for (const phase of input.phases) {
    const number = phase.issue_number;
    const parentPath = REPOSITORY_PATH + '/issues/' + number;
    responses.set(parentPath, { ...restIssue(number), sub_issues_summary: { total: phase.direct_total } });
    for (let page = 1; page <= Math.floor(phase.direct_total / 100) + 1; page++) {
      const list = phase.direct_sub_issues.slice((page - 1) * 100, page * 100).map((child) => ({
        ...restIssue(child.number),
        ...child,
        parent_issue_url: API_REPOSITORY + '/issues/' + number,
      }));
      responses.set(parentPath + '/sub_issues?per_page=100&page=' + page, list);
    }
  }

  return {
    requests,
    request: async (path) => {
      requests.push(path);
      assert.ok(responses.has(path), 'unexpected REST read: ' + path);
      return modify(path, structuredClone(responses.get(path)), requests);
    },
    now: () => OBSERVED_AT,
  };
}

test('REST adapter checks all nine parents, ends pagination with an empty page and strips raw fields', async () => {
  const expected = syntheticSnapshot();
  getPhase(expected, 585).direct_sub_issues = Array.from({ length: 100 }, (_, index) =>
    issue(3001 + index, 'open', null));
  getPhase(expected, 585).direct_total = 100;
  const mock = restMock(expected);
  assert.deepEqual(await collectIssueSnapshot(SHA, mock), expected);
  assert.equal(mock.requests.filter((path) => path === REF_PATH).length, 2);
  for (const number of PHASE_NUMBERS) {
    const parentPath = REPOSITORY_PATH + '/issues/' + number;
    assert.equal(mock.requests.filter((path) => path === parentPath).length, 2);
    assert.ok(mock.requests.includes(parentPath + '/sub_issues?per_page=100&page=1'));
  }
  assert.ok(mock.requests.includes(REPOSITORY_PATH + '/issues/585/sub_issues?per_page=100&page=2'));
});

test('REST adapter rejects a child from the wrong parent and an unavailable parent total', async () => {
  const parentPath = REPOSITORY_PATH + '/issues/586';
  const wrongParent = restMock(syntheticSnapshot(), (path, response) => {
    if (path === parentPath + '/sub_issues?per_page=100&page=1') {
      response[0].parent_issue_url = API_REPOSITORY + '/issues/585';
    }
    return response;
  });
  const noTotal = restMock(syntheticSnapshot(), (path, response) => {
    if (path === parentPath) delete response.sub_issues_summary;
    return response;
  });
  await assert.rejects(collectIssueSnapshot(SHA, wrongParent));
  await assert.rejects(collectIssueSnapshot(SHA, noTotal));
});

test('REST adapter rejects an observation if main changes during collection', async () => {
  const mock = restMock(syntheticSnapshot(), (path, response, requests) => {
    if (path === REF_PATH && requests.filter((entry) => entry === REF_PATH).length === 2) {
      response.object.sha = '1'.repeat(40);
    }
    return response;
  });
  await assert.rejects(collectIssueSnapshot(SHA, mock));
});

test('offline CLI writes JSON on success and exits nonzero without percentages on invalid input', (context) => {
  const temp = mkdtempSync(join(tmpdir(), 'bazardrive-progress-test-'));
  context.after(() => rmSync(temp, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../scripts/project-progress.mjs', import.meta.url));
  const path = join(temp, 'synthetic.json');
  const run = () => spawnSync(process.execPath, [script, '--snapshot', path, SHA, AS_OF], { encoding: 'utf8' });

  const input = syntheticSnapshot();
  writeFileSync(path, JSON.stringify(input));
  const success = run();
  assert.equal(success.status, 0, success.stderr);
  const report = JSON.parse(success.stdout);
  assert.equal(report.issue_source, 'OFFLINE_INPUT');
  assert.equal(getPhase(report, 586).task_progress.percent, 100);

  getPhase(input, 586).direct_sub_issues.pop();
  writeFileSync(path, JSON.stringify(input));
  const failure = run();
  assert.ok(Number.isInteger(failure.status) && failure.status !== 0);
  assert.doesNotMatch(failure.stdout, /"percent"/);
});
