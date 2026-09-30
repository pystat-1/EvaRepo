// One-off reset (2026-09-30, requested by the admin): delete every student
// and all old course structure, then set up the nursing course fresh:
//   - hospitals: مستشفى اليرموك، مستشفى مدينة الطب، مستشفى العلوية
//   - 2 shifts (صباحي / مسائي) × 3 groups × 20 students = 120 students
//     (generated sample names; university numbers start with "SMP-" so the
//     Excel import can recognise and replace them with the real list)
//   - a 6-week course from Sunday 2026-10-04, Sunday–Thursday, each group
//     spending 2 weeks at each hospital (Latin-square rotation per shift)
//   - 2 evaluators per hospital (hospital-wide assignments)
//
// Admin and evaluator accounts are kept. Run with the target database in
// DATABASE_URL and --confirm:
//   npx tsx --tsconfig tsconfig.json scripts/reset-nursing-course.ts --confirm
// EVALUATOR_TEST_PASSWORD (optional) sets the six assigned evaluators'
// password so they can be used to test; it is never printed.
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

const COURSE = { year: 2026, number: 1, label: "دورة التمريض الأولى 2026", startDate: "2026-10-04", weekCount: 6 };
const DAYS = "SUN,MON,TUE,WED,THU";
const HOSPITALS = ["مستشفى اليرموك", "مستشفى مدينة الطب", "مستشفى العلوية"];
const SHIFTS = [
  { shift: "MORNING" as const, label: "الصباحية" },
  { shift: "EVENING" as const, label: "المسائية" },
];
const GROUPS_PER_SHIFT = 3;
const STUDENTS_PER_GROUP = 20;
const WEEKS_PER_HOSPITAL = 2;
// Two evaluators per hospital, in HOSPITALS order.
const EVALUATORS = [
  ["sara.kadhimi@example-eva.iq", "ali.rubaie@example-eva.iq"],
  ["noor.saadi@example-eva.iq", "haider.taie@example-eva.iq"],
  ["zainab.hasnawi@example-eva.iq", "mustafa.janabi@example-eva.iq"],
];
const SEED_STUDY_TYPE_NAMES = ["Nursing [full-course-seed]", "Midwifery [full-course-seed]"];

