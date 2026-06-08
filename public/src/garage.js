// BD-PROFILE-D-05E — Shared garage derivation. The garage collection
// builder and the active-vehicle resolver were promoted out of
// `screens/profile.js` so the driver-response snapshot (respond.js) and
// the accept-handoff snapshot (ride_actions.js) can read the same active
// garage vehicle the profile renders, without depending on a UI module.
//
// Strictly read-only: no side effects, no localStorage writes, no
// driverGarage mutation. Persistence of the selection stays owned by
// BD-PROFILE-D-05D (`wireGarageActions` make-active handler).
//
// Resolution rules (mirror of the profile resolver):
//   - If `profile.driverGarage.activeVehicleId` matches a vehicle in the
//     rebuilt collection, that vehicle is active.
//   - If the saved id is missing or stale, fall back to the legacy
//     vehicle (`source === 'legacy'`), then the first vehicle, then null.
//   - If the collection is empty (no usable legacy vehicle, or
//     `force: 'empty'`), return null without crashing.

// Build the in-memory garage collection from the legacy user.* vehicle
// fields. Pure derive — same inputs, same outputs. Status is set by
// `resolveActiveGarageVehicleId` consumers; this builder only fills the
// shape. `options.force === 'empty'` short-circuits to []; 'multi'
// appends a single preview-only demo vehicle (only when the legacy
// vehicle is present so the layout exercises an active+available pair).
export function buildGarageVehicles(u, options = {}) {
  const force = typeof options.force === 'string' ? options.force : '';
  if (force === 'empty') return [];

  const make  = (u && typeof u.vehicleMake  === 'string') ? u.vehicleMake.trim()  : '';
  const model = (u && typeof u.vehicleModel === 'string') ? u.vehicleModel.trim() : '';
  const color = (u && typeof u.vehicleColor === 'string') ? u.vehicleColor.trim() : '';
  const plate = (u && typeof u.vehiclePlate === 'string') ? u.vehiclePlate.trim() : '';
  const modelLine = (make && model) ? `${make} ${model}` : (make || model);

  const raw = [];
  if (modelLine) {
    raw.push({
      id: 'legacy-1',
      model: modelLine,
      color,
      plate,
      source: 'legacy',
    });
  }

  if (force === 'multi' && raw.length > 0) {
    raw.push({
      id: 'demo-2',
      model: 'Kia Rio',
      color: 'белый',
      plate: '*** 125',
      source: 'mock',
    });
  }

  if (raw.length === 0) return [];

  const activeId = resolveActiveGarageVehicleId(u, raw);
  return raw.map((v) => ({
    ...v,
    status: v.id === activeId ? 'active' : 'available',
  }));
}

// Resolve which vehicle in the rebuilt collection is "active right now".
// Read-only against `profile.driverGarage.activeVehicleId`; never mutates
// the persisted id (a stale id is silently ignored, not cleared, so the
// previous selection re-activates when the matching vehicle reappears).
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
// Returns null when the profile has no usable legacy vehicle — callers
// then keep their existing fallback path. Strictly read-only.
export function resolveActiveGarageVehicle(u) {
  const vehicles = buildGarageVehicles(u);
  if (vehicles.length === 0) return null;
  const id = resolveActiveGarageVehicleId(u, vehicles);
  if (!id) return null;
  return vehicles.find((v) => v && v.id === id) || null;
}
