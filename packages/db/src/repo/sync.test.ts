import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { DaySubmission } from "@eva/core/sync/contract";
import * as t from "../schema";
import { applyConflictAnyway, applyDaySubmission, buildPublication, inbox, markReported, phoneSignIns, recordPhoneSignIns, unreportedResults } from "./sync";
import { listEvaluations } from "./grading";
import { saveEvaluator } from "./evaluators";
import { IDS, addEvaluation, groupId, seeded } from "./testSeed";

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

  it("rejects outsiders, invalid scores and inactive evaluators, applying nothing", async () => {
    const r = await seeded(2);
    // a group the evaluator never covers (no rotation at their hospital)
    await r.db.update(t.rotationBlocks).set({ active: false }).where(and(eq(t.rotationBlocks.groupId, groupId("MORNING", 1)), eq(t.rotationBlocks.hospitalId, IDS.hospitals[0])));
    expect((await applyDaySubmission(r, pulled(day({ clientId: "a" })))).message).toMatch(/ليست في مستشفيات/);
    await r.db.update(t.rotationBlocks).set({ active: true });
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

describe("bundle history", () => {
  it("carries validated days to the evaluators of that hospital only", async () => {
    const r = await seeded(2);
    await applyDaySubmission(r, pulled(day()));
    const { bundles } = await buildPublication(r);
    const sara = bundles.find((b) => b.evaluator.id === IDS.evaluators[0])!;
    const ali = bundles.find((b) => b.evaluator.id === IDS.evaluators[1])!;
    expect(sara.history).toHaveLength(1);
    const [d] = sara.history!;
    expect(d).toMatchObject({ groupId: groupId("MORNING", 1), dateISO: "2026-10-04", evaluatorName: "د. سارة" });
    const s1 = d.records.find((x) => x.studentId === "s1")!;
    expect(s1).toMatchObject({ attendance: "present", dailyNote: true, total: 11.75, notes: "ممتاز" });
    expect(Object.keys(s1.sections)).toHaveLength(5);
    expect(s1.items).toMatchObject(full); // plus zeros for items left empty
    expect(d.records.find((x) => x.studentId === "s2")).toMatchObject({ attendance: "absent", dailyNote: null, total: 0 });
    expect(ali.history).toEqual([]); // another hospital
  });
});

describe("dates never limit grading", () => {
  it("applies a day months away from the rotation, recorded as off-schedule on its real date", async () => {
    const r = await seeded(2);
    const res = await applyDaySubmission(r, pulled(day({ clientId: "far", dateISO: "2027-03-01" })));
    expect(res).toMatchObject({ outcome: "applied", message: "اعتُمد 2 تقييم (يوم خارج الجدول)" });
    const [wd] = await r.db.select().from(t.groupWorkDays);
    expect(wd).toMatchObject({ dateISO: "2027-03-01", scheduled: false });
  });
});

describe("supervisors", () => {
  async function withSupervisor() {
    const r = await seeded(2);
    const id = await saveEvaluator(r, { name: "عمار", email: "boss@x.iq", supervisor: true }); // no assignments of their own
    return { r, id };
  }

  it("get the whole course and the team, without assignments of their own", async () => {
    const { r, id } = await withSupervisor();
    await recordPhoneSignIns(r, [{ id: IDS.evaluators[0], googleName: "Sara G", lastLoginAt: "2026-10-01T08:00:00Z", lastSeenAt: "2026-10-02T08:00:00Z" }]);
    const { bundles } = await buildPublication(r);
    const boss = bundles.find((b) => b.evaluator.id === id)!;
    expect(boss.evaluator.supervisor).toBe(true);
    expect(boss.hospitals).toHaveLength(3);
    expect(boss.groups).toHaveLength(6);
    expect(new Set(boss.stints.map((s) => s.hospitalId)).size).toBe(3);
    const team = new Map(boss.team!.map((m) => [m.email, m]));
    expect([...team.keys()].sort()).toEqual(["ali@x.iq", "boss@x.iq", "sara@x.iq"]);
    expect(team.get("sara@x.iq")).toMatchObject({ covers: [{ hospitalName: "مستشفى اليرموك", groupName: null }], phone: { googleName: "Sara G" }, supervisor: false });
    expect(team.get("boss@x.iq")).toMatchObject({ supervisor: true, covers: [], phone: null });
    // An ordinary evaluator's bundle has no team and stays in their hospital.
    const sara = bundles.find((b) => b.evaluator.id === IDS.evaluators[0])!;
    expect(sara.team).toBeUndefined();
    expect(sara.evaluator.supervisor).toBeUndefined();
  });

  it("see every evaluator's graded days and may grade any group", async () => {
    const { r, id } = await withSupervisor();
    // Neither has an assignment: only the supervisor's day is accepted.
    const plain = await saveEvaluator(r, { email: "plain@x.iq" });
    const other = day({ clientId: "c-other", evaluatorId: plain, groupId: groupId("MORNING", 2), records: [{ studentId: "s3", attendance: "present", dailyNote: true, scores: full }, { studentId: "s4", attendance: "absent", dailyNote: null, scores: {} }] });
    expect((await applyDaySubmission(r, pulled(other))).outcome).toBe("rejected");
    expect((await applyDaySubmission(r, pulled({ ...other, clientId: "c-boss", evaluatorId: id }, 2))).outcome).toBe("applied");
    await applyDaySubmission(r, pulled(day(), 3)); // Sara's own day at اليرموك
    const boss = (await buildPublication(r)).bundles.find((b) => b.evaluator.id === id)!;
    expect(boss.history!.map((h) => `${h.groupId}:${h.evaluatorId}`).sort()).toEqual([`${groupId("MORNING", 1)}:${IDS.evaluators[0]}`, `${groupId("MORNING", 2)}:${id}`].sort());
  });

  it("an evaluator saved without the flag keeps it unchanged", async () => {
    const { r, id } = await withSupervisor();
    await saveEvaluator(r, { id, name: "عمار عامر", email: "boss@x.iq" });
    expect((await r.db.select().from(t.accounts).where(eq(t.accounts.id, id)))[0].supervisor).toBe(true);
    await saveEvaluator(r, { id, email: "boss@x.iq", supervisor: false });
    expect((await r.db.select().from(t.accounts).where(eq(t.accounts.id, id)))[0].supervisor).toBe(false);
  });
});

describe("hosted students (طلاب مستضافون)", () => {
  const guest = (studentId: string, g: Partial<import("@eva/core/sync/contract").GuestInfo> = {}) => ({
    studentId,
    attendance: "present" as const,
    dailyNote: true,
    scores: full,
    guest: {
      kind: "other-shift" as const,
      homeGroupId: groupId("EVENING", 1),
      homeGroupName: "المجموعة المسائية 1",
      shift: "EVENING" as const,
      name: "طالب 7",
      universityNumber: "SMP-007",
      ...g,
    },
  });

  it("grades a registered hosted student as theirs, with the host group, and keeps the hosting", async () => {
    const r = await seeded(2);
    const sub = day({ records: [...day().records, guest("s7", { priorEvaluation: { dateISO: "2026-10-01", evaluatorName: "م. علي", total: 12 } })] });
    const res = await applyDaySubmission(r, pulled(sub));
    expect(res).toMatchObject({ outcome: "applied", message: "اعتُمد 3 تقييم (منها 1 مستضاف)" });
    const [ev] = await r.db.select().from(t.evaluations).where(and(eq(t.evaluations.studentId, "s7"), eq(t.evaluations.dateISO, "2026-10-04")));
    expect(ev).toMatchObject({ groupId: groupId("MORNING", 1), hospitalId: IDS.hospitals[0], total: 11.75 });
    const [h] = await r.db.select().from(t.hostedStudents);
    expect(h).toMatchObject({ studentId: "s7", hostGroupId: groupId("MORNING", 1), kind: "other-shift", shift: "EVENING", priorEvaluation: { dateISO: "2026-10-01", evaluatorName: "م. علي", total: 12 } });

    // The phones see the hosted student in the host group's day, and in the directory.
    const sara = (await buildPublication(r)).bundles.find((b) => b.evaluator.id === IDS.evaluators[0])!;
    const hostDay = sara.history!.find((d) => d.groupId === groupId("MORNING", 1) && d.dateISO === "2026-10-04")!;
    expect(hostDay.records.find((x) => x.studentId === "s7")?.guest?.homeGroupName).toBe("المجموعة المسائية 1");
    const s7 = sara.directory!.flatMap((g) => g.students).find((s) => s.id === "s7")!;
    expect(s7.evaluated).toEqual([{ dateISO: "2026-10-04", groupName: "المجموعة الصباحية 1", hospitalName: "مستشفى اليرموك", evaluatorName: "د. سارة", attendance: "present", total: 11.75 }]);
    expect(sara.directory!.map((g) => g.id)).toHaveLength(6); // every group of the course
  });

  it("finds the registered student by university number; keeps an unregistered one in hosted_students only", async () => {
    const r = await seeded(2);
    const sub = day({
      records: [
        ...day().records,
        guest("guest-a", { universityNumber: "SMP-008", name: "طالب 8" }),
        guest("guest-b", { universityNumber: "999", name: "طالب من خارج القائمة", homeGroupId: null, homeGroupName: "المجموعة المسائية 9" }),
      ],
    });
    expect((await applyDaySubmission(r, pulled(sub))).outcome).toBe("applied");
    expect((await r.db.select().from(t.evaluations).where(eq(t.evaluations.studentId, "s8"))).map((e) => e.total)).toEqual([11.75]);
    const hosted = await r.db.select().from(t.hostedStudents);
    expect(hosted.map((h) => [h.universityNumber, h.studentId]).sort()).toEqual([["999", null], ["SMP-008", "s8"]]);
    const evals = await r.db.select().from(t.evaluations);
    expect(evals).toHaveLength(3); // s1, s2, s8 — nothing made up for the unregistered one

    const sara = (await buildPublication(r)).bundles.find((b) => b.evaluator.id === IDS.evaluators[0])!;
    const recs = sara.history!.find((d) => d.groupId === groupId("MORNING", 1))!.records;
    expect(recs.find((x) => x.studentId === "guest-b")).toMatchObject({ total: 11.75, guest: { name: "طالب من خارج القائمة", homeGroupId: null } });

    const { listHostedStudents } = await import("./sync");
    const list = await listHostedStudents(r, IDS.course);
    expect(list.map((x) => [x.name, x.registered, x.hostGroupName, x.evaluatorName])).toEqual([
      ["طالب 8", true, "المجموعة الصباحية 1", "د. سارة"],
      ["طالب من خارج القائمة", false, "المجموعة الصباحية 1", "د. سارة"],
    ]);
  });

  it("a hosted student already graded that day in their own group waits for the manager", async () => {
    const r = await seeded(2);
    await addEvaluation(r, { id: "ev-home", studentId: "s7", dateISO: "2026-10-04", scores: [5, 7, 1, 1, 1], evaluatorId: IDS.evaluators[0], groupId: groupId("EVENING", 1) });
    const sub = day({ records: [...day().records, guest("s7")] });
    expect((await applyDaySubmission(r, pulled(sub))).outcome).toBe("conflict");
    expect(await r.db.select().from(t.hostedStudents)).toHaveLength(0);
    // The manager approves this day: the hosted grade replaces the other one.
    expect((await applyConflictAnyway(r, "c-1")).outcome).toBe("applied");
    const [ev] = await r.db.select().from(t.evaluations).where(eq(t.evaluations.studentId, "s7"));
    expect(ev.groupId).toBe(groupId("MORNING", 1));
    expect(await r.db.select().from(t.hostedStudents)).toHaveLength(1);
  });

  it("refuses a 'hosted' student who is in the group, and a group student sent without the hosted details", async () => {
    const r = await seeded(2);
    const member = day({ clientId: "m", records: [guest("x", { universityNumber: "SMP-002" })] });
    expect((await applyDaySubmission(r, pulled(member))).message).toMatch(/من هذه المجموعة أصلًا/);
    const outsider = day({ clientId: "o", records: [{ studentId: "s7", attendance: "absent", dailyNote: null, scores: {} }] });
    expect((await applyDaySubmission(r, pulled(outsider))).message).toMatch(/ليس في هذه المجموعة/);
    expect(await r.db.select().from(t.evaluations)).toHaveLength(0);
  });

  it("deleting the course removes its hosted students", async () => {
    const r = await seeded(2);
    await applyDaySubmission(r, pulled(day({ records: [...day().records, guest("s7")] })));
    const { deleteCourse } = await import("./courses");
    await deleteCourse(r, IDS.course);
    expect(await r.db.select().from(t.hostedStudents)).toHaveLength(0);
  });
});

describe("applyDaySubmission — «الدرجات المعدّلة»", () => {
  const modified = { "ri-dailynote": 5, "ri-gdisc": 2.25, "ri-cdisc": 2.5, quiz: 1.75, "ri-staff": 0.25 };

  it("applies a modified day: discussion 2.5 + 2.5 + quiz 2 in one section of 7", async () => {
    const r = await seeded(2);
    const res = await applyDaySubmission(r, pulled(day({ scoring: "modified", records: [{ studentId: "s1", attendance: "present", dailyNote: true, scores: modified }] })));
    expect(res.outcome).toBe("applied");
    const s1 = (await listEvaluations(r, { groupId: groupId("MORNING", 1) })).find((x) => x.studentId === "s1")!;
    expect(s1.sections.rs1).toBe(6.5);
    expect(s1.items?.quiz).toBe(1.75);
    expect(s1.total).toBe(11.75);
  });

  it("rejects discussion above 2.5 on a modified day, and a quiz on a standard day", async () => {
    const r = await seeded(2);
    const over = await applyDaySubmission(r, pulled(day({ scoring: "modified", records: [{ studentId: "s1", attendance: "present", dailyNote: true, scores: { ...modified, "ri-gdisc": 3 } }] })));
    expect(over.outcome).toBe("rejected");
    const stray = await applyDaySubmission(r, pulled(day({ clientId: "c-2", records: [{ studentId: "s1", attendance: "present", dailyNote: true, scores: { quiz: 2 } }] })));
    expect(stray.outcome).toBe("rejected");
  });
});

describe("criteria versions («مركز المعايير»)", () => {
  // The daily note goes from 5 to 6 and a criterion «المهارات» of 1 is added: 15 → 17.
  async function changeCriteria(r: Awaited<ReturnType<typeof seeded>>) {
    const { rubricCenter, saveRubric } = await import("./rubric");
    const { sections } = await rubricCenter(r);
    sections[0].maxScore = 6;
    sections[0].items[0].maxScore = 6;
    sections.push({ labelAr: "المهارات", labelEn: null, maxScore: 1, active: true, items: [] });
    await saveRubric(r, sections);
  }

  it("each set of criteria sent to the phones gets a number, kept across publications", async () => {
    const r = await seeded(1);
    const v1 = (await buildPublication(r)).bundles[0].rubricVersion!;
    expect(v1).toBeGreaterThan(0);
    expect((await buildPublication(r)).bundles[0].rubricVersion).toBe(v1);
    await changeCriteria(r);
    const v2 = (await buildPublication(r)).bundles[0].rubricVersion!;
    expect(v2).not.toBe(v1);
    expect(await r.db.select().from(t.rubricVersions)).toHaveLength(2);
  });

  it("a day graded before the change is accepted and kept with the criteria it was graded with", async () => {
    const r = await seeded(2);
    const v1 = (await buildPublication(r)).bundles[0].rubricVersion!;
    await changeCriteria(r);
    await buildPublication(r);

    const res = await applyDaySubmission(r, pulled(day({ rubricVersion: v1 })));
    expect(res.outcome).toBe("applied");
    const [e] = await r.db.select().from(t.evaluations).where(and(eq(t.evaluations.studentId, "s1"), eq(t.evaluations.dateISO, "2026-10-04")));
    expect(e.rubricVersion).toBe(v1);
    expect(e.total).toBe(11.75);
    const note = await r.db.select().from(t.evaluationScores).where(and(eq(t.evaluationScores.evaluationId, e.id), eq(t.evaluationScores.rubricSectionId, "rs0")));
    expect(note[0].maxScoreAtTime).toBe(5);

    // Without a version (an older phone), or one this computer never published: the current criteria.
    for (const [clientId, rubricVersion] of [["c-2", undefined], ["c-3", 999]] as const) {
      const now = await applyDaySubmission(r, pulled(day({ clientId, dateISO: "2026-10-05", rubricVersion })));
      expect(now.outcome).toBe("rejected");
      expect(now.message).toContain("المهارات");
    }

    // The Grading Center shows it out of its own 15 and scales it in averages to 17.
    const { gradeMatrix } = await import("./gradeMatrix");
    const { studentStats } = await import("@eva/core/gradeMatrix/build");
    const m = await gradeMatrix(r, IDS.course, "2026-10-20");
    expect(m.maxTotal).toBe(17);
    const s1 = m.programs[0].groups[0].students.find((s) => s.id === "s1")!;
    const d = s1.days.find((x) => x.dateISO === "2026-10-04")!;
    expect(d.max).toBe(15);
    expect(d.maxes![m.criteria.findIndex((c) => c.id === "rs0")]).toBe(5);
    const st = studentStats(s1.days, m.criteria.length, m.maxTotal, m.criteria.map((c) => c.max));
    expect(st.avg).toBeCloseTo((11.75 * 17) / 15, 5);
    expect(st.critAvg[0]).toBeCloseTo((4.5 * 6) / 5, 5); // the daily note: 4.5 of 5 → 5.4 of 6
  });
});
