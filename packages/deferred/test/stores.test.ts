import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { kvStore, type KVLike } from "../src/stores/kv";
import { memoryStore } from "../src/stores/memory";
import { redisStore, type RedisLike } from "../src/stores/redis";
import { postgresStore, sqliteStore, type PostgresLike } from "../src/stores/sql";
import type { ClickRecord, Store } from "../src/types";

const T0 = 1_700_000_000_000;
const rec = (id: string, over: Partial<ClickRecord> = {}): ClickRecord => ({
  id,
  url: `https://example.com/${id}`,
  ts: T0,
  ipPrefix: "203.0.113.0/24",
  os: "ios",
  osMajor: "17",
  deviceClass: "phone",
  lang: "en",
  ...over,
});

// ---- Small in-memory stand-ins for the clients the KV, Redis and Postgres adapters talk to ----

function fakeKv(clock: () => number): KVLike {
  const data = new Map<string, { value: string; expires: number }>();
  const live = () => [...data].filter(([, v]) => v.expires > clock());
  return {
    async put(key, value, options) {
      data.set(key, { value, expires: clock() + (options?.expirationTtl ?? 1e9) * 1000 });
    },
    async get(key) {
      const v = data.get(key);
      return v && v.expires > clock() ? v.value : null;
    },
    async delete(key) {
      data.delete(key);
    },
    async list({ prefix, limit = 1000 }) {
      return {
        keys: live()
          .filter(([k]) => k.startsWith(prefix))
          .slice(0, limit)
          .map(([name]) => ({ name })),
      };
    },
  };
}

function fakeRedis(): RedisLike {
  const hashes = new Map<string, Map<string, string>>();
  return {
    async hset(key, field, value) {
      (hashes.get(key) ?? hashes.set(key, new Map()).get(key))?.set(field, value);
    },
    async hgetall(key) {
      return Object.fromEntries(hashes.get(key) ?? []);
    },
    async hdel(key, field) {
      hashes.get(key)?.delete(field);
    },
    async expire() {},
  };
}

