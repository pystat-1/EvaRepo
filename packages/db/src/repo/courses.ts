// Courses, hospitals, groups and the rotation schedule.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { generateRotation } from "@eva/core/schedule/rotationGenerator";
import { meetsOn, type Holiday } from "@eva/core/schedule/holidays";
import { addDaysISO } from "@eva/core/date";
import { compareArabic } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";
import { CURRENT_COURSE_KEY, currentCourse } from "./students";

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
  // A new course never takes over: the course in use stays current until
  // the admin chooses another (pinned here if it was only the default).
  const before = await currentCourse(r);
  if (before) plan.add(r.db.insert(t.meta).values({ key: CURRENT_COURSE_KEY, value: before.id }).onConflictDoNothing());
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

// ---- attendance days (which weekdays each hospital's groups attend) -------
// Descriptive, never limiting: they set the schedule's dates (shown to the
// admin and on the evaluators' phones) and mark days as "scheduled"; any
// group can still be graded on any date. Changeable at any time.

const DAY_ORDER = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DEFAULT_DAYS = "SUN,MON,TUE,WED,THU";
const normDays = (days: string[]) => DAY_ORDER.filter((d) => days.map((x) => x.trim().toUpperCase()).includes(d));

export interface AttendanceDays {
  /** The course's own days (used by every hospital without its own). */
  course: string[];
  hospitals: Array<{ hospitalId: string; hospitalName: string; days: string[]; own: boolean }>;
}

export async function attendanceDays(r: Repo, courseId: string): Promise<AttendanceDays> {
  const [pattern] = await r.db
    .select()
    .from(t.courseAttendancePatterns)
    .where(eq(t.courseAttendancePatterns.courseId, courseId));
  const course = normDays((pattern?.daysOfWeek ?? DEFAULT_DAYS).split(","));
  const blocks = await r.db
    .select({ hospitalId: t.rotationBlocks.hospitalId, days: t.rotationBlocks.daysOfWeek, name: t.hospitals.name })
    .from(t.rotationBlocks)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
    .where(and(eq(t.rotationBlocks.courseId, courseId), eq(t.rotationBlocks.active, true)));
  const byHospital = new Map<string, { name: string; days: string[] }>();
  for (const b of blocks) if (!byHospital.has(b.hospitalId)) byHospital.set(b.hospitalId, { name: b.name, days: normDays((b.days ?? DEFAULT_DAYS).split(",")) });
  return {
    course,
    hospitals: [...byHospital]
      .map(([hospitalId, h]) => ({ hospitalId, hospitalName: h.name, days: h.days, own: h.days.join() !== course.join() }))
      .sort((a, b) => compareArabic(a.hospitalName, b.hospitalName)),
  };
}

/** Sets the attendance days for the whole course, or for one hospital's blocks only. */
export async function setAttendanceDays(r: Repo, courseId: string, days: string[], hospitalId?: string | null) {
  const clean = normDays(days);
  if (clean.length === 0) throw new ValidationError("اختر يومًا واحدًا على الأقل");
  const value = clean.join(",");
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) throw new ValidationError("الدورة غير موجودة");
  const plan = new Plan(r);
  plan.add(
    r.db
      .update(t.rotationBlocks)
      .set({ daysOfWeek: value, updatedAt: nowISO() })
      .where(and(eq(t.rotationBlocks.courseId, courseId), hospitalId ? eq(t.rotationBlocks.hospitalId, hospitalId) : undefined))
  );
  if (!hospitalId) {
    const [pattern] = await r.db.select().from(t.courseAttendancePatterns).where(eq(t.courseAttendancePatterns.courseId, courseId));
    if (pattern) plan.add(r.db.update(t.courseAttendancePatterns).set({ daysOfWeek: value }).where(eq(t.courseAttendancePatterns.id, pattern.id)));
    else plan.add(r.db.insert(t.courseAttendancePatterns).values({ id: newId(), courseId, daysOfWeek: value }));
  }
  plan.add(r.db.update(t.courses).set({ scheduleVersion: course.scheduleVersion + 1, updatedAt: nowISO() }).where(eq(t.courses.id, courseId)));
  plan.audit("Course", courseId, "update", undefined, { name: `أيام الحضور${hospitalId ? " (مستشفى)" : ""}: ${value}` });
  await plan.commit();
}

export interface CalendarDay {
  dateISO: string;
  weekday: string;
  groups: Array<{ id: string; name: string; shift: t.Shift | null }>;
  /** Set on a holiday: no attendance; the groups listed meet on `holiday.movedTo` instead (if set). */
  holiday?: Holiday;
  /** Set on a make-up day: the holiday whose schedule moved here. */
  makeupFor?: string;
}

