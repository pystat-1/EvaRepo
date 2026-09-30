// Server side of the student Excel import (see src/lib/studentImport/rows.ts
// for the template rules). The browser reads the file and sends the rows in
// small batches; each batch is written with a handful of set-based queries
// so a request stays within the Workers CPU budget.
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { groupKey, groupNumberFromName, validateRows, type ShiftCode, type StudentRowInput } from "../studentImport/rows";

// Sample students created by scripts/reset-nursing-course.ts.
export const SAMPLE_PREFIX = "SMP-";

export interface ImportGroup {
  id: string;
  name: string;
  shift: ShiftCode;
  number: number;
  studentCount: number;
}

export interface ImportContext {
  course: { id: string; label: string; year: number; number: number } | null;
  studyType: { id: string; name: string; code: string | null } | null;
  groups: ImportGroup[];
  sampleCount: number;
  studentCount: number;
}

// The course students are imported into: the most recent published one.
async function currentCourse() {
  return prisma.course.findFirst({
    where: { status: "PUBLISHED", active: true },
    orderBy: [{ year: "desc" }, { number: "desc" }],
    include: { studyTypes: { include: { studyType: true } } },
  });
}

export async function getImportContext(): Promise<ImportContext> {
  const course = await currentCourse();
  if (!course) return { course: null, studyType: null, groups: [], sampleCount: 0, studentCount: 0 };
  const [groups, sampleCount, studentCount] = await Promise.all([
    prisma.group.findMany({
      where: { courseId: course.id, active: true },
      select: { id: true, name: true, shift: true, _count: { select: { students: { where: { active: true } } } } },
    }),
    prisma.student.count({ where: { universityNumber: { startsWith: SAMPLE_PREFIX } } }),
    prisma.student.count({ where: { courseId: course.id, active: true } }),
  ]);
  const st = course.studyTypes[0]?.studyType ?? null;
  return {
    course: { id: course.id, label: course.label ?? `${course.year}-${course.number}`, year: course.year, number: course.number },
    studyType: st ? { id: st.id, name: st.nameAr ?? st.name, code: st.code } : null,
    groups: groups
      .filter((g) => g.shift && groupNumberFromName(g.name))
      .map((g) => ({
        id: g.id,
        name: g.name,
        shift: g.shift as ShiftCode,
        number: groupNumberFromName(g.name)!,
        studentCount: g._count.students,
      }))
      .sort((a, b) => (a.shift === b.shift ? a.number - b.number : a.shift === "MORNING" ? -1 : 1)),
    sampleCount,
    studentCount,
  };
}

export interface BatchResult {
  created: number;
  updated: number;
  issues: { row: number; message: string }[];
}

export async function importStudentBatch(
  actorId: string,
  courseId: string,
  rows: Array<StudentRowInput & { row: number }>
): Promise<BatchResult> {
  const ctx = await getImportContext();
  if (!ctx.course || ctx.course.id !== courseId) throw new Error("تغيّرت الدورة الحالية — أعد تحميل الصفحة");
  const groupBy = new Map(ctx.groups.map((g) => [groupKey(g.shift, g.number), g]));
  const { valid, issues } = validateRows(rows, new Set(groupBy.keys()));
  if (valid.length === 0) return { created: 0, updated: 0, issues };

  const existing = await prisma.student.findMany({
    where: { universityNumber: { in: valid.map((r) => r.universityNumber) } },
    select: { universityNumber: true },
  });
  const existingSet = new Set(existing.map((e) => e.universityNumber));
  const toCreate = valid.filter((r) => !existingSet.has(r.universityNumber));
  const toUpdate = valid.filter((r) => existingSet.has(r.universityNumber));
  const studyTypeId = ctx.studyType?.id ?? null;

  if (toCreate.length > 0) {
    const codes = await nextStudentCodes(ctx, toCreate.length);
    await prisma.student.createMany({
      data: toCreate.map((r, i) => ({
        universityNumber: r.universityNumber,
        nameAr: r.nameAr,
        nameEn: r.nameEn,
        email: r.email,
        shift: r.shift,
        groupId: groupBy.get(groupKey(r.shift, r.groupNumber))!.id,
        courseId,
        studyTypeId,
        code: codes[i],
        active: true,
      })),
    });
  }

  if (toUpdate.length > 0) {
    // One UPDATE ... FROM (VALUES ...) for the whole batch.
    const values = Prisma.join(
      toUpdate.map(
        (r) =>
          Prisma.sql`(${r.universityNumber}, ${r.nameAr}, ${r.nameEn}, ${r.email}, ${r.shift}, ${
            groupBy.get(groupKey(r.shift, r.groupNumber))!.id
          })`
      )
    );
    await prisma.$executeRaw`
      UPDATE "students" AS s SET
        "nameAr" = v.name_ar,
        "nameEn" = v.name_en,
        "email" = v.email,
        "shift" = v.shift::"Shift",
        "groupId" = v.group_id,
        "courseId" = ${courseId},
        "studyTypeId" = COALESCE(${studyTypeId}, s."studyTypeId"),
        "active" = true,
        "updatedAt" = NOW()
      FROM (VALUES ${values}) AS v(uni, name_ar, name_en, email, shift, group_id)
      WHERE s."universityNumber" = v.uni`;
  }

  await recordAudit({
    actorId,
    entityType: "Student",
    entityId: `excel-import-${Date.now()}`,
    action: "import",
    after: { created: toCreate.length, updated: toUpdate.length, errorCount: issues.length },
  });
  return { created: toCreate.length, updated: toUpdate.length, issues };
}

