// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { hashPassword, findAccountByEmail } from "../auth";
import { isDateInScheduledDays } from "../weekdays";

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
  if (accounts.length === 0) return [];

  // One query for every account's assignments instead of one query per
  // account (was N+1 — see listAssignmentsForAccount, still used by the
  // single-account read paths below).
  const allAssignments = await prisma.evaluatorAssignment.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) } },
    orderBy: { createdAt: "desc" },
    include: {
      hospital: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  const byAccount = new Map<string, AssignmentRow[]>();
  for (const row of allAssignments) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(serializeAssignment(row));
    byAccount.set(row.accountId, list);
  }

  return accounts.map((a) => ({ ...serializeAccount(a), assignments: byAccount.get(a.id) ?? [] }));
}

export interface EvaluatorsPageResult {
  rows: EvaluatorWithAssignments[];
  total: number;
  page: number;
  pageSize: number;
}

// Paginated + searchable variant of listEvaluators, for the admin
// /evaluators table — see listStudentsPage for why this is a separate
// function rather than changing listEvaluators' signature.
export async function listEvaluatorsPage(params: {
  search?: string;
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
}): Promise<EvaluatorsPageResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? 50;
  const search = params.search?.trim();

  const where = {
    role: "EVALUATOR" as const,
    ...(params.includeInactive ? {} : { active: true }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.account.count({ where }),
  ]);

  if (accounts.length === 0) return { rows: [], total, page, pageSize };

  const allAssignments = await prisma.evaluatorAssignment.findMany({
    where: { accountId: { in: accounts.map((a) => a.id) } },
    orderBy: { createdAt: "desc" },
    include: {
      hospital: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  const byAccount = new Map<string, AssignmentRow[]>();
  for (const row of allAssignments) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(serializeAssignment(row));
    byAccount.set(row.accountId, list);
  }

  return {
    rows: accounts.map((a) => ({ ...serializeAccount(a), assignments: byAccount.get(a.id) ?? [] })),
    total,
    page,
    pageSize,
  };
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

  // Both writes happen together or not at all — an evaluator account must
  // never exist without its first assignment (see this function's doc
  // comment above): a crash between two separate writes would otherwise
  // leave an orphaned login with nothing to grade.
  const { account, assignment } = await prisma.$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        email: data.email.trim(),
        passwordHash,
        name: data.name.trim(),
        role: "EVALUATOR",
      },
    });
    const assignment = await tx.evaluatorAssignment.create({
      data: {
        accountId: account.id,
        hospitalId: data.hospitalId,
        groupId: data.groupId ?? null,
      },
    });
    return { account, assignment };
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

// Whether this evaluator's assignments actually cover grading this group
// *at this specific hospital* — i.e. the hospital the group's rotation
// schedule says it's at on the date being graded, not just "is this group
// in my scope at all." An assignment with a null groupId covers every
// group at its hospital; one with a groupId only covers that group, and
// only while that group is actually at the assignment's hospital.
export async function canEvaluatorGradeGroupAtHospital(
  accountId: string,
  groupId: string,
  hospitalId: string
): Promise<boolean> {
  const assignments = await prisma.evaluatorAssignment.findMany({
    where: { accountId, active: true, hospitalId },
    select: { groupId: true },
  });
  return assignments.some((a) => a.groupId === null || a.groupId === groupId);
}

export interface EvaluatorStint {
  blockId: string;
  groupId: string;
  groupName: string;
  hospitalId: string;
  hospitalName: string;
  startDate: string;
  endDate: string;
  daysOfWeek: string | null;
  status: "past" | "current" | "future";
  studentCount: number;
}

// The evaluator's own rotation schedule — every RotationBlock their
// assignments actually cover (a specific group's blocks for a group-scoped
// assignment, or every block at the hospital for a hospital-wide one),
// chronological, with past/current/future status so an evaluator can see
// their whole assignment at a glance instead of only "who's scheduled
// today" on /my.
export async function getEvaluatorSchedule(accountId: string): Promise<EvaluatorStint[]> {
  const assignments = await prisma.evaluatorAssignment.findMany({
    where: { accountId, active: true },
    select: { hospitalId: true, groupId: true },
  });
  if (assignments.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const stints: EvaluatorStint[] = [];

  for (const a of assignments) {
    const blocks = await prisma.rotationBlock.findMany({
      where: a.groupId ? { groupId: a.groupId, active: true } : { hospitalId: a.hospitalId, active: true },
      orderBy: { startDate: "asc" },
      include: {
        hospital: { select: { name: true } },
        group: { select: { id: true, name: true, active: true, _count: { select: { students: { where: { active: true } } } } } },
      },
    });
    for (const b of blocks) {
      if (seen.has(b.id) || !b.group.active) continue;
      seen.add(b.id);
      stints.push({
        blockId: b.id,
        groupId: b.groupId,
        groupName: b.group.name,
        hospitalId: b.hospitalId,
        hospitalName: b.hospital.name,
        startDate: b.startDate,
        endDate: b.endDate,
        daysOfWeek: b.daysOfWeek,
        status: today < b.startDate ? "future" : today > b.endDate ? "past" : "current",
        studentCount: b.group._count.students,
      });
    }
  }

  stints.sort((x, y) => x.startDate.localeCompare(y.startDate));
  return stints;
}

export interface ScopedStudent {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  groupName: string;
  hospitalName: string;
  // Whether today is an actual scheduled attendance day (date range AND
  // weekday pattern both match) — distinct from just being within a
  // rotation block's date range, e.g. a weekend inside a 2-week stint.
  scheduledToday: boolean;
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
          },
        },
      },
    },
  });
  return rows
    .filter((r: any) => r.group !== null)
    .map((r: any) => {
      const blocks = r.group!.rotationBlocks as Array<{
        hospital: { name: string };
        daysOfWeek: string | null;
      }>;
      const scheduledBlock = blocks.find((b) => isDateInScheduledDays(today, b.daysOfWeek));
      return {
        id: r.id,
        universityNumber: r.universityNumber,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        groupName: r.group!.name,
        hospitalName: (scheduledBlock ?? blocks[0])?.hospital.name ?? "",
        scheduledToday: !!scheduledBlock,
      };
    });
}
