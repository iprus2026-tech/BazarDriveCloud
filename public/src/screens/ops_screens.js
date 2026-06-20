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
  createMelCard,
  updateMelCard,
  deleteMelCard,
  nextMelStatus,
  MEL_SEVERITIES,
  MEL_STATUSES,
} from '../ops/ops_mel_store.js';
import { renderMelCard } from '../ops/templates/screen_mel_card_template.js';
import { buildCloudDesignPrompt } from '../ops/connectors/cloud_design_connector.js';
import { buildGithubIssue } from '../ops/connectors/github_issue_connector.js';
import { buildClaudeCodePrompt } from '../ops/connectors/claude_code_connector.js';
import { buildCheckCommands } from '../ops/connectors/checks_connector.js';

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
        <ul id="ops-list" class="ops-reg" role="listbox" aria-label="Screen registry"></ul>
      </aside>
      <main id="ops-detail" class="ops-detail" aria-live="polite"></main>
    </div>
  `;

  const listEl = root.querySelector('#ops-list');
  const detailEl = root.querySelector('#ops-detail');
  const searchEl = root.querySelector('#ops-search');

  function statusPill(value, kind) {
    return `<span class="ops-pill ops-pill--${esc(kind)}">${esc(value)}</span>`;
  }

  function renderList() {
    const term = state.search.trim().toLowerCase();
    const rows = screens.filter((s) => {
      if (!term) return true;
      return (
        s.id.toLowerCase().includes(term) ||
        (s.title || '').toLowerCase().includes(term) ||
        (s.route || '').toLowerCase().includes(term)
      );
    });
    if (!rows.length) {
      listEl.innerHTML = `<li class="ops-reg__empty">No screens match “${esc(state.search)}”.</li>`;
      return;
    }
    listEl.innerHTML = rows
      .map((s) => {
        const active = s.id === state.selectedId ? ' ops-reg__item--active' : '';
        return `
          <li>
            <button type="button" class="ops-reg__item${active}" data-action="select-screen" data-id="${esc(s.id)}">
              <span class="ops-reg__id">${esc(s.id)}</span>
              <span class="ops-reg__title">${esc(s.title)}</span>
              <span class="ops-reg__route">${esc(s.route)}</span>
              ${statusPill(s.implementationStatus, s.implementationStatus)}
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

  // Keep the open MEL form's field values in state so an unrelated re-render
  // (e.g. generating a prompt) does not discard what the user has typed.
  root.addEventListener('input', (e) => {
    if (!state.melForm) return;
    const t = e.target;
    if (t.id === 'mel-severity') state.melForm.severity = t.value;
    else if (t.id === 'mel-status') state.melForm.status = t.value;
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
        renderDetail();
        break;
      }
      case 'new-mel':
        // Open the editor with the quick-flag defaults as the empty-form state.
        state.melForm = {
          severity: 'MEL-C',
          status: 'DETECTED',
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
          problem,
          operationalDecision: read('#mel-decision').trim(),
          requiredRepair: read('#mel-repair').trim(),
        });
        state.melForm = null;
        state.notice = card ? 'MEL card created.' : 'Could not save the MEL card (storage full?).';
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
        renderDetail();
        break;
      }
      case 'delete-mel': {
        const id = btn.dataset.melId;
        // Destructive — confirm first; only re-render when something changed
        // (a cancelled confirm leaves the panel, and any open form, untouched).
        if (window.confirm('Delete this MEL card? This cannot be undone.')) {
          state.notice = deleteMelCard(id) ? 'MEL card deleted.' : 'MEL card not found.';
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

  renderList();
  renderDetail();
  return root;
}
