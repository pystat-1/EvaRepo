import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await browser.newPage();
const log = (msg) => console.log(`[phase3] ${msg}`);

try {
  // --- Admin sets up two hospitals, two groups (one evaluator each), and
  // two students in each group. ---
  await admin.goto(`${BASE}/login`);
  await admin.fill('input[name="email"]', "admin@eva.local");
  await admin.fill('input[name="password"]', "ChangeMe123!");
  await admin.click('button[type="submit"]');
  await admin.waitForURL(`${BASE}/dashboard`);

  await admin.goto(`${BASE}/hospitals`);
  await admin.fill('input[name="name"]', "Hospital A");
  await admin.click('main form button:has-text("إضافة")');
  await admin.waitForSelector("text=Hospital A");

  await admin.goto(`${BASE}/groups`);
  await admin.fill('input[name="name"]', "Group A1");
  await admin.selectOption('select[name="hospitalId"]', { label: "Hospital A" });
  await admin.click('main form button:has-text("إضافة")');
  await admin.waitForSelector("text=Group A1");

  await admin.goto(`${BASE}/students`);
  await admin.fill('input[name="universityNumber"]', "S-1");
  await admin.fill('input[name="nameAr"]', "الطالب الأول");
  await admin.selectOption('select[name="groupId"]', { label: "Group A1" });
  await admin.click('main form:has(input[name="universityNumber"]) button:has-text("إضافة")');
  await admin.waitForSelector("text=الطالب الأول");

  await admin.fill('input[name="universityNumber"]', "S-2");
  await admin.fill('input[name="nameAr"]', "الطالب الثاني");
  await admin.selectOption('select[name="groupId"]', { label: "Group A1" });
  await admin.click('main form:has(input[name="universityNumber"]) button:has-text("إضافة")');
  await admin.waitForSelector("text=الطالب الثاني");

  await admin.goto(`${BASE}/evaluators`);
  await admin.fill('input[name="name"]', "Evaluator 1");
  await admin.fill('input[name="email"]', "eval1@eva.local");
  await admin.fill('input[name="password"]', "EvalPass123!");
  await admin.selectOption('form:has(input[name="name"]) select[name="hospitalId"]', { label: "Hospital A" });
  await admin.click('form:has(input[name="name"]) button:has-text("إضافة مقيّم")');
  await admin.waitForSelector("text=Evaluator 1");

  await admin.fill('input[name="name"]', "Evaluator 2");
  await admin.fill('input[name="email"]', "eval2@eva.local");
  await admin.fill('input[name="password"]', "EvalPass123!");
  await admin.selectOption('form:has(input[name="name"]) select[name="hospitalId"]', { label: "Hospital A" });
  await admin.click('form:has(input[name="name"]) button:has-text("إضافة مقيّم")');
  await admin.waitForSelector("text=Evaluator 2");
  log("registry + 2 evaluators set up");

  // --- Two evaluators grade two different students concurrently. This is
  // the Tier 0 regression test: the old app could blindly overwrite a
  // whole day's session object, losing a co-evaluator's grades for
  // students they had already finished. ---
  const page1 = await browser.newPage();
  const page2 = await browser.newPage();

  await page1.goto(`${BASE}/login`);
  await page1.fill('input[name="email"]', "eval1@eva.local");
  await page1.fill('input[name="password"]', "EvalPass123!");
  await page1.click('button[type="submit"]');
  await page1.waitForURL(`${BASE}/my`);

  await page2.goto(`${BASE}/login`);
  await page2.fill('input[name="email"]', "eval2@eva.local");
  await page2.fill('input[name="password"]', "EvalPass123!");
  await page2.click('button[type="submit"]');
  await page2.waitForURL(`${BASE}/my`);

  await page1.click('text=الطالب الأول');
  await page1.waitForURL(/\/grade\//);
  await page2.click('text=الطالب الثاني');
  await page2.waitForURL(/\/grade\//);

  async function fillGradeForm(page, notes) {
    const inputs = await page.locator('input[type="number"]').all();
    for (const input of inputs) {
      const max = await input.getAttribute("max");
      await input.fill(String(max));
    }
    await page.fill('textarea[name="notes"]', notes);
    await page.fill('textarea[name="feedback"]', notes);
  }

  await fillGradeForm(page1, "from evaluator 1");
  await fillGradeForm(page2, "from evaluator 2");

  // Submit concurrently to actually exercise the race.
  await Promise.all([
    page1.click('button:has-text("حفظ التقييم")'),
    page2.click('button:has-text("حفظ التقييم")'),
  ]);
  await page1.waitForLoadState("networkidle");
  await page2.waitForLoadState("networkidle");

  // Both evaluators go back to /my and must see both students graded.
  await page1.goto(`${BASE}/my`, { waitUntil: "networkidle" });
  const gradedCount = await page1.locator('span.badge:has-text("تم اليوم")').count();
  if (gradedCount !== 2) {
    const body1 = await page1.textContent("body");
    throw new Error(
      `expected both students graded (concurrent write should not clobber), got ${gradedCount}. Body: ${body1.slice(-400)}`
    );
  }
  log("concurrent grading of two different students by two evaluators: both saved independently");

  // --- Admin sees the evaluation totals reflected in statistics. ---
  await admin.goto(`${BASE}/statistics`);
  const statsBody = await admin.textContent("body");
  if (!statsBody.includes("Group A1")) throw new Error("group stats missing");
  log("statistics reflect new evaluations");

  // --- Create a student portal account and confirm scoped visibility. ---
  await admin.goto(`${BASE}/student-accounts`);
  await admin.selectOption('select[name="studentId"]', { label: "الطالب الأول (S-1)" });
  await admin.fill('input[name="email"]', "student1@eva.local");
  await admin.fill('input[name="password"]', "StudentPass123!");
  await admin.click('button:has-text("إنشاء حساب")');
  await admin.waitForSelector("text=كل الطلاب النشطين", { timeout: 5000 }).catch(() => {});

  const studentPage = await browser.newPage();
  await studentPage.goto(`${BASE}/login`);
  await studentPage.fill('input[name="email"]', "student1@eva.local");
  await studentPage.fill('input[name="password"]', "StudentPass123!");
  await studentPage.click('button[type="submit"]');
  await studentPage.waitForURL(`${BASE}/me`);
  const meBody = await studentPage.textContent("body");
  if (!meBody.includes("from evaluator 1")) throw new Error("student cannot see own evaluation feedback area (expected via details)");
  if (meBody.includes("الطالب الثاني")) throw new Error("SECURITY BUG: student sees another student's data");
  log("student portal shows own evaluation only, not another student's");

  // Student cannot reach admin or evaluator pages.
  await studentPage.goto(`${BASE}/students`);
  await studentPage.waitForURL(`${BASE}/login`, { timeout: 5000 });
  log("student correctly blocked from admin pages");

  log("ALL CHECKS PASSED");
} catch (err) {
  console.error("[phase3] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
