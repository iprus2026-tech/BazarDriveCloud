// BD-OPS / #684 #14 — per-screen port-plan generator (pure text, no I/O).
//
// A screen with MULTIPLE MELs is not N independent repairs: they share files (the screen
// JS + public/styles/cloud.css + sw.js), so their SW-version bumps must be sequenced and
// their branches managed to avoid the stacked-PR / version-collision traps. ScreenOps
// modelled "1 MEL = 1 repair" and had nothing for ORDERING a multi-finding port — this
// emits the plan. Distilled from the BD-CHAT-01 series (7 PRs, a stacked-PR auto-close
// (#699 — --delete-branch closed the dependent PR), and a SW VERSION collision (#701)).

const SEVERITY_RANK = { 'MEL-A': 0, 'MEL-B': 1, 'MEL-C': 2, 'MEL-D': 3 };
const REACH_RANK = { 'user-path': 0, 'dev-param': 1, 'edge': 2 };

// Order by severity first (MEL-A worst), then reachability (user-path first). Unknown
// severity sorts as MEL-C, unknown reachability as user-path — the common defaults.
function rankMel(mel = {}) {
  const sev = SEVERITY_RANK[mel && mel.severity];
  const reach = REACH_RANK[mel && mel.reachability];
  return (typeof sev === 'number' ? sev : 2) * 10 + (typeof reach === 'number' ? reach : 0);
}

export function generatePortPlan(screen = {}, mels = []) {
  const id = screen.id || '(unknown screen id)';
  const title = screen.title || id;
  const file = screen.file || '(unknown file)';
  const list = (Array.isArray(mels) ? mels : []).filter((m) => m && typeof m === 'object');
  const ordered = list.slice().sort((a, b) => rankMel(a) - rankMel(b));
  const n = ordered.length;

  const orderLines = n
    ? ordered.map((m, i) =>
        `${i + 1}. ${m.id || '(mel)'} — ${m.severity || 'MEL-C'} · ${m.reachability || 'user-path'}`
        + (m.selector ? ` · anchor ${m.selector}` : ''))
    : ['(no MEL cards logged for this screen yet — log them first, then re-generate the plan)'];

  return [
    `Port plan: ${id} — ${title} (${n} finding${n === 1 ? '' : 's'})`,
    ``,
    `These findings share files (${file} + public/styles/cloud.css + sw.js), so they are NOT independent repairs — order and sequence them.`,
    ``,
    `Recommended order (severity, then reachability — highest impact first):`,
    ...orderLines,
    ``,
    `Each is ONE small scoped PR — do NOT bundle (the BD-OPS rule).`,
    ``,
    `Shared-file + service-worker sequencing:`,
    `- every PR edits a precached file (the screen JS + cloud.css), so each MUST bump sw.js VERSION.`,
    `- sequence the bumps: each PR's VERSION must be ABOVE the previously MERGED one. Never leave two open PRs at the same vN — the second to merge ships no cache change (#701 / #705).`,
    `- cleanest cadence: open -> review -> MERGE -> branch the next from updated main. Minimise parallel precached PRs.`,
    ``,
    `Branching discipline:`,
    `- branch each PR from an updated main: git checkout main && git pull --ff-only origin main && git checkout -b <branch>.`,
    `- if you MUST stack PR-B on PR-A's branch, do NOT merge PR-A with --delete-branch — deleting the base auto-CLOSES the stacked PR-B (#699). Merge A first then branch B from updated main, or retarget B to main before deleting A's branch.`,
  ].join('\n');
}
