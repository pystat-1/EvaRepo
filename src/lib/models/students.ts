// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";

export interface Student {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  email: string | null;
  studyTypeId: string | null;
  groupId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudentWithRelations extends Student {
  studyTypeName: string | null;
  groupName: string | null;
}

function serialize(row: {
  id: string;
  universityNumber: string;
  nameAr: string;
  nameEn: string | null;
  email: string | null;
  studyTypeId: string | null;
  groupId: string | null;
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
    },
  });
  return rows.map((r: any) => ({
    ...serialize(r),
    studyTypeName: r.studyType?.name ?? null,
    groupName: r.group?.name ?? null,
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
}

export async function createStudent(actorId: string, data: StudentInput): Promise<Student> {
  if (!data.universityNumber?.trim()) throw new Error("University number is required");
  if (!data.nameAr?.trim()) throw new Error("Arabic name is required");
  if (await getStudentByUniversityNumber(data.universityNumber.trim())) {
    throw new Error(`A student with university number "${data.universityNumber}" already exists`);
  }
  const row = await prisma.student.create({
    data: {
      universityNumber: data.universityNumber.trim(),
      nameAr: data.nameAr.trim(),
      nameEn: data.nameEn?.trim() ?? null,
      email: data.email?.trim() ?? null,
      studyTypeId: data.studyTypeId ?? null,
      groupId: data.groupId ?? null,
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
  const row = await prisma.student.update({
    where: { id },
    data: {
      universityNumber: data.universityNumber?.trim() ?? before.universityNumber,
      nameAr: data.nameAr?.trim() ?? before.nameAr,
      nameEn: data.nameEn?.trim() ?? before.nameEn,
      email: data.email?.trim() ?? before.email,
      studyTypeId: data.studyTypeId === undefined ? before.studyTypeId : data.studyTypeId,
      groupId: data.groupId === undefined ? before.groupId : data.groupId,
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

export async function importStudents(
  actorId: string,
  rows: Array<{
    universityNumber: string;
    nameAr: string;
    nameEn?: string;
    email?: string;
    studyType?: string;
    group?: string;
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

      const existing = await getStudentByUniversityNumber(row.universityNumber.trim());
      if (existing) {
        await updateStudent(actorId, existing.id, {
          nameAr: row.nameAr,
          nameEn: row.nameEn,
          email: row.email,
          studyTypeId,
          groupId,
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
        });
        result.created++;
      }
    } catch (err) {
      result.errors.push({ row: index + 2, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
