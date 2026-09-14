import { chromium } from "playwright";

const BASE = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const admin = await browser.newPage();
const log = (msg) => console.log(`[phase2] ${msg}`);

try {
  // --- Admin sets up two hospitals, two groups, students in each, and an
  // evaluator scoped to only Hospital A. ---
  await admin.goto(`${BASE}/login`);
  await admin.fill('input[name="email"]', "admin@eva.local");
  await admin.fill('input[name="password"]', "ChangeMe123!");
  await admin.click('button[type="submit"]');
  await admin.waitForURL(`${BASE}/dashboard`);

  await admin.goto(`${BASE}/study-types`);
  await admin.fill('input[name="name"]', "Nursing");
  await admin.fill('input[name="nameAr"]', "تمريض");
  await admin.click('button:has-text("إضافة")');
  await admin.waitForSelector("text=تمريض");

  await admin.goto(`${BASE}/hospitals`);
  await admin.fill('input[name="name"]', "Hospital A");
  await admin.click('main form button:has-text("إضافة")');
  await admin.waitForSelector("text=Hospital A");
  await admin.fill('input[name="name"]', "Hospital B");
  await admin.click('main form button:has-text("إضافة")');
  await admin.waitForSelector("text=Hospital B");

  await admin.goto(`${BASE}/groups`);
  await admin.fill('input[name="name"]', "Group A1");
  await admin.selectOption('select[name="hospitalId"]', { label: "Hospital A" });
  await admin.click('main form button:has-text("إضافة")');
  await admin.waitForSelector("text=Group A1");
  await admin.fill('input[name="name"]', "Group B1");
  await admin.selectOption('select[name="hospitalId"]', { label: "Hospital B" });
  await admin.click('main form button:has-text("إضافة")');
  await admin.waitForSelector("text=Group B1");

  await admin.goto(`${BASE}/students`);
  await admin.fill('input[name="universityNumber"]', "A-1");
  await admin.fill('input[name="nameAr"]', "طالب مستشفى أ");
  await admin.selectOption('select[name="groupId"]', { label: "Group A1" });
  await admin.click('main form:has(input[name="universityNumber"]) button:has-text("إضافة")');
  await admin.waitForSelector("text=طالب مستشفى أ");

  await admin.fill('input[name="universityNumber"]', "B-1");
  await admin.fill('input[name="nameAr"]', "طالب مستشفى ب");
  await admin.selectOption('select[name="groupId"]', { label: "Group B1" });
  await admin.click('main form:has(input[name="universityNumber"]) button:has-text("إضافة")');
  await admin.waitForSelector("text=طالب مستشفى ب");
  log("registry set up: 2 hospitals, 2 groups, 1 student each");

  await admin.goto(`${BASE}/evaluators`);
  await admin.fill('input[name="name"]', "Evaluator A");
  await admin.fill('input[name="email"]', "eval-a@eva.local");
  await admin.fill('input[name="password"]', "EvalPass123!");
  await admin.selectOption('form:has(input[name="name"]) select[name="hospitalId"]', {
    label: "Hospital A",
  });
  await admin.click('form:has(input[name="name"]) button:has-text("إضافة مقيّم")');
  await admin.waitForSelector("text=Evaluator A");
  log("evaluator created, scoped to Hospital A only");

  // --- Evaluator logs in and must see only Hospital A's student. ---
  const evalPage = await browser.newPage();
  await evalPage.goto(`${BASE}/login`);
  await evalPage.fill('input[name="email"]', "eval-a@eva.local");
  await evalPage.fill('input[name="password"]', "EvalPass123!");
  await evalPage.click('button[type="submit"]');
  await evalPage.waitForURL(`${BASE}/my`);
  const body = await evalPage.textContent("body");
  if (!body.includes("طالب مستشفى أ")) throw new Error("evaluator cannot see their own hospital's student");
  if (body.includes("طالب مستشفى ب")) throw new Error("SECURITY BUG: evaluator can see another hospital's student");
  log("evaluator sees only Hospital A's student — Hospital B correctly hidden");

  // --- Evaluator must not be able to reach admin pages. ---
  await evalPage.goto(`${BASE}/students`);
  await evalPage.waitForURL(`${BASE}/login`, { timeout: 5000 });
  log("evaluator correctly redirected away from admin registry pages");

  log("ALL CHECKS PASSED");
} catch (err) {
  console.error("[phase2] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
