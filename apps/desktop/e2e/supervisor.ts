// A supervisor: the admin adds an evaluator with «مشرف» ticked and no
// hospital; on the phone that account sees every group of the course and
// the «المقيّمون» tab with each evaluator and their covers.
import path from "node:path";
import { ADMIN, log, openDesktop, openPhone, seedFile, startRelay, waitFor, type Relay } from "./harness";
import type { Browser } from "playwright";

export async function supervisor(browser: Browser, out: string) {
  const file = path.join(out, "supervisor.db");
  const db = await seedFile(file, 2);
  const relay: Relay = await startRelay();
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };

  const desk = await openDesktop(browser, db, file, out, relay);
  const d = desk.page;
  await d.waitForSelector(".sync-badge");
  await d.click("nav >> text=المزامنة");
  await d.fill("input[type=password]", ADMIN);
  await d.click("button:has-text('حفظ وبدء المزامنة')");
  await waitFor("first sync", async () => (await d.locator(".sync-badge").innerText()).includes("متزامن"), 30_000);

  await d.click("nav >> text=المقيّمون");
  await d.click("button:has-text('إضافة مقيّم')");
  await d.fill("dialog[open] input[type=email]", "boss.e2e@gmail.com");
  await d.locator("dialog[open] .sup-check input").check();
  check((await d.locator("dialog[open]").getByText("يغطي المستشفيات").count()) === 0, "no hospital choice for a supervisor");
  await d.click("dialog[open] button:has-text('حفظ')");
  const card = d.locator(".ev-card", { hasText: "boss.e2e@gmail.com" });
  await card.locator(".badge-sup").waitFor();
  await waitFor("supervisor reaches the relay", async () => !!relay.db.prepare("SELECT 1 FROM bundles b JOIN evaluators e ON e.id = b.evaluatorId WHERE e.email = 'boss.e2e@gmail.com'").get(), 30_000);
  log("✓ desktop: evaluator added as «مشرف» with no hospital; on the relay");

  const phone = await openPhone(browser, relay, { current: { email: "boss.e2e@gmail.com", name: "Boss E2E" } });
  const p = phone.page;
  await p.click("#fake-google");
  await p.waitForSelector("text=متزامن", { timeout: 30_000 });
  await p.waitForSelector("header .top-sup", { timeout: 30_000 }); // «مشرف» beside the name, once the bundle is in
  await p.click('nav.tabbar button:has-text("طلابي")');
  check((await p.locator(".student").count()) === 12, "every student of the course (6 groups × 2)");
  await p.click('nav.tabbar button:has-text("المقيّمون")');
  const members = p.locator(".card.member");
  await members.first().waitFor();
  check((await members.count()) === 3, "three evaluators listed");
  const sara = members.filter({ hasText: "sara.e2e@gmail.com" });
  await sara.locator(".student-head").click();
  check((await sara.innerText()).includes("مستشفى اليرموك · كل المجموعات"), "Sara's cover shown");
  check((await members.filter({ hasText: "boss.e2e@gmail.com" }).locator(".tag.sup").count()) === 1, "the supervisor marked");
  if (process.env.EVA_E2E_SHOTS) await p.screenshot({ path: path.join(process.env.EVA_E2E_SHOTS, "phone-team.png") });
  log("✓ phone: the supervisor sees every student and «المقيّمون» with each evaluator's cover");

  check(desk.errors.length === 0 && phone.errors.length === 0, `no page errors: ${[...desk.errors, ...phone.errors].join(" | ")}`);
  await p.close();
  await d.close();
}
