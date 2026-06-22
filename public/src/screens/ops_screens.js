// BD-OPS-03 — ScreenOps dashboard (dev/docs tool, route /ops/screens).
//
// Internal developer surface: browse the screen registry, mark a crooked screen
// as a local MEL card, and generate copy-paste repair prompts (Cloud Design /
// GitHub issue / Claude Code) plus the check commands. This route is NOT in the
// passenger/driver tabbar. No backend, no network — registry is static data and
// MEL cards persist in localStorage via ops_mel_store.
//
// BD-OPS-08 (#647): MEL cards have a full lifecycle — a New MEL editor form
// (severity/status/problem/decision/repair), a per-card status-advance control,
// and a per-card delete.
//
// CSP: no inline styles, no inline handlers — all wiring is event delegation.

import { go } from '../router.js';
import { user } from '../state.js';
import { getScreens, getScreen } from '../ops/ops_registry.js';
import {
  listMelForScreen,
  listAllMel,
  createMelCard,
  updateMelCard,
  deleteMelCard,
  nextMelStatus,
  MEL_SEVERITIES,
  MEL_STATUSES,
  MEL_REACHABILITY,
  MEL_LIFECYCLE_STATES,
} from '../ops/ops_mel_store.js';
import { renderMelCard } from '../ops/templates/screen_mel_card_template.js';
import { buildCloudDesignPrompt } from '../ops/connectors/cloud_design_connector.js';
import { buildGithubIssue } from '../ops/connectors/github_issue_connector.js';
import { buildClaudeCodePrompt } from '../ops/connectors/claude_code_connector.js';
import { buildCheckCommands } from '../ops/connectors/checks_connector.js';
import { buildAuditRecipe } from '../ops/connectors/audit_recipe_connector.js';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getParam(name) {
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi === -1) return null;
  return new URLSearchParams(hash.slice(qi + 1)).get(name);
}

