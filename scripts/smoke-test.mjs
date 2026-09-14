import { chromium } from "playwright";

const BASE = "http://localhost:3100";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const log = (msg) => console.log(`[smoke] ${msg}`);

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "admin@eva.local");
  await page.fill('input[name="password"]', "ChangeMe123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/dashboard`, { timeout: 10000 });
  log("login OK, reached dashboard");

  // Study type
  await page.goto(`${BASE}/study-types`);
  await page.fill('input[name="name"]', "Nursing");
  await page.fill('input[name="nameAr"]', "تمريض");
  await page.click('button:has-text("إضافة")');
  await page.waitForSelector("text=تمريض");
  log("study type created");

  // Hospital
  await page.goto(`${BASE}/hospitals`);
  await page.fill('input[name="name"]', "Baghdad Teaching Hospital");
  await page.fill('input[name="nameAr"]', "مستشفى بغداد التعليمي");
  await page.click('button:has-text("إضافة")');
  await page.waitForSelector("text=مستشفى بغداد التعليمي");
  log("hospital created");

  // Group
  await page.goto(`${BASE}/groups`);
  await page.fill('input[name="name"]', "Group A");
  await page.selectOption('select[name="hospitalId"]', { label: "Baghdad Teaching Hospital" });
  await page.click('button:has-text("إضافة")');
  await page.waitForSelector("text=Group A");
  log("group created");

  // Student
  await page.goto(`${BASE}/students`);
  await page.fill('input[name="universityNumber"]', "U-1001");
  await page.fill('input[name="nameAr"]', "أحمد علي");
  await page.fill('input[name="nameEn"]', "Ahmed Ali");
  await page.selectOption('select[name="studyTypeId"]', { label: "تمريض" });
  await page.selectOption('select[name="groupId"]', { label: "Group A" });
  await page.click('main form:has(input[name="universityNumber"]) button:has-text("إضافة")');
  await page.waitForSelector("text=أحمد علي");
  log("student created");

  // Duplicate university number should error
  await page.fill('input[name="universityNumber"]', "U-1001");
  await page.fill('input[name="nameAr"]', "طالب آخر");
  await page.click('main form:has(input[name="universityNumber"]) button:has-text("إضافة")');
  await page.waitForSelector("text=حدث خطأ", { timeout: 10000 });
  log("duplicate university number correctly rejected");

  // Audit log should have entries
  await page.goto(`${BASE}/audit-log`);
  await page.waitForSelector("text=إنشاء");
  log("audit log has entries");

  // Export CSV
  const resp = await page.request.get(`${BASE}/api/students/export`);
  const csv = await resp.text();
  if (!csv.includes("U-1001")) throw new Error("export CSV missing student");
  log("CSV export OK");

  log("ALL CHECKS PASSED");
} catch (err) {
  console.error("[smoke] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
