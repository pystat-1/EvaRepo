// One-off reset (2026-10-18, requested by the admin): Eva Desktop becomes a
// test version for مستشفى اليرموك only, until the full lists arrive.
//   - every old course (groups, students, grades, schedule) is deleted
//   - hospitals other than مستشفى اليرموك are deleted
//   - every evaluator account is deleted; the only evaluator is
//     ا.م.د. سراب نصر فاضل (sarab@conursing.uobaghdad.edu.iq), covering the
//     whole hospital (morning and, once added, evening groups)
//   - one course: المجموعة الصباحية 3 at اليرموك, Mondays and Tuesdays from
//     19/10 to 3/11/2026 (source: "عملي مستشفى اليرموك صباحي -.pdf")
//   - each student's unit (القسم) on each day, from the same sheet
// The list has no university numbers: students get "SMP-YRM3-NN"
// placeholders, which the Excel import recognises and replaces.
//
// Close Eva Desktop and take a backup first, then:
//   npx tsx --tsconfig tsconfig.json scripts/setup-yarmouk-test.ts <eva.db> --confirm
// With --units-only it only brings the database up to date and (re)sets
// the units of the students already there, matched by name.
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { openBetterSqlite } from "../packages/db/src/betterSqlite";
import { migrate } from "../packages/db/src/migrate";
import * as t from "../packages/db/src/schema";
import { Plan, newId, repo } from "../packages/db/src/repo/common";
import { deleteCourse } from "../packages/db/src/repo/courses";
import { addAssignment, saveEvaluator } from "../packages/db/src/repo/evaluators";
import { CURRENT_COURSE_KEY, saveStudent } from "../packages/db/src/repo/students";
import { setUnits } from "../packages/db/src/repo/units";

const HOSPITAL = "مستشفى اليرموك";
const EVALUATOR = { name: "ا.م.د. سراب نصر فاضل", email: "sarab@conursing.uobaghdad.edu.iq" };
const COURSE = { year: 2026, number: 1, label: "تمريض الأم والوليد — مستشفى اليرموك (تجريبية)", startDate: "2026-10-18", weekCount: 3 };
const DAYS = "MON,TUE";
const GROUP = "المجموعة الصباحية 3";

