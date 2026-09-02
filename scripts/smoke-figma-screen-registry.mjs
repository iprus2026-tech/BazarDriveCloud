import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const figmaPath = path.join(root, 'docs', 'figma-screen-references.json');
const opsPath = path.join(root, 'public', 'src', 'ops', 'ops_registry.js');

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

const pass = (message) => console.log(`PASS: ${message}`);

if (!fs.existsSync(figmaPath)) {
  fail('docs/figma-screen-references.json is missing');
  process.exit();
}
if (!fs.existsSync(opsPath)) {
  fail('public/src/ops/ops_registry.js is missing');
  process.exit();
}

let figma;
try {
  figma = JSON.parse(fs.readFileSync(figmaPath, 'utf8'));
} catch (error) {
  fail(`Figma registry JSON parse failed: ${error.message}`);
  process.exit();
}

if (figma.schema !== 'bazardrive.figma-screen-references.v2') {
  fail(`unexpected Figma registry schema: ${figma.schema}`);
}
if (figma?.authority?.canonicalRegistry !== 'public/src/ops/ops_registry.js') {
  fail('Figma registry must declare ScreenOps as the canonical screen registry');
}
if (figma?.authority?.figmaRole !== 'visual-interaction-overlay') {
  fail('Figma registry must declare itself as a visual-interaction overlay');
}

const opsSource = fs.readFileSync(opsPath, 'utf8');
const start = opsSource.indexOf('const SCREENS = [');
const end = opsSource.indexOf('export const IMPLEMENTATION_STATUSES');
if (start === -1 || end === -1 || end <= start) {
  fail('could not isolate ScreenOps SCREENS registry');
  process.exit();
}

const screensBlock = opsSource.slice(start, end);
const opsScreens = [];
const entryPattern = /\bid:\s*'([^']+)'[\s\S]*?\broute:\s*'([^']+)'[\s\S]*?\bfile:\s*'([^']+)'/g;
let match;
while ((match = entryPattern.exec(screensBlock)) !== null) {
  opsScreens.push({ screenId: match[1], route: match[2], file: match[3] });
}

if (opsScreens.length < 20) {
  fail(`ScreenOps extraction unexpectedly found only ${opsScreens.length} screens`);
}

const figmaScreens = Array.isArray(figma.screens) ? figma.screens : [];
const byId = new Map();
for (const row of figmaScreens) {
  if (!row || typeof row !== 'object') {
    fail('Figma screens[] contains a non-object entry');
    continue;
  }
  if (typeof row.screenId !== 'string' || !row.screenId) {
    fail('Figma screen row is missing screenId');
    continue;
  }
  if (row.screenId.includes('/') || row.screenId.includes('..')) {
    fail(`compound/range alias leaked into canonical screenId: ${row.screenId}`);
  }
  if (byId.has(row.screenId)) {
    fail(`duplicate Figma screenId: ${row.screenId}`);
  }
  byId.set(row.screenId, row);
  if (typeof row.route !== 'string' || row.route.includes('?') || row.route.includes('<')) {
    fail(`canonical route must be query/placeholder-free for ${row.screenId}: ${row.route}`);
  }
  if (!Array.isArray(row.urlVariants)) {
    fail(`urlVariants[] missing for ${row.screenId}`);
  }
  if (!Array.isArray(row.files) || row.files.length === 0) {
    fail(`files[] missing for ${row.screenId}`);
  }
  if (row.renderStatus === 'current' && (typeof row.nodeId !== 'string' || !row.nodeId)) {
    fail(`current Figma row must have nodeId: ${row.screenId}`);
  }
  if (row.renderStatus === 'render-pending' && row.nodeId !== null) {
    fail(`render-pending Figma row must use nodeId:null: ${row.screenId}`);
  }
  if (!['current', 'render-pending'].includes(row.renderStatus)) {
    fail(`unsupported renderStatus for ${row.screenId}: ${row.renderStatus}`);
  }
}

const opsIds = new Set(opsScreens.map((row) => row.screenId));
for (const ops of opsScreens) {
  const overlay = byId.get(ops.screenId);
  if (!overlay) {
    fail(`ScreenOps product screen has no Figma overlay decision: ${ops.screenId}`);
    continue;
  }
  if (overlay.route !== ops.route) {
    fail(`route drift for ${ops.screenId}: ScreenOps=${ops.route}, Figma=${overlay.route}`);
  }
  if (!overlay.files.includes(ops.file)) {
    fail(`primary runtime file drift for ${ops.screenId}: missing ${ops.file}`);
  }
}

for (const id of byId.keys()) {
  if (!opsIds.has(id)) {
    fail(`Figma screenId is not canonical in ScreenOps: ${id}`);
  }
}

const exclusions = Array.isArray(figma.exclusions) ? figma.exclusions : [];
const opsExclusion = exclusions.find((item) => item?.route === '/ops/screens' && item?.kind === 'dev-docs');
if (!opsExclusion) {
  fail('/ops/screens must remain an explicit dev/docs exclusion');
}

const daily = byId.get('BD-DAILY-COMM-01');
if (!daily || daily.renderStatus !== 'render-pending' || daily.nodeId !== null) {
  fail('BD-DAILY-COMM-01 must remain an explicit render-pending overlay until a Figma node exists');
}

if (!process.exitCode) {
  pass(`${opsScreens.length}/${opsScreens.length} ScreenOps screens have canonical Figma overlay decisions`);
  pass('/ops/screens is explicitly excluded as dev/docs');
  pass('BD-DAILY-COMM-01 is explicitly render-pending');
}
