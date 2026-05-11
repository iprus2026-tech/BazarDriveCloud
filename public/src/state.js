const KEY = 'bazardrive.user.v1';

const defaults = {
  // v1
  welcomeSeen: false,
  onboarded: false,
  displayName: null,
  city: null,
  // v2 — BD-ONBOARDING-01
  role: null,        // 'passenger' | 'driver' | 'guest'
  phone: null,
  firstName: null,
  lastName: null,
  vehicleMake: null,
  vehicleModel: null,
  vehicleYear: null,
  vehiclePlate: null,
  vehicleColor: null,
  vehicleBody: null,
  // v3 — BD-PROFILE-01
  driverOnline: false,
  notificationsEnabled: false,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    cache = { ...defaults };
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable (private mode, quota) — fail soft.
  }
}

export const user = {
  get() { return { ...load() }; },
  set(patch) {
    load();
    cache = { ...cache, ...patch };
    persist();
  },
  reset() {
    cache = { ...defaults };
    persist();
  },
};
