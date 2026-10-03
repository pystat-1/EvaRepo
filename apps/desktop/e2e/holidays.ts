// Holidays: the admin clicks a day in «الجدول حسب المستشفى», makes it a
// holiday and moves its schedule to another date; the calendar shows the
// holiday in place and the make-up day in the same week. A date where the
// groups already meet is refused. Then the holiday is cancelled.
import path from "node:path";
import { log, openDesktop, seedFile, sundayOnOrBefore } from "./harness";
import type { Browser } from "playwright";

const plus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
const short = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

export async function holidays(browser: Browser, out: string) {
  const file = path.join(out, "holidays.db");
  const db = await seedFile(file, 2);
  const desk = await openDesktop(browser, db, file, out);
  const d = desk.page;
  const shots = process.env.EVA_E2E_SHOTS;
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };

  const sunday = sundayOnOrBefore();
  const monday = plus(sunday, 1);
  const saturday = plus(sunday, 6);
  await d.click("nav >> text=الدورات والجدول");
  const day = (iso: string) => d.locator(".cal-day", { hasText: short(iso) }).first();
  await day(monday).waitFor();

  // Monday → Saturday of the same week.
  await day(monday).click();
  await d.waitForSelector("dialog[open] .holiday-impact");
  check((await d.locator("dialog[open] .holiday-impact").innerText()).includes("6 مجموعة"), "all six groups meet on Monday");
  await d.fill("dialog[open] input[placeholder='عطلة رسمية']", "عطلة اختبار");
  await d.fill("dialog[open] input[type=date]", saturday);
  if (shots) await d.screenshot({ path: path.join(shots, "holiday-dialog.png") });
  await d.click("dialog[open] button:has-text('حفظ ونقل الدوام')");
  await d.waitForSelector("dialog[open]", { state: "detached" }).catch(() => d.waitForSelector("dialog:not([open])"));
  await d.locator(".cal-day.is-makeup").first().waitFor();
  check((await d.locator(".cal-day.is-holiday").first().innerText()).includes(`نُقل إلى ${short(saturday)}`), "holiday shows where it moved");
  check((await d.locator(".cal-day.is-makeup").first().innerText()).includes(`تعويض عن ${short(monday)}`), "make-up day in the calendar");
  check((await d.locator(".holiday-list").innerText()).includes("عطلة اختبار"), "listed under العطل");
  if (shots) await d.locator(".cal").screenshot({ path: path.join(shots, "holiday-calendar.png") });
  log("✓ Monday moved to Saturday: holiday and make-up day shown");

  // Tuesday → Wednesday: the groups already meet on Wednesday.
  await day(plus(sunday, 2)).click();
  await d.fill("dialog[open] input[type=date]", plus(sunday, 3));
  await d.click("dialog[open] button:has-text('حفظ ونقل الدوام')");
  await d.waitForSelector("dialog[open] .field-error");
  check((await d.locator("dialog[open] .field-error").innerText()).includes("دوام في"), "clash refused");
  await d.click("dialog[open] button:has-text('إغلاق')");
  log("✓ moving onto a day the groups already attend is refused");

  // Cancel the holiday from its make-up day.
  await d.locator(".cal-day.is-makeup").first().click();
  await d.click("dialog[open] button:has-text('إلغاء العطلة')");
  await d.locator(".cal-day.is-holiday").first().waitFor({ state: "detached" });
  check((await d.locator(".cal-day.is-makeup").count()) === 0, "make-up day gone");
  log("✓ holiday cancelled: the week is back to normal");

  check(desk.errors.length === 0, `no page errors: ${desk.errors.join(" | ")}`);
  await d.close();
}
