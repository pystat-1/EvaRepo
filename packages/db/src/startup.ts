// What happens every time Eva Desktop opens its database (docs/FLOWS.md §5):
//   1. integrity check: a damaged file is never migrated or written to;
//      the user is offered a restore instead
//   2. back up before any schema upgrade (if the file already has data)
//   3. apply pending migrations
//   4. daily backup if the newest is 24 h old
//   5. delete backups the retention policy no longer needs
// Written against small interfaces so it is tested with a real SQLite file
// in Node and runs unchanged in the app (apps/desktop/src/lib/db.ts).
import type { SqlExecutor } from "./executor";
import { appliedMigrations, migrate, pendingMigrations, type Migration } from "./migrate";
import { MIGRATIONS } from "./migrations";
import { backupFileName, backupsToDelete, isDailyBackupDue, shouldBackupBeforeMigrating, type BackupReason } from "./backup";

export interface BackupApi {
  integrity(): Promise<string>;
  create(name: string): Promise<void>;
  list(): Promise<string[]>;
  remove(names: string[]): Promise<void>;
}

export type StartupResult =
  | { ok: true; migrated: string[]; backupsTaken: string[]; backupsDeleted: number; schemaVersion: string }
  | { ok: false; reason: "damaged"; detail: string }
  | { ok: false; reason: "too-new" | "migration-failed"; detail: string; backupsTaken: string[] };

export async function takeBackup(api: BackupApi, reason: BackupReason, now = new Date()): Promise<string> {
  const name = backupFileName(now, reason);
  await api.create(name);
  return name;
}

export async function startup(
  db: SqlExecutor,
  api: BackupApi,
  now = new Date(),
  migrations: Migration[] = MIGRATIONS
): Promise<StartupResult> {
  const integrity = await api.integrity();
  if (integrity !== "ok") return { ok: false, reason: "damaged", detail: integrity };

  const backupsTaken: string[] = [];
  let pending: Migration[];
  try {
    pending = await pendingMigrations(db, migrations);
  } catch (e) {
    return { ok: false, reason: "too-new", detail: e instanceof Error ? e.message : String(e), backupsTaken };
  }
  const applied = await appliedMigrations(db);
  if (shouldBackupBeforeMigrating(pending.length, applied.length)) {
    backupsTaken.push(await takeBackup(api, "before-migrate", now));
  }
  let migrated: string[];
  try {
    migrated = await migrate(db, migrations);
  } catch (e) {
    return { ok: false, reason: "migration-failed", detail: e instanceof Error ? e.message : String(e), backupsTaken };
  }

  // A second backup in the same second would collide; skip the daily one
  // if a pre-migration backup was just taken.
  let files = await api.list();
  if (backupsTaken.length === 0 && isDailyBackupDue(files, now)) {
    backupsTaken.push(await takeBackup(api, "daily", now));
    files = await api.list();
  }
  const stale = backupsToDelete(files, now);
  if (stale.length > 0) await api.remove(stale);

  const all = await appliedMigrations(db);
  return { ok: true, migrated, backupsTaken, backupsDeleted: stale.length, schemaVersion: all[all.length - 1] ?? "" };
}
