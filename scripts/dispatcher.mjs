#!/usr/bin/env node
// BazarDrive Dispatcher — self-driving project routine.
//
// Это апнутая «рутина-диспетчер»: она сама выбирает проектный узел
// (экран / файл / кнопку / render интерфейса), дебажит его, чинит
// безопасные дефекты, перепроверяет и раздаёт оставшиеся задачи по
// ролям (Claude Code / Cloud Design / ChatGPT / Codex / GitHub) —
// до зелёного состояния и готовности к фиксации (commit).
//
// Полностью локальная и автономная: только node-builtins, без сети, без
// API-ключей, без зависимостей. Раскладка задач по ролям — это локальный
// task routing (текстовые задачи в отчёте), а НЕ живые вызовы ChatGPT /
// Codex / Claude API. Совместима с CSP-инвариантами (живёт в scripts/, не
// попадает в public/ и не сканируется на inline style/script в check.mjs).
//
// Границы безопасности:
//   - default mode = inspect/report: НЕ трогает application code (public/src,
//     router, state, mock_api, ride_state, mapbox, index.html CSP, sw.js).
//     Пишет только отчёт docs/dispatcher-report.md и ignored-курсор.
//   - --fix = safe fixes only: обратимая гигиена (CRLF→LF, хвостовые пробелы,
//     финальный перевод строки) и ТОЛЬКО по LOW-риск узлам (docs). Любые
//     структурные дефекты и HIGH/MEDIUM узлы делегируются ролям (NEEDS-ROLES).
//   - READY != auto-merge: GitHub остаётся merge gate; READY значит лишь
//     «узел зелёный, PR можно рассматривать».
//
// Использование:
//   node scripts/dispatcher.mjs                 inspect/report (read-only по app-коду)
//   node scripts/dispatcher.mjs --fix           + safe fixes (только LOW-риск), цикл до зелёного
//   node scripts/dispatcher.mjs --target <путь> форсировать цель вместо само-выбора
//   node scripts/dispatcher.mjs --json          машиночитаемый вывод
//   node scripts/dispatcher.mjs --max N         предел итераций фикс-цикла (по умолчанию 3)
//   node scripts/dispatcher.mjs --selftest      самопроверка рутины, без мутаций (для check.mjs)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, '.dispatcher-state.json');
const REPORT_FILE = path.join(ROOT, 'docs', 'dispatcher-report.md');

// ---------------------------------------------------------------------------
// Роли диспетчера. Каждая цель распределяется владельцу (owner) и, при нужде,
// вспомогательным ролям. Это и есть «распределяет задачи между клауд код /
// клауд дизайн / чат гпт / codex / гитхаб».
// ---------------------------------------------------------------------------
const ROLES = {
  CLAUDE_CODE:  { label: 'Claude Code',  scope: 'логика, JS, баги, поведение, smoke-фиксы' },
  CLOUD_DESIGN: { label: 'Cloud Design', scope: 'CSS, render интерфейса, кнопки, визуальные состояния' },
  CHATGPT:      { label: 'ChatGPT',      scope: 'копирайт, контракты экранов, docs, формулировки' },
  CODEX:        { label: 'Codex',        scope: 'регрессионные тесты, генерация smoke, рефакторинг' },
  GITHUB:       { label: 'GitHub',       scope: 'CI/workflows, PR, issue triage, merge gate' },
};

// Тип узла → владелец и вспомогательные роли по умолчанию.
const NODE_KINDS = {
  screen:   { owner: 'CLAUDE_CODE', assist: ['CLOUD_DESIGN'], desc: 'экран (render + поведение)' },
  module:   { owner: 'CLAUDE_CODE', assist: [],               desc: 'JS-модуль состояния/логики' },
  style:    { owner: 'CLOUD_DESIGN', assist: [],              desc: 'CSS feature/design-токены' },
  shell:    { owner: 'CLOUD_DESIGN', assist: ['CLAUDE_CODE'], desc: 'оболочка index.html + кнопки/tabbar/FAB' },
  smoke:    { owner: 'CODEX', assist: ['CLAUDE_CODE'],        desc: 'smoke/CI-проверка' },
  doc:      { owner: 'CHATGPT', assist: [],                   desc: 'документ-контракт' },
  workflow: { owner: 'GITHUB', assist: [],                    desc: 'GitHub Actions workflow' },
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { fix: false, json: false, selftest: false, help: false, max: 3, target: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--fix') a.fix = true;
    else if (t === '--json') a.json = true;
    else if (t === '--selftest') a.selftest = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--max') a.max = Math.max(1, parseInt(argv[++i], 10) || 3);
    else if (t === '--target') a.target = argv[++i];
  }
  return a;
}

