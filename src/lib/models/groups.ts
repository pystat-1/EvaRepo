// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { parseShiftCell, resolveCourseId, resolveStudyTypeId, type ImportResult } from "../importHelpers";

export type Shift = "MORNING" | "EVENING";

export interface Group {
  id: string;
  name: string;
  cycleLabel: string | null;
  courseId: string | null;
  shift: Shift | null;
  studyTypeId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupWithRelations extends Group {
  courseLabel: string | null;
  studyTypeName: string | null;
  studentCount: number;
  currentHospitalName: string | null;
}

function serialize(row: {
  id: string;
  name: string;
  cycleLabel: string | null;
  courseId: string | null;
  shift: string | null;
  studyTypeId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Group {
  return {
    id: row.id,
    name: row.name,
    cycleLabel: row.cycleLabel,
    courseId: row.courseId,
    shift: row.shift as Shift | null,
    studyTypeId: row.studyTypeId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function courseLabel(course: { year: number; number: number; label: string | null } | null): string | null {
  if (!course) return null;
  return course.label ?? `${course.year}-${course.number}`;
}

export async function listGroups(includeInactive = false): Promise<GroupWithRelations[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await prisma.group.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { name: "asc" },
    include: {
      course: { select: { year: true, number: true, label: true } },
      studyType: { select: { name: true } },
      _count: { select: { students: { where: { active: true } } } },
      rotationBlocks: {
        where: { active: true, startDate: { lte: today }, endDate: { gte: today } },
        include: { hospital: { select: { name: true } } },
        take: 1,
      },
    },
  });
  return rows.map((r: any) => ({
    ...serialize(r),
    courseLabel: courseLabel(r.course),
    studyTypeName: r.studyType?.name ?? null,
    studentCount: r._count.students,
    currentHospitalName: r.rotationBlocks[0]?.hospital.name ?? null,
  }));
}

export async function getGroup(id: string): Promise<Group | undefined> {
  const row = await prisma.group.findUnique({ where: { id } });
  return row ? serialize(row) : undefined;
}

export async function createGroup(
  actorId: string,
  data: { name: string; cycleLabel?: string; courseId?: string | null; shift?: Shift | null; studyTypeId?: string | null }
): Promise<Group> {
  const row = await prisma.group.create({
    data: {
      name: data.name,
      cycleLabel: data.cycleLabel ?? null,
      courseId: data.courseId ?? null,
      shift: data.shift ?? null,
      studyTypeId: data.studyTypeId ?? null,
    },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "Group", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateGroup(
  actorId: string,
  id: string,
  data: {
    name?: string;
    cycleLabel?: string;
    courseId?: string | null;
    shift?: Shift | null;
    studyTypeId?: string | null;
    active?: boolean;
  }
): Promise<Group> {
  const beforeRow = await prisma.group.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Group not found");
  const before = serialize(beforeRow);
  const row = await prisma.group.update({
    where: { id },
    data: {
      name: data.name ?? before.name,
      cycleLabel: data.cycleLabel ?? before.cycleLabel,
      courseId: data.courseId === undefined ? before.courseId : data.courseId,
      shift: data.shift === undefined ? before.shift : data.shift,
      studyTypeId: data.studyTypeId === undefined ? before.studyTypeId : data.studyTypeId,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "Group",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}

// Bulk import — upserts by name (Group has no unique key beyond id).
export async function importGroups(
  actorId: string,
  rows: Array<{ name: string; shift?: string; course?: string; studyType?: string; cycleLabel?: string }>
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  let index = -1;
  for (const row of rows) {
    index++;
    try {
      if (!row.name?.trim()) throw new Error("Missing group name");
      const shift = parseShiftCell(row.shift) ?? null;
      const courseId = await resolveCourseId(row.course);
      const studyTypeId = await resolveStudyTypeId(row.studyType);

      const existing = await prisma.group.findFirst({ where: { name: row.name.trim() } });
      if (existing) {
        await updateGroup(actorId, existing.id, {
          name: row.name.trim(),
          cycleLabel: row.cycleLabel,
          courseId,
          shift,
          studyTypeId,
        });
        result.updated++;
      } else {
        await createGroup(actorId, {
          name: row.name.trim(),
          cycleLabel: row.cycleLabel,
          courseId,
          shift,
          studyTypeId,
        });
        result.created++;
      }
    } catch (err) {
      result.errors.push({ row: index + 2, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
