// «مركز المعايير»: the admin raises a criterion's maximum (refused until its
// items add up again), adds an item, saves after the warnings, then turns
// a criterion off; the total follows and the database holds the change.
import path from "node:path";
import { log, openDesktop, seedFile } from "./harness";
import type { Browser } from "playwright";

export async function rubric(browser: Browser, out: string) {
  const file = path.join(out, "rubric.db");
  const db = await seedFile(file, 2);
  const desk = await openDesktop(browser, db, file, out);
  const d = desk.page;
  const shots = process.env.EVA_E2E_SHOTS;
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };
  const total = async () => (await d.locator(".card b.tabular").first().innerText()).trim();
  const card = (name: string) => d.locator(`section[aria-label='${name}']`);

  await d.click("nav >> text=مركز المعايير");
  await card("المناقشة والتغذية الراجعة").waitFor();
  check((await total()) === "15", "the day's total is 15");
  check((await d.locator("button:has-text('حفظ')").last().isDisabled()) === true, "nothing to save yet");

  // 7 → 8: the two items (3.5 + 3.5) no longer add up.
  const disc = card("المناقشة والتغذية الراجعة");
  await disc.locator("input[aria-label='الدرجة القصوى للمعيار']").fill("٨");
  await disc.locator(".field-error").first().waitFor();
  check((await disc.locator(".field-error").first().innerText()).includes("مجموع البنود 7 لا يساوي الدرجة القصوى للمعيار 8"), "items must add up");
  check(await d.locator("button.btn-primary:has-text('حفظ')").isDisabled(), "save blocked while a problem remains");

  // A third item of 1: 3.5 + 3.5 + 1 = 8.
  await disc.locator("button:has-text('إضافة بند')").click();
  const row = disc.locator("tbody tr").last();
  await row.locator("input[aria-label='اسم البند']").fill("اختبار عملي");
  await row.locator("select[aria-label='نوع البند']").selectOption("number");
  await row.locator("input[aria-label='الدرجة القصوى للبند']").fill("1");
  check((await disc.locator(".field-error").count()) === 0, "problem gone once the items add up");
  check((await total()) === "16", "the total follows the draft");
  if (shots) await d.screenshot({ path: path.join(shots, "rubric-draft.png"), fullPage: true });

  await d.click("button.btn-primary:has-text('حفظ')");
  const confirm = d.locator(".confirm-box");
  await confirm.waitFor();
  const text = await confirm.innerText();
  check(text.includes("المجموع الكلي لليوم يتغيّر من 15 إلى 16"), "warns about the total");
  check(!text.includes("الدرجات المعدّلة"), "the quiz option still adds up: 2.5 + 2.5 + 2 + 1 = 8");
  check(text.includes("هواتف المقيّمين"), "says the phones get it on the next sync");
  if (shots) await d.screenshot({ path: path.join(shots, "rubric-confirm.png") });
  await confirm.locator("button:has-text('حفظ المعايير')").click();
  await d.locator(".note-ok").waitFor();
  const saved = db.prepare("SELECT maxScore FROM rubric_sections WHERE labelAr = ?").get("المناقشة والتغذية الراجعة") as { maxScore: number };
  check(saved.maxScore === 8, "criterion saved with 8");
  check(!!db.prepare("SELECT 1 FROM rubric_items WHERE labelAr = 'اختبار عملي' AND maxScore = 1 AND kind = 'number'").get(), "item saved");
  log("✓ maximum raised, item added, saved after the warnings");

  // Turn المظهر off: the total drops by its 1, the row stays (turned off).
  await card("المظهر").locator("label:has-text('فعّال') input").first().uncheck();
  check((await total()) === "15", "total without المظهر");
  await d.click("button.btn-primary:has-text('حفظ')");
  await confirm.locator("button:has-text('حفظ المعايير')").click();
  await d.locator(".note-ok").waitFor();
  check((db.prepare("SELECT active FROM rubric_sections WHERE labelAr = 'المظهر'").get() as { active: number }).active === 0, "criterion turned off, not deleted");
  check((await d.locator("section .badge-warn:has-text('معطّل')").count()) === 1, "shown as turned off");
  check((db.prepare("SELECT count(*) AS n FROM audit_log WHERE entityType IN ('RubricSection','RubricItem')").get() as { n: number }).n >= 3, "changes in the audit log");
  if (shots) await d.screenshot({ path: path.join(shots, "rubric-saved.png"), fullPage: true });
  log("✓ criterion turned off: total 15, kept as معطّل, audited");

  check(desk.errors.length === 0, `no page errors: ${desk.errors.join(" | ")}`);
  await d.close();
}
