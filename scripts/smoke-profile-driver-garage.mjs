// BD-PROFILE-D-05A/B/C/D/F — Driver Garage smoke.
//
// The Garage section is a driver-only profile surface. It derives its
// view from the legacy fields on the user record (vehicleMake /
// vehicleModel / vehicleColor / vehiclePlate; state.js:50-54) without
// a data migration. This smoke pins the surface contract across four
// slices:
//
//   05A — Render: driver profile with/without a vehicle, render-gate
//         preview (`?garage=empty`), passenger profile hides the section.
//   05B — Action contract: stable `data-garage-action` /
//         `data-garage-state` hooks, archive 2-step confirm, and the
//         load-bearing "no mutation on click" guarantee across every
//         action handler (localStorage snapshot byte-equality).
//   05C — Collection: `buildGarageVehicles(u, options)` returns
//         `[{ id, model, color, plate, status, source }]`; per-vehicle
//         DOM ids (`*-${vehicle.id}`); `?garage=multi` adds a single
//         demo vehicle for preview without touching storage; multi-state
//         no-mutation guarantee across every NON-make-active handler.
//   05D — Active vehicle selection persistence: the "Сделать активной"
//         button now writes `profile.driverGarage.activeVehicleId` via
//         user.set (single allowed writer in wireGarageActions);
//         resolver `resolveActiveGarageVehicleId` falls back to the
//         legacy/first vehicle when the persisted id is missing or
//         stale; click → persist → re-render swaps the active badge;
//         make-active touches ONLY `bazardrive.user.v1` (no responses,
//         active_ride, ride_history, driver_receipts, respond key drift).
//   05F — Persisted garage collection: `profile.driverGarage.vehicles`
//         drives the builder when it holds a usable non-empty array
//         (after per-entry normalisation); legacy `vehicleMake/Model/
//         Color/Plate` becomes the fallback path. The render is strictly
//         read-only against the persisted collection — no auto-init,
//         no legacy-seed write, no rewrite on make-active. `?garage=multi`
//         stays preview-only and overlays the demo card on whatever
//         real source exists, without persisting.
//
// Mirrors the DOM-stub strategy used by smoke-profile-pane-alias.mjs and
// smoke-profile-role-isolation.mjs: a permissive stub whose querySelector
// never returns null, so profile() runs to completion and we can inspect
// the resulting section's innerHTML for surface markers. `wireGarageActions`
// iterates the vehicles list (not the DOM) so the stub captures every
// per-vehicle handler deterministically.

// ── localStorage stub ────────────────────────────────────────────────────────
const local = new Map();
globalThis.localStorage = {
  getItem: (k) => (local.has(k) ? local.get(k) : null),
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: (k) => local.delete(k),
  clear: () => local.clear(),
};

// ── sessionStorage stub (smoke_role.js per-tab override lives here) ──────────
const session = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (session.has(k) ? session.get(k) : null),
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: (k) => session.delete(k),
  clear: () => session.clear(),
};

// ── Minimal DOM stub (records click handlers by selector for BD-PROFILE-D-05B)
// The 05A surface only needed `innerHTML` to be readable. BD-PROFILE-D-05B
// adds a "no-mutation" guarantee on the action handlers, so the stub now
// captures every `addEventListener('click', fn)` keyed by the selector that
// produced the element. The smoke can then look up a handler by id and
// invoke it directly, then assert localStorage / active-ride snapshots are
// byte-equal. Pattern mirrors smoke-profile-role-isolation.mjs.
//
// BD-PROFILE-D-05G — querySelector now memoises results by selector so
// a smoke scenario can:
//   1) capture an input element via `section.querySelector('#x')`,
//   2) set `.value` / `.checked` on it, and
//   3) trigger a handler that re-queries the same selector and reads
//      the value back.
// In production each querySelector call hits the real DOM and returns
// the same node; the stub now mirrors that semantics within a single
// element so the add-sheet draft fields behave deterministically.
//
// BD-PROFILE-GARAGE-SMOKE-SURFACE-CLICK-S — click capture is now
// SURFACE-AWARE for a narrow set of known simple garage selectors
// (the SURFACE_AWARE_SELECTORS set below). For those selectors, the
// stub stores a handler in `clickHandlers` ONLY when the rendered HTML
// actually carries `id="…"` for that selector — so S14/S15 cannot
// silently capture a ghost handler for a button that the runtime no
// longer renders. Every OTHER selector (dynamic, CSS-escaped, class /
// attribute / composite) stays permissive — those scenarios depend on
// per-vehicle ids that the runtime escapes via `escapeCssId` and the
// substring lookup would not survive escaping, so we don't enforce
// surface-awareness there. Smallest safe change.
const clickHandlers = new Map();
let renderedHtml = '';

// BD-PROFILE-GARAGE-READY-K Codex P2-2 — in-place refresh trackers.
// Both `refreshGarageSection` and the new `refreshGarageReadinessHint`
// build their replacement markup in a `document.createElement('div')`
// temp, then call `oldSection.replaceWith(newSection)`. The DOM stub
// no-ops `replaceWith`, so we can't observe the swap directly; we
// instead record:
//   - every innerHTML assignment on a temp element (selectorless
//     `document.createElement` result), and
//   - every replaceWith call on a selector-bearing element.
// A scenario can then fish out which temp HTML was paired with which
// replaceWith target — sufficient to assert that the READY-K hint was
// refreshed in place with content matching the new readiness state.
// These trackers persist across `resetRenderedSurface` calls (which is
// invoked twice per refresh — once for the garage section temp and
// once for the readiness hint temp). Scenarios manage them explicitly
// by snapshotting the array lengths before triggering and slicing
// after.
const replaceWithLog = [];
const tempInnerHtmlLog = [];

function resetRenderedSurface() {
  renderedHtml = '';
  clickHandlers.clear();
}

// Codex P2 review on PR #490 — the surface-aware set covers the fixed
// add-sheet AND edit-sheet controls plus a couple of well-known
// per-vehicle anchors. Dynamic per-vehicle ids that match
// isSimpleGarageActionSelector below are gated separately, while
// CSS-escaped / complex selectors remain permissive.
const SURFACE_AWARE_SELECTORS = new Set([
  '#pf2-garage-add',
  '#pf2-garage-edit-legacy-1',
  '#pf2-garage-archive-legacy-1',
  '#pf2-garage-archive-cancel-legacy-1',
  '#pf2-garage-archive-confirm-legacy-1',
  '#pf2-garage-make-active-demo-2',
  '#pf2-garage-add-sheet',
  '#pf2-garage-add-close',
  '#pf2-garage-add-backdrop',
  '#pf2-garage-add-cancel',
  '#pf2-garage-add-save',
  // Edit-sheet fixed controls — Codex P2 (Include the edit-sheet hooks
  // in the surface gate). S57–S59 invoke these directly.
  '#pf2-garage-edit-cancel',
  '#pf2-garage-edit-close',
  '#pf2-garage-edit-backdrop',
  '#pf2-garage-edit-save',
]);

// Codex P2 (Cover simple per-vehicle handlers) — simple generated
// per-vehicle selectors with safe alphanumeric suffixes are also
// surface-gated. The character class `[A-Za-z0-9-]+` deliberately
// EXCLUDES backslashes, colons, dots, brackets, quotes, spaces, etc.,
// so CSS-escaped weird-id scenarios (S109 / S116 / S119) stay
// permissive and continue to pass.
function isSimpleGarageActionSelector(selector) {
  return /^#pf2-garage-(?:make-active|edit|archive|archive-cancel|archive-confirm|restore|restore-cancel|restore-confirm)-[A-Za-z0-9-]+$/
    .test(selector);
}

function selectorIsRendered(selector) {
  if (typeof selector !== 'string' || !selector.startsWith('#')) return true;
  // Substring lookup of `id="…"` — the runtime emits these buttons as
  // `<button id="X" …>`, so a literal `id="X"` in the assigned HTML
  // proves the element exists. Only applied to ids in the narrow
  // surface-aware set; dynamic / escaped ids fall through to permissive.
  const id = selector.slice(1);
  return renderedHtml.includes(`id="${id}"`);
}

function makeEl(selectorHint) {
  const el = {
    _html: '',
    _selector: selectorHint || null,
    _cache: null,
    className: '', textContent: '', value: '', checked: false,
    hidden: false, disabled: false,
    dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    style: {},
    set innerHTML(v) {
      const html = String(v);
      // Codex P2 review on PR #490 — when an innerHTML assignment is
      // the new garage surface (full render OR in-place
      // refreshGarageSection call), reset the tracker + click-handler
      // map BEFORE accumulating. Without this, an in-place refresh
      // appends the new markup to the old surface and old click
      // handlers stay reachable via clickHandlers.get(...), letting
      // stale CTAs satisfy later assertions. The detection looks at
      // the assigned HTML shape — `id="pf2-garage"` (the canonical
      // garage section id), the `pf2-garage` word-boundary class
      // family, and the `data-garage-collection-size=` data attribute
      // are all signals that this assignment IS the garage surface.
      // renderProfile() / captureSection() already reset before the
      // top-level render, so during a full render the first garage-
      // shaped assignment is a no-op; the load-bearing case is the
      // in-place refresh path.
      const isGarageSurface =
        html.includes('id="pf2-garage"')
        || /\bpf2-garage\b/.test(html)
        || html.includes('data-garage-collection-size=');
      if (isGarageSurface) resetRenderedSurface();
      this._html = html;
      renderedHtml += this._html;
      // READY-K Codex P2-2 — a selectorless element is a
      // `document.createElement('div')` temp (the refresh paths build
      // their replacement markup on one). Log the assigned HTML so a
      // later `replaceWith` entry can be correlated to the new content.
      if (this._selector === null) tempInnerHtmlLog.push(html);
    },
    get innerHTML() { return this._html; },
    get firstElementChild() { return makeEl(); },
    addEventListener(type, fn) {
      if (type === 'click' && this._selector && typeof fn === 'function') {
        const sel = this._selector;
        // Surface gate fires for:
        //   1) the explicit fixed-control whitelist (SURFACE_AWARE_SELECTORS), AND
        //   2) simple per-vehicle action selectors with safe suffixes
        //      (isSimpleGarageActionSelector).
        // Everything else (dynamic / CSS-escaped / complex selectors)
        // is captured as before so CSS-escaped per-vehicle wiring used
        // by S109 / S116 / S119 / S121 is not perturbed.
        const mustBeRendered =
          SURFACE_AWARE_SELECTORS.has(sel) || isSimpleGarageActionSelector(sel);
        if (mustBeRendered && !selectorIsRendered(sel)) return;
        clickHandlers.set(sel, fn);
      }
    },
    removeEventListener() {},
    querySelector(sel) {
      if (!this._cache) this._cache = new Map();
      if (!this._cache.has(sel)) this._cache.set(sel, makeEl(sel));
      return this._cache.get(sel);
    },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    appendChild(x) { return x; }, removeChild() {},
    // READY-K Codex P2-2 — capture the replaceWith target selector and
    // the HTML the temp it was paired with carried. The runtime pattern
    // is: build `tmp = document.createElement('div')` → assign
    // `tmp.innerHTML = …` (logged into tempInnerHtmlLog) → call
    // `oldSection.replaceWith(tmp.firstElementChild)`. Pairing the
    // replaceWith with the most recent temp innerHTML is reliable for
    // the refresh paths because the two operations are adjacent.
    replaceWith() {
      if (this._selector) {
        replaceWithLog.push({
          targetSelector: this._selector,
          newHtml: tempInnerHtmlLog.length
            ? tempInnerHtmlLog[tempInnerHtmlLog.length - 1]
            : '',
        });
      }
    },
    remove() {},
    setAttribute() {}, getAttribute() { return null; },
    scrollIntoView() {}, focus() {}, blur() {},
    click() {},
  };
  return el;
}

let currentHash = '';
const locationStub = {};
Object.defineProperty(locationStub, 'hash', {
  configurable: true,
  get: () => currentHash,
  set: (v) => {
    currentHash = typeof v === 'string' && v.startsWith('#') ? v : '#' + String(v);
  },
});
globalThis.window   = { location: locationStub, addEventListener() {}, removeEventListener() {} };
globalThis.location = locationStub;
globalThis.document = {
  createElement: () => makeEl(),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => makeEl(),
};

// ── Imports (after stubs) ────────────────────────────────────────────────────
const { user } = await import('../public/src/state.js');
const profile  = (await import('../public/src/screens/profile.js')).default;

// ── Test helpers ─────────────────────────────────────────────────────────────
const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function reset() {
  local.clear();
  session.clear();
  user.reset();
  currentHash = '';
  resetRenderedSurface();
}

// Serialize the localStorage Map's contents into a deterministic string so
// "did anything change after a click?" becomes a byte-equality check. Keys
// are sorted alphabetically so write order does not perturb the snapshot.
function snapshotLocalStorage() {
  const entries = [];
  for (const [k, v] of local.entries()) entries.push([k, String(v)]);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

function renderProfile(hash) {
  currentHash = hash || '#/profile';
  // BD-PROFILE-GARAGE-SMOKE-SURFACE-CLICK-S — clear BOTH the rendered-HTML
  // tracker AND the click-handler map before each full render. The
  // refresh-aware `set innerHTML` below clears them again whenever an
  // in-place garage refresh writes new garage markup; these two entry
  // points cover full-render scenarios so the surface tracker always
  // starts clean per render.
  resetRenderedSurface();
  const section = profile();
  return section._html || '';
}

// Extract just the `<section ... pf2-garage ...>…</section>` slice so card
// assertions can't false-positive on, say, the driver hero, which also
// renders the persisted "Hyundai Solaris · А 482 МР 77" line for the same
// user. Returns '' when the garage isn't in the markup (passenger view).
function garageSlice(html) {
  const m = html.match(/<section\b[^>]*\bpf2-garage\b[\s\S]*?<\/section>/);
  return m ? m[0] : '';
}

const GARAGE_ID_MARKER       = 'id="pf2-garage"';
const GARAGE_EMPTY_MARKER    = 'pf2-garage--empty';
const EMPTY_STATE_TEXT       = 'Авто не добавлено';
const ADD_BUTTON_ID          = 'id="pf2-garage-add"';
const EDIT_ACTION_DATA       = 'data-garage-action="edit"';
const ARCHIVE_ACTION_DATA    = 'data-garage-action="archive"';
const ACTIVE_BADGE_TEXT      = 'Активное';

// ── Scenario 1 — Driver profile WITH a vehicle → populated garage card ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S1: driver profile renders the garage section',
    slice.length > 0);
  expect('S1: garage shows "Hyundai Solaris" derived from legacy fields',
    slice.includes('Hyundai Solaris'));
  expect('S1: garage shows vehicle color from profile',
    slice.includes('белый'));
  expect('S1: garage shows the plate from profile',
    slice.includes('А 482 МР 77'));
  expect('S1: garage shows the active badge',
    slice.includes(ACTIVE_BADGE_TEXT));
  expect('S1: garage is NOT in the empty state',
    !slice.includes(GARAGE_EMPTY_MARKER));
  expect('S1: garage does NOT show the empty placeholder text',
    !slice.includes(EMPTY_STATE_TEXT));
  expect('S1: garage exposes inline mock actions (edit / archive)',
    slice.includes(EDIT_ACTION_DATA) && slice.includes(ARCHIVE_ACTION_DATA));
  // Belt-and-braces: the "+ Добавить" header CTA is always present so the
  // driver can add another vehicle from the populated state.
  expect('S1: garage exposes the "+ Добавить" header CTA',
    slice.includes(ADD_BUTTON_ID));
}

// ── Scenario 2 — Driver profile WITHOUT a vehicle → empty-state card ───────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally no vehicleMake / vehicleModel / vehicleColor / vehiclePlate
});
{
  const html = renderProfile('#/profile');
  expect('S2: driver profile with no vehicle still renders the garage section',
    html.includes(GARAGE_ID_MARKER));
  expect('S2: garage falls back to the empty-state modifier class',
    html.includes(GARAGE_EMPTY_MARKER));
  expect('S2: garage shows the "Авто не добавлено" placeholder',
    html.includes(EMPTY_STATE_TEXT));
  expect('S2: empty garage exposes the "Добавить авто" CTA',
    html.includes(ADD_BUTTON_ID) && html.includes('Добавить авто'));
  // Negative: no demo car name leaks into the empty card.
  expect('S2: empty garage does NOT show any car make / model literal',
    !html.includes('Hyundai') && !html.includes('Solaris'));
}

// ── Scenario 3 — Render-gate preview `?garage=empty` forces the empty state
// even when the profile has a real vehicle (so designers can preview the
// empty card without wiping their persisted data). ──────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile?role=driver&garage=empty');
  const slice = garageSlice(html);
  expect('S3: garage slice still rendered under ?garage=empty preview',
    slice.length > 0);
  expect('S3: ?garage=empty forces the empty-state class on the card',
    slice.includes(GARAGE_EMPTY_MARKER));
  expect('S3: ?garage=empty shows the "Авто не добавлено" placeholder',
    slice.includes(EMPTY_STATE_TEXT));
  // Scope the negative check to the garage slice: other surfaces in the
  // driver profile (driver hero, readiness checklist) legitimately echo
  // the persisted vehicle line and must NOT trigger a false positive.
  expect('S3: ?garage=empty does NOT render the populated car model in the slice',
    !slice.includes('Hyundai Solaris'));
  expect('S3: ?garage=empty does NOT render the persisted plate in the slice',
    !slice.includes('А 482 МР 77'));
  // The persisted vehicle MUST still be intact — preview never wipes data.
  expect('S3: ?garage=empty did NOT mutate persisted vehicleMake',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S3: ?garage=empty did NOT mutate persisted vehiclePlate',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));
}

// ── Scenario 4 — Passenger profile does NOT render the garage ──────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
});
{
  const html = renderProfile('#/profile');
  expect('S4: passenger profile does NOT include the garage section',
    !html.includes(GARAGE_ID_MARKER));
  expect('S4: passenger profile does NOT show the "Авто не добавлено" placeholder',
    !html.includes(EMPTY_STATE_TEXT));
  expect('S4: passenger profile does NOT expose the garage add button',
    !html.includes(ADD_BUTTON_ID));
}

// ── Scenario 5 — Render-gate ?role=passenger on a persisted driver hides
// the garage too (the view, not just the persisted role, decides). ──────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile?role=passenger');
  expect('S5: ?role=passenger preview hides the garage even on a driver record',
    !html.includes(GARAGE_ID_MARKER));
}

// ── Scenario 6 — Render-gate ?role=driver on a persisted passenger shows
// the garage (preview overrides view, persisted role unchanged). ────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
});
{
  const html = renderProfile('#/profile?role=driver');
  expect('S6: ?role=driver preview shows the garage on a persisted passenger',
    html.includes(GARAGE_ID_MARKER));
  expect('S6: ?role=driver preview surfaces the persisted Hyundai Solaris',
    html.includes('Hyundai Solaris'));
}

// ── Scenario 7 — Plate-only profile falls back to empty state (Codex P2) ────
// Onboarding records `vehiclePlate` on its own step, so a partially-filled
// profile can carry a plate (or color) before any make/model is entered.
// The active garage card requires a usable model line — plate-only and
// color-only profiles must slip to the empty state so the "Добавить авто"
// CTA prompts the driver to finish data entry instead of showing a
// stranded "Активное" badge on an empty model line.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally only plate — no make, no model, no color
  vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S7: plate-only profile still renders the garage section',
    slice.length > 0);
  expect('S7: plate-only garage falls back to the empty-state class',
    slice.includes(GARAGE_EMPTY_MARKER));
  expect('S7: plate-only garage shows the "Авто не добавлено" placeholder',
    slice.includes(EMPTY_STATE_TEXT));
  expect('S7: plate-only garage does NOT show the "Активное" badge',
    !slice.includes(ACTIVE_BADGE_TEXT));
  expect('S7: plate-only garage does NOT render the populated `pf2-garage__car` article',
    !slice.includes('pf2-garage__car'));
  expect('S7: plate-only garage does NOT echo the stranded plate inside the empty card',
    !slice.includes('А 482 МР 77'));
  expect('S7: persisted vehiclePlate is preserved (preview never wipes data)',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));
}

// ── Scenario 8 — Color-only profile also falls back to empty state ──────────
// Same contract — any single non-model field is not enough to justify
// rendering the populated card.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally only color
  vehicleColor: 'белый',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S8: color-only profile falls back to the empty-state class',
    slice.includes(GARAGE_EMPTY_MARKER));
  expect('S8: color-only garage does NOT show the "Активное" badge',
    !slice.includes(ACTIVE_BADGE_TEXT));
  expect('S8: color-only garage does NOT render the populated `pf2-garage__car` article',
    !slice.includes('pf2-garage__car'));
}

// ── Scenario 9 — Make-only OR model-only profile renders the active card ────
// A single half of the model line is still informative ("Hyundai" or
// "Solaris" alone) so we keep the populated state. This guards against
// the fix over-tightening into "needs BOTH make and model".
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S9: make-only profile renders the populated garage card',
    !slice.includes(GARAGE_EMPTY_MARKER));
  expect('S9: make-only garage shows "Hyundai" as the model line',
    slice.includes('Hyundai'));
  expect('S9: make-only garage shows the "Активное" badge',
    slice.includes(ACTIVE_BADGE_TEXT));
}
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleModel: 'Solaris',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S9: model-only profile renders the populated garage card',
    !slice.includes(GARAGE_EMPTY_MARKER));
  expect('S9: model-only garage shows "Solaris" as the model line',
    slice.includes('Solaris'));
}

// ── Scenario 10 — BD-PROFILE-D-05B action contract hooks present ─────────────
// Each action carries a stable (action, state) pair so future CRUD slices
// and the smoke can grow without renaming selectors.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  // The four action-state pairs from the BD-PROFILE-D-05B contract:
  const STATES = [
    { action: 'add',     state: 'add-ready' },
    { action: 'edit',    state: 'edit-ready' },
    { action: 'active',  state: 'active-current' },
    { action: 'archive', state: 'archive-confirm-local' },
  ];
  for (const { action, state } of STATES) {
    expect(`S10: garage exposes data-garage-action="${action}"`,
      slice.includes(`data-garage-action="${action}"`));
    expect(`S10: garage exposes data-garage-state="${state}"`,
      slice.includes(`data-garage-state="${state}"`));
  }
}

// ── Scenario 11 — BD-PROFILE-D-05B stable user-facing labels ────────────────
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S11: "Добавить авто" label present (add-ready)',
    slice.includes('Добавить авто'));
  expect('S11: "Редактировать" label present (edit-ready)',
    slice.includes('Редактировать'));
  expect('S11: "Активна сейчас" label present (active-current)',
    slice.includes('Активна сейчас'));
  expect('S11: "Архивировать" label present (archive-confirm-local)',
    slice.includes('Архивировать'));
  // The contract retired the throwaway "Скоро здесь" / "Уже активное"
  // labels from 05A — they would surface stale copy on real renders.
  expect('S11: stale "Скоро здесь" label is gone from the markup',
    !slice.includes('Скоро здесь'));
  expect('S11: stale "Уже активное" label is gone from the markup',
    !slice.includes('Уже активное'));
  expect('S11: stale "Сделать активным" button label is gone (now status pill)',
    !slice.includes('Сделать активным'));
}

// ── Scenario 12 — "active-current" is a non-button status pill ──────────────
// 05B turned the activate control from a button into a disabled status
// pill. The smoke pins this: the markup uses an <span> (not <button>) with
// aria-disabled="true", and no click handler is captured for the active
// element id.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  // The active control is a <span>, not a <button>, so it has no
  // click semantics by default.
  expect('S12: active-current is rendered as a <span>, not a <button>',
    /<span\b[^>]*data-garage-action="active"/.test(slice));
  expect('S12: active-current carries aria-disabled="true"',
    /data-garage-action="active"[^>]*aria-disabled="true"|aria-disabled="true"[^>]*data-garage-action="active"/.test(slice));
  // wireGarageActions deliberately does NOT attach a click handler to
  // #pf2-garage-active-${id} — capture confirms that. 05C suffixes the
  // id with the vehicle's id (`legacy-1` for the derived legacy vehicle).
  expect('S12: no click handler captured for #pf2-garage-active-legacy-1',
    !clickHandlers.has('#pf2-garage-active-legacy-1'));
}

// ── Scenario 13 — Archive confirm row is rendered hidden, with stable hooks ─
// 05C suffixes per-vehicle confirm-row ids with the vehicle's id; for the
// single derived legacy vehicle that's `legacy-1`.
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S13: confirm row #pf2-garage-confirm-legacy-1 rendered in markup',
    slice.includes('id="pf2-garage-confirm-legacy-1"'));
  expect('S13: confirm row carries data-garage-confirm="archive"',
    slice.includes('data-garage-confirm="archive"'));
  expect('S13: confirm row starts in data-garage-confirm-state="idle"',
    slice.includes('data-garage-confirm-state="idle"'));
  expect('S13: confirm row is hidden by default (no flash of confirm UI)',
    /id="pf2-garage-confirm-legacy-1"[^>]*\bhidden\b/.test(slice));
  // 05I — confirm copy now matches the archive brief: a separate title
  // ("Архивировать авто?"), helper text explaining the soft-delete
  // semantics, and a primary action labelled "Архивировать".
  expect('S13: confirm row exposes "Архивировать авто?" title (05I)',
    slice.includes('Архивировать авто?'));
  expect('S13: confirm row exposes the soft-delete helper text (05I)',
    slice.includes('Авто останется в гараже'));
  expect('S13: confirm row has cancel button id #pf2-garage-archive-cancel-legacy-1',
    slice.includes('id="pf2-garage-archive-cancel-legacy-1"'));
  expect('S13: confirm row has final button id #pf2-garage-archive-confirm-legacy-1',
    slice.includes('id="pf2-garage-archive-confirm-legacy-1"'));
  expect('S13: cancel button labelled "Отмена"',
    slice.includes('>Отмена<'));
  expect('S13: final confirm button labelled "Архивировать" (05I)',
    slice.includes('>Архивировать<'));
}

