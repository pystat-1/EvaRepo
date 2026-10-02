// Students: list/search, add/edit, activate/deactivate, and the Excel
// import (template rules from @eva/core/students/importRows). Unlike the
// website (which had to split imports into small batches), an import here
// is one transaction: the whole file is applied, or nothing is.
import { and, eq, inArray, like } from "drizzle-orm";
import {
  groupKey,
  groupNumberFromName,
  validateRows,
  type RowIssue,
  type ShiftCode,
  type StudentRowInput,
} from "@eva/core/students/importRows";
import { compareArabic, matchesSearch } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";

export const SAMPLE_PREFIX = "SMP-";

export interface StudentRow {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  email: string | null;
  code: string | null;
  shift: t.Shift | null;
  active: boolean;
  groupId: string | null;
  groupName: string | null;
  courseId: string | null;
  courseLabel: string | null;
}

export interface StudentFilter {
  search?: string;
  courseId?: string;
  groupId?: string;
  shift?: t.Shift;
  includeInactive?: boolean;
}

export async function listStudents(r: Repo, f: StudentFilter = {}): Promise<StudentRow[]> {
  const rows = await r.db
    .select({
      id: t.students.id,
      universityNumber: t.students.universityNumber,
      nameAr: t.students.nameAr,
      nameEn: t.students.nameEn,
      email: t.students.email,
      code: t.students.code,
      shift: t.students.shift,
      active: t.students.active,
      groupId: t.students.groupId,
      groupName: t.groups.name,
      courseId: t.students.courseId,
      courseLabel: t.courses.label,
    })
    .from(t.students)
    .leftJoin(t.groups, eq(t.groups.id, t.students.groupId))
    .leftJoin(t.courses, eq(t.courses.id, t.students.courseId))
    .where(
      and(
        f.courseId ? eq(t.students.courseId, f.courseId) : undefined,
        f.groupId ? eq(t.students.groupId, f.groupId) : undefined,
        f.shift ? eq(t.students.shift, f.shift) : undefined,
        f.includeInactive ? undefined : eq(t.students.active, true)
      )
    );
  return rows
    .filter((s) => !f.search || matchesSearch(f.search, s.nameAr, s.nameEn, s.universityNumber, s.code, s.email))
    .sort((a, b) => compareArabic(a.nameAr, b.nameAr));
}

