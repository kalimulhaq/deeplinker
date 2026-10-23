import type { ClickRecord, Store } from "../types";

/** Rows as the SQL stores read them. */
interface Row {
  id: string;
  prefix: string;
  url: string;
  ts: number | string;
  os: string;
  os_major: string;
  device: string;
  lang: string;
}

const toRecord = (row: Row): ClickRecord => ({
  id: row.id,
  ipPrefix: row.prefix,
  url: row.url,
  ts: Number(row.ts),
  os: row.os,
  osMajor: row.os_major,
  deviceClass: row.device,
  lang: row.lang,
});

const COLUMNS = "id, prefix, url, ts, os, os_major, device, lang";

/** The part of a `better-sqlite3` or `node:sqlite` database this uses (they share these method names). */
export interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
}

/** SQLite. Creates its table on first use. Expired rows are removed whenever a click is added. */
export function sqliteStore(db: SqliteLike): Store {
  db.exec(
    `CREATE TABLE IF NOT EXISTS deeplinker_clicks (id TEXT PRIMARY KEY, prefix TEXT NOT NULL, url TEXT NOT NULL, ts INTEGER NOT NULL, expires INTEGER NOT NULL, os TEXT NOT NULL, os_major TEXT NOT NULL, device TEXT NOT NULL, lang TEXT NOT NULL);` +
      `CREATE INDEX IF NOT EXISTS deeplinker_clicks_prefix ON deeplinker_clicks (prefix, ts DESC);`,
  );
  return {
    async put(r, ttlSeconds) {
      db.prepare("DELETE FROM deeplinker_clicks WHERE expires <= ?").run(r.ts);
      db.prepare(
        "INSERT OR IGNORE INTO deeplinker_clicks (id, prefix, url, ts, expires, os, os_major, device, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(r.id, r.ipPrefix, r.url, r.ts, r.ts + ttlSeconds * 1000, r.os, r.osMajor, r.deviceClass, r.lang);
    },
    async findByPrefix(prefix, now) {
      const rows = db
        .prepare(
          `SELECT ${COLUMNS} FROM deeplinker_clicks WHERE prefix = ? AND expires > ? ORDER BY ts DESC LIMIT 50`,
        )
        .all(prefix, now) as Row[];
      return rows.map(toRecord);
    },
    async delete(id) {
      db.prepare("DELETE FROM deeplinker_clicks WHERE id = ?").run(id);
    },
  };
}

/** The part of `pg`'s Pool or Client this uses. */
export interface PostgresLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** PostgreSQL. Call `await store.init()` once to create the table. Expired rows are removed whenever a click is added. */
export function postgresStore(db: PostgresLike): Store & { init(): Promise<void> } {
  return {
    async init() {
      await db.query(
        "CREATE TABLE IF NOT EXISTS deeplinker_clicks (id text PRIMARY KEY, prefix text NOT NULL, url text NOT NULL, ts bigint NOT NULL, expires bigint NOT NULL, os text NOT NULL, os_major text NOT NULL, device text NOT NULL, lang text NOT NULL)",
      );
      await db.query(
        "CREATE INDEX IF NOT EXISTS deeplinker_clicks_prefix ON deeplinker_clicks (prefix, ts DESC)",
      );
    },
    async put(r, ttlSeconds) {
      await db.query("DELETE FROM deeplinker_clicks WHERE expires <= $1", [r.ts]);
      await db.query(
        "INSERT INTO deeplinker_clicks (id, prefix, url, ts, expires, os, os_major, device, lang) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING",
        [r.id, r.ipPrefix, r.url, r.ts, r.ts + ttlSeconds * 1000, r.os, r.osMajor, r.deviceClass, r.lang],
      );
    },
    async findByPrefix(prefix, now) {
      const { rows } = await db.query(
        `SELECT ${COLUMNS} FROM deeplinker_clicks WHERE prefix = $1 AND expires > $2 ORDER BY ts DESC LIMIT 50`,
        [prefix, now],
      );
      return (rows as Row[]).map(toRecord);
    },
    async delete(id) {
      await db.query("DELETE FROM deeplinker_clicks WHERE id = $1", [id]);
    },
  };
}
