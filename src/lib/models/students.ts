// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";

export type Shift = "MORNING" | "EVENING";

export interface Student {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  email: string | null;
  studyTypeId: string | null;
  groupId: string | null;
  courseId: string | null;
  shift: Shift | null;
  code: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentWithRelations extends Student {
  studyTypeName: string | null;
  groupName: string | null;
  courseLabel: string | null;
  // "YYYY-N" — the stable, parseable form of the course (courseLabel may be
  // a free-text label instead); used for CSV export round-tripping.
  courseCode: string | null;
}

function serialize(row: {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  email: string | null;
  studyTypeId: string | null;
  groupId: string | null;
  courseId: string | null;
  shift: string | null;
  code: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Student {
  return {
    id: row.id,
    universityNumber: row.universityNumber,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    email: row.email,
    studyTypeId: row.studyTypeId,
    groupId: row.groupId,
    courseId: row.courseId,
    shift: row.shift as Shift | null,
    code: row.code,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listStudents(includeInactive = false): Promise<StudentWithRelations[]> {
  const rows = await prisma.student.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { nameAr: "asc" },
    include: {
      studyType: { select: { name: true } },
      group: { select: { name: true } },
      course: { select: { year: true, number: true, label: true } },
    },
  });
  return rows.map((r: any) => ({
    ...serialize(r),
    studyTypeName: r.studyType?.name ?? null,
    groupName: r.group?.name ?? null,
    courseLabel: r.course ? r.course.label ?? `${r.course.year}-${r.course.number}` : null,
    courseCode: r.course ? `${r.course.year}-${r.course.number}` : null,
  }));
}

export async function getStudent(id: string): Promise<Student | undefined> {
  const row = await prisma.student.findUnique({ where: { id } });
  return row ? serialize(row) : undefined;
}

export async function getStudentByUniversityNumber(
  universityNumber: string
): Promise<Student | undefined> {
  const row = await prisma.student.findUnique({ where: { universityNumber } });
  return row ? serialize(row) : undefined;
}

export interface StudentInput {
  universityNumber: string;
  nameAr: string;
  nameEn?: string;
  email?: string;
  studyTypeId?: string | null;
  groupId?: string | null;
  courseId?: string | null;
  shift?: Shift | null;
}

// Builds the "Year-Course-StudyType-Sequence" code (e.g. "26-1-N-0001") and
// picks the next free sequence number for this (course, studyType) pair.
// Only possible once both a course and a study type (with a code) are set —
// a student can otherwise exist without a code and get one assigned later.
async function generateStudentCode(courseId: string, studyTypeId: string): Promise<string> {
  const [course, studyType] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId } }),
    prisma.studyType.findUnique({ where: { id: studyTypeId } }),
  ]);
  if (!course) throw new Error("الدورة غير موجودة");
  if (!studyType) throw new Error("نوع الدراسة غير موجود");
  if (!studyType.code) {
    throw new Error(`نوع الدراسة "${studyType.name}" ليس له رمز مختصر بعد — أضِف رمزًا من صفحة أنواع الدراسة أولاً`);
  }
  const prefix = `${String(course.year).slice(-2)}-${course.number}-${studyType.code}-`;

  const existingCount = await prisma.student.count({ where: { courseId, studyTypeId } });
  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = existingCount + 1 + attempt;
    const candidate = `${prefix}${String(seq).padStart(4, "0")}`;
    const clash = await prisma.student.findUnique({ where: { code: candidate } });
    if (!clash) return candidate;
  }
  throw new Error("تعذر توليد رمز فريد للطالب — حاول مرة أخرى");
}