// ── Scenario 14 — Invoking every action handler does NOT mutate storage ────
// This is the load-bearing guarantee: 05C is still the contract+collection
// slice, not the CRUD slice. We snapshot localStorage immediately after
// render, run every click handler that wireGarageActions captures, then
// re-snapshot. Equal strings == zero writes.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile');
  // Surface pins before the click capture so a missing button fails with
  // a clear "id not rendered" signal instead of an opaque "captured null".
  expect('S14 surface: populated garage renders #pf2-garage-add',
    renderedHtml.includes('id="pf2-garage-add"'));
  expect('S14 surface: populated garage renders #pf2-garage-edit-legacy-1',
    renderedHtml.includes('id="pf2-garage-edit-legacy-1"'));
  expect('S14 surface: populated garage renders #pf2-garage-archive-legacy-1',
    renderedHtml.includes('id="pf2-garage-archive-legacy-1"'));
  expect('S14 surface: populated garage renders #pf2-garage-archive-cancel-legacy-1',
    renderedHtml.includes('id="pf2-garage-archive-cancel-legacy-1"'));
  const before = snapshotLocalStorage();
  // 05I — `#pf2-garage-archive-confirm-*` is no longer a DOM-only flash;
  // it is the archive write path and is intentionally EXCLUDED from the
  // byte-equality triggers below (its writes are covered by S79/S87+).
  const triggers = [
    '#pf2-garage-add',
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
  ];
  for (const sel of triggers) {
    const fn = clickHandlers.get(sel);
    expect(`S14 pre: captured click handler for ${sel}`,
      typeof fn === 'function');
    try { fn(); } catch (e) {
      expect(`S14: handler for ${sel} did not throw`, false, e.message || String(e));
    }
    const after = snapshotLocalStorage();
    expect(`S14: localStorage snapshot byte-equal after invoking ${sel}`,
      before === after, `before=${before.length}b after=${after.length}b`);
  }
  // Also drop a parallel guard on the active-ride key specifically: a
  // future regression that wrote into bazardrive.active_ride.v1 would
  // be caught even if other unrelated keys happened to drift.
  expect('S14: bazardrive.active_ride.v1 was never written',
    !local.has('bazardrive.active_ride.v1'),
    String(local.get('bazardrive.active_ride.v1')));
  expect('S14: bazardrive.user.v1.vehicleMake preserved byte-for-byte',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S14: bazardrive.user.v1.vehiclePlate preserved byte-for-byte',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));
}

// ── Scenario 15 — Empty-state add button is captured AND inert too ─────────
// The same no-mutation guarantee must hold on the empty-state CTA — that's
// where the future onboarding-add flow will hook in, but until it does the
// handler stays DOM-only.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally no vehicle — empty-state path
});
{
  renderProfile('#/profile');
  // Surface pin: the empty-state add CTA must be in the rendered markup
  // before the captured-handler assertion is meaningful.
  expect('S15 surface: empty garage renders #pf2-garage-add',
    renderedHtml.includes('id="pf2-garage-add"'));
  const beforeEmpty = snapshotLocalStorage();
  const addHandler = clickHandlers.get('#pf2-garage-add');
  expect('S15: empty-state add button has a captured handler',
    typeof addHandler === 'function');
  try { addHandler && addHandler(); } catch (e) {
    expect('S15: empty add handler did not throw', false, e.message || String(e));
  }
  const afterEmpty = snapshotLocalStorage();
  expect('S15: localStorage byte-equal after empty-state add click',
    beforeEmpty === afterEmpty);
}

// ── Scenario 16 — Static source guards on garage helpers ────────────────────
// Belt-and-braces against future refactors that introduce CRUD or
// cross-surface writes inside the garage helpers without updating the
// contract / docs.
//
// 05D split: `wireGarageActions` is allowed to call `user.set` and
// reference `activeVehicleId` — but ONLY to patch the `driverGarage`
// namespace. The derive helpers (resolver / builder / card / section)
// must stay pure. None of them — wire or derive — may touch
// responses / active-ride / ride-history / receipts / respond stores.
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc  = readFileSync(join(projectRoot, 'public/src/screens/profile.js'), 'utf8');
  // 05E — resolver + builder live in public/src/garage.js so respond.js
  // and ride_actions.js can share them without depending on a UI module.
  const garageSrc   = readFileSync(join(projectRoot, 'public/src/garage.js'), 'utf8');

  // Precise function-body extraction: from `marker` (the declaration
  // line) through the function's OWN closing brace (a bare `\n}\n`).
  // This avoids sweeping the next function's header comment into the
  // body, which would leak forbidden tokens that legitimately live in
  // the *next* function's doc block.
  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };

  const resolveBody = sliceFn(garageSrc, 'export function resolveActiveGarageVehicleId(');
  expect('S16: resolveActiveGarageVehicleId function body extracted (from garage.js)',
    resolveBody.length > 0, String(resolveBody.length));

  const buildBody = sliceFn(garageSrc, 'export function buildGarageVehicles(');
  expect('S16: buildGarageVehicles function body extracted (from garage.js)',
    buildBody.length > 0, String(buildBody.length));

  const convBody = sliceFn(garageSrc, 'export function resolveActiveGarageVehicle(');
  expect('S16: resolveActiveGarageVehicle function body extracted (from garage.js)',
    convBody.length > 0, String(convBody.length));

  const wireBody = sliceFn(profileSrc, 'function wireGarageActions(');
  expect('S16: wireGarageActions function body extracted (from profile.js)',
    wireBody.length > 0, String(wireBody.length));

  const refreshBody = sliceFn(profileSrc, 'function refreshGarageSection(');
  expect('S16: refreshGarageSection function body extracted (from profile.js)',
    refreshBody.length > 0, String(refreshBody.length));

  // Universally forbidden cross-surface writes (every garage helper,
  // including wireGarageActions, must avoid these).
  const FORBIDDEN_ALL = [
    { name: 'user.reset', regex: /\buser\.reset\s*\(/ },
    { name: 'localStorage.setItem', regex: /\blocalStorage\.setItem\s*\(/ },
    { name: 'sessionStorage.setItem', regex: /\bsessionStorage\.setItem\s*\(/ },
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'updateActiveRideStatus', regex: /\bupdateActiveRideStatus\s*\(/ },
    { name: 'updateTripStatus', regex: /\bupdateTripStatus\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: 'saveActiveVehicle', regex: /\bsaveActiveVehicle\s*\(/ },
    { name: 'selectedVehicleId', regex: /\bselectedVehicleId\b/ },
    { name: 'go(', regex: /\bgo\s*\(/ },  // no router navigation from garage helpers
    // Cross-surface storage keys — must never appear as string literals
    // anywhere in the garage helpers.
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];

  // Forbidden in derive helpers (resolver + builder) and refreshGarageSection
  // — these must not call user.set or reference activeVehicleId as a
  // mutation target. The resolver READS profile.driverGarage.activeVehicleId
  // (legitimate), so it is exempt from the activeVehicleId guard.
  const FORBIDDEN_DERIVE_ONLY = [
    { name: 'user.set', regex: /\buser\.set\s*\(/ },
  ];

  const checkBody = (label, body, extra = []) => {
    for (const { name, regex } of FORBIDDEN_ALL) {
      expect(`S16: ${label} does NOT call/reference ${name}`,
        !regex.test(body));
    }
    for (const { name, regex } of extra) {
      expect(`S16: ${label} does NOT call/reference ${name}`,
        !regex.test(body));
    }
  };

  checkBody('resolveActiveGarageVehicleId', resolveBody, FORBIDDEN_DERIVE_ONLY);
  // Resolver is allowed to reference activeVehicleId (it reads it).
  // Builder must NOT use the literal token (it only consumes the resolver
  // result via the `activeId` local).
  checkBody('buildGarageVehicles', buildBody, [
    ...FORBIDDEN_DERIVE_ONLY,
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
  ]);
  // 05E — resolveActiveGarageVehicle is the convenience consumed by
  // respond.js and ride_actions.js. Strictly read-only; no writes, no
  // activeVehicleId mutation (it only forwards what the resolver returns).
  checkBody('resolveActiveGarageVehicle', convBody, [
    ...FORBIDDEN_DERIVE_ONLY,
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
  ]);
  // wireGarageActions is the single allowed writer — user.set + activeVehicleId
  // are intentionally NOT in its forbidden list.
  checkBody('wireGarageActions', wireBody);
  // refreshGarageSection is a render/re-wire helper — no user.set, no
  // activeVehicleId mutation, no cross-surface writes.
  checkBody('refreshGarageSection', refreshBody, [
    ...FORBIDDEN_DERIVE_ONLY,
    { name: 'activeVehicleId', regex: /\bactiveVehicleId\b/ },
  ]);

  // Positive contracts.
  expect('S16: wireGarageActions toggles data-garage-confirm-state (DOM-only archive)',
    /garageConfirmState/.test(wireBody));
  // 05J Codex P2 #1 (round 3) — the make-active handler now routes
  // through `markGarageVehicleActive` (single state.js writer that
  // also clears the `restoredFromArchive` marker). The `user.set` /
  // `driverGarage` literals no longer appear in wireGarageActions body
  // for the make-active path; instead the helper name must be present.
  expect('S16: wireGarageActions routes make-active through markGarageVehicleActive',
    /\bmarkGarageVehicleActive\s*\(/.test(wireBody));
  expect('S16: resolveActiveGarageVehicleId reads profile.driverGarage.activeVehicleId',
    /\bdriverGarage\b/.test(resolveBody) && /\bactiveVehicleId\b/.test(resolveBody));
  expect('S16: buildGarageVehicles still reads u.vehicleMake (legacy bridge intact)',
    /\bu\.vehicleMake\b/.test(buildBody));
  expect('S16: buildGarageVehicles still reads u.vehicleModel (legacy bridge intact)',
    /\bu\.vehicleModel\b/.test(buildBody));
}

// ── Scenario 17 — Single-vehicle (default) collection shape via DOM hooks ──
// 05C exposes `data-garage-collection-size` on the section root so the
// smoke can pin the rendered size without crossing the module boundary
// into `buildGarageVehicles`. Default legacy profile == size 1.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S17: section advertises data-garage-collection-size="1" for the default legacy profile',
    slice.includes('data-garage-collection-size="1"'));
  // Each card carries a data-vehicle id; the derived legacy vehicle is
  // pinned to `legacy-1` so per-vehicle handlers stay deterministic.
  expect('S17: legacy vehicle card carries data-vehicle="legacy-1"',
    slice.includes('data-vehicle="legacy-1"'));
  expect('S17: legacy vehicle card carries data-vehicle-status="active"',
    slice.includes('data-vehicle-status="active"'));
  expect('S17: legacy vehicle card carries data-vehicle-source="legacy"',
    slice.includes('data-vehicle-source="legacy"'));
  // Exactly one card means no multi-card modifier.
  expect('S17: single-card render does NOT set pf2-garage--multi',
    !/pf2-garage--multi\b/.test(slice));
  // No demo data leaks into a default render.
  expect('S17: default render does NOT include the demo "Kia Rio"',
    !slice.includes('Kia Rio'));
}

// ── Scenario 18 — Empty render advertises size 0 ────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S18: empty section advertises data-garage-collection-size="0"',
    slice.includes('data-garage-collection-size="0"'));
  expect('S18: empty section carries the empty modifier',
    slice.includes('pf2-garage--empty'));
}

// ── Scenario 19 — `?garage=multi` adds the preview demo vehicle ─────────────
// The render-gate appends ONE demo vehicle (Kia Rio) with status
// 'available' and source 'mock'. The legacy vehicle stays active by
// construction — the multi card never overrides the derived active flag.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S19: multi preview advertises data-garage-collection-size="2"',
    slice.includes('data-garage-collection-size="2"'));
  expect('S19: multi preview sets the pf2-garage--multi modifier',
    /pf2-garage--multi\b/.test(slice));
  expect('S19: legacy card present with data-vehicle="legacy-1"',
    slice.includes('data-vehicle="legacy-1"'));
  expect('S19: demo card present with data-vehicle="demo-2"',
    slice.includes('data-vehicle="demo-2"'));
  expect('S19: demo card carries data-vehicle-status="available"',
    /data-vehicle="demo-2"[^>]*data-vehicle-status="available"|data-vehicle-status="available"[^>]*data-vehicle="demo-2"/.test(slice) ||
    slice.includes('data-vehicle-status="available"'));
  expect('S19: demo card carries data-vehicle-source="mock" (preview, not persisted)',
    slice.includes('data-vehicle-source="mock"'));
  // Active card vs. non-active card variants.
  expect('S19: legacy card retains "Активное" badge',
    slice.includes('Активное'));
  expect('S19: demo card shows the "Доступно" badge',
    slice.includes('Доступно'));
  // make-active-local is a per-vehicle control on non-active cards only.
  expect('S19: non-active card exposes data-garage-state="make-active-local"',
    slice.includes('data-garage-state="make-active-local"'));
  expect('S19: non-active card shows "Сделать активной" label',
    slice.includes('Сделать активной'));
  // Demo vehicle properties are rendered.
  expect('S19: demo card shows "Kia Rio" model',
    slice.includes('Kia Rio'));
  // Per-vehicle archive confirm rows are independent (one per card).
  expect('S19: legacy card has its own confirm row #pf2-garage-confirm-legacy-1',
    slice.includes('id="pf2-garage-confirm-legacy-1"'));
  expect('S19: demo card has its own confirm row #pf2-garage-confirm-demo-2',
    slice.includes('id="pf2-garage-confirm-demo-2"'));
  // Multi-render must not bleed into persisted state. 05D introduced a
  // `driverGarage.activeVehicleId` field that defaults to null on every
  // user record, so the right invariant is: the multi PREVIEW does not
  // persist a selection — the resolved id stays the default null.
  expect('S19: ?garage=multi did NOT persist an active vehicle selection',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 20 — Active card has no make-active button; non-active has no
// active-current span (mirror invariants). ──────────────────────────────────
{
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  // The active vehicle (legacy-1) renders the status pill, NOT a
  // make-active button — confirm via id presence/absence.
  expect('S20: active card (legacy-1) renders #pf2-garage-active-legacy-1',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S20: active card (legacy-1) does NOT render a make-active button',
    !slice.includes('id="pf2-garage-make-active-legacy-1"'));
  // The non-active vehicle (demo-2) renders the make-active button, NOT
  // a status pill.
  expect('S20: non-active card (demo-2) renders #pf2-garage-make-active-demo-2',
    slice.includes('id="pf2-garage-make-active-demo-2"'));
  expect('S20: non-active card (demo-2) does NOT render an active-current span',
    !slice.includes('id="pf2-garage-active-demo-2"'));
}

// ── Scenario 21 — Multi-state no-mutation guarantee on NON-make-active
// handlers. Trigger every non-make-active per-vehicle handler across both
// cards and assert localStorage stays byte-equal. (make-active gets its own
// dedicated scenario S22 because it IS the single allowed writer in 05D.) ─
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  const before = snapshotLocalStorage();
  // 05I — `#pf2-garage-archive-confirm-*` is now the archive writer
  // (DOM-only flash retired); excluded from the byte-equality triggers
  // here. For legacy-1 specifically, confirm materialises the legacy
  // record; for demo-2 (preview-only, no storage backing) it still
  // doesn't write, but we drop both for consistency with S14.
  const triggers = [
    '#pf2-garage-add',
    // Legacy (active) card — no make-active button on the active card.
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
    // Demo (non-active) card — every handler EXCEPT make-active and
    // archive-confirm.
    '#pf2-garage-edit-demo-2',
    '#pf2-garage-archive-demo-2',
    '#pf2-garage-archive-cancel-demo-2',
  ];
  for (const sel of triggers) {
    const fn = clickHandlers.get(sel);
    expect(`S21 pre: captured click handler for ${sel}`,
      typeof fn === 'function');
    try { fn && fn(); } catch (e) {
      expect(`S21: handler for ${sel} did not throw`, false, e.message || String(e));
    }
    const after = snapshotLocalStorage();
    expect(`S21: localStorage byte-equal after invoking ${sel}`,
      before === after, `before=${before.length}b after=${after.length}b`);
  }
  // Active card never wires a make-active handler.
  expect('S21: active card does NOT capture a make-active handler',
    !clickHandlers.has('#pf2-garage-make-active-legacy-1'));
  // Active vehicle id stays a span, not a click target.
  expect('S21: active card does NOT capture an active-current click handler',
    !clickHandlers.has('#pf2-garage-active-legacy-1'));
  // Persisted vehicle fields untouched.
  expect('S21: persisted vehicleMake preserved across non-make-active multi-card clicks',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  // 05D: the namespace defaults to { activeVehicleId: null } — the
  // non-make-active handlers never patch it, so it must still be null
  // (NOT the freshly-clicked demo-2 id).
  expect('S21: driverGarage.activeVehicleId stays null after non-make-active clicks',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
  expect('S21: no flat activeVehicleId leaked onto top-level user record',
    typeof user.get().activeVehicleId === 'undefined',
    String(user.get().activeVehicleId));
  expect('S21: no selectedVehicleId leaked onto persisted user record',
    typeof user.get().selectedVehicleId === 'undefined',
    String(user.get().selectedVehicleId));
  expect('S21: no garageVehicles array leaked onto persisted user record',
    typeof user.get().garageVehicles === 'undefined',
    String(user.get().garageVehicles));
}

// ── Helper: byte-equal snapshot per storage key (for 05D per-key diff) ──────
function snapshotByKey() {
  const out = {};
  for (const [k, v] of local.entries()) out[k] = String(v);
  return out;
}

// ── Scenario 22 — make-active persists into the driverGarage namespace ─────
// 05D's load-bearing scenario: clicking "Сделать активной" on a non-active
// vehicle calls user.set with a driverGarage patch, and ONLY that field
// drifts in storage. No responses/active_ride/history/receipt key gets
// written even as a side effect.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  // Before click: default resolver → legacy-1 active, demo-2 available.
  expect('S22 pre: driverGarage default activeVehicleId is null',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));

  const beforeByKey = snapshotByKey();
  const fn = clickHandlers.get('#pf2-garage-make-active-demo-2');
  expect('S22: make-active handler captured for #pf2-garage-make-active-demo-2',
    typeof fn === 'function');
  try { fn && fn(); } catch (e) {
    expect('S22: make-active handler did not throw', false, e.message || String(e));
  }

  // After click: driverGarage.activeVehicleId === 'demo-2' (persisted).
  expect('S22: driverGarage.activeVehicleId === "demo-2" after click (persisted)',
    user.get().driverGarage?.activeVehicleId === 'demo-2',
    String(user.get().driverGarage?.activeVehicleId));
  // No flat activeVehicleId on the user record (we use the namespace only).
  expect('S22: no flat user.activeVehicleId field was introduced',
    typeof user.get().activeVehicleId === 'undefined',
    String(user.get().activeVehicleId));
  // Legacy vehicle fields untouched (the make-active patch is scoped).
  expect('S22: vehicleMake preserved across make-active click',
    user.get().vehicleMake === 'Hyundai', String(user.get().vehicleMake));
  expect('S22: vehiclePlate preserved across make-active click',
    user.get().vehiclePlate === 'А 482 МР 77', String(user.get().vehiclePlate));

  // Per-key diff: ONLY bazardrive.user.v1 changed, no other key was created
  // or mutated. Forbidden cross-surface keys must not exist at all.
  const afterByKey = snapshotByKey();
  const allKeys = new Set([...Object.keys(beforeByKey), ...Object.keys(afterByKey)]);
  for (const k of allKeys) {
    if (k === 'bazardrive.user.v1') continue;
    expect(`S22: storage key ${k} unchanged after make-active`,
      beforeByKey[k] === afterByKey[k]);
  }
  const FORBIDDEN_KEYS = [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    expect(`S22: cross-surface storage key ${k} was NOT written by make-active`,
      !(k in afterByKey));
  }
}

// ── Scenario 23 — Re-render after persist swaps the active badge ───────────
// After the make-active click persists activeVehicleId='demo-2', a fresh
// render must place the active badge / span on demo-2 and demote legacy-1
// to a make-active candidate. We re-render through renderProfile because
// the smoke's DOM stub no-ops `replaceWith` — the persistence path is what
// the smoke actually verifies, not the in-place DOM mutation.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  // Set the persisted active id directly via user.set — bypasses the
  // click handler to test the render→resolver path in isolation.
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: 'demo-2' } });
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));

  // demo-2 is now the active card.
  expect('S23: demo-2 renders the active span #pf2-garage-active-demo-2',
    slice.includes('id="pf2-garage-active-demo-2"'));
  expect('S23: demo-2 card carries data-vehicle-status="active"',
    /data-vehicle="demo-2"[^>]*data-vehicle-status="active"|data-vehicle-status="active"[^>]*data-vehicle="demo-2"/.test(slice));
  expect('S23: demo-2 does NOT show a make-active button (it is the active one)',
    !slice.includes('id="pf2-garage-make-active-demo-2"'));

  // legacy-1 is demoted to a make-active candidate.
  expect('S23: legacy-1 now renders #pf2-garage-make-active-legacy-1 (demoted)',
    slice.includes('id="pf2-garage-make-active-legacy-1"'));
  expect('S23: legacy-1 does NOT render an active-current span anymore',
    !slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S23: legacy-1 card carries data-vehicle-status="available"',
    /data-vehicle="legacy-1"[^>]*data-vehicle-status="available"|data-vehicle-status="available"[^>]*data-vehicle="legacy-1"/.test(slice));
}

// ── Scenario 24 — Click-then-reload preserves the active selection ─────────
// End-to-end on the persistence layer: drive the make-active click handler
// (not a direct user.set), then re-render fresh. The persisted id must
// survive the round trip.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  const fn = clickHandlers.get('#pf2-garage-make-active-demo-2');
  fn && fn();
  // Simulate reload: render again from scratch.
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S24: post-click reload still has demo-2 as the active card',
    slice.includes('id="pf2-garage-active-demo-2"'));
  expect('S24: post-click reload demotes legacy-1 to make-active',
    slice.includes('id="pf2-garage-make-active-legacy-1"'));
  expect('S24: persisted driverGarage.activeVehicleId survived the reload',
    user.get().driverGarage?.activeVehicleId === 'demo-2',
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 24b — Re-render clears stale click handlers ───────────────────
// BD-PROFILE-GARAGE-SMOKE-SURFACE-CLICK-S Codex P2 review on #490 — prove
// that a click handler captured on render N cannot leak into render N+1.
// The `?garage=multi` preview renders the demo-2 make-active CTA; the
// plain `/profile` render does NOT (demo-2 isn't in the user's legacy
// collection). After the re-render, clickHandlers must NOT still return
// the previous binding.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  expect('S24b: multi render captures demo-2 make-active handler',
    typeof clickHandlers.get('#pf2-garage-make-active-demo-2') === 'function');
  renderProfile('#/profile');
  expect('S24b: single-card re-render clears stale demo-2 make-active handler',
    typeof clickHandlers.get('#pf2-garage-make-active-demo-2') !== 'function',
    String(typeof clickHandlers.get('#pf2-garage-make-active-demo-2')));
}

// ── Scenario 24c — Refresh clears stale click handlers ─────────────────────
// BD-PROFILE-GARAGE-SMOKE-SURFACE-CLICK-S Codex P2 review on #490 — prove
// that an in-place refreshGarageSection (fired from inside a make-active
// click handler) also discards the old surface's click bindings. After
// making demo-2 active, the demo-2 make-active CTA disappears from the
// rendered card (the badge replaces it), so the captured make-active
// handler for demo-2 must no longer be reachable via clickHandlers.get.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile?role=driver&garage=multi');
  const fn = clickHandlers.get('#pf2-garage-make-active-demo-2');
  expect('S24c: multi render captures demo-2 make-active handler before refresh',
    typeof fn === 'function');
  // Trigger the in-place refreshGarageSection path; this overwrites the
  // garage section's innerHTML, which fires the refresh-aware reset in
  // the stub's `set innerHTML`.
  fn && fn();
  expect('S24c: make-active in-place refresh clears stale demo-2 make-active handler',
    typeof clickHandlers.get('#pf2-garage-make-active-demo-2') !== 'function',
    String(typeof clickHandlers.get('#pf2-garage-make-active-demo-2')));
}

// ── Scenario 25 — Stale activeVehicleId falls back to legacy ───────────────
// If the persisted activeVehicleId points to a vehicle that is no longer
// in the rebuilt collection (e.g. ?garage=multi turned off, so demo-2 is
// gone), the resolver must fall back to the legacy vehicle without
// crashing and without mutating the persisted id (the saved selection
// stays around for when the user comes back to the multi preview).
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: 'demo-2' } });
  // Render WITHOUT ?garage=multi — demo-2 is not in the collection now.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S25: single-card render after stale id still rendered (no crash)',
    slice.length > 0);
  expect('S25: legacy-1 falls back to active under a stale persisted id',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S25: legacy-1 card carries data-vehicle-status="active"',
    slice.includes('data-vehicle-status="active"'));
  expect('S25: stale persisted activeVehicleId is PRESERVED (resolver is read-only)',
    user.get().driverGarage?.activeVehicleId === 'demo-2',
    String(user.get().driverGarage?.activeVehicleId));
  // Restoring the multi preview brings demo-2 back as the active vehicle.
  const sliceMulti = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S25: bringing ?garage=multi back restores demo-2 as the active card',
    sliceMulti.includes('id="pf2-garage-active-demo-2"'));
}

// ── Scenario 26 — Empty garage never writes driverGarage ───────────────────
// No make-active button is rendered in the empty state, so the add-CTA
// click does NOT touch driverGarage at all. (Also re-confirms the empty
// state's snapshot byte-equality from S15, but specifically pins the
// driverGarage namespace stays default.)
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
});
{
  renderProfile('#/profile');
  expect('S26: empty render does NOT expose a make-active button anywhere',
    !clickHandlers.has('#pf2-garage-make-active-legacy-1') &&
    !clickHandlers.has('#pf2-garage-make-active-demo-2'));
  const addHandler = clickHandlers.get('#pf2-garage-add');
  addHandler && addHandler();
  expect('S26: driverGarage.activeVehicleId stays null after empty-add click',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 27 — Passenger profile never writes driverGarage either ───────
// The garage section is driver-only, so a passenger render must not even
// expose the make-active selector — but as a belt-and-braces, also
// confirm the namespace stays default.
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
});
{
  renderProfile('#/profile');
  expect('S27: passenger render does NOT capture any make-active handler',
    !clickHandlers.has('#pf2-garage-make-active-legacy-1') &&
    !clickHandlers.has('#pf2-garage-make-active-demo-2'));
  expect('S27: passenger profile driverGarage.activeVehicleId stays default null',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 28 — Default resolver: no persisted active → legacy is active ─
// Belt-and-braces sanity check on the resolver fallback path: a profile
// with no prior selection (the v10 default `driverGarage.activeVehicleId
// = null`) still gets a legacy active card without ever writing.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S28: legacy-1 is the active card under default null persisted id',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S28: default null activeVehicleId is left untouched by render',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── BD-PROFILE-D-05F — Persisted vehicle collection scenarios ──────────────
// 05F lets `profile.driverGarage.vehicles` drive the garage collection
// when it holds a usable non-empty array. The render path stays
// strictly read-only against the persisted collection — the legacy
// fallback never auto-initialises `driverGarage.vehicles`, and the
// make-active handler still only writes `activeVehicleId`.

// ── Scenario 29 — Default driverGarage shape includes vehicles: []. ────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const u = user.get();
  expect('S29: driverGarage.vehicles defaults to an empty array',
    Array.isArray(u.driverGarage?.vehicles) && u.driverGarage.vehicles.length === 0);
  expect('S29: driverGarage.activeVehicleId defaults to null',
    u.driverGarage?.activeVehicleId === null);
  // Render still produces a legacy card (the existing fallback) — the
  // persisted-collection feature must not break the legacy-only render.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S29: legacy-only profile still renders the single legacy card',
    slice.includes('data-vehicle="legacy-1"') && slice.includes('Hyundai Solaris'));
}