function printHelp() {
  console.log(`BazarDrive Dispatcher — локальная диспетчерская башня проекта (не автопилот).
Выбирает узел, гоняет проверки, сопоставляет падения с файлами, классифицирует
риск, раскладывает задачи по ролям, пишет отчёт-карточку и держит merge gate
через READY / NEEDS-ROLES. Только node-builtins: без сети, API и зависимостей.
Раскладка по ролям — локальный task routing, без живых вызовов ChatGPT/Codex/Claude API.

Использование:
  node scripts/dispatcher.mjs [флаги]

Режимы:
  (без флагов)        inspect/report — безопасный режим, read-only по app-коду
                      (public/src, router, state, mock_api, mapbox, CSP, sw.js).
                      Пишет только локальный отчёт и ignored-курсор.
  --fix               safe fixes only: обратимая гигиена (CRLF→LF, хвостовые
                      пробелы, финальный перевод строки) и ТОЛЬКО по LOW-риск
                      узлам (docs). HIGH/MEDIUM узлы и структурные дефекты
                      авто-фиксу не подлежат — уходят в роли (NEEDS-ROLES).
  --json              машиночитаемый вывод (target/risk/canAutoFix/tasks/mergeGate).
  --target <путь>     форсировать цель вместо само-выбора.
  --max N             предел итераций фикс-цикла (по умолчанию 3).
  --selftest          самопроверка рутины и risk-границ (для check.mjs), без мутаций.
  --help, -h          показать эту справку.

Отчёт: docs/dispatcher-report.md (локальный, git-ignored; регенерируется на прогоне).
       Стабильный пример формата: docs/dispatcher-report.example.md
Merge gate: READY != auto-merge — финальный gate всегда за GitHub/CI.`);
}

// ---------------------------------------------------------------------------
// Инвентаризация проектных узлов («узел / файл / кнопки / render интерфейса»).
// ---------------------------------------------------------------------------
function rel(p) { return path.relative(ROOT, p); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function listFiles(dir, exts, { recursive = true } = {}) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'prototypes' || entry.name === 'node_modules') continue;
      if (recursive) out.push(...listFiles(p, exts, { recursive }));
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

function buildInventory() {
  const nodes = [];
  const add = (file, kind, hint) => nodes.push({ id: rel(file), file, kind, hint });

  for (const f of listFiles(path.join(ROOT, 'public', 'src', 'screens'), ['.js']))
    add(f, 'screen', 'render + кнопки экрана');
  for (const f of listFiles(path.join(ROOT, 'public', 'src'), ['.js'])) {
    if (f.includes(`${path.sep}screens${path.sep}`)) continue;
    add(f, 'module', 'логика/состояние');
  }
  for (const f of listFiles(path.join(ROOT, 'public', 'styles'), ['.css'], { recursive: false }))
    add(f, 'style', 'визуальный слой / render');
  const shell = path.join(ROOT, 'public', 'index.html');
  if (exists(shell)) add(shell, 'shell', 'tabbar / FAB / sw-update кнопки');
  for (const f of listFiles(path.join(ROOT, 'scripts'), ['.mjs'], { recursive: false })) {
    if (rel(f) === 'scripts/dispatcher.mjs') continue;
    if (path.basename(f).startsWith('smoke-') || path.basename(f) === 'check.mjs')
      add(f, 'smoke', 'регрессионный инвариант');
  }
  for (const f of listFiles(path.join(ROOT, 'docs'), ['.md']))
    add(f, 'doc', 'контракт/аудит');
  for (const f of listFiles(path.join(ROOT, '.github', 'workflows'), ['.yml', '.yaml'], { recursive: false }))
    add(f, 'workflow', 'CI/деплой');

  return nodes;
}