export interface CalendarHospital {
  hospitalId: string;
  hospitalName: string;
  weeks: Array<{ index: number; days: CalendarDay[] }>;
}

/**
 * The schedule by hospital: week → attendance days → date → groups there.
 * A holiday stays in its place (marked); its make-up day joins the same week.
 */
export async function attendanceCalendar(r: Repo, courseId: string): Promise<CalendarHospital[]> {
  const blocks = await r.db
    .select({ b: t.rotationBlocks, hospitalName: t.hospitals.name, groupName: t.groups.name, shift: t.groups.shift })
    .from(t.rotationBlocks)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
    .innerJoin(t.groups, eq(t.groups.id, t.rotationBlocks.groupId))
    .where(and(eq(t.rotationBlocks.courseId, courseId), eq(t.rotationBlocks.active, true)));
  const holidays = new Map((await listHolidays(r, courseId)).map((h) => [h.dateISO, h]));
  const out = new Map<string, CalendarHospital>();
  for (const { b, hospitalName, groupName, shift } of blocks) {
    const h = out.get(b.hospitalId) ?? { hospitalId: b.hospitalId, hospitalName, weeks: [] };
    out.set(b.hospitalId, h);
    const days = new Set((b.daysOfWeek ?? DEFAULT_DAYS).split(",").map((d) => d.trim().toUpperCase()));
    const wi = b.weekIndex ?? 0;
    const add = (d: string, extra: Partial<CalendarDay>) => {
      let week = h.weeks.find((w) => w.index === wi);
      if (!week) h.weeks.push((week = { index: wi, days: [] }));
      let day = week.days.find((x) => x.dateISO === d);
      if (!day) week.days.push((day = { dateISO: d, weekday: DAY_ORDER[new Date(`${d}T00:00:00Z`).getUTCDay()], groups: [], ...extra }));
      day.groups.push({ id: b.groupId, name: groupName, shift });
    };
    for (let d = b.startDate; d <= b.endDate; d = addDaysISO(d, 1)) {
      if (!days.has(DAY_ORDER[new Date(`${d}T00:00:00Z`).getUTCDay()])) continue;
      const hol = holidays.get(d);
      add(d, hol ? { holiday: hol } : {});
      if (hol?.movedTo) add(hol.movedTo, { makeupFor: d });
    }
  }
  const shiftRank = (s: t.Shift | null) => (s === "MORNING" ? 0 : s === "EVENING" ? 1 : 2);
  for (const h of out.values()) {
    h.weeks.sort((a, b) => a.index - b.index);
    for (const w of h.weeks) {
      w.days.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      for (const d of w.days) d.groups.sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift) || a.name.localeCompare(b.name, "ar", { numeric: true }));
    }
  }
  return [...out.values()].sort((a, b) => compareArabic(a.hospitalName, b.hospitalName));
}

// ---- holidays (العطل) ----------------------------------------------------------
// A holiday is a course-wide day without attendance. Moved to another date
// (make-up day), every group that met on it meets there instead, at the
// same hospital: the admin's calendar, the Grading Center and the phones
// all follow (see @eva/core/schedule/holidays). Grades already recorded
// stay on the day they were actually given.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function listHolidays(r: Repo, courseId: string): Promise<Holiday[]> {
  const rows = await r.db
    .select({ dateISO: t.courseHolidays.dateISO, label: t.courseHolidays.label, movedTo: t.courseHolidays.movedTo })
    .from(t.courseHolidays)
    .where(eq(t.courseHolidays.courseId, courseId));
  return rows.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

async function courseBlocks(r: Repo, courseId: string) {
  return r.db
    .select({ groupId: t.rotationBlocks.groupId, groupName: t.groups.name, hospitalName: t.hospitals.name, startDate: t.rotationBlocks.startDate, endDate: t.rotationBlocks.endDate, daysOfWeek: t.rotationBlocks.daysOfWeek })
    .from(t.rotationBlocks)
    .innerJoin(t.groups, eq(t.groups.id, t.rotationBlocks.groupId))
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
    .where(and(eq(t.rotationBlocks.courseId, courseId), eq(t.rotationBlocks.active, true)));
}

export interface HolidayImpact {
  /** Groups that meet on the day (they move with it), with their hospital. */
  groups: Array<{ id: string; name: string; hospitalName: string }>;
  /** Groups already graded on the day (those grades stay on that day). */
  gradedGroups: number;
}

