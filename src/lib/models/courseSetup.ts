// Model layer for the Course Setup wizard's per-course config tables
// (COURSE_SETUP_PLAN.md §4 steps 3, 4, 7, §8). These are simple join/config
// rows with no independent lifecycle of their own — the wizard replaces
// them wholesale on each step save, so there is no separate update path,
// only "set the course's study types/hospitals/patterns/holidays to
// exactly this list."
import { prisma } from "../db";
import { recordAudit } from "../audit";

export interface CourseStudyTypeRow {
  id: string;
  courseId: string;
  studyTypeId: string;
}

export async function listCourseStudyTypes(courseId: string): Promise<CourseStudyTypeRow[]> {
  return prisma.courseStudyType.findMany({ where: { courseId } });
}

// Step 3: "at least 1" is enforced by the wizard UI (a step can't advance
// past an empty selection); this layer just persists whatever set it's given.
export async function setCourseStudyTypes(actorId: string, courseId: string, studyTypeIds: string[]): Promise<void> {
  const before = await listCourseStudyTypes(courseId);
  await prisma.$transaction([
    prisma.courseStudyType.deleteMany({ where: { courseId } }),
    prisma.courseStudyType.createMany({
      data: studyTypeIds.map((studyTypeId) => ({ courseId, studyTypeId })),
    }),
  ]);
  await recordAudit({
    actorId,
    entityType: "CourseStudyType",
    entityId: courseId,
    action: "update",
    before,
    after: studyTypeIds,
  });
}

export interface CourseHospitalRow {
  id: string;
  courseId: string;
  hospitalId: string;
  capacity: number | null;
}

export async function listCourseHospitals(courseId: string): Promise<CourseHospitalRow[]> {
  return prisma.courseHospital.findMany({ where: { courseId } });
}

export async function setCourseHospitals(
  actorId: string,
  courseId: string,
  hospitals: Array<{ hospitalId: string; capacity?: number | null }>
): Promise<void> {
  const before = await listCourseHospitals(courseId);
  await prisma.$transaction([
    prisma.courseHospital.deleteMany({ where: { courseId } }),
    prisma.courseHospital.createMany({
      data: hospitals.map((h) => ({ courseId, hospitalId: h.hospitalId, capacity: h.capacity ?? null })),
    }),
  ]);
  await recordAudit({
    actorId,
    entityType: "CourseHospital",
    entityId: courseId,
    action: "update",
    before,
    after: hospitals,
  });
}

export interface CourseAttendancePatternRow {
  id: string;
  courseId: string;
  shift: "MORNING" | "EVENING" | null;
  studyTypeId: string | null;
  daysOfWeek: string;
}

export async function listCourseAttendancePatterns(courseId: string): Promise<CourseAttendancePatternRow[]> {
  return prisma.courseAttendancePattern.findMany({ where: { courseId } });
}

// Step 7: one row per (shift, studyType) combination the admin configured,
// e.g. "morning attends SUN+TUE" and "evening attends MON+WED" as two rows,
// or a single course-wide row with shift and studyTypeId both null.
export async function setCourseAttendancePatterns(
  actorId: string,
  courseId: string,
  patterns: Array<{ shift?: "MORNING" | "EVENING" | null; studyTypeId?: string | null; daysOfWeek: string }>
): Promise<void> {
  for (const p of patterns) {
    if (!p.daysOfWeek?.trim()) throw new Error("يجب اختيار يوم حضور واحد على الأقل لكل نمط");
  }
  const before = await listCourseAttendancePatterns(courseId);
  await prisma.$transaction([
    prisma.courseAttendancePattern.deleteMany({ where: { courseId } }),
    prisma.courseAttendancePattern.createMany({
      data: patterns.map((p) => ({
        courseId,
        shift: p.shift ?? null,
        studyTypeId: p.studyTypeId ?? null,
        daysOfWeek: p.daysOfWeek,
      })),
    }),
  ]);
  await recordAudit({
    actorId,
    entityType: "CourseAttendancePattern",
    entityId: courseId,
    action: "update",
    before,
    after: patterns,
  });
}

export interface CourseHolidayRow {
  id: string;
  courseId: string;
  dateISO: string;
  label: string | null;
}

export async function listCourseHolidays(courseId: string): Promise<CourseHolidayRow[]> {
  return prisma.courseHoliday.findMany({ where: { courseId }, orderBy: { dateISO: "asc" } });
}

export async function setCourseHolidays(
  actorId: string,
  courseId: string,
  holidays: Array<{ dateISO: string; label?: string }>
): Promise<void> {
  const before = await listCourseHolidays(courseId);
  await prisma.$transaction([
    prisma.courseHoliday.deleteMany({ where: { courseId } }),
    prisma.courseHoliday.createMany({
      data: holidays.map((h) => ({ courseId, dateISO: h.dateISO, label: h.label ?? null })),
    }),
  ]);
  await recordAudit({
    actorId,
    entityType: "CourseHoliday",
    entityId: courseId,
    action: "update",
    before,
    after: holidays,
  });
}
