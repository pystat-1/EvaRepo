import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DaySubmission } from "@eva/core/sync/contract";
import * as t from "../schema";
import { applyConflictAnyway, applyDaySubmission, buildPublication, inbox, markReported, phoneSignIns, recordPhoneSignIns, unreportedResults } from "./sync";
import { listEvaluations } from "./grading";
import { IDS, groupId, seeded } from "./testSeed";

const full = { "ri-dailynote": 4.5, "ri-gdisc": 3.25, "ri-cdisc": 3, "ri-staff": 0.25, "ri-std": 0.25, "ri-late": 0.25, "ri-badge": 0.25 };

function day(over: Partial<DaySubmission> = {}): DaySubmission {
  return {
    clientId: "c-1",
    kind: "day",
    evaluatorId: IDS.evaluators[0], // سارة @ اليرموك
    groupId: groupId("MORNING", 1), // at اليرموك weeks 1-2 (from 2026-10-04)
    dateISO: "2026-10-04",
    bundleVersion: "v",
    validatedAt: "2026-10-04T12:00:00Z",
    records: [
      { studentId: "s1", attendance: "present", dailyNote: true, scores: full, notes: "ممتاز" },
      { studentId: "s2", attendance: "absent", dailyNote: null, scores: {} },
    ],
    ...over,
  };
}
const pulled = (submission: DaySubmission, seq = 1) => ({ seq, receivedAt: "2026-10-04T12:01:00Z", submission });