// Узлы, недавно затронутые в git — даём им приоритет при само-выборе.
function recentlyTouched() {
  const set = new Set();
  const safe = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().split('\n').map((s) => s.trim()).filter(Boolean);
    } catch { return []; }
  };
  for (const f of safe(['diff', '--name-only', 'HEAD~1', 'HEAD'])) set.add(f);
  for (const f of safe(['status', '--porcelain'])) set.add(f.replace(/^.. /, '').trim());
  return set;
}

// ---------------------------------------------------------------------------
// Дебаг: гоняем check.mjs и каждый smoke, собираем pass/fail и хвосты ошибок.
// ---------------------------------------------------------------------------
function runProbe(scriptRelPath) {
  const abs = path.join(ROOT, scriptRelPath);
  if (!exists(abs)) return { id: scriptRelPath, ok: false, missing: true, tail: 'missing' };
  try {
    execFileSync(process.execPath, [abs], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return { id: scriptRelPath, ok: true, tail: '' };
  } catch (e) {
    const out = ((e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '')) || e.message;
    return { id: scriptRelPath, ok: false, tail: out.slice(-600).trim() };
  }
}

function runDebug(inventory) {
  const probes = ['scripts/check.mjs'];
  for (const n of inventory) if (n.kind === 'smoke' && n.id !== 'scripts/check.mjs') probes.push(n.id);
  const results = probes.map(runProbe);
  const failures = results.filter((r) => !r.ok);
  // Сопоставляем упавшие проверки с файлами проекта (для само-выбора цели).
  const implicated = new Set();
  for (const f of failures) {
    for (const n of inventory) {
      const base = path.basename(n.id);
      if (f.tail.includes(n.id) || f.tail.includes(base)) implicated.add(n.id);
    }
  }
  return { results, failures, implicated: [...implicated], green: failures.length === 0 };
}

// ---------------------------------------------------------------------------
// Само-выбор цели «на свой выбор».
//   1) если что-то падает → берём задетый узел (дебаг-приоритет);
//   2) иначе → round-robin по инвентарю с буустом недавно тронутых,
//      пропуская только что отработанные (история курсора).
// ---------------------------------------------------------------------------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { cursor: 0, history: [] }; }
}
function saveState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n'); } catch { /* best effort */ }
}

function selectTarget(inventory, debug, forced, state) {
  if (forced) {
    const hit = inventory.find((n) => n.id === forced || n.id.endsWith(forced));
    if (hit) return { node: hit, reason: 'forced via --target' };
    return { node: { id: forced, file: path.join(ROOT, forced), kind: classify(forced), hint: 'forced' },
             reason: 'forced via --target (вне инвентаря)' };
  }
  if (debug.implicated.length) {
    const hit = inventory.find((n) => n.id === debug.implicated[0]);
    if (hit) return { node: hit, reason: 'падает проверка/smoke — дебаг-приоритет' };
  }
  const touched = recentlyTouched();
  const touchedNode = inventory.find((n) => touched.has(n.id) && !state.history.slice(-3).includes(n.id));
  if (touchedNode) return { node: touchedNode, reason: 'недавно изменён в git' };

  const idx = state.cursor % inventory.length;
  return { node: inventory[idx], reason: 'плановый обход (round-robin)' };
}

function classify(relPath) {
  if (relPath.endsWith('.css')) return 'style';
  if (relPath.endsWith('index.html')) return 'shell';
  if (relPath.endsWith('.md')) return 'doc';
  if (relPath.includes('.github/workflows')) return 'workflow';
  if (relPath.startsWith('scripts/')) return 'smoke';
  if (relPath.includes('/screens/')) return 'screen';
  return 'module';
}

// ---------------------------------------------------------------------------
// Классификация риска узла. Определяет, можно ли вообще авто-фиксить цель.
//   HIGH   — application runtime / контракты: public/src/**, index.html, sw.js
//   MEDIUM — оснастка и визуал: scripts, styles, workflows, README/ROADMAP/contracts
//   LOW    — docs и генерируемые отчёты
// Авто-фикс разрешён ТОЛЬКО для LOW. Всё остальное уходит задачей в роли.
// ---------------------------------------------------------------------------
const MEDIUM_DOCS = new Set(['README.md', 'ROADMAP.md', 'docs/screen-contracts.md']);

