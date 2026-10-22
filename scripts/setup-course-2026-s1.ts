// The full course, first term 2026–2027 (requested by the admin, 2026-10-22):
// the Al-Yarmouk test course becomes the real one, with every group from
// the college's distribution sheets
//   "1توزيع_الطلبة_ف1في_المستشفيات_صباحي2027.docx" (morning, 8:00) and
//   "2_5373077853359351270.docx" (evening, 11:00):
//   group 1 → مستشفى العلوية التعليمي للولادة
//   group 2 → مستشفى مدينة الطب / بغداد التعليمي
//   group 3 → مستشفى اليرموك
// every group on Mondays and Tuesdays, 19–20/10, 26–27/10 and 2–3/11/2026.
//
// Adds only: hospitals, groups with their weekly blocks, and the listed
// students missing from their group (matched by name). Nothing is deleted
// and grades are untouched, so it is safe to run again. The sheets have no
// university numbers: students get "SMP-<hospital><group>[E]-NN"
// placeholders, like the Al-Yarmouk test groups.
//
// Close Eva Desktop first (the script refuses while it runs); a backup is
// taken into the app's backups folder before anything changes:
//   npx tsx --tsconfig tsconfig.json scripts/setup-course-2026-s1.ts <eva.db> --confirm [--dry-run]
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { openBetterSqlite } from "../packages/db/src/betterSqlite";
import { migrate } from "../packages/db/src/migrate";
import * as t from "../packages/db/src/schema";
import { Plan, newId, repo } from "../packages/db/src/repo/common";
import { saveHospital } from "../packages/db/src/repo/courses";
import { saveStudent } from "../packages/db/src/repo/students";

const COURSE_LABEL = "تمريض الأم والوليد — الفصل الأول 2026–2027";
const OLD_LABEL = "تمريض الأم والوليد — مستشفى اليرموك (تجريبية)";
const START = "2026-10-18"; // the Sunday of the first week, as the existing blocks
const WEEKS = 3;
const DAYS = "MON,TUE";

const HOSPITALS = {
  ALW: { name: "مستشفى العلوية التعليمي للولادة", notes: "الهيئة التدريسية المشرفة: أ.م.د. فاطمة فاضل + م. علياء خزعل" },
  MDC: { name: "مستشفى مدينة الطب / بغداد التعليمي", notes: "الهيئة التدريسية المشرفة: ا.م.د. نهى عادل + ا.م.د. أقدس داود" },
  YRM: { name: "مستشفى اليرموك", notes: "الهيئة التدريسية المشرفة: ا.م.د. سراب نصر + م.د. وسام مشعان" },
} as const;
type HospitalCode = keyof typeof HOSPITALS;

interface GroupList {
  name: string;
  shift: "MORNING" | "EVENING";
  hospital: HospitalCode;
  prefix: string;
  students: string[];
}

