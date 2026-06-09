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
  return { id, model, color, plate, source, ...(archived ? { archived: true } : {}) };
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

  // 05I Codex P2 — the legacy fallback below fires when the active list
  // is empty AND there is no archived `legacy-1` materialised by
  // `archiveGarageVehicle` already. That prevents an archived legacy
  // card from being re-synthesised from the legacy `vehicleMake / Model
  // / Color / Plate` user fields on the next render. Archived NON-
  // legacy entries (e.g. an archived persisted `real-2`) keep the
  // legacy fallback semantics intact for the snapshot consumers and the
  // garage render — only the explicit "I archived my legacy" gesture
  // suppresses the fallback.
  const hasArchivedLegacy = rawAll.some((v) =>
    v && v.id === 'legacy-1' && v.archived === true);

  if (raw.length === 0 && !hasArchivedLegacy) {
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
// vehicle reappears). Fallback chain on a stale or missing id: legacy
// entry (`source === 'legacy'`), then the first vehicle, then null.
export function resolveActiveGarageVehicleId(profile, vehicles) {
  if (!Array.isArray(vehicles) || vehicles.length === 0) return null;
  const saved = profile
    && profile.driverGarage
    && typeof profile.driverGarage.activeVehicleId === 'string'
    && profile.driverGarage.activeVehicleId.length > 0
    ? profile.driverGarage.activeVehicleId
    : null;
  if (saved && vehicles.some((v) => v && v.id === saved)) return saved;
  const legacy = vehicles.find((v) => v && v.source === 'legacy');
  if (legacy) return legacy.id;
  return (vehicles[0] && vehicles[0].id) || null;
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