// "YY-N-CODE-0001" codes continuing after the highest one already used for
// this course and study type (same format as createStudent).
async function nextStudentCodes(ctx: ImportContext, count: number): Promise<(string | null)[]> {
  if (!ctx.course || !ctx.studyType?.code) return Array(count).fill(null);
  const prefix = `${String(ctx.course.year).slice(-2)}-${ctx.course.number}-${ctx.studyType.code}-`;
  const used = await prisma.student.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } });
  let max = 0;
  for (const u of used) {
    const n = Number(u.code!.slice(prefix.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${String(max + 1 + i).padStart(4, "0")}`);
}

// Removes students and everything recorded about them (grades, attendance,
// flags). Only used for the generated sample students.
async function deleteStudentsCompletely(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$transaction([
    prisma.evaluationScore.deleteMany({ where: { evaluation: { studentId: { in: ids } } } }),
    prisma.evaluation.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.attendanceRecord.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.flag.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.evaluationClaim.deleteMany({ where: { studentId: { in: ids } } }),
    prisma.account.updateMany({ where: { studentId: { in: ids } }, data: { studentId: null } }),
    prisma.student.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

export interface FinishResult {
  samplesRemoved: number;
  deactivated: number;
}

// After all batches: optionally delete the sample students, and optionally
// deactivate students of this course who are not in the imported file (so
// the file becomes the course's student list).
export async function finishStudentImport(
  actorId: string,
  courseId: string,
  opts: { removeSamples: boolean; deactivateMissing: boolean; universityNumbers: string[] }
): Promise<FinishResult> {
  const keep = new Set(opts.universityNumbers);
  let samplesRemoved = 0;
  let deactivated = 0;
  if (opts.removeSamples) {
    const samples = await prisma.student.findMany({
      where: { universityNumber: { startsWith: SAMPLE_PREFIX } },
      select: { id: true, universityNumber: true },
    });
    const ids = samples.filter((s) => !keep.has(s.universityNumber)).map((s) => s.id);
    await deleteStudentsCompletely(ids);
    samplesRemoved = ids.length;
  }
  if (opts.deactivateMissing && keep.size > 0) {
    const res = await prisma.student.updateMany({
      where: { courseId, active: true, universityNumber: { notIn: Array.from(keep) } },
      data: { active: false },
    });
    deactivated = res.count;
  }
  await recordAudit({
    actorId,
    entityType: "Student",
    entityId: `excel-import-finish-${Date.now()}`,
    action: "import",
    after: { samplesRemoved, deactivated, imported: keep.size },
  });
  return { samplesRemoved, deactivated };
}

// Rows for "download the current student list" in the template's format.
export async function listCourseStudentsForExport(courseId: string) {
  const rows = await prisma.student.findMany({
    where: { courseId, active: true },
    orderBy: [{ shift: "asc" }, { group: { name: "asc" } }, { nameAr: "asc" }],
    select: { universityNumber: true, nameAr: true, nameEn: true, email: true, shift: true, group: { select: { name: true } } },
  });
  return rows.map((r) => ({
    universityNumber: r.universityNumber,
    nameAr: r.nameAr,
    nameEn: r.nameEn ?? "",
    shift: r.shift === "EVENING" ? "مسائي" : "صباحي",
    group: r.group ? String(groupNumberFromName(r.group.name) ?? "") : "",
    email: r.email ?? "",
  }));
}
