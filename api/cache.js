function createTtlCache(defaultTtlMs = 30000) {
  const store = new Map();
  return {
    get(key, fn, ttlMs = defaultTtlMs) {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > now) return hit.value;
      const value = fn();
      store.set(key, { value, expiresAt: now + ttlMs });
      if (value && typeof value.then === 'function') value.catch(() => store.delete(key));
      return value;
    },
    clear() {
      store.clear();
    }
  };
}

module.exports = { createTtlCache };