/** What a holiday on this date touches: shown before saving. */
export async function holidayImpact(r: Repo, courseId: string, dateISO: string): Promise<HolidayImpact> {
  const blocks = await courseBlocks(r, courseId);
  const groups = blocks
    .filter((b) => meetsOn(b, dateISO))
    .map((b) => ({ id: b.groupId, name: b.groupName, hospitalName: b.hospitalName }))
    .sort((a, b) => compareArabic(a.hospitalName, b.hospitalName) || a.name.localeCompare(b.name, "ar", { numeric: true }));
  const [graded] = await r.db
    .select({ n: sql<number>`count(distinct ${t.evaluations.groupId})` })
    .from(t.evaluations)
    .where(and(eq(t.evaluations.courseId, courseId), eq(t.evaluations.dateISO, dateISO)));
  return { groups, gradedGroups: graded?.n ?? 0 };
}

/**
 * Declares (or edits) a holiday. With `movedTo`, the day's schedule moves to
 * that date; refused when one of the moving groups already meets there.
 */
export async function saveHoliday(r: Repo, courseId: string, input: { dateISO: string; label?: string | null; movedTo?: string | null }) {
  const dateISO = input.dateISO;
  const movedTo = input.movedTo || null;
  const label = input.label?.replace(/\s+/g, " ").trim() || null;
  if (!ISO_DAY.test(dateISO)) throw new ValidationError("تاريخ العطلة غير صالح", "dateISO");
  if (movedTo && !ISO_DAY.test(movedTo)) throw new ValidationError("تاريخ التعويض غير صالح", "movedTo");
  if (movedTo === dateISO) throw new ValidationError("اختر تاريخًا غير يوم العطلة نفسه", "movedTo");
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) throw new ValidationError("الدورة غير موجودة");

  const all = await listHolidays(r, courseId);
  const existing = all.find((h) => h.dateISO === dateISO);
  const others = all.filter((h) => h.dateISO !== dateISO);
  if (others.some((h) => h.movedTo === dateISO)) throw new ValidationError("هذا اليوم يوم تعويض لعطلة أخرى — عدّل تلك العطلة بدلًا منه", "dateISO");
  if (movedTo) {
    if (others.some((h) => h.dateISO === movedTo)) throw new ValidationError("التاريخ المختار عطلة أيضًا", "movedTo");
    const blocks = await courseBlocks(r, courseId);
    const moving = new Set(blocks.filter((b) => meetsOn(b, dateISO)).map((b) => b.groupId));
    // A group cannot meet twice on one date: a regular day there, or another holiday's make-up day.
    const busy = new Set(blocks.filter((b) => moving.has(b.groupId) && meetsOn(b, movedTo)).map((b) => b.groupName));
    for (const h of others.filter((x) => x.movedTo === movedTo)) {
      for (const b of blocks) if (moving.has(b.groupId) && meetsOn(b, h.dateISO)) busy.add(b.groupName);
    }
    if (busy.size) throw new ValidationError(`لهذه المجموعات دوام في ${movedTo} أصلًا: ${[...busy].join("، ")}`, "movedTo");
  }

  const plan = new Plan(r);
  plan.add(
    r.db
      .insert(t.courseHolidays)
      .values({ id: newId(), courseId, dateISO, label, movedTo })
      .onConflictDoUpdate({ target: [t.courseHolidays.courseId, t.courseHolidays.dateISO], set: { label, movedTo } })
  );
  plan.add(r.db.update(t.courses).set({ scheduleVersion: course.scheduleVersion + 1, updatedAt: nowISO() }).where(eq(t.courses.id, courseId)));
  plan.audit("CourseHoliday", `${courseId}:${dateISO}`, existing ? "update" : "create", existing, { dateISO, label, movedTo });
  await plan.commit();
}

/** Cancels a holiday: the day is a normal day again and its make-up day goes. */
export async function removeHoliday(r: Repo, courseId: string, dateISO: string) {
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) throw new ValidationError("الدورة غير موجودة");
  const existing = (await listHolidays(r, courseId)).find((h) => h.dateISO === dateISO);
  if (!existing) return;
  const plan = new Plan(r);
  plan.add(r.db.delete(t.courseHolidays).where(and(eq(t.courseHolidays.courseId, courseId), eq(t.courseHolidays.dateISO, dateISO))));
  plan.add(r.db.update(t.courses).set({ scheduleVersion: course.scheduleVersion + 1, updatedAt: nowISO() }).where(eq(t.courses.id, courseId)));
  plan.audit("CourseHoliday", `${courseId}:${dateISO}`, "delete", existing);
  await plan.commit();
}

// ---- deleting a course ------------------------------------------------------
// Everything that belongs to the course goes: its groups, schedule, students
// with their grades and attendance, evaluator covers and phone submissions.
// Hospitals and evaluator accounts are shared and stay.

export interface CourseDeletionImpact {
  label: string;
  groups: number;
  students: number;
  gradedDays: number;
  assignments: number;
  isCurrent: boolean;
}

