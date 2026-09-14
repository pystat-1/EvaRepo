import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
const log = (msg) => console.log(`[import-smoke] ${msg}`);

try {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "admin@eva.local");
  await page.fill('input[name="password"]', "ChangeMe123!");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/dashboard`);

  const csvPath = path.join(os.tmpdir(), "import-test.csv");
  fs.writeFileSync(
    csvPath,
    "universityNumber,nameAr,nameEn,email,studyType,group\n" +
      "U-1001,أحمد علي (محدث),Ahmed Ali Updated,ahmed@example.com,Nursing,Group A\n" +
      "U-2002,سارة محمد,Sara Mohammed,,Nursing,Group A\n"
  );

  await page.goto(`${BASE}/students`);
  await page.setInputFiles('input[name="file"]', csvPath);
  await page.click('button:has-text("استيراد")');
  await page.waitForSelector("text=تحديث", { timeout: 10000 });
  const summary = await page.textContent("body");
  if (!summary.includes("سارة محمد")) throw new Error("new student from import not visible");
  if (!summary.includes("أحمد علي (محدث)")) throw new Error("existing student was not updated by import");
  log("import created 1 and updated 1, upsert-by-universityNumber confirmed");
  log("ALL CHECKS PASSED");
} catch (err) {
  console.error("[import-smoke] FAILED:", err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
