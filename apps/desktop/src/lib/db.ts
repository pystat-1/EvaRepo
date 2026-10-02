// Bridge from the React side to the database owned by the Rust side
// (src-tauri/src/db.rs). Everything else in the app talks to `exec`,
// `orm` and `backups` from here, never to `invoke` directly.
import { invoke } from "@tauri-apps/api/core";
import type { SqlExecutor } from "@eva/db/executor";
import type { BackupApi } from "@eva/db/startup";
import { drizzleFor } from "@eva/db/drizzle";

// SQLite has no boolean type: store true/false as 1/0.
const bind = (params: unknown[] = []) => params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));

export const exec: SqlExecutor = {
  exec: (sql) => invoke("db_exec", { sql }),
  query: (sql, params) => invoke("db_query", { sql, params: bind(params) }),
  values: (sql, params) => invoke("db_values", { sql, params: bind(params) }),
  run: async (sql, params) => ({ changes: await invoke<number>("db_run", { sql, params: bind(params) }) }),
  batch: (statements) => invoke("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: bind(s.params) })) }),
};

export const orm = drizzleFor(exec);

export interface DbInfo {
  path: string;
  backups_dir: string;
  created: boolean;
}

export const openDatabase = () => invoke<DbInfo>("db_open");

export interface BackupEntry {
  name: string;
  size: number;
}

export const backups: BackupApi & {
  entries(): Promise<BackupEntry[]>;
  restore(name: string): Promise<void>;
  importFile(path: string): Promise<void>;
} = {
  integrity: () => invoke<string>("db_integrity"),
  create: async (name) => void (await invoke<number>("backup_create", { name })),
  list: async () => (await invoke<BackupEntry[]>("backup_list")).map((b) => b.name),
  remove: async (names) => void (await invoke<number>("backup_delete", { names })),
  entries: () => invoke<BackupEntry[]>("backup_list"),
  restore: (name) => invoke("backup_restore", { name }),
  importFile: (path) => invoke("db_import_file", { path }),
};