// ── Scenario 30 — Persisted vehicles array overrides the legacy fields ─────
// Legacy fields point at "Hyundai Solaris"; the persisted collection
// contains a single DIFFERENT car ("Toyota Prius"). The render must
// reflect the persisted vehicle — the legacy car must not leak into the
// slice at all.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S30: section advertises data-garage-collection-size="1"',
    slice.includes('data-garage-collection-size="1"'));
  expect('S30: persisted real-2 card is rendered',
    slice.includes('data-vehicle="real-2"'));
  expect('S30: persisted vehicle model is rendered',
    slice.includes('Toyota Prius'));
  expect('S30: persisted vehicle plate is rendered',
    slice.includes('А 123 ВС 77'));
  // Legacy car must NOT leak into the slice.
  expect('S30: legacy "Hyundai Solaris" model does NOT leak into the persisted render',
    !slice.includes('Hyundai Solaris'));
  expect('S30: legacy plate does NOT leak into the persisted render',
    !slice.includes('А 482 МР 77'));
  expect('S30: real-2 card is the ACTIVE one (activeVehicleId resolved)',
    slice.includes('id="pf2-garage-active-real-2"'));
  expect('S30: persisted card carries data-vehicle-source="persisted"',
    slice.includes('data-vehicle-source="persisted"'));
}

// ── Scenario 31 — Multi-vehicle persisted collection: badge follows the
// resolved activeVehicleId; the other card shows the make-active button. ──
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-1', model: 'Skoda Octavia', color: 'чёрный',     plate: 'В 456 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Toyota Prius',  color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S31: section advertises data-garage-collection-size="2"',
    slice.includes('data-garage-collection-size="2"'));
  expect('S31: pf2-garage--multi modifier set (multi-card layout)',
    /pf2-garage--multi\b/.test(slice));
  // real-2 active.
  expect('S31: real-2 is the active card (#pf2-garage-active-real-2)',
    slice.includes('id="pf2-garage-active-real-2"'));
  expect('S31: real-2 does NOT render a make-active button',
    !slice.includes('id="pf2-garage-make-active-real-2"'));
  // real-1 non-active → make-active candidate.
  expect('S31: real-1 renders make-active button (#pf2-garage-make-active-real-1)',
    slice.includes('id="pf2-garage-make-active-real-1"'));
  expect('S31: real-1 does NOT render an active-current span',
    !slice.includes('id="pf2-garage-active-real-1"'));
}

// ── Scenario 32 — BD-PROFILE-GARAGE-ARCHIVE-I2 contract alignment.
// Stale `activeVehicleId` with a persisted collection now resolves to
// NO active vehicle (no silent promotion). Both cards render as make-
// active candidates; the saved id stays intact so the previous
// selection re-activates when the matching vehicle reappears. ────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'ghost-99',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius',  color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-3', model: 'Skoda Octavia', color: 'чёрный',     plate: 'В 456 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S32: stale id does NOT silently promote real-2 to active',
    !slice.includes('id="pf2-garage-active-real-2"'));
  expect('S32: stale id does NOT silently promote real-3 to active',
    !slice.includes('id="pf2-garage-active-real-3"'));
  expect('S32: stale id does NOT fall back to the legacy car',
    !slice.includes('data-vehicle="legacy-1"'));
  expect('S32: both persisted cards render as make-active candidates',
    slice.includes('id="pf2-garage-make-active-real-2"')
    && slice.includes('id="pf2-garage-make-active-real-3"'));
  expect('S32: stale activeVehicleId is PRESERVED (resolver is read-only)',
    user.get().driverGarage?.activeVehicleId === 'ghost-99',
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 33 — Malformed vehicles entries are dropped; the remaining
// valid entries (if any) still render. ────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      'garbage',
      null,
      { weird: true },                                    // no model → dropped
      { id: 'dup-1', model: 'X' },                        // first dup-1 → kept
      { id: 'dup-1', model: 'Y' },                        // second dup-1 → dropped
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  // The two valid entries (`dup-1` and `real-2`) render; the malformed
  // ones are dropped; the duplicate id is de-duped.
  expect('S33: collection size after dropping malformed entries is 2',
    slice.includes('data-garage-collection-size="2"'));
  expect('S33: first valid entry (dup-1) is rendered',
    slice.includes('data-vehicle="dup-1"'));
  expect('S33: persisted real-2 is rendered',
    slice.includes('data-vehicle="real-2"'));
  // The dropped duplicate entry must not have introduced its model "Y".
  expect('S33: dropped duplicate model "Y" did NOT render',
    !slice.includes('>Y<'));
  // The render did not crash and did NOT leak the legacy car.
  expect('S33: malformed persisted collection does NOT leak the legacy car',
    !slice.includes('Hyundai Solaris'));
}

// ── Scenario 34 — Empty persisted vehicles array falls back to legacy. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: { activeVehicleId: null, vehicles: [] },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S34: empty persisted collection falls back to legacy render',
    slice.includes('data-vehicle="legacy-1"') && slice.includes('Hyundai Solaris'));
  expect('S34: legacy-1 is active by fallback',
    slice.includes('id="pf2-garage-active-legacy-1"'));
}

// ── Scenario 35 — Persistence guardrail: render does NOT auto-init
// `driverGarage.vehicles` from the legacy fields. The collection stays
// at whatever the user record carried before the render. ──────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const before = snapshotLocalStorage();
  const beforeVehicles = JSON.stringify(user.get().driverGarage?.vehicles);
  renderProfile('#/profile');
  const after = snapshotLocalStorage();
  const afterVehicles = JSON.stringify(user.get().driverGarage?.vehicles);
  expect('S35: localStorage byte-equal after legacy-only render (no auto-init write)',
    before === after, `before=${before.length}b after=${after.length}b`);
  expect('S35: driverGarage.vehicles stays empty after render (no legacy seed persisted)',
    afterVehicles === '[]', String(afterVehicles));
  expect('S35: vehicles snapshot unchanged between before/after render',
    beforeVehicles === afterVehicles);
}

// ── Scenario 36 — make-active changes only activeVehicleId, NOT vehicles
// (preserves the persisted collection across selection clicks). 05D
// contract preserved under 05F: the make-active handler reads the
// existing driverGarage and spreads it so the vehicles array survives. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-1', model: 'Skoda Octavia', color: 'чёрный',     plate: 'В 456 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Toyota Prius',  color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  renderProfile('#/profile');
  // Surface pin so a missing CTA fails before the handler-capture assertion.
  expect('S36 surface: persisted garage renders #pf2-garage-make-active-real-1',
    renderedHtml.includes('id="pf2-garage-make-active-real-1"'));
  const beforeVehicles = JSON.stringify(user.get().driverGarage.vehicles);
  // real-2 is active by default; click make-active on real-1 to flip.
  const fn = clickHandlers.get('#pf2-garage-make-active-real-1');
  expect('S36: make-active handler captured for the non-active persisted card',
    typeof fn === 'function');
  fn && fn();
  expect('S36: activeVehicleId was patched to real-1 by make-active',
    user.get().driverGarage?.activeVehicleId === 'real-1',
    String(user.get().driverGarage?.activeVehicleId));
  const afterVehicles = JSON.stringify(user.get().driverGarage.vehicles);
  expect('S36: vehicles array preserved byte-for-byte across make-active',
    beforeVehicles === afterVehicles);
  // Re-render and confirm the badge swap is reflected.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S36: re-render after make-active marks real-1 active',
    slice.includes('id="pf2-garage-active-real-1"'));
  expect('S36: re-render demotes real-2 to make-active candidate',
    slice.includes('id="pf2-garage-make-active-real-2"'));
}

// ── Scenario 37 — ?garage=multi preview overlays the demo card ON TOP OF
// the persisted collection. The preview must not persist; the saved
// `driverGarage.vehicles` stays untouched and demo-2 is never written. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile?role=driver&garage=multi'));
  expect('S37: multi preview overlays demo-2 on the persisted real-2',
    slice.includes('data-vehicle="real-2"') && slice.includes('data-vehicle="demo-2"'));
  expect('S37: collection size with preview overlay is 2',
    slice.includes('data-garage-collection-size="2"'));
  // Storage stays clean — the preview did not persist anything.
  const persisted = user.get().driverGarage?.vehicles;
  expect('S37: persisted vehicles still contain ONLY real-2 (preview NOT persisted)',
    Array.isArray(persisted) && persisted.length === 1 && persisted[0]?.id === 'real-2');
  expect('S37: no demo-2 leaked into the persisted vehicles array',
    !JSON.stringify(persisted).includes('demo-2'));
}

// ── Scenario 38 — Passenger profile never reads OR writes driverGarage —
// even when the persisted collection holds a real vehicle. ────────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.', displayName: 'Алия К.',
  phone: '9007654321', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const before = snapshotLocalStorage();
  const html = renderProfile('#/profile');
  const after = snapshotLocalStorage();
  expect('S38: passenger profile does NOT render the garage section',
    !html.includes('id="pf2-garage"'));
  expect('S38: passenger render does NOT mutate localStorage',
    before === after);
  expect('S38: passenger driverGarage.vehicles preserved byte-for-byte',
    user.get().driverGarage?.vehicles?.[0]?.id === 'real-2');
}

// ── BD-PROFILE-D-05G — Add-vehicle sheet / local draft only ────────────────
// The "Добавить авто" CTA now opens a draft sheet. Typing, canceling,
// and closing the sheet must never write to storage; only the explicit
// save path (with a non-empty trimmed `model`) calls
// `appendGarageVehicle` and grows `profile.driverGarage.vehicles` by
// exactly one record with `source: 'persisted'`.

// Helper: render and return the section element directly so the sheet
// fields can be read/written via the cached querySelector stub.
function captureSection(hash) {
  currentHash = hash || '#/profile';
  // Same hygiene as renderProfile so the per-render surface tracker AND
  // the click-handler map are both consistent regardless of which entry
  // point a scenario uses. The refresh-aware `set innerHTML` covers
  // in-place garage refreshes within the rendered section.
  resetRenderedSurface();
  return profile();
}

function setField(section, id, value) {
  const el = section.querySelector(id);
  el.value = value;
  return el;
}

function setChecked(section, id, checked) {
  const el = section.querySelector(id);
  el.checked = checked;
  return el;
}

// ── Scenario 39 — Sheet markup is rendered with the right hooks. ──────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const html = renderProfile('#/profile');
  const slice = garageSlice(html);
  expect('S39: sheet container #pf2-garage-add-sheet rendered in garage section',
    slice.includes('id="pf2-garage-add-sheet"'));
  expect('S39: sheet starts with data-garage-add-state="closed"',
    slice.includes('data-garage-add-state="closed"'));
  expect('S39: sheet is hidden by default',
    /id="pf2-garage-add-sheet"[^>]*\bhidden\b/.test(slice));
  expect('S39: sheet model input #pf2-garage-add-model rendered',
    slice.includes('id="pf2-garage-add-model"'));
  expect('S39: sheet color input #pf2-garage-add-color rendered',
    slice.includes('id="pf2-garage-add-color"'));
  expect('S39: sheet plate input #pf2-garage-add-plate rendered',
    slice.includes('id="pf2-garage-add-plate"'));
  expect('S39: sheet make-active toggle #pf2-garage-add-make-active rendered',
    slice.includes('id="pf2-garage-add-make-active"'));
  expect('S39: sheet save button carries data-garage-state="add-save-local"',
    slice.includes('data-garage-state="add-save-local"'));
  expect('S39: sheet cancel button carries data-garage-state="add-cancel-local"',
    slice.includes('data-garage-state="add-cancel-local"'));
  expect('S39: sheet error paragraph starts in data-garage-add-state="idle"',
    /id="pf2-garage-add-error"[^>]*data-garage-add-state="idle"/.test(slice));
}

// ── Scenario 40 — Opening the sheet does NOT mutate localStorage. ─────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  renderProfile('#/profile');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-add')?.();
  const after = snapshotLocalStorage();
  expect('S40: opening the sheet does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
}

// ── Scenario 41 — Typing the draft fields does NOT mutate storage or the
// persisted vehicles array. ─────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  const before = snapshotLocalStorage();
  const beforeVehicles = JSON.stringify(user.get().driverGarage?.vehicles);
  setField(section, '#pf2-garage-add-model', 'Kia Sportage');
  setField(section, '#pf2-garage-add-color', 'серый');
  setField(section, '#pf2-garage-add-plate', 'А 999 ВС 77');
  setChecked(section, '#pf2-garage-add-make-active', true);
  const after = snapshotLocalStorage();
  const afterVehicles = JSON.stringify(user.get().driverGarage?.vehicles);
  expect('S41: typing into draft fields does NOT mutate localStorage',
    before === after);
  expect('S41: typing does NOT touch driverGarage.vehicles',
    beforeVehicles === afterVehicles);
  expect('S41: typing does NOT touch driverGarage.activeVehicleId',
    user.get().driverGarage?.activeVehicleId === null);
}

// ── Scenario 42 — Cancel resets draft and hides sheet without writing. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', 'Kia Sportage');
  setField(section, '#pf2-garage-add-color', 'серый');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-add-cancel')?.();
  const after = snapshotLocalStorage();
  expect('S42: cancel does NOT mutate localStorage',
    before === after);
  // Draft is wiped + sheet hidden via the cached elements.
  const modelEl = section.querySelector('#pf2-garage-add-model');
  expect('S42: cancel cleared the model draft field',
    modelEl.value === '', String(modelEl.value));
  const sheet = section.querySelector('#pf2-garage-add-sheet');
  expect('S42: cancel hid the sheet',
    sheet.hidden === true && sheet.dataset.garageAddState === 'closed');
  // Close (×) and backdrop are wired to the same close path.
  expect('S42: header × close button captured',
    typeof clickHandlers.get('#pf2-garage-add-close') === 'function');
  expect('S42: backdrop close handler captured',
    typeof clickHandlers.get('#pf2-garage-add-backdrop') === 'function');
}

// ── Scenario 43 — Blank model save is blocked: error surfaces, vehicles
// stay empty, sheet does NOT close. ────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  // Leave model empty; set color to something so we know it was ignored.
  setField(section, '#pf2-garage-add-color', 'серый');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-add-save')?.();
  const after = snapshotLocalStorage();
  expect('S43: blank-model save does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
  expect('S43: blank-model save does NOT append to driverGarage.vehicles',
    user.get().driverGarage?.vehicles?.length === 0);
  const errEl = section.querySelector('#pf2-garage-add-error');
  expect('S43: blank-model save flips error to data-garage-add-state="invalid"',
    errEl.dataset.garageAddState === 'invalid');
  expect('S43: error paragraph becomes visible',
    errEl.hidden === false);
  // Sheet stays open so the driver can finish the form.
  const sheet = section.querySelector('#pf2-garage-add-sheet');
  expect('S43: sheet remains open after a blocked save',
    sheet.hidden === false && sheet.dataset.garageAddState === 'open');
}

// ── Scenario 44 — Whitespace-only model is also blocked. ──────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', '   ');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-add-save')?.();
  const after = snapshotLocalStorage();
  expect('S44: whitespace-only model is rejected (no write)',
    before === after);
  expect('S44: whitespace-only model does NOT append to vehicles',
    user.get().driverGarage?.vehicles?.length === 0);
}

// ── Scenario 45 — Valid save appends exactly one persisted vehicle to the
// driverGarage.vehicles array with source: 'persisted' and a fresh id. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', '  Kia Sportage  ');
  setField(section, '#pf2-garage-add-color', '  серый  ');
  setField(section, '#pf2-garage-add-plate', '  А 999 ВС 77  ');
  clickHandlers.get('#pf2-garage-add-save')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S45: persisted vehicles array length is now 1 after save',
    Array.isArray(persisted) && persisted.length === 1);
  const v = persisted[0];
  expect('S45: appended vehicle model is trimmed',
    v?.model === 'Kia Sportage', String(v?.model));
  expect('S45: appended vehicle color is trimmed',
    v?.color === 'серый', String(v?.color));
  expect('S45: appended vehicle plate is trimmed',
    v?.plate === 'А 999 ВС 77', String(v?.plate));
  expect('S45: appended vehicle source is the controlled "persisted" value',
    v?.source === 'persisted', String(v?.source));
  expect('S45: appended vehicle id starts with the "vehicle-" prefix',
    typeof v?.id === 'string' && v.id.startsWith('vehicle-'), String(v?.id));
  // activeVehicleId stays at its pre-save value (no makeActive on this save).
  expect('S45: activeVehicleId preserved by default save (no makeActive)',
    user.get().driverGarage?.activeVehicleId === null);
  // Legacy fields untouched.
  expect('S45: legacy vehicleMake preserved across save',
    user.get().vehicleMake === 'Hyundai');
  expect('S45: legacy vehiclePlate preserved across save',
    user.get().vehiclePlate === 'А 482 МР 77');
}

// ── Scenario 46 — Post-save render reflects the persisted collection.
// Per 05F semantics, once `driverGarage.vehicles` is non-empty it
// becomes the source of truth and the legacy fallback no longer fires —
// the new Kia Sportage card is the only card on the section. The
// legacy Hyundai Solaris model line falls out of the slice. ──────────────
{
  const section = captureSection('#/profile');
  expect('S46: section advertises data-garage-collection-size="1" (persisted-only)',
    section._html.includes('data-garage-collection-size="1"'));
  expect('S46: post-save render shows the newly persisted Kia Sportage card',
    section._html.includes('Kia Sportage'));
  // 05F contract: persisted overrides legacy; the legacy "Hyundai
  // Solaris" line no longer renders in the garage section.
  const slice = garageSlice(section._html);
  expect('S46: legacy "Hyundai Solaris" model NOT in the garage slice once persisted is non-empty',
    !slice.includes('Hyundai Solaris'));
}

// ── Scenario 47 — Saving with the make-active toggle on patches
// activeVehicleId to the new id. ──────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', 'Kia Sportage');
  setChecked(section, '#pf2-garage-add-make-active', true);
  clickHandlers.get('#pf2-garage-add-save')?.();
  const newId = user.get().driverGarage?.vehicles?.[0]?.id;
  expect('S47: new vehicle persisted',
    typeof newId === 'string' && newId.length > 0);
  expect('S47: activeVehicleId is now the new id (make-active honoured)',
    user.get().driverGarage?.activeVehicleId === newId,
    String(user.get().driverGarage?.activeVehicleId));
}

// ── Scenario 48 — Sequential saves grow the array; ids stay unique. ───────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section1 = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section1, '#pf2-garage-add-model', 'Kia Sportage');
  clickHandlers.get('#pf2-garage-add-save')?.();

  const section2 = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section2, '#pf2-garage-add-model', 'Skoda Octavia');
  clickHandlers.get('#pf2-garage-add-save')?.();

  const persisted = user.get().driverGarage?.vehicles;
  expect('S48: after two saves, vehicles array has length 2',
    Array.isArray(persisted) && persisted.length === 2,
    String(persisted?.length));
  expect('S48: vehicle 1 model is Kia Sportage',
    persisted?.[0]?.model === 'Kia Sportage');
  expect('S48: vehicle 2 model is Skoda Octavia',
    persisted?.[1]?.model === 'Skoda Octavia');
  expect('S48: vehicle ids are unique',
    persisted?.[0]?.id && persisted?.[1]?.id && persisted[0].id !== persisted[1].id,
    `${persisted?.[0]?.id} vs ${persisted?.[1]?.id}`);
}

// ── Scenario 49 — ID collision: a saved vehicle is appended with a fresh
// id even when the same id pattern is already present (defensive against
// pre-existing seeds). ────────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
  // Pre-seed an existing entry whose id collides with the naive
  // length-based generation. The generator must skip past it.
  driverGarage: {
    activeVehicleId: 'pre-1',
    vehicles: [
      { id: 'vehicle-1', model: 'Pre-Existing', source: 'persisted' },
    ],
  },
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', 'Kia Sportage');
  clickHandlers.get('#pf2-garage-add-save')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S49: pre-existing vehicle preserved at index 0',
    persisted?.[0]?.model === 'Pre-Existing');
  expect('S49: new id is NOT the colliding "vehicle-1"',
    persisted?.[1]?.id !== 'vehicle-1', String(persisted?.[1]?.id));
  // Both ids unique.
  expect('S49: both ids unique after collision avoidance',
    persisted?.[0]?.id !== persisted?.[1]?.id);
}

// ── Scenario 50 — Save does NOT touch cross-surface storage keys. ─────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', 'Kia Sportage');
  clickHandlers.get('#pf2-garage-add-save')?.();
  const FORBIDDEN_KEYS = [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    expect(`S50: ${k} not written by add-vehicle save`,
      !local.has(k), String(local.get(k)));
  }
  // Only the user.v1 record drifted.
  const present = [];
  for (const k of local.keys()) present.push(k);
  expect('S50: only bazardrive.user.v1 was written by the save',
    present.length === 1 && present[0] === 'bazardrive.user.v1',
    present.join(','));
}

// ── Scenario 51 — Preserving existing persisted vehicles across save. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-2',
    vehicles: [
      { id: 'real-2', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const beforeFirst = JSON.stringify(user.get().driverGarage.vehicles[0]);
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-add')?.();
  setField(section, '#pf2-garage-add-model', 'Kia Sportage');
  clickHandlers.get('#pf2-garage-add-save')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S51: existing real-2 vehicle survived byte-for-byte at index 0',
    JSON.stringify(persisted?.[0]) === beforeFirst);
  expect('S51: vehicles array length is 2 after one save',
    persisted?.length === 2);
  expect('S51: activeVehicleId preserved (no makeActive on this save)',
    user.get().driverGarage?.activeVehicleId === 'real-2');
}

// ── Scenario 52 — Passenger profile does NOT render the sheet. ────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.',
  phone: '9007654321', phoneVerified: true,
});
{
  const html = renderProfile('#/profile');
  expect('S52: passenger profile does NOT include the add-vehicle sheet',
    !html.includes('id="pf2-garage-add-sheet"'));
  expect('S52: passenger profile does NOT include the save button',
    !html.includes('id="pf2-garage-add-save"'));
}

// ── Scenario 53 — Static source guard: appendGarageVehicle exported from
// state.js sets source: 'persisted' (controlled) and never copies an
// incoming `source` from arbitrary user input. ─────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const stateSrc = readFileSync(join(projectRoot, 'public/src/state.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const body = sliceFn(stateSrc, 'export function appendGarageVehicle(');
  expect('S53: appendGarageVehicle body extracted from state.js',
    body.length > 0, String(body.length));
  // Positive: persisted source is hard-coded.
  expect('S53: appendGarageVehicle hard-codes source: "persisted"',
    /source\s*:\s*['"]persisted['"]/.test(body));
  // Positive: a non-empty trimmed model is the gate.
  expect('S53: appendGarageVehicle gates on a trimmed model',
    /\.model\.trim\s*\(\s*\)/.test(body));
  // Forbidden cross-surface writes inside the helper.
  const FORBIDDEN = [
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];
  for (const { name, regex } of FORBIDDEN) {
    expect(`S53: appendGarageVehicle does NOT touch ${name}`, !regex.test(body));
  }
}

// ── BD-PROFILE-D-05H — Edit-vehicle sheet / local draft only ──────────────
// Mirror of 05G's add-sheet contract for the edit path. The "Редактировать"
// button now opens a persisted-vehicle edit sheet pre-filled from the
// card; typing / cancel / × / backdrop never touch storage; only the
// explicit save (with a non-empty trimmed `model`) calls
// `patchGarageVehicle(id, draft)` and rewrites exactly one entry in
// `driverGarage.vehicles`. Legacy-fallback cards keep the local-feedback
// flash because editing them would fabricate a `'legacy'` entry into the
// persisted collection — explicitly out of scope.

// ── Scenario 54 — Edit sheet markup is rendered with the right hooks. ─────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius',  color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage',  color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S54: edit sheet container #pf2-garage-edit-sheet rendered',
    slice.includes('id="pf2-garage-edit-sheet"'));
  expect('S54: edit sheet starts with data-garage-edit-state="closed"',
    slice.includes('data-garage-edit-state="closed"'));
  expect('S54: edit sheet is hidden by default',
    /id="pf2-garage-edit-sheet"[^>]*\bhidden\b/.test(slice));
  expect('S54: edit sheet model input #pf2-garage-edit-model rendered',
    slice.includes('id="pf2-garage-edit-model"'));
  expect('S54: edit sheet color input #pf2-garage-edit-color rendered',
    slice.includes('id="pf2-garage-edit-color"'));
  expect('S54: edit sheet plate input #pf2-garage-edit-plate rendered',
    slice.includes('id="pf2-garage-edit-plate"'));
  expect('S54: edit sheet save button carries data-garage-state="edit-save-local"',
    slice.includes('data-garage-state="edit-save-local"'));
  expect('S54: edit sheet does NOT include a make-active toggle (out of scope)',
    !slice.includes('id="pf2-garage-edit-make-active"'));
  expect('S54: edit error paragraph starts in data-garage-edit-state="idle"',
    /id="pf2-garage-edit-error"[^>]*data-garage-edit-state="idle"/.test(slice));
}

// ── Scenario 55 — Clicking edit on a persisted card pre-fills the sheet
// from the selected vehicle and does NOT mutate localStorage. ─────────────
{
  const section = captureSection('#/profile');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  const after = snapshotLocalStorage();
  expect('S55: opening edit sheet does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S55: edit sheet flips to data-garage-edit-state="open"',
    sheet.dataset.garageEditState === 'open');
  expect('S55: edit sheet stamps the editing target id on data-edit-vehicle-id',
    sheet.dataset.editVehicleId === 'real-2', String(sheet.dataset.editVehicleId));
  const modelEl = section.querySelector('#pf2-garage-edit-model');
  const colorEl = section.querySelector('#pf2-garage-edit-color');
  const plateEl = section.querySelector('#pf2-garage-edit-plate');
  expect('S55: model pre-filled from real-2',
    modelEl.value === 'Kia Sportage', String(modelEl.value));
  expect('S55: color pre-filled from real-2',
    colorEl.value === 'серый', String(colorEl.value));
  expect('S55: plate pre-filled from real-2',
    plateEl.value === 'В 456 КМ 77', String(plateEl.value));
}

// ── Scenario 56 — Typing into the edit draft does NOT mutate storage or
// the persisted vehicles array. ───────────────────────────────────────────
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  const before = snapshotLocalStorage();
  const beforeVehicles = JSON.stringify(user.get().driverGarage?.vehicles);
  setField(section, '#pf2-garage-edit-model', 'Kia Sorento');
  setField(section, '#pf2-garage-edit-color', 'белый');
  setField(section, '#pf2-garage-edit-plate', 'В 999 КМ 77');
  const after = snapshotLocalStorage();
  const afterVehicles = JSON.stringify(user.get().driverGarage?.vehicles);
  expect('S56: typing into draft does NOT mutate localStorage',
    before === after);
  expect('S56: typing does NOT touch driverGarage.vehicles',
    beforeVehicles === afterVehicles);
}

