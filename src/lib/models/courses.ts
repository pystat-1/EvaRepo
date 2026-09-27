import { prisma } from "../db";
import { recordAudit } from "../audit";

export type CourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface Course {
  id: string;
  year: number;
  number: number;
  label: string | null;
  active: boolean;
  status: CourseStatus;
  startDate: string | null;
  weekCount: number | null;
  setupStep: number;
  scheduleVersion: number;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  year: number;
  number: number;
  label: string | null;
  active: boolean;
  status: CourseStatus;
  startDate: string | null;
  weekCount: number | null;
  setupStep: number;
  scheduleVersion: number;
  createdAt: Date;
  updatedAt: Date;
}): Course {
  return {
    id: row.id,
    year: row.year,
    number: row.number,
    label: row.label,
    active: row.active,
    status: row.status,
    startDate: row.startDate,
    weekCount: row.weekCount,
    setupStep: row.setupStep,
    scheduleVersion: row.scheduleVersion,
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

// COURSE_SETUP_PLAN.md step 2: "Unique (year, number); resumes the
// existing draft if one exists" — picking a year+number the wizard has
// already started reopens it instead of erroring on the unique constraint.
export async function getOrCreateCourseDraft(
  actorId: string,
  data: { year: number; number: number; label?: string }
): Promise<Course> {
  const existing = await prisma.course.findUnique({ where: { year_number: { year: data.year, number: data.number } } });
  if (existing) return serialize(existing);
  return createCourse(actorId, data);
}

// COURSE_SETUP_PLAN.md §4 steps 1-8: persists wizard progress as the admin
// moves through the stepper, so a draft is never lost (§4 intro).
export async function updateCourseSetup(
  actorId: string,
  id: string,
  data: { startDate?: string; weekCount?: number; setupStep?: number }
): Promise<Course> {
  const beforeRow = await prisma.course.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Course not found");
  if (data.weekCount !== undefined && (!Number.isInteger(data.weekCount) || data.weekCount < 1)) {
    throw new Error("عدد الأسابيع يجب أن يكون رقمًا صحيحًا موجبًا");
  }
  const before = serialize(beforeRow);
  const row = await prisma.course.update({
    where: { id },
    data: {
      startDate: data.startDate ?? before.startDate,
      weekCount: data.weekCount ?? before.weekCount,
      setupStep: data.setupStep ?? before.setupStep,
    },
  });
  const after = serialize(row);
  await recordAudit({ actorId, entityType: "Course", entityId: id, action: "update", before, after });
  return after;
}

// COURSE_SETUP_PLAN.md §7: DRAFT → PUBLISHED → ARCHIVED. `hasBlockingConflicts`
// is decided by the caller from checkConflicts() over the full matrix —
// this function only enforces the state machine and bumps the version
// number that shows up in the audit log as "Schedule vN published by X".
export async function publishCourse(actorId: string, id: string, hasBlockingConflicts: boolean): Promise<Course> {
  const beforeRow = await prisma.course.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Course not found");
  if (beforeRow.status === "ARCHIVED") throw new Error("لا يمكن نشر دورة مؤرشفة");
  if (hasBlockingConflicts) throw new Error("لا يمكن النشر: توجد تعارضات يجب حلها أولاً");
  const before = serialize(beforeRow);
  const row = await prisma.course.update({
    where: { id },
    data: { status: "PUBLISHED", scheduleVersion: { increment: 1 } },
  });
  const after = serialize(row);
  await recordAudit({ actorId, entityType: "Course", entityId: id, action: "update", before, after });
  return after;
}

export async function archiveCourse(actorId: string, id: string): Promise<Course> {
  const beforeRow = await prisma.course.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Course not found");
  const before = serialize(beforeRow);
  const row = await prisma.course.update({ where: { id }, data: { status: "ARCHIVED" } });
  const after = serialize(row);
  await recordAudit({ actorId, entityType: "Course", entityId: id, action: "update", before, after });
  return after;
}
