// Versioned schema migrations. Each migration is a SQL script with a
// sortable name ("0000_init", "0001_..."), applied once, in order, each in
// its own transaction, and recorded in the `_migrations` table. A database
// file therefore always knows exactly which schema version it has, and an
// older file (e.g. restored from a backup) is upgraded on open.
import type { SqlExecutor } from "./executor";
import { MIGRATIONS } from "./migrations";

export interface Migration {
  name: string;
  sql: string;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS "_migrations" (
  "name" TEXT PRIMARY KEY NOT NULL,
  "appliedAt" TEXT NOT NULL
)`;

export async function appliedMigrations(db: SqlExecutor): Promise<string[]> {
  await db.exec(LEDGER);
  const rows = await db.query<{ name: string }>(`SELECT "name" FROM "_migrations" ORDER BY "name"`);
  return rows.map((r) => r.name);
}

export async function pendingMigrations(db: SqlExecutor, all: Migration[] = MIGRATIONS): Promise<Migration[]> {
  const done = new Set(await appliedMigrations(db));
  const unknown = [...done].filter((n) => !all.some((m) => m.name === n));
  if (unknown.length > 0) {
    // The file was written by a NEWER version of the app. Refuse to touch
    // it instead of guessing: the user must update the app.
    throw new Error(`قاعدة البيانات أحدث من هذا الإصدار من التطبيق (${unknown.join(", ")}) — حدّث التطبيق`);
  }
  return [...all].sort((a, b) => a.name.localeCompare(b.name)).filter((m) => !done.has(m.name));
}

// Drizzle-kit separates statements with this marker.
const BREAK = /-->\s*statement-breakpoint/g;

/**
 * Applies every pending migration, each atomically (all of it or none of
 * it). The caller takes a backup first when the file already has data
 * (see backup.ts `shouldBackupBeforeMigrating`).
 */
export async function migrate(db: SqlExecutor, all: Migration[] = MIGRATIONS): Promise<string[]> {
  const pending = await pendingMigrations(db, all);
  for (const m of pending) {
    const body = m.sql.replace(BREAK, "");
    const stamp = new Date().toISOString();
    try {
      await db.exec(`BEGIN IMMEDIATE;\n${body}\n;INSERT INTO "_migrations" ("name","appliedAt") VALUES ('${m.name.replace(/'/g, "''")}','${stamp}');\nCOMMIT;`);
    } catch (err) {
      await db.exec("ROLLBACK").catch(() => undefined);
      throw new Error(`فشل ترقية قاعدة البيانات (${m.name}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return pending.map((m) => m.name);
}
