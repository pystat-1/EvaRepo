// Seed ONE fully-populated course, end-to-end, for testing the setup wizard
// and the grading center's grade sheet: term settings, study types,
// hospitals, groups, students, supervisors, a rotation schedule, and a
// completed evaluation (attendance + per-criterion scores) for every student
// on every rotation day — i.e. what the data looks like at end of course.
//
// Safe to re-run: everything it creates is tagged with SEED_TAG and wiped
// first, so it never piles up duplicates and never touches other data.
//
//   npx tsx scripts/seedFullCourse.ts
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { ensureDefaultRubric, listRubricSections } from "../src/lib/models/rubric";
import { isDateInScheduledDays } from "../src/lib/weekdays";

const SEED_TAG = "[full-course-seed]"; // stamped into notes/labels for cleanup

const HOSPITAL_NAMES = [
  { name: "Baghdad Teaching Hospital", nameAr: "مستشفى بغداد التعليمي" },
  { name: "Al-Yarmouk Teaching Hospital", nameAr: "مستشفى اليرموك التعليمي" },
  { name: "Medical City Teaching Hospital", nameAr: "مستشفى مدينة الطب التعليمي" },
];

const STUDY_TYPES = [
  { name: "Nursing", nameAr: "تمريض", code: "N" },
  { name: "Midwifery", nameAr: "قبالة", code: "M" },
];

// Groups: [name, studyTypeIndex, shift]
const GROUPS: [string, number, "MORNING" | "EVENING"][] = [
  ["المجموعة الصباحية أ", 0, "MORNING"],
  ["المجموعة الصباحية ب", 0, "MORNING"],
  ["المجموعة المسائية أ", 0, "EVENING"],
  ["مجموعة القبالة الصباحية", 1, "MORNING"],
];

const FIRST = ["أحمد", "محمد", "علي", "فاطمة", "زينب", "حسين", "مريم", "نور", "سارة", "عمر", "حسن", "آية", "زهراء", "مصطفى", "رقية", "يوسف", "هدى", "كرار", "دعاء", "منتظر"];
const LAST = ["الجبوري", "التميمي", "الدليمي", "الزبيدي", "الساعدي", "الربيعي", "الخفاجي", "الطائي", "الكعبي", "الفتلاوي", "المياحي", "النعيمي", "الحسناوي", "العزاوي", "البدري"];

// Rotation timeline: three 2-week blocks, meeting Sundays & Tuesdays.
const BLOCKS = [
  { start: "2026-01-04", end: "2026-01-15" },
  { start: "2026-01-18", end: "2026-01-29" },
  { start: "2026-02-01", end: "2026-02-12" },
];
const DAYS_OF_WEEK = "SUN,TUE";

function meetingDates(startISO: string, endISO: string, days: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (isDateInScheduledDays(iso, days)) out.push(iso);
  }
  return out;
}

// Deterministic-ish pseudo-random so re-runs look similar.
let seed = 12345;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

async function cleanup() {
  // Remove anything from a previous run of this seed, in FK-safe order.
  const oldEvals = await prisma.evaluation.findMany({
    where: { notes: { contains: SEED_TAG } },
    select: { id: true },
  });
  const oldEvalIds = oldEvals.map((e) => e.id);
  if (oldEvalIds.length) {
    await prisma.evaluationScore.deleteMany({ where: { evaluationId: { in: oldEvalIds } } });
    await prisma.evaluation.deleteMany({ where: { id: { in: oldEvalIds } } });
  }
  const oldGroups = await prisma.group.findMany({ where: { cycleLabel: SEED_TAG }, select: { id: true } });
  const oldGroupIds = oldGroups.map((g) => g.id);
  await prisma.rotationBlock.deleteMany({ where: { notes: { contains: SEED_TAG } } });
  await prisma.evaluatorAssignment.deleteMany({
    where: { hospital: { notes: { contains: SEED_TAG } } },
  });
  await prisma.student.deleteMany({ where: { nameEn: { contains: SEED_TAG } } });
  if (oldGroupIds.length) await prisma.group.deleteMany({ where: { id: { in: oldGroupIds } } });
  await prisma.studyType.deleteMany({ where: { name: { contains: SEED_TAG } } });
  await prisma.account.deleteMany({ where: { role: "EVALUATOR", name: { contains: SEED_TAG } } });
  await prisma.hospital.deleteMany({ where: { notes: { contains: SEED_TAG } } });
  await prisma.course.deleteMany({ where: { label: { contains: SEED_TAG } } });
}