// Unit (قسم) per student on 20/10, 26/10, 27/10, 2/11, 3/11 (19/10 is
// orientation + assessment for everyone, no unit).
const UNIT_DATES = ["2026-10-20", "2026-10-26", "2026-10-27", "2026-11-02", "2026-11-03"];
const UNIT_IDS: Record<string, string> = { "صالة ولادة": "unit-labour", "عناية": "unit-icu", "عمليات": "unit-theatre", "ردهة": "unit-ward" };
const STUDENTS: Array<[string, string]> = [
  ["اسراء عيسى علي", "صالة ولادة، عناية، عمليات، صالة ولادة، عناية"],
  ["اسراء مظهر علي", "عناية، عناية، عمليات، عناية، عناية"],
  ["ايه امين حميد", "عناية، عناية، عمليات، عناية، عناية"],
  ["بنين هاشم محمدعلي", "عناية، عمليات، عناية، عناية، عمليات"],
  ["حنين محمد خلف", "صالة ولادة، عمليات، عناية، صالة ولادة، عمليات"],
  ["رقية عامر عبدالحسن", "ردهة، عمليات، عناية، ردهة، عمليات"],
  ["رواء قاسم خلف", "ردهة، عناية، ردهة، ردهة، عناية"],
  ["ريام وعد غالب", "ردهة، عناية، ردهة، ردهة، عناية"],
  ["زبيده باسم رشيد", "ردهة، عناية، ردهة، ردهة، عناية"],
  ["زهراء جبار قاسم", "عناية، عناية، ردهة، عناية، عناية"],
  ["زينب رياض حسن", "عناية، عناية، ردهة، عناية، عناية"],
  ["زينب مسلم عبدالامير", "عناية، عناية، ردهة، عناية، عناية"],
  ["سارة سيف بحيبش", "عمليات، صالة ولادة، عناية، عمليات، صالة ولادة"],
  ["سعاد احمد عيفان", "عمليات، صالة ولادة، عناية، عمليات، صالة ولادة"],
  ["سعاد خالد عادل", "عمليات، صالة ولادة، عناية، عمليات، صالة ولادة"],
  ["شهد منير حسن", "ردهة، ردهة، عناية، ردهة، ردهة"],
  ["ضحى ياسر حمد", "ردهة، ردهة، ردهة، ردهة، ردهة"],
  ["فاطمة كامل عبدالخالق", "ردهة، ردهة، ردهة، ردهة، ردهة"],
  ["ماريا محمد وليد", "ردهة، ردهة، ردهة، ردهة، ردهة"],
  ["منار سمير حسن", "عمليات، صالة ولادة، عناية، عمليات، صالة ولادة"],
  ["هدى عمار ثامر", "ردهة، ردهة، عناية، ردهة، ردهة"],
  ["نور عماد كريم", "ردهة، ردهة، ردهة، ردهة، ردهة"],
];

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function setStudentUnits(r: ReturnType<typeof repo>) {
  const students = await r.db.select({ id: t.students.id, nameAr: t.students.nameAr }).from(t.students);
  const idOf = new Map(students.map((s) => [s.nameAr, s.id]));
  const rows = STUDENTS.flatMap(([name, units]) => {
    const studentId = idOf.get(name);
    if (!studentId) throw new Error(`student not found: ${name}`);
    return units.split("، ").map((u, i) => {
      if (!UNIT_IDS[u]) throw new Error(`unknown unit: ${u}`);
      return { studentId, dateISO: UNIT_DATES[i], unitId: UNIT_IDS[u] };
    });
  });
  await setUnits(r, rows);
  return rows.length;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || !flags.includes("--confirm")) throw new Error("usage: setup-yarmouk-test.ts <eva.db> --confirm [--units-only]");
  const { db, exec } = openBetterSqlite(file);
  const r = repo(exec);
  console.log("migrations applied:", await migrate(exec));
  if (flags.includes("--units-only")) {
    console.log("unit days set:", await setStudentUnits(r));
    db.close();
    return;
  }

  // 1. Old courses, with everything in them.
  for (const c of await r.db.select().from(t.courses)) await deleteCourse(r, c.id);

  // 2. Leftovers outside any course, other hospitals, every evaluator.
  const [yarmouk] = await r.db.select().from(t.hospitals).where(eq(t.hospitals.name, HOSPITAL));
  if (!yarmouk) throw new Error(`${HOSPITAL} not found`);
  const evaluatorIds = r.db.select({ id: t.accounts.id }).from(t.accounts).where(eq(t.accounts.role, "EVALUATOR"));
  const plan = new Plan(r);
  plan.add(r.db.delete(t.evaluationScores));
  plan.add(r.db.delete(t.evaluations));
  plan.add(r.db.delete(t.attendanceRecords));
  plan.add(r.db.delete(t.groupWorkDays));
  plan.add(r.db.delete(t.syncInbox));
  plan.add(r.db.delete(t.flags));
  plan.add(r.db.delete(t.studentDayUnits));
  plan.add(r.db.delete(t.evaluatorAssignments));
  plan.add(r.db.delete(t.rotationBlocks));
  plan.add(r.db.delete(t.students));
  plan.add(r.db.delete(t.groups));
  plan.add(r.db.delete(t.courseHospitals));
  plan.add(r.db.delete(t.hospitals).where(ne(t.hospitals.id, yarmouk.id)));
  plan.add(r.db.update(t.auditLog).set({ actorId: null }).where(inArray(t.auditLog.actorId, evaluatorIds)));
  plan.add(r.db.delete(t.accounts).where(and(eq(t.accounts.role, "EVALUATOR"))));
  plan.add(r.db.delete(t.accounts).where(eq(t.accounts.role, "STUDENT")));
  plan.add(r.db.delete(t.meta).where(inArray(t.meta.key, ["relay.phones", CURRENT_COURSE_KEY])));
  plan.audit("Reset", "yarmouk-test", "delete", undefined, { kept: HOSPITAL });
  await plan.commit();

  // 3. The course, its one group and its schedule.
  const [nursing] = await r.db.select().from(t.studyTypes).where(eq(t.studyTypes.code, "N"));
  if (!nursing) throw new Error("study type N (التمريض) not found");
  const courseId = newId();
  const groupId = newId();
  const setup = new Plan(r);
  setup.add(r.db.insert(t.courses).values({ id: courseId, ...COURSE, status: "PUBLISHED", setupStep: 8, scheduleVersion: 1 }));
  setup.add(r.db.insert(t.courseStudyTypes).values({ id: newId(), courseId, studyTypeId: nursing.id }));
  setup.add(r.db.insert(t.courseAttendancePatterns).values({ id: newId(), courseId, daysOfWeek: DAYS }));
  setup.add(r.db.insert(t.courseHospitals).values({ id: newId(), courseId, hospitalId: yarmouk.id }));
  setup.add(r.db.insert(t.groups).values({ id: groupId, name: GROUP, courseId, shift: "MORNING", studyTypeId: nursing.id }));
  for (let w = 0; w < COURSE.weekCount; w++) {
    const start = addDays(COURSE.startDate, w * 7);
    setup.add(
      r.db.insert(t.rotationBlocks).values({
        id: newId(), groupId, hospitalId: yarmouk.id, courseId, weekIndex: w, startDate: start, endDate: addDays(start, 6), daysOfWeek: DAYS,
      })
    );
  }
  setup.add(r.db.insert(t.meta).values({ key: CURRENT_COURSE_KEY, value: courseId }));
  setup.audit("Course", courseId, "create", undefined, { ...COURSE, group: GROUP, hospital: HOSPITAL, days: DAYS });
  await setup.commit();

  // 4. Students and the evaluator.
  for (const [i, [nameAr]] of STUDENTS.entries()) {
    await saveStudent(r, { universityNumber: `SMP-YRM3-${String(i + 1).padStart(2, "0")}`, nameAr, groupId });
  }
  const evaluatorId = await saveEvaluator(r, EVALUATOR);
  await addAssignment(r, { accountId: evaluatorId, courseId, hospitalId: yarmouk.id, groupId: null });
  await setStudentUnits(r);

  const leftover = await r.db.select({ id: t.hospitals.id }).from(t.hospitals).where(notInArray(t.hospitals.id, [yarmouk.id]));
  const counts = Object.fromEntries(
    ["courses", "hospitals", "groups", "rotation_blocks", "students", "accounts", "evaluator_assignments", "evaluations", "student_day_units"].map((name) => [
      name,
      (db.prepare(`select count(*) n from "${name}"`).get() as { n: number }).n,
    ])
  );
  console.log({ ...counts, otherHospitals: leftover.length, integrity: db.pragma("integrity_check", { simple: true }), foreignKeys: (db.pragma("foreign_key_check") as unknown[]).length });
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