const GROUPS: GroupList[] = [
  {
    name: "المجموعة الصباحية 1", shift: "MORNING", hospital: "ALW", prefix: "SMP-ALW1-",
    students: ["ازهار نهاد خليل", "اسراء خالد عبدالجبار", "تبارك فيصل محيسن", "تماره محمد كاظم", "جنات عمار صادق", "حوراء اسعد مجيد", "حوراء عمار عبدالحسين", "زهراء نذير عبدالصمد", "زينب سمير كريم", "زينب كنعان حسين", "شهد رافد محمد", "عبدالله عباس علي", "علي امين سرحان", "علي قاسم عور", "فرح سيف عبدالله", "مرتضى مثنى فخري", "مريم فاضل عبود", "مريم محمد مهدي", "ملاك علاء عبدالسادة", "ملاك لطيف ضاحي", "ملاك وسام رياض", "نبا فلاح حسن", "هدى فراس محمود"],
  },
  {
    name: "المجموعة الصباحية 2", shift: "MORNING", hospital: "MDC", prefix: "SMP-MDC2-",
    students: ["اسيل صفاء هاشم", "انوار خضير عباس", "بلال علي كامل", "ختام صادق حديد", "ختام طلب شحاذه", "خطاب احمد حاتم", "ديمه دهمان خليف", "رحمه وليد مخلف", "زهراء عدنان كاظم", "زهير عباس حسين", "زينب حاكم عباس", "زينب حسين حبيب", "زينب علي ابراهيم", "شهد حميد ضياء", "طيبة حسين مشرف", "غدير عدي نصيف", "فاطمة علي كاظم", "فاطمة يوسف جواد", "لقاء خالد جاسم", "هبه عزيز جميل", "هديل احمد صبار", "نرجس عادل رشيد", "ورود عطالله فراس"],
  },
  {
    name: "المجموعة الصباحية 3", shift: "MORNING", hospital: "YRM", prefix: "SMP-YRM3-",
    students: ["اسراء عيسى علي", "اسراء مظهر علي", "ايه امين حميد", "بنين هاشم محمدعلي", "حنين محمد خلف", "رقية عامر عبدالحسن", "رواء قاسم خلف", "ريام وعد غالب", "زبيده باسم رشيد", "زهراء جبار قاسم", "زينب رياض حسن", "زينب مسلم عبدالامير", "سارة سيف بحيبش", "سعاد احمد عيفان", "سعاد خالد عادل", "شهد منير حسن", "ضحى ياسر حمد", "فاطمة كامل عبدالخالق", "ماريا محمد وليد", "منار سمير حسن", "هدى عمار ثامر", "نور عماد كريم"],
  },
  {
    // The sheet numbers this group 1–8 then 12–23: rows 9–11 are missing from it.
    name: "المجموعة المسائية 1", shift: "EVENING", hospital: "ALW", prefix: "SMP-ALW1E-",
    students: ["ايات احمد ساده", "بنين اركان ناهض", "حسين علي فليح", "حسين يونس مجيد", "حوراء جاسم عناد", "حنين احمد كاظم", "ساره يوسف علي", "شهد كريم سعيد", "زينب ماجد هاشم", "علي موسى كمر", "مازن اسماعيل خليل", "محمد احمد حسن", "محمد محسن جميل", "محمد رياض محمد", "محمد عامر عبود", "مصطفى احمد سامي", "موسى عقيل عباس", "هاجر محمد كريز", "نرجس سالم ثامر", "يوسف جبار عبدالله"],
  },
  {
    name: "المجموعة المسائية 2", shift: "EVENING", hospital: "MDC", prefix: "SMP-MDC2E-",
    students: ["اسماء جبار صالح", "تبارك حسين علي", "تبارك فاروق علاء الدين", "حسين علاء محمد", "زكريا نشاط فتحي", "زهراء حسين صالح", "زهراء حمزة نجم", "زهراء عماد ياسين", "زينب حبيب ناصر", "زينب عباس خلف", "ساره رحيم هاشم", "سجاد احمد زهراو", "طيبه جاسم جمعة", "طيبه كمر حسن", "عبير رشيد ابراهيم", "علي يونس محمد رشيد", "غفران محمد ابراهيم", "فاطمه عقيل جبار", "مسره علاء هاشم", "منتظر قاسم عبد الحسين", "نور الهدى بلاسم احمد", "نبا شامل عبعوب"],
  },
  {
    name: "المجموعة المسائية 3", shift: "EVENING", hospital: "YRM", prefix: "SMP-YRM3E-",
    students: ["اسراء لفته طنش", "الاء سالم احمد", "انور علي سالم", "ايه نشوان كمال", "بلال شعبان مشعان", "حسين خضير عباس", "خطاب حازم محمد", "سجاد صبري حميد", "سجاد ماجد كريم", "سيف سعد فيصل", "طيبه سمير مال الله", "عبد الرحمن عدنان عبد الغفور", "عباس علي حسين", "علي وسام رشيد", "فاطمه خضير مزعل", "محمد غسان سعيد", "محمد عمار جبار", "مروان مجيد حنتوش", "مؤمل جابر جاسم", "مهيمن فراس سالم", "ميعاد جمال حسن"],
  },
];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15); // 20261022-221500

