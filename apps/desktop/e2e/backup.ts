// Online backups, end to end: turn on with a new recovery code → every
// backup is encrypted and uploaded → this computer keeps only the newest 3
// → on a "new computer" a wrong code is refused, the right one restores.
import path from "node:path";
import { ADMIN, log, openDesktop, seedFile, startRelay, waitFor } from "./harness";
import type { Browser } from "playwright";

export async function backup(browser: Browser, out: string) {
  const file = path.join(out, "backup.db");
  const db = await seedFile(file, 5);
  const relay = await startRelay();
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };
  const { page: d, errors, tauriLog } = await openDesktop(browser, db, file, out, relay);
  await d.waitForSelector("nav.tabs");

  // Sync first (online backups use the same server and key).
  await d.click("nav >> text=المزامنة");
  await d.fill("input[type=password]", ADMIN);
  await d.click("button:has-text('حفظ وبدء المزامنة')");
  await waitFor("sync", async () => (await d.locator(".sync-badge").innerText()).includes("متزامن"), 30_000);

  await d.click("nav >> text=النظام");
  const card = d.locator(".card", { has: d.locator("h2", { hasText: /^النسخ على الإنترنت$/ }) });
  await card.locator("button:has-text('تفعيل النسخ على الإنترنت')").click();
  await d.click("dialog[open] button:has-text('إنشاء الرمز والبدء')");
  const code = (await d.locator("dialog[open] .recovery-code").innerText()).trim();
  check(/^([A-Z2-9]{4}-){13}[A-Z2-9]{4}$/.test(code), "recovery code shown");
  check(await d.locator("dialog[open] button:has-text('تم')").isDisabled(), "must confirm the code was saved");
  await d.locator("dialog[open] label.check").click();
  await d.click("dialog[open] button:has-text('تم')");
  await waitFor("first upload", async () => relay.bucket.size >= 1, 30_000).catch(async (e) => {
    console.log("card:", (await card.innerText()).replace(/\s+/g, " ").slice(0, 400));
    throw e;
  });
  const first = [...relay.bucket.values()][0];
  check(Buffer.from(first.subarray(0, 4)).toString() === "EVAB" && !Buffer.from(first).toString("latin1").includes("SQLite"), "uploaded file is encrypted");
  log(`✓ turned on with a recovery code; ${relay.bucket.size} backup(s) uploaded, encrypted`);

  // Five more backups: all go online, only the newest 3 stay here.
  for (let i = 0; i < 5; i++) {
    await d.click("button:has-text('نسخة احتياطية الآن')");
    await d.waitForSelector(".note-ok:has-text('أُخذت نسخة احتياطية')");
    await d.waitForTimeout(1100); // backup names carry the second
  }
  await card.locator("button:has-text('رفع الآن')").click();
  await waitFor("uploads and local pruning", async () => relay.bucket.size >= 6 && (await d.locator(".card:has-text('النسخ على هذا الحاسوب') tbody tr").count()) === 3, 60_000).catch(async (e) => {
    console.log("bucket:", relay.bucket.size, [...relay.bucket.keys()]);
    console.log("local rows:", await d.locator(".card:has-text('النسخ على هذا الحاسوب') tbody tr").count());
    console.log("card:", (await card.innerText()).replace(/\s+/g, " ").slice(0, 300));
    throw e;
  });
  const localRows = await d.locator(".card:has-text('النسخ على هذا الحاسوب') tbody tr").count();
  log(`✓ ${relay.bucket.size} backups online, ${localRows} kept on this computer`);
  if (process.env.EVA_E2E_SHOTS) await d.screenshot({ path: path.join(process.env.EVA_E2E_SHOTS, "system.png") });
  const selfCheck = await d.locator(".checks li", { hasText: "النسخ محفوظة على الإنترنت" }).count();
  check(selfCheck === 1, "self-check reports online backups");

  // A new computer: no code saved yet; the wrong code is refused, the right one restores.
  db.prepare("DELETE FROM meta WHERE key = 'backup.cloudCode'").run();
  await d.reload();
  await d.waitForSelector("nav.tabs");
  await d.click("nav >> text=النظام");
  await card.locator("button:has-text('تفعيل النسخ على الإنترنت')").click();
  await d.click("dialog[open] .seg button:has-text('لديّ رمز استرداد')");
  const wrong = code.slice(0, -1) + (code.endsWith("A") ? "B" : "A");
  await d.fill("dialog[open] input", wrong);
  await d.click("dialog[open] button:has-text('التحقق والبدء')");
  await d.waitForSelector("dialog[open] .note-err");
  log(`✓ a mistyped code is refused: ${await d.locator("dialog[open] .note-err").innerText()}`);
  await d.fill("dialog[open] input", code.toLowerCase());
  await d.click("dialog[open] button:has-text('التحقق والبدء')");
  await d.waitForSelector("dialog[open]", { state: "detached" });
  await waitFor("online list", async () => (await card.locator("tbody tr").count()) >= 6, 30_000);
  const oldest = card.locator("tbody tr").last();
  await oldest.locator("button:has-text('استعادة')").click();
  await d.click(".confirm-box button:has-text('تنزيل واستعادة')");
  await d.click(".confirm-box button:has-text('استعادة')"); // the local restore asks too
  await waitFor("restore", async () => tauriLog.restored.length > 0, 30_000);
  log(`✓ right code accepted; oldest online backup downloaded, decrypted and restored (${tauriLog.restored[0]})`);

  if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
  await d.close();
  db.close();
}
