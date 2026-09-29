import { prisma } from "../db";
import { recordAudit } from "../audit";
import { pickPlacement, Placement } from "../evaluator/placement";
import { getEvaluatorSchedule } from "./evaluators";
import { listActiveStudentsInGroup } from "./students";
import { recomputeFlagsForStudent } from "./flags";
import { captureGradeToSheet } from "./sheetSync";

export type { Placement };

// Where this evaluator works with this group on this date: the scheduled
// hospital, or (for a day the schedule doesn't list) the hospital of the
// nearest rotation. Null = not one of this evaluator's groups around then.
export async function resolveGroupPlacement(
  accountId: string,
  groupId: string,
  dateISO: string
): Promise<Placement | null> {
  const stints = await getEvaluatorSchedule(accountId);
  return pickPlacement(stints, groupId, dateISO);
}

export interface WorkDay {
  groupId: string;
  dateISO: string;
  scheduled: boolean;
  validatedAt: string | null;
}

export async function getWorkDay(groupId: string, dateISO: string): Promise<WorkDay | null> {
  const row = await prisma.groupWorkDay.findUnique({ where: { groupId_dateISO: { groupId, dateISO } } });
  return row
    ? {
        groupId: row.groupId,
        dateISO: row.dateISO,
        scheduled: row.scheduled,
        validatedAt: row.validatedAt ? row.validatedAt.toISOString() : null,
      }
    : null;
}

export const DAY_VALIDATED_MESSAGE = "تم اعتماد درجات هذا اليوم لهذه المجموعة — لا يمكن التعديل إلا إذا أعادت الإدارة فتحه";

// Records that the group was worked with on this date (the first write of
// the day creates it) and refuses writes to a day already validated.
export async function ensureOpenWorkDay(
  actorId: string,
  groupId: string,
  dateISO: string,
  placement: Placement
): Promise<void> {
  const existing = await prisma.groupWorkDay.findUnique({ where: { groupId_dateISO: { groupId, dateISO } } });
  if (existing?.validatedAt) throw new Error(DAY_VALIDATED_MESSAGE);
  if (existing) return;
  await prisma.groupWorkDay.upsert({
    where: { groupId_dateISO: { groupId, dateISO } },
    create: {
      groupId,
      dateISO,
      hospitalId: placement.hospitalId,
      scheduled: placement.scheduled,
      startedById: actorId,
    },
    update: {},
  });
}

export interface ValidationGap {
  missingAttendance: string[];
  missingGrades: string[];
}

// اعتماد: every student needs an attendance mark and every student who
// isn't absent needs a grade. Then the day's evaluations are locked and
// released to the admin (pendingValidation = false), flags recomputed and
// the grades mirrored to the Sheets backup.
export async function validateWorkDay(
  actorId: string,
  groupId: string,
  dateISO: string,
  placement: Placement
): Promise<{ ok: true; count: number } | ({ ok: false } & ValidationGap)> {
  const day = await prisma.groupWorkDay.findUnique({ where: { groupId_dateISO: { groupId, dateISO } } });
  if (day?.validatedAt) throw new Error("تم اعتماد هذا اليوم مسبقًا");

  const students = await listActiveStudentsInGroup(groupId);
  const ids = students.map((s) => s.id);
  const [records, evaluations] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { studentId: { in: ids }, dateISO }, select: { studentId: true, status: true } }),
    prisma.evaluation.findMany({ where: { studentId: { in: ids }, dateISO }, select: { id: true, studentId: true, attendance: true } }),
  ]);
  const statusBy = new Map<string, string>();
  evaluations.forEach((e) => statusBy.set(e.studentId, e.attendance));
  records.forEach((r) => statusBy.set(r.studentId, r.status));
  const graded = new Set(evaluations.map((e) => e.studentId));

  const missingAttendance = students.filter((s) => !statusBy.has(s.id)).map((s) => s.nameAr);
  const missingGrades = students
    .filter((s) => statusBy.has(s.id) && statusBy.get(s.id) !== "absent" && !graded.has(s.id))
    .map((s) => s.nameAr);
  if (missingAttendance.length > 0 || missingGrades.length > 0) {
    return { ok: false, missingAttendance, missingGrades };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.evaluation.updateMany({
      where: { studentId: { in: ids }, dateISO },
      data: { pendingValidation: false, locked: true, lockedAt: now, lockedById: actorId },
    }),
    prisma.groupWorkDay.upsert({
      where: { groupId_dateISO: { groupId, dateISO } },
      create: {
        groupId,
        dateISO,
        hospitalId: placement.hospitalId,
        scheduled: placement.scheduled,
        startedById: actorId,
        validatedAt: now,
        validatedById: actorId,
      },
      update: { validatedAt: now, validatedById: actorId },
    }),
  ]);

  await recordAudit({
    actorId,
    entityType: "GroupWorkDay",
    entityId: `${groupId}:${dateISO}`,
    action: "update",
    after: { validated: true, evaluations: evaluations.length },
  });

  // Released to the admin now: flags and the Sheets backup only ever see
  // validated grades. Both are best-effort per student.
  for (const e of evaluations) {
    await recomputeFlagsForStudent(e.studentId);
    await captureGradeToSheet(e.studentId, dateISO);
  }
  return { ok: true, count: evaluations.length };
}

