// Typed queries (Drizzle ORM) over any SqlExecutor, so the same query code
// runs in the desktop app and in tests.
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type { SqlExecutor } from "./executor";
import * as schema from "./schema";

export type EvaDb = SqliteRemoteDatabase<typeof schema>;

export function drizzleFor(db: SqlExecutor): EvaDb {
  return drizzle(
    async (sql, params, method) => {
      if (method === "run") {
        await db.run(sql, params);
        return { rows: [] };
      }
      const rows = await db.values(sql, params);
      return { rows: method === "get" ? (rows[0] ?? []) : rows } as { rows: unknown[] };
    },
    { schema }
  );
}