export async function courseDeletionImpact(r: Repo, courseId: string): Promise<CourseDeletionImpact | null> {
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) return null;
  const { groupIds, studentIds } = courseScope(r, courseId);
  const count = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)`;
  return {
    label: courseLabel(course),
    groups: await count(r.db.select({ n }).from(t.groups).where(eq(t.groups.courseId, courseId))),
    students: await count(r.db.select({ n }).from(t.students).where(inArray(t.students.id, studentIds))),
    gradedDays: await count(
      r.db.select({ n: sql<number>`count(distinct ${t.evaluations.groupId} || ':' || ${t.evaluations.dateISO})` }).from(t.evaluations)
        .where(or(eq(t.evaluations.courseId, courseId), inArray(t.evaluations.studentId, studentIds), inArray(t.evaluations.groupId, groupIds)))
    ),
    assignments: await count(
      r.db.select({ n }).from(t.evaluatorAssignments)
        .where(and(eq(t.evaluatorAssignments.active, true), or(eq(t.evaluatorAssignments.courseId, courseId), inArray(t.evaluatorAssignments.groupId, groupIds))))
    ),
    isCurrent: (await currentCourse(r))?.id === courseId,
  };
}

export const courseLabel = (c: { label: string | null; year: number; number: number }) => c.label ?? `${c.year}-${c.number}`;

// The course's groups and students as subqueries (no long id lists).
function courseScope(r: Repo, courseId: string) {
  const groupIds = r.db.select({ id: t.groups.id }).from(t.groups).where(eq(t.groups.courseId, courseId));
  const studentIds = r.db.select({ id: t.students.id }).from(t.students).where(or(eq(t.students.courseId, courseId), inArray(t.students.groupId, groupIds)));
  return { groupIds, studentIds };
}

/** Deletes the course and everything in it, in one transaction. Take a backup first. */
export async function deleteCourse(r: Repo, courseId: string): Promise<void> {
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) throw new ValidationError("الدورة غير موجودة");
  const { groupIds, studentIds } = courseScope(r, courseId);
  const evaluationIds = r.db.select({ id: t.evaluations.id }).from(t.evaluations)
    .where(or(eq(t.evaluations.courseId, courseId), inArray(t.evaluations.studentId, studentIds), inArray(t.evaluations.groupId, groupIds)));
  const plan = new Plan(r);
  // Children before parents: the database refuses orphaned rows.
  plan.add(r.db.delete(t.evaluationScores).where(inArray(t.evaluationScores.evaluationId, evaluationIds)));
  plan.add(r.db.delete(t.evaluations).where(or(eq(t.evaluations.courseId, courseId), inArray(t.evaluations.studentId, studentIds), inArray(t.evaluations.groupId, groupIds))));
  plan.add(r.db.delete(t.attendanceRecords).where(or(inArray(t.attendanceRecords.studentId, studentIds), inArray(t.attendanceRecords.groupId, groupIds))));
  plan.add(r.db.delete(t.groupWorkDays).where(inArray(t.groupWorkDays.groupId, groupIds)));
  plan.add(r.db.delete(t.syncInbox).where(inArray(t.syncInbox.groupId, groupIds)));
  plan.add(r.db.delete(t.flags).where(inArray(t.flags.studentId, studentIds)));
  plan.add(r.db.update(t.accounts).set({ studentId: null }).where(inArray(t.accounts.studentId, studentIds)));
  plan.add(r.db.delete(t.evaluatorAssignments).where(or(eq(t.evaluatorAssignments.courseId, courseId), inArray(t.evaluatorAssignments.groupId, groupIds))));
  plan.add(r.db.delete(t.rotationBlocks).where(or(eq(t.rotationBlocks.courseId, courseId), inArray(t.rotationBlocks.groupId, groupIds))));
  plan.add(r.db.delete(t.students).where(inArray(t.students.id, studentIds)));
  plan.add(r.db.delete(t.groups).where(eq(t.groups.courseId, courseId)));
  plan.add(r.db.delete(t.courseStudyTypes).where(eq(t.courseStudyTypes.courseId, courseId)));
  plan.add(r.db.delete(t.courseHospitals).where(eq(t.courseHospitals.courseId, courseId)));
  plan.add(r.db.delete(t.courseAttendancePatterns).where(eq(t.courseAttendancePatterns.courseId, courseId)));
  plan.add(r.db.delete(t.courseHolidays).where(eq(t.courseHolidays.courseId, courseId)));
  plan.add(r.db.delete(t.courses).where(eq(t.courses.id, courseId)));
  // If it was the chosen course, the most recent remaining one takes over.
  plan.add(r.db.delete(t.meta).where(and(eq(t.meta.key, CURRENT_COURSE_KEY), eq(t.meta.value, courseId))));
  plan.audit("Course", courseId, "delete", { year: course.year, number: course.number, label: course.label });
  await plan.commit();
}
