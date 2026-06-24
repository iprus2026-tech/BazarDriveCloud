// BD-OPS / #684 #6 — ScreenOps MEL export artifact (pure text, no I/O).
//
// MEL cards live only in localStorage (bazardrive.ops.mel.v1) — a deliberate
// dev-scratchpad boundary (public/src/ops/ops_mel_store.js), so a screen's findings
// don't survive a session or reach another agent / reviewer. This serialises a
// screen's MEL set into a PORTABLE artifact — a human-readable markdown digest PLUS
// a fenced, round-trippable JSON block — so an audit can be reviewed and tracked
// over time. It is READ-ONLY over the cards the dashboard passes in: it never reads,
// writes, or otherwise touches the storage key, so the boundary stays intact (#6 is
// "export … WITHOUT changing the storage boundary"). No persistence here.

// Collapse newlines + escape the cell separator so free-text never breaks a markdown
// table row. Used for table cells only; the Details + JSON blocks keep the raw text.
function cell(value) {
  return String(value == null ? '' : value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function dash(value) {
  const s = String(value == null ? '' : value).trim();
  return s || '—';
}

function lifecycleText(card) {
  return Array.isArray(card.lifecycleAudited) && card.lifecycleAudited.length
    ? card.lifecycleAudited.join(', ')
    : '—';
}

export function generateMelExport(screen = {}, cards = [], variantKey = '') {
  const id = screen.id || '(unknown screen id)';
  const route = screen.route || '(unknown route)';
  const file = screen.file || '(unknown file)';
  const title = screen.title || id;
  // Defensive, mirroring port_plan_template (#14): tolerate a non-array, or a
  // corrupt / hand-edited ops.mel.v1 carrying null / non-object entries — the export
  // button is presented as safe to press, so a single bad card must not crash it.
  const list = (Array.isArray(cards) ? cards : []).filter((c) => c && typeof c === 'object');

  // Open = not yet shipped (status !== DONE). Mirrors the dashboard's defect view.
  const open = list.filter((c) => c.status !== 'DONE').length;
  const done = list.length - open;

  // #684 — per-variant export scope: when a role variant is focused, the dashboard passes
  // only that variant's MELs (+ whole-screen ones); the header records the scope so the
  // artifact is unambiguous about what it does (and does not) cover.
  const focusV = variantKey && Array.isArray(screen.variants)
    ? screen.variants.find((v) => v && v.key === variantKey) : null;
  const header = [
    `ScreenOps MEL export — ${id} · ${title}`,
    ``,
    `Route: ${route}`,
    `File: ${file}`,
    ...(variantKey
      ? [`Variant scope: ${focusV ? `${focusV.label} (${focusV.key})` : variantKey} — this variant's MELs + whole-screen MELs only`]
      : []),
    `MELs: ${list.length} (${open} open · ${done} done)`,
  ];

  // The round-trippable JSON block is emitted BEFORE the free-text Details section so
  // it is always the FIRST ```json fence in the artifact. A MEL's own free-text can
  // legitimately contain a ```json fence (e.g. a MEL documenting a JSON bug); a
  // first-match extractor must never land on that decoy. JSON.stringify escapes all
  // newlines, so no line inside this block starts with ``` — the fence cannot close
  // early — and the table above never opens one (cells collapse newlines). (#684 #6.)
  const json = [
    ``,
    `Machine-readable (round-trippable JSON — emitted first so it always parses unambiguously):`,
    '```json',
    JSON.stringify(list, null, 2),
    '```',
  ];

  if (!list.length) {
    return header.concat([``, `No MEL cards logged for this screen yet.`], json).join('\n');
  }

  const table = [
    ``,
    `| # | Variant | Severity | Status | Reach | Lifecycle | Selector | PR | Problem |`,
    `|---|---------|----------|--------|-------|-----------|----------|----|---------|`,
  ].concat(
    list.map((c, i) =>
      `| ${i + 1} | ${cell(c.variant) || '—'} | ${cell(c.severity)} | ${cell(c.status)} | ${cell(c.reachability)} | `
      + `${cell(lifecycleText(c))} | ${cell(c.selector) || '—'} | ${cell(c.pr) || '—'} | ${cell(c.problem)} |`),
  );

  const details = ['', 'Details:'].concat(
    list.flatMap((c, i) => [
      ``,
      `### ${i + 1}. ${dash(c.severity)} · ${dash(c.status)} — ${dash(c.selector)}`,
      `- Role variant: ${c.variant || '(whole screen)'}`,
      `- Reachability: ${dash(c.reachability)}`,
      `- Lifecycle audited: ${lifecycleText(c)}`,
      `- PR / commit: ${dash(c.pr)}`,
      `- Problem: ${dash(c.problem)}`,
      `- Operational decision: ${dash(c.operationalDecision)}`,
      `- Required repair: ${dash(c.requiredRepair)}`,
      `- Recommended guard (#684 R7): ${dash(c.recommendedGuard)}`,
    ]),
  );

  // Order: header → table (quick scan) → JSON (machine, the only genuine fence) →
  // Details (deep dive; the one section that may carry a free-text decoy fence, now
  // safely AFTER the genuine block).
  return header.concat(table, json, details).join('\n');
}