describe("buildPublication", () => {
  it("gives each evaluator their hospital's groups, students, stints and the rubric", async () => {
    const r = await seeded(2);
    const { evaluators, bundles } = await buildPublication(r);
    expect(evaluators.map((e) => e.email).sort()).toEqual(["ali@x.iq", "sara@x.iq"]);
    const sara = bundles.find((b) => b.evaluator.id === IDS.evaluators[0])!;
    expect(sara.hospitals.map((h) => h.name)).toEqual(["مستشفى اليرموك"]);
    expect(sara.groups).toHaveLength(6); // every group visits every hospital
    expect(sara.groups[0].name).toBe("المجموعة الصباحية 1");
    expect(sara.groups[0].students.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(new Set(sara.stints.map((s) => s.hospitalId))).toEqual(new Set([IDS.hospitals[0]]));
    expect(sara.rubric.map((s) => s.items.length)).toEqual([1, 2, 4, 4, 4]);
  });

  it("version changes only when the content changes", async () => {
    const r = await seeded(1);
    const v1 = (await buildPublication(r)).bundles[0].version;
    expect((await buildPublication(r)).bundles[0].version).toBe(v1);
    await r.db.update(t.students).set({ nameAr: "اسم جديد" }).where(eq(t.students.id, "s1"));
    expect((await buildPublication(r)).bundles[0].version).not.toBe(v1);
  });

  it("publishes emails and names only (no password hashes)", async () => {
    const r = await seeded(0);
    await r.db.update(t.accounts).set({ passwordHash: "$2b$10$old-website-hash" }).where(eq(t.accounts.id, IDS.evaluators[0]));
    const sara = (await buildPublication(r)).evaluators.find((e) => e.id === IDS.evaluators[0])!;
    expect(sara).toEqual({ id: IDS.evaluators[0], email: "sara@x.iq", name: "د. سارة", active: true });
  });

  it("records phone sign-ins; an email-only evaluator takes the Google name", async () => {
    const r = await seeded(0);
    await r.db.update(t.accounts).set({ name: "ali" }).where(eq(t.accounts.id, IDS.evaluators[1])); // added as ali@x.iq, no name
    const renamed = await recordPhoneSignIns(r, [
      { id: IDS.evaluators[0], googleName: "Sara Google", lastLoginAt: "2026-10-01T08:00:00Z", lastSeenAt: null },
      { id: IDS.evaluators[1], googleName: "Ali  Al-Rubaie", lastLoginAt: "2026-10-01T09:00:00Z", lastSeenAt: null },
    ]);
    const [sara, ali] = await Promise.all(IDS.evaluators.map(async (id) => (await r.db.select().from(t.accounts).where(eq(t.accounts.id, id)))[0]));
    expect(sara.name).toBe("د. سارة"); // a name the admin typed is kept
    expect(ali.name).toBe("Ali Al-Rubaie");
    expect(renamed).toBe(1);
    expect((await phoneSignIns(r)).get(IDS.evaluators[1])?.lastLoginAt).toBe("2026-10-01T09:00:00Z");
  });
});

describe("applyDaySubmission", () => {
  it("applies a validated day in one go: grades, attendance, work day, inbox", async () => {
    const r = await seeded(2);
    const res = await applyDaySubmission(r, pulled(day()));
    expect(res).toEqual({ clientId: "c-1", outcome: "applied", message: "اعتُمد 2 تقييم" });
    const rows = await listEvaluations(r, { groupId: groupId("MORNING", 1) });
    const s1 = rows.find((x) => x.studentId === "s1")!;
    expect(s1).toMatchObject({ attendance: "present", total: 4.5 + 6.25 + 0.5 + 0.25 + 0.25, hospitalName: "مستشفى اليرموك", notes: "ممتاز" });
    expect(s1.sections).toEqual({ rs0: 4.5, rs1: 6.25, rs2: 0.5, rs3: 0.25, rs4: 0.25 });
    expect(rows.find((x) => x.studentId === "s2")).toMatchObject({ attendance: "absent", total: 0 });
    const [wd] = await r.db.select().from(t.groupWorkDays);
    expect(wd).toMatchObject({ dateISO: "2026-10-04", scheduled: true });
    expect(wd.validatedAt).toBeTruthy();
    const [att] = await r.db.select().from(t.attendanceRecords).where(eq(t.attendanceRecords.studentId, "s1"));
    expect(att).toMatchObject({ status: "present", dailyNote: true });
  });

  it("is idempotent: the same clientId again changes nothing", async () => {
    const r = await seeded(2);
    await applyDaySubmission(r, pulled(day()));
    const again = await applyDaySubmission(r, pulled(day({ records: [{ studentId: "s1", attendance: "late", dailyNote: false, scores: {} }] })));
    expect(again.outcome).toBe("applied");
    const [s1] = await r.db.select().from(t.evaluations).where(eq(t.evaluations.studentId, "s1"));
    expect(s1.attendance).toBe("present"); // the repeat was not re-applied
    expect(await r.db.select().from(t.evaluations)).toHaveLength(2);
  });

  it("rejects out-of-scope, outsiders and invalid scores, applying nothing", async () => {
    const r = await seeded(2);
    expect((await applyDaySubmission(r, pulled(day({ clientId: "a", dateISO: "2027-03-01" })))).message).toMatch(/ليست في مستشفيات/);
    expect((await applyDaySubmission(r, pulled(day({ clientId: "b", records: [{ studentId: "s3", attendance: "present", dailyNote: null, scores: {} }] })))).message).toMatch(/ليس في هذه المجموعة/);
    expect((await applyDaySubmission(r, pulled(day({ clientId: "c", records: [{ studentId: "s1", attendance: "present", dailyNote: null, scores: { "ri-pat": 0.1 } }] })))).message).toMatch(/درجات غير صالحة/);
    expect((await applyDaySubmission(r, pulled(day({ clientId: "d", evaluatorId: "nobody" })))).message).toMatch(/غير فعّال/);
    expect(await r.db.select().from(t.evaluations)).toHaveLength(0);
    expect((await inbox(r, "rejected")).map((x) => x.clientId).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("holds a second evaluator's day as a conflict until the admin decides", async () => {
    const r = await seeded(2);
    // 2026-10-18: morning 1 is at مدينة الطب (علي); سارة may still grade it as an off-schedule day.
    const sara = await applyDaySubmission(r, pulled(day({ clientId: "sara", dateISO: "2026-10-18" })));
    expect(sara).toMatchObject({ outcome: "applied", message: "اعتُمد 2 تقييم (يوم خارج الجدول)" });
    const ali = await applyDaySubmission(r, pulled(day({ clientId: "ali", evaluatorId: IDS.evaluators[1], dateISO: "2026-10-18" }), 2));
    expect(ali.outcome).toBe("conflict");
    let [s1] = await r.db.select().from(t.evaluations).where(eq(t.evaluations.studentId, "s1"));
    expect(s1.evaluatorId).toBe(IDS.evaluators[0]); // unchanged until the admin decides

    const decided = await applyConflictAnyway(r, "ali");
    expect(decided).toMatchObject({ outcome: "applied", message: "طُبّق بقرار المدير (استُبدل 2 تقييم)" });
    [s1] = await r.db.select().from(t.evaluations).where(eq(t.evaluations.studentId, "s1"));
    expect(s1.evaluatorId).toBe(IDS.evaluators[1]);
    expect(await r.db.select().from(t.evaluations)).toHaveLength(2);
  });

  it("tracks which outcomes still need reporting to the relay", async () => {
    const r = await seeded(2);
    await applyDaySubmission(r, pulled(day()));
    await applyDaySubmission(r, pulled(day({ clientId: "x", dateISO: "2027-03-01" }), 2));
    expect((await unreportedResults(r)).map((x) => x.clientId).sort()).toEqual(["c-1", "x"]);
    await markReported(r, ["c-1"]);
    expect((await unreportedResults(r)).map((x) => x.clientId)).toEqual(["x"]);
  });
});