// ── Scenario 57 — Cancel resets the draft + hides the sheet without write. ─
{
  const section = captureSection('#/profile');
  // Surface pins for the edit-sheet fixed controls invoked below.
  expect('S57 surface: edit sheet renders #pf2-garage-edit-cancel',
    renderedHtml.includes('id="pf2-garage-edit-cancel"'));
  expect('S57 surface: edit sheet renders #pf2-garage-edit-close',
    renderedHtml.includes('id="pf2-garage-edit-close"'));
  expect('S57 surface: edit sheet renders #pf2-garage-edit-backdrop',
    renderedHtml.includes('id="pf2-garage-edit-backdrop"'));
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  setField(section, '#pf2-garage-edit-model', 'Garbage');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-cancel')?.();
  const after = snapshotLocalStorage();
  expect('S57: cancel does NOT mutate localStorage',
    before === after);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S57: cancel hid the sheet',
    sheet.hidden === true && sheet.dataset.garageEditState === 'closed');
  expect('S57: cancel cleared the editing target id',
    sheet.dataset.editVehicleId === undefined);
  const modelEl = section.querySelector('#pf2-garage-edit-model');
  expect('S57: cancel cleared the model draft field',
    modelEl.value === '', String(modelEl.value));
  expect('S57: edit × close button captured',
    typeof clickHandlers.get('#pf2-garage-edit-close') === 'function');
  expect('S57: edit backdrop close handler captured',
    typeof clickHandlers.get('#pf2-garage-edit-backdrop') === 'function');
}

// ── Scenario 57b — Close button invocation mirrors cancel semantics. ──────
// BD-PROFILE-GARAGE-EDIT-H: cancel, close, and backdrop must all clear the
// local draft + selected edit id without mutating storage. S57 covers
// cancel by invocation; this scenario does the same for the × close button
// so a future regression that splits the three wirings is caught.
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  setField(section, '#pf2-garage-edit-model', 'Garbage close');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-close')?.();
  const after = snapshotLocalStorage();
  expect('S57b: close does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S57b: close hid the sheet',
    sheet.hidden === true && sheet.dataset.garageEditState === 'closed');
  expect('S57b: close cleared the editing target id',
    sheet.dataset.editVehicleId === undefined,
    String(sheet.dataset.editVehicleId));
  expect('S57b: close cleared the model draft field',
    section.querySelector('#pf2-garage-edit-model').value === '',
    String(section.querySelector('#pf2-garage-edit-model').value));
}

// ── Scenario 57c — Backdrop invocation mirrors cancel semantics. ──────────
// Same as S57b but for the backdrop close handler.
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  setField(section, '#pf2-garage-edit-model', 'Garbage backdrop');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-backdrop')?.();
  const after = snapshotLocalStorage();
  expect('S57c: backdrop does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S57c: backdrop hid the sheet',
    sheet.hidden === true && sheet.dataset.garageEditState === 'closed');
  expect('S57c: backdrop cleared the editing target id',
    sheet.dataset.editVehicleId === undefined,
    String(sheet.dataset.editVehicleId));
  expect('S57c: backdrop cleared the model draft field',
    section.querySelector('#pf2-garage-edit-model').value === '',
    String(section.querySelector('#pf2-garage-edit-model').value));
}

// ── Scenario 58 — Blank model save is blocked: error surfaces, vehicles
// stay byte-equal, sheet stays open. ─────────────────────────────────────
{
  const section = captureSection('#/profile');
  // Surface pin for the edit-save fixed control invoked here and in S59.
  expect('S58 surface: edit sheet renders #pf2-garage-edit-save',
    renderedHtml.includes('id="pf2-garage-edit-save"'));
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  setField(section, '#pf2-garage-edit-model', '');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const after = snapshotLocalStorage();
  expect('S58: blank-model edit save does NOT mutate localStorage',
    before === after);
  const errEl = section.querySelector('#pf2-garage-edit-error');
  expect('S58: error paragraph flips to data-garage-edit-state="invalid"',
    errEl.dataset.garageEditState === 'invalid');
  expect('S58: error paragraph becomes visible',
    errEl.hidden === false);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S58: sheet remains open after a blocked edit save',
    sheet.hidden === false && sheet.dataset.garageEditState === 'open');
}

// ── Scenario 59 — Whitespace-only model is also blocked. ──────────────────
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  setField(section, '#pf2-garage-edit-model', '   ');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const after = snapshotLocalStorage();
  expect('S59: whitespace-only edit-model save does NOT mutate localStorage',
    before === after);
}

// ── Scenario 60 — Valid save patches exactly one persisted vehicle: id
// preserved, fields trimmed, source preserved, other vehicles unchanged,
// activeVehicleId preserved. ──────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const beforeReal1 = JSON.stringify(user.get().driverGarage.vehicles[0]);
  const beforeReal2 = JSON.stringify(user.get().driverGarage.vehicles[1]);
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-1')?.();
  setField(section, '#pf2-garage-edit-model', '  Toyota Prius 2018  ');
  setField(section, '#pf2-garage-edit-color', '  белый  ');
  setField(section, '#pf2-garage-edit-plate', '  А 123 ВС 77  ');
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S60: vehicles array still has 2 entries after edit',
    Array.isArray(persisted) && persisted.length === 2,
    String(persisted?.length));
  const patched = persisted?.[0];
  expect('S60: patched vehicle keeps the same id (real-1)',
    patched?.id === 'real-1');
  expect('S60: patched vehicle model is trimmed',
    patched?.model === 'Toyota Prius 2018', String(patched?.model));
  expect('S60: patched vehicle color is trimmed',
    patched?.color === 'белый', String(patched?.color));
  expect('S60: patched vehicle plate is trimmed',
    patched?.plate === 'А 123 ВС 77', String(patched?.plate));
  expect('S60: patched vehicle source preserved as "persisted"',
    patched?.source === 'persisted', String(patched?.source));
  // Other vehicles untouched.
  expect('S60: real-2 byte-for-byte unchanged after editing real-1',
    JSON.stringify(persisted?.[1]) === beforeReal2);
  // Array order preserved (real-1 stays index 0).
  expect('S60: array order preserved (real-1 still at index 0)',
    persisted?.[0]?.id === 'real-1' && persisted?.[1]?.id === 'real-2');
  // activeVehicleId preserved.
  expect('S60: activeVehicleId preserved (still real-1)',
    user.get().driverGarage?.activeVehicleId === 'real-1');
  // Legacy fields preserved.
  expect('S60: legacy vehicleMake preserved across edit',
    user.get().vehicleMake === 'Hyundai');
  expect('S60: legacy vehiclePlate preserved across edit',
    user.get().vehiclePlate === 'А 482 МР 77');
  // beforeReal1 is unchanged to remind us the patch swapped only the
  // selected slot; sanity-check by ensuring the new entry differs.
  expect('S60: real-1 content actually changed (sanity check vs pre-edit)',
    JSON.stringify(persisted?.[0]) !== beforeReal1);
}

// ── Scenario 61 — Editing a non-active vehicle does NOT change
// activeVehicleId. ────────────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const section = captureSection('#/profile');
  // real-2 is the non-active card; clicking edit opens its draft.
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  setField(section, '#pf2-garage-edit-model', 'Kia Sorento');
  clickHandlers.get('#pf2-garage-edit-save')?.();
  expect('S61: editing the non-active vehicle keeps activeVehicleId on real-1',
    user.get().driverGarage?.activeVehicleId === 'real-1');
  expect('S61: real-2 model patched',
    user.get().driverGarage?.vehicles?.[1]?.model === 'Kia Sorento');
  // real-1 byte-for-byte preserved.
  expect('S61: real-1 byte-for-byte preserved when editing real-2',
    user.get().driverGarage?.vehicles?.[0]?.id === 'real-1' &&
    user.get().driverGarage?.vehicles?.[0]?.model === 'Toyota Prius');
}

// ── Scenario 62 — Defensive: calling patchGarageVehicle directly with a
// missing or unknown id does not write. The wired UI path can never
// reach this branch (the sheet only opens for known persisted cards),
// but the helper must still refuse gracefully. ────────────────────────────
{
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  const before = snapshotLocalStorage();
  const r1 = patchFn('does-not-exist', { model: 'X' });
  expect('S62: unknown id returns null',
    r1 === null, String(r1));
  const r2 = patchFn('', { model: 'X' });
  expect('S62: empty id returns null',
    r2 === null, String(r2));
  const r3 = patchFn('real-1', { model: '   ' });
  expect('S62: whitespace-only model returns null',
    r3 === null, String(r3));
  const r4 = patchFn(null, { model: 'X' });
  expect('S62: null id returns null',
    r4 === null, String(r4));
  const after = snapshotLocalStorage();
  expect('S62: defensive patches do NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
}

// ── Scenario 62b — Wired-path missing-id guard: if the sheet's stored
// data-edit-vehicle-id is a stale / unknown id when Save is clicked, the
// handler must refuse the write, surface the invalid state, and leave
// storage byte-equal. Belt-and-braces against a future refactor that
// would let a stale edit-vehicle-id slip through to patchGarageVehicle.
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-2')?.();
  // Smuggle in an unknown id on the open sheet — the wired Save path
  // reads this exact dataset key.
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  sheet.dataset.editVehicleId = 'ghost-vehicle';
  setField(section, '#pf2-garage-edit-model', 'Phantom Prius');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const after = snapshotLocalStorage();
  expect('S62b: stale-id Save does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
  const errEl = section.querySelector('#pf2-garage-edit-error');
  expect('S62b: stale-id Save flips the error paragraph to invalid',
    errEl.dataset.garageEditState === 'invalid');
  expect('S62b: stale-id Save reveals the error paragraph',
    errEl.hidden === false);
}

// ── Scenario 63 — Legacy-only profile: edit button keeps the local
// flash (no sheet open, no storage write). Legacy entries cannot be
// promoted into the persisted collection by an edit. ─────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
});
{
  const section = captureSection('#/profile');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-legacy-1')?.();
  const after = snapshotLocalStorage();
  expect('S63: legacy edit click does NOT mutate localStorage',
    before === after);
  expect('S63: legacy edit click does NOT open the edit sheet',
    section.querySelector('#pf2-garage-edit-sheet').dataset.garageEditState !== 'open');
  expect('S63: persisted vehicles array still empty after legacy edit click',
    user.get().driverGarage?.vehicles?.length === 0);
}

// ── Scenario 64 — Edit save does NOT touch cross-surface storage keys. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-real-1')?.();
  setField(section, '#pf2-garage-edit-model', 'Toyota Prius 2018');
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const FORBIDDEN_KEYS = [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    expect(`S64: ${k} not written by edit save`,
      !local.has(k), String(local.get(k)));
  }
  const present = [];
  for (const k of local.keys()) present.push(k);
  expect('S64: only bazardrive.user.v1 was written by edit save',
    present.length === 1 && present[0] === 'bazardrive.user.v1',
    present.join(','));
}

// ── Scenario 65 — Source guard: edit draft cannot promote a persisted
// vehicle to 'legacy' via `rawPatch.source`. patchGarageVehicle preserves
// the existing source (or normalises to 'persisted'), never copies. ──────
{
  reset();
  user.set({
    onboarded: true, role: 'driver',
    driverGarage: {
      activeVehicleId: 'real-1',
      vehicles: [
        { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      ],
    },
  });
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  const r = patchFn('real-1', { model: 'Patched', source: 'legacy' });
  expect('S65: patchGarageVehicle returns the id on a sourceless valid edit',
    r === 'real-1');
  expect('S65: source stays "persisted" — never copied from rawPatch.source="legacy"',
    user.get().driverGarage?.vehicles?.[0]?.source === 'persisted',
    String(user.get().driverGarage?.vehicles?.[0]?.source));
}

// ── Scenario 66 — Source guard: patchGarageVehicle cannot change the id
// via `rawPatch.id`. ───────────────────────────────────────────────────────
{
  reset();
  user.set({
    onboarded: true, role: 'driver',
    driverGarage: {
      activeVehicleId: 'real-1',
      vehicles: [
        { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      ],
    },
  });
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  patchFn('real-1', { model: 'Patched', id: 'hijacked' });
  expect('S66: id preserved after a patch attempt with rogue rawPatch.id',
    user.get().driverGarage?.vehicles?.[0]?.id === 'real-1');
  expect('S66: model still applied (only id was rejected)',
    user.get().driverGarage?.vehicles?.[0]?.model === 'Patched');
}

// ── Scenario 67 — Static source guard on patchGarageVehicle body. ────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const stateSrc = readFileSync(join(projectRoot, 'public/src/state.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const body = sliceFn(stateSrc, 'export function patchGarageVehicle(');
  expect('S67: patchGarageVehicle body extracted from state.js',
    body.length > 0, String(body.length));
  // Positive contract: a non-empty trimmed model is the gate; the id
  // refusal short-circuits early.
  expect('S67: patchGarageVehicle gates on a trimmed model',
    /\.model\.trim\s*\(\s*\)/.test(body));
  expect('S67: patchGarageVehicle preserves activeVehicleId verbatim',
    /activeVehicleId\s*:\s*dg\.activeVehicleId/.test(body));
  // Forbidden cross-surface writes.
  const FORBIDDEN = [
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];
  for (const { name, regex } of FORBIDDEN) {
    expect(`S67: patchGarageVehicle does NOT touch ${name}`, !regex.test(body));
  }
}

// ── Scenario 68 — Codex P2 (05H): synthesised-id round trip ───────────────
// `normalisePersistedVehicle` (in garage.js) assigns `garage-${idx + 1}`
// to persisted entries that landed without a usable string id. Before
// this fix, the edit save would call patchGarageVehicle('garage-1', …)
// and the strict-match findIndex against the raw stored array (whose
// entry has no `.id`) would return -1, refusing the write.
//
// After the fix:
//   - The render exposes `#pf2-garage-edit-garage-1` for an id-less
//     persisted entry.
//   - The edit sheet opens with the synthesised id stamped on
//     `data-edit-vehicle-id`.
//   - Save routes through the fallback: parse the synthesised id, find
//     the raw slot at index N-1 IFF its `.id` is missing/blank, patch
//     it, and persist `id: 'garage-1'` onto the slot so subsequent
//     edits hit the strict path.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // Raw stored entry with NO id field — the resolver synthesises
      // `garage-1` on render.
      { model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77' },
    ],
  },
});
{
  // 1) Render reflects the synthesised id on the edit button.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S68: render exposes #pf2-garage-edit-garage-1 for the id-less persisted entry',
    slice.includes('id="pf2-garage-edit-garage-1"'));
  expect('S68: card carries data-vehicle="garage-1"',
    slice.includes('data-vehicle="garage-1"'));
  expect('S68: card carries data-vehicle-source="persisted"',
    slice.includes('data-vehicle-source="persisted"'));

  // 2) Pre-save, the raw stored entry still has NO id.
  const beforeRaw = user.get().driverGarage?.vehicles?.[0];
  expect('S68: pre-save raw entry has no id field',
    !('id' in (beforeRaw || {})) || !beforeRaw.id);

  // 3) Click edit → sheet opens with synthesised id stamped.
  const section = captureSection('#/profile');
  const beforeStorage = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-garage-1')?.();
  expect('S68: opening the edit sheet does NOT mutate localStorage',
    snapshotLocalStorage() === beforeStorage);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S68: sheet stamps data-edit-vehicle-id with the synthesised id',
    sheet.dataset.editVehicleId === 'garage-1', String(sheet.dataset.editVehicleId));
  expect('S68: sheet model is pre-filled from the id-less entry',
    section.querySelector('#pf2-garage-edit-model').value === 'Toyota Prius');

  // 4) Edit + save → fallback routes to the raw slot, patch applies.
  setField(section, '#pf2-garage-edit-model', 'Toyota Prius 2018');
  setField(section, '#pf2-garage-edit-color', 'белый');
  setField(section, '#pf2-garage-edit-plate', 'А 123 ВС 77');
  clickHandlers.get('#pf2-garage-edit-save')?.();

  const persisted = user.get().driverGarage?.vehicles;
  expect('S68: vehicles array still has exactly one entry after save',
    Array.isArray(persisted) && persisted.length === 1, String(persisted?.length));
  const patched = persisted?.[0];
  expect('S68: patched entry now persists the synthesised id "garage-1"',
    patched?.id === 'garage-1', String(patched?.id));
  expect('S68: patched entry model trimmed',
    patched?.model === 'Toyota Prius 2018', String(patched?.model));
  expect('S68: patched entry color trimmed',
    patched?.color === 'белый', String(patched?.color));
  expect('S68: patched entry plate trimmed',
    patched?.plate === 'А 123 ВС 77', String(patched?.plate));
  expect('S68: patched entry source defaulted to "persisted" (no prev source to preserve)',
    patched?.source === 'persisted', String(patched?.source));
  expect('S68: activeVehicleId preserved at null across the synthesised-id edit',
    user.get().driverGarage?.activeVehicleId === null);
}

// ── Scenario 69 — After the round-trip from S68, subsequent edits hit the
// strict-match path (the synthesised id is now stored on the entry).
// Defensive: editing the SAME synthesised id again still works. ───────────
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-edit-garage-1')?.();
  setField(section, '#pf2-garage-edit-model', 'Toyota Prius 2020');
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S69: second edit of garage-1 keeps the array length at 1',
    Array.isArray(persisted) && persisted.length === 1);
  expect('S69: second edit patched the model',
    persisted?.[0]?.model === 'Toyota Prius 2020', String(persisted?.[0]?.model));
  expect('S69: id still garage-1',
    persisted?.[0]?.id === 'garage-1');
}

// ── Scenario 70 — Synthesised-id fallback does NOT fire when the targeted
// raw slot already has a non-blank id. Ensures the fallback only rescues
// the genuinely id-less case and never overwrites a real entry. ───────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  const r = patchFn('garage-1', { model: 'hijack attempt' });
  expect('S70: patchGarageVehicle("garage-1", …) returns null when raw[0] has a real id',
    r === null, String(r));
  expect('S70: real-1 byte-for-byte preserved (no hijack via fallback)',
    user.get().driverGarage?.vehicles?.[0]?.model === 'Toyota Prius');
}

// ── Scenario 71 — Synthesised-id fallback is bounded by the raw array
// length: out-of-range indices are rejected. ──────────────────────────────
{
  reset();
  user.set({
    onboarded: true, role: 'driver',
    driverGarage: {
      activeVehicleId: null,
      vehicles: [{ model: 'Only One' }], // id-less, synthesises garage-1
    },
  });
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  expect('S71: out-of-range synthesised id (garage-99) returns null',
    patchFn('garage-99', { model: 'X' }) === null);
  expect('S71: malformed synthesised id (garage-abc) returns null',
    patchFn('garage-abc', { model: 'X' }) === null);
}

// ── Scenario 72 — Codex P2 follow-up: whitespace-id round trip ────────────
// `normalisePersistedVehicle` (in garage.js) trims `raw.id` before
// rendering, so a raw stored id of ` real-1 ` is exposed on the edit
// button as `real-1` and the sheet stamps `data-edit-vehicle-id="real-1"`.
// Before this fix, patchGarageVehicle's strict findIndex compared
// `v.id === vehicleId` (strict), so the raw slot ` real-1 ` would never
// match the trimmed save id `real-1`, and the save would return null.
//
// After the fix:
//   - patchGarageVehicle trims its own input id.
//   - Strict match trims both sides.
//   - Patched entry persists the TRIMMED id, so the next render hits
//     the strict path on the cleaned id.
//   - rawPatch.id and rawPatch.source are still ignored.
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      // Whitespace on both sides of the id — the resolver trims to
      // 'real-1' for render, the edit sheet stamps 'real-1'.
      { id: ' real-1 ', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2',   model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  // 1) Render exposes the TRIMMED id on the edit button.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S72: render exposes #pf2-garage-edit-real-1 (id trimmed for render)',
    slice.includes('id="pf2-garage-edit-real-1"'));
  expect('S72: render does NOT expose the raw whitespace id',
    !slice.includes('id="pf2-garage-edit- real-1 "'));
  // 2) activeVehicleId resolves through trim — the active card is real-1.
  expect('S72: real-1 (trimmed) is the active card',
    slice.includes('id="pf2-garage-active-real-1"'));

  // 3) Pre-save, the raw stored id still has whitespace.
  const beforeRawId = user.get().driverGarage?.vehicles?.[0]?.id;
  expect('S72: pre-save raw id still has whitespace',
    beforeRawId === ' real-1 ', String(beforeRawId));

  // 4) Click edit → sheet opens prefilled, stamped with the trimmed id.
  const section = captureSection('#/profile');
  const beforeStorage = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-edit-real-1')?.();
  expect('S72: opening edit sheet does NOT mutate localStorage',
    snapshotLocalStorage() === beforeStorage);
  const sheet = section.querySelector('#pf2-garage-edit-sheet');
  expect('S72: sheet stamps data-edit-vehicle-id with the trimmed id "real-1"',
    sheet.dataset.editVehicleId === 'real-1', String(sheet.dataset.editVehicleId));

  // 5) Save → patch reaches the slot via the trim-aware strict match.
  setField(section, '#pf2-garage-edit-model', 'Toyota Prius 2019');
  setField(section, '#pf2-garage-edit-color', 'белый');
  setField(section, '#pf2-garage-edit-plate', 'А 123 ВС 77');
  clickHandlers.get('#pf2-garage-edit-save')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S72: vehicles array still has exactly 2 entries after save',
    Array.isArray(persisted) && persisted.length === 2,
    String(persisted?.length));
  const patched = persisted?.[0];
  expect('S72: patched slot id is now TRIMMED to "real-1"',
    patched?.id === 'real-1', String(patched?.id));
  expect('S72: patched model trimmed',
    patched?.model === 'Toyota Prius 2019', String(patched?.model));
  expect('S72: patched color trimmed',
    patched?.color === 'белый');
  expect('S72: patched source preserved as "persisted"',
    patched?.source === 'persisted');
  // 6) real-2 byte-for-byte unchanged.
  expect('S72: real-2 byte-for-byte preserved across the whitespace-id edit',
    JSON.stringify(persisted?.[1]) === JSON.stringify({
      id: 'real-2', model: 'Kia Sportage', color: 'серый', plate: 'В 456 КМ 77', source: 'persisted',
    }));
  // 7) Array order preserved.
  expect('S72: array order preserved (real-1 still at index 0)',
    persisted?.[0]?.id === 'real-1' && persisted?.[1]?.id === 'real-2');
  // 8) activeVehicleId preserved.
  expect('S72: activeVehicleId preserved (still real-1)',
    user.get().driverGarage?.activeVehicleId === 'real-1');
}

// ── Scenario 73 — Whitespace-id direct API call: defensive coverage on
// patchGarageVehicle showing rawPatch.id / rawPatch.source still ignored
// even when the matched slot was reached via the trim-aware strict path. ──
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: ' real-1 ', model: 'X', color: 'c', plate: 'p', source: 'persisted' },
    ],
  },
});
{
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  // Pass a trimmed id (`real-1`) AND a hijack `rawPatch.id` AND
  // `rawPatch.source: 'legacy'`. Patch must succeed; rawPatch.id and
  // rawPatch.source must be ignored.
  const r = patchFn('real-1', { model: 'Patched', id: 'hijacked', source: 'legacy' });
  expect('S73: trim-aware strict path matches and returns the cleaned id',
    r === 'real-1', String(r));
  const v = user.get().driverGarage?.vehicles?.[0];
  expect('S73: stored id is the trimmed "real-1" (NOT hijacked)',
    v?.id === 'real-1', String(v?.id));
  expect('S73: model patched',
    v?.model === 'Patched');
  expect('S73: source stayed "persisted" (rawPatch.source ignored)',
    v?.source === 'persisted', String(v?.source));
  // activeVehicleId stays null (the slot wasn't promoted).
  expect('S73: activeVehicleId preserved at null',
    user.get().driverGarage?.activeVehicleId === null);
}

// ── Scenario 74 — Whitespace incoming id is also normalised by patch. ────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'X', color: 'c', plate: 'p', source: 'persisted' },
    ],
  },
});
{
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  // Caller passes the id with stray whitespace — the helper trims it
  // before matching.
  const r = patchFn('   real-1   ', { model: 'New' });
  expect('S74: whitespace incoming id is trimmed and matches',
    r === 'real-1', String(r));
  expect('S74: model patched',
    user.get().driverGarage?.vehicles?.[0]?.model === 'New');
  // Whitespace-only incoming id refused.
  const r2 = patchFn('   ', { model: 'X' });
  expect('S74: whitespace-only id returns null',
    r2 === null);
}

// ── BD-PROFILE-D-05I — Archive vehicle (soft-delete) semantics ────────────
// 05A–05H left the archive confirm row as a contract surface that wrote
// only `data-garage-confirm-state="scheduled-local"` on the DOM. 05I
// flips it to a real persisted write: the matched entry gains
// `archived: true`, the active list filters it out, the archived-count
// hint surfaces, and (only when the archived id was the active one)
// `driverGarage.activeVehicleId` is cleared to null. No hard delete.

// ── Scenario 75 — archiveGarageVehicle helper writes archived: true and
// preserves every other field, the array order, and other entries. ────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  const r = archiveFn('real-2');
  expect('S75: archiveGarageVehicle returns the trimmed id on success',
    r === 'real-2', String(r));
  const persisted = user.get().driverGarage?.vehicles;
  expect('S75: vehicles array still has 2 entries (no hard delete)',
    Array.isArray(persisted) && persisted.length === 2,
    String(persisted?.length));
  expect('S75: real-2 marked archived: true',
    persisted?.[1]?.archived === true);
  expect('S75: real-2 model/color/plate/source preserved across archive',
    persisted?.[1]?.model === 'Kia Sportage'
    && persisted?.[1]?.color === 'серый'
    && persisted?.[1]?.plate === 'В 456 КМ 77'
    && persisted?.[1]?.source === 'persisted');
  expect('S75: real-1 byte-for-byte unchanged after archiving real-2',
    JSON.stringify(persisted?.[0]) === JSON.stringify({
      id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted',
    }));
  expect('S75: array order preserved (real-1 still at index 0, real-2 at 1)',
    persisted?.[0]?.id === 'real-1' && persisted?.[1]?.id === 'real-2');
  // archived: true never silently became archived: 'truthy' or a number
  expect('S75: archived field is a strict boolean true',
    persisted?.[1]?.archived === true && typeof persisted[1].archived === 'boolean');
}

// ── Scenario 76 — Render filters archived entries from the active list.
// real-2 was archived above; only real-1 should appear in the section,
// and the archived-count hint advertises 1. ─────────────────────────────
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S76: section advertises data-garage-collection-size="1" (real-2 filtered)',
    slice.includes('data-garage-collection-size="1"'));
  expect('S76: real-1 card rendered',
    slice.includes('data-vehicle="real-1"'));
  // 05J — archived real-2 is now rendered in the dedicated archived
  // section, but it must NOT appear as an active garage card.
  expect('S76: archived real-2 NOT rendered as an active garage card',
    !/<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="real-2"/.test(slice));
  expect('S76: archived-count hint rendered with "В архиве: 1"',
    slice.includes('В архиве: 1'));
  expect('S76: section advertises data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
}