export function groupName(shiftLabel: string, n: number): string {
  return `المجموعة ${shiftLabel} ${n}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 120 distinct, realistic sample names (first + father + family).
const FEMALE = ["زينب", "فاطمة", "مريم", "نور", "سارة", "هدى", "رقية", "زهراء", "آية", "دعاء", "بتول", "رسل", "حوراء", "تبارك", "شهد", "ملاك", "أسماء", "إسراء", "غدير", "ريام"];
const MALE = ["علي", "حسين", "محمد", "أحمد", "مصطفى", "حيدر", "عباس", "كرار", "مرتضى", "سجاد", "يوسف", "عمر", "حسن", "زيد", "منتظر", "أمير", "باقر", "جعفر", "سيف", "ياسر"];
const FATHERS = ["عبد الله", "كاظم", "جاسم", "حسن", "عادل", "كريم", "صالح", "ناصر", "فاضل", "رعد", "سعد", "خالد"];
const FAMILIES = ["الربيعي", "الساعدي", "الجبوري", "العبيدي", "الخفاجي", "التميمي", "الموسوي", "الحسيني", "الزبيدي", "الدليمي", "الكعبي", "الشمري"];

function sampleNames(count: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (out.length < count) {
    const first = i % 2 === 0 ? FEMALE[(i * 7) % FEMALE.length] : MALE[(i * 11) % MALE.length];
    const name = `${first} ${FATHERS[(i * 5) % FATHERS.length]} ${FAMILIES[(i * 3 + Math.floor(i / 12)) % FAMILIES.length]}`;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    i++;
  }
  return out;
}

async function wipe() {
  const studentAccounts = await prisma.account.findMany({ where: { role: "STUDENT" }, select: { id: true } });
  const saIds = studentAccounts.map((a) => a.id);
  const counts: Record<string, number> = {};
  const run = async (label: string, p: Promise<{ count: number }>) => (counts[label] = (await p).count);

  await run("evaluationScores", prisma.evaluationScore.deleteMany({}));
  await run("evaluations", prisma.evaluation.deleteMany({}));
  await run("evaluationSubmissions", prisma.evaluationSubmission.deleteMany({}));
  await run("evaluationConflicts", prisma.evaluationConflict.deleteMany({}));
  await run("evaluationClaims", prisma.evaluationClaim.deleteMany({}));
  await run("attendanceRecords", prisma.attendanceRecord.deleteMany({}));
  await run("groupWorkDays", prisma.groupWorkDay.deleteMany({}));
  await run("flags", prisma.flag.deleteMany({}));
  await run("studentSessions", prisma.session.deleteMany({ where: { accountId: { in: saIds } } }));
  // Student accounts may have audit rows as the actor; keep the audit log,
  // detach them from the account before deleting it.
  await prisma.auditLog.updateMany({ where: { actorId: { in: saIds } }, data: { actorId: null } });
  await run("studentAccounts", prisma.account.deleteMany({ where: { id: { in: saIds } } }));
  await prisma.account.updateMany({ where: { studentId: { not: null } }, data: { studentId: null } });
  await run("students", prisma.student.deleteMany({}));
  await run("evaluatorAssignments", prisma.evaluatorAssignment.deleteMany({}));
  await run("rotationBlocks", prisma.rotationBlock.deleteMany({}));
  await run("groups", prisma.group.deleteMany({}));
  await run("courseHospitals", prisma.courseHospital.deleteMany({}));
  await run("courseStudyTypes", prisma.courseStudyType.deleteMany({}));
  await run("courseAttendancePatterns", prisma.courseAttendancePattern.deleteMany({}));
  await run("courseHolidays", prisma.courseHoliday.deleteMany({}));
  await run("courses", prisma.course.deleteMany({}));
  await run("hospitals", prisma.hospital.deleteMany({}));
  await run("seedStudyTypes", prisma.studyType.deleteMany({ where: { name: { in: SEED_STUDY_TYPE_NAMES } } }));
  return counts;
}

async function build() {
  const nursing = await prisma.studyType.findFirst({ where: { code: "N" } });
  if (!nursing) throw new Error('Study type with code "N" (التمريض) not found');

  const course = await prisma.course.create({
    data: {
      year: COURSE.year,
      number: COURSE.number,
      label: COURSE.label,
      status: "PUBLISHED",
      startDate: COURSE.startDate,
      weekCount: COURSE.weekCount,
      setupStep: 8,
      scheduleVersion: 1,
      studyTypes: { create: [{ studyTypeId: nursing.id }] },
      attendancePatterns: { create: [{ daysOfWeek: DAYS }] },
    },
  });

  // Term settings drive how the evaluator's schedule groups days into weeks.
  const term = { weeksCount: COURSE.weekCount, daysPerWeek: 5, weekdays: DAYS, startDate: COURSE.startDate };
  await prisma.termSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...term }, update: term });

  const hospitals = [];
  for (const name of HOSPITALS) {
    hospitals.push(await prisma.hospital.create({ data: { name, nameAr: name, courseLinks: { create: [{ courseId: course.id }] } } }));
  }

  const names = sampleNames(SHIFTS.length * GROUPS_PER_SHIFT * STUDENTS_PER_GROUP);
  let seq = 0;
  const blocks: Prisma.RotationBlockCreateManyInput[] = [];
  for (const s of SHIFTS) {
    for (let g = 1; g <= GROUPS_PER_SHIFT; g++) {
      const group = await prisma.group.create({
        data: { name: groupName(s.label, g), courseId: course.id, shift: s.shift, studyTypeId: nursing.id },
      });
      const students = [];
      for (let k = 0; k < STUDENTS_PER_GROUP; k++) {
        seq++;
        students.push({
          universityNumber: `SMP-${String(seq).padStart(3, "0")}`,
          nameAr: names[seq - 1],
          code: `26-1-N-${String(seq).padStart(4, "0")}`,
          studyTypeId: nursing.id,
          groupId: group.id,
          courseId: course.id,
          shift: s.shift,
        });
      }
      await prisma.student.createMany({ data: students });

      // Group g starts at hospital g-1 and moves to the next every stint.
      for (let week = 0; week < COURSE.weekCount; week++) {
        const stint = Math.floor(week / WEEKS_PER_HOSPITAL);
        const hospital = hospitals[(g - 1 + stint) % hospitals.length];
        const start = addDays(COURSE.startDate, week * 7);
        blocks.push({
          groupId: group.id,
          hospitalId: hospital.id,
          courseId: course.id,
          weekIndex: week,
          startDate: start,
          endDate: addDays(start, 4), // Sunday..Thursday
          daysOfWeek: DAYS,
        });
      }
    }
  }
  await prisma.rotationBlock.createMany({ data: blocks });

  const passwordHash = process.env.EVALUATOR_TEST_PASSWORD ? await hashPassword(process.env.EVALUATOR_TEST_PASSWORD) : null;
  const assigned: string[] = [];
  for (let h = 0; h < hospitals.length; h++) {
    for (const email of EVALUATORS[h]) {
      const acc = await prisma.account.findUnique({ where: { email } });
      if (!acc || acc.role !== "EVALUATOR") throw new Error(`Evaluator ${email} not found`);
      await prisma.account.update({
        where: { id: acc.id },
        data: { active: true, ...(passwordHash ? { passwordHash } : {}) },
      });
      await prisma.evaluatorAssignment.create({
        data: { accountId: acc.id, hospitalId: hospitals[h].id, courseId: course.id, groupId: null },
      });
      assigned.push(`${hospitals[h].name}: ${acc.name} <${email}>`);
    }
  }
  return { courseId: course.id, students: seq, blocks: blocks.length, assigned };
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.log("Dry run only. Re-run with --confirm to delete and rebuild.");
    return;
  }
  const host = (process.env.DATABASE_URL ?? "").split("@")[1]?.split("/")[0];
  console.log("Target database host:", host);
  const deleted = await wipe();
  console.log("Deleted:", deleted);
  const built = await build();
  console.log("Built:", { courseId: built.courseId, students: built.students, rotationBlocks: built.blocks });
  console.log("Evaluator assignments:\n  " + built.assigned.join("\n  "));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
