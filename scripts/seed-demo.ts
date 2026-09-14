// One-off demo seed: a hospital, a course, a group with a rotation block, a
// student, an evaluator account, and a student account, wired together so
// the evaluator/student UI and the new course/rotation structure both have
// something to show. Run once with: npx tsx scripts/seed-demo.ts
import { prisma } from "../src/lib/db";
import { createHospital } from "../src/lib/models/hospitals";
import { createCourse } from "../src/lib/models/courses";
import { createGroup } from "../src/lib/models/groups";
import { createRotationBlock } from "../src/lib/models/rotationBlocks";
import { createStudent } from "../src/lib/models/students";
import { createEvaluator } from "../src/lib/models/evaluators";
import { createStudentAccount } from "../src/lib/models/studentAccounts";

async function main() {
  const admin = await prisma.account.findUnique({ where: { email: "admin@eva.local" } });
  if (!admin) throw new Error("Seed the admin account first (npm run seed)");

  let nursing = await prisma.studyType.findFirst({ where: { name: "Nursing" } });
  if (nursing && !nursing.code) {
    nursing = await prisma.studyType.update({ where: { id: nursing.id }, data: { code: "N" } });
  }

  const hospital = await createHospital(admin.id, {
    name: "Teaching Hospital",
    nameAr: "المستشفى التعليمي",
  });
  console.log("Hospital:", hospital.name, hospital.id);

  const year = new Date().getFullYear();
  const course = await createCourse(admin.id, { year, number: 1, label: `${year} Course 1` });
  console.log("Course:", course.label, course.id);

  const group = await createGroup(admin.id, {
    name: "Group A",
    cycleLabel: "2026 Cycle 1",
    courseId: course.id,
    shift: "MORNING",
    studyTypeId: nursing?.id ?? null,
  });
  console.log("Group:", group.name, group.id);

  const today = new Date();
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + 13 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await createRotationBlock(admin.id, {
    groupId: group.id,
    hospitalId: hospital.id,
    startDate: start,
    endDate: end,
    daysOfWeek: "SUN,TUE",
  });
  console.log("Rotation block:", hospital.name, start, "->", end);

  const student = await createStudent(admin.id, {
    universityNumber: "DEMO-0001",
    nameAr: "طالب تجريبي",
    nameEn: "Demo Student",
    studyTypeId: nursing?.id ?? null,
    groupId: group.id,
    courseId: course.id,
    shift: "MORNING",
  });
  console.log("Student:", student.nameEn, student.id, "code:", student.code);

  const evaluatorEmail = "evaluator.demo@eva.local";
  const evaluatorPassword = "Eva-Evaluator-2026!";
  const evaluator = await createEvaluator(admin.id, {
    name: "Demo Evaluator",
    email: evaluatorEmail,
    password: evaluatorPassword,
    hospitalId: hospital.id,
    groupId: group.id,
  });
  console.log("Evaluator login:", evaluatorEmail, "/", evaluatorPassword, "id:", evaluator.id);

  const studentEmail = "student.demo@eva.local";
  const studentPassword = "Eva-Student-2026!";
  await createStudentAccount(admin.id, {
    studentId: student.id,
    email: studentEmail,
    password: studentPassword,
  });
  console.log("Student login:", studentEmail, "/", studentPassword);

  console.log("Demo seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
