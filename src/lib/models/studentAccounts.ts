// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { hashPassword, findAccountByEmail } from "../auth";
import { getStudent } from "./students";

export interface StudentAccountRow {
  id: string;
  email: string;
  name: string;
  active: boolean;
  studentId: string;
}

export async function getStudentAccountForStudent(
  studentId: string
): Promise<StudentAccountRow | undefined> {
  const row = await prisma.account.findFirst({
    where: { studentId, role: "STUDENT" },
    select: { id: true, email: true, name: true, active: true, studentId: true },
  });
  return row ? { ...row, studentId: row.studentId! } : undefined;
}

export async function listStudentsWithoutAccounts(): Promise<
  { id: string; nameAr: string; universityNumber: string }[]
> {
  const rows = await prisma.student.findMany({
    where: { active: true, accounts: { none: { role: "STUDENT" } } },
    orderBy: { nameAr: "asc" },
    select: { id: true, nameAr: true, universityNumber: true },
  });
  return rows;
}

export async function createStudentAccount(
  actorId: string,
  data: { studentId: string; email: string; password: string }
): Promise<StudentAccountRow> {
  const student = await getStudent(data.studentId);
  if (!student) throw new Error("الطالب غير موجود");
  if (!data.email?.trim()) throw new Error("البريد الإلكتروني مطلوب");
  if (!data.password || data.password.length < 8) {
    throw new Error("كلمة المرور يجب أن تكون ٨ أحرف على الأقل");
  }
  if (await findAccountByEmail(data.email.trim())) {
    throw new Error(`البريد الإلكتروني "${data.email}" مستخدم من قبل حساب آخر`);
  }
  if (await getStudentAccountForStudent(data.studentId)) {
    throw new Error("لهذا الطالب حساب دخول بالفعل");
  }

  const passwordHash = await hashPassword(data.password);
  const account = await prisma.account.create({
    data: {
      email: data.email.trim(),
      passwordHash,
      name: student.nameAr,
      role: "STUDENT",
      studentId: data.studentId,
    },
  });

  const created = (await getStudentAccountForStudent(data.studentId))!;
  await recordAudit({ actorId, entityType: "StudentAccount", entityId: account.id, action: "create", after: created });
  return created;
}
