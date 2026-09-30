// Performance budget (docs/DESKTOP_APP_PLAN.md §7): with 5 000 students and
// a full course of grades, every screen shows its content in under 200 ms.
// Measured in Chromium from the click on the sidebar to the screen's
// content being on screen (database queries included).
import path from "node:path";
import { log, openDesktop, seedFile } from "./harness";
import type { Browser } from "playwright";

// 200 ms on the admin's laptop. Shared CI machines are slower and noisier,
// so CI sets EVA_PERF_FACTOR (a regression like 10 s still fails there).
const BUDGET_MS = 200 * Number(process.env.EVA_PERF_FACTOR ?? 1);
const SCREENS: Array<[string, string]> = [
  ["الطلاب", "text=/5[0-9]{3} طالب|طالب/"],
  ["الدورات والجدول", "table"],
  ["مركز الدرجات", "table tbody tr"],
  ["الإحصائيات", ".card"],
  ["المقيّمون", ".ev-card"],
  ["المزامنة", "text=رابط تطبيق المقيّم"],
  ["سجل التغييرات", "table"],
  ["النظام", ".checks li"],
];

export async function perf(browser: Browser, out: string) {
  const file = path.join(out, "perf.db");
  const db = await seedFile(file, 834); // 6 groups x 834 = 5 004 students
  // A full course of validated grades: every student, 10 days, 5 sections.
  const students = db.prepare("SELECT id, groupId FROM students").all() as Array<{ id: string; groupId: string }>;
  const days = (db.prepare("SELECT startDate FROM rotation_blocks WHERE weekIndex < 2 GROUP BY startDate").all() as Array<{ startDate: string }>).map((x) => x.startDate);
  const insE = db.prepare(
    "INSERT INTO evaluations (id, studentId, evaluatorId, groupId, hospitalId, dateISO, attendance, total, courseId, dailyNoteSubmitted) VALUES (?, ?, 'e-sara', ?, 'h-yarmouk', ?, ?, ?, 'c1', 1)"
  );
  const insS = db.prepare("INSERT INTO evaluation_scores (id, evaluationId, rubricSectionId, score) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    let n = 0;
    for (const s of students)
      for (const start of days)
        for (let k = 0; k < 5; k++) {
          const date = new Date(Date.parse(start) + k * 86400_000).toISOString().slice(0, 10);
          const id = `pe${++n}`;
          const absent = n % 17 === 0;
          insE.run(id, s.id, s.groupId, date, absent ? "absent" : "present", absent ? 0 : 11);
          if (!absent) [5, 3, 1, 1, 1].forEach((v, i) => insS.run(`${id}-${i}`, id, `rs${i}`, v));
        }
  })();
  const grades = (db.prepare("SELECT COUNT(*) n FROM evaluations").get() as { n: number }).n;
  log(`seeded ${students.length} students and ${grades} grades`);

  const { page, errors } = await openDesktop(browser, db, file, out);
  await page.waitForSelector("nav.sidebar");
  const results: Array<[string, number]> = [];
  for (const round of [0, 1]) {
    for (const [tab, ready] of SCREENS) {
      await page.click("nav >> text=الطلاب"); // start each measurement from the same screen
      if (tab === "الطلاب") await page.click("nav >> text=النظام");
      await page.waitForTimeout(150);
      const t0 = Date.now();
      await page.click(`nav >> text=${tab}`);
      await page.waitForSelector(ready, { timeout: 30_000 });
      if (round === 1) results.push([tab, Date.now() - t0]); // round 0 warms up (first load of each screen's code)
    }
  }
  for (const [tab, ms] of results) log(`${ms <= BUDGET_MS ? "✓" : "✗"} ${tab}: ${ms} ms`);
  const slow = results.filter(([, ms]) => ms > BUDGET_MS);
  if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
  await page.close();
  db.close();
  if (slow.length) throw new Error(`over the ${BUDGET_MS} ms budget: ${slow.map(([t, ms]) => `${t} ${ms} ms`).join(", ")}`);
}
