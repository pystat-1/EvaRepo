// One-off demo seed: a hospital, a group, a student, an evaluator account,
// and a student account, wired together so the evaluator/student UI has
// something to show. Run once with: npx tsx scripts/seed-demo.ts
import { prisma } from "../src/lib/db";
import { createHospital } from "../src/lib/models/hospitals";
import { createGroup } from "../src/lib/models/groups";
import { createStudent } from "../src/lib/models/students";
import { createEvaluator } from "../src/lib/models/evaluators";
import { createStudentAccount } from "../src/lib/models/studentAccounts";

async function main() {
  const admin = await prisma.account.findUnique({ where: { email: "admin@eva.local" } });
  if (!admin) throw new Error("Seed the admin account first (npm run seed)");

  const nursing = await prisma.studyType.findFirst({ where: { name: "Nursing" } });

  const hospital = await createHospital(admin.id, {
    name: "Teaching Hospital",
    nameAr: "المستشفى التعليمي",
  });
  console.log("Hospital:", hospital.name, hospital.id);

  const group = await createGroup(admin.id, {
    name: "Group A",
    cycleLabel: "2026 Cycle 1",
    hospitalId: hospital.id,
  });
  console.log("Group:", group.name, group.id);

  const student = await createStudent(admin.id, {
    universityNumber: "DEMO-0001",
    nameAr: "طالب تجريبي",
    nameEn: "Demo Student",
    studyTypeId: nursing?.id ?? null,
    groupId: group.id,
  });
  console.log("Student:", student.nameEn, student.id);

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
