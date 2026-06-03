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
  'design-registry': { owner: 'CHATGPT', assist: ['CLOUD_DESIGN', 'CLAUDE_CODE'], desc: 'реестр render-gate секций и экранов (docs/design-registry.json)' },
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
// Путь существует И это именно файл (не директория). accessSync пропускал бы и
// папки — для design-registry artifact/export/file нужна именно file-семантика.
function isFile(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
// Нормализация id пути: Windows backslash → POSIX slash, чтобы классификация
// риска и дедуп проб не зависели от разделителя путей ОС.
function normalizeId(id) { return String(id).replace(/\\/g, '/'); }

// Абсолютный --target → repo-relative путь, чтобы абсолютная цель попадала в
// инвентарь и в special-case (docs/design-registry.json), а не падала в дефолт
// 'module'. Цель вне репозитория возвращается без изменений.
function toRepoRelative(p) {
  if (!p) return p;
  const abs = path.isAbsolute(p) ? p : path.resolve(ROOT, p);
  const relPath = path.relative(ROOT, abs);
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) return p;
  return relPath;
}

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
  // design-registry — структурный JSON-реестр render-gate секций. Из docs/
  // обычный обход берёт только .md, поэтому регистрируем его отдельным узлом.
  const designRegistry = path.join(ROOT, 'docs', 'design-registry.json');
  if (exists(designRegistry)) add(designRegistry, 'design-registry', 'реестр render-gate секций и экранов');
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
  for (const n of inventory) if (n.kind === 'smoke' && normalizeId(n.id) !== 'scripts/check.mjs') probes.push(n.id);
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
    const relForced = toRepoRelative(forced);
    const f = normalizeId(relForced);
    const hit = inventory.find((n) => normalizeId(n.id) === f || normalizeId(n.id).endsWith(f));
    if (hit) return { node: hit, reason: 'forced via --target' };
    return { node: { id: relForced, file: path.resolve(ROOT, relForced), kind: classify(relForced), hint: 'forced' },
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
  const p = normalizeId(relPath);
  if (p === 'docs/design-registry.json') return 'design-registry';
  if (p.endsWith('.css')) return 'style';
  if (p.endsWith('index.html')) return 'shell';
  if (p.endsWith('.md')) return 'doc';
  if (p.includes('.github/workflows')) return 'workflow';
  if (p.startsWith('scripts/')) return 'smoke';
  if (p.includes('/screens/')) return 'screen';
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
  const id = normalizeId(node.id);
  // HIGH — runtime приложения, маршрутизатор, state-машина, CSP, SW, Mapbox, ride/order flow.
  if (id.startsWith('public/src/')) return 'HIGH';
  if (id === 'public/index.html' || id === 'public/sw.js') return 'HIGH';
  // MEDIUM — инструментальный и визуальный слой + ключевые проектные доки.
  // design-registry — структурный контракт: правки только осознанные, без
  // слепой авто-гигиены (поэтому MEDIUM, а не LOW как обычные docs/*).
  if (id === 'docs/design-registry.json') return 'MEDIUM';
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
  if (normalizeId(node.id) === 'docs/dispatcher-report.md') return false;
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
function routeTasks(node, debug, designRegistry = null) {
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

  // Design drift — расхождения design-registry уходят владельцу реестра (ChatGPT).
  if (designRegistry && !designRegistry.ok && !designRegistry.skipped)
    push('CHATGPT', `Устранить design drift в docs/design-registry.json: ${designRegistry.gaps.length} расхождение(й) — `
      + designRegistry.gaps.map((g) => `${g.code}@${g.id}`).join(', ') + '.');
  if (designRegistry && designRegistry.skipped)
    push('CHATGPT', `docs/design-registry.json не валидируется: ${designRegistry.reason || 'не прочитан'} — починить реестр.`);

  // Merge gate — всегда финальная ответственность GitHub. Закрыт не только при
  // падении проверок, но и при design drift / непрочитанном реестре.
  const gateGreen = debug.green && (!designRegistry || (designRegistry.ok && !designRegistry.skipped));
  push('GITHUB', gateGreen
    ? 'Подтвердить зелёный CI и провести merge gate.'
    : 'Держать merge gate закрытым до зелёного CI.');

  // Дедуп по (role, task).
  const seen = new Set();
  return tasks.filter((t) => { const k = t.role + '::' + t.task; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------------------------------------------------------------------------
// Валидатор design-registry: сверяет docs/design-registry.json с живым деревом
// (артефакты render-gate, файлы экранов, маршруты в app.js, ссылки render-gate,
// покрытие секций). Только чтение — реестр это структурный контракт, рутина его
// не правит. Расхождения («design drift») уходят в отчёт и задачей владельцу.
// ---------------------------------------------------------------------------

// Маршруты, зарегистрированные в public/src/app.js: register('/path', loader).
// Чистая функция над исходником — без импорта/исполнения app.js. Комментарии
// (// и /* */) вырезаются до поиска, чтобы закомментированный register(...) не
// считался активным маршрутом.
function readRegisteredRoutes(appSrc) {
  const routes = new Set();
  const stripped = String(appSrc)
    .replace(/\/\*[\s\S]*?\*\//g, '')   // блочные /* ... */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // строчные // (не трогаем «://» в URL)
  const re = /register\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(stripped)) !== null) routes.add(m[1]);
  return routes;
}

// Чистое ядро аудита: без fs/ROOT. Зависимости (routes, fileExists) внедряются,
// чтобы selftest гонял его офлайн на синтетике. Толерантно к кривому-но-валидному
// JSON (renderGates/screens/sections могут отсутствовать → расхождения, не throw).
function auditDesignRegistry(registry, { routes, fileExists }) {
  const gaps = [];
  const notes = [];
  const gap = (code, id, detail) => gaps.push({ code, id, detail });
  const note = (code, id, detail) => notes.push({ code, id, detail });

  const renderGates = Array.isArray(registry && registry.renderGates) ? registry.renderGates : [];
  const screens = Array.isArray(registry && registry.screens) ? registry.screens : [];

  // #2 — структурный минимум: реестр без render-gate'ов или без экранов невалиден
  // (даже {} не должен быть ok). Дальнейшие проверки идут по тому, что есть.
  if (renderGates.length === 0)
    gap('MISSING_RENDER_GATES', '(registry)', 'renderGates отсутствует, не массив или пуст');
  if (screens.length === 0)
    gap('MISSING_SCREENS', '(registry)', 'screens отсутствует, не массив или пуст');

  // #1(art)/#4/#5 — у каждого render-gate: artifact (PDF), standaloneExport (HTML)
  // и непустой sections. Поле обязательно; путь обязан указывать на реальный ФАЙЛ
  // (не директорию) — fileExists несёт isFile-семантику.
  for (const g of renderGates) {
    const gid = (g && g.id) || '(no id)';
    const artifact = g && g.artifact ? String(g.artifact).trim() : '';
    if (!artifact) gap('MISSING_ARTIFACT', gid, 'поле artifact отсутствует или пусто');
    else if (!fileExists(artifact)) gap('MISSING_ARTIFACT', gid, `render-gate artifact не найден как файл: ${artifact}`);
    const standaloneExport = g && g.standaloneExport ? String(g.standaloneExport).trim() : '';
    if (!standaloneExport) gap('MISSING_EXPORT', gid, 'поле standaloneExport отсутствует или пусто');
    else if (!fileExists(standaloneExport)) gap('MISSING_EXPORT', gid, `standaloneExport не найден как файл: ${standaloneExport}`);
    // #4 — sections обязателен и непуст: gate с 0 секций нельзя считать CLEAN.
    if (!(Array.isArray(g && g.sections) && g.sections.length > 0))
      gap('MISSING_SECTIONS', gid, 'sections отсутствует, не массив или пуст');
  }

  const gateIds = new Set(renderGates.map((g) => g && g.id).filter(Boolean));
  let routesChecked = 0;
  let manualInteraction = 0;

  for (const s of screens) {
    const sid = (s && s.id) || '(no id)';

    // #1 — файл экрана: поле обязательно; путь обязан быть реальным ФАЙЛОМ (не
    // папкой и не несуществующим путём).
    const file = s && s.file ? String(s.file).trim() : '';
    if (!file) gap('MISSING_SCREEN_FILE', sid, 'поле file отсутствует или пусто');
    else if (!fileExists(file)) gap('MISSING_SCREEN_FILE', sid, `файл экрана не найден как файл: ${file}`);

    // #3 — экран обязан называть render-gate; ссылка обязана существовать.
    const renderGate = s && s.renderGate ? String(s.renderGate).trim() : '';
    if (!renderGate) gap('MISSING_RENDER_GATE', sid, 'поле renderGate отсутствует или пусто');
    else if (!gateIds.has(renderGate)) gap('BAD_RENDER_GATE', sid, `renderGate «${renderGate}» не найден среди renderGates[].id`);

    // #4/#7 — маршрут (база до «?») должен быть зарегистрирован в app.js.
    // Записи manual-interaction не требуют прямого routable-state: вместо
    // расхождения по маршруту выводим отдельную заметку. Для остальных экранов
    // route обязателен — пустой/отсутствующий это расхождение, а не «routable».
    if (s && s.interaction === 'manual-interaction') {
      manualInteraction++;
      const base = s.route ? String(s.route).split('?')[0] : '(no route)';
      note('MANUAL_INTERACTION', sid,
        `${s.section || '(no section)'}: ${s.note || `доступен через внутри-экранное действие, не прямым маршрутом (${base})`}`);
    } else if (s) {
      const route = s.route ? String(s.route).trim() : '';
      if (!route) {
        gap('MISSING_ROUTE', sid, 'у не-manual экрана отсутствует или пуст route');
      } else {
        routesChecked++;
        const base = route.split('?')[0];
        if (!routes.has(base))
          gap('UNREGISTERED_ROUTE', sid, `маршрут «${base}» не зарегистрирован в public/src/app.js`);
      }
    }
  }

  // #6 — каждая секция render-gate, кроме «cover», должна быть покрыта хотя бы
  // одним экраном ИМЕННО ЭТОГО render-gate. Покрытие считаем по паре
  // renderGate::section (а не по голому имени секции), чтобы секция в одном
  // render-gate не «закрывала» одноимённую секцию в другом. Учитываем ВСЕ
  // экраны, включая manual-interaction (иначе Safety, покрытая только ими,
  // ложно «провисает»).
  const coveredPairs = new Set(
    screens.filter((s) => s && s.renderGate && s.section).map((s) => s.renderGate + '::' + s.section),
  );
  let sectionsTracked = 0;
  let sectionsCovered = 0;
  for (const g of renderGates) {
    const gid = (g && g.id) || '(no id)';
    for (const sec of Array.isArray(g && g.sections) ? g.sections : []) {
      if (sec === 'cover') continue;
      sectionsTracked++;
      if (coveredPairs.has(gid + '::' + sec)) sectionsCovered++;
      else gap('UNCOVERED_SECTION', gid, `секция «${sec}» не покрыта ни одним экраном этого render-gate`);
    }
  }

  return {
    ok: gaps.length === 0,
    skipped: false,
    gaps,
    notes,
    summary: {
      renderGates: renderGates.length,
      screens: screens.length,
      sectionsTracked,
      sectionsCovered,
      manualInteraction,
      routesChecked,
      gaps: gaps.length,
      notes: notes.length,
    },
  };
}

// IO-обёртка: читает реестр + app.js, подставляет реальные зависимости и зовёт
// чистое ядро. Никогда не бросает: отсутствующий/битый файл → skipped-результат
// (отчёт это переживает; жёсткий gate ловит skipped в selfTest).
function validateDesignRegistry(registryFile) {
  const blankSummary = {
    renderGates: 0, screens: 0, sectionsTracked: 0, sectionsCovered: 0,
    manualInteraction: 0, routesChecked: 0, gaps: 0, notes: 0,
  };
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  } catch (e) {
    return { ok: false, skipped: true, reason: 'реестр не прочитан/не распарсен: ' + e.message,
             gaps: [], notes: [], summary: blankSummary };
  }
  let routes = new Set();
  const appFile = path.join(ROOT, 'public', 'src', 'app.js');
  try { routes = readRegisteredRoutes(fs.readFileSync(appFile, 'utf8')); }
  catch { /* app.js нет — все маршруты окажутся незарегистрированными (расхождение) */ }
  // isFile-семантика: artifact/export/file должны быть реальными файлами, не папками.
  const fileExists = (relPath) => isFile(path.join(ROOT, relPath));
  return auditDesignRegistry(registry, { routes, fileExists });
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
  const { target, debug, fixesApplied, tasks, iterations, ready, risk, autoFixable, suggestedOwner, designRegistry } = ctx;
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

  // Design registry / Design drift — сверка docs/design-registry.json с деревом.
  if (designRegistry) {
    lines.push('## Design registry / Design drift');
    lines.push('');
    const s = designRegistry.summary || {};
    const status = designRegistry.skipped
      ? `SKIPPED (${designRegistry.reason || 'реестр не прочитан'})`
      : designRegistry.ok ? 'CLEAN' : `DRIFT (${designRegistry.gaps.length} gap(s))`;
    lines.push('```text');
    lines.push('Registry      docs/design-registry.json');
    lines.push(`Render gates  ${s.renderGates || 0}   Screens ${s.screens || 0}   `
      + `Sections ${s.sectionsCovered || 0}/${s.sectionsTracked || 0} covered   `
      + `Manual notes ${s.manualInteraction || 0}`);
    lines.push(`Status        ${status}`);
    lines.push('```');
    lines.push('');
    if (!designRegistry.skipped && designRegistry.gaps.length) {
      lines.push('Gaps:');
      lines.push('');
      for (const g of designRegistry.gaps) lines.push(`- [${g.code}] ${g.id} — ${g.detail}`);
      lines.push('');
    }
    if (designRegistry.notes && designRegistry.notes.length) {
      lines.push('Manual-interaction notes (не расхождение — справочно):');
      lines.push('');
      for (const n of designRegistry.notes) lines.push(`- ${n.id} — ${n.detail}`);
      lines.push('');
    }
  }

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
  // design-registry — если файл существует, он обязан быть в инвентаре своим узлом.
  const drPath = path.join(ROOT, 'docs', 'design-registry.json');
  if (exists(drPath) && !inv.some((n) => n.kind === 'design-registry'))
    fail('docs/design-registry.json существует, но не зарегистрирован узлом design-registry');
  // routeTasks на «зелёном» дебаге обязан вернуть владельца и merge gate.
  const sample = inv.find((n) => n.kind === 'screen');
  const tasks = routeTasks(sample, { failures: [], green: true });
  if (!tasks.some((t) => t.role === 'GITHUB')) fail('routeTasks не назначил GitHub merge gate');
  if (!tasks.some((t) => t.role === (NODE_KINDS[sample.kind].owner))) fail('routeTasks не назначил владельца');
  // classify покрывает все типы.
  for (const [p, k] of [['public/styles/cloud.css', 'style'], ['public/index.html', 'shell'],
                        ['docs/x.md', 'doc'], ['scripts/smoke-x.mjs', 'smoke'],
                        ['docs/design-registry.json', 'design-registry'],
                        ['public/src/screens/feed.js', 'screen'], ['public/src/state.js', 'module']])
    if (classify(p) !== k) fail(`classify(${p}) ожидался ${k}, получено ${classify(p)}`);
  // Абсолютный --target нормализуется в repo-relative и сохраняет kind.
  const absRegistry = path.join(ROOT, 'docs', 'design-registry.json');
  if (toRepoRelative(absRegistry) !== 'docs' + path.sep + 'design-registry.json')
    fail(`toRepoRelative(absolute) ожидался repo-relative, получено ${toRepoRelative(absRegistry)}`);
  if (classify(toRepoRelative(absRegistry)) !== 'design-registry')
    fail('абсолютный путь design-registry должен классифицироваться как design-registry после нормализации');

  // Risk-граница: HIGH/MEDIUM узлы НЕ должны быть авто-фиксимыми.
  for (const id of ['public/src/screens/feed.js', 'public/src/router.js', 'public/src/state.js',
                    'public/src/mock_api.js', 'public/src/ride_state.js', 'public/src/mapbox/map_shell.js',
                    'public/index.html', 'public/sw.js']) {
    if (classifyRisk({ id }) !== 'HIGH') fail(`classifyRisk(${id}) должен быть HIGH`);
    if (canAutoFix({ id })) fail(`canAutoFix(${id}) должен быть false (HIGH-риск)`);
  }
  // Windows-style разделители должны классифицироваться идентично POSIX.
  for (const id of ['public\\src\\screens\\feed.js', 'public\\src\\router.js',
                    'public\\index.html', 'public\\sw.js']) {
    if (classifyRisk({ id }) !== 'HIGH') fail(`classifyRisk(${id}) должен быть HIGH (win-path)`);
    if (canAutoFix({ id })) fail(`canAutoFix(${id}) должен быть false (win-path public)`);
  }
  for (const id of ['scripts/check.mjs', 'public/styles/cloud.css', 'README.md', 'docs/screen-contracts.md', 'docs/design-registry.json'])
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

  // ── Валидатор design-registry ──────────────────────────────────────────
  // (a) Позитив: живой реестр обязан валидироваться без расхождений. Это и есть
  // CI-gate против design drift (skipped тоже фейл — реестр пропал/побился).
  const liveDr = validateDesignRegistry(path.join(ROOT, 'docs', 'design-registry.json'));
  if (liveDr.skipped) fail('design-registry validator: live-реестр skipped (' + (liveDr.reason || 'не прочитан') + ')');
  if (!liveDr.ok) fail('design drift в live-реестре: ' + liveDr.gaps.map((g) => g.code + '@' + g.id).join(', '));
  if (liveDr.summary.manualInteraction < 1) fail('live-реестр должен содержать manual-interaction записи');

  // (b) Негатив: на синтетике (офлайн, внедрённые зависимости) валидатор обязан
  // ловить каждую категорию расхождения и НЕ путать manual-interaction с gap.
  // RG-1 — поля artifact/export заполнены, но файлы отсутствуют; RG-2 — поля
  // вовсе отсутствуют. Секция «Shared» покрыта в RG-1, но НЕ в RG-2 (проверка
  // покрытия по паре renderGate::section). S-NOROUTE — не-manual без маршрута.
  const broken = {
    version: 1,
    renderGates: [
      { id: 'RG-1', artifact: 'missing/artifact.pdf', standaloneExport: 'missing/export.html',
        sections: ['cover', 'CoveredSec', 'OrphanSec', 'Shared'] },
      { id: 'RG-2', sections: ['cover', 'Shared'] },
    ],
    screens: [
      { id: 'S-FILE',    route: '/ok',               file: 'missing/screen.js', renderGate: 'RG-1',       section: 'CoveredSec' },
      { id: 'S-ROUTE',   route: '/nope?x=1',         file: 'exists/only.js',    renderGate: 'RG-1',       section: 'CoveredSec' },
      { id: 'S-RG',      route: '/ok',               file: 'exists/only.js',    renderGate: 'RG-MISSING', section: 'CoveredSec' },
      { id: 'S-NOROUTE', route: '',                  file: 'exists/only.js',    renderGate: 'RG-1',       section: 'Shared' },
      { id: 'S-MAN',     route: '/unregistered-too', file: 'exists/only.js',    renderGate: 'RG-1',       section: 'CoveredSec',
        interaction: 'manual-interaction', note: 'manual only' },
    ],
  };
  const a = auditDesignRegistry(broken, { routes: new Set(['/ok']), fileExists: (p) => p === 'exists/only.js' });
  const has = (code) => a.gaps.some((g) => g.code === code);
  for (const code of ['MISSING_ARTIFACT', 'MISSING_EXPORT', 'MISSING_SCREEN_FILE',
                      'UNREGISTERED_ROUTE', 'MISSING_ROUTE', 'BAD_RENDER_GATE', 'UNCOVERED_SECTION'])
    if (!has(code)) fail('auditDesignRegistry не поймал ' + code);
  if (a.ok) fail('битый реестр не должен быть ok');
  if (!a.notes.some((n) => n.code === 'MANUAL_INTERACTION' && n.id === 'S-MAN'))
    fail('manual-interaction экран должен давать заметку');
  if (a.gaps.some((g) => g.id === 'S-MAN'))
    fail('manual-interaction экран не должен порождать gap (маршрут не требуется)');
  // #3 — у не-manual экрана без route это MISSING_ROUTE, а не молчаливый routable.
  if (!a.gaps.some((g) => g.code === 'MISSING_ROUTE' && g.id === 'S-NOROUTE'))
    fail('не-manual экран без route должен давать MISSING_ROUTE');
  // #4 — обязательные поля artifact/standaloneExport: RG-2 без полей → gaps.
  if (!a.gaps.some((g) => g.code === 'MISSING_ARTIFACT' && g.id === 'RG-2'))
    fail('отсутствующее поле artifact должно давать MISSING_ARTIFACT');
  if (!a.gaps.some((g) => g.code === 'MISSING_EXPORT' && g.id === 'RG-2'))
    fail('отсутствующее поле standaloneExport должно давать MISSING_EXPORT');
  // #2 — покрытие по паре renderGate::section: Shared покрыта в RG-1, но не в RG-2;
  // OrphanSec не покрыта в RG-1. Итого ровно две непокрытые секции.
  const uncovered = a.gaps.filter((g) => g.code === 'UNCOVERED_SECTION');
  if (uncovered.length !== 2)
    fail('ожидались ровно две непокрытые секции (RG-1::OrphanSec, RG-2::Shared), получено ' + uncovered.length);
  if (!uncovered.some((g) => g.id === 'RG-2' && /Shared/.test(g.detail)))
    fail('секция Shared в RG-2 должна быть непокрыта, даже если покрыта в RG-1 (покрытие по renderGate)');

  // (c) Структурный минимум: пустой {} реестр НЕ должен быть ok.
  const emptyReg = auditDesignRegistry({}, { routes: new Set(), fileExists: () => false });
  if (emptyReg.ok) fail('пустой реестр {} не должен быть ok');
  if (!emptyReg.gaps.some((g) => g.code === 'MISSING_RENDER_GATES')) fail('{} должен давать MISSING_RENDER_GATES');
  if (!emptyReg.gaps.some((g) => g.code === 'MISSING_SCREENS')) fail('{} должен давать MISSING_SCREENS');

  // (d) Обязательные поля file / renderGate / sections.
  const sparse = auditDesignRegistry({
    renderGates: [{ id: 'RG-NOSEC', artifact: 'exists/only.js', standaloneExport: 'exists/only.js' }],
    screens: [
      { id: 'S-NOFILE', route: '/ok', renderGate: 'RG-NOSEC' },
      { id: 'S-NORG',   route: '/ok', file: 'exists/only.js' },
    ],
  }, { routes: new Set(['/ok']), fileExists: (p) => p === 'exists/only.js' });
  if (sparse.ok) fail('реестр с пропущенными обязательными полями не должен быть ok');
  if (!sparse.gaps.some((g) => g.code === 'MISSING_SECTIONS' && g.id === 'RG-NOSEC'))
    fail('render-gate без sections должен давать MISSING_SECTIONS');
  if (!sparse.gaps.some((g) => g.code === 'MISSING_SCREEN_FILE' && g.id === 'S-NOFILE'))
    fail('экран без file должен давать MISSING_SCREEN_FILE');
  if (!sparse.gaps.some((g) => (g.code === 'MISSING_RENDER_GATE' || g.code === 'BAD_RENDER_GATE') && g.id === 'S-NORG'))
    fail('экран без renderGate должен давать MISSING_RENDER_GATE/BAD_RENDER_GATE');

  // (e) isFile-семантика (#5): реальный файл — да; директория и несуществующий — нет.
  if (!isFile(path.join(ROOT, 'scripts', 'check.mjs'))) fail('isFile должен принимать реальный файл');
  if (isFile(path.join(ROOT, 'docs'))) fail('isFile не должен принимать директорию за файл');
  if (isFile(path.join(ROOT, 'no-such-file-xyz.js'))) fail('isFile не должен принимать несуществующий путь');
  // Директория, поданная как screens[].file, должна давать MISSING_SCREEN_FILE
  // (через ту же isFile-семантику, что и продакшен-обёртка validateDesignRegistry).
  const dirReg = auditDesignRegistry({
    renderGates: [{ id: 'RG-D', artifact: 'exists/only.js', standaloneExport: 'exists/only.js', sections: ['cover', 'Sec'] }],
    screens: [{ id: 'S-DIR', route: '/ok', file: 'docs', renderGate: 'RG-D', section: 'Sec' }],
  }, { routes: new Set(['/ok']), fileExists: (p) => isFile(path.join(ROOT, p)) });
  if (!dirReg.gaps.some((g) => g.code === 'MISSING_SCREEN_FILE' && g.id === 'S-DIR'))
    fail('директория в screens[].file должна давать MISSING_SCREEN_FILE');

  // readRegisteredRoutes — парсит register('/path', loader) в множество маршрутов.
  const sampleRoutes = readRegisteredRoutes("register('/feed', feed);\nregister( \"/profile\" , profile )");
  if (!sampleRoutes.has('/feed') || !sampleRoutes.has('/profile'))
    fail('readRegisteredRoutes не распарсил register() маршруты');
  // #5 — закомментированные register(...) игнорируются (// и /* */).
  const commentedRoutes = readRegisteredRoutes(
    "register('/live', live); // register('/trail', trail)\n// register('/dead', dead)\n/* register('/block', block) */");
  if (!commentedRoutes.has('/live')) fail('readRegisteredRoutes потерял активный register среди комментариев');
  for (const dead of ['/trail', '/dead', '/block'])
    if (commentedRoutes.has(dead)) fail('readRegisteredRoutes учёл закомментированный register ' + dead);

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

  // Аудит design-registry — независимо от выбранной цели: design drift это
  // проектный сигнал, а не свойство одного узла.
  const designRegistry = validateDesignRegistry(path.join(ROOT, 'docs', 'design-registry.json'));

  const tasks = routeTasks(target.node, debug, designRegistry);
  // READY учитывает и design drift: зелёных проверок недостаточно, реестр обязан
  // быть валиден (ok) и прочитан (не skipped), иначе merge gate = NEEDS-ROLES.
  const ready = debug.green && designRegistry.ok && !designRegistry.skipped;
  const suggestedOwner = ROLES[(NODE_KINDS[target.node.kind] || NODE_KINDS.module).owner].label;

  // Обновляем курсор/историю само-выбора.
  state.cursor = (inventory.findIndex((n) => n.id === target.node.id) + 1) % Math.max(1, inventory.length);
  state.history = [...(state.history || []), target.node.id].slice(-10);
  saveState(state);

  // Пишем отчёт-артефакт.
  const report = buildReport({ target, debug, fixesApplied, tasks, iterations, ready, risk, autoFixable, suggestedOwner, designRegistry });
  try { fs.writeFileSync(REPORT_FILE, report); } catch { /* best effort */ }

  if (args.json) {
    console.log(JSON.stringify({
      target: { id: target.node.id, kind: target.node.kind, reason: target.reason,
                risk, canAutoFix: autoFixable, suggestedOwner },
      debug: { green: debug.green, results: debug.results.map((r) => ({ id: r.id, ok: r.ok })) },
      fixesApplied, tasks, iterations, ready, mergeGate: ready ? 'READY' : 'NEEDS-ROLES',
      designRegistry: { ok: designRegistry.ok, skipped: designRegistry.skipped,
                        gaps: designRegistry.gaps, notes: designRegistry.notes, summary: designRegistry.summary },
      report: rel(REPORT_FILE),
    }, null, 2));
  } else {
    console.log(`\n=== BazarDrive Dispatcher ===`);
    console.log(`Цель:    ${target.node.id}  [${target.node.kind}]`);
    console.log(`Причина: ${target.reason}`);
    console.log(`Риск:    ${risk}   Авто-фикс: ${autoFixable ? 'да (safe)' : 'нет → роли'}   Владелец: ${suggestedOwner}`);
    console.log(`Дебаг:   ${debug.results.filter((r) => r.ok).length}/${debug.results.length} PASS`
      + (debug.green ? '  (зелёный)' : `  (падает: ${debug.failures.map((f) => f.id).join(', ')})`));
    console.log(`Drift:   ${designRegistry.skipped ? 'SKIPPED (' + (designRegistry.reason || 'реестр не прочитан') + ')'
      : designRegistry.ok ? 'CLEAN' : designRegistry.gaps.length + ' gap(s) — ' + designRegistry.gaps.map((g) => g.code).join(', ')}`
      + (designRegistry.summary && designRegistry.summary.manualInteraction ? `  (manual notes: ${designRegistry.summary.manualInteraction})` : ''));
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
