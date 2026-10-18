// توزيع الأقسام: the admin sets one day's unit for the whole group from the
// column header, changes one student's cell, and the grid keeps both.
import path from "node:path";
import { log, openDesktop, seedFile } from "./harness";
import type { Browser } from "playwright";

export async function units(browser: Browser, out: string) {
  const file = path.join(out, "units.db");
  const db = await seedFile(file, 2);
  const desk = await openDesktop(browser, db, file, out);
  const d = desk.page;
  const shots = process.env.EVA_E2E_SHOTS;
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };

  await d.click("nav >> text=الدورات والجدول");
  const grid = d.locator("table.unit-plan");
  await grid.waitFor();
  check((await d.locator(".unit-badge").count()) === 4, "the four standard units are listed");

  // The first day: the whole group in العناية.
  const firstDay = () =>
    d.evaluate(() => Array.from(document.querySelectorAll("table.unit-plan tbody tr td:nth-child(2) .unit-cell")).map((c) => c.textContent?.trim()));
  await grid.locator("thead select.unit-all").first().selectOption({ label: "العناية" });
  await d.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll("table.unit-plan tbody tr td:nth-child(2) .unit-cell"));
    return cells.length > 0 && cells.every((c) => c.textContent?.trim() === "العناية");
  });
  log(`✓ one day set for the whole group (${(await firstDay()).length} students)`);

  // One student moves to العمليات that day: the cell becomes a list on click.
  await grid.locator("tbody tr td:nth-child(2) .unit-cell").first().click();
  await grid.locator("tbody select.cell-select").selectOption({ label: "العمليات" });
  await d.waitForFunction(() => {
    const cells = Array.from(document.querySelectorAll("table.unit-plan tbody tr td:nth-child(2) .unit-cell"));
    return cells[0]?.textContent?.trim() === "العمليات" && cells[1]?.textContent?.trim() === "العناية";
  });
  if (shots) await d.locator(".card", { has: grid }).screenshot({ path: path.join(shots, "units.png") });
  log("✓ one student's unit changed, the others kept");

  check(desk.errors.length === 0, `no page errors: ${desk.errors.join(" | ")}`);
  await d.close();
}
