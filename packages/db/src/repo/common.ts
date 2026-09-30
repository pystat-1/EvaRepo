// Shared plumbing for the repositories (the functions the desktop screens
// call). Reads use Drizzle directly. Writes are collected into a Plan and
// run with executor.batch(): one transaction, all or nothing, always
// including its audit-log entry.
import type { SqlExecutor, Statement } from "../executor";
import { drizzleFor, type EvaDb } from "../drizzle";
import { auditLog } from "../schema";

export interface Repo {
  exec: SqlExecutor;
  db: EvaDb;
}

export function repo(exec: SqlExecutor): Repo {
  return { exec, db: drizzleFor(exec) };
}

export const newId = () => crypto.randomUUID();
export const nowISO = () => new Date().toISOString();

/** A write that can be turned into SQL (any Drizzle insert/update/delete). */
type Buildable = { toSQL(): { sql: string; params: unknown[] } };

export class Plan {
  readonly statements: Statement[] = [];
  constructor(private readonly r: Repo) {}

  add(q: Buildable): this {
    const { sql, params } = q.toSQL();
    this.statements.push({ sql, params });
    return this;
  }

  raw(sql: string, params: unknown[] = []): this {
    this.statements.push({ sql, params });
    return this;
  }

  /** Audit entry recorded in the same transaction as the change. */
  audit(entityType: string, entityId: string, action: string, before?: unknown, after?: unknown): this {
    return this.add(
      this.r.db.insert(auditLog).values({
        id: newId(),
        actorId: null,
        entityType,
        entityId,
        action,
        before: before === undefined ? null : JSON.stringify(before),
        after: after === undefined ? null : JSON.stringify(after),
        createdAt: nowISO(),
      })
    );
  }

  async commit(): Promise<void> {
    if (this.statements.length > 0) await this.r.exec.batch(this.statements);
  }
}

/** A user-facing validation problem (Arabic message, shown as-is). */
export class ValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}
