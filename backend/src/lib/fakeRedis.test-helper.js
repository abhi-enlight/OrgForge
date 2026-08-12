/**
 * Shared test fake: an ioredis-shaped client supporting the subset the
 * conversation store uses (set with NX/PX/EX, get, del, exists) with a
 * controllable clock for TTL assertions.
 *
 * @param {{ now: () => number }} [clock]
 */
export function fakeRedis(clock = { now: () => Date.now() }) {
  const data = new Map();
  return {
    data,
    async set(key, value, ...args) {
      const opts = { nx: false, ttlMs: 0 };
      for (let i = 0; i < args.length; i += 2) {
        if (args[i] === 'NX') opts.nx = true;
        else if (args[i] === 'PX') opts.ttlMs = Number(args[i + 1]);
        else if (args[i] === 'EX') opts.ttlMs = Number(args[i + 1]) * 1000;
      }
      const now = clock.now();
      const existing = data.get(key);
      if (opts.nx && existing && existing.expiresAt > now) return null;
      data.set(key, { value, expiresAt: now + opts.ttlMs });
      return 'OK';
    },
    async get(key) {
      const entry = data.get(key);
      if (!entry) return null;
      if (entry.expiresAt && clock.now() > entry.expiresAt) {
        data.delete(key);
        return null;
      }
      return entry.value;
    },
    async del(...keys) {
      let n = 0;
      for (const key of keys) {
        if (data.delete(key)) n++;
      }
      return n;
    },
    async exists(key) {
      const entry = data.get(key);
      if (!entry) return 0;
      if (entry.expiresAt && clock.now() > entry.expiresAt) {
        data.delete(key);
        return 0;
      }
      return 1;
    },
    /**
     * The store's single Lua script (atomic owner-checked release): delete the
     * key only when it still holds the given token. Hardcoded to that one
     * shape — the fake only needs to honor the release contract, not Lua.
     */
    async eval(script, numKeys, ...args) {
      const [key, token] = args;
      const current = await this.get(key);
      if (current === token) {
        await this.del(key);
        return 1;
      }
      return 0;
    },
  };
}
