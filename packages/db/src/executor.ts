// The smallest interface the database code needs from "a SQLite
// connection". The desktop app implements it over its Rust side
// (apps/desktop/src-tauri/src/db.rs); tests and scripts implement it with
// better-sqlite3. Nothing in packages/db talks to a driver directly.
export interface SqlExecutor {
  /** Runs a script of one or more statements (no results). */
  exec(sql: string): Promise<void>;
  /** Runs one statement and returns its rows as objects. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs one statement and returns its rows as arrays (column order). */
  values(sql: string, params?: unknown[]): Promise<unknown[][]>;
  /** Runs one statement that changes data. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /**
   * Runs several data-changing statements as ONE transaction: all of them
   * or none. Every multi-row change in Eva goes through here, so a crash
   * or an error mid-way can never leave half a change behind.
   */
  batch(statements: Statement[]): Promise<void>;
}

export interface Statement {
  sql: string;
  params?: unknown[];
}
