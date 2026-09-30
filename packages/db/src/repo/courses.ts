// Courses, hospitals, groups and the rotation schedule.
import { and, eq, inArray } from "drizzle-orm";
import { generateRotation } from "@eva/core/schedule/rotationGenerator";
import { addDaysISO } from "@eva/core/date";
import { compareArabic } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";

export async function listCourses(r: Repo) {
  const rows = await r.db.select().from(t.courses);
  return rows.sort((a, b) => b.year - a.year || b.number - a.number);
}

export async function listHospitals(r: Repo, includeInactive = false) {
  const rows = await r.db.select().from(t.hospitals).where(includeInactive ? undefined : eq(t.hospitals.active, true));
  return rows.sort((a, b) => compareArabic(a.name, b.name));
}

export async function saveHospital(r: Repo, input: { id?: string; name: string; address?: string | null; notes?: string | null }) {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name) throw new ValidationError("اسم المستشفى مطلوب", "name");
  const plan = new Plan(r);
  const fields = { name, nameAr: name, address: input.address?.trim() || null, notes: input.notes?.trim() || null };
  const id = input.id ?? newId();
  if (input.id) plan.add(r.db.update(t.hospitals).set({ ...fields, updatedAt: nowISO() }).where(eq(t.hospitals.id, id)));
  else plan.add(r.db.insert(t.hospitals).values({ id, ...fields }));
  plan.audit("Hospital", id, input.id ? "update" : "create", undefined, fields);
  await plan.commit();
  return id;
}

export interface CourseGroup {
  id: string;
  name: string;
  shift: t.Shift | null;
  studentCount: number;
}

export interface ScheduleCell {
  blockId: string;
  hospitalId: string;
  hospitalName: string;
}

export interface CourseOverview {
  course: typeof t.courses.$inferSelect;
  groups: CourseGroup[];
  hospitals: Array<{ id: string; name: string }>;
  weeks: Array<{ index: number; start: string; end: string }>;
  /** cells[groupId][weekIndex] */
  cells: Record<string, Record<number, ScheduleCell>>;
}

export async function courseOverview(r: Repo, courseId: string): Promise<CourseOverview | null> {
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) return null;
  const groups = await r.db.select().from(t.groups).where(eq(t.groups.courseId, courseId));
  const students = await r.db
    .select({ groupId: t.students.groupId })
    .from(t.students)
    .where(and(eq(t.students.courseId, courseId), eq(t.students.active, true)));
  const blocks = await r.db
    .select({ block: t.rotationBlocks, hospitalName: t.hospitals.name })
    .from(t.rotationBlocks)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
    .where(and(eq(t.rotationBlocks.courseId, courseId), eq(t.rotationBlocks.active, true)));
  const linked = await r.db
    .select({ id: t.hospitals.id, name: t.hospitals.name })
    .from(t.courseHospitals)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.courseHospitals.hospitalId))
    .where(eq(t.courseHospitals.courseId, courseId));

  const weeksBy = new Map<number, { index: number; start: string; end: string }>();
  const cells: CourseOverview["cells"] = {};
  for (const { block, hospitalName } of blocks) {
    const w = block.weekIndex ?? 0;
    const cur = weeksBy.get(w);
    weeksBy.set(w, {
      index: w,
      start: cur && cur.start < block.startDate ? cur.start : block.startDate,
      end: cur && cur.end > block.endDate ? cur.end : block.endDate,
    });
    (cells[block.groupId] ??= {})[w] = { blockId: block.id, hospitalId: block.hospitalId, hospitalName };
  }
  const shiftRank = (s: t.Shift | null) => (s === "MORNING" ? 0 : s === "EVENING" ? 1 : 2);
  return {
    course,
    groups: groups
      .map((g) => ({ id: g.id, name: g.name, shift: g.shift, studentCount: students.filter((s) => s.groupId === g.id).length }))
      .sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift) || a.name.localeCompare(b.name, "ar", { numeric: true })),
    hospitals: linked.sort((a, b) => compareArabic(a.name, b.name)),
    weeks: [...weeksBy.values()].sort((a, b) => a.index - b.index),
    cells,
  };
}

/** Moves one group-week of the schedule to another hospital. */
export async function setBlockHospital(r: Repo, blockId: string, hospitalId: string) {
  const [block] = await r.db.select().from(t.rotationBlocks).where(eq(t.rotationBlocks.id, blockId));
  if (!block) throw new ValidationError("خانة الجدول غير موجودة");
  const plan = new Plan(r);
  plan.add(r.db.update(t.rotationBlocks).set({ hospitalId, updatedAt: nowISO() }).where(eq(t.rotationBlocks.id, blockId)));
  if (block.courseId) {
    const [c] = await r.db.select().from(t.courses).where(eq(t.courses.id, block.courseId));
    plan.add(r.db.update(t.courses).set({ scheduleVersion: (c?.scheduleVersion ?? 0) + 1, updatedAt: nowISO() }).where(eq(t.courses.id, block.courseId)));
  }
  plan.audit("RotationBlock", blockId, "update", { hospitalId: block.hospitalId }, { hospitalId });
  await plan.commit();
}