function classifyRisk(node) {
  const id = node.id;
  // HIGH — runtime приложения, маршрутизатор, state-машина, CSP, SW, Mapbox, ride/order flow.
  if (id.startsWith('public/src/')) return 'HIGH';
  if (id === 'public/index.html' || id === 'public/sw.js') return 'HIGH';
  // MEDIUM — инструментальный и визуальный слой + ключевые проектные доки.
  if (id.startsWith('public/styles/')) return 'MEDIUM';
  if (id.startsWith('scripts/')) return 'MEDIUM';
  if (id.startsWith('.github/')) return 'MEDIUM';
  if (MEDIUM_DOCS.has(id)) return 'MEDIUM';
  // LOW — генерируемый отчёт и обычные docs.
  if (id.startsWith('docs/')) return 'LOW';
  return 'MEDIUM';
}

// Авто-фикс допустим только для LOW-риска. Генерируемый отчёт переписывается
// целиком в другом месте, поэтому как «цель фикса» исключён.
function canAutoFix(node) {
  if (node.id === 'docs/dispatcher-report.md') return false;
  return classifyRisk(node) === 'LOW';
}

// ---------------------------------------------------------------------------
// Безопасные авто-фиксы (только при --fix, только по выбранной цели).
// Whitelist: обратимая гигиена, не меняющая поведение и не трогающая CSP.
// Структурные дефекты (например inline style в JS) НЕ чинятся автоматически —
// они уходят в роль Cloud Design как задача.
// ---------------------------------------------------------------------------
function applySafeFixes(node) {
  const applied = [];
  if (!exists(node.file) || !fs.statSync(node.file).isFile()) return applied;
  // Жёсткая граница: авто-фикс только для LOW-риска (docs). HIGH/MEDIUM —
  // никогда не редактируются автоматически, даже при прямом вызове.
  if (!canAutoFix(node)) return applied;
  const orig = fs.readFileSync(node.file, 'utf8');
  let next = orig;

  if (next.includes('\r\n')) { next = next.replace(/\r\n/g, '\n'); applied.push('нормализован CRLF → LF'); }

  const detrailed = next.replace(/[ \t]+(\n)/g, '$1');
  if (detrailed !== next) { next = detrailed; applied.push('срезаны хвостовые пробелы'); }

  if (next.length && !next.endsWith('\n')) { next += '\n'; applied.push('добавлен финальный перевод строки'); }
  const collapsed = next.replace(/\n{3,}$/, '\n');
  if (collapsed !== next) { next = collapsed; applied.push('схлопнуты лишние пустые строки в конце'); }

  if (next !== orig) fs.writeFileSync(node.file, next);
  return applied;
}

