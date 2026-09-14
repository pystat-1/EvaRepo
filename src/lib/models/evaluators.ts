// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { hashPassword, findAccountByEmail } from "../auth";

export interface EvaluatorAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentRow {
  id: string;
  accountId: string;
  hospitalId: string;
  hospitalName: string;
  groupId: string | null;
  groupName: string | null;
  active: boolean;
  createdAt: string;
}

export interface EvaluatorWithAssignments extends EvaluatorAccount {
  assignments: AssignmentRow[];
}

function serializeAccount(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): EvaluatorAccount {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeAssignment(row: {
  id: string;
  accountId: string;
  hospitalId: string;
  hospital: { name: string };
  groupId: string | null;
  group: { name: string } | null;
  active: boolean;
  createdAt: Date;
}): AssignmentRow {
  return {
    id: row.id,
    accountId: row.accountId,
    hospitalId: row.hospitalId,
    hospitalName: row.hospital.name,
    groupId: row.groupId,
    groupName: row.group?.name ?? null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

async function listAssignmentsForAccount(accountId: string): Promise<AssignmentRow[]> {
  const rows = await prisma.evaluatorAssignment.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    include: {
      hospital: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  return rows.map(serializeAssignment);
}

export async function listEvaluators(includeInactive = false): Promise<EvaluatorWithAssignments[]> {
  const accounts = await prisma.account.findMany({
    where: includeInactive ? { role: "EVALUATOR" } : { role: "EVALUATOR", active: true },
    orderBy: { name: "asc" },
  });
  return Promise.all(
    accounts.map(async (a: any) => ({ ...serializeAccount(a), assignments: await listAssignmentsForAccount(a.id) }))
  );
}

export async function getEvaluator(accountId: string): Promise<EvaluatorWithAssignments | undefined> {
  const account = await prisma.account.findFirst({ where: { id: accountId, role: "EVALUATOR" } });
  if (!account) return undefined;
  return { ...serializeAccount(account), assignments: await listAssignmentsForAccount(account.id) };
}

export interface CreateEvaluatorInput {
  name: string;
  email: string;
  password: string;
  hospitalId: string;
  groupId?: string | null;
}

// Creates the evaluator's login (an Account with role EVALUATOR) and their
// first hospital/group assignment together, so an evaluator can never exist
// without a real scope — see plan §4 ("nothing in this phase can exist
// without a real hospital/group/student to attach to").
export async function createEvaluator(
  actorId: string,
  data: CreateEvaluatorInput
): Promise<EvaluatorWithAssignments> {
  if (!data.name?.trim()) throw new Error("الاسم مطلوب");
  if (!data.email?.trim()) throw new Error("البريد الإلكتروني مطلوب");
  if (!data.password || data.password.length < 8) {
    throw new Error("كلمة المرور يجب أن تكون ٨ أحرف على الأقل");
  }
  if (!data.hospitalId) throw new Error("المستشفى مطلوب");
  if (await findAccountByEmail(data.email.trim())) {
    throw new Error(`البريد الإلكتروني "${data.email}" مستخدم من قبل حساب آخر`);
  }

  const passwordHash = await hashPassword(data.password);

  const account = await prisma.account.create({
    data: {
      email: data.email.trim(),
      passwordHash,
      name: data.name.trim(),
      role: "EVALUATOR",
    },
  });

  const assignment = await prisma.evaluatorAssignment.create({
    data: {
      accountId: account.id,
      hospitalId: data.hospitalId,
      groupId: data.groupId ?? null,
    },
  });

  const created = (await getEvaluator(account.id))!;
  await recordAudit({ actorId, entityType: "Evaluator", entityId: account.id, action: "create", after: created });
  await recordAudit({
    actorId,
    entityType: "EvaluatorAssignment",
    entityId: assignment.id,
    action: "create",
    after: created.assignments.find((a) => a.id === assignment.id),
  });
  return created;
}

export async function toggleEvaluatorActive(
  actorId: string,
  accountId: string,
  active: boolean
): Promise<void> {
  const before = await getEvaluator(accountId);
  if (!before) throw new Error("Evaluator not found");
  await prisma.account.update({ where: { id: accountId }, data: { active } });
  const after = (await getEvaluator(accountId))!;
  await recordAudit({
    actorId,
    entityType: "Evaluator",
    entityId: accountId,
    action: active ? "reactivate" : "deactivate",
    before,
    after,
  });
}

export async function addAssignment(
  actorId: string,
  accountId: string,
  hospitalId: string,
  groupId?: string | null
): Promise<AssignmentRow> {
  if (!hospitalId) throw new Error("المستشفى مطلوب");
  const row = await prisma.evaluatorAssignment.create({
    data: { accountId, hospitalId, groupId: groupId ?? null },
    include: {
      hospital: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  const created = serializeAssignment(row);
  await recordAudit({ actorId, entityType: "EvaluatorAssignment", entityId: created.id, action: "create", after: created });
  return created;
}

export async function toggleAssignmentActive(
  actorId: string,
  assignmentId: string,
  active: boolean
): Promise<void> {
  const row = await prisma.evaluatorAssignment.findUnique({ where: { id: assignmentId } });
  if (!row) throw new Error("Assignment not found");
  await prisma.evaluatorAssignment.update({ where: { id: assignmentId }, data: { active } });
  const after = (await listAssignmentsForAccount(row.accountId)).find((a) => a.id === assignmentId);
  await recordAudit({
    actorId,
    entityType: "EvaluatorAssignment",
    entityId: assignmentId,
    action: active ? "reactivate" : "deactivate",
    after,
  });
}

// --- Scoping: the server-side enforcement described in plan §2.4/§4.2 ---
// "which hospital's data is this" is a property of the logged-in account,
// derived here from evaluator_assignments — never from anything the client
// sends. A null groupId on an assignment means "every group at this
// hospital, current and future," which is why this resolves group ids at
// read time rather than storing a frozen list.
export async function getScopedGroupIds(accountId: string): Promise<string[]> {
  const assignments = await prisma.evaluatorAssignment.findMany({
    where: { accountId, active: true },
    select: { hospitalId: true, groupId: true },
  });

  const today = new Date().toISOString().slice(0, 10);
  const groupIds = new Set<string>();
  for (const a of assignments) {
    if (a.groupId) {
      groupIds.add(a.groupId);
    } else {
      // No specific group on the assignment: "every group currently at
      // this hospital," resolved from today's rotation blocks rather than
      // a static hospital link, since a group's hospital changes as it
      // rotates.
      const blocks = await prisma.rotationBlock.findMany({
        where: { hospitalId: a.hospitalId, active: true, startDate: { lte: today }, endDate: { gte: today } },
        select: { groupId: true },
      });
      blocks.forEach((b) => groupIds.add(b.groupId));
    }
  }
  return Array.from(groupIds);
}

export interface ScopedStudent {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  groupName: string;
  hospitalName: string;
}

export async function getScopedStudents(accountId: string): Promise<ScopedStudent[]> {
  const groupIds = await getScopedGroupIds(accountId);
  if (groupIds.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const rows = await prisma.student.findMany({
    where: { groupId: { in: groupIds }, active: true },
    orderBy: { nameAr: "asc" },
    include: {
      group: {
        include: {
          rotationBlocks: {
            where: { active: true, startDate: { lte: today }, endDate: { gte: today } },
            include: { hospital: { select: { name: true } } },
            take: 1,
          },
        },
      },
    },
  });
  return rows
    .filter((r: any) => r.group !== null)
    .map((r: any) => ({
      id: r.id,
      universityNumber: r.universityNumber,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      groupName: r.group!.name,
      hospitalName: r.group!.rotationBlocks[0]?.hospital.name ?? "",
    }));
}
