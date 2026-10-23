import type { ClickRecord, Store } from "../types";

/** The part of Cloudflare's KV namespace binding this uses. */
export interface KVLike {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
}

const key = (prefix: string, id: string) => `click:${prefix}:${id}`;

/** Cloudflare KV. KV expires entries itself; its minimum expiry is 60 seconds. */
export function kvStore(kv: KVLike): Store {
  return {
    async put(record, ttlSeconds) {
      await kv.put(key(record.ipPrefix, record.id), JSON.stringify(record), {
        expirationTtl: Math.max(60, ttlSeconds),
      });
    },
    async findByPrefix(prefix) {
      const { keys } = await kv.list({ prefix: `click:${prefix}:`, limit: 50 });
      const records = await Promise.all(keys.map(async (k) => kv.get(k.name)));
      return records
        .filter((r): r is string => r !== null)
        .map((r) => JSON.parse(r) as ClickRecord)
        .sort((a, b) => b.ts - a.ts);
    },
    async delete(id, prefix) {
      await kv.delete(key(prefix, id));
    },
  };
}