export async function createStudent(actorId: string, data: StudentInput): Promise<Student> {
  if (!data.universityNumber?.trim()) throw new Error("University number is required");
  if (!data.nameAr?.trim()) throw new Error("Arabic name is required");
  if (await getStudentByUniversityNumber(data.universityNumber.trim())) {
    throw new Error(`A student with university number "${data.universityNumber}" already exists`);
  }
  const code =
    data.courseId && data.studyTypeId ? await generateStudentCode(data.courseId, data.studyTypeId) : null;
  const row = await prisma.student.create({
    data: {
      universityNumber: data.universityNumber.trim(),
      nameAr: data.nameAr.trim(),
      nameEn: data.nameEn?.trim() ?? null,
      email: data.email?.trim() ?? null,
      studyTypeId: data.studyTypeId ?? null,
      groupId: data.groupId ?? null,
      courseId: data.courseId ?? null,
      shift: data.shift ?? null,
      code,
    },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "Student", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateStudent(
  actorId: string,
  id: string,
  data: Partial<StudentInput> & { active?: boolean }
): Promise<Student> {
  const beforeRow = await prisma.student.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Student not found");
  const before = serialize(beforeRow);
  if (data.universityNumber && data.universityNumber.trim() !== before.universityNumber) {
    const clash = await getStudentByUniversityNumber(data.universityNumber.trim());
    if (clash && clash.id !== id) {
      throw new Error(`University number "${data.universityNumber}" is already used by another student`);
    }
  }
  const studyTypeId = data.studyTypeId === undefined ? before.studyTypeId : data.studyTypeId;
  const courseId = data.courseId === undefined ? before.courseId : data.courseId;
  const code = !before.code && courseId && studyTypeId ? await generateStudentCode(courseId, studyTypeId) : before.code;

  const row = await prisma.student.update({
    where: { id },
    data: {
      universityNumber: data.universityNumber?.trim() ?? before.universityNumber,
      nameAr: data.nameAr?.trim() ?? before.nameAr,
      nameEn: data.nameEn?.trim() ?? before.nameEn,
      email: data.email?.trim() ?? before.email,
      studyTypeId,
      groupId: data.groupId === undefined ? before.groupId : data.groupId,
      courseId,
      shift: data.shift === undefined ? before.shift : data.shift,
      code,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "Student",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}

// Bulk import used by the CSV import flow (§3.2 of the plan). Upserts by
// universityNumber — the stable identity — so re-importing the same file
// (e.g. a refreshed export from the registrar) updates existing students
// instead of creating duplicates or "ghost" records the way the old app's
// name-text matching could.
export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

function parseShiftCell(value: string | undefined): Shift | undefined {
  const s = value?.trim().toUpperCase();
  if (!s) return undefined;
  if (s === "MORNING" || s === "صباحي" || s === "AM") return "MORNING";
  if (s === "EVENING" || s === "مسائي" || s === "PM") return "EVENING";
  throw new Error(`Unknown shift "${value}" (expected MORNING/EVENING)`);
}

// Course cell is "year-number", e.g. "2026-1" — matches how it's exported.
async function resolveCourseId(value: string | undefined): Promise<string | null> {
  const v = value?.trim();
  if (!v) return null;
  const match = v.match(/^(\d{4})-(\d)$/);
  if (!match) throw new Error(`Unknown course format "${v}" (expected "YYYY-N", e.g. "2026-1")`);
  const course = await prisma.course.findUnique({
    where: { year_number: { year: Number(match[1]), number: Number(match[2]) } },
  });
  if (!course) throw new Error(`Unknown course "${v}"`);
  return course.id;
}

export async function importStudents(
  actorId: string,
  rows: Array<{
    universityNumber: string;
    nameAr: string;
    nameEn?: string;
    email?: string;
    studyType?: string;
    group?: string;
    course?: string;
    shift?: string;
  }>
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  let index = -1;
  for (const row of rows) {
    index++;
    try {
      if (!row.universityNumber?.trim() || !row.nameAr?.trim()) {
        throw new Error("Missing university number or name");
      }
      let studyTypeId: string | null = null;
      if (row.studyType?.trim()) {
        const st = await prisma.studyType.findFirst({
          where: { OR: [{ name: row.studyType.trim() }, { nameAr: row.studyType.trim() }] },
          select: { id: true },
        });
        if (!st) throw new Error(`Unknown study type "${row.studyType}"`);
        studyTypeId = st.id;
      }
      let groupId: string | null = null;
      if (row.group?.trim()) {
        const g = await prisma.group.findFirst({
          where: { name: row.group.trim() },
          select: { id: true },
        });
        if (!g) throw new Error(`Unknown group "${row.group}"`);
        groupId = g.id;
      }
      const courseId = await resolveCourseId(row.course);
      const shift = parseShiftCell(row.shift) ?? null;

      const existing = await getStudentByUniversityNumber(row.universityNumber.trim());
      if (existing) {
        await updateStudent(actorId, existing.id, {
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          email: row.email,
          studyTypeId,
          groupId,
          courseId,
          shift,
        });
        result.updated++;
      } else {
        await createStudent(actorId, {
          universityNumber: row.universityNumber,
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          email: row.email,
          studyTypeId,
          groupId,
          courseId,
          shift,
        });
        result.created++;
      }
    } catch (err) {
      result.errors.push({ row: index + 2, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
