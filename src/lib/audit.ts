// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "./db";

export type EntityType =
  | "Student"
  | "Group"
  | "Hospital"
  | "StudyType"
  | "Evaluator"
  | "EvaluatorAssignment"
  | "Evaluation"
  | "RubricSection"
  | "StudentAccount"
  | "Course"
  | "RotationBlock";
export type AuditAction = "create" | "update" | "deactivate" | "reactivate" | "delete";

export async function recordAudit(params: {
  actorId: string | null;
  entityType: EntityType;
  entityId: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      before: params.before !== undefined ? JSON.stringify(params.before) : null,
      after: params.after !== undefined ? JSON.stringify(params.after) : null,
    },
  });
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: string | null;
  after: string | null;
  createdAt: string;
  actorName: string | null;
}

export async function listAuditLog(limit = 200): Promise<AuditLogRow[]> {
  const rows = await prisma.auditLog.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { name: true } } },
  });
  return rows.map((r: any) => ({
    id: r.id,
    actorId: r.actorId,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    before: r.before,
    after: r.after,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actor?.name ?? null,
  }));
}
