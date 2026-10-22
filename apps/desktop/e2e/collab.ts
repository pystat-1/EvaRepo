// Two evaluators of one group («الزملاء»), quarter marks and «الدرجات
// المعدّلة»: علي grades a student on his phone with the modified scoring
// (discussion 2.5 + 2.5 + quiz 2) using quarter marks, records an
// assignment (الواجبات) and sends the day to سارة («إرسال لزميل»). سارة
// sees it under «الزملاء», merges it into her own day, finishes and
// validates it once; the desktop files one grade with the quiz; علي sees
// that she merged it; the assignment arrives with who sent it and the
// list downloads.
import path from "node:path";
import { todayISO } from "../../../packages/core/src/date";
import { ADMIN, log, openDesktop, openPhone, seedFile, startRelay, waitFor, type Relay } from "./harness";
import type { Browser, Page } from "playwright";

export async function collab(browser: Browser, out: string) {
  const file = path.join(out, "collab.db");
  const db = await seedFile(file, 2);
  // علي covers اليرموك too: both evaluators have its groups.
  db.prepare(`INSERT INTO evaluator_assignments (id, accountId, hospitalId, courseId) VALUES ('a-ali-yrm', 'e-ali', 'h-yarmouk', 'c1')`).run();
  const today = todayISO();
  const relay: Relay = await startRelay();
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };
  const shots = process.env.EVA_E2E_SHOTS;
  // A box's value once React has re-rendered.
  const valueIs = (p: Page, selector: string, want: string, what: string) => waitFor(what, async () => (await p.locator(selector).inputValue()) === want, 5_000);

  const desk = await openDesktop(browser, db, file, out, relay);
  const d = desk.page;
  await d.waitForSelector(".sync-badge");
  await d.click("nav >> text=المزامنة");
  await d.fill("input[type=password]", ADMIN);
  await d.click("button:has-text('حفظ وبدء المزامنة')");
  await waitFor("first sync", async () => (await d.locator(".sync-badge").innerText()).includes("متزامن"), 30_000);

  const signIn = async (email: string, name: string) => {
    const phone = await openPhone(browser, relay, { current: { email, name } });
    await phone.page.click("#fake-google");
    await phone.page.waitForSelector("text=متزامن", { timeout: 30_000 });
    return phone;
  };
  const openGroup = async (p: Page) => {
    await p.click('nav.tabbar button:has-text("اليوم")');
    await p.evaluate('document.querySelectorAll("details.others").forEach((d) => (d.open = true))');
    await p.locator("button.group", { hasText: "المجموعة الصباحية 1" }).first().click();
    await p.waitForSelector(".name-btn");
  };
  const sync = async (p: Page) => {
    await p.click(".chip");
    await p.waitForSelector(".chip:has-text('متزامن')", { timeout: 30_000 });
  };

  // ---- علي: an assignment, then the day with modified scoring and quarter marks ----
  const ali = await signIn("ali.e2e@gmail.com", "Ali E2E");
  const a = ali.page;
  await a.click('nav.tabbar button:has-text("الواجبات")');
  await a.click("button:has-text('تسجيل واجب')");
  await a.fill("input[list=assignment-titles]", "خطة رعاية تمريضية");
  await a.locator("label.field:has-text('المجموعة') select").selectOption({ label: "المجموعة الصباحية 1" });
  await a.locator(".guest-opt").first().click();
  await a.click("button:has-text('حفظ')");
  await a.waitForSelector(".assign-line:has-text('خطة رعاية تمريضية')");
  log("✓ phone (علي): assignment recorded");

  await openGroup(a);
  await a.click("button.tool:has-text('الدرجات المعدّلة')");
  await a.waitForSelector(".note.mod:has-text('اختبار قصير 2')");
  await a.locator(".name-btn").first().click();
  const card = a.locator(".scard");
  await card.locator("button.choice.present").click();
  await card.locator(".choice2 button", { hasText: "سلّم" }).first().click();
  await card.locator('input[aria-label^="مناقشة جماعية"]').fill("2.25");
  await card.locator('input[aria-label^="مناقشة الحالة"]').fill("٢٫٥"); // Arabic digits and separator
  await card.locator('input[aria-label^="اختبار قصير"]').fill("1.75");
  await card.locator('input[aria-label^="الملاحظة اليومية"]').fill("4.75");
  await valueIs(a, '.scard input[aria-label^="مناقشة جماعية"]', "2.25", "a quarter mark stays as typed");
  await card.locator('button[aria-label^="زيادة الملاحظة اليومية"]').click();
  await valueIs(a, '.scard input[aria-label^="الملاحظة اليومية"]', "5", "+ steps by a quarter (4.75 → 5)");
  check((await card.locator(".crit-sum", { hasText: "/7" }).innerText()).startsWith("6.5"), "discussion = 2.25 + 2.5 + 1.75");
  if (shots) await a.screenshot({ path: path.join(shots, "phone-modified-card.png"), fullPage: true });
  await a.click("button:has-text('قائمة الطلاب')");
  await a.click("button.tool:has-text('إرسال لزميل')");
  check(await a.locator("label.check:has-text('د. سارة') input").isChecked(), "the only colleague of the group is picked");
  check((await a.locator("label.check:has-text('مع واجبات هذا اليوم')").count()) === 1, "the day's assignment can go with it");
  await a.fill("textarea", "أكملت المناقشة والكويز");
  await a.click(".card button.primary:has-text('إرسال')");
  await a.waitForSelector("text=/يصل عند المزامنة/");
  log("✓ phone (علي): quarter marks, modified scoring, day sent to سارة");

  // ---- سارة: merge it, finish, validate once ----
  const sara = await signIn("sara.e2e@gmail.com", "Sara E2E");
  const s = sara.page;
  await waitFor(
    "سارة receives the share",
    async () => {
      await sync(s);
      return (await s.locator('nav.tabbar button:has-text("الزملاء") .badge').count()) > 0;
    },
    60_000
  );
  await s.click('nav.tabbar button:has-text("الزملاء")');
  const share = s.locator(".card.share", { hasText: "م. علي" }).first();
  check((await share.innerText()).includes("أكملت المناقشة والكويز"), "the message shows");
  await share.click();
  await s.waitForSelector("td.merge-new");
  check((await s.locator("td.merge-new").count()) === 1, "one new student to merge");
  if (shots) await s.screenshot({ path: path.join(shots, "phone-merge.png"), fullPage: true });
  await s.click("button:has-text('في تقييمي لهذا اليوم')");
  await s.waitForSelector(".note.mod"); // the day opens, with the colleague's scoring
  await s.locator(".name-btn").first().click();
  await valueIs(s, '.scard input[aria-label^="مناقشة جماعية"]', "2.25", "علي's mark is in سارة's day");
  await s.locator(".picker .pick").nth(1).click();
  await s.locator(".scard button.choice.absent").click();
  await s.click("[role=tab]:has-text('تقييم اليوم')");
  await s.click("button:has-text('اعتماد اليوم وإرساله للمدير')");
  await s.click("button:has-text('نعم، اعتماد')");
  log("✓ phone (سارة): merged علي's work and validated the day once");

  await waitFor("desktop applies the day", async () => (db.prepare("SELECT COUNT(*) n FROM sync_inbox WHERE status = 'applied'").get() as { n: number }).n > 0, 120_000);
  const ev = db.prepare("SELECT evaluatorId, itemScores, total FROM evaluations WHERE studentId = 's1' AND dateISO = ?").get(today) as { evaluatorId: string; itemScores: string; total: number };
  const items = JSON.parse(ev.itemScores) as Record<string, number>;
  check(ev.evaluatorId === "e-sara" && items.quiz === 1.75 && items["ri-gdisc"] === 2.25, `one grade, by سارة, with the quiz (got ${JSON.stringify(ev)})`);
  check((db.prepare("SELECT COUNT(*) n FROM sync_inbox WHERE status = 'conflict'").get() as { n: number }).n === 0, "no conflict for the manager");
  log(`✓ desktop: one grade with the quiz (total ${ev.total})`);

  // ---- the assignment came along; علي sees the merge ----
  await s.click('nav.tabbar button:has-text("الواجبات")');
  await s.waitForSelector(".assign-line:has-text('خطة رعاية تمريضية'):has-text('من م. علي')"); // marked with who sent it
  const dl = s.waitForEvent("download");
  await s.click(".dl > button");
  await s.click(".dl-item:has-text('Excel')");
  check((await (await dl).suggestedFilename()).endsWith(".xlsx"), "the assignment list downloads as Excel");
  await waitFor(
    "علي sees سارة merged it",
    async () => {
      await a.click('nav.tabbar button:has-text("الزملاء")'); // leaves the day: the sync chip is in the header
      await sync(a);
      return (await a.locator(".card.share", { hasText: "دمجه ✓" }).count()) > 0;
    },
    60_000
  );
  log("✓ phones: the assignment arrived and downloads; the sender sees the merge");

  check(desk.errors.length === 0 && ali.errors.length === 0 && sara.errors.length === 0, `no page errors: ${[...desk.errors, ...ali.errors, ...sara.errors].join(" | ")}`);
  await a.close();
  await s.close();
  await d.close();
}
