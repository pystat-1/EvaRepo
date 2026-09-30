// SqlExecutor over better-sqlite3 (Node only): used by tests and by the
// one-time export script. The desktop app uses its Rust side instead.
import Database from "better-sqlite3";
import type { SqlExecutor } from "./executor";

// SQLite has no boolean or Date type: store true/false as 1/0.
const bind = (params: unknown[] = []) => params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));

export function openBetterSqlite(file: string): { db: Database.Database; exec: SqlExecutor } {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const exec: SqlExecutor = {
    async exec(sql) {
      db.exec(sql);
    },
    async query(sql, params) {
      return db.prepare(sql).all(...bind(params)) as never[];
    },
    async values(sql, params) {
      const stmt = db.prepare(sql);
      return stmt.reader ? (stmt.raw().all(...bind(params)) as unknown[][]) : (stmt.run(...bind(params)), []);
    },
    async run(sql, params) {
      return { changes: db.prepare(sql).run(...bind(params)).changes };
    },
    async batch(statements) {
      db.transaction(() => {
        for (const s of statements) db.prepare(s.sql).run(...bind(s.params));
      })();
    },
  };
  return { db, exec };
}