// ---------------------------------------------------------------------------
// Распределение задач по ролям для выбранной цели + по упавшим проверкам.
// ---------------------------------------------------------------------------
function routeTasks(node, debug) {
  const tasks = [];
  const kind = NODE_KINDS[node.kind] || NODE_KINDS.module;
  const push = (role, task) => tasks.push({ role, roleLabel: ROLES[role].label, task });

  // Базовое владение целью.
  push(kind.owner, `Провести узел «${node.id}» (${kind.desc}) до зелёного и зафиксировать.`);
  for (const a of kind.assist) push(a, `Поддержать «${node.id}»: ${ROLES[a].scope}.`);

  // Render интерфейса / кнопки — всегда привлекаем Cloud Design.
  if (node.kind === 'screen' || node.kind === 'shell')
    push('CLOUD_DESIGN', `Сверить render и кнопки «${node.id}» с Cloud Design (тема, #FF6B35, состояния).`);

  // Падения проверок — конкретные фикс-задачи.
  for (const f of debug.failures) {
    if (/inline style/i.test(f.tail))
      push('CLOUD_DESIGN', `Убрать inline-style из ${f.id}: вынести в CSS-класс (CSP-инвариант).`);
    if (/Syntax error/i.test(f.tail))
      push('CLAUDE_CODE', `Починить синтаксис, на который ругается ${f.id}.`);
    if (/smoke/i.test(f.id))
      push('CLAUDE_CODE', `Восстановить контракт под ${f.id} (поведение упавшего smoke).`);
    push('CODEX', `Добавить/обновить регрессионный smoke, фиксирующий причину падения ${f.id}.`);
  }

  // Документы/контракты — ChatGPT; CI — GitHub.
  if (node.kind === 'doc') push('CHATGPT', `Актуализировать формулировки и acceptance в «${node.id}».`);
  if (node.kind === 'workflow') push('GITHUB', `Проверить, что workflow «${node.id}» зелёный на PR/branch.`);

  // Merge gate — всегда финальная ответственность GitHub.
  push('GITHUB', debug.green
    ? 'Подтвердить зелёный CI и провести merge gate.'
    : 'Держать merge gate закрытым до зелёного CI.');

  // Дедуп по (role, task).
  const seen = new Set();
  return tasks.filter((t) => { const k = t.role + '::' + t.task; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------------------------------------------------------------------
// Отчёт.
// ---------------------------------------------------------------------------
function groupByRole(tasks) {
  const map = new Map();
  for (const t of tasks) { if (!map.has(t.role)) map.set(t.role, []); map.get(t.role).push(t.task); }
  return map;
}

function buildReport(ctx) {
  const { target, debug, fixesApplied, tasks, iterations, ready, risk, autoFixable, suggestedOwner } = ctx;
  const date = new Date().toISOString().slice(0, 10);
  const mergeGate = ready ? 'READY' : 'NEEDS-ROLES';
  const grouped = groupByRole(tasks);
  const lines = [];

  lines.push('# Dispatcher report');
  lines.push('');
  lines.push(`Date: ${date}`);
  lines.push('');
  lines.push('Генерируется рутиной `scripts/dispatcher.mjs` — рабочая карточка узла, не править вручную.');
  lines.push('READY означает лишь «узел зелёный, PR можно рассматривать». Merge gate остаётся за GitHub.');
  lines.push('');

  // Карточка-шапка узла.
  lines.push('## Карточка узла');
  lines.push('');
  lines.push('```text');
  lines.push(`Target           ${target.node.id}`);
  lines.push(`Kind             ${target.node.kind} — ${(NODE_KINDS[target.node.kind] || {}).desc || ''}`);
  lines.push(`Reason selected  ${target.reason}`);
  lines.push(`Risk             ${risk}`);
  lines.push(`Can auto-fix     ${autoFixable ? 'yes (safe hygiene only)' : 'no — delegated to roles'}`);
  lines.push(`Suggested owner  ${suggestedOwner}`);
  lines.push(`Iterations       ${iterations}`);
  lines.push(`Merge gate       ${mergeGate}`);
  lines.push('```');
  lines.push('');

  // 1. Что проверено?
  lines.push('## 1. Что проверено (checks run)');
  lines.push('');
  lines.push('```text');
  for (const r of debug.results) lines.push(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}`);
  lines.push('```');
  lines.push('');

  // 2. Что упало? + 3. Почему упало?
  lines.push('## 2. Что упало (failures)');
  lines.push('');
  if (debug.failures.length) {
    lines.push('```text');
    for (const f of debug.failures) lines.push(`FAIL  ${f.id}`);
    lines.push('```');
    lines.push('');
    lines.push('## 3. Почему упало (хвосты)');
    lines.push('');
    for (const f of debug.failures) {
      lines.push('```text');
      lines.push(`# ${f.id}`);
      lines.push(f.tail || '(нет вывода)');
      lines.push('```');
    }
  } else {
    lines.push('```text');
    lines.push('(ничего — все проверки зелёные)');
    lines.push('```');
    lines.push('');
    lines.push('## 3. Почему упало');
    lines.push('');
    lines.push('```text');
    lines.push('(нет падений)');
    lines.push('```');
  }
  lines.push('');

  // Применённые safe-фиксы.
  lines.push('## Применённые safe-фиксы');
  lines.push('');
  lines.push('```text');
  lines.push(fixesApplied.length
    ? fixesApplied.map((x) => '- ' + x).join('\n')
    : autoFixable ? '(нет — safe-фиксов не потребовалось)'
                  : '(пропущено — узел не LOW-риск, авто-фикс запрещён)');
  lines.push('```');
  lines.push('');

  // 4. Кто чинит?
  lines.push('## 4. Кто чинит (распределение по ролям)');
  lines.push('');
  for (const role of Object.keys(ROLES)) {
    const items = grouped.get(role);
    if (!items || !items.length) continue;
    lines.push(`### ${ROLES[role].label} — _${ROLES[role].scope}_`);
    lines.push('');
    for (const t of items) lines.push(`- [ ] ${t}`);
    lines.push('');
  }

  // 5. Что должен сделать следующий PR?
  lines.push('## 5. Что следующий PR должен сделать');
  lines.push('');
  const nextSteps = ready
    ? [`Узел «${target.node.id}» зелёный — PR можно рассматривать; GitHub проводит merge gate.`]
    : tasks.filter((t) => t.role !== 'GITHUB').map((t) => `(${t.roleLabel}) ${t.task}`);
  lines.push('```text');
  for (const s of nextSteps) lines.push('- ' + s);
  lines.push('```');
  lines.push('');

  // Merge gate.
  lines.push('## Merge gate');
  lines.push('');
  lines.push('```text');
  lines.push(ready
    ? 'READY — узел зелёный, PR можно рассматривать. Это НЕ auto-merge: финальный gate за GitHub.'
    : 'NEEDS-ROLES — остались задачи по ролям; merge gate держать закрытым до зелёного CI.');
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Self-test: рутина проверяет саму себя без мутаций проекта (для check.mjs).
// ---------------------------------------------------------------------------
function selfTest() {
  const fail = (m) => { console.error('SELFTEST FAIL — ' + m); process.exit(1); };
  const inv = buildInventory();
  if (!inv.length) fail('инвентарь пуст');
  if (!inv.some((n) => n.kind === 'screen')) fail('не найдено ни одного экрана');
  if (!inv.some((n) => n.kind === 'smoke')) fail('не найдено ни одной smoke-проверки');
  // routeTasks на «зелёном» дебаге обязан вернуть владельца и merge gate.
  const sample = inv.find((n) => n.kind === 'screen');
  const tasks = routeTasks(sample, { failures: [], green: true });
  if (!tasks.some((t) => t.role === 'GITHUB')) fail('routeTasks не назначил GitHub merge gate');
  if (!tasks.some((t) => t.role === (NODE_KINDS[sample.kind].owner))) fail('routeTasks не назначил владельца');
  // classify покрывает все типы.
  for (const [p, k] of [['public/styles/cloud.css', 'style'], ['public/index.html', 'shell'],
                        ['docs/x.md', 'doc'], ['scripts/smoke-x.mjs', 'smoke'],
                        ['public/src/screens/feed.js', 'screen'], ['public/src/state.js', 'module']])
    if (classify(p) !== k) fail(`classify(${p}) ожидался ${k}, получено ${classify(p)}`);

  // Risk-граница: HIGH/MEDIUM узлы НЕ должны быть авто-фиксимыми.
  for (const id of ['public/src/screens/feed.js', 'public/src/router.js', 'public/src/state.js',
                    'public/src/mock_api.js', 'public/src/ride_state.js', 'public/src/mapbox/map_shell.js',
                    'public/index.html', 'public/sw.js']) {
    if (classifyRisk({ id }) !== 'HIGH') fail(`classifyRisk(${id}) должен быть HIGH`);
    if (canAutoFix({ id })) fail(`canAutoFix(${id}) должен быть false (HIGH-риск)`);
  }
  for (const id of ['scripts/check.mjs', 'public/styles/cloud.css', 'README.md', 'docs/screen-contracts.md'])
    if (canAutoFix({ id })) fail(`canAutoFix(${id}) должен быть false (MEDIUM-риск)`);
  if (canAutoFix({ id: 'docs/dispatcher-report.md' })) fail('генерируемый отчёт не должен быть авто-фиксимым');
  if (!canAutoFix({ id: 'docs/flow-contracts.md' })) fail('обычный docs/*.md (LOW) должен быть авто-фиксимым');

  // Инвариант: рутина никогда не пишет внутрь public/ (runtime-дерево).
  const publicDir = path.join(ROOT, 'public') + path.sep;
  for (const [label, p] of [['REPORT_FILE', REPORT_FILE], ['STATE_FILE', STATE_FILE]])
    if (p.startsWith(publicDir)) fail(`${label} не должен находиться внутри public/ (${rel(p)})`);

  // Guard в applySafeFixes: для HIGH-узла возвращает [] и НЕ пишет файл.
  const highNode = inv.find((n) => n.kind === 'screen');
  if (highNode) {
    const before = fs.readFileSync(highNode.file, 'utf8');
    const applied = applySafeFixes(highNode);
    if (applied.length) fail('applySafeFixes тронул HIGH-узел');
    if (fs.readFileSync(highNode.file, 'utf8') !== before) fail('applySafeFixes изменил HIGH-узел на диске');
  }
  console.log('Dispatcher selftest passed.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }
  if (args.selftest) return selfTest();

  const inventory = buildInventory();
  const state = loadState();

  // Первичный дебаг до выбора цели — чтобы приоритетно взять упавший узел.
  let debug = runDebug(inventory);
  const target = selectTarget(inventory, debug, args.target, state);
  const risk = classifyRisk(target.node);
  const autoFixable = canAutoFix(target.node);

  const fixesApplied = [];
  let iterations = 1;
  // Цикл «до полной фиксации»: дебаг → safe fix → перепроверка.
  // Авто-фикс срабатывает ТОЛЬКО для LOW-риск целей; HIGH/MEDIUM узлы
  // никогда не редактируются автоматически — они уходят задачей в роли.
  while (true) {
    if (debug.green) break;
    if (!args.fix) break;
    if (!autoFixable) break;             // risk != LOW → делегируем ролям
    const applied = applySafeFixes(target.node);
    if (!applied.length) break;          // safe-фиксы исчерпаны → дальше роли
    fixesApplied.push(...applied);
    if (iterations >= args.max) break;
    iterations++;
    debug = runDebug(inventory);
  }

  const tasks = routeTasks(target.node, debug);
  const ready = debug.green;
  const suggestedOwner = ROLES[(NODE_KINDS[target.node.kind] || NODE_KINDS.module).owner].label;

  // Обновляем курсор/историю само-выбора.
  state.cursor = (inventory.findIndex((n) => n.id === target.node.id) + 1) % Math.max(1, inventory.length);
  state.history = [...(state.history || []), target.node.id].slice(-10);
  saveState(state);

  // Пишем отчёт-артефакт.
  const report = buildReport({ target, debug, fixesApplied, tasks, iterations, ready, risk, autoFixable, suggestedOwner });
  try { fs.writeFileSync(REPORT_FILE, report); } catch { /* best effort */ }

  if (args.json) {
    console.log(JSON.stringify({
      target: { id: target.node.id, kind: target.node.kind, reason: target.reason,
                risk, canAutoFix: autoFixable, suggestedOwner },
      debug: { green: debug.green, results: debug.results.map((r) => ({ id: r.id, ok: r.ok })) },
      fixesApplied, tasks, iterations, ready, mergeGate: ready ? 'READY' : 'NEEDS-ROLES',
      report: rel(REPORT_FILE),
    }, null, 2));
  } else {
    console.log(`\n=== BazarDrive Dispatcher ===`);
    console.log(`Цель:    ${target.node.id}  [${target.node.kind}]`);
    console.log(`Причина: ${target.reason}`);
    console.log(`Риск:    ${risk}   Авто-фикс: ${autoFixable ? 'да (safe)' : 'нет → роли'}   Владелец: ${suggestedOwner}`);
    console.log(`Дебаг:   ${debug.results.filter((r) => r.ok).length}/${debug.results.length} PASS`
      + (debug.green ? '  (зелёный)' : `  (падает: ${debug.failures.map((f) => f.id).join(', ')})`));
    if (fixesApplied.length) console.log(`Фиксы:   ${fixesApplied.join('; ')}`);
    const grouped = groupByRole(tasks);
    console.log(`\nЗадачи по ролям:`);
    for (const role of Object.keys(ROLES)) {
      const items = grouped.get(role);
      if (!items || !items.length) continue;
      console.log(`  • ${ROLES[role].label}:`);
      for (const t of items) console.log(`      - ${t}`);
    }
    console.log(`\nОтчёт:   ${rel(REPORT_FILE)}`);
    console.log(`Статус:  ${ready ? 'READY — можно фиксировать (commit)' : 'NEEDS-ROLES — merge gate закрыт'}\n`);
  }

  // Не валим вызов из-за NEEDS-ROLES: рутина — оркестратор, а не gate.
  // Код возврата 0, если рутина отработала; жёсткий gate остаётся за check.mjs.
  process.exit(0);
}

main();
