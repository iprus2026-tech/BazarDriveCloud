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
const clickHandlers = new Map();

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
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    get firstElementChild() { return makeEl(); },
    addEventListener(type, fn) {
      if (type === 'click' && this._selector && typeof fn === 'function') {
        clickHandlers.set(this._selector, fn);
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
    appendChild(x) { return x; }, removeChild() {}, replaceWith() {}, remove() {},
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
  clickHandlers.clear();
  currentHash = '';
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
  expect('S13: confirm row exposes "Подтвердить архивирование?" prompt',
    slice.includes('Подтвердить архивирование?'));
  expect('S13: confirm row has cancel button id #pf2-garage-archive-cancel-legacy-1',
    slice.includes('id="pf2-garage-archive-cancel-legacy-1"'));
  expect('S13: confirm row has final button id #pf2-garage-archive-confirm-legacy-1',
    slice.includes('id="pf2-garage-archive-confirm-legacy-1"'));
  expect('S13: cancel button labelled "Отмена"',
    slice.includes('>Отмена<'));
  expect('S13: final confirm button labelled "Подтвердить"',
    slice.includes('>Подтвердить<'));
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
  const before = snapshotLocalStorage();
  const triggers = [
    '#pf2-garage-add',
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
    '#pf2-garage-archive-confirm-legacy-1',
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
  expect('S16: wireGarageActions patches the driverGarage namespace (single allowed writer)',
    /\bdriverGarage\b/.test(wireBody) && /user\.set\s*\(/.test(wireBody));
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
  const triggers = [
    '#pf2-garage-add',
    // Legacy (active) card — no make-active button on the active card.
    '#pf2-garage-edit-legacy-1',
    '#pf2-garage-archive-legacy-1',
    '#pf2-garage-archive-cancel-legacy-1',
    '#pf2-garage-archive-confirm-legacy-1',
    // Demo (non-active) card — every handler EXCEPT make-active.
    '#pf2-garage-edit-demo-2',
    '#pf2-garage-archive-demo-2',
    '#pf2-garage-archive-cancel-demo-2',
    '#pf2-garage-archive-confirm-demo-2',
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

// ── Scenario 32 — Stale activeVehicleId falls back to the FIRST persisted
// vehicle (NOT to the legacy car). The saved id stays intact. ─────────────
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
  expect('S32: stale id falls back to the FIRST persisted vehicle (real-2 active)',
    slice.includes('id="pf2-garage-active-real-2"'));
  expect('S32: stale id does NOT fall back to the legacy car',
    !slice.includes('data-vehicle="legacy-1"'));
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

// ── Scenario 58 — Blank model save is blocked: error surfaces, vehicles
// stay byte-equal, sheet stays open. ─────────────────────────────────────
{
  const section = captureSection('#/profile');
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

// ── Result ───────────────────────────────────────────────────────────────────
if (issues.length) {
  console.error('\nSMOKE FAILED:');
  for (const i of issues) console.error('  - ' + i);
  process.exit(1);
}
console.log('\nAll profile driver-garage smoke checks passed.');