export interface StudentInput {
  id?: string;
  universityNumber: string;
  nameAr: string;
  nameEn?: string | null;
  email?: string | null;
  groupId: string | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Next "YY-N-CODE-0001" codes for this course + study type, continuing
// after the highest code in use (ignoring students about to be removed).
async function nextCodes(
  r: Repo,
  courseId: string | null,
  studyTypeId: string | null,
  count: number,
  removed: Set<string> = new Set()
): Promise<(string | null)[]> {
  if (!courseId || !studyTypeId) return Array(count).fill(null);
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  const [st] = await r.db.select().from(t.studyTypes).where(eq(t.studyTypes.id, studyTypeId));
  if (!course || !st?.code) return Array(count).fill(null);
  const prefix = `${String(course.year).slice(-2)}-${course.number}-${st.code}-`;
  const used = await r.db.select({ id: t.students.id, code: t.students.code }).from(t.students).where(like(t.students.code, `${prefix}%`));
  const max = used.filter((u) => !removed.has(u.id)).reduce((m, u) => Math.max(m, Number(u.code!.slice(prefix.length)) || 0), 0);
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, "0")}`);
}

/** Adds or edits one student. The group decides course, shift and study type. */
export async function saveStudent(r: Repo, input: StudentInput): Promise<string> {
  const universityNumber = input.universityNumber.trim();
  const nameAr = input.nameAr.replace(/\s+/g, " ").trim();
  const email = input.email?.trim() || null;
  if (!universityNumber) throw new ValidationError("الرقم الجامعي مطلوب", "universityNumber");
  if (!nameAr) throw new ValidationError("الاسم مطلوب", "nameAr");
  if (email && !EMAIL.test(email)) throw new ValidationError("البريد الإلكتروني غير صالح", "email");

  const [clash] = await r.db.select({ id: t.students.id }).from(t.students).where(eq(t.students.universityNumber, universityNumber));
  if (clash && clash.id !== input.id) throw new ValidationError("يوجد طالب آخر بهذا الرقم الجامعي", "universityNumber");

  const group = input.groupId ? (await r.db.select().from(t.groups).where(eq(t.groups.id, input.groupId)))[0] : undefined;
  if (input.groupId && !group) throw new ValidationError("المجموعة غير موجودة", "groupId");
  const placement = {
    groupId: group?.id ?? null,
    courseId: group?.courseId ?? null,
    shift: group?.shift ?? null,
    studyTypeId: group?.studyTypeId ?? null,
  };
  const fields = { universityNumber, nameAr, nameEn: input.nameEn?.trim() || null, email, ...placement };
  const plan = new Plan(r);

  if (input.id) {
    const [before] = await r.db.select().from(t.students).where(eq(t.students.id, input.id));
    if (!before) throw new ValidationError("الطالب غير موجود");
    const code = before.code ?? (await nextCodes(r, placement.courseId, placement.studyTypeId, 1))[0];
    plan.add(r.db.update(t.students).set({ ...fields, code, updatedAt: nowISO() }).where(eq(t.students.id, input.id)));
    plan.audit("Student", input.id, "update", before, fields);
    await plan.commit();
    return input.id;
  }
  const id = newId();
  const [code] = await nextCodes(r, placement.courseId, placement.studyTypeId, 1);
  plan.add(r.db.insert(t.students).values({ id, ...fields, code }));
  plan.audit("Student", id, "create", undefined, fields);
  await plan.commit();
  return id;
}

export async function setStudentActive(r: Repo, id: string, active: boolean): Promise<void> {
  const plan = new Plan(r);
  plan.add(r.db.update(t.students).set({ active, updatedAt: nowISO() }).where(eq(t.students.id, id)));
  plan.audit("Student", id, active ? "reactivate" : "deactivate");
  await plan.commit();
}

// ---- Excel import -------------------------------------------------------

export interface ImportGroup {
  id: string;
  name: string;
  shift: ShiftCode;
  number: number;
  studentCount: number;
}

export interface ImportContext {
  course: { id: string; label: string } | null;
  studyType: { id: string; name: string } | null;
  groups: ImportGroup[];
  sampleCount: number;
}

/** The course imports go into: the most recent published one. */
/** Where the admin's choice of current course is kept (meta key). */
export const CURRENT_COURSE_KEY = "course.current";

/**
 * The course every screen and the phones work on: the one the admin chose
 * (it stays until they choose another), or else the most recent published one.
 */
export async function currentCourse(r: Repo) {
  const rows = await r.db.select().from(t.courses).where(and(eq(t.courses.status, "PUBLISHED"), eq(t.courses.active, true)));
  const [chosen] = await r.db.select().from(t.meta).where(eq(t.meta.key, CURRENT_COURSE_KEY));
  return rows.find((c) => c.id === chosen?.value) ?? rows.sort((a, b) => b.year - a.year || b.number - a.number)[0] ?? null;
}

export async function setCurrentCourse(r: Repo, courseId: string) {
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  if (!course) throw new ValidationError("الدورة غير موجودة");
  const plan = new Plan(r);
  plan.add(r.db.insert(t.meta).values({ key: CURRENT_COURSE_KEY, value: courseId }).onConflictDoUpdate({ target: t.meta.key, set: { value: courseId } }));
  plan.audit("Course", courseId, "update", undefined, { name: `الدورة الحالية: ${course.label ?? `${course.year}-${course.number}`}` });
  await plan.commit();
}

/** Import target: the given course, or else the most recent published one. */
export async function importContext(r: Repo, courseId?: string): Promise<ImportContext> {
  const course = courseId
    ? ((await r.db.select().from(t.courses).where(eq(t.courses.id, courseId)))[0] ?? null)
    : await currentCourse(r);
  if (!course) return { course: null, studyType: null, groups: [], sampleCount: 0 };
  const [cst] = await r.db
    .select({ id: t.studyTypes.id, name: t.studyTypes.nameAr, fallback: t.studyTypes.name })
    .from(t.courseStudyTypes)
    .innerJoin(t.studyTypes, eq(t.studyTypes.id, t.courseStudyTypes.studyTypeId))
    .where(eq(t.courseStudyTypes.courseId, course.id));
  const groups = await r.db.select().from(t.groups).where(and(eq(t.groups.courseId, course.id), eq(t.groups.active, true)));
  const students = await r.db
    .select({ groupId: t.students.groupId, uni: t.students.universityNumber })
    .from(t.students)
    .where(eq(t.students.active, true));
  return {
    course: { id: course.id, label: course.label ?? `${course.year}-${course.number}` },
    studyType: cst ? { id: cst.id, name: cst.name ?? cst.fallback } : null,
    groups: groups
      .filter((g) => g.shift && groupNumberFromName(g.name))
      .map((g) => ({
        id: g.id,
        name: g.name,
        shift: g.shift as ShiftCode,
        number: groupNumberFromName(g.name)!,
        studentCount: students.filter((s) => s.groupId === g.id).length,
      }))
      .sort((a, b) => (a.shift === b.shift ? a.number - b.number : a.shift === "MORNING" ? -1 : 1)),
    sampleCount: students.filter((s) => s.uni.startsWith(SAMPLE_PREFIX)).length,
  };
}

export interface ImportOptions {
  removeSamples: boolean;
  deactivateMissing: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  samplesRemoved: number;
  deactivated: number;
  issues: RowIssue[];
}

/** Checks the rows without writing anything (the preview). */
export async function previewImport(r: Repo, rows: Array<StudentRowInput & { row: number }>, courseId?: string) {
  const ctx = await importContext(r, courseId);
  return { ctx, ...validateRows(rows, new Set(ctx.groups.map((g) => groupKey(g.shift, g.number)))) };
}

/** Applies a whole file in ONE transaction. Rows with problems are skipped and reported. */
export async function importStudents(
  r: Repo,
  rows: Array<StudentRowInput & { row: number }>,
  opts: ImportOptions & { courseId?: string }
): Promise<ImportResult> {
  const { ctx, valid, issues } = await previewImport(r, rows, opts.courseId);
  if (!ctx.course) throw new ValidationError("لا توجد دورة منشورة لاستيراد الطلاب إليها");
  const groupBy = new Map(ctx.groups.map((g) => [groupKey(g.shift, g.number), g]));
  const keep = new Set(valid.map((v) => v.universityNumber));
  const plan = new Plan(r);

  // 1. Sample students go first, so real students' codes start at 0001.
  let samplesRemoved = 0;
  const removedIds = new Set<string>();
  if (opts.removeSamples) {
    const samples = await r.db
      .select({ id: t.students.id, uni: t.students.universityNumber })
      .from(t.students)
      .where(like(t.students.universityNumber, `${SAMPLE_PREFIX}%`));
    const ids = samples.filter((s) => !keep.has(s.uni)).map((s) => s.id);
    ids.forEach((id) => removedIds.add(id));
    if (ids.length > 0) {
      plan.add(r.db.delete(t.evaluationScores).where(inArray(t.evaluationScores.evaluationId,
        r.db.select({ id: t.evaluations.id }).from(t.evaluations).where(inArray(t.evaluations.studentId, ids)))));
      plan.add(r.db.delete(t.evaluations).where(inArray(t.evaluations.studentId, ids)));
      plan.add(r.db.delete(t.attendanceRecords).where(inArray(t.attendanceRecords.studentId, ids)));
      plan.add(r.db.delete(t.flags).where(inArray(t.flags.studentId, ids)));
      plan.add(r.db.update(t.accounts).set({ studentId: null }).where(inArray(t.accounts.studentId, ids)));
      plan.add(r.db.delete(t.students).where(inArray(t.students.id, ids)));
      samplesRemoved = ids.length;
    }
  }

  // 2. New students and updates, matched by university number.
  const existing = valid.length
    ? await r.db
        .select({ id: t.students.id, uni: t.students.universityNumber, code: t.students.code })
        .from(t.students)
        .where(inArray(t.students.universityNumber, valid.map((v) => v.universityNumber)))
    : [];
  const byUni = new Map(existing.map((e) => [e.uni, e]));
  const toCreate = valid.filter((v) => !byUni.has(v.universityNumber));
  const studyTypeId = ctx.studyType?.id ?? null;
  // Codes count only students that will still exist after this import.
  const codes = await nextCodes(r, ctx.course.id, studyTypeId, toCreate.length, removedIds);
  toCreate.forEach((v, i) => {
    const g = groupBy.get(groupKey(v.shift, v.groupNumber))!;
    plan.add(
      r.db.insert(t.students).values({
        id: newId(),
        universityNumber: v.universityNumber,
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        email: v.email,
        shift: v.shift,
        groupId: g.id,
        courseId: ctx.course!.id,
        studyTypeId,
        code: codes[i],
        active: true,
      })
    );
  });
  let updated = 0;
  for (const v of valid) {
    const e = byUni.get(v.universityNumber);
    if (!e) continue;
    const g = groupBy.get(groupKey(v.shift, v.groupNumber))!;
    plan.add(
      r.db
        .update(t.students)
        .set({ nameAr: v.nameAr, nameEn: v.nameEn, email: v.email, shift: v.shift, groupId: g.id, courseId: ctx.course.id, active: true, updatedAt: nowISO() })
        .where(eq(t.students.id, e.id))
    );
    updated++;
  }

  // 3. Optionally the file becomes the course's list.
  let deactivated = 0;
  if (opts.deactivateMissing && keep.size > 0) {
    const current = await r.db
      .select({ id: t.students.id, uni: t.students.universityNumber })
      .from(t.students)
      .where(and(eq(t.students.courseId, ctx.course.id), eq(t.students.active, true)));
    const missing = current.filter((s) => !keep.has(s.uni) && !removedIds.has(s.id)).map((s) => s.id);
    if (missing.length) plan.add(r.db.update(t.students).set({ active: false, updatedAt: nowISO() }).where(inArray(t.students.id, missing)));
    deactivated = missing.length;
  }

  const result = { created: toCreate.length, updated, samplesRemoved, deactivated, issues };
  plan.audit("Student", `excel-import-${Date.now()}`, "import", undefined, { ...result, issues: issues.length });
  await plan.commit();
  return result;
}

/** Current students of the course in the template's format (for re-editing in Excel). */
export async function exportForTemplate(r: Repo, courseId: string) {
  const rows = await listStudents(r, { courseId });
  return rows.map((s) => ({
    universityNumber: s.universityNumber,
    nameAr: s.nameAr,
    nameEn: s.nameEn ?? "",
    shift: s.shift === "EVENING" ? "مسائي" : "صباحي",
    group: s.groupName ? String(groupNumberFromName(s.groupName) ?? "") : "",
    email: s.email ?? "",
  }));
}
