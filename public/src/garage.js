// BD-PROFILE-D-05E — Shared garage derivation. The garage collection
// builder and the active-vehicle resolver were promoted out of
// `screens/profile.js` so the driver-response snapshot (respond.js) and
// the accept-handoff snapshot (ride_actions.js) can read the same active
// garage vehicle the profile renders, without depending on a UI module.
//
// BD-PROFILE-D-05F — Persisted collection source. The builder now reads
// `profile.driverGarage.vehicles` when it holds a usable non-empty array
// (after per-entry normalisation) and only falls back to the legacy
// `vehicleMake/Model/Color/Plate` user fields when the persisted
// collection is missing, empty, or malformed.
//
// Strictly read-only across the board: no side effects, no localStorage
// writes, no `driverGarage` mutation, no render-time auto-initialisation
// of the persisted collection from legacy fields. Persistence of the
// active selection stays owned by BD-PROFILE-D-05D
// (`wireGarageActions` make-active handler); persistence of the
// collection itself is left to a future safe save path (05G+).
//
// Resolution rules:
//   - Collection source: persisted `driverGarage.vehicles` (normalised)
//     when valid+non-empty, else the legacy-derived single-vehicle list,
//     else `[]`.
//   - Active id: `profile.driverGarage.activeVehicleId` when present in
//     the rebuilt collection; otherwise fall back to the legacy vehicle
//     (`source === 'legacy'`), then the first vehicle, then null.
//   - `options.force === 'empty'` short-circuits to `[]`.
//   - `options.force === 'multi'` is a profile-render preview that
//     appends a single mock demo card to whatever real source exists.
//     The two production consumers (respond.js, ride_actions.js) never
//     pass any options, so the preview cannot leak into a real driver
//     response or handoff snapshot.

// 05F — Normalise one persisted vehicle entry. Drops entries that can't
// reasonably render a card; coerces fields to safe types. An `id` is
// required so per-vehicle DOM hooks and the resolver have a stable key;
// a missing id is synthesised from the index so a partial seed still
// renders. A missing model would render an empty card, so those entries
// are dropped entirely (caller falls back to the legacy-derived path).
// 05I — the `archived` flag is preserved (boolean only) so the active-
// list filter and archived-count helpers downstream agree on a single
// source of truth.
function normalisePersistedVehicle(raw, idx) {
  if (!raw || typeof raw !== 'object') return null;
  const idStr = typeof raw.id === 'string' ? raw.id.trim() : '';
  const id = idStr || `garage-${idx + 1}`;
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  if (!model) return null;
  const color = typeof raw.color === 'string' ? raw.color.trim() : '';
  const plate = typeof raw.plate === 'string' ? raw.plate.trim() : '';
  const source = typeof raw.source === 'string' && raw.source ? raw.source : 'persisted';
  const archived = raw.archived === true;
  // 05J Codex P2 #1 (round 2) — preserve the `restoredFromArchive`
  // marker the helper set so the resolver's `firstEligible` filter
  // can see it. Strict boolean — anything else is dropped.
  const restoredFromArchive = raw.restoredFromArchive === true;
  return {
    id, model, color, plate, source,
    ...(archived ? { archived: true } : {}),
    ...(restoredFromArchive ? { restoredFromArchive: true } : {}),
  };
}

