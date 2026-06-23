// BD-OPS / #684 #1 — a shared role-variant focus note for the ScreenOps prompt
// generators (Cloud Design / Claude Code / GitHub issue). When a variant is selected in
// the dashboard, the generated artifact is scoped to that single render path instead of
// the whole screen. Returns '' when no variant is selected, the screen declares none, or
// the key is unknown — so a generator degrades cleanly to a whole-screen prompt.
//
// Pure string helper — no I/O, no DOM, no state.

export function variantFocusNote(screen = {}, variantKey = '') {
  if (!variantKey) return '';
  const v = (Array.isArray(screen.variants) ? screen.variants : []).find((x) => x && x.key === variantKey);
  if (!v) return '';
  return `Role variant focus (#684): scope this to the ${v.label || v.key} render path `
    + `(${v.anchor || '?'}) of ${screen.id || 'the screen'} — it renders when `
    + `${v.entry || '(unspecified)'}. Target ONLY this variant; do not restyle or change `
    + `the screen's other role variants in the same artifact.`;
}