async function main() {
  console.log("Cleaning up any previous full-course seed…");
  await cleanup();

  await ensureDefaultRubric();
  const sections = await listRubricSections(false);
  console.log(`Rubric: ${sections.length} criteria, total ${sections.reduce((s, x) => s + x.maxScore, 0)}`);

  // Term settings (setup steps 1 & 2)
  await prisma.termSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", weeksCount: 6, daysPerWeek: 2, weekdays: DAYS_OF_WEEK, startDate: BLOCKS[0].start },
    update: { weeksCount: 6, daysPerWeek: 2, weekdays: DAYS_OF_WEEK, startDate: BLOCKS[0].start },
  });

  // Course
  // Year 2027 avoids colliding with any existing 2026 course (unique year+number).
  const course = await prisma.course.create({
    data: { year: 2027, number: 1, label: `دورة كاملة تجريبية ${SEED_TAG}` },
  });

  // Study types
  const studyTypes: Awaited<ReturnType<typeof prisma.studyType.create>>[] = [];
  for (const st of STUDY_TYPES) {
    studyTypes.push(
      await prisma.studyType.create({ data: { name: `${st.name} ${SEED_TAG}`, nameAr: st.nameAr, code: `${st.code}${Math.floor(rand() * 9)}` } })
    );
  }

  // Hospitals
  const hospitals: Awaited<ReturnType<typeof prisma.hospital.create>>[] = [];
  for (const h of HOSPITAL_NAMES) {
    hospitals.push(await prisma.hospital.create({ data: { name: h.name, nameAr: h.nameAr, notes: SEED_TAG } }));
  }

  // Supervisors: one evaluator account per hospital, assigned to that hospital.
  const passwordHash = await hashPassword("Supervisor123!");
  const evaluatorByHospital = new Map<string, string>();
  for (let i = 0; i < hospitals.length; i++) {
    const h = hospitals[i];
    const acct = await prisma.account.create({
      data: {
        email: `supervisor.${i + 1}.${Date.now()}@eva.local`,
        passwordHash,
        name: `مشرف ${h.nameAr} ${SEED_TAG}`,
        role: "EVALUATOR",
      },
    });
    await prisma.evaluatorAssignment.create({ data: { accountId: acct.id, hospitalId: h.id, groupId: null } });
    evaluatorByHospital.set(h.id, acct.id);
  }

  // Groups + students
  let uni = 45000000 + Math.floor(rand() * 1000);
  const groups: { id: string; hospitalOrder: string[] }[] = [];
  for (let gi = 0; gi < GROUPS.length; gi++) {
    const [gname, stIdx, shift] = GROUPS[gi];
    const g = await prisma.group.create({
      data: {
        name: gname,
        cycleLabel: SEED_TAG,
        courseId: course.id,
        shift,
        studyTypeId: studyTypes[stIdx].id,
      },
    });
    // Each group rotates through the 3 hospitals in a rotated order.
    const order = hospitals.map((_, i) => hospitals[(i + gi) % hospitals.length].id);
    groups.push({ id: g.id, hospitalOrder: order });

    const studentCount = 8;
    for (let s = 0; s < studentCount; s++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      await prisma.student.create({
        data: {
          universityNumber: String(uni++),
          nameAr: name,
          nameEn: SEED_TAG, // used as the seed marker for cleanup
          courseId: course.id,
          studyTypeId: studyTypes[stIdx].id,
          groupId: g.id,
          shift,
        },
      });
    }
  }

  // Rotation blocks: block N of each group -> the Nth hospital in its order.
  for (const g of groups) {
    for (let bi = 0; bi < BLOCKS.length; bi++) {
      await prisma.rotationBlock.create({
        data: {
          groupId: g.id,
          hospitalId: g.hospitalOrder[bi],
          startDate: BLOCKS[bi].start,
          endDate: BLOCKS[bi].end,
          daysOfWeek: DAYS_OF_WEEK,
          notes: SEED_TAG,
        },
      });
    }
  }

  // Evaluations: for every student, every meeting day of their group's
  // rotation, at the hospital they're rotating through that block.
  const allStudents = await prisma.student.findMany({
    where: { nameEn: SEED_TAG },
    select: { id: true, groupId: true },
  });
  const groupById = new Map(groups.map((g) => [g.id, g]));

  let evalCount = 0;
  let scoreCount = 0;
  for (const student of allStudents) {
    const g = student.groupId ? groupById.get(student.groupId) : undefined;
    if (!g) continue;
    for (let bi = 0; bi < BLOCKS.length; bi++) {
      const hospitalId = g.hospitalOrder[bi];
      const evaluatorId = evaluatorByHospital.get(hospitalId)!;
      const dates = meetingDates(BLOCKS[bi].start, BLOCKS[bi].end, DAYS_OF_WEEK);
      for (const dateISO of dates) {
        // ~85% present, ~8% late, ~7% absent.
        const r = rand();
        const attendance = r < 0.85 ? "present" : r < 0.93 ? "late" : "absent";

        // Most present students submit their daily note; absent never do.
        const dailyNoteSubmitted = attendance !== "absent" && rand() < 0.8;
        let total = 0;
        const scoreRows: { rubricSectionId: string; score: number }[] = [];
        if (attendance !== "absent") {
          for (const sec of sections) {
            // Bias toward the upper half of each criterion's range.
            const score = Math.min(sec.maxScore, Math.round(sec.maxScore * (0.55 + rand() * 0.45)));
            total += score;
            scoreRows.push({ rubricSectionId: sec.id, score });
          }
        }

        const evaluation = await prisma.evaluation.create({
          data: {
            studentId: student.id,
            evaluatorId,
            groupId: student.groupId,
            hospitalId,
            dateISO,
            attendance,
            total,
            dailyNoteSubmitted,
            notes: `${SEED_TAG}`,
            feedback: attendance === "absent" ? "غياب" : null,
          },
        });
        evalCount++;
        if (scoreRows.length) {
          await prisma.evaluationScore.createMany({
            data: scoreRows.map((sc) => ({ evaluationId: evaluation.id, ...sc })),
          });
          scoreCount += scoreRows.length;
        }
      }
    }
  }

  console.log("✓ Seed complete:");
  console.log(`  course:      ${course.label}`);
  console.log(`  study types: ${studyTypes.length}`);
  console.log(`  hospitals:   ${hospitals.length}`);
  console.log(`  supervisors: ${hospitals.length}`);
  console.log(`  groups:      ${groups.length}`);
  console.log(`  students:    ${allStudents.length}`);
  console.log(`  evaluations: ${evalCount} (with ${scoreCount} criterion scores)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("SEED FAILED:");
    console.error("name:", e?.name);
    console.error("message:", e?.message);
    console.error("code:", e?.code);
    console.error("cause:", e?.cause?.message ?? e?.cause);
    console.error("stack:", e?.stack);
    process.exit(1);
  });