// 05F — Read the persisted garage collection off the profile and return
// the normalised, de-duplicated list. Returns `[]` for any malformed
// shape (non-array, missing namespace, entries that fail
// `normalisePersistedVehicle`) so the builder safely falls through to
// the legacy-derived path.
function readPersistedGarageVehicles(profile) {
  if (!profile || !profile.driverGarage) return [];
  const raw = profile.driverGarage.vehicles;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const v = normalisePersistedVehicle(raw[i], i);
    if (!v) continue;
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

// Build the in-memory garage collection. Pure derive — no side effects.
// 05F: prefer the persisted `driverGarage.vehicles` when it holds a
// valid non-empty array; otherwise fall back to a single-entry legacy
// list derived from the user.* vehicle fields. The legacy fallback is
// in-memory only — it is NEVER written back to storage from this
// function or its callers (the persistence guardrail of 05F).
export function buildGarageVehicles(u, options = {}) {
  const force = typeof options.force === 'string' ? options.force : '';
  if (force === 'empty') return [];

  const rawAll = readPersistedGarageVehicles(u);
  // 05I — archived entries stay in the persisted record (no hard delete)
  // but never reach the active list. The resolver, the snapshot
  // consumers (respond.js / ride_actions.js), and the per-card render
  // therefore never surface an archived vehicle as active or even as a
  // make-active candidate.
  let raw = rawAll.filter((v) => v && v.archived !== true);

  // BD-PROFILE-GARAGE-ARCHIVE-I2 Codex P2 — the legacy fallback fires
  // ONLY when there is no valid persisted garage collection at all
  // (`rawAll.length === 0`). Previously the condition was
  // `raw.length === 0 && !hasArchivedLegacy`, which mis-fired when the
  // user had a real persisted garage and archived every entry — the
  // next render synthesised a `legacy-1` active card from the
  // preserved `vehicleMake / Model / Color / Plate` fields, violating
  // the no-silent-promotion contract and resurrecting a car the user
  // had effectively retired. The new check naturally subsumes the old
  // archived-legacy guard: an archived `legacy-1` materialisation
  // keeps `rawAll.length > 0`, so the legacy fallback stays suppressed
  // there too.
  if (rawAll.length === 0) {
    const make  = (u && typeof u.vehicleMake  === 'string') ? u.vehicleMake.trim()  : '';
    const model = (u && typeof u.vehicleModel === 'string') ? u.vehicleModel.trim() : '';
    const color = (u && typeof u.vehicleColor === 'string') ? u.vehicleColor.trim() : '';
    const plate = (u && typeof u.vehiclePlate === 'string') ? u.vehiclePlate.trim() : '';
    const modelLine = (make && model) ? `${make} ${model}` : (make || model);
    if (modelLine) {
      raw = [{
        id: 'legacy-1',
        model: modelLine,
        color,
        plate,
        source: 'legacy',
        // 05J Codex P2 #2 — the synthesised legacy entry carries a
        // `_synthesized: true` marker so the resolver can distinguish
        // "auto-derived from legacy fields" from "persisted (possibly
        // restored)" entries. Only the synthesised entry grants the
        // null-saved active fallback; persisted entries (including
        // restored ones) must wait for explicit `Сделать активной`.
        _synthesized: true,
      }];
    }
  }

  // `?garage=multi` — preview-only second vehicle, never touches storage.
  // Requires at least one real vehicle (persisted OR legacy-derived) so
  // the multi-card layout exercises an active+available pair.
  if (force === 'multi' && raw.length > 0) {
    raw = [...raw, {
      id: 'demo-2',
      model: 'Kia Rio',
      color: 'белый',
      plate: '*** 125',
      source: 'mock',
    }];
  }

  if (raw.length === 0) return [];

  const activeId = resolveActiveGarageVehicleId(u, raw);
  return raw.map((v) => ({
    ...v,
    status: v.id === activeId ? 'active' : 'available',
  }));
}

// Resolve which vehicle in the rebuilt collection is "active right now".
// Read-only against `profile.driverGarage.activeVehicleId`; never
// mutates the persisted id (a stale id is silently ignored, not
// cleared, so the previous selection re-activates when the matching
// vehicle reappears).
//
// BD-PROFILE-GARAGE-ARCHIVE-I2 — contract alignment. Resolution order:
//   1. saved `activeVehicleId` matches a non-archived vehicle → active.
//   2. synthesised legacy fallback (`_synthesized === true`, set only
//      when the persisted collection is empty AND there is no archived
//      legacy materialisation) → active.
//   3. otherwise → null (no silent promotion).
//
// The previous resolver auto-promoted the first non-restored persisted
// vehicle when saved was null/empty/stale. That silently picked a new
// active selection on the user's behalf after an active-vehicle
// archive or a fresh add-without-make-active, contradicting the
// archive contract: "the user must explicitly choose another active
// vehicle later." This slice removes that branch so the contract is
// consistent end-to-end (archive helper clears `activeVehicleId`,
// resolver does NOT pick a replacement, render shows the empty /
// "no active vehicle" state until the user clicks «Сделать активной»).
export function resolveActiveGarageVehicleId(profile, vehicles) {
  if (!Array.isArray(vehicles) || vehicles.length === 0) return null;
  const saved = profile
    && profile.driverGarage
    && typeof profile.driverGarage.activeVehicleId === 'string'
    && profile.driverGarage.activeVehicleId.length > 0
    ? profile.driverGarage.activeVehicleId
    : null;
  if (saved && vehicles.some((v) => v && v.id === saved)) return saved;
  // Synthesised legacy fallback — only fires when the persisted
  // collection is empty AND no archived legacy materialisation exists
  // (see `buildGarageVehicles`). Truly the legacy fallback path: keep
  // it so onboarded-but-never-touched-garage users still see their
  // legacy car as active without an explicit click.
  const synthesised = vehicles.find((v) => v && v._synthesized === true);
  if (synthesised) return synthesised.id;
  return null;
}

// Convenience read used by the driver-response snapshot (respond.js) and
// the accept-handoff snapshot (ride_actions.js). Builds the collection
// with NO render-gate options (so the preview-only demo vehicle never
// shows up in real snapshots) and returns the resolved active vehicle.
// Returns null when neither the persisted collection nor the legacy
// fields produce a usable entry. Strictly read-only.
export function resolveActiveGarageVehicle(u) {
  const vehicles = buildGarageVehicles(u);
  if (vehicles.length === 0) return null;
  const id = resolveActiveGarageVehicleId(u, vehicles);
  if (!id) return null;
  return vehicles.find((v) => v && v.id === id) || null;
}

// BD-PROFILE-GARAGE-READY-K — Read-only readiness/documents hook.
//
// First slice of the garage→documents bridge. This is INTENTIONALLY tiny:
// no real document storage, no upload, no readiness scoring, no UI
// mutation. The two helpers below answer "which vehicle (if any) is the
// document/readiness anchor right now" so the upcoming documents
// implementation knows where to attach when it lands. Both helpers are
// strictly read-only against `profile.driverGarage` and the legacy
// `vehicleMake / Model / Color / Plate` fields — no `user.set`, no
// `localStorage.setItem`, no archive / restore / make-active calls, no
// cross-surface writes.
//
// Return shape from `getGarageReadinessState(u)`:
//   {
//     state: 'active_vehicle' | 'no_active_vehicle' | 'empty_garage',
//     vehicle: <resolved vehicle> | null,
//     reason:
//       | 'explicit_active'     — saved activeVehicleId matches a
//                                 non-archived persisted vehicle (incl.
//                                 a materialised / restored legacy-
//                                 source vehicle the user explicitly
//                                 picked)
//       | 'legacy_fallback'     — synthesised legacy entry only
//                                 (`_synthesized === true`; no
//                                 persisted record at all)
//       | 'no_active_selection' — persisted vehicles exist with at
//                                 least one non-archived entry but no
//                                 active selection
//       | 'archived_only'       — every persisted entry is archived
//       | 'empty_collection'    — no normalised selectable persisted
//                                 record AND no synthesised legacy
//                                 fallback
//   }
//
// Reason matrix:
//   state === 'active_vehicle'    + active._synthesized === true → 'legacy_fallback'
//   state === 'active_vehicle'    + active._synthesized !== true → 'explicit_active'
//   state === 'no_active_vehicle' + every normalised persisted entry archived → 'archived_only'
//   state === 'no_active_vehicle' + at least one non-archived normalised persisted → 'no_active_selection'
//   state === 'empty_garage'      → 'empty_collection'
//
// READY-K Codex P2-1 — classification follows the same NORMALISED garage
// truth as `buildGarageVehicles` / `resolveActiveGarageVehicle`, not the
// raw `driverGarage.vehicles.length`. If every persisted record is
// dropped by `normalisePersistedVehicle` (e.g. ids without models) and
// there are no legacy fields, the garage overview renders the
// empty/add state — and READY-K must report `empty_garage /
// empty_collection` in lockstep so the Documents pane says
// «Добавьте авто» instead of stranding the driver on
// «Выберите активное авто» with no selectable card.
//
// READY-K Codex P2-3 — the synthesised-legacy reason hinges on the
// `_synthesized: true` marker `buildGarageVehicles` stamps on its
// in-memory legacy entry, NOT on `active.source === 'legacy'`. A
// materialised / restored legacy-source vehicle the user explicitly
// makes active is a real persisted record (no `_synthesized` marker;
// `normalisePersistedVehicle` does not preserve that flag from
// storage), so it correctly reports `explicit_active`.
//
// Archived-only is INTENTIONALLY no_active_vehicle, NOT empty_garage:
// the user has touched the garage, they just have no usable car right
// now. The UI hint and the future documents implementation treat the
// two states differently (archived-only points the user at restore;
// empty points the user at add). Malformed persisted records that
// normalise away are treated as empty for READY-K (there is no card
// to restore or pick).
export function getGarageReadinessState(u) {
  const active = resolveActiveGarageVehicle(u);
  if (active) {
    return {
      state: 'active_vehicle',
      vehicle: active,
      reason: active._synthesized === true ? 'legacy_fallback' : 'explicit_active',
    };
  }
  // READY-K Codex P2-1 — normalised collection, not raw length. Mirrors
  // the source of truth `buildGarageVehicles` / `resolveActiveGarageVehicle`
  // use, so malformed (modelless / non-object) raw entries cannot pin
  // the Documents pane on «Выберите активное авто» when no selectable
  // card exists.
  const normalised = readPersistedGarageVehicles(u);
  if (normalised.length === 0) {
    return { state: 'empty_garage', vehicle: null, reason: 'empty_collection' };
  }
  const allArchived = normalised.every((v) => v && v.archived === true);
  return {
    state: 'no_active_vehicle',
    vehicle: null,
    reason: allArchived ? 'archived_only' : 'no_active_selection',
  };
}

// Thin wrapper for the future documents implementation — callers that
// only need the vehicle (not the state/reason metadata) can read it
// directly without re-deriving via `resolveActiveGarageVehicle`.
export function resolveGarageReadinessVehicle(u) {
  return getGarageReadinessState(u).vehicle;
}

// BD-PROFILE-D-05I — Count archived persisted vehicles. Used by the
// profile renderer to surface a small "В архиве: N" hint underneath the
// active-list cards. Strictly read-only — walks the raw persisted
// vehicles array without going through `normalisePersistedVehicle` so
// the count is not affected by render-time dropping (e.g. an archived
// entry with a missing model is still counted; it cannot show up as
// active, and the hint signals the storage record still holds it).
export function countArchivedGarageVehicles(u) {
  if (!u || !u.driverGarage || !Array.isArray(u.driverGarage.vehicles)) return 0;
  let count = 0;
  for (const v of u.driverGarage.vehicles) {
    if (v && typeof v === 'object' && v.archived === true) count++;
  }
  return count;
}

// BD-PROFILE-D-05J — Snapshot of archived persisted vehicles, ready for
// the profile's archived section render. Runs every entry through the
// same `normalisePersistedVehicle` pipeline as `buildGarageVehicles`,
// so archived items only show in the list when they can render a card
// (missing model is dropped). `countArchivedGarageVehicles` continues
// to walk the RAW array and may report a higher count than this list's
// length when storage holds a malformed archived entry — the hint is
// storage truth, the list is render truth. Strictly read-only.
export function listArchivedGarageVehicles(u) {
  if (!u || !u.driverGarage || !Array.isArray(u.driverGarage.vehicles)) return [];
  const raw = u.driverGarage.vehicles;
  const out = [];
  // 05J Codex P3 #1 — de-dupe archived entries by id so the rendered
  // archived list always carries unique DOM hooks and every restore
  // button is actionable. When duplicate archived ids exist in
  // storage, the first archived match is rendered; on restore, the
  // helper's archived-preferring strict lookup unarchives the first
  // raw match; a subsequent render then surfaces the next archived
  // sibling. Sequential clicks restore each duplicate in turn.
  // 05J Codex P2 #2 (round 3) — `_rawIdx` is the source raw-array
  // index for each surfaced entry. The render passes it back through
  // `restoreGarageVehicle(id, { rawIdx })` so the right slot is
  // unarchived even when an earlier raw entry shares the id but
  // failed normalisation (e.g., missing model → dropped from this
  // visible list).
  const seenIds = new Set();
  for (let i = 0; i < raw.length; i++) {
    const v = normalisePersistedVehicle(raw[i], i);
    if (!v) continue;
    if (v.archived !== true) continue;
    if (seenIds.has(v.id)) continue;
    seenIds.add(v.id);
    out.push({ ...v, _rawIdx: i });
  }
  return out;
}
