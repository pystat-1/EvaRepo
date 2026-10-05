// Grading Center: the course matrix (calendar order, rotation bands, group
// averages, one criterion in the cells), «كشف اليوم» opened from a day
// header with every criterion, «ملف الطالب» from a name, and «ملخص الطالب»
// as its own view.
import path from "node:path";
import { log, openDesktop, seedFile } from "./harness";
import type { Browser } from "playwright";

export async function daysheet(browser: Browser, out: string) {
  const file = path.join(out, "daysheet.db");
  const db = await seedFile(file, 3);
  const desk = await openDesktop(browser, db, file, out);
  const d = desk.page;
  const shots = process.env.EVA_E2E_SHOTS;
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };

  await d.click("nav >> text=مركز الدرجات");
  const heads = d.locator("main button[aria-label*='فتح كشف هذا اليوم']");
  await heads.first().waitFor();
  check((await heads.count()) > 1, "calendar order is the default, with clickable day headers");
  check((await d.locator("main >> text=/الدوران 1 · /").count()) > 0, "group bands name each rotation");
  check((await d.locator("main >> text=معدل المجموعة").count()) > 0, "group average rows");
  check((await d.locator("main >> text=ملخص الطالب").count()) === 1, "no summary columns in the matrix, only the option");
  await d.selectOption("main select:has(option:text('مجموع اليوم (من 15)'))", { index: 2 });
  if (shots) await d.screenshot({ path: path.join(shots, "gc-matrix.png"), fullPage: true });
  log("✓ course matrix: calendar order, rotation bands, group averages, criterion picker");

  await heads.nth(1).click();
  await d.locator("main [role=region][aria-label='كشف اليوم']").waitFor();
  check((await d.locator("main select[aria-label='اختر يوم الحضور']").inputValue()) === "1", "opens on the clicked day");
  const th = await d.locator("main [aria-label='كشف اليوم'] thead th").allInnerTexts();
  check(th.some((t) => t.includes("الملاحظة اليومية")) && th.some((t) => t.includes("المجموع")), "every criterion is a column");
  check((await d.locator("main [aria-label='كشف اليوم'] tbody tr").count()) > 3, "students listed under their hospital and group");
  await d.click("main [aria-label='كشف اليوم'] thead button:has-text('المجموع')");
  if (shots) await d.screenshot({ path: path.join(shots, "gc-daysheet.png"), fullPage: true });
  await d.click("main button[aria-label='اليوم التالي']");
  check((await d.locator("main select[aria-label='اختر يوم الحضور']").inputValue()) === "2", "next day");
  log("✓ «كشف اليوم»: one day with every criterion, sortable, steps through days");

  await d.click("main [aria-label='كشف اليوم'] button[data-student]");
  const fileView = d.locator("[role=dialog][aria-label^='ملف الطالب']");
  await fileView.waitFor();
  check((await fileView.locator("tbody tr").count()) >= 30 + 3, "the file lists every scheduled day under its rotation");
  check((await fileView.locator("thead th").allInnerTexts()).some((t) => t.includes("المناقشة")), "every criterion is a column");
  if (shots) await d.screenshot({ path: path.join(shots, "gc-student-file.png") });
  await fileView.locator("button[data-cell]").first().click();
  const dialogs = d.locator("[role=dialog]");
  await d.waitForFunction(() => document.querySelectorAll("[role=dialog]").length === 2);
  await d.keyboard.press("Escape"); // closes the day popover, the file stays
  await d.waitForFunction(() => document.querySelectorAll("[role=dialog]").length === 1);
  check((await dialogs.count()) === 1 && (await fileView.count()) === 1, "Esc closes the popover first");
  await d.keyboard.press("Escape");
  await fileView.waitFor({ state: "detached" });
  log("✓ clicking a name opens «ملف الطالب» with every day; a day opens its popover; Esc closes each in turn");

  await d.click("main button:has-text('ملخص الطالب')");
  await d.locator("main >> text=معدل كل معيار عبر الدورة").waitFor();
  check((await d.locator("main >> text=طالب 1").count()) > 0, "summary lists the students by name");
  if (shots) await d.screenshot({ path: path.join(shots, "gc-summary.png"), fullPage: true });
  log("✓ «ملخص الطالب» opens on its own with the names");

  check(desk.errors.length === 0, `no page errors: ${desk.errors.join(" | ")}`);
  await d.close();
}
