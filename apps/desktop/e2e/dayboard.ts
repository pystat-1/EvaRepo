// Day board: in «التصميم المدمج» by date, every day header lists the group at
// each hospital; clicking it opens «حسب اليوم», one panel per hospital with
// that group's students, and the arrows step through the course's days.
import path from "node:path";
import { log, openDesktop, seedFile } from "./harness";
import type { Browser } from "playwright";

export async function dayboard(browser: Browser, out: string) {
  const file = path.join(out, "dayboard.db");
  const db = await seedFile(file, 3);
  const desk = await openDesktop(browser, db, file, out);
  const d = desk.page;
  const shots = process.env.EVA_E2E_SHOTS;
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };

  await d.click("nav >> text=مركز الدرجات");
  await d.click("main button:has-text('حسب التاريخ')");
  const heads = d.locator("main button[aria-label*='عرض اليوم في كل المستشفيات']");
  await heads.first().waitFor();
  const nHeads = await heads.count();
  check(nHeads > 1, "calendar order has clickable day headers");
  check((await heads.first().getAttribute("aria-label"))!.includes("المجموعة"), "a day header names the groups");
  if (shots) await d.screenshot({ path: path.join(shots, "dayboard-table.png"), fullPage: true });
  log(`✓ ${nHeads} day headers list the group at each hospital`);

  await heads.nth(1).click();
  await d.locator("main [role=region][aria-label='لوحة اليوم']").waitFor();
  check((await d.locator("main button[aria-pressed=true]:has-text('حسب اليوم')").count()) === 1, "scope switched to the day board");
  check((await d.locator("main select[aria-label='اختر يوم الحضور']").inputValue()) === "1", "board opens on the clicked day");
  const panels = d.locator("main [aria-label='لوحة اليوم'] section");
  const nPanels = await panels.count();
  check(nPanels >= 2, "one panel per hospital");
  const withStudents = await d.locator("main [aria-label='لوحة اليوم'] section [data-cell], main [aria-label='لوحة اليوم'] section [role=img]").count();
  check(withStudents > 0, "panels list students");
  if (shots) await d.screenshot({ path: path.join(shots, "dayboard-board.png"), fullPage: true });
  log(`✓ day 2 opens the board: ${nPanels} hospital panels, ${withStudents} student cells`);

  await d.click("main button[aria-label='اليوم التالي']");
  check((await d.locator("main select[aria-label='اختر يوم الحضور']").inputValue()) === "2", "next day");
  log("✓ the arrows step to the next day");

  check(desk.errors.length === 0, `no page errors: ${desk.errors.join(" | ")}`);
  await d.close();
}
