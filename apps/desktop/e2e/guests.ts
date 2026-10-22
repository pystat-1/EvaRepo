// A hosted student (طالب مستضاف): on the phone the evaluator adds a student
// of an evening group to today's morning group, sees the day they were
// already graded («قُيّم في مجموعته» starts ticked with its data), grades
// them with the group and validates; the desktop files the grade in the
// student's own record and lists the hosting; the phone's history shows it.
import path from "node:path";
import { addDaysISO, todayISO } from "../../../packages/core/src/date";
import { ADMIN, log, openDesktop, openPhone, seedFile, startRelay, waitFor, type Relay } from "./harness";
import type { Browser } from "playwright";

export async function guests(browser: Browser, out: string) {
  const file = path.join(out, "guests.db");
  const db = await seedFile(file, 2);
  const today = todayISO();
  // طالب 9 (المجموعة المسائية 2) was graded yesterday in his own group.
  db.prepare(
    `INSERT INTO evaluations (id, studentId, evaluatorId, groupId, hospitalId, dateISO, attendance, total, courseId, pendingValidation)
     VALUES ('ev-s9', 's9', 'e-ali', 'g-e2', 'h-medcity', ?, 'present', 12.5, 'c1', 0)`
  ).run(addDaysISO(today, -1));
  const relay: Relay = await startRelay();
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };
  const shots = process.env.EVA_E2E_SHOTS;

  const desk = await openDesktop(browser, db, file, out, relay);
  const d = desk.page;
  await d.waitForSelector(".sync-badge");
  await d.click("nav >> text=المزامنة");
  await d.fill("input[type=password]", ADMIN);
  await d.click("button:has-text('حفظ وبدء المزامنة')");
  await waitFor("first sync", async () => (await d.locator(".sync-badge").innerText()).includes("متزامن"), 30_000);

  const phone = await openPhone(browser, relay, { current: { email: "sara.e2e@gmail.com", name: "Sara E2E" } });
  const p = phone.page;
  await p.click("#fake-google");
  await p.waitForSelector("text=متزامن", { timeout: 30_000 });
  await p.evaluate('document.querySelectorAll("details.others").forEach((d) => (d.open = true))');
  await p.locator("button.group", { hasText: "المجموعة الصباحية 1" }).first().click();
  await p.waitForSelector(".name-btn");

  // Add: from the other study type → المجموعة المسائية 2 → طالب 9.
  await p.click("button.add-guest");
  await p.click(".guest-add button.choice:has-text('من نوع دراسة آخر')");
  await p.locator(".guest-add select").selectOption({ label: "المجموعة المسائية 2 (2)" });
  const opt = p.locator(".guest-opt", { hasText: "طالب 9" });
  check((await opt.locator(".tag.ok").innerText()).includes("قُيّم 1"), "the student's evaluated days counted in the list");
  await opt.click();
  check((await p.locator(".guest-add .evaluated").innerText()).includes("12.5"), "his evaluation in his own group shown");
  check(await p.locator(".guest-add .prior input[type=checkbox]").isChecked(), "«قُيّم في مجموعته» ticked");
  check((await p.locator(".guest-add .prior input[type=date]").inputValue()) === addDaysISO(today, -1), "with that day's date");
  await p.fill(".guest-add .prior input[placeholder*='قُيّم في مستشفى']", "قُيّم في مدينة الطب");
  if (shots) await p.screenshot({ path: path.join(shots, "phone-add-guest.png"), fullPage: true });
  await p.click("button:has-text('إضافة إلى قائمة اليوم')");
  log("✓ phone: hosted student picked from another study type, with his evaluated day");

  // Their card opens at once: grade them like the group.
  const card = p.locator(".scard");
  await card.waitFor();
  check((await card.locator(".guest-panel").innerText()).includes("المجموعة المسائية 2"), "the card says where he comes from");
  await card.locator("button.choice.present").click();
  await card.locator(".choice2 button", { hasText: "سلّم" }).first().click();
  const full = card.locator("button:has-text('كامل')");
  while ((await full.count()) > 0) await full.first().click();
  const nums = card.locator('.numrow input[inputmode="decimal"]');
  for (let i = 0; i < (await nums.count()); i++) await nums.nth(i).fill("2");
  check((await p.locator(".picker .pick.guest").count()) === 1, "the hosted student in the picker");
  // The group's own students: absent today.
  for (const i of [0, 1]) {
    await p.locator(".picker .pick").nth(i).click();
    await card.locator("button.choice.absent").click();
  }
  await p.click("[role=tab]:has-text('تقييم اليوم')");
  check((await p.locator(".review tbody tr").count()) === 3, "the review lists the group and the hosted student");
  check((await p.locator(".review .guest-tag").count()) === 1, "marked «مستضاف» in the review");
  await p.click("button:has-text('اعتماد اليوم وإرساله للمدير')");
  await p.click("button:has-text('نعم، اعتماد')");
  log("✓ phone: day validated with the hosted student");

  await waitFor("desktop applies the day", async () => (db.prepare("SELECT COUNT(*) n FROM sync_inbox WHERE status = 'applied'").get() as { n: number }).n > 0, 120_000);
  const ev = db.prepare("SELECT groupId, total FROM evaluations WHERE studentId = 's9' AND dateISO = ?").get(today) as { groupId: string; total: number } | undefined;
  check(ev?.groupId === "g-m1" && ev.total > 0, `the grade is in his record, with the host group (got ${JSON.stringify(ev)})`);
  const hosted = db.prepare("SELECT kind, shift, homeGroupName, priorEvaluation FROM hosted_students").all() as Array<Record<string, string>>;
  check(hosted.length === 1 && hosted[0].kind === "other-shift" && hosted[0].shift === "EVENING", `hosting kept (got ${JSON.stringify(hosted)})`);
  check(JSON.parse(hosted[0].priorEvaluation).notes === "قُيّم في مدينة الطب", "«قُيّم في مجموعته» kept with its note");
  await waitFor("desktop lists the hosted student", async () => (await d.locator(".card", { hasText: "الطلاب المستضافون (1)" }).count()) > 0, 30_000);
  check((await d.locator(".card", { hasText: "الطلاب المستضافون" }).innerText()).includes("طالب 9"), "desktop lists him");
  if (shots) await d.locator(".card", { hasText: "الطلاب المستضافون" }).screenshot({ path: path.join(shots, "desktop-hosted.png") });
  log("✓ desktop: grade filed in the student's record; hosting listed");

  await waitFor(
    "phone gets the history",
    async () => {
      await p.click(".chip");
      await p.click('nav.tabbar button:has-text("السجلات")');
      return (await p.locator(".card.group:has-text('وصل للمدير')").count()) > 0;
    },
    120_000
  );
  await p.locator(".card.group:has-text('وصل للمدير')").first().click();
  await p.waitForSelector(".review");
  check((await p.locator(".review .guest-tag").count()) === 1, "the validated day still shows the hosted student");
  log("✓ phone: the validated day shows the hosted student");

  check(desk.errors.length === 0 && phone.errors.length === 0, `no page errors: ${[...desk.errors, ...phone.errors].join(" | ")}`);
  await p.close();
  await d.close();
}