/** Runs the exact statements postgresStore sends against an array, so the SQL and the parameter order are exercised. */
function fakePostgres(): PostgresLike & { rows: Record<string, unknown>[] } {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    async query(sql, p = []) {
      if (sql.startsWith("CREATE")) return { rows: [] };
      if (sql.startsWith("DELETE FROM deeplinker_clicks WHERE expires <= $1")) {
        for (let i = rows.length - 1; i >= 0; i--)
          if ((rows[i]?.expires as number) <= (p[0] as number)) rows.splice(i, 1);
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO deeplinker_clicks")) {
        const [id, prefix, url, ts, expires, os, os_major, device, lang] = p as [
          string,
          string,
          string,
          number,
          number,
          string,
          string,
          string,
          string,
        ];
        if (!rows.some((r) => r.id === id))
          rows.push({ id, prefix, url, ts, expires, os, os_major, device, lang });
        return { rows: [] };
      }
      if (sql.includes("WHERE prefix = $1 AND expires > $2 ORDER BY ts DESC LIMIT 50")) {
        const found = rows
          .filter((r) => r.prefix === p[0] && (r.expires as number) > (p[1] as number))
          .sort((a, b) => (b.ts as number) - (a.ts as number));
        return { rows: found.slice(0, 50).map((r) => ({ ...r, ts: String(r.ts) })) }; // pg returns bigint as a string
      }
      if (sql.startsWith("DELETE FROM deeplinker_clicks WHERE id = $1")) {
        const i = rows.findIndex((r) => r.id === p[0]);
        if (i >= 0) rows.splice(i, 1);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

// ---- One contract, every adapter ----

let clockValue = T0;
const clock = () => clockValue;

const adapters: [string, () => Store | Promise<Store>][] = [
  ["memory", () => memoryStore()],
  ["sqlite (real, node:sqlite)", () => sqliteStore(new DatabaseSync(":memory:"))],
  ["kv (fake)", () => kvStore(fakeKv(clock))],
  ["redis (fake)", () => redisStore(fakeRedis())],
  [
    "postgres (fake client)",
    async () => {
      const store = postgresStore(fakePostgres());
      await store.init();
      return store;
    },
  ],
];

describe.each(adapters)("storage adapter: %s", (_name, make) => {
  const fresh = async () => {
    clockValue = T0;
    return make();
  };

  it("returns what was put, with every field intact", async () => {
    const store = await fresh();
    const r = rec("a", {
      url: "https://example.com/p?x=1&x=2#h",
      lang: "fr",
      os: "android",
      osMajor: "13",
      deviceClass: "tablet",
    });
    await store.put(r, 3600);
    expect(await store.findByPrefix(r.ipPrefix, T0)).toEqual([r]);
  });

  it("only returns records for the prefix asked about", async () => {
    const store = await fresh();
    await store.put(rec("a"), 3600);
    await store.put(rec("b", { ipPrefix: "198.51.100.0/24" }), 3600);
    expect((await store.findByPrefix("203.0.113.0/24", T0)).map((r) => r.id)).toEqual(["a"]);
    expect(await store.findByPrefix("192.0.2.0/24", T0)).toEqual([]);
  });

  it("returns newest first", async () => {
    const store = await fresh();
    await store.put(rec("old", { ts: T0 }), 3600);
    await store.put(rec("new", { ts: T0 + 5000 }), 3600);
    await store.put(rec("mid", { ts: T0 + 2000 }), 3600);
    expect((await store.findByPrefix("203.0.113.0/24", T0 + 6000)).map((r) => r.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("stops returning a record once its time to live has passed", async () => {
    const store = await fresh();
    await store.put(rec("a"), 3600);
    expect(await store.findByPrefix("203.0.113.0/24", T0 + 3599_000)).toHaveLength(1);
    clockValue = T0 + 3601_000;
    expect(await store.findByPrefix("203.0.113.0/24", T0 + 3601_000)).toEqual([]);
  });

  it("delete removes exactly that record", async () => {
    const store = await fresh();
    await store.put(rec("a"), 3600);
    await store.put(rec("b"), 3600);
    await store.delete("a", "203.0.113.0/24");
    expect((await store.findByPrefix("203.0.113.0/24", T0)).map((r) => r.id)).toEqual(["b"]);
    await store.delete("missing", "203.0.113.0/24");
  });

  it("putting the same id twice keeps one record", async () => {
    const store = await fresh();
    await store.put(rec("a"), 3600);
    await store.put(rec("a"), 3600);
    expect(await store.findByPrefix("203.0.113.0/24", T0)).toHaveLength(1);
  });

  it("returns at most 50 records", async () => {
    const store = await fresh();
    for (let i = 0; i < 60; i++) await store.put(rec(`r${i}`, { ts: T0 + i }), 3600);
    expect((await store.findByPrefix("203.0.113.0/24", T0 + 100)).length).toBe(50);
  });
});

describe("adapter details", () => {
  it("KV never asks for an expiry under its 60 second minimum", async () => {
    const seen: (number | undefined)[] = [];
    const kv: KVLike = { ...fakeKv(clock), put: async (_k, _v, o) => void seen.push(o?.expirationTtl) };
    await kvStore(kv).put(rec("a"), 5);
    expect(seen).toEqual([60]);
  });

  it("Redis clears expired records whenever a click is added, even though the newer click keeps the hash alive", async () => {
    const redis = fakeRedis();
    const store = redisStore(redis);
    await store.put(rec("old", { ts: T0 }), 60);
    await store.put(rec("new", { ts: T0 + 100_000 }), 60);
    expect(Object.keys(await redis.hgetall("deeplinker:203.0.113.0/24"))).toEqual(["new"]);
  });

  it("Redis never returns an expired record, and drops it when it looks", async () => {
    const redis = fakeRedis();
    const store = redisStore(redis);
    const key = "deeplinker:203.0.113.0/24";
    await redis.hset(key, "old", JSON.stringify({ ...rec("old", { ts: T0 }), expires: T0 + 60_000 }));
    await redis.hset(
      key,
      "new",
      JSON.stringify({ ...rec("new", { ts: T0 + 100_000 }), expires: T0 + 160_000 }),
    );
    expect((await store.findByPrefix("203.0.113.0/24", T0 + 100_000)).map((r) => r.id)).toEqual(["new"]);
    expect(Object.keys(await redis.hgetall(key))).toEqual(["new"]);
  });

  it("the memory store drops expired clicks when one is added, not only when one is looked up", async () => {
    const store = memoryStore();
    for (let i = 0; i < 100; i++) await store.put(rec(`c${i}`, { ts: T0 + i * 120_000 }), 60);
    // Looking "as of" T0 hides nothing by expiry, so only what the puts already swept is missing.
    expect((await store.findByPrefix("203.0.113.0/24", T0)).map((r) => r.id)).toEqual(["c99"]);
  });

  it("SQL stores clear expired rows whenever a click is added", async () => {
    const pg = fakePostgres();
    const store = postgresStore(pg);
    await store.put(rec("old", { ts: T0 }), 60);
    await store.put(rec("new", { ts: T0 + 120_000 }), 60);
    expect(pg.rows.map((r) => r.id)).toEqual(["new"]);
  });
});
