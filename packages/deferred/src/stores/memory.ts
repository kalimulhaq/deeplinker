import type { ClickRecord, Store } from "../types";

/** In-process storage. For development and tests only: serverless functions do not share memory between requests. */
export function memoryStore(): Store {
  const records = new Map<string, ClickRecord & { expires: number }>();
  return {
    async put(record, ttlSeconds) {
      // Sweep on every click, not only on lookups: a server that gets clicks but few matches must not grow without bound.
      for (const [id, { expires }] of records) if (expires <= record.ts) records.delete(id);
      records.set(record.id, { ...record, expires: record.ts + ttlSeconds * 1000 });
    },
    async findByPrefix(prefix, now) {
      const found: ClickRecord[] = [];
      for (const [id, { expires, ...record }] of records) {
        if (expires <= now) records.delete(id);
        else if (record.ipPrefix === prefix) found.push(record);
      }
      return found.sort((a, b) => b.ts - a.ts).slice(0, 50);
    },
    async delete(id) {
      records.delete(id);
    },
  };
}