// Admin: reopen a validated day so its evaluator can correct it. The grades
// stay visible to the admin until the evaluator changes one again.
export async function reopenWorkDay(adminId: string, groupId: string, dateISO: string): Promise<void> {
  const students = await prisma.student.findMany({ where: { groupId }, select: { id: true } });
  const ids = students.map((s) => s.id);
  const now = new Date();
  await prisma.$transaction([
    prisma.evaluation.updateMany({
      where: { studentId: { in: ids }, dateISO },
      data: { locked: false, lockedAt: null, lockedById: null },
    }),
    prisma.groupWorkDay.update({
      where: { groupId_dateISO: { groupId, dateISO } },
      data: { validatedAt: null, validatedById: null, reopenedAt: now, reopenedById: adminId },
    }),
  ]);
  await recordAudit({
    actorId: adminId,
    entityType: "GroupWorkDay",
    entityId: `${groupId}:${dateISO}`,
    action: "update",
    after: { reopened: true },
  });
}

export interface PendingWorkDay {
  groupId: string;
  groupName: string;
  hospitalName: string | null;
  dateISO: string;
  scheduled: boolean;
  graded: number;
  students: number;
}

// Days worked but not validated yet, oldest first. Pass groupIds to limit
// to one evaluator's groups (their reminder); omit for the admin list.
export async function listPendingWorkDays(groupIds?: string[]): Promise<PendingWorkDay[]> {
  const days = await prisma.groupWorkDay.findMany({
    where: { validatedAt: null, ...(groupIds ? { groupId: { in: groupIds } } : {}) },
    orderBy: { dateISO: "asc" },
  });
  if (days.length === 0) return [];
  const groupIdsInDays = Array.from(new Set(days.map((d) => d.groupId)));
  const hospitalIds = Array.from(new Set(days.map((d) => d.hospitalId).filter((h): h is string => !!h)));
  const [groups, hospitals] = await Promise.all([
    prisma.group.findMany({
      where: { id: { in: groupIdsInDays } },
      select: { id: true, name: true, students: { where: { active: true }, select: { id: true } } },
    }),
    prisma.hospital.findMany({ where: { id: { in: hospitalIds } }, select: { id: true, name: true } }),
  ]);
  const groupBy = new Map(groups.map((g) => [g.id, g]));
  const hospitalBy = new Map(hospitals.map((h) => [h.id, h.name]));

  const out: PendingWorkDay[] = [];
  for (const d of days) {
    const g = groupBy.get(d.groupId);
    const ids = g?.students.map((s) => s.id) ?? [];
    const graded = ids.length
      ? await prisma.evaluation.count({ where: { studentId: { in: ids }, dateISO: d.dateISO } })
      : 0;
    out.push({
      groupId: d.groupId,
      groupName: g?.name ?? "—",
      hospitalName: d.hospitalId ? hospitalBy.get(d.hospitalId) ?? null : null,
      dateISO: d.dateISO,
      scheduled: d.scheduled,
      graded,
      students: ids.length,
    });
  }
  return out;
}

export async function listRecentValidatedWorkDays(limit = 30) {
  const days = await prisma.groupWorkDay.findMany({
    where: { validatedAt: { not: null } },
    orderBy: { validatedAt: "desc" },
    take: limit,
  });
  const groups = await prisma.group.findMany({
    where: { id: { in: Array.from(new Set(days.map((d) => d.groupId))) } },
    select: { id: true, name: true },
  });
  const nameBy = new Map(groups.map((g) => [g.id, g.name]));
  return days.map((d) => ({
    groupId: d.groupId,
    groupName: nameBy.get(d.groupId) ?? "—",
    dateISO: d.dateISO,
    scheduled: d.scheduled,
    validatedAt: d.validatedAt!.toISOString(),
  }));
}

export async function countPendingWorkDays(): Promise<number> {
  return prisma.groupWorkDay.count({ where: { validatedAt: null } });
}