// ── Scenario 77 — Archiving the ACTIVE vehicle clears activeVehicleId. ───
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('real-1');
  expect('S77: activeVehicleId cleared to null after archiving the active vehicle',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
  // real-1 is now archived; the render-time builder filters it out.
  expect('S77: archived real-1 has archived: true',
    user.get().driverGarage?.vehicles?.[0]?.archived === true);
  // real-2 is unchanged (NOT auto-promoted to active by the helper).
  expect('S77: real-2 NOT auto-promoted (its persisted record carries no active marker)',
    user.get().driverGarage?.vehicles?.[1]?.archived !== true);
}

// ── Scenario 78 — Archiving a non-active vehicle preserves activeVehicleId. ─
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('real-2');
  expect('S78: activeVehicleId still real-1 after archiving the non-active real-2',
    user.get().driverGarage?.activeVehicleId === 'real-1');
}

// ── Scenario 78b — BD-PROFILE-GARAGE-ARCHIVE-I — Archiving a non-active
// vehicle leaves OTHER vehicles byte-for-byte unchanged. Strengthens S78
// with explicit byte equality on the untouched record so a future patch
// that reformats the other entry (e.g. accidentally normalising fields
// during archive) is caught. ──────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  const before = JSON.stringify(user.get().driverGarage?.vehicles?.[0]);
  archiveFn('real-2');
  const after = JSON.stringify(user.get().driverGarage?.vehicles?.[0]);
  expect('S78b: non-archive sibling real-1 record byte-equal across the archive',
    before === after, `before=${before.length}b after=${after.length}b`);
  expect('S78b: archived real-2 carries archived: true',
    user.get().driverGarage?.vehicles?.[1]?.archived === true);
  expect('S78b: vehicle.id preserved across archive (real-2)',
    user.get().driverGarage?.vehicles?.[1]?.id === 'real-2',
    String(user.get().driverGarage?.vehicles?.[1]?.id));
}

// ── Scenario 79 — Full confirm-flow click path: render → click archive
// (opens confirm row) → click "Архивировать" → entry archived, badge
// gone, hint surfaces. ───────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  renderProfile('#/profile');
  // Step 1: open confirm row.
  clickHandlers.get('#pf2-garage-archive-real-1')?.();
  // Step 2: confirm — invokes archiveGarageVehicle.
  clickHandlers.get('#pf2-garage-archive-confirm-real-1')?.();

  const persisted = user.get().driverGarage?.vehicles;
  expect('S79: real-1 archived via the confirm-flow click path',
    persisted?.[0]?.archived === true);
  expect('S79: activeVehicleId cleared by the click flow (archived was active)',
    user.get().driverGarage?.activeVehicleId === null);
  // Re-render reflects the new state.
  const slice = garageSlice(renderProfile('#/profile'));
  // 05J — archived real-1 is now visible in the dedicated archived
  // section; the active-card render must drop it.
  expect('S79: post-archive render drops the archived card from the active list',
    !/<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="real-1"/.test(slice));
  expect('S79: real-2 still rendered in the active list',
    slice.includes('data-vehicle="real-2"'));
  expect('S79: post-archive render carries data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
}

// ── Scenario 79b — BD-PROFILE-GARAGE-ARCHIVE-I — Opening the archive
// confirm row is UI-local: snapshot before/after the open click is
// byte-equal, and the row's inline confirm state flips to "open" with
// matching ARIA. Task A: "opening confirmation does not mutate
// localStorage" + "selected archive id is UI-local". ──────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const section = captureSection('#/profile');
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-archive-real-2')?.();
  const after = snapshotLocalStorage();
  expect('S79b: opening archive confirm row does NOT mutate localStorage',
    before === after, `before=${before.length}b after=${after.length}b`);
  const confirmRow = section.querySelector('#pf2-garage-confirm-real-2');
  expect('S79b: confirm row flips to data-garage-confirm-state="open"',
    confirmRow.dataset.garageConfirmState === 'open',
    String(confirmRow.dataset.garageConfirmState));
  expect('S79b: confirm row is no longer hidden',
    confirmRow.hidden === false);
  // The archive button itself owns the aria-expanded state; the smoke
  // DOM stub records setAttribute calls implicitly via the runtime's
  // own .setAttribute('aria-expanded', 'true') call (the makeEl stub
  // accepts it). No persistence side-effect either way.
  expect('S79b: real-2 not archived after merely opening confirm row',
    user.get().driverGarage?.vehicles?.[1]?.archived !== true,
    String(user.get().driverGarage?.vehicles?.[1]?.archived));
  expect('S79b: activeVehicleId still real-1 after merely opening confirm row',
    user.get().driverGarage?.activeVehicleId === 'real-1');
}

// ── Scenario 80 — Cancel does NOT archive (defense-in-depth on the
// existing 05B confirm flow). ─────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-archive-real-1')?.();
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-archive-cancel-real-1')?.();
  const after = snapshotLocalStorage();
  expect('S80: cancel does NOT mutate localStorage',
    before === after);
  expect('S80: vehicle stays not-archived after cancel',
    user.get().driverGarage?.vehicles?.[0]?.archived !== true);
  expect('S80: activeVehicleId preserved after cancel',
    user.get().driverGarage?.activeVehicleId === 'real-1');
}

// ── Scenario 80b — BD-PROFILE-GARAGE-ARCHIVE-I — Cancel CLOSES the
// confirm row UI state. S80 covers the no-archive guarantee; this pins
// the matching state cleanup so a future regression that leaves the row
// half-open (visible without aria-expanded reset, label left as
// "Архивировано", etc.) is caught. Task B: "each exit clears archive
// draft / selected archive id". ──────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-archive-real-2')?.();
  clickHandlers.get('#pf2-garage-archive-cancel-real-2')?.();
  const confirmRow = section.querySelector('#pf2-garage-confirm-real-2');
  expect('S80b: cancel flips confirm row back to data-garage-confirm-state="idle"',
    confirmRow.dataset.garageConfirmState === 'idle',
    String(confirmRow.dataset.garageConfirmState));
  expect('S80b: cancel hides the confirm row',
    confirmRow.hidden === true);
  const confirmFinal = section.querySelector('#pf2-garage-archive-confirm-real-2');
  expect('S80b: cancel resets confirm final to enabled',
    confirmFinal.disabled === false);
  expect('S80b: cancel resets confirm final label to «Архивировать»',
    confirmFinal.textContent === 'Архивировать',
    String(confirmFinal.textContent));
}

// ── Scenario 81 — Defensive helper coverage: trim incoming id,
// whitespace id rejected, unknown id rejected, synthesised-id fallback
// mirrors patchGarageVehicle. ────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // Id-less raw entry — resolver synthesises `garage-1`.
      { model: 'Solo' },
      // Whitespace-padded id — strict match must trim both sides.
      { id: ' real-2 ', model: 'Padded' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  // Whitespace incoming id is trimmed.
  const r1 = archiveFn('  real-2  ');
  expect('S81: trimmed incoming id matches the whitespace-padded slot',
    r1 === 'real-2', String(r1));
  // Synthesised-id fallback routes to the id-less raw[0].
  const r2 = archiveFn('garage-1');
  expect('S81: synthesised-id fallback archives the id-less slot',
    r2 === 'garage-1', String(r2));
  // After archive, raw[0] has archived: true and id stored as 'garage-1'.
  const v = user.get().driverGarage?.vehicles?.[0];
  expect('S81: archived id-less slot now stores id "garage-1"',
    v?.id === 'garage-1' && v?.archived === true);
  // Unknown / whitespace-only / null reject.
  expect('S81: unknown id returns null',
    archiveFn('does-not-exist') === null);
  expect('S81: whitespace-only id returns null',
    archiveFn('   ') === null);
  expect('S81: null id returns null',
    archiveFn(null) === null);
  expect('S81: out-of-range garage-99 returns null',
    archiveFn('garage-99') === null);
}

// ── Scenario 82 — Idempotent: archiving an already-archived id is a
// no-op write but still clears activeVehicleId if it pointed there
// (defensive against an earlier writer that missed the active-clear). ────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', archived: true, source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  const r = archiveFn('real-1');
  expect('S82: idempotent archive returns the id',
    r === 'real-1');
  expect('S82: vehicle still archived (no flip-flop)',
    user.get().driverGarage?.vehicles?.[0]?.archived === true);
  expect('S82: activeVehicleId still cleared (idempotent active-clear)',
    user.get().driverGarage?.activeVehicleId === null);
}

// ── Scenario 83 — Edit on an archived vehicle id is not reachable from
// the UI (the card isn't rendered), but the patch helper still preserves
// the archived flag if someone calls it directly. ──────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', archived: true, source: 'persisted' },
    ],
  },
});
{
  const { patchGarageVehicle: patchFn } = await import('../public/src/state.js');
  patchFn('real-1', { model: 'Toyota Prius 2018' });
  const v = user.get().driverGarage?.vehicles?.[0];
  expect('S83: patch preserves archived flag via the ...prev spread',
    v?.archived === true);
  expect('S83: patch still applies the model change',
    v?.model === 'Toyota Prius 2018');
}

// ── Scenario 84 — Cross-surface keys never written by archive save. ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('real-1');
  const FORBIDDEN_KEYS = [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    expect(`S84: ${k} not written by archive`,
      !local.has(k), String(local.get(k)));
  }
  const present = [];
  for (const k of local.keys()) present.push(k);
  expect('S84: only bazardrive.user.v1 was written',
    present.length === 1 && present[0] === 'bazardrive.user.v1',
    present.join(','));
}

// ── Scenario 85 — Passenger profile: archive helper does not crash and
// the section never renders. ───────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.',
  phone: '9007654321', phoneVerified: true,
});
{
  const html = renderProfile('#/profile');
  expect('S85: passenger profile does NOT include the garage section',
    !html.includes('id="pf2-garage"'));
  expect('S85: passenger profile does NOT expose the archive button',
    !html.includes('id="pf2-garage-archive-'));
}

// ── Scenario 86 — Static source guard on archiveGarageVehicle body. ──────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const stateSrc = readFileSync(join(projectRoot, 'public/src/state.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const body = sliceFn(stateSrc, 'export function archiveGarageVehicle(');
  expect('S86: archiveGarageVehicle body extracted',
    body.length > 0, String(body.length));
  // Positive: writes archived: true onto the matched entry.
  expect('S86: archiveGarageVehicle sets archived: true',
    /archived\s*:\s*true/.test(body));
  // Forbidden cross-surface writes.
  const FORBIDDEN = [
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];
  for (const { name, regex } of FORBIDDEN) {
    expect(`S86: archiveGarageVehicle does NOT touch ${name}`, !regex.test(body));
  }
}

// ── BD-PROFILE-D-05I Codex P2 — Legacy fallback archive + empty-state
// archived hint ─────────────────────────────────────────────────────────
// Two interlocking fixes:
//   • Fix 1 — archiving the legacy fallback card materialises a
//     `{ id: 'legacy-1', archived: true }` entry into
//     `driverGarage.vehicles` so the legacy card does NOT resurrect on
//     the next render. The legacy `vehicleMake / Model / Color / Plate`
//     fields stay intact (no hard delete, no migration outside the
//     archive entry).
//   • Fix 2 — `garageSectionHtml` computes the archived count BEFORE
//     the empty branch so "В архиве: N" surfaces even when the user has
//     just archived their last active vehicle and the section renders
//     empty.

// ── Scenario 87 — Legacy fallback archive materialises the legacy entry. ─
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  // intentionally no driverGarage.vehicles — pure legacy fallback render
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  // Pre-archive: persisted collection is empty; render resolves the
  // legacy fallback card.
  expect('S87 pre: driverGarage.vehicles defaults to []',
    user.get().driverGarage?.vehicles?.length === 0);
  const sliceBefore = garageSlice(renderProfile('#/profile'));
  expect('S87 pre: render shows the legacy-1 card from u.vehicleMake/Model',
    sliceBefore.includes('data-vehicle="legacy-1"')
    && sliceBefore.includes('Hyundai Solaris'));

  // Archive the legacy card.
  const r = archiveFn('legacy-1');
  expect('S87: archiveGarageVehicle("legacy-1") returns the canonical id',
    r === 'legacy-1', String(r));

  // Persisted vehicles now has the materialised legacy entry, marked
  // archived. Legacy user fields are NOT wiped.
  const persisted = user.get().driverGarage?.vehicles;
  expect('S87: driverGarage.vehicles now has the materialised legacy entry',
    Array.isArray(persisted) && persisted.length === 1, String(persisted?.length));
  const entry = persisted?.[0];
  expect('S87: materialised entry id is "legacy-1"',
    entry?.id === 'legacy-1');
  expect('S87: materialised entry preserves the legacy model line',
    entry?.model === 'Hyundai Solaris', String(entry?.model));
  expect('S87: materialised entry preserves the legacy color',
    entry?.color === 'белый');
  expect('S87: materialised entry preserves the legacy plate',
    entry?.plate === 'А 482 МР 77');
  expect('S87: materialised entry carries source: "legacy"',
    entry?.source === 'legacy', String(entry?.source));
  expect('S87: materialised entry is archived: true',
    entry?.archived === true);
  expect('S87: legacy user.vehicleMake preserved (NOT wiped)',
    user.get().vehicleMake === 'Hyundai');
  expect('S87: legacy user.vehiclePlate preserved (NOT wiped)',
    user.get().vehiclePlate === 'А 482 МР 77');
}

// ── Scenario 88 — Next render: the archived legacy does NOT resurrect.
// The active list is empty and the archived hint surfaces "В архиве: 1". ─
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S88: post-archive render shows the empty-state modifier',
    slice.includes('pf2-garage--empty'));
  expect('S88: post-archive render advertises data-garage-collection-size="0"',
    slice.includes('data-garage-collection-size="0"'));
  expect('S88: post-archive render advertises data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
  expect('S88: post-archive render surfaces "В архиве: 1" hint in the empty state',
    slice.includes('В архиве: 1'));
  // No legacy-1 card on the active list.
  // 05J — archived legacy-1 is now visible in the dedicated archived
  // section, but never as an active card.
  expect('S88: archived legacy-1 is NOT rendered as an active garage card',
    !/<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="legacy-1"/.test(slice));
  // Add CTA still present so the driver can add a fresh vehicle.
  expect('S88: empty-state Add CTA still present',
    slice.includes('id="pf2-garage-add"'));
}

// ── Scenario 89 — Archiving the legacy card when it was the active one
// clears `activeVehicleId`. ───────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: { activeVehicleId: 'legacy-1', vehicles: [] },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('legacy-1');
  expect('S89: activeVehicleId cleared to null after archiving the active legacy card',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
  expect('S89: materialised legacy entry has archived: true',
    user.get().driverGarage?.vehicles?.[0]?.archived === true);
}

// ── Scenario 90 — End-to-end confirm-flow click path on the legacy card:
// open confirm row → click "Архивировать" → materialised entry + active
// cleared + empty render with hint. ───────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: { activeVehicleId: 'legacy-1', vehicles: [] },
});
{
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-archive-legacy-1')?.();
  clickHandlers.get('#pf2-garage-archive-confirm-legacy-1')?.();
  expect('S90: legacy materialised + archived via click flow',
    user.get().driverGarage?.vehicles?.[0]?.archived === true);
  expect('S90: activeVehicleId cleared by the legacy-archive click flow',
    user.get().driverGarage?.activeVehicleId === null);
  // Re-render reflects the empty state with the archived hint.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S90: re-render is the empty state',
    slice.includes('pf2-garage--empty'));
  expect('S90: re-render carries data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
  expect('S90: re-render shows "В архиве: 1" hint',
    slice.includes('В архиве: 1'));
}

// ── Scenario 91 — Defensive: archiveGarageVehicle('legacy-1') returns
// null when there are no legacy user fields to materialise from (no
// resurrection target). ──────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // intentionally no legacy vehicleMake/Model
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  const r = archiveFn('legacy-1');
  expect('S91: archiveGarageVehicle("legacy-1") returns null when legacy fields are empty',
    r === null, String(r));
  expect('S91: no materialisation when legacy fields are empty',
    user.get().driverGarage?.vehicles?.length === 0);
}

// ── Scenario 92 — Fix 2: archiving the last persisted vehicle still
// surfaces "В архиве: N" in the empty state. ─────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // no legacy fields so the legacy fallback does not re-fire
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-archive-real-1')?.();
  clickHandlers.get('#pf2-garage-archive-confirm-real-1')?.();
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S92: post-archive empty render shows pf2-garage--empty',
    slice.includes('pf2-garage--empty'));
  expect('S92: post-archive empty render advertises data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
  expect('S92: post-archive empty render renders "В архиве: 1" hint',
    slice.includes('В архиве: 1'));
  expect('S92: post-archive empty render still exposes the Add CTA',
    slice.includes('id="pf2-garage-add"'));
}

// ── Scenario 93 — Codex P3 (05I): cancel restores the 05I primary
// action label ("Архивировать") on the confirm button, NOT the pre-05I
// "Подтвердить". The cancel handler does not re-render the section, so
// the button text must be reset to the canonical 05I copy in place. ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const section = captureSection('#/profile');
  clickHandlers.get('#pf2-garage-archive-real-1')?.();
  const confirmFinal = section.querySelector('#pf2-garage-archive-confirm-real-1');

  // Sentinel — write a recognisable value into the button so we can
  // prove the cancel handler explicitly overwrites with "Архивировать"
  // (not just that the default happened to match). The smoke's DOM
  // stub starts elements with empty `textContent`, so this also
  // guarantees we are testing the handler's assignment, not the
  // template-parsed value.
  confirmFinal.textContent = '__sentinel_pre_cancel__';
  confirmFinal.disabled = true;

  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-archive-cancel-real-1')?.();
  const after = snapshotLocalStorage();
  expect('S93: cancel does NOT mutate localStorage',
    before === after);

  // After cancel, the confirm button text must be "Архивировать"
  // (NOT the pre-05I "Подтвердить") and re-enabled. This catches a
  // regression of the cancel handler reverting to the obsolete copy.
  expect('S93: cancel handler overwrites the confirm label with "Архивировать" (Codex P3)',
    confirmFinal.textContent === 'Архивировать',
    String(confirmFinal.textContent));
  expect('S93: cancel handler does NOT restore the pre-05I "Подтвердить" label',
    confirmFinal.textContent !== 'Подтвердить');
  expect('S93: confirm button is re-enabled after cancel',
    confirmFinal.disabled === false);
  // Vehicle stays not-archived.
  expect('S93: vehicle stays not-archived after cancel',
    user.get().driverGarage?.vehicles?.[0]?.archived !== true);
}

// ── BD-PROFILE-D-05J — Restore archived garage vehicle ────────────────────
// 05I made `archiveGarageVehicle` the soft-delete writer; 05J adds its
// inverse `restoreGarageVehicle` (strip the `archived` flag without
// hard-deleting the entry) and surfaces a per-archived-vehicle Restore
// confirm UI under the active list. Restore writes ONLY the matched
// entry's `archived` flag; `activeVehicleId` is preserved verbatim —
// restore never auto-promotes a vehicle to active.

// ── Scenario 94 — restoreGarageVehicle clears archived + preserves
// every other field + array order + activeVehicleId. ─────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted', archived: true },
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  const r = restoreFn('real-2');
  expect('S94: restoreGarageVehicle returns the trimmed id on success',
    r === 'real-2', String(r));
  const persisted = user.get().driverGarage?.vehicles;
  expect('S94: vehicles array still has 2 entries (no hard delete on restore)',
    Array.isArray(persisted) && persisted.length === 2);
  const restored = persisted?.[1];
  expect('S94: archived flag is stripped from the restored entry',
    !('archived' in (restored || {})));
  expect('S94: restored model preserved',
    restored?.model === 'Kia Sportage');
  expect('S94: restored color preserved',
    restored?.color === 'серый');
  expect('S94: restored plate preserved',
    restored?.plate === 'В 456 КМ 77');
  expect('S94: restored source preserved',
    restored?.source === 'persisted');
  expect('S94: real-1 byte-for-byte unchanged after restoring real-2',
    JSON.stringify(persisted?.[0]) === JSON.stringify({
      id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted',
    }));
  expect('S94: array order preserved (real-1 still index 0, real-2 index 1)',
    persisted?.[0]?.id === 'real-1' && persisted?.[1]?.id === 'real-2');
  expect('S94: activeVehicleId preserved across restore (still real-1)',
    user.get().driverGarage?.activeVehicleId === 'real-1');
}

// ── Scenario 95 — Restore preserves unknown / future fields via spread. ─
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', archived: true, source: 'persisted', futureNote: 'хранить' },
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  restoreFn('real-1');
  const v = user.get().driverGarage?.vehicles?.[0];
  expect('S95: restore preserved unknown future field `futureNote` via spread',
    v?.futureNote === 'хранить', String(v?.futureNote));
}

// ── Scenario 96 — Idempotent: restoring a non-archived id is a no-op
// write but still returns the canonical id. ──────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', source: 'persisted' },  // NOT archived
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  const before = snapshotLocalStorage();
  const r = restoreFn('real-1');
  const after = snapshotLocalStorage();
  expect('S96: idempotent restore returns the canonical id',
    r === 'real-1', String(r));
  expect('S96: idempotent restore does NOT mutate localStorage',
    before === after);
}

// ── Scenario 97 — Render: archived section appears with the restore
// confirm row hooks; archived vehicle does NOT render as an active card. ─
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted', archived: true },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S97: archived section #pf2-garage-archived-section rendered',
    slice.includes('id="pf2-garage-archived-section"'));
  expect('S97: archived section advertises data-garage-archived-list-size="1"',
    slice.includes('data-garage-archived-list-size="1"'));
  expect('S97: archived item carries data-vehicle-archived="true"',
    slice.includes('data-vehicle-archived="true"'));
  expect('S97: archived item model "Kia Sportage" rendered',
    slice.includes('Kia Sportage'));
  expect('S97: restore button #pf2-garage-restore-real-2 rendered',
    slice.includes('id="pf2-garage-restore-real-2"'));
  expect('S97: restore confirm row #pf2-garage-restore-confirm-row-real-2 rendered',
    slice.includes('id="pf2-garage-restore-confirm-row-real-2"'));
  expect('S97: restore confirm row starts data-garage-restore-confirm-state="idle"',
    slice.includes('data-garage-restore-confirm-state="idle"'));
  expect('S97: restore confirm title "Вернуть авто?" rendered',
    slice.includes('Вернуть авто?'));
  expect('S97: restore confirm helper text rendered',
    slice.includes('Авто снова появится в гараже'));
  expect('S97: restore primary "Вернуть" button id rendered',
    slice.includes('id="pf2-garage-restore-confirm-real-2"'));
  // Archived must NOT be in the active-card list.
  expect('S97: archived real-2 NOT rendered as an active garage card',
    !/<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="real-2"/.test(slice));
}

// ── Scenario 98 — Open + cancel restore: no storage write, button label
// restored to "Вернуть", confirm row hidden. ─────────────────────────────
{
  const section = captureSection('#/profile');
  // Open the restore confirm row.
  clickHandlers.get('#pf2-garage-restore-real-2')?.();
  const confirmRow = section.querySelector('#pf2-garage-restore-confirm-row-real-2');
  const confirmFinal = section.querySelector('#pf2-garage-restore-confirm-real-2');
  expect('S98: restore confirm row opens (data-garage-restore-confirm-state="open")',
    confirmRow.dataset.garageRestoreConfirmState === 'open');
  // Sentinel to prove cancel handler explicitly resets the label.
  confirmFinal.textContent = '__sentinel__';
  confirmFinal.disabled = true;
  const before = snapshotLocalStorage();
  clickHandlers.get('#pf2-garage-restore-cancel-real-2')?.();
  const after = snapshotLocalStorage();
  expect('S98: cancel does NOT mutate localStorage',
    before === after);
  expect('S98: cancel hides the confirm row',
    confirmRow.hidden === true && confirmRow.dataset.garageRestoreConfirmState === 'idle');
  expect('S98: cancel restores the "Вернуть" label on the confirm button',
    confirmFinal.textContent === 'Вернуть');
  expect('S98: cancel re-enables the confirm button',
    confirmFinal.disabled === false);
  // Vehicle stays archived.
  expect('S98: vehicle stays archived after cancel',
    user.get().driverGarage?.vehicles?.[1]?.archived === true);
}

// ── Scenario 99 — Full restore-flow click path: open → confirm → real
// write, archived flag stripped, archivedCount decreases. ────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted', archived: true },
    ],
  },
});
{
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-restore-real-2')?.();
  clickHandlers.get('#pf2-garage-restore-confirm-real-2')?.();
  const persisted = user.get().driverGarage?.vehicles;
  expect('S99: real-2 archived flag stripped via click flow',
    !('archived' in (persisted?.[1] || {})));
  expect('S99: activeVehicleId preserved across restore click flow (still real-1)',
    user.get().driverGarage?.activeVehicleId === 'real-1');
  const slice = garageSlice(renderProfile('#/profile'));
  // Post-restore: active list has both real-1 and real-2.
  expect('S99: post-restore render has 2 vehicles in the active list',
    slice.includes('data-garage-collection-size="2"'));
  expect('S99: real-2 now appears as an active garage card',
    /<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="real-2"/.test(slice));
  // Archived section + hint disappear when no archived vehicles remain.
  expect('S99: archived section gone after the only archived was restored',
    !slice.includes('id="pf2-garage-archived-section"'));
  expect('S99: archived hint gone after the only archived was restored',
    !slice.includes('В архиве:'));
  expect('S99: data-garage-archived-count="0" on the section root',
    slice.includes('data-garage-archived-count="0"'));
}

// ── Scenario 100 — Active badge stays on activeVehicleId throughout
// restore — restore never promotes a vehicle to active. ─────────────────
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S100: real-1 still has the active badge (activeVehicleId pinned)',
    slice.includes('id="pf2-garage-active-real-1"'));
  expect('S100: real-2 renders as a make-active candidate (NOT active)',
    slice.includes('id="pf2-garage-make-active-real-2"'));
  expect('S100: real-2 does NOT have the active-current span',
    !slice.includes('id="pf2-garage-active-real-2"'));
}

