// Every Excel file the desktop saves: the grades list (مركز الدرجات →
// قائمة التقييمات), the students' template and list, and the evaluators'
// template and list. Each is saved through the (test) save dialog, then
// opened and read back.
import path from "node:path";
import ExcelJS from "exceljs";
import { log, openDesktop, seedFile } from "./harness";
import type { Browser } from "playwright";

export async function exports(browser: Browser, out: string) {
  const file = path.join(out, "exports.db");
  const db = await seedFile(file, 3); // 6 groups × 3 = 18 students
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };
  // Two validated days for the first group (one student absent).
  const first = db.prepare("SELECT startDate FROM rotation_blocks WHERE groupId = 'g-m1' AND weekIndex = 0").get() as { startDate: string };
  const students = db.prepare("SELECT id FROM students WHERE groupId = 'g-m1' ORDER BY id").all() as Array<{ id: string }>;
  let n = 0;
  for (const day of [0, 1]) {
    const date = new Date(Date.parse(first.startDate) + day * 86400_000).toISOString().slice(0, 10);
    for (const s of students) {
      const id = `x${++n}`;
      const absent = n === 2;
      db.prepare(
        "INSERT INTO evaluations (id, studentId, evaluatorId, groupId, hospitalId, dateISO, attendance, total, courseId) VALUES (?, ?, 'e-sara', 'g-m1', 'h-yarmouk', ?, ?, ?, 'c1')"
      ).run(id, s.id, date, absent ? "absent" : "present", absent ? 0 : 12.5);
      if (!absent) [5, 4.5, 1, 1, 1].forEach((v, i) => db.prepare("INSERT INTO evaluation_scores (id, evaluationId, rubricSectionId, score) VALUES (?, ?, ?, ?)").run(`${id}-${i}`, id, `rs${i}`, v));
    }
  }

  const desk = await openDesktop(browser, db, file, out);
  const d = desk.page;
  const read = async () => {
    await d.waitForSelector(".note-ok");
    const f = desk.tauriLog.saved.at(-1)!;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(f);
    const rows: string[][] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)))));
    return { name: path.basename(f), rows };
  };
  const save = async (button: string) => {
    const before = desk.tauriLog.saved.length;
    await d.click(button);
    for (let i = 0; i < 100 && desk.tauriLog.saved.length === before; i++) await d.waitForTimeout(50);
    check(desk.tauriLog.saved.length === before + 1, `${button}: a file was saved`);
    return read();
  };

  // Grades list.
  await d.click("nav >> text=مركز الدرجات");
  await d.click("[role=tab]:has-text('قائمة التقييمات')");
  await d.waitForSelector("button:has-text('تصدير Excel'):not([disabled])");
  const grades = await save("button:has-text('تصدير Excel')");
  check(grades.rows[0].includes("المجموع") && grades.rows.length === 1 + n, `${grades.name}: header and ${n} grades (got ${grades.rows.length - 1})`);
  check(grades.rows.some((r) => r.includes("غائب")) && grades.rows.some((r) => r.includes("12.5")), `${grades.name}: attendance and totals`);
  log(`✓ grades list: ${grades.name} with ${n} grades`);

  // Students: template and the list.
  await d.click("nav >> text=الطلاب");
  const template = await save("button:has-text('تنزيل القالب')");
  check(template.rows.length >= 1, `${template.name}: opens`);
  const list = await save("button:has-text('تصدير القائمة')");
  check(list.rows.filter((r) => r.some((c) => /^طالب \d+$/.test(c))).length === 18, `${list.name}: 18 students`);
  log(`✓ students: ${template.name} and ${list.name} (18 students)`);

  // Evaluators: template and the list.
  await d.click("nav >> text=المقيّمون");
  const evTemplate = await save("button:has-text('تنزيل القالب')");
  check(evTemplate.rows.length >= 1, `${evTemplate.name}: opens`);
  const evList = await save("button:has-text('تصدير إلى Excel')");
  check(evList.rows.some((r) => r.some((c) => c.includes("sara.e2e@gmail.com"))), `${evList.name}: the evaluators' emails`);
  log(`✓ evaluators: ${evTemplate.name} and ${evList.name}`);

  check(desk.errors.length === 0, `no page errors: ${desk.errors.join(" | ")}`);
  await d.close();
}
