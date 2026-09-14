import { prisma } from "../db";
import { recordAudit } from "../audit";

export interface Course {
  id: string;
  year: number;
  number: number;
  label: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  year: number;
  number: number;
  label: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Course {
  return {
    id: row.id,
    year: row.year,
    number: row.number,
    label: row.label,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCourses(includeInactive = false): Promise<Course[]> {
  const rows = await prisma.course.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ year: "desc" }, { number: "asc" }],
  });
  return rows.map(serialize);
}

export async function getCourse(id: string): Promise<Course | undefined> {
  const row = await prisma.course.findUnique({ where: { id } });
  return row ? serialize(row) : undefined;
}

export async function createCourse(
  actorId: string,
  data: { year: number; number: number; label?: string }
): Promise<Course> {
  if (!Number.isInteger(data.year) || data.year < 2000) {
    throw new Error("سنة غير صحيحة");
  }
  if (data.number !== 1 && data.number !== 2) {
    throw new Error("رقم الدورة يجب أن يكون ١ أو ٢");
  }
  const row = await prisma.course.create({
    data: { year: data.year, number: data.number, label: data.label ?? null },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "Course", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateCourse(
  actorId: string,
  id: string,
  data: { label?: string; active?: boolean }
): Promise<Course> {
  const beforeRow = await prisma.course.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Course not found");
  const before = serialize(beforeRow);
  const row = await prisma.course.update({
    where: { id },
    data: {
      label: data.label ?? before.label,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "Course",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}