function desktopRunning(): boolean {
  if (process.platform !== "win32") return false;
  return execSync('tasklist /FI "IMAGENAME eq eva-desktop.exe" /NH', { encoding: "utf8" }).toLowerCase().includes("eva-desktop.exe");
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file || !flags.includes("--confirm")) throw new Error("usage: setup-course-2026-s1.ts <eva.db> --confirm [--dry-run]");
  const dryRun = flags.includes("--dry-run");
  // The app's own database (not a copy) must not be open in the app.
  const appDb = path.resolve(file).toLowerCase().includes("iq.edu.uobaghdad.conursing.eva");
  if (appDb && !dryRun && desktopRunning()) throw new Error("Eva Desktop is open — close it first, then run this again.");
  if (new Set(GROUPS.flatMap((g) => g.students.map(clean))).size !== GROUPS.reduce((a, g) => a + g.students.length, 0)) throw new Error("a name is listed twice");

  const { db, exec } = openBetterSqlite(file);
  if (!dryRun) {
    const dir = path.join(path.dirname(file), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `eva-${stamp()}-manual.db`);
    await db.backup(backup);
    console.log("backup:", backup);
  }
  const r = repo(exec);
  console.log("migrations applied:", await migrate(exec));

  // The course: the Al-Yarmouk test course, renamed (it is the current one).
  const courses = await r.db.select().from(t.courses);
  const course = courses.find((c) => c.label === COURSE_LABEL) ?? courses.find((c) => c.label === OLD_LABEL);
  if (!course) throw new Error(`course not found (expected "${OLD_LABEL}")`);
  const [nursing] = await r.db.select().from(t.studyTypes).where(eq(t.studyTypes.code, "N"));
  if (!nursing) throw new Error("study type N (التمريض) not found");
  const report: string[] = [];

  const plan = new Plan(r);
  if (course.label !== COURSE_LABEL) {
    plan.add(r.db.update(t.courses).set({ label: COURSE_LABEL, updatedAt: new Date().toISOString() }).where(eq(t.courses.id, course.id)));
    plan.audit("Course", course.id, "update", { label: course.label }, { label: COURSE_LABEL });
    report.push(`course renamed: ${COURSE_LABEL}`);
  }
  await plan.commit();

  // Hospitals, and each in the course.
  const hospitalId = {} as Record<HospitalCode, string>;
  for (const [code, h] of Object.entries(HOSPITALS) as Array<[HospitalCode, (typeof HOSPITALS)[HospitalCode]]>) {
    const [found] = await r.db.select().from(t.hospitals).where(eq(t.hospitals.name, h.name));
    hospitalId[code] = found ? found.id : await saveHospital(r, h);
    if (found && !found.notes) await saveHospital(r, { id: found.id, name: found.name, address: found.address, notes: h.notes });
    if (!found) report.push(`hospital added: ${h.name}`);
    const [linked] = await r.db.select().from(t.courseHospitals).where(and(eq(t.courseHospitals.courseId, course.id), eq(t.courseHospitals.hospitalId, hospitalId[code])));
    if (!linked) {
      const p = new Plan(r);
      p.add(r.db.insert(t.courseHospitals).values({ id: newId(), courseId: course.id, hospitalId: hospitalId[code] }));
      await p.commit();
    }
  }

  // Groups with their weekly blocks; the schedule version goes up once.
  let scheduleChanged = false;
  for (const g of GROUPS) {
    let [group] = await r.db.select().from(t.groups).where(and(eq(t.groups.courseId, course.id), eq(t.groups.name, g.name)));
    if (!group) {
      const id = newId();
      const p = new Plan(r);
      p.add(r.db.insert(t.groups).values({ id, name: g.name, courseId: course.id, shift: g.shift, studyTypeId: nursing.id }));
      for (let w = 0; w < WEEKS; w++) {
        const start = addDays(START, w * 7);
        p.add(r.db.insert(t.rotationBlocks).values({ id: newId(), groupId: id, hospitalId: hospitalId[g.hospital], courseId: course.id, weekIndex: w, startDate: start, endDate: addDays(start, 6), daysOfWeek: DAYS }));
      }
      p.audit("Group", id, "create", undefined, { name: g.name, hospital: HOSPITALS[g.hospital].name, days: DAYS });
      await p.commit();
      [group] = await r.db.select().from(t.groups).where(eq(t.groups.id, id));
      scheduleChanged = true;
      report.push(`group added: ${g.name} → ${HOSPITALS[g.hospital].name}`);
    }

    // Students: the listed ones missing from the group, by name.
    const have = await r.db.select({ nameAr: t.students.nameAr, uni: t.students.universityNumber }).from(t.students).where(eq(t.students.groupId, group.id));
    const names = new Set(have.map((s) => clean(s.nameAr)));
    const used = new Set(have.map((s) => s.uni));
    let next = 1;
    const numberFor = () => {
      while (used.has(`${g.prefix}${String(next).padStart(2, "0")}`)) next++;
      const n = `${g.prefix}${String(next).padStart(2, "0")}`;
      used.add(n);
      return n;
    };
    const added: string[] = [];
    for (const name of g.students.map(clean)) {
      if (names.has(name)) continue;
      // Never a second student by the same name elsewhere in the course: report it instead.
      const [elsewhere] = await r.db.select({ id: t.students.id }).from(t.students).where(and(eq(t.students.courseId, course.id), eq(t.students.nameAr, name)));
      if (elsewhere) {
        report.push(`! ${name} is already in another group — left there (${g.name})`);
        continue;
      }
      await saveStudent(r, { universityNumber: numberFor(), nameAr: name, groupId: group.id });
      added.push(name);
    }
    const extra = have.filter((s) => !g.students.map(clean).includes(clean(s.nameAr)));
    if (added.length) report.push(`${g.name}: ${added.length} students added${have.length ? ` (${added.join("، ")})` : ""}`);
    if (extra.length) report.push(`! ${g.name}: in the database but not on the sheet: ${extra.map((s) => s.nameAr).join("، ")}`);
  }
  if (scheduleChanged) {
    const [c] = await r.db.select().from(t.courses).where(eq(t.courses.id, course.id));
    const p = new Plan(r);
    p.add(r.db.update(t.courses).set({ scheduleVersion: (c.scheduleVersion ?? 0) + 1, weekCount: WEEKS, updatedAt: new Date().toISOString() }).where(eq(t.courses.id, course.id)));
    await p.commit();
  }

  console.log(report.join("\n") || "nothing to add — already up to date");
  const groups = db
    .prepare(
      `select g.name, h.name hospital, (select count(*) from students s where s.groupId = g.id) students, (select count(*) from rotation_blocks b where b.groupId = g.id) blocks
       from groups g left join rotation_blocks b0 on b0.groupId = g.id and b0.weekIndex = 0 left join hospitals h on h.id = b0.hospitalId
       where g.courseId = ? order by g.shift desc, g.name`
    )
    .all(course.id);
  console.table(groups);
  console.log({ integrity: db.pragma("integrity_check", { simple: true }), foreignKeys: (db.pragma("foreign_key_check") as unknown[]).length });
  db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