function optionList(values, selected) {
  return values
    .map((v) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(v)}</option>`)
    .join('');
}

// Defect severities (MEL-A..D). WAITING/OK are MEL lifecycle states, not defects,
// so they drive neither the open-MEL badge nor the severity filter chips — only
// the badge/filter signal would otherwise advertise an "OK" screen as a problem.
const DEFECT_SEVERITIES = MEL_SEVERITIES.filter((s) => s.startsWith('MEL-'));

export default function opsScreens() {
  const screens = getScreens();

  const state = {
    selectedId: getParam('screen') || (screens[0] && screens[0].id) || null,
    search: '',
    outputLabel: '',
    outputText: '',
    notice: '',
    // The MEL editor form, or null when closed. Holds the in-progress field
    // values so an unrelated re-render does not drop what the user typed.
    melForm: null,
    // Registry filters — '' means "any". Compose with the text search.
    filters: { role: '', severity: '', status: '' },
  };
  if (!getScreen(state.selectedId)) {
    state.selectedId = (screens[0] && screens[0].id) || null;
  }

  const root = document.createElement('section');
  root.className = 'screen screen--ops-screens';
  root.innerHTML = `
    <header class="ops-head">
      <div class="ops-head__row">
        <h1 class="ops-head__title">ScreenOps</h1>
        <span class="ops-head__badge">dev/docs</span>
      </div>
      <p class="ops-head__sub">Find a crooked screen, log a MEL card, generate repair prompts.</p>
    </header>
    <div class="ops-layout">
      <aside class="ops-aside">
        <input id="ops-search" class="ops-search" type="search"
          placeholder="Search screens…" aria-label="Search screens" autocomplete="off">
        <div id="ops-filters" class="ops-filters"></div>
        <ul id="ops-list" class="ops-reg" role="listbox" aria-label="Screen registry"></ul>
      </aside>
      <main id="ops-detail" class="ops-detail" aria-live="polite"></main>
    </div>
  `;

  const listEl = root.querySelector('#ops-list');
  const detailEl = root.querySelector('#ops-detail');
  const searchEl = root.querySelector('#ops-search');
  const filtersEl = root.querySelector('#ops-filters');

  function statusPill(value, kind) {
    return `<span class="ops-pill ops-pill--${esc(kind)}">${esc(value)}</span>`;
  }

  // Group every MEL card by screen in a single read, so the list can render
  // per-row badges and apply MEL filters without a load() per screen.
  function melByScreen() {
    const map = new Map();
    for (const c of listAllMel()) {
      const list = map.get(c.screenId) || [];
      list.push(c);
      map.set(c.screenId, list);
    }
    return map;
  }

  // Most severe severity among a set of cards (MEL_SEVERITIES is ordered
  // most→least severe), or '' if none are classified.
  function topSeverity(cards) {
    let best = '';
    let bestIdx = Infinity;
    for (const c of cards) {
      const i = MEL_SEVERITIES.indexOf(c.severity);
      if (i !== -1 && i < bestIdx) { bestIdx = i; best = c.severity; }
    }
    return best;
  }

  function filterChip(group, value, label) {
    const on = state.filters[group] === value;
    return `<button type="button" class="ops-chip${on ? ' ops-chip--active' : ''}" data-action="filter-${group}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
  }

  function renderFilters() {
    const roles = [['', 'Any'], ['passenger', 'Passenger'], ['driver', 'Driver'], ['shared', 'Shared']];
    // Data-drive from the canonical vocab so every severity that can appear in a
    // badge (incl. WAITING/OK) is also filterable; labels drop the MEL- prefix.
    const sevs = [['', 'Any'], ...DEFECT_SEVERITIES.map((sv) => [sv, sv.replace('MEL-', '')])];
    const statusOpts = ['', ...MEL_STATUSES]
      .map((v) => `<option value="${esc(v)}"${state.filters.status === v ? ' selected' : ''}>${v ? esc(v) : 'Any status'}</option>`)
      .join('');
    filtersEl.innerHTML = `
      <div class="ops-filters__group">
        <span class="ops-filters__label">Role</span>
        <div class="ops-filters__chips">${roles.map(([v, l]) => filterChip('role', v, l)).join('')}</div>
      </div>
      <div class="ops-filters__group">
        <span class="ops-filters__label">Severity</span>
        <div class="ops-filters__chips">${sevs.map(([v, l]) => filterChip('severity', v, l)).join('')}</div>
      </div>
      <div class="ops-filters__group">
        <span class="ops-filters__label">Status</span>
        <select id="ops-filter-status" class="ops-filters__select" aria-label="Filter by MEL status">${statusOpts}</select>
      </div>`;
  }

  function renderList() {
    const term = state.search.trim().toLowerCase();
    const f = state.filters;
    const melMap = melByScreen();
    const rows = screens.filter((s) => {
      if (term && !(
        s.id.toLowerCase().includes(term) ||
        (s.title || '').toLowerCase().includes(term) ||
        (s.route || '').toLowerCase().includes(term)
      )) return false;
      if (f.role && !(s.role || '').toLowerCase().includes(f.role)) return false;
      const cards = melMap.get(s.id) || [];
      // Combined MEL filters must be satisfied by the SAME card — otherwise
      // severity and status could each match a different card (false positive).
      // Severity WITHOUT an explicit status is scoped to open cards so it agrees
      // with the open-only badge; adding a status filter overrides that scoping
      // so completed (DONE) cards of that severity stay reachable.
      if ((f.severity || f.status) && !cards.some((c) =>
        (!f.severity || c.severity === f.severity) &&
        (!f.status || c.status === f.status) &&
        (!f.severity || f.status || c.status !== 'DONE'))) return false;
      return true;
    });
    if (!rows.length) {
      listEl.innerHTML = `<li class="ops-reg__empty">No screens match the current search and filters.</li>`;
      return;
    }
    listEl.innerHTML = rows
      .map((s) => {
        const active = s.id === state.selectedId ? ' ops-reg__item--active' : '';
        const open = (melMap.get(s.id) || []).filter((c) => c.status !== 'DONE' && DEFECT_SEVERITIES.includes(c.severity));
        const sev = topSeverity(open);
        const melBadge = open.length
          ? `<span class="ops-pill ops-pill--mel" title="${open.length} open MEL card(s)">${esc(sev || 'MEL')} · ${open.length}</span>`
          : '';
        return `
          <li>
            <button type="button" class="ops-reg__item${active}" data-action="select-screen" data-id="${esc(s.id)}">
              <span class="ops-reg__id">${esc(s.id)}</span>
              <span class="ops-reg__title">${esc(s.title)}</span>
              <span class="ops-reg__route">${esc(s.route)}</span>
              <span class="ops-reg__pills">
                ${statusPill(s.implementationStatus, s.implementationStatus)}
                ${melBadge}
              </span>
            </button>
          </li>`;
      })
      .join('');
  }

  function renderMelForm() {
    if (!state.melForm) return '';
    const f = state.melForm;
    return `
      <form class="ops-melform" autocomplete="off">
        <p class="ops-melform__title">New MEL card</p>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Severity</span>
          <select id="mel-severity" class="ops-melform__control">${optionList(MEL_SEVERITIES, f.severity)}</select>
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Status</span>
          <select id="mel-status" class="ops-melform__control">${optionList(MEL_STATUSES, f.status)}</select>
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Reachability</span>
          <select id="mel-reachability" class="ops-melform__control">${optionList(MEL_REACHABILITY, f.reachability)}</select>
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Anchor (selector/symbol)</span>
          <input id="mel-selector" class="ops-melform__control" type="text" value="${esc(f.selector)}" placeholder="#pf2-doc-add or markGarageVehicleActive">
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Lifecycle audited (entry-states)</span>
          <select id="mel-lifecycle" class="ops-melform__control" multiple size="4" aria-label="Lifecycle entry-states audited">${MEL_LIFECYCLE_STATES.map((st) => `<option value="${esc(st)}"${(f.lifecycleAudited || []).includes(st) ? ' selected' : ''}>${esc(st)}</option>`).join('')}</select>
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Resolved by (PR / commit)</span>
          <input id="mel-pr" class="ops-melform__control" type="text" value="${esc(f.pr)}" placeholder="#683 or a commit SHA">
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Problem</span>
          <textarea id="mel-problem" class="ops-melform__control" rows="2">${esc(f.problem)}</textarea>
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Operational decision</span>
          <textarea id="mel-decision" class="ops-melform__control" rows="2">${esc(f.operationalDecision)}</textarea>
        </label>
        <label class="ops-melform__row">
          <span class="ops-melform__label">Required repair</span>
          <textarea id="mel-repair" class="ops-melform__control" rows="2">${esc(f.requiredRepair)}</textarea>
        </label>
        <div class="ops-melform__actions">
          <button type="button" class="ops-btn ops-btn--accent" data-action="mel-form-save">Save MEL card</button>
          <button type="button" class="ops-btn ops-btn--ghost" data-action="mel-form-cancel">Cancel</button>
        </div>
      </form>`;
  }

  function renderDetail() {
    const s = getScreen(state.selectedId);
    if (!s) {
      detailEl.innerHTML = `<p class="ops-detail__empty">Select a screen.</p>`;
      return;
    }
    const mels = listMelForScreen(s.id);
    const melBlock = mels.length
      ? mels
          .map(
            (m) => `
            <div class="ops-melitem">
              <pre class="ops-melcard">${esc(renderMelCard(m))}</pre>
              <div class="ops-melitem__actions">
                ${
                  // Terminal (DONE) or an out-of-vocab persisted status both have
                  // no next step — show the status, not an inert Advance button.
                  nextMelStatus(m.status) === m.status
                    ? `<span class="ops-melitem__done">${esc(m.status)}</span>`
                    : `<button type="button" class="ops-btn ops-btn--ghost" data-action="advance-mel" data-mel-id="${esc(m.id)}">Advance → ${esc(nextMelStatus(m.status))}</button>`
                }
                <button type="button" class="ops-btn ops-btn--ghost" data-action="set-pr" data-mel-id="${esc(m.id)}">Set PR</button>
                <button type="button" class="ops-btn ops-btn--ghost" data-action="delete-mel" data-mel-id="${esc(m.id)}">Delete</button>
              </div>
            </div>`,
          )
          .join('')
      : `<p class="ops-detail__empty">No MEL cards for this screen yet.</p>`;

    const output = state.outputText
      ? `
        <div class="ops-output">
          <div class="ops-output__head">
            <span class="ops-output__label">${esc(state.outputLabel)}</span>
            <button type="button" class="ops-btn ops-btn--ghost" data-action="copy-output">Copy</button>
          </div>
          <pre class="ops-output__text">${esc(state.outputText)}</pre>
        </div>`
      : '';

    const notice = state.notice
      ? `<p class="ops-notice" role="status">${esc(state.notice)}</p>`
      : '';

    detailEl.innerHTML = `
      <div class="ops-card">
        <div class="ops-card__head">
          <h2 class="ops-card__title">${esc(s.title)}</h2>
          ${statusPill(s.implementationStatus, s.implementationStatus)}
        </div>
        <dl class="ops-meta">
          <div class="ops-meta__row"><dt>Screen id</dt><dd>${esc(s.id)}</dd></div>
          <div class="ops-meta__row"><dt>Route</dt><dd><code>${esc(s.route)}</code></dd></div>
          <div class="ops-meta__row"><dt>File</dt><dd><code>${esc(s.file)}</code></dd></div>
          <div class="ops-meta__row"><dt>Role</dt><dd>${esc(s.role)}</dd></div>
          <div class="ops-meta__row"><dt>Contract</dt><dd>${esc(s.contractStatus)}</dd></div>
          <div class="ops-meta__row"><dt>Design</dt><dd>${esc(s.designStatus)}</dd></div>
          <div class="ops-meta__row"><dt>MEL</dt><dd>${esc(s.melStatus)}</dd></div>
        </dl>
      </div>

      <div class="ops-actions">
        <button type="button" class="ops-btn" data-action="open-screen">Open screen</button>
        <button type="button" class="ops-btn ops-btn--accent" data-action="mark-crooked">Mark as Crooked</button>
        <button type="button" class="ops-btn" data-action="gen-cloud">Cloud Design prompt</button>
        <button type="button" class="ops-btn" data-action="gen-github">GitHub issue</button>
        <button type="button" class="ops-btn" data-action="gen-claude">Claude Code prompt</button>
        <button type="button" class="ops-btn" data-action="gen-audit">Audit recipe</button>
        <button type="button" class="ops-btn ops-btn--ghost" data-action="copy-check">Copy check commands</button>
      </div>
      ${notice}

      <section class="ops-section">
        <div class="ops-section__head">
          <h3 class="ops-section__title">MEL cards</h3>
          <button type="button" class="ops-btn ops-btn--ghost" data-action="new-mel">New MEL…</button>
        </div>
        ${renderMelForm()}
        ${melBlock}
      </section>

      ${output}
    `;
  }

  function setOutput(label, text) {
    state.outputLabel = label;
    state.outputText = text;
    state.notice = '';
    renderDetail();
  }

  function copy(text, okMsg) {
    // Capture the screen the copy began on; only paint the result if the user
    // is still on it when the async clipboard write settles — otherwise the
    // notice would land on whatever screen they switched to mid-write.
    const forScreen = state.selectedId;
    const settle = (msg) => {
      if (state.selectedId !== forScreen) return;
      state.notice = msg;
      renderDetail();
    };
    // Report success only after the write resolves; on an unavailable/denied
    // clipboard, tell the user to copy manually instead of claiming success.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => settle(okMsg))
        .catch(() => settle('Copy failed. Select the text manually.'));
    } else {
      settle('Copy failed. Select the text manually.');
    }
  }

  // Search filters the list in place; the input element persists so focus and
  // caret are preserved across list re-renders.
  searchEl.addEventListener('input', () => {
    state.search = searchEl.value;
    renderList();
  });

  // Status filter is a <select> in the aside; mirror it into filter state and
  // re-render the list. Handled before the MEL-form guard below.
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'ops-filter-status') {
      state.filters.status = t.value;
      renderList();
      return;
    }
    // Keep the open MEL form's field values in state so an unrelated re-render
    // (e.g. generating a prompt) does not discard what the user has typed.
    if (!state.melForm) return;
    if (t.id === 'mel-severity') state.melForm.severity = t.value;
    else if (t.id === 'mel-status') state.melForm.status = t.value;
    else if (t.id === 'mel-reachability') state.melForm.reachability = t.value;
    else if (t.id === 'mel-selector') state.melForm.selector = t.value;
    else if (t.id === 'mel-pr') state.melForm.pr = t.value;
    else if (t.id === 'mel-lifecycle') state.melForm.lifecycleAudited = Array.from(t.selectedOptions).map((o) => o.value);
    else if (t.id === 'mel-problem') state.melForm.problem = t.value;
    else if (t.id === 'mel-decision') state.melForm.operationalDecision = t.value;
    else if (t.id === 'mel-repair') state.melForm.requiredRepair = t.value;
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'select-screen') {
      state.selectedId = btn.dataset.id;
      state.outputText = '';
      state.outputLabel = '';
      state.notice = '';
      state.melForm = null;
      renderList();
      renderDetail();
      return;
    }

    // Role / severity filter chips — screen-independent, so handle before the
    // selected-screen guard below.
    if (action === 'filter-role' || action === 'filter-severity') {
      const group = action === 'filter-role' ? 'role' : 'severity';
      const value = btn.dataset.value;
      state.filters[group] = value;
      renderFilters();
      renderList();
      // renderFilters() rebuilt the chip DOM — restore focus to the same chip
      // so keyboard navigation is not dropped to <body>.
      filtersEl.querySelector(`[data-action="${action}"][data-value="${CSS.escape(value)}"]`)?.focus();
      return;
    }

    const s = getScreen(state.selectedId);
    if (!s) return;

    switch (action) {
      case 'open-screen':
        // BD-OPS-03 — opening a product screen from the dev dashboard must work
        // even from a clean profile. Seed the first-run flag locally (a
        // deliberate dev action) so the target product route isn't bounced to
        // /welcome by the router guard. We intentionally do NOT exempt product
        // routes globally in the router or add them to DEV_DOCS_ROUTES.
        if (!user.get().welcomeSeen) user.set({ welcomeSeen: true });
        go(s.route);
        break;
      case 'mark-crooked': {
        const CROOKED_PROBLEM = 'Crooked screen flagged from ScreenOps.';
        // Dedupe the generic quick-flag: a repeated click should not pile up
        // byte-identical cards (the only feedback is a transient notice).
        const alreadyFlagged = listMelForScreen(s.id)
          .some((c) => c.problem === CROOKED_PROBLEM && c.status === 'DETECTED');
        if (alreadyFlagged) {
          state.notice = 'Already flagged as crooked.';
          renderDetail();
          break;
        }
        const card = createMelCard({
          screenId: s.id,
          route: s.route,
          file: s.file,
          severity: 'MEL-C',
          status: 'DETECTED',
          problem: CROOKED_PROBLEM,
        });
        // createMelCard returns null if persistence failed (quota / private mode).
        state.notice = card ? 'MEL card created.' : 'Could not save the MEL card (storage full?).';
        renderList(); // refresh the registry badges/filters for the new card
        renderDetail();
        break;
      }
      case 'new-mel':
        // Open the editor with the quick-flag defaults as the empty-form state.
        state.melForm = {
          severity: 'MEL-C',
          status: 'DETECTED',
          reachability: 'user-path',
          selector: '',
          pr: '',
          lifecycleAudited: [],
          problem: '',
          operationalDecision: '',
          requiredRepair: '',
        };
        state.notice = '';
        renderDetail();
        break;
      case 'mel-form-cancel':
        state.melForm = null;
        renderDetail();
        break;
      case 'mel-form-save': {
        const read = (sel) => {
          const el = detailEl.querySelector(sel);
          return el ? el.value : '';
        };
        const problem = read('#mel-problem').trim();
        // Require a problem description — saving an untouched form would
        // otherwise persist a blank card and feed empty generated prompts.
        // Keep the form open (values survive via the input mirror) so the
        // developer can fill it in.
        if (!problem) {
          state.notice = 'Add a problem description before saving.';
          renderDetail();
          break;
        }
        const card = createMelCard({
          screenId: s.id,
          route: s.route,
          file: s.file,
          severity: read('#mel-severity'),
          status: read('#mel-status'),
          reachability: read('#mel-reachability'),
          selector: read('#mel-selector').trim(),
          pr: read('#mel-pr').trim(),
          lifecycleAudited: Array.from((detailEl.querySelector('#mel-lifecycle') || {}).selectedOptions || []).map((o) => o.value),
          problem,
          operationalDecision: read('#mel-decision').trim(),
          requiredRepair: read('#mel-repair').trim(),
        });
        state.melForm = null;
        state.notice = card ? 'MEL card created.' : 'Could not save the MEL card (storage full?).';
        renderList(); // refresh the registry badges/filters for the new card
        renderDetail();
        break;
      }
      case 'advance-mel': {
        const id = btn.dataset.melId;
        const card = listMelForScreen(s.id).find((c) => c.id === id);
        if (!card) {
          // Card vanished between render and click (e.g. deleted in another tab).
          state.notice = 'MEL card not found.';
        } else {
          const next = nextMelStatus(card.status);
          if (next === card.status) {
            state.notice = 'MEL is already at the final status.';
          } else {
            const ok = updateMelCard(id, { status: next });
            state.notice = ok ? `MEL advanced → ${next}.` : 'Could not update the MEL card (storage full?).';
          }
        }
        renderList(); // status change can move/clear the row's open-MEL badge
        renderDetail();
        break;
      }
      case 'set-pr': {
        const id = btn.dataset.melId;
        const card = listMelForScreen(s.id).find((c) => c.id === id);
        if (!card) {
          state.notice = 'MEL card not found.';
        } else {
          // The resolving PR/commit is known when the fix SHIPS (advance→DONE),
          // not at creation — so it is editable on a saved card at any time, even
          // one already advanced to DONE. window.prompt mirrors the delete confirm.
          const pr = window.prompt('Resolved by — PR # or commit SHA (blank to clear):', card.pr || '');
          if (pr !== null) {
            const ok = updateMelCard(id, { pr: pr.trim() });
            state.notice = ok
              ? (pr.trim() ? `MEL resolved by ${pr.trim()}.` : 'Cleared the resolution reference.')
              : 'Could not update the MEL card (storage full?).';
          }
        }
        renderList();
        renderDetail();
        break;
      }
      case 'delete-mel': {
        const id = btn.dataset.melId;
        // Destructive — confirm first; only re-render when something changed
        // (a cancelled confirm leaves the panel, and any open form, untouched).
        if (window.confirm('Delete this MEL card? This cannot be undone.')) {
          state.notice = deleteMelCard(id) ? 'MEL card deleted.' : 'MEL card not found.';
          renderList(); // refresh the registry badges/filters after delete
          renderDetail();
        }
        break;
      }
      case 'gen-cloud': {
        const mel = listMelForScreen(s.id).slice(-1)[0] || {};
        setOutput('Cloud Design prompt', buildCloudDesignPrompt(s.id, mel));
        break;
      }
      case 'gen-github': {
        const mel = listMelForScreen(s.id).slice(-1)[0] || {};
        setOutput('GitHub issue body', buildGithubIssue(s.id, mel));
        break;
      }
      case 'gen-claude': {
        const mel = listMelForScreen(s.id).slice(-1)[0] || {};
        setOutput('Claude Code prompt', buildClaudeCodePrompt(s.id, mel));
        break;
      }
      case 'gen-audit':
        // Audit recipe FINDS MELs (no existing mel needed) — vs the repair prompts.
        setOutput('Audit recipe', buildAuditRecipe(s.id));
        break;
      case 'copy-check':
        copy(buildCheckCommands(s.id), 'Check commands copied.');
        break;
      case 'copy-output':
        copy(state.outputText, 'Copied.');
        break;
      default:
        break;
    }
  });

  renderFilters();
  renderList();
  renderDetail();
  return root;
}