// ── Scenario 101 — Defensive helper coverage: unknown / whitespace /
// null id rejected. Synthesised-id fallback. ─────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { model: 'Solo', archived: true },  // id-less raw entry; resolver synthesises garage-1
      { id: ' real-2 ', model: 'Padded', archived: true },
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  expect('S101: unknown id returns null',
    restoreFn('does-not-exist') === null);
  expect('S101: whitespace-only id returns null',
    restoreFn('   ') === null);
  expect('S101: null id returns null',
    restoreFn(null) === null);
  // Whitespace-padded incoming id matches the trimmed slot.
  const r1 = restoreFn('  real-2  ');
  expect('S101: trim-aware strict match restores the whitespace-padded slot',
    r1 === 'real-2');
  expect('S101: real-2 archived flag stripped',
    user.get().driverGarage?.vehicles?.[1]?.archived !== true);
  // Synthesised-id fallback routes to the raw id-less slot.
  const r2 = restoreFn('garage-1');
  expect('S101: synthesised-id fallback restores the id-less slot',
    r2 === 'garage-1');
  expect('S101: restored id-less slot now stores id "garage-1"',
    user.get().driverGarage?.vehicles?.[0]?.id === 'garage-1');
  expect('S101: out-of-range garage-99 returns null',
    restoreFn('garage-99') === null);
}

// ── Scenario 102 — Restore the materialised legacy-1 (from 05I Codex P2
// legacy materialisation): the legacy fallback no longer suppresses and
// legacy-1 reappears in the active list. ─────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'legacy-1', model: 'Hyundai Solaris', color: 'белый', plate: 'А 482 МР 77', source: 'legacy', archived: true },
    ],
  },
});
{
  // Pre-restore: legacy fallback is suppressed by hasArchivedLegacy.
  const sliceBefore = garageSlice(renderProfile('#/profile'));
  expect('S102 pre: pre-restore render is empty (legacy fallback suppressed)',
    sliceBefore.includes('pf2-garage--empty'));
  expect('S102 pre: archived hint shows "В архиве: 1"',
    sliceBefore.includes('В архиве: 1'));

  // Restore.
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  restoreFn('legacy-1');
  const v = user.get().driverGarage?.vehicles?.[0];
  expect('S102: legacy-1 archived flag stripped',
    v?.archived !== true);
  expect('S102: legacy-1 source preserved as "legacy"',
    v?.source === 'legacy');

  // Post-restore render: legacy-1 reappears as an active card.
  const sliceAfter = garageSlice(renderProfile('#/profile'));
  expect('S102: post-restore render shows legacy-1 as an active card',
    /<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="legacy-1"/.test(sliceAfter));
  expect('S102: archived section gone',
    !sliceAfter.includes('id="pf2-garage-archived-section"'));
}

// ── Scenario 103 — Passenger profile guard: archived list / restore
// hooks never render for a passenger. ──────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'passenger',
  firstName: 'Алия', lastName: 'К.',
  phone: '9007654321', phoneVerified: true,
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', archived: true, source: 'persisted' },
    ],
  },
});
{
  const html = renderProfile('#/profile');
  expect('S103: passenger profile does NOT render the archived section',
    !html.includes('id="pf2-garage-archived-section"'));
  expect('S103: passenger profile does NOT expose the restore button',
    !html.includes('id="pf2-garage-restore-'));
}

// ── Scenario 104 — Cross-surface guards: restore writes only to
// bazardrive.user.v1; nothing else drifts. ─────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', archived: true, source: 'persisted' },
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  restoreFn('real-1');
  const FORBIDDEN_KEYS = [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    expect(`S104: ${k} not written by restore`,
      !local.has(k));
  }
  const present = [];
  for (const k of local.keys()) present.push(k);
  expect('S104: only bazardrive.user.v1 was written by restore',
    present.length === 1 && present[0] === 'bazardrive.user.v1',
    present.join(','));
}

// ── Scenario 105 — Static source guard on restoreGarageVehicle body. ───
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const stateSrc = readFileSync(join(projectRoot, 'public/src/state.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const body = sliceFn(stateSrc, 'export function restoreGarageVehicle(');
  expect('S105: restoreGarageVehicle body extracted',
    body.length > 0, String(body.length));
  // Positive: drops archived field.
  expect('S105: restoreGarageVehicle deletes the archived flag',
    /delete\s+\w+\.archived/.test(body));
  // Positive: preserves activeVehicleId verbatim.
  expect('S105: restoreGarageVehicle preserves activeVehicleId verbatim',
    /activeVehicleId\s*:\s*dg\.activeVehicleId/.test(body));
  // Forbidden cross-surface writes.
  const FORBIDDEN = [
    { name: 'saveActiveRide', regex: /\bsaveActiveRide\s*\(/ },
    { name: 'saveRideHistoryEntry', regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder', regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: '"bazardrive.responses.v1"', regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"', regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"', regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"', regex: /bazardrive\.respond\.v1/ },
  ];
  for (const { name, regex } of FORBIDDEN) {
    expect(`S105: restoreGarageVehicle does NOT touch ${name}`, !regex.test(body));
  }
}

// ── Scenario 106 — BD-PROFILE-D-05J Codex P2 #1: duplicate-id restore
// prefers the ARCHIVED match. Without this, the first matching entry
// (which may already be non-archived) would short-circuit the helper
// to a no-op and leave a later archived sibling trapped forever. ────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // Two entries share the id 'dup' — the first is already restored,
      // the second is archived. restoreGarageVehicle('dup') must
      // unarchive the second one, not no-op on the first.
      { id: 'dup', model: 'first',  source: 'persisted' },
      { id: 'dup', model: 'second', source: 'persisted', archived: true },
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  const r = restoreFn('dup');
  expect('S106: restore returns the canonical id even with duplicate matches',
    r === 'dup', String(r));
  const persisted = user.get().driverGarage?.vehicles;
  expect('S106: first matching entry (non-archived) preserved byte-for-byte',
    JSON.stringify(persisted?.[0]) === JSON.stringify({
      id: 'dup', model: 'first', source: 'persisted',
    }));
  expect('S106: archived sibling at index 1 now has archived flag stripped',
    !('archived' in (persisted?.[1] || {})));
  expect('S106: archived sibling model preserved',
    persisted?.[1]?.model === 'second');
  expect('S106: array order preserved (no swap)',
    persisted?.[0]?.model === 'first' && persisted?.[1]?.model === 'second');
  expect('S106: archived sibling source preserved',
    persisted?.[1]?.source === 'persisted');
}

// ── Scenario 107 — BD-PROFILE-D-05J Codex P2 #2: one-car active archive
// → restore must NOT auto-select the restored car. The resolver's
// `_synthesized` marker now grants the null-saved fallback ONLY to the
// inline-synthesised legacy entry; persisted entries (including a
// just-restored one) must wait for an explicit `Сделать активной`. ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  // Pre-state: real-1 is active by explicit selection.
  const sliceBefore = garageSlice(renderProfile('#/profile'));
  expect('S107 pre: real-1 has active badge (active by activeVehicleId match)',
    sliceBefore.includes('id="pf2-garage-active-real-1"'));

  // Archive the only car (active). activeVehicleId cleared to null.
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('real-1');
  expect('S107: archive cleared activeVehicleId to null',
    user.get().driverGarage?.activeVehicleId === null);

  // Restore. activeVehicleId stays null.
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  restoreFn('real-1');
  expect('S107: restore preserved activeVehicleId at null',
    user.get().driverGarage?.activeVehicleId === null);

  // Render: real-1 is back in the active list but NO active badge.
  const sliceAfter = garageSlice(renderProfile('#/profile'));
  expect('S107: post-restore render shows real-1 as a CARD (not in archived list)',
    /<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="real-1"/.test(sliceAfter));
  expect('S107: post-restore render does NOT give real-1 the active-current span',
    !sliceAfter.includes('id="pf2-garage-active-real-1"'));
  expect('S107: post-restore render gives real-1 the make-active button instead',
    sliceAfter.includes('id="pf2-garage-make-active-real-1"'));

  // Resolver-level: resolveActiveGarageVehicle returns null until the
  // user explicitly clicks `Сделать активной`.
  const { resolveActiveGarageVehicle: resolveFn } = await import('../public/src/garage.js');
  expect('S107: resolveActiveGarageVehicle returns null after archive+restore',
    resolveFn(user.get()) === null,
    String(resolveFn(user.get())?.id));

  // Explicit make-active click flow: clicking the make-active button
  // for real-1 sets activeVehicleId='real-1' (via the existing 05D
  // handler) and the next render gives real-1 the active badge.
  // Surface pin so a missing CTA fails before the handler invocation.
  expect('S107 surface: garage renders #pf2-garage-make-active-real-1',
    renderedHtml.includes('id="pf2-garage-make-active-real-1"'));
  clickHandlers.get('#pf2-garage-make-active-real-1')?.();
  expect('S107: make-active set activeVehicleId to "real-1"',
    user.get().driverGarage?.activeVehicleId === 'real-1');
  const sliceActive = garageSlice(renderProfile('#/profile'));
  expect('S107: after explicit make-active, real-1 gets the active-current span',
    sliceActive.includes('id="pf2-garage-active-real-1"'));
  expect('S107: resolveActiveGarageVehicle returns real-1 after explicit make-active',
    resolveFn(user.get())?.id === 'real-1');
}

// ── Scenario 108 — BD-PROFILE-D-05J Codex P2 #2 continued: fresh user
// with legacy fields still gets the synthesised-legacy active fallback.
// This locks down that the new resolver semantic only suppressed the
// first-vehicle fallback for null saved — the `_synthesized` legacy
// path is preserved so fresh users don't lose their auto-active. ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  // no driverGarage.vehicles — pure legacy fallback render
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S108: fresh-user legacy fallback gives legacy-1 the active-current span',
    slice.includes('id="pf2-garage-active-legacy-1"'));
  const { resolveActiveGarageVehicle: resolveFn } = await import('../public/src/garage.js');
  expect('S108: resolveActiveGarageVehicle returns the synthesised legacy entry',
    resolveFn(user.get())?.id === 'legacy-1');
}

// ── Scenario 109 — BD-PROFILE-D-05J Codex P2 #3: archived ids with CSS
// special characters do not crash the restore wiring. The escapeCssId
// helper runs each archived id through CSS.escape (or the Node
// fallback regex) before interpolating into a querySelector. ───────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // Id with whitespace, colon, bracket — all of which would
      // SyntaxError inside an unescaped `#id` selector.
      { id: 'has:colon space', model: 'Pathological', source: 'persisted', archived: true },
    ],
  },
});
{
  // The render must not throw. captureSection wraps `profile()` which
  // calls wireGarageActions internally.
  let renderError = null;
  let section = null;
  try { section = captureSection('#/profile'); } catch (e) { renderError = e; }
  expect('S109: render + wire does NOT throw on a CSS-special-char archived id',
    renderError === null, renderError ? renderError.message : '');

  // HTML carries the literal id (the production page renders the
  // unescaped id in the `id` attribute — only the SELECTOR string is
  // escaped).
  const slice = garageSlice(section._html);
  expect('S109: archived item article has the literal id in the HTML',
    slice.includes('id="pf2-garage-archived-has:colon space"'));
  // The escaped selector path is what the wire calls. Node's stub
  // memoises by selector string; the escaped key is the one that gets
  // a captured handler.
  expect('S109: restore handler captured under the CSS-escaped selector',
    typeof clickHandlers.get('#pf2-garage-restore-has\\:colon\\ space') === 'function');
  expect('S109: cancel handler captured under the CSS-escaped selector',
    typeof clickHandlers.get('#pf2-garage-restore-cancel-has\\:colon\\ space') === 'function');
  expect('S109: confirm handler captured under the CSS-escaped selector',
    typeof clickHandlers.get('#pf2-garage-restore-confirm-has\\:colon\\ space') === 'function');
}

// ── Scenario 110 — BD-PROFILE-GARAGE-ARCHIVE-I2 contract alignment.
// Normal persisted garage with `activeVehicleId: null` resolves to NO
// active vehicle (no silent promotion). The card renders as a make-
// active candidate; the user must explicitly click «Сделать активной»
// to set an active selection. Previously the first-eligible fallback
// silently promoted real-1; the contract now requires explicit
// activation after every archive / add-without-make-active. ──────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // No legacy vehicleMake/Model fields → no synthesised legacy entry
  // can grant the fallback. Under the I2 contract no other branch
  // promotes a persisted vehicle without an explicit make-active.
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S110: persisted real-1 is NOT silently promoted to active',
    !slice.includes('id="pf2-garage-active-real-1"'));
  expect('S110: persisted real-1 renders as a make-active candidate',
    slice.includes('id="pf2-garage-make-active-real-1"'));
  const { resolveActiveGarageVehicle: resolveFn } = await import('../public/src/garage.js');
  expect('S110: resolveActiveGarageVehicle returns null (no explicit active selection)',
    resolveFn(user.get()) === null, String(resolveFn(user.get())?.id));
}

// ── Scenario 111 — BD-PROFILE-D-05J Codex P2 #2 (round 2): synthesised
// `garage-N` restore prefers the raw id-less ARCHIVED slot over a real
// non-archived entry that happens to carry the colliding id. Without
// the prefix, the any-match strict path would lock onto the real entry
// and return idempotently, trapping the raw archived slot forever. ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // raw[0] — id-less archived slot. The resolver materialises it as
      // `garage-1`. The new prefix must restore THIS slot.
      { model: 'Solo', color: 'белый', plate: 'А 111 АА 11', source: 'persisted', archived: true },
      // raw[1] — real entry whose id collides with `garage-1`. Strict
      // matching would lock onto this entry first.
      { id: 'garage-1', model: 'Collider', color: 'чёрный', plate: 'В 222 ВВ 22', source: 'persisted' },
    ],
  },
});
{
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  const r = restoreFn('garage-1');
  expect('S111: restoreGarageVehicle("garage-1") returns the canonical id',
    r === 'garage-1', String(r));
  const persisted = user.get().driverGarage?.vehicles;
  // raw[0] (the id-less archived slot) is the one that got restored:
  // archived flag stripped, id stamped, restoredFromArchive marker set.
  expect('S111: raw[0] (id-less archived) now has id "garage-1"',
    persisted?.[0]?.id === 'garage-1');
  expect('S111: raw[0] is no longer archived',
    !('archived' in (persisted?.[0] || {})));
  expect('S111: raw[0] carries restoredFromArchive: true',
    persisted?.[0]?.restoredFromArchive === true);
  expect('S111: raw[0] preserves its original model "Solo"',
    persisted?.[0]?.model === 'Solo');
  // raw[1] (the real collider) is untouched — its model stays "Collider"
  // and it never gets a restored marker.
  expect('S111: raw[1] (the real "garage-1" collider) preserved byte-for-byte',
    JSON.stringify(persisted?.[1]) === JSON.stringify({
      id: 'garage-1', model: 'Collider', color: 'чёрный', plate: 'В 222 ВВ 22', source: 'persisted',
    }));
}

// ── Scenario 112 — BD-PROFILE-D-05J Codex P3 #1: duplicate archived ids
// are de-duped in `listArchivedGarageVehicles` so the rendered list
// always has unique DOM hooks. The first archived match renders;
// after the user restores it, the next archived sibling surfaces on
// the next render. Sequential clicks restore each duplicate. ─────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // Two archived entries share id 'dup'. The list must de-dupe
      // and surface only one DOM button at a time.
      { id: 'dup', model: 'First',  color: 'белый',   plate: 'А 111 АА 11', source: 'persisted', archived: true },
      { id: 'dup', model: 'Second', color: 'чёрный', plate: 'В 222 ВВ 22', source: 'persisted', archived: true },
    ],
  },
});
{
  const { listArchivedGarageVehicles: listFn } = await import('../public/src/garage.js');
  const listBefore = listFn(user.get());
  expect('S112: archived list is de-duped to length 1 (first archived "dup")',
    Array.isArray(listBefore) && listBefore.length === 1, String(listBefore.length));
  expect('S112: de-duped list keeps the FIRST archived entry (model "First")',
    listBefore[0]?.model === 'First');

  // Render — only one restore button is wired (no duplicate DOM ids).
  const sliceBefore = garageSlice(renderProfile('#/profile'));
  // Count occurrences of the restore-dup id in the markup; should be
  // exactly 1 (otherwise the button hook is shared and the wire is
  // racy).
  const restoreIdMatches = (sliceBefore.match(/id="pf2-garage-restore-dup"/g) || []).length;
  expect('S112: only ONE #pf2-garage-restore-dup id rendered (no duplicate DOM)',
    restoreIdMatches === 1, `count=${restoreIdMatches}`);
  expect('S112: archived hint reports raw count 2 (storage truth)',
    sliceBefore.includes('В архиве: 2'));

  // First click restores the FIRST archived 'dup' (raw[0]).
  clickHandlers.get('#pf2-garage-restore-dup')?.();
  clickHandlers.get('#pf2-garage-restore-confirm-dup')?.();
  expect('S112: after first restore, raw[0] is no longer archived',
    user.get().driverGarage?.vehicles?.[0]?.archived !== true);
  expect('S112: after first restore, raw[1] still archived',
    user.get().driverGarage?.vehicles?.[1]?.archived === true);

  // Next render now surfaces raw[1] (the second 'dup') for restoration.
  const listAfter1 = listFn(user.get());
  expect('S112: after first restore, list length is still 1 (now the second "dup")',
    listAfter1.length === 1);
  expect('S112: surfaced entry is the previously-second archived (model "Second")',
    listAfter1[0]?.model === 'Second');

  // Second click flow restores raw[1].
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-restore-dup')?.();
  clickHandlers.get('#pf2-garage-restore-confirm-dup')?.();
  expect('S112: after second restore, raw[1] is no longer archived',
    user.get().driverGarage?.vehicles?.[1]?.archived !== true);
  // No archived entries remain → list empty.
  const listAfter2 = listFn(user.get());
  expect('S112: after both restores, archived list is empty',
    listAfter2.length === 0);
}

// ── Scenario 113 — BD-PROFILE-D-05J Codex P3 #2: archived id with HTML
// special characters is escaped in attribute contexts. The id can
// contain quotes / angle brackets because `normalisePersistedVehicle`
// only trims it; raw interpolation would break the markup and expose
// an injection surface. ─────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // Pathological id with quote + angle bracket.
      { id: '<bad>"id"', model: 'Pathological', color: 'белый', plate: 'А 123 ВС 77', source: 'persisted', archived: true },
    ],
  },
});
{
  const html = renderProfile('#/profile');
  // The raw `<bad>"id"` form must NOT appear literally — escaping must
  // have transformed it before interpolation.
  expect('S113: raw `<bad>"id"` is NOT in the rendered HTML literally',
    !html.includes('<bad>"id"'));
  // The escaped form WHEN injected into an attribute context.
  expect('S113: HTML-escaped form `&lt;bad&gt;&quot;id&quot;` is present in attribute slots',
    html.includes('&lt;bad&gt;&quot;id&quot;'),
    'expected escaped form to appear in id/data attributes');
  // Render didn't crash. The archived section is rendered.
  expect('S113: archived section was rendered',
    html.includes('id="pf2-garage-archived-section"'));
}

// ── Scenario 114 — BD-PROFILE-D-05J Codex P2 #1 (round 3): the
// `restoredFromArchive` marker is fully transient. Restore stamps it;
// explicit `markGarageVehicleActive` clears it. Without this, a later
// null/stale activeVehicleId would silently skip the restored vehicle
// even after the user had explicitly picked it. ────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  const { restoreGarageVehicle: restoreFn } = await import('../public/src/state.js');
  const { markGarageVehicleActive: markFn } = await import('../public/src/state.js');
  archiveFn('real-1');
  restoreFn('real-1');
  expect('S114: restore stamped the restoredFromArchive marker',
    user.get().driverGarage?.vehicles?.[0]?.restoredFromArchive === true);

  // Explicit activation clears the marker.
  markFn('real-1');
  expect('S114: markGarageVehicleActive set activeVehicleId',
    user.get().driverGarage?.activeVehicleId === 'real-1');
  expect('S114: markGarageVehicleActive stripped the restoredFromArchive marker',
    !('restoredFromArchive' in (user.get().driverGarage?.vehicles?.[0] || {})));

  // Simulate a later null saved id (e.g., archive of a different
  // vehicle elsewhere clearing the active selection). Under the
  // BD-PROFILE-GARAGE-ARCHIVE-I2 contract alignment, no silent
  // promotion fires — resolveActiveGarageVehicle returns null and the
  // user must explicitly re-pick.
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: null } });
  const { resolveActiveGarageVehicle: resolveFn } = await import('../public/src/garage.js');
  expect('S114: post-clear marker, null-saved resolver returns null (no silent promotion)',
    resolveFn(user.get()) === null,
    String(resolveFn(user.get())?.id));
}

// ── Scenario 115 — BD-PROFILE-D-05J Codex P2 #2 (round 3): restore via
// the archived list's `_rawIdx` targets the SLOT the user saw, even
// when an earlier raw entry shares the id but was dropped from the
// visible list (no model → `normalisePersistedVehicle` returns null). ──
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // raw[0] — id 'dup', but no model → dropped from the visible
      // archived list. Without the rawIdx prefer, archived-preferring
      // strict would lock onto THIS slot first.
      { id: 'dup', archived: true, source: 'persisted' },
      // raw[1] — id 'dup' WITH a model → the only entry the user
      // sees in the archived list. The restore must target this one.
      { id: 'dup', model: 'Visible', color: 'серый', plate: 'В 456 КМ 77', source: 'persisted', archived: true },
    ],
  },
});
{
  const { listArchivedGarageVehicles: listFn } = await import('../public/src/garage.js');
  const visible = listFn(user.get());
  expect('S115: archived list has 1 visible entry (modelless raw[0] dropped)',
    visible.length === 1 && visible[0]?.model === 'Visible',
    `length=${visible.length} model=${visible[0]?.model}`);
  expect('S115: visible entry carries _rawIdx=1 (its source raw index)',
    visible[0]?._rawIdx === 1, String(visible[0]?._rawIdx));

  // Click the rendered restore button → handler passes `_rawIdx: 1`.
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-restore-dup')?.();
  clickHandlers.get('#pf2-garage-restore-confirm-dup')?.();

  const persisted = user.get().driverGarage?.vehicles;
  // raw[1] (the visible one) is what got restored.
  expect('S115: raw[1] (visible) is no longer archived',
    persisted?.[1]?.archived !== true);
  expect('S115: raw[1] carries the restoredFromArchive marker',
    persisted?.[1]?.restoredFromArchive === true);
  expect('S115: raw[1] preserved the model "Visible"',
    persisted?.[1]?.model === 'Visible');
  // raw[0] (invisible, modelless) is left alone.
  expect('S115: raw[0] (invisible) is STILL archived (untouched)',
    persisted?.[0]?.archived === true);
  expect('S115: raw[0] did NOT receive a restoredFromArchive marker',
    !('restoredFromArchive' in (persisted?.[0] || {})));
}

// ── Scenario 116 — BD-PROFILE-D-05J Codex P2 #3 (round 3): after a
// restore, the active-card render of a CSS-special-char id wires
// every action control through `escapeCssId`. Without escaping, the
// very first `querySelector` in `wireGarageActions` would throw and
// orphan the rest of the active-card handlers for that vehicle. ────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'wild:id space', model: 'Pathological', color: 'белый', plate: 'А 999 ВВ 99', source: 'persisted', archived: true },
    ],
  },
});
{
  // Restore it via the rendered confirm flow. The post-restore active
  // card has an id with CSS-special chars; wiring must not throw.
  renderProfile('#/profile');
  let restoreError = null;
  try {
    clickHandlers.get('#pf2-garage-restore-wild\\:id\\ space')?.();
    clickHandlers.get('#pf2-garage-restore-confirm-wild\\:id\\ space')?.();
  } catch (e) { restoreError = e; }
  expect('S116: restore click flow did NOT throw on CSS-special id',
    restoreError === null, restoreError ? restoreError.message : '');
  expect('S116: archived flag stripped on the CSS-special-id vehicle',
    !('archived' in (user.get().driverGarage?.vehicles?.[0] || {})));

  // Re-render: the entry is now an active card. wireGarageActions
  // queries each per-vehicle selector through escapeCssId, so the
  // handlers land on the right elements and the smoke's stub
  // captures them under the escaped selector strings.
  let renderError = null;
  try { renderProfile('#/profile'); } catch (e) { renderError = e; }
  expect('S116: post-restore active-card render did NOT throw',
    renderError === null, renderError ? renderError.message : '');
  expect('S116: edit handler captured under CSS-escaped selector for the restored vehicle',
    typeof clickHandlers.get('#pf2-garage-edit-wild\\:id\\ space') === 'function');
  expect('S116: make-active handler captured under CSS-escaped selector',
    typeof clickHandlers.get('#pf2-garage-make-active-wild\\:id\\ space') === 'function');
  expect('S116: archive handler captured under CSS-escaped selector',
    typeof clickHandlers.get('#pf2-garage-archive-wild\\:id\\ space') === 'function');
}

// ── Scenario 117 — BD-PROFILE-D-05J Codex P2 #1 (round 4): the
// markGarageVehicleActive lookup is now marker-preferring, so the
// duplicate-id case where ONE of the matching entries carries the
// `restoredFromArchive` marker still gets its marker cleared.
// Without the marker preference, the strict-only findIndex would
// lock onto the first matching entry (raw[0]) and leave raw[1]'s
// marker stranded. ───────────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      // raw[0] — id 'dup', NO marker. Without marker preference, the
      // strict-only lookup would find this entry first and skip the
      // marker-clear branch.
      { id: 'dup', model: 'Clean', source: 'persisted' },
      // raw[1] — id 'dup' WITH marker. The marker-preferring strict
      // must find this entry and clear the marker.
      { id: 'dup', model: 'Restored', source: 'persisted', restoredFromArchive: true },
    ],
  },
});
{
  const { markGarageVehicleActive: markFn } = await import('../public/src/state.js');
  markFn('dup');
  const persisted = user.get().driverGarage?.vehicles;
  expect('S117: marker-preferring lookup cleared the marker on raw[1]',
    !('restoredFromArchive' in (persisted?.[1] || {})));
  expect('S117: raw[0] (no-marker duplicate) preserved byte-for-byte',
    JSON.stringify(persisted?.[0]) === JSON.stringify({
      id: 'dup', model: 'Clean', source: 'persisted',
    }));
  expect('S117: activeVehicleId set to "dup"',
    user.get().driverGarage?.activeVehicleId === 'dup');
}

// ── Scenario 118 — Round 4 strengthening of S115: after restoring the
// visible duplicate via _rawIdx, the post-restore render surfaces the
// restored entry as an active-list "available" card (NOT active —
// restoredFromArchive marker still blocks the null-saved fallback). ─────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'dup', archived: true, source: 'persisted' },  // invisible (no model)
      { id: 'dup', model: 'Visible', color: 'серый', plate: 'В 456 КМ 77', source: 'persisted', archived: true },
    ],
  },
});
{
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-restore-dup')?.();
  clickHandlers.get('#pf2-garage-restore-confirm-dup')?.();
  const slice = garageSlice(renderProfile('#/profile'));
  // The visible card is now in the active list as an "available" card
  // (no active badge — restoredFromArchive marker blocks the
  // null-saved first-eligible fallback).
  expect('S118: post-restore render shows the Visible card as an active-list card',
    /<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="dup"/.test(slice));
  expect('S118: Visible card does NOT carry the active-current span (marker blocks fallback)',
    !slice.includes('id="pf2-garage-active-dup"'));
  expect('S118: Visible card renders the make-active button (status: available)',
    slice.includes('id="pf2-garage-make-active-dup"'));
  // raw[0] (modelless invisible) still archived → archived section
  // remains rendered with one entry (the invisible one is dropped from
  // the visible list but the count hint still sees it).
  expect('S118: archived section gone (no renderable archived entries left)',
    !slice.includes('id="pf2-garage-archived-section"'));
  expect('S118: archived COUNT hint still reflects raw[0] storage truth',
    slice.includes('В архиве: 1'));
}

