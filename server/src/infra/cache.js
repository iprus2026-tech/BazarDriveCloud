// /server/src/infra/cache.js — createCache(): a real Redis client when REDIS_URL is set,
// else a no-op in-memory Map fallback (ADR BD-DOCS-041: "deferred in capability, present
// in structure"). Phase 1 has NO cache consumer — Redis is scoped to Presence/Matching/
// Route&Price (#2/#3/#4, BD-DOCS-033) — so dev/CI need no Redis. Decorated as
// fastify.cache; Phase 2 just *starts using* the singleton.
export function createCache(config) {
  if (config.redisUrl) {
    // Honest failure: an operator configured Redis, but no driver is wired yet. Failing
    // loud beats silently degrading to an in-memory cache that won't survive >1 instance.
    throw new Error(
      'REDIS_URL is set but the Redis cache driver is not wired yet (Phase 2 / BD-DOCS-033)',
    );
  }
  const map = new Map();
  return {
    kind: 'memory',
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, value) { map.set(key, value); },
    async del(key) { map.delete(key); },
    async clear() { map.clear(); },
  };
}