export interface NewCourseInput {
  year: number;
  number: number;
  label: string;
  startDate: string; // a Sunday, "YYYY-MM-DD"
  weekCount: number;
  weeksPerHospital: number;
  daysOfWeek: string; // e.g. "SUN,MON,TUE,WED,THU"
  groupsPerShift: { MORNING: number; EVENING: number };
  hospitalIds: string[];
  studyTypeId: string;
}

const SHIFT_LABEL = { MORNING: "الصباحية", EVENING: "المسائية" } as const;

/**
 * Creates a published course with its groups ("المجموعة الصباحية 1"…) and a
 * fair rotation: each group visits each hospital for `weeksPerHospital`
 * weeks, groups of one shift spread over the hospitals (Latin square).
 */
export async function createCourse(r: Repo, input: NewCourseInput): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new ValidationError("تاريخ البداية غير صالح", "startDate");
  if (new Date(`${input.startDate}T00:00:00Z`).getUTCDay() !== 0) throw new ValidationError("يجب أن تبدأ الدورة يوم أحد", "startDate");
  if (!(input.weekCount >= 1 && input.weekCount <= 52)) throw new ValidationError("عدد الأسابيع بين 1 و 52", "weekCount");
  if (!(input.weeksPerHospital >= 1)) throw new ValidationError("عدد أسابيع كل مستشفى مطلوب", "weeksPerHospital");
  if (input.hospitalIds.length === 0) throw new ValidationError("اختر مستشفى واحدًا على الأقل", "hospitalIds");
  if (input.groupsPerShift.MORNING + input.groupsPerShift.EVENING === 0) throw new ValidationError("أضف مجموعة واحدة على الأقل", "groupsPerShift");
  const dup = await r.db.select().from(t.courses).where(and(eq(t.courses.year, input.year), eq(t.courses.number, input.number)));
  if (dup.length) throw new ValidationError(`الدورة ${input.year}-${input.number} موجودة مسبقًا`, "number");
  const hospitals = await r.db.select().from(t.hospitals).where(inArray(t.hospitals.id, input.hospitalIds));
  if (hospitals.length !== input.hospitalIds.length) throw new ValidationError("مستشفى غير موجود", "hospitalIds");

  const courseId = newId();
  const plan = new Plan(r);
  plan.add(
    r.db.insert(t.courses).values({
      id: courseId, year: input.year, number: input.number, label: input.label.trim() || null, status: "PUBLISHED",
      startDate: input.startDate, weekCount: input.weekCount, setupStep: 8, scheduleVersion: 1,
    })
  );
  plan.add(r.db.insert(t.courseStudyTypes).values({ id: newId(), courseId, studyTypeId: input.studyTypeId }));
  plan.add(r.db.insert(t.courseAttendancePatterns).values({ id: newId(), courseId, daysOfWeek: input.daysOfWeek }));
  input.hospitalIds.forEach((hospitalId) => plan.add(r.db.insert(t.courseHospitals).values({ id: newId(), courseId, hospitalId })));

  for (const shift of ["MORNING", "EVENING"] as const) {
    const groups = Array.from({ length: input.groupsPerShift[shift] }, (_, i) => ({
      id: newId(),
      name: `المجموعة ${SHIFT_LABEL[shift]} ${i + 1}`,
    }));
    groups.forEach((g) =>
      plan.add(r.db.insert(t.groups).values({ id: g.id, name: g.name, courseId, shift, studyTypeId: input.studyTypeId }))
    );
    // Each shift uses the hospitals independently (different times of day).
    const drafts = generateRotation({
      groups,
      hospitals: input.hospitalIds.map((id) => ({ id, capacity: null })),
      weekCount: input.weekCount,
      stintWeeks: input.weeksPerHospital,
    });
    for (const d of drafts) {
      const start = addDaysISO(input.startDate, d.weekIndex * 7);
      plan.add(
        r.db.insert(t.rotationBlocks).values({
          id: newId(), groupId: d.groupId, hospitalId: d.hospitalId, courseId, weekIndex: d.weekIndex,
          startDate: start, endDate: addDaysISO(start, 6), daysOfWeek: input.daysOfWeek,
        })
      );
    }
  }
  plan.audit("Course", courseId, "create", undefined, input);
  await plan.commit();
  return courseId;
}