// ── Scenario 119 — Round 4 strengthening of S116: every active-card
// per-vehicle selector survives a CSS-special-char id after restore.
// Covers edit / make-active / archive / confirm row / cancel / final
// confirm — the brief's audit list. ─────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'a:b?x]', model: 'AuditAll', color: 'белый', plate: 'А 999 ВВ 99', source: 'persisted', archived: true },
    ],
  },
});
{
  renderProfile('#/profile');
  clickHandlers.get('#pf2-garage-restore-a\\:b\\?x\\]')?.();
  clickHandlers.get('#pf2-garage-restore-confirm-a\\:b\\?x\\]')?.();
  let renderError = null;
  try { renderProfile('#/profile'); } catch (e) { renderError = e; }
  expect('S119: post-restore active-card render did NOT throw on "a:b?x]"',
    renderError === null, renderError ? renderError.message : '');
  // Audit every per-vehicle active-card selector from the brief.
  const escaped = 'a\\:b\\?x\\]';
  expect('S119: edit selector wired',
    typeof clickHandlers.get(`#pf2-garage-edit-${escaped}`) === 'function');
  expect('S119: make-active selector wired',
    typeof clickHandlers.get(`#pf2-garage-make-active-${escaped}`) === 'function');
  expect('S119: archive selector wired',
    typeof clickHandlers.get(`#pf2-garage-archive-${escaped}`) === 'function');
  expect('S119: archive-cancel selector wired',
    typeof clickHandlers.get(`#pf2-garage-archive-cancel-${escaped}`) === 'function');
  expect('S119: archive-confirm (final) selector wired',
    typeof clickHandlers.get(`#pf2-garage-archive-confirm-${escaped}`) === 'function');
  // The confirm row itself isn't a click target but should still be
  // queryable without a SyntaxError — proven by the no-throw render
  // above (wireGarageActions assigns it via querySelector during the
  // active-card iteration).
}

// ── Scenario 120 — BD-PROFILE-D-05J-MA-S markGarageVehicleActive
// source guard parity. S105 source-pins `restoreGarageVehicle`; this
// mirrors that coverage onto the SIBLING writer
// `markGarageVehicleActive` so a future revert that smuggles a
// cross-surface call (active-ride / receipt / history / responses)
// or a raw localStorage write into the make-active path is caught at
// the source level too. No runtime change — pure static scan. ────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const stateSrc = readFileSync(join(projectRoot, 'public/src/state.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const body = sliceFn(stateSrc, 'export function markGarageVehicleActive(');
  expect('S120: markGarageVehicleActive body extracted',
    body.length > 0, String(body.length));

  // Positive pins — these encode the documented contract shape: trim
  // incoming id, refuse blank, route the chosen id into activeVehicleId,
  // clear the restoredFromArchive marker on activation, and preserve
  // the vehicles collection through the local `nextVehicles` slot.
  expect('S120: incoming vehicleId is trimmed into targetId',
    /const\s+targetId\s*=\s*[^;]*\bvehicleId\b[^;]*\.trim\s*\(\s*\)/.test(body));
  expect('S120: blank targetId returns null',
    /if\s*\(\s*!\s*targetId\s*\)\s*return\s+null/.test(body));
  expect('S120: activeVehicleId is set to targetId on persist',
    /activeVehicleId\s*:\s*targetId\b/.test(body));
  expect('S120: restoredFromArchive marker is deleted on activation',
    /delete\s+\w+\.restoredFromArchive\b/.test(body));
  expect('S120: vehicles collection is persisted via nextVehicles',
    /vehicles\s*:\s*nextVehicles\b/.test(body));

  // Comment-stripped scan target for the forbidden-token sweep — an
  // explanatory comment that mentions a forbidden symbol must not
  // false-positive against this helper.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const bodyNoComments = stripComments(body);

  // Cross-surface forbidden calls + storage keys — markGarageVehicleActive
  // owns ONLY the driverGarage slice; it must never reach into the
  // active-ride, receipt, history, or response stores.
  const FORBIDDEN = [
    { name: 'saveActiveRide',           regex: /\bsaveActiveRide\s*\(/ },
    { name: 'saveRideHistoryEntry',     regex: /\bsaveRideHistoryEntry\s*\(/ },
    { name: 'createRideOrder',          regex: /\bcreateRideOrder\s*\(/ },
    { name: 'acceptCanonicalRideOrder', regex: /\bacceptCanonicalRideOrder\s*\(/ },
    { name: '"bazardrive.responses.v1"',       regex: /bazardrive\.responses\.v1/ },
    { name: '"bazardrive.active_ride.v1"',     regex: /bazardrive\.active_ride\.v1/ },
    { name: '"bazardrive.ride_history.v1"',    regex: /bazardrive\.ride_history\.v1/ },
    { name: '"bazardrive.driver_receipts.v1"', regex: /bazardrive\.driver_receipts\.v1/ },
    { name: '"bazardrive.respond.v1"',         regex: /bazardrive\.respond\.v1/ },
  ];
  for (const { name, regex } of FORBIDDEN) {
    expect(`S120: markGarageVehicleActive does NOT touch ${name}`,
      !regex.test(bodyNoComments));
  }
  // Raw storage writes — the canonical writer is `persist()`; the
  // helper must not bypass it via direct localStorage/sessionStorage.
  expect('S120: markGarageVehicleActive does NOT call localStorage.setItem directly',
    !/\blocalStorage\s*\.\s*setItem\s*\(/.test(bodyNoComments));
  expect('S120: markGarageVehicleActive does NOT call sessionStorage.setItem directly',
    !/\bsessionStorage\s*\.\s*setItem\s*\(/.test(bodyNoComments));
}

// ── Scenario 121 — BD-PROFILE-D-05J-WIRE-S garage selector wiring
// source guard. S109 / S116 / S119 already exercise CSS-special
// garage ids through real DOM stubs (restore selectors, every active-
// card per-vehicle selector after restore). This pins the SHAPE of
// `wireGarageActions` in public/src/screens/profile.js so a future
// refactor that re-introduces a raw `${id}` interpolation (bypassing
// `escapeCssId`) is caught at the source level. ────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc = readFileSync(join(projectRoot, 'public/src/screens/profile.js'), 'utf8');

  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const body = sliceFn(profileSrc, 'function wireGarageActions(');
  expect('S121: wireGarageActions body extracted',
    body.length > 0, String(body.length));

  // Codex P3 review fix — strip comments BEFORE the positive pins so a
  // commented-out selector example (e.g. a "// TODO replace
  // `…${eid}` …" line) cannot satisfy a required positive shape pin
  // while the runtime selector that actually drove the helper was
  // deleted or rewritten with a raw interpolation.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const bodyCode = stripComments(body);

  // Positive pins — active-list per-vehicle loop. Every active-card
  // selector inside the loop must funnel through `escapeCssId(id)`.
  expect('S121: active loop declares `const eid = escapeCssId(id)`',
    /const\s+eid\s*=\s*escapeCssId\(\s*id\s*\)/.test(bodyCode));
  expect('S121: active loop edit selector uses `#pf2-garage-edit-${eid}`',
    /querySelector\(\s*`#pf2-garage-edit-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: active loop make-active selector uses `#pf2-garage-make-active-${eid}`',
    /querySelector\(\s*`#pf2-garage-make-active-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: active loop archive selector uses `#pf2-garage-archive-${eid}`',
    /querySelector\(\s*`#pf2-garage-archive-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: active loop confirm row selector uses `#pf2-garage-confirm-${eid}`',
    /querySelector\(\s*`#pf2-garage-confirm-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: active loop archive-cancel selector uses `#pf2-garage-archive-cancel-${eid}`',
    /querySelector\(\s*`#pf2-garage-archive-cancel-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: active loop archive-final-confirm selector uses `#pf2-garage-archive-confirm-${eid}`',
    /querySelector\(\s*`#pf2-garage-archive-confirm-\$\{eid\}`\s*\)/.test(bodyCode));

  // Positive pins — archived-list per-vehicle loop. Same invariant
  // for the restore selector family; the archived loop iterates `aid`
  // (archived id) instead of `id`.
  expect('S121: archived loop declares `const eid = escapeCssId(aid)`',
    /const\s+eid\s*=\s*escapeCssId\(\s*aid\s*\)/.test(bodyCode));
  expect('S121: archived loop restore selector uses `#pf2-garage-restore-${eid}`',
    /querySelector\(\s*`#pf2-garage-restore-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: archived loop restore-confirm-row selector uses `#pf2-garage-restore-confirm-row-${eid}`',
    /querySelector\(\s*`#pf2-garage-restore-confirm-row-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: archived loop restore-cancel selector uses `#pf2-garage-restore-cancel-${eid}`',
    /querySelector\(\s*`#pf2-garage-restore-cancel-\$\{eid\}`\s*\)/.test(bodyCode));
  expect('S121: archived loop restore-final-confirm selector uses `#pf2-garage-restore-confirm-${eid}`',
    /querySelector\(\s*`#pf2-garage-restore-confirm-\$\{eid\}`\s*\)/.test(bodyCode));

  // Negative pin — no per-vehicle pf2-garage selector inside the
  // function body may interpolate the RAW `${id}` or `${aid}` (with or
  // without whitespace inside the template hole, so a stylistic
  // `${ id }` / `${ aid }` is caught too). Strips comments first so
  // explanatory comments naming the raw form (e.g. "do NOT use
  // `#pf2-garage-edit-${id}` here") do not false-positive against the
  // scan target.
  const RAW_ID_OR_AID = '\\$\\{\\s*(?:id|aid)\\s*\\}';
  const RAW_PATTERNS = [
    new RegExp('`#pf2-garage-edit-'                + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-make-active-'         + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-archive-'             + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-archive-cancel-'      + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-archive-confirm-'     + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-confirm-'             + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-restore-'             + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-restore-confirm-row-' + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-restore-cancel-'      + RAW_ID_OR_AID + '`'),
    new RegExp('`#pf2-garage-restore-confirm-'     + RAW_ID_OR_AID + '`'),
  ];
  for (const re of RAW_PATTERNS) {
    expect(
      `S121: wireGarageActions has NO raw \${id}/\${aid} interpolation for ${re.source}`,
      !re.test(bodyCode));
  }
}

// ── BD-PROFILE-GARAGE-ARCHIVE-I2 — contract-alignment smoke block ─────────
// Task A–F: docs pins + active-archive render guard + resolver no-active
// pin + archived-hidden guard + legacy-non-resurrection guard +
// cross-surface guard + non-scope source guard on garage.js.

// ── Scenario 122 (Task A) — docs/screen-contracts.md carries the I2
// contract phrases. Row-scoped scan via the section heading so unrelated
// rows that legitimately mention any of these phrases don't false-
// positive against the alignment section. ───────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const contracts = readFileSync(join(projectRoot, 'docs/screen-contracts.md'), 'utf8');
  const startIdx = contracts.indexOf('### BD-PROFILE-GARAGE-ARCHIVE-I2');
  const endIdx = startIdx >= 0 ? contracts.indexOf('### ', startIdx + 1) : -1;
  const section = startIdx >= 0
    ? contracts.slice(startIdx, endIdx > 0 ? endIdx : undefined)
    : '';
  expect('S122: BD-PROFILE-GARAGE-ARCHIVE-I2 section located in screen-contracts.md',
    section.length > 0, String(section.length));
  const REQUIRED_PHRASES = [
    'clears `activeVehicleId`',                   // archive clears active id
    'No silent promotion',                        // no-silent-promotion field name
    'active garage list',                         // archived hidden from default list
    'Legacy fallback non-resurrection',           // legacy materialisation behavior
    'BD-PROFILE-GARAGE-READY-K',                  // documents/readiness bridge slice
  ];
  for (const phrase of REQUIRED_PHRASES) {
    expect(`S122: I2 section contains "${phrase}"`,
      section.includes(phrase));
  }
  // Negative pin — the section must NOT say active-vehicle archive is
  // forbidden (the shipped contract allows it; the helper clears
  // activeVehicleId rather than refusing).
  expect('S122: I2 section does NOT say active vehicle archive is forbidden',
    !/forbid(s|den)\s+(?:archiv|active|the active)/i.test(section));
}

// ── Scenario 123 (Task B + B2 + C) — Active archive render guard +
// resolver no-active guard + archived-hidden guard. Seed real-1 active +
// real-2 non-active, archive real-1, then assert:
//   • real-1 is soft-archived,
//   • activeVehicleId is cleared by the helper,
//   • real-2 is NOT silently promoted,
//   • no active badge anywhere,
//   • real-2 renders as a make-active candidate,
//   • buildGarageVehicles has no vehicle with status === 'active',
//   • resolveActiveGarageVehicle returns null,
//   • resolveActiveGarageVehicleId returns null,
//   • archived real-1 does not appear in the active list. ─────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('real-1');
  expect('S123: archived real-1 carries archived: true',
    user.get().driverGarage?.vehicles?.[0]?.archived === true);
  expect('S123: activeVehicleId cleared to null by the active-archive helper',
    user.get().driverGarage?.activeVehicleId === null);
  // Resolver (B2).
  const { buildGarageVehicles, resolveActiveGarageVehicle, resolveActiveGarageVehicleId }
    = await import('../public/src/garage.js');
  const vehicles = buildGarageVehicles(user.get());
  expect('S123: buildGarageVehicles has no vehicle with status === "active"',
    vehicles.every((v) => v.status !== 'active'),
    vehicles.map((v) => `${v.id}=${v.status}`).join(','));
  const real2 = vehicles.find((v) => v.id === 'real-2');
  expect('S123: real-2 status === "available" in the rebuilt collection',
    real2?.status === 'available', String(real2?.status));
  expect('S123: resolveActiveGarageVehicle returns null (no silent promotion)',
    resolveActiveGarageVehicle(user.get()) === null,
    String(resolveActiveGarageVehicle(user.get())?.id));
  expect('S123: resolveActiveGarageVehicleId returns null',
    resolveActiveGarageVehicleId(user.get(), vehicles) === null,
    String(resolveActiveGarageVehicleId(user.get(), vehicles)));
  // Render (B + C).
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S123: render emits no active-current span anywhere',
    !/id="pf2-garage-active-/.test(slice));
  expect('S123: real-2 renders as a make-active candidate',
    slice.includes('id="pf2-garage-make-active-real-2"'));
  expect('S123: archived real-1 is NOT in the active list',
    !/<article class="pf2-garage__car[^"]*"[^>]*data-vehicle="real-1"/.test(slice));
  expect('S123: archived real-1 has no make-active button',
    !slice.includes('id="pf2-garage-make-active-real-1"'));
  expect('S123: archived count surfaces "В архиве: 1" hint',
    slice.includes('В архиве: 1'));
}

// ── Scenario 124 (Task D) — Legacy fallback non-resurrection guard.
// Archive the synthesised legacy fallback; the next render must NOT
// resurrect a `legacy-1` active card from the legacy user fields.
// Re-asserts the shipped 05I materialisation pin under the I2
// contract-alignment label. ──────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  // intentionally no driverGarage.vehicles — pure legacy fallback render
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('legacy-1');
  const persisted = user.get().driverGarage?.vehicles;
  expect('S124: archived legacy materialised into driverGarage.vehicles',
    Array.isArray(persisted) && persisted.length === 1 && persisted[0].archived === true);
  // Legacy user fields preserved verbatim.
  expect('S124: legacy vehicleMake preserved on the user record',
    user.get().vehicleMake === 'Hyundai');
  expect('S124: legacy vehicleModel preserved on the user record',
    user.get().vehicleModel === 'Solaris');
  expect('S124: legacy vehiclePlate preserved on the user record',
    user.get().vehiclePlate === 'А 482 МР 77');
  // Re-render: legacy does NOT resurrect as an active card.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S124: re-render does NOT resurrect a legacy-1 active card',
    !slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S124: re-render carries the empty-state modifier',
    slice.includes('pf2-garage--empty'));
  expect('S124: re-render advertises data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
}

// ── Scenario 124b — BD-PROFILE-GARAGE-ARCHIVE-I2 Codex P2: block legacy
// fallback after archiving the only persisted car. The previous
// buildGarageVehicles condition (`raw.length === 0 && !hasArchivedLegacy`)
// mis-fired when the user had a real persisted garage and archived
// every entry — the next render synthesised a `legacy-1` active card
// from the preserved `vehicleMake / Model / Color / Plate` fields,
// resurrecting a car the user had effectively retired. The new check
// is `rawAll.length === 0`, so any persisted record (even all-archived)
// suppresses the legacy fallback. ──────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер', displayName: 'Иван Драйвер',
  phone: '9001234567', phoneVerified: true,
  // Legacy fields preserved on the user record — would otherwise drive
  // the resurrection if the fallback fired.
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  archiveFn('real-1');
  // Legacy user fields preserved across archive.
  expect('S124b: legacy vehicleMake preserved (NOT wiped by archive)',
    user.get().vehicleMake === 'Hyundai');
  expect('S124b: legacy vehiclePlate preserved (NOT wiped by archive)',
    user.get().vehiclePlate === 'А 482 МР 77');
  // Re-render: no legacy resurrection.
  const slice = garageSlice(renderProfile('#/profile'));
  expect('S124b: re-render does NOT resurrect a legacy-1 active card',
    !slice.includes('id="pf2-garage-active-legacy-1"'));
  expect('S124b: re-render emits no active-current span anywhere',
    !/id="pf2-garage-active-/.test(slice));
  expect('S124b: re-render carries the empty-state modifier',
    slice.includes('pf2-garage--empty'));
  // Archived hint surfaces from the persisted record.
  expect('S124b: re-render advertises data-garage-archived-count="1"',
    slice.includes('data-garage-archived-count="1"'));
  expect('S124b: re-render shows "В архиве: 1" hint',
    slice.includes('В архиве: 1'));
  // Resolver-level: no active vehicle either way.
  const { resolveActiveGarageVehicle, buildGarageVehicles }
    = await import('../public/src/garage.js');
  expect('S124b: resolveActiveGarageVehicle returns null (no legacy fallback)',
    resolveActiveGarageVehicle(user.get()) === null,
    String(resolveActiveGarageVehicle(user.get())?.id));
  const list = buildGarageVehicles(user.get());
  expect('S124b: buildGarageVehicles returns [] (every persisted entry is archived; no legacy synthesis)',
    list.length === 0, String(list.length));
}

// ── Scenario 125 (Task F) — Non-scope source guard on public/src/garage.js.
// Aligns with the BD-PROFILE-GARAGE-ARCHIVE-I2 boundary: garage.js stays a
// pure read-only resolver and may not pull in cross-surface or out-of-
// scope modules. ────────────────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const garageSrc = readFileSync(join(projectRoot, 'public/src/garage.js'), 'utf8');
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const garageCode = stripComments(garageSrc);
  // Forbidden module imports / bare references in code (comments
  // legitimately mention some of these symbols for documentation).
  // Codex P2 review on PR #493 — the guard must catch every import
  // syntax, not only `import x from '…'`. Side-effect imports
  // (`import '…';`) and dynamic imports (`await import('…')`) would
  // otherwise slip through and introduce the forbidden dependency
  // while this contract guard reported green.
  const FORBIDDEN_IMPORTS = [
    'mapbox',
    'active_ride',
    'ride_state',
    'trip_receipt',
    'ride_history',
    'screens/respond',
    'driver_offer_store',
    'documents',
    'readiness',
  ];
  const importPatternsFor = (needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [
      // `… from '…<needle>…'` — static named / default imports + re-exports
      new RegExp(`from\\s*['"\`][^'"\`]*${escaped}[^'"\`]*['"\`]`),
      // `import '…<needle>…'` — side-effect imports
      new RegExp(`\\bimport\\s*['"\`][^'"\`]*${escaped}[^'"\`]*['"\`]`),
      // `import('…<needle>…')` — dynamic imports (with optional await)
      new RegExp(`\\bimport\\s*\\(\\s*['"\`][^'"\`]*${escaped}[^'"\`]*['"\`]\\s*\\)`),
    ];
  };
  for (const needle of FORBIDDEN_IMPORTS) {
    const patterns = importPatternsFor(needle);
    const hit = patterns.some((re) => re.test(garageCode));
    expect(`S125: garage.js does NOT import "${needle}" via any import syntax (static / side-effect / dynamic)`,
      !hit);
  }
  // Forbidden runtime calls (cross-surface or out-of-scope writers).
  const FORBIDDEN_CALLS = [
    'saveActiveRide',
    'saveRideHistoryEntry',
    'createRideOrder',
    'acceptCanonicalRideOrder',
    'acceptNearbyOrder',
    'updateTripStatus',
  ];
  for (const fn of FORBIDDEN_CALLS) {
    const pattern = new RegExp(`\\b${fn}\\s*\\(`);
    expect(`S125: garage.js does NOT call ${fn}() (read-only resolver)`,
      !pattern.test(garageCode));
  }
  // Forbidden storage keys.
  const FORBIDDEN_KEYS = [
    'bazardrive.active_ride.v1',
    'bazardrive.responses.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ];
  for (const k of FORBIDDEN_KEYS) {
    const pattern = new RegExp(k.replace(/\./g, '\\.'));
    expect(`S125: garage.js does NOT reference "${k}"`,
      !pattern.test(garageCode));
  }
  // No raw localStorage / sessionStorage writes (canonical writer is
  // owned by state.js).
  expect('S125: garage.js does NOT call localStorage.setItem directly',
    !/\blocalStorage\s*\.\s*setItem\s*\(/.test(garageCode));
  expect('S125: garage.js does NOT call sessionStorage.setItem directly',
    !/\bsessionStorage\s*\.\s*setItem\s*\(/.test(garageCode));
}

// ── BD-PROFILE-GARAGE-READY-K — Driver Garage readiness/documents hook
// foundation. Task A–H matrix: read-only bridge between Garage and the
// future documents implementation. ─────────────────────────────────────

// ── Scenario 126 (Task A) — explicit active vehicle hook ───────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { getGarageReadinessState, resolveGarageReadinessVehicle }
    = await import('../public/src/garage.js');
  const readiness = getGarageReadinessState(user.get());
  expect('S126: readiness state === "active_vehicle"',
    readiness.state === 'active_vehicle', String(readiness.state));
  expect('S126: readiness reason === "explicit_active"',
    readiness.reason === 'explicit_active', String(readiness.reason));
  expect('S126: readiness vehicle.id === "real-1" (the persisted active)',
    readiness.vehicle?.id === 'real-1', String(readiness.vehicle?.id));
  expect('S126: readiness vehicle.model === "Toyota Prius"',
    readiness.vehicle?.model === 'Toyota Prius');
  expect('S126: readiness vehicle.plate === "А 123 ВС 77"',
    readiness.vehicle?.plate === 'А 123 ВС 77');
  expect('S126: resolveGarageReadinessVehicle mirrors getGarageReadinessState.vehicle',
    resolveGarageReadinessVehicle(user.get())?.id === 'real-1');
  // Docs pane render carries the active copy.
  const html = renderProfile('#/profile?role=driver&pane=docs');
  expect('S126: docs pane renders «Документы активного авто»',
    html.includes('Документы активного авто'));
  expect('S126: docs pane shows the active model "Toyota Prius"',
    html.includes('Toyota Prius'));
  expect('S126: docs pane shows the active plate "А 123 ВС 77"',
    html.includes('А 123 ВС 77'));
  expect('S126: docs pane carries data-garage-ready-state="active_vehicle"',
    html.includes('data-garage-ready-state="active_vehicle"'));
  expect('S126: docs pane carries data-garage-ready-reason="explicit_active"',
    html.includes('data-garage-ready-reason="explicit_active"'));
  // real-2 (available) is NOT the document anchor.
  expect('S126: readiness vehicle is NOT real-2 (available sibling)',
    readiness.vehicle?.id !== 'real-2');
}

// ── Scenario 127 (Task B) — no-active hook ─────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  const readiness = getGarageReadinessState(user.get());
  expect('S127: readiness state === "no_active_vehicle"',
    readiness.state === 'no_active_vehicle', String(readiness.state));
  expect('S127: readiness reason === "no_active_selection"',
    readiness.reason === 'no_active_selection', String(readiness.reason));
  expect('S127: readiness vehicle === null',
    readiness.vehicle === null, String(readiness.vehicle?.id));
  const html = renderProfile('#/profile?role=driver&pane=docs');
  expect('S127: docs pane renders «Выберите активное авто»',
    html.includes('Выберите активное авто'));
  expect('S127: docs pane carries data-garage-ready-state="no_active_vehicle"',
    html.includes('data-garage-ready-state="no_active_vehicle"'));
  expect('S127: docs pane carries data-garage-ready-reason="no_active_selection"',
    html.includes('data-garage-ready-reason="no_active_selection"'));
  // No active badge on the garage list either (I2 contract preserved).
  expect('S127: garage render emits no active-current span',
    !/id="pf2-garage-active-/.test(html));
  // The readiness hint section does NOT mention real-1 / real-2 by id.
  // Extract the readiness section and verify.
  const sectionMatch = html.match(/<section[^>]*id="pf2-garage-ready"[\s\S]*?<\/section>/);
  expect('S127: readiness section located in rendered HTML',
    typeof sectionMatch?.[0] === 'string' && sectionMatch[0].length > 0);
  const readinessSlice = sectionMatch?.[0] || '';
  expect('S127: readiness hint does NOT name real-1 as the document anchor',
    !readinessSlice.includes('real-1') && !readinessSlice.includes('Toyota Prius'));
  expect('S127: readiness hint does NOT name real-2 as the document anchor',
    !readinessSlice.includes('real-2') && !readinessSlice.includes('Kia Sportage'));
}

// ── Scenario 128 (Task C) — archived active vehicle clears the anchor ──────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const { archiveGarageVehicle: archiveFn } = await import('../public/src/state.js');
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  archiveFn('real-1');
  expect('S128: activeVehicleId cleared after archiving the active vehicle',
    user.get().driverGarage?.activeVehicleId === null);
  const readiness = getGarageReadinessState(user.get());
  expect('S128: readiness state flips to "no_active_vehicle" after archive',
    readiness.state === 'no_active_vehicle', String(readiness.state));
  expect('S128: readiness reason === "no_active_selection" (real-2 still non-archived)',
    readiness.reason === 'no_active_selection', String(readiness.reason));
  expect('S128: readiness vehicle === null (archived real-1 NOT used as anchor)',
    readiness.vehicle === null, String(readiness.vehicle?.id));
  expect('S128: readiness vehicle is NOT the archived real-1',
    readiness.vehicle?.id !== 'real-1');
  expect('S128: readiness vehicle is NOT the available sibling real-2 (no silent promotion)',
    readiness.vehicle?.id !== 'real-2');
}

// ── Scenario 129 (Task D) — archived-only collection: archived_only reason ──
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // Legacy fields preserved — but the I2 contract suppresses legacy
  // synthesis whenever a persisted record exists.
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted', archived: true },
    ],
  },
});
{
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  const readiness = getGarageReadinessState(user.get());
  expect('S129: readiness state === "no_active_vehicle" (archived-only is NOT empty)',
    readiness.state === 'no_active_vehicle', String(readiness.state));
  expect('S129: readiness reason === "archived_only"',
    readiness.reason === 'archived_only', String(readiness.reason));
  expect('S129: readiness vehicle === null',
    readiness.vehicle === null);
  // Profile render must NOT advertise the legacy car as the active anchor.
  const html = renderProfile('#/profile?role=driver&pane=docs');
  const sectionMatch = html.match(/<section[^>]*id="pf2-garage-ready"[\s\S]*?<\/section>/);
  const readinessSlice = sectionMatch?.[0] || '';
  expect('S129: readiness hint does NOT advertise the legacy car ("Hyundai Solaris")',
    !readinessSlice.includes('Hyundai Solaris'));
  expect('S129: readiness hint carries data-garage-ready-reason="archived_only"',
    readinessSlice.includes('data-garage-ready-reason="archived_only"'));
}

// ── Scenario 130 (Task E) — empty garage → empty_collection ────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // no legacy vehicleMake/Model, no driverGarage.vehicles
});
{
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  const readiness = getGarageReadinessState(user.get());
  expect('S130: readiness state === "empty_garage"',
    readiness.state === 'empty_garage', String(readiness.state));
  expect('S130: readiness reason === "empty_collection"',
    readiness.reason === 'empty_collection', String(readiness.reason));
  expect('S130: readiness vehicle === null',
    readiness.vehicle === null);
  const html = renderProfile('#/profile?role=driver&pane=docs');
  expect('S130: docs pane renders «Добавьте авто»',
    html.includes('Добавьте авто'));
  expect('S130: docs pane carries data-garage-ready-state="empty_garage"',
    html.includes('data-garage-ready-state="empty_garage"'));
  expect('S130: docs pane carries data-garage-ready-reason="empty_collection"',
    html.includes('data-garage-ready-reason="empty_collection"'));
}

// ── Scenario 131 (Task F) — legacy fallback compatibility ──────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  // No persisted garage collection — legacy fallback path.
});
{
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  const beforeRaw = user.get().driverGarage?.vehicles;
  const readiness = getGarageReadinessState(user.get());
  expect('S131: readiness state === "active_vehicle" (legacy is the anchor)',
    readiness.state === 'active_vehicle', String(readiness.state));
  expect('S131: readiness reason === "legacy_fallback"',
    readiness.reason === 'legacy_fallback', String(readiness.reason));
  expect('S131: readiness vehicle.id === "legacy-1"',
    readiness.vehicle?.id === 'legacy-1', String(readiness.vehicle?.id));
  expect('S131: readiness vehicle.source === "legacy"',
    readiness.vehicle?.source === 'legacy', String(readiness.vehicle?.source));
  // No persistence happened on the legacy fallback read.
  const afterRaw = user.get().driverGarage?.vehicles;
  expect('S131: getGarageReadinessState did NOT write driverGarage.vehicles',
    JSON.stringify(beforeRaw) === JSON.stringify(afterRaw));
  const html = renderProfile('#/profile?role=driver&pane=docs');
  expect('S131: docs pane shows the legacy model "Hyundai Solaris" as the active anchor',
    html.includes('Hyundai Solaris'));
  expect('S131: docs pane carries data-garage-ready-reason="legacy_fallback"',
    html.includes('data-garage-ready-reason="legacy_fallback"'));
  // Re-confirm no persistence after the full render either.
  const afterRender = user.get().driverGarage?.vehicles;
  expect('S131: profile render did NOT persist a legacy entry into driverGarage.vehicles',
    JSON.stringify(beforeRaw) === JSON.stringify(afterRender));
}

