const KEY = 'bazardrive.user.v1';

const defaults = {
  welcomeSeen: false,
  onboarded: false,
  displayName: null,
  city: null,
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
