// The whole loop, with no sync button pressed anywhere:
// admin sets up sync once → adds an evaluator by email → the evaluator signs
// in with Google on the phone → grades and validates a day (also offline) →
// the desktop applies it → the phone shows the decision and the history,
// schedule, attendance log, students and downloads, offline.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { todayISO } from "../../../packages/core/src/date";
import { ADMIN, log, openDesktop, openPhone, seedFile, startRelay, waitFor, type Relay } from "./harness";
import type { Browser } from "playwright";

export async function flow(browser: Browser, out: string) {
  const file = path.join(out, "flow.db");
  const db = await seedFile(file, 20);
  // Every student is in العناية today (توزيع الأقسام): shown on the phone and in its files.
  db.prepare("INSERT INTO student_day_units (id, studentId, dateISO, unitId) SELECT 'u-' || id, id, ?, 'unit-icu' FROM students").run(todayISO());
  const relay: Relay = await startRelay();
  const errors: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`check failed: ${what}`);
  };

  // ---- desktop: one-time setup, evaluator by email ----
  const desk = await openDesktop(browser, db, file, out, relay);
  errors.push(...desk.errors);
  const d = desk.page;
  await d.waitForSelector(".sync-badge");
  await d.click("nav >> text=المزامنة");
  await d.fill("input[type=password]", "wrong-key-wrong-key-wrong");
  await d.click("button:has-text('حفظ وبدء المزامنة')");
  await d.waitForSelector(".note-err");
  await d.fill("input[type=password]", ADMIN);
  await d.click("button:has-text('حفظ وبدء المزامنة')");
  const t1 = await waitFor("first sync", async () => (await d.locator(".sync-badge").innerText()).includes("متزامن"), 30_000);
  log(`✓ setup: key checked, synced by itself in ${t1}s`);

  await d.click("nav >> text=المقيّمون");
  await d.click("button:has-text('إضافة مقيّم')");
  await d.fill("dialog[open] input[type=email]", "Noor.E2E@gmail.com");
  await d.locator("dialog[open] label.check").first().click();
  await d.click("dialog[open] button:has-text('حفظ')");
  const card = d.locator(".ev-card", { hasText: "noor.e2e@gmail.com" });
  await card.waitFor();
  const t2 = await waitFor("evaluator reaches the relay", async () => !!relay.db.prepare("SELECT 1 FROM bundles b JOIN evaluators e ON e.id = b.evaluatorId WHERE e.email = 'noor.e2e@gmail.com'").get(), 30_000);
  log(`✓ evaluator added by email only; on the relay in ${t2}s`);

  // ---- phone: Google sign-in ----
  const account = { current: { email: "stranger@gmail.com", name: "Stranger" } };
  const phone = await openPhone(browser, relay, account);
  const p = phone.page;
  await p.click("#fake-google");
  check((await p.locator(".note.err").innerText()).includes("غير مسجَّل"), "unregistered account refused");
  account.current = { email: "noor.e2e@gmail.com", name: "Noor E2E" };
  await p.click("#fake-google");
  await p.waitForSelector("text=متزامن", { timeout: 30_000 });
  log("✓ phone: unregistered Google account refused; registered one signed in");

  const t3 = await waitFor("desktop sees the sign-in", async () => (await card.locator(".badge-ok", { hasText: /^دخل من الهاتف$/ }).count()) > 0 && (await card.innerText()).includes("Noor E2E"), 90_000);
  log(`✓ desktop saw the sign-in and took the Google name in ${t3}s`);

  // ---- phone: grade a group today, offline, then validate ----
  await p.evaluate('document.querySelectorAll("details.others").forEach((d) => (d.open = true))');
  await p.locator("button.group").first().click();
  await p.waitForSelector(".name-btn"); // the day opens on the group's table
  check((await p.locator(".name-btn .unit-tag", { hasText: "العناية" }).count()) > 0, "today's unit beside the names");
  await p.locator(".name-btn").first().click(); // a name opens that student's card
  await p.waitForSelector(".scard");
  check((await p.locator("nav.tabbar").isVisible()) === true, "tabs stay visible inside a day");
  await phone.ctx.setOffline(true);
  const n = await p.locator(".picker .pick").count();
  const firstPick = await p.locator(".picker .pick").first().innerText();
  check(/طالب/.test(firstPick), `the picker shows names, not only numbers (got "${firstPick}")`);
  if (process.env.EVA_E2E_SHOTS) await p.screenshot({ path: path.join(process.env.EVA_E2E_SHOTS, "phone-card.png") });
  for (let i = 0; i < n; i++) {
    const card = p.locator(".scard");
    if (i === 1) {
      await card.locator("button.choice.absent").click();
    } else {
      await card.locator(i % 5 === 0 ? "button.choice.late" : "button.choice.present").click();
      await card.locator(".choice2 button", { hasText: "سلّم" }).first().click();
      const full = card.locator("button:has-text('كامل')"); // each turns into "مسح" once pressed
      while ((await full.count()) > 0) await full.first().click();
      const nums = card.locator('.numrow input[type="number"]');
      await nums.nth(0).fill("2.5"); // form order: discussion (case, group), then the daily note
      await nums.nth(1).fill("3");
      await nums.nth(2).fill("4");
    }
    if (i < n - 1) await card.locator("button:has-text('التالي')").click();
  }
  check((await p.locator(".picker .pick.done").count()) === n - 1 && (await p.locator(".picker .pick.absent").count()) === 1, "every student graded (one absent)");
  await p.click("[role=tab]:has-text('تقييم اليوم')"); // the final review holds the validate button
  check((await p.locator(".review tbody tr").count()) === n, "the day's review lists every student");
  await p.click("button:has-text('اعتماد اليوم وإرساله للمدير')");
  await p.click("button:has-text('نعم، اعتماد')");
  await p.waitForSelector("text=/بانتظار الإرسال/", { timeout: 30_000 });
  await phone.ctx.setOffline(false);
  log(`✓ phone: graded ${n} students offline and validated (waiting to send)`);

  const t4 = await waitFor("desktop applies the day", async () => (db.prepare("SELECT COUNT(*) n FROM sync_inbox WHERE status = 'applied'").get() as { n: number }).n > 0, 120_000);
  const graded = (db.prepare("SELECT COUNT(*) n FROM evaluations e JOIN accounts a ON a.id = e.evaluatorId WHERE a.email = 'noor.e2e@gmail.com'").get() as { n: number }).n;
  check(graded === n, `${n} grades on the desktop (got ${graded})`);
  log(`✓ desktop applied the day by itself in ${t4}s (${graded} grades)`);

  // ---- phone: decision, history, downloads offline ----
  const t5 = await waitFor(
    "phone gets the history",
    async () => {
      await p.click(".chip");
      await p.click('nav.tabbar button:has-text("السجلات")');
      return (await p.locator(".card.group:has-text('وصل للمدير')").count()) > 0;
    },
    120_000
  );
  log(`✓ phone shows the day in previous assessments (${t5}s)`);
  await p.click(".seg button:has-text('سجل الحضور')");
  check((await p.locator("table.log tbody tr").count()) === n, "attendance log rows");
  await p.click('nav.tabbar button:has-text("جدولي")');
  check((await p.locator(".dayc.ok").count()) >= 1 || (await p.locator("details.stint").count()) > 0, "schedule");
  await p.click('nav.tabbar button:has-text("طلابي")');
  check((await p.locator(".student").count()) === 120, "120 students");

  await phone.ctx.setOffline(true);
  await p.click('nav.tabbar button:has-text("السجلات")');
  await p.click(".seg button:has-text('التقييمات السابقة')");
  await p.locator(".card.group").first().click();
  await p.waitForSelector(".review"); // a validated day opens on its review (تقييم اليوم)
  check((await p.locator("button:has-text('اعتماد اليوم')").count()) === 0, "no validate button on a validated day");
  await p.locator(".review .name-btn").first().click();
  await p.waitForSelector(".scard");
  check((await p.locator(".scard button.choice:not([disabled])").count()) === 0, "validated day is read-only");
  // Each file is opened and read back: names, the unit, and grades only in the filled ones.
  const download = async (menu: string, item: string) => {
    await p.click(menu);
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click(`.dl-item:has-text("${item}")`)]);
    const f = path.join(out, dl.suggestedFilename());
    await dl.saveAs(f);
    return f;
  };
  const sheetText = async (f: string) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(f);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : String(v)))));
    return rows;
  };
  const studentName = (await p.locator(".picker .pick.on").getAttribute("title")) ?? ""; // the open card: the group's first student
  for (const [item, filled] of [["التقييم اليومي — Excel", true], ["قالب فارغ للطباعة — Excel", false]] as const) {
    const rows = await sheetText(await download(".day-head .dl > button", item));
    const student = rows.find((r) => r[1] === studentName);
    check(!!student, `${item}: ${studentName} listed`);
    check(student![2].includes("العناية"), `${item}: the unit beside the hospital (got "${student![2]}")`);
    check(rows.filter((r) => /^طالب/.test(r[1] ?? "")).length === n, `${item}: ${n} students`);
    const totals = rows.filter((r) => /^طالب/.test(r[1] ?? "")).map((r) => r[r.length - 2]);
    check(filled ? totals.some((t) => Number(t) > 0) : totals.every((t) => t === ""), `${item}: totals ${filled ? "filled" : "empty"}`);
  }
  for (const [item, filled] of [["التقييم اليومي — Word", true], ["قالب فارغ للطباعة — Word", false]] as const) {
    const f = await download(".day-head .dl > button", item);
    const xml = await (await JSZip.loadAsync(fs.readFileSync(f))).file("word/document.xml")!.async("string");
    check(xml.includes(studentName) && xml.includes("العناية"), `${item}: names and units in the document`);
    check(xml.includes("حاضر") === filled, `${item}: attendance ${filled ? "filled" : "empty"}`);
  }
  log("✓ phone offline: the day's Excel and Word (filled and blank) open with names, units and grades");

  await p.click(".day-head .back");
  await p.click('nav.tabbar button:has-text("السجلات")');
  await p.click(".seg button:has-text('التقييمات السابقة')");
  const history = await sheetText(await download(".dl > button", "التقييمات السابقة — Excel"));
  check(history.filter((r) => /^طالب/.test(r[4] ?? "")).length === n, "previous assessments Excel: one row per graded student");
  await p.click(".seg button:has-text('سجل الحضور')");
  const attendance = await sheetText(await download(".dl > button", "سجل حضور"));
  check(attendance.filter((r) => /^طالب/.test(r[1] ?? "")).length === n && attendance.some((r) => r.includes("غائب")), "attendance Excel: every student, the absence marked");
  await p.click('nav.tabbar button:has-text("جدولي")');
  const sched = await sheetText(await download(".dl > button", "الجدول الكامل — Excel"));
  check(sched.filter((r) => /^مستشفى /.test(r[0] ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(r[7] ?? "")).length >= 5, `schedule Excel: the days at the hospital (${JSON.stringify(sched.slice(0, 5))})`);
  await p.click('nav.tabbar button:has-text("طلابي")');
  const studentsFile = await sheetText(await download(".dl > button", "سجل الطلاب — Excel"));
  check(studentsFile.filter((r) => /^طالب/.test(r[1] ?? "")).length === 120, "students Excel: 120 students");
  await phone.ctx.setOffline(false);
  log("✓ phone offline: previous assessments, attendance, schedule and students Excel files open with their rows");

  // ---- desktop: grading center and self-check ----
  await d.click("nav >> text=مركز الدرجات");
  // opens on the grading matrix (التصميم المدمج); the list is one tab away
  await d.waitForSelector("main >> text=التصميم المدمج", { timeout: 30_000 });
  // The day's grades show in a grid cell, or (graded on a date the schedule
  // doesn't list) in the "outside the schedule" note — in one of the programs.
  const shown = async () => {
    for (const prog of ["البرنامج الصباحي", "البرنامج المسائي"]) {
      await d.click(`main [role=tab] >> text=${prog}`);
      const txt = await d.locator("main").innerText();
      if (txt.includes(`${n} تقييمًا معتمدًا في أيام خارج جدول الدوران`) || !/مُقيَّم 0 من/.test(txt)) return true;
    }
    return false;
  };
  if (!(await shown())) {
    console.log("grading matrix shows:", (await d.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600));
    throw new Error("the validated day is not in the grading matrix");
  }
  await d.screenshot({ path: path.join(process.env.EVA_E2E_SHOTS ?? out, "grading-matrix.png"), fullPage: true });
  for (const v of ["الشبكة الدورانية", "الخريطة الحرارية"]) {
    await d.click(`main [role=tab] >> text=${v}`);
    await d.waitForSelector("main >> text=SMP-001");
    await d.screenshot({ path: path.join(process.env.EVA_E2E_SHOTS ?? out, `grading-${v === "الشبكة الدورانية" ? "rotation" : "heatmap"}.png`), fullPage: true });
  }
  await d.click("main [role=tab] >> text=قائمة التقييمات");
  await d.waitForSelector("main table tbody tr:has-text('Noor E2E')", { timeout: 30_000 }).catch(async (e) => {
    console.log("grading center shows:", (await d.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600));
    await d.screenshot({ path: path.join(process.cwd(), "e2e-fail-grading.png") });
    throw e;
  });
  await d.click("nav >> text=النظام");
  await d.waitForSelector(".checks li");
  const checks = await d.locator(".checks li").count();
  log(`✓ desktop: grades in the grading center; self-check shows ${checks} checks`);

  errors.push(...desk.errors, ...phone.errors);
  const integrity = db.pragma("integrity_check", { simple: true });
  check(integrity === "ok", "database integrity");
  if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
  log("✓ integrity ok, no page errors");
  await phone.ctx.close();
  await d.close();
  db.close();
}