// ── Scenario 132 (Task G) — cross-surface guard for the READY-K path. The
// existing S84 covers archive helper writes; this scenario covers the
// readiness-state read itself. After exercising every reachable readiness
// branch, no forbidden cross-surface key is present in localStorage. ───
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
    ],
  },
});
{
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  const before = snapshotLocalStorage();
  // Exercise every state via direct reads.
  getGarageReadinessState(user.get());
  // No-active branch.
  const cur = user.get().driverGarage || {};
  user.set({ driverGarage: { ...cur, activeVehicleId: null } });
  getGarageReadinessState(user.get());
  // Render the docs pane through the full profile() call.
  renderProfile('#/profile?role=driver&pane=docs');
  const after = snapshotLocalStorage();
  // No-active resolver read + render should not have written cross-surface keys.
  for (const k of [
    'bazardrive.responses.v1',
    'bazardrive.active_ride.v1',
    'bazardrive.ride_history.v1',
    'bazardrive.driver_receipts.v1',
    'bazardrive.respond.v1',
  ]) {
    expect(`S132: ${k} not written by READY-K reads / docs pane render`,
      !local.has(k), String(local.get(k)));
  }
  // The cross-surface key checks above are the load-bearing pin. We
  // intentionally do NOT byte-equal localStorage here because the smoke
  // harness called user.set() to flip activeVehicleId for the no-active
  // branch — that's a TEST-HARNESS write to bazardrive.user.v1, not a
  // READY-K helper write. The forbidden-key sweep already proves the
  // READY-K reads stay off the active-ride / responses / history /
  // receipts / respond surfaces.
  expect('S132: only bazardrive.user.v1 was touched (no cross-surface key entered storage)',
    Array.from(local.keys()).every((k) => k === 'bazardrive.user.v1'),
    Array.from(local.keys()).join(','));
  void before; void after;
}

// ── Scenario 133 (Task H) — source-level guard on the READY-K helpers. The
// READY-K helper bodies must not call writers, document writers, score
// helpers, or upload helpers. They must not reference cross-surface
// storage keys either. ─────────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const garageSrc = readFileSync(join(projectRoot, 'public/src/garage.js'), 'utf8');
  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const stateBody = sliceFn(garageSrc, 'export function getGarageReadinessState(');
  const vehicleBody = sliceFn(garageSrc, 'export function resolveGarageReadinessVehicle(');
  expect('S133: getGarageReadinessState body extracted',
    stateBody.length > 0, String(stateBody.length));
  expect('S133: resolveGarageReadinessVehicle body extracted',
    vehicleBody.length > 0, String(vehicleBody.length));
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const stateCode = stripComments(stateBody);
  const vehicleCode = stripComments(vehicleBody);
  const FORBIDDEN = [
    'user.set',
    'localStorage.setItem',
    'sessionStorage.setItem',
    'archiveGarageVehicle',
    'restoreGarageVehicle',
    'markGarageVehicleActive',
    'appendGarageVehicle',
    'patchGarageVehicle',
    'setDocumentStatus',
    'createDocument',
    'upload',
    'score',
    'active_ride',
    'responses',
    'ride_history',
    'driver_receipts',
    'respond.v1',
    'saveActiveRide',
    'saveRideHistoryEntry',
    'createRideOrder',
    'acceptCanonicalRideOrder',
    'acceptNearbyOrder',
    'updateTripStatus',
  ];
  for (const needle of FORBIDDEN) {
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    expect(`S133: getGarageReadinessState body does NOT reference "${needle}"`,
      !pattern.test(stateCode));
    expect(`S133: resolveGarageReadinessVehicle body does NOT reference "${needle}"`,
      !pattern.test(vehicleCode));
  }
}

// ── BD-PROFILE-GARAGE-READY-K — Codex P2 review follow-ups ────────────────
// S134 covers P2-1 (derive readiness from normalized vehicles).
// S135 + S136 cover P2-2 (refresh Documents READY-K hint after garage
// mutations).
// S137 covers P2-3 (materialised / restored legacy active reports
// explicit_active, not legacy_fallback).
// ─────────────────────────────────────────────────────────────────────────

// ── Scenario 134 (Codex P2-1) — Malformed persisted collection is
// normalised-empty. driverGarage.vehicles is non-empty raw, but every
// entry is dropped by normalisePersistedVehicle (no model). With no
// legacy fields either, buildGarageVehicles returns [] and the garage
// renders the empty/add state — READY-K must report empty_garage /
// empty_collection in lockstep so the Documents pane says
// «Добавьте авто», NOT «Выберите активное авто» (which would strand the
// driver on a no-active hint with no card to pick). ─────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  // No legacy vehicle fields (vehicleMake / Model / Color / Plate).
  driverGarage: {
    activeVehicleId: null,
    // Raw entries that fail normalisePersistedVehicle: bad-1 has no
    // model (dropped), bad-2 is null (dropped). raw length > 0,
    // normalised length === 0 — the bug fixed by P2-1.
    vehicles: [{ id: 'bad-1' }, null],
  },
});
{
  const { buildGarageVehicles, getGarageReadinessState, resolveGarageReadinessVehicle }
    = await import('../public/src/garage.js');
  const vehiclesNorm = buildGarageVehicles(user.get());
  expect('S134: buildGarageVehicles returns [] for malformed-only persisted collection',
    Array.isArray(vehiclesNorm) && vehiclesNorm.length === 0,
    `length=${vehiclesNorm.length}`);
  const readiness = getGarageReadinessState(user.get());
  expect('S134: readiness state === "empty_garage" (normalised-empty, NOT no_active_vehicle)',
    readiness.state === 'empty_garage', String(readiness.state));
  expect('S134: readiness reason === "empty_collection"',
    readiness.reason === 'empty_collection', String(readiness.reason));
  expect('S134: readiness vehicle === null',
    readiness.vehicle === null);
  expect('S134: resolveGarageReadinessVehicle mirrors null',
    resolveGarageReadinessVehicle(user.get()) === null);
  // Docs pane render carries the empty copy + add CTA hint.
  const html = renderProfile('#/profile?role=driver&pane=docs');
  expect('S134: docs pane renders «Добавьте авто»',
    html.includes('Добавьте авто'));
  expect('S134: docs pane does NOT render «Выберите активное авто» (no selectable card to pick)',
    !html.includes('Выберите активное авто'));
  expect('S134: docs pane carries data-garage-ready-state="empty_garage"',
    html.includes('data-garage-ready-state="empty_garage"'));
  expect('S134: docs pane carries data-garage-ready-reason="empty_collection"',
    html.includes('data-garage-ready-reason="empty_collection"'));
  // The raw persisted entry is NOT mutated by the read-only helper.
  expect('S134: getGarageReadinessState did NOT mutate driverGarage.vehicles',
    Array.isArray(user.get().driverGarage?.vehicles)
      && user.get().driverGarage.vehicles.length === 2);
}

// ── Scenario 135 (Codex P2-2) — Docs READY-K hint refreshes after the
// make-active garage handler runs. The Documents pane is rendered once
// per profile mount and tab clicks only toggle pane classes; without
// the new `refreshGarageReadinessHint` call inside `refreshGarageSection`
// the hint would keep the stale `u` snapshot and continue advertising
// «Выберите активное авто» even after the driver picked a vehicle. ───
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: null,
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  // Initial render — both cards are make-active candidates (no active).
  const initialHtml = renderProfile('#/profile?role=driver&pane=docs');
  expect('S135: initial docs pane carries no-active READY-K state',
    initialHtml.includes('data-garage-ready-state="no_active_vehicle"')
    && initialHtml.includes('data-garage-ready-reason="no_active_selection"'));
  expect('S135: initial docs pane copy is «Выберите активное авто»',
    initialHtml.includes('Выберите активное авто'));
  expect('S135: initial docs pane does NOT advertise either vehicle as the anchor',
    !initialHtml.includes('Документы активного авто'));
  // Capture the make-active handler for real-1 BEFORE triggering it —
  // the refresh path resets the surface tracker and clears the click
  // handler map, so the captured reference is the only way to invoke
  // after the fact.
  const makeActiveFn = clickHandlers.get('#pf2-garage-make-active-real-1');
  expect('S135: make-active handler for real-1 was wired',
    typeof makeActiveFn === 'function');
  // Snapshot the refresh tracker offsets so we can isolate the replace
  // and temp HTML logs produced by this single click.
  const replaceCountBefore = replaceWithLog.length;
  const tempCountBefore = tempInnerHtmlLog.length;
  if (typeof makeActiveFn === 'function') makeActiveFn();
  // User-state mutation pinned: activeVehicleId is now real-1, marker
  // cleared. This is the precondition for the in-place refresh to read
  // the new state.
  expect('S135: activeVehicleId === "real-1" after make-active click',
    user.get().driverGarage?.activeVehicleId === 'real-1',
    String(user.get().driverGarage?.activeVehicleId));
  // In-place readiness refresh evidence: a replaceWith targeted
  // #pf2-garage-ready, and the replacement HTML carries the new
  // active_vehicle state + model/plate.
  const refreshReplaces = replaceWithLog.slice(replaceCountBefore);
  const readinessReplace = refreshReplaces.find((e) => e.targetSelector === '#pf2-garage-ready');
  expect('S135: replaceWith was called on #pf2-garage-ready after make-active',
    typeof readinessReplace === 'object' && readinessReplace !== null,
    String(refreshReplaces.map((e) => e.targetSelector)));
  const refreshTemps = tempInnerHtmlLog.slice(tempCountBefore);
  const readinessTempHtml = refreshTemps.find((h) => h.includes('id="pf2-garage-ready"'));
  expect('S135: a temp innerHTML carrying #pf2-garage-ready was assigned during refresh',
    typeof readinessTempHtml === 'string' && readinessTempHtml.length > 0);
  if (typeof readinessTempHtml === 'string') {
    expect('S135: refreshed hint carries data-garage-ready-state="active_vehicle"',
      readinessTempHtml.includes('data-garage-ready-state="active_vehicle"'));
    expect('S135: refreshed hint carries data-garage-ready-reason="explicit_active"',
      readinessTempHtml.includes('data-garage-ready-reason="explicit_active"'));
    expect('S135: refreshed hint copy is «Документы активного авто»',
      readinessTempHtml.includes('Документы активного авто'));
    expect('S135: refreshed hint names the selected model "Toyota Prius"',
      readinessTempHtml.includes('Toyota Prius'));
    expect('S135: refreshed hint names the selected plate "А 123 ВС 77"',
      readinessTempHtml.includes('А 123 ВС 77'));
    // The other available sibling is NOT in the refreshed hint.
    expect('S135: refreshed hint does NOT name real-2 ("Kia Sportage") as the anchor',
      !readinessTempHtml.includes('Kia Sportage'));
  }
}

// ── Scenario 136 (Codex P2-2) — Docs READY-K hint refreshes after the
// archive-active garage handler runs. Initial: real-1 active. After
// archiving real-1 via the existing per-vehicle archive-confirm
// handler, activeVehicleId is cleared and the in-place readiness
// refresh must flip the hint to «Выберите активное авто». No silent
// promotion to real-2. ───────────────────────────────────────────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  driverGarage: {
    activeVehicleId: 'real-1',
    vehicles: [
      { id: 'real-1', model: 'Toyota Prius', color: 'серебристый', plate: 'А 123 ВС 77', source: 'persisted' },
      { id: 'real-2', model: 'Kia Sportage', color: 'серый',       plate: 'В 456 КМ 77', source: 'persisted' },
    ],
  },
});
{
  const initialHtml = renderProfile('#/profile?role=driver&pane=docs');
  expect('S136: initial docs pane carries active_vehicle / explicit_active state',
    initialHtml.includes('data-garage-ready-state="active_vehicle"')
    && initialHtml.includes('data-garage-ready-reason="explicit_active"'));
  expect('S136: initial docs pane copy is «Документы активного авто»',
    initialHtml.includes('Документы активного авто'));
  expect('S136: initial docs pane names "Toyota Prius" as the active anchor',
    initialHtml.includes('Toyota Prius'));
  // Archive flow: open confirm row, then confirm.  The confirm-final
  // handler invokes `archiveGarageVehicle('real-1')` + `refreshGarageSection`,
  // which in turn calls `refreshGarageReadinessHint`. We invoke the
  // confirm handler directly (its body short-circuits on a missing
  // confirmRow, and the stub's querySelector always returns a
  // truthy element).
  const archiveConfirmFn = clickHandlers.get('#pf2-garage-archive-confirm-real-1');
  expect('S136: archive-confirm handler for real-1 was wired',
    typeof archiveConfirmFn === 'function');
  const replaceCountBefore = replaceWithLog.length;
  const tempCountBefore = tempInnerHtmlLog.length;
  if (typeof archiveConfirmFn === 'function') archiveConfirmFn();
  expect('S136: activeVehicleId cleared to null after archiving the active',
    user.get().driverGarage?.activeVehicleId === null,
    String(user.get().driverGarage?.activeVehicleId));
  // Real-1 is archived in the persisted record.
  const realRecord1After = (user.get().driverGarage?.vehicles || [])
    .find((v) => v && v.id === 'real-1');
  expect('S136: real-1 carries archived: true after the archive click',
    realRecord1After?.archived === true,
    JSON.stringify(realRecord1After));
  // In-place readiness refresh evidence.
  const refreshReplaces = replaceWithLog.slice(replaceCountBefore);
  const readinessReplace = refreshReplaces.find((e) => e.targetSelector === '#pf2-garage-ready');
  expect('S136: replaceWith was called on #pf2-garage-ready after archive-active',
    typeof readinessReplace === 'object' && readinessReplace !== null,
    String(refreshReplaces.map((e) => e.targetSelector)));
  const refreshTemps = tempInnerHtmlLog.slice(tempCountBefore);
  const readinessTempHtml = refreshTemps.find((h) => h.includes('id="pf2-garage-ready"'));
  expect('S136: a temp innerHTML carrying #pf2-garage-ready was assigned during refresh',
    typeof readinessTempHtml === 'string' && readinessTempHtml.length > 0);
  if (typeof readinessTempHtml === 'string') {
    expect('S136: refreshed hint carries data-garage-ready-state="no_active_vehicle"',
      readinessTempHtml.includes('data-garage-ready-state="no_active_vehicle"'));
    expect('S136: refreshed hint carries data-garage-ready-reason="no_active_selection"',
      readinessTempHtml.includes('data-garage-ready-reason="no_active_selection"'));
    expect('S136: refreshed hint copy is «Выберите активное авто»',
      readinessTempHtml.includes('Выберите активное авто'));
    // No silent promotion: real-2 is NOT advertised as the anchor.
    expect('S136: refreshed hint does NOT name real-2 ("Kia Sportage") as the anchor',
      !readinessTempHtml.includes('Kia Sportage'));
    // The archived real-1 is also NOT advertised as the anchor.
    expect('S136: refreshed hint does NOT name the archived real-1 ("Toyota Prius") as the anchor',
      !readinessTempHtml.includes('Toyota Prius'));
  }
}

// ── Scenario 137 (Codex P2-3) — Materialised legacy explicit-active
// reports `explicit_active`, NOT `legacy_fallback`. Starts with a
// legacy-only profile (the synthesised fallback path). After archiving
// the legacy card (which materialises it into driverGarage.vehicles),
// restoring it, and explicitly making it active, the vehicle is a
// persisted record with `activeVehicleId === 'legacy-1'`. It STILL has
// `source: 'legacy'` in storage, but `_synthesized` is no longer set —
// READY-K must report `explicit_active` so future docs/readiness code
// can distinguish "driver picked a real vehicle that happens to come
// from the legacy fields" from "no persisted record yet". ───────────
reset();
user.set({
  onboarded: true, role: 'driver',
  firstName: 'Иван', lastName: 'Драйвер',
  phone: '9001234567', phoneVerified: true,
  vehicleMake: 'Hyundai', vehicleModel: 'Solaris',
  vehicleColor: 'белый', vehiclePlate: 'А 482 МР 77',
  // No persisted garage collection — legacy fallback path.
});
{
  const { getGarageReadinessState } = await import('../public/src/garage.js');
  const { archiveGarageVehicle: archiveFn,
          restoreGarageVehicle: restoreFn,
          markGarageVehicleActive: markActiveFn }
    = await import('../public/src/state.js');
  // Step 1 — initial legacy-fallback state.
  {
    const r0 = getGarageReadinessState(user.get());
    expect('S137 step 1: legacy-only initial state === "active_vehicle"',
      r0.state === 'active_vehicle', String(r0.state));
    expect('S137 step 1: legacy-only initial reason === "legacy_fallback"',
      r0.reason === 'legacy_fallback', String(r0.reason));
    expect('S137 step 1: legacy-only initial vehicle._synthesized === true',
      r0.vehicle?._synthesized === true, JSON.stringify(r0.vehicle));
  }
  // Step 2 — archive materialises legacy-1 into driverGarage.vehicles
  // with `archived: true` and clears activeVehicleId.
  archiveFn('legacy-1');
  {
    const rec = (user.get().driverGarage?.vehicles || [])
      .find((v) => v && v.id === 'legacy-1');
    expect('S137 step 2: legacy-1 materialised into driverGarage.vehicles',
      rec && rec.source === 'legacy' && rec.archived === true,
      JSON.stringify(rec));
    expect('S137 step 2: activeVehicleId cleared after archiving the (active) legacy',
      user.get().driverGarage?.activeVehicleId === null);
  }
  // Step 3 — restore unarchives + stamps restoredFromArchive marker.
  restoreFn('legacy-1');
  {
    const rec = (user.get().driverGarage?.vehicles || [])
      .find((v) => v && v.id === 'legacy-1');
    expect('S137 step 3: restore stripped the archived flag',
      rec && rec.archived !== true && rec.source === 'legacy',
      JSON.stringify(rec));
    // activeVehicleId remains null — restore never auto-promotes.
    expect('S137 step 3: activeVehicleId remains null after restore',
      user.get().driverGarage?.activeVehicleId === null);
  }
  // Step 4 — explicit make-active picks legacy-1 as the active anchor.
  markActiveFn('legacy-1');
  {
    expect('S137 step 4: activeVehicleId === "legacy-1" after explicit make-active',
      user.get().driverGarage?.activeVehicleId === 'legacy-1');
    const rec = (user.get().driverGarage?.vehicles || [])
      .find((v) => v && v.id === 'legacy-1');
    expect('S137 step 4: restoredFromArchive marker cleared by make-active',
      rec && rec.restoredFromArchive !== true,
      JSON.stringify(rec));
    // legacy-1 is a persisted record (no `_synthesized` ever escapes
    // storage because normalisePersistedVehicle does not propagate it).
    expect('S137 step 4: persisted legacy-1 carries source: "legacy" but NOT _synthesized',
      rec && rec.source === 'legacy' && rec._synthesized !== true,
      JSON.stringify(rec));
  }
  // Step 5 — READY-K classification: explicit_active, NOT legacy_fallback.
  {
    const r = getGarageReadinessState(user.get());
    expect('S137 step 5: final state === "active_vehicle"',
      r.state === 'active_vehicle', String(r.state));
    expect('S137 step 5: final reason === "explicit_active" (the P2-3 fix)',
      r.reason === 'explicit_active', String(r.reason));
    expect('S137 step 5: final reason is NOT "legacy_fallback"',
      r.reason !== 'legacy_fallback', String(r.reason));
    expect('S137 step 5: final vehicle.id === "legacy-1"',
      r.vehicle?.id === 'legacy-1', String(r.vehicle?.id));
    expect('S137 step 5: final vehicle.source === "legacy" (storage truth preserved)',
      r.vehicle?.source === 'legacy', String(r.vehicle?.source));
    expect('S137 step 5: final vehicle does NOT carry the _synthesized marker',
      r.vehicle?._synthesized !== true, JSON.stringify(r.vehicle));
    // Docs pane render carries explicit_active markers too.
    const html = renderProfile('#/profile?role=driver&pane=docs');
    expect('S137 step 5: docs pane carries data-garage-ready-reason="explicit_active"',
      html.includes('data-garage-ready-reason="explicit_active"'));
    expect('S137 step 5: docs pane does NOT carry data-garage-ready-reason="legacy_fallback"',
      !html.includes('data-garage-ready-reason="legacy_fallback"'));
  }
}

// ── Scenario 138 (Codex P2-2 source guard) — `refreshGarageSection`
// must call `refreshGarageReadinessHint`. Source-level pin so a future
// refactor cannot accidentally drop the in-place readiness refresh
// without flagging the smoke. Also pins that the helper exists, reads
// fresh state via `user.get()`, builds the new markup with
// `garageReadinessHintHtml`, and swaps it via `replaceWith` (without
// any forbidden writes). ─────────────────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const profileSrc = readFileSync(join(projectRoot, 'public/src/screens/profile.js'), 'utf8');
  const sliceFn = (src, marker) => {
    const start = src.indexOf(marker);
    if (start < 0) return '';
    const closeIdx = src.indexOf('\n}\n', start);
    if (closeIdx < 0) return '';
    return src.slice(start, closeIdx + 3);
  };
  const refreshSectionBody = sliceFn(profileSrc, 'function refreshGarageSection(');
  const refreshHintBody = sliceFn(profileSrc, 'function refreshGarageReadinessHint(');
  expect('S138: refreshGarageSection body extracted',
    refreshSectionBody.length > 0);
  expect('S138: refreshGarageReadinessHint body extracted',
    refreshHintBody.length > 0, String(refreshHintBody.length));
  expect('S138: refreshGarageSection invokes refreshGarageReadinessHint(root)',
    /refreshGarageReadinessHint\s*\(\s*root\s*\)/.test(refreshSectionBody));
  expect('S138: refreshGarageReadinessHint reads fresh state via user.get()',
    /user\s*\.\s*get\s*\(\s*\)/.test(refreshHintBody));
  expect('S138: refreshGarageReadinessHint builds markup via garageReadinessHintHtml',
    /garageReadinessHintHtml\s*\(/.test(refreshHintBody));
  expect('S138: refreshGarageReadinessHint swaps #pf2-garage-ready via replaceWith',
    /replaceWith\s*\(/.test(refreshHintBody)
    && refreshHintBody.includes('#pf2-garage-ready'));
  // Read-only contract: no writers / no document writers / no
  // cross-surface keys inside the helper.
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const refreshHintCode = stripComments(refreshHintBody);
  const FORBIDDEN_HINT = [
    'user.set',
    'localStorage.setItem',
    'sessionStorage.setItem',
    'archiveGarageVehicle',
    'restoreGarageVehicle',
    'markGarageVehicleActive',
    'appendGarageVehicle',
    'patchGarageVehicle',
    'setDocumentStatus',
    'createDocument',
    'addEventListener',
    'active_ride',
    'responses',
    'ride_history',
    'driver_receipts',
    'respond.v1',
  ];
  for (const needle of FORBIDDEN_HINT) {
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    expect(`S138: refreshGarageReadinessHint does NOT reference "${needle}"`,
      !pattern.test(refreshHintCode));
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile driver-garage smoke checks passed.');
