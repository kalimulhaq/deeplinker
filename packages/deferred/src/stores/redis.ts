import type { ClickRecord, Store } from "../types";

/** The few Redis commands this needs, in one shape. Adapt `redis` (v4: hSet, hGetAll, hDel) or `ioredis` to it. */
export interface RedisLike {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const hashKey = (prefix: string) => `deeplinker:${prefix}`;

/**
 * Redis. One hash per IP prefix; the hash expires `ttl` after the latest click, and each record carries its own expiry.
 * Expired records are never returned, and they are deleted whenever a click is recorded or looked up for that prefix, so
 * a newer click that keeps the hash alive cannot keep an old record alive with it.
 */
export function redisStore(redis: RedisLike): Store {
  /** The records of one prefix that have not expired; the ones that have are removed. */
  async function live(key: string, now: number): Promise<ClickRecord[]> {
    const fresh: ClickRecord[] = [];
    for (const [field, raw] of Object.entries(await redis.hgetall(key))) {
      const { expires, ...record } = JSON.parse(raw) as ClickRecord & { expires: number };
      if (expires <= now) await redis.hdel(key, field);
      else fresh.push(record);
    }
    return fresh;
  }

  return {
    async put(record, ttlSeconds) {
      const key = hashKey(record.ipPrefix);
      await live(key, record.ts);
      await redis.hset(key, record.id, JSON.stringify({ ...record, expires: record.ts + ttlSeconds * 1000 }));
      await redis.expire(key, ttlSeconds);
    },
    async findByPrefix(prefix, now) {
      return (await live(hashKey(prefix), now)).sort((a, b) => b.ts - a.ts).slice(0, 50);
    },
    async delete(id, prefix) {
      await redis.hdel(hashKey(prefix), id);
    },
  };
}
