import { describe, expect, it } from "vitest";
import { countEvaluations, courseStatistics, groupGradeSheet, listEvaluations, recentAudit, studentRecord } from "./grading";
import { listEvaluators, saveEvaluator, setEvaluatorActive, setEvaluatorHospitals } from "./evaluators";
import { saveStudent } from "./students";
import { IDS, addEvaluation, groupId, seeded } from "./testSeed";

async function withGrades() {
  const r = await seeded(2); // s1,s2 in morning 1
  const g = groupId("MORNING", 1);
  await addEvaluation(r, { id: "v1", studentId: "s1", dateISO: "2026-10-04", scores: [5, 7, 1, 1, 1], groupId: g });
  await addEvaluation(r, { id: "v2", studentId: "s1", dateISO: "2026-10-05", scores: [3, 5, 1, 1, 0], groupId: g, attendance: "late" });
  await addEvaluation(r, { id: "v3", studentId: "s2", dateISO: "2026-10-04", scores: [0, 0, 0, 0, 0], groupId: g, attendance: "absent" });
  await addEvaluation(r, { id: "v4", studentId: "s2", dateISO: "2026-10-05", scores: [2, 3, 1, 1, 1], groupId: g });
  await addEvaluation(r, { id: "v5", studentId: "s2", dateISO: "2026-10-06", scores: [5, 7, 1, 1, 1], groupId: g, pending: true });
  return r;
}

describe("grades", () => {
  it("lists validated grades only, newest first, with section scores", async () => {
    const r = await withGrades();
    const rows = await listEvaluations(r, { courseId: IDS.course });
    expect(rows.map((x) => x.id)).toEqual(["v2", "v4", "v1", "v3"]); // v5 is not validated
    expect(rows.find((x) => x.id === "v1")!.sections).toEqual({ rs0: 5, rs1: 7, rs2: 1, rs3: 1, rs4: 1 });
    expect((await listEvaluations(r, { from: "2026-10-05" })).map((x) => x.id)).toEqual(["v2", "v4"]);
  });

  it("opens on the newest grades; the count, search and full list still cover everything", async () => {
    const r = await withGrades();
    const first = await listEvaluations(r, { courseId: IDS.course }, 2);
    expect(first.map((x) => x.id)).toEqual(["v2", "v4"]);
    expect(first[0].sections).toEqual({ rs0: 3, rs1: 5, rs2: 1, rs3: 1, rs4: 0 });
    expect(await countEvaluations(r, { courseId: IDS.course })).toBe(4);
    expect((await listEvaluations(r, { courseId: IDS.course, search: "طالب 1" }, 1)).map((x) => x.id).sort()).toEqual(["v1", "v2"]); // search ignores the page
  });

  it("summarises one student", async () => {
    const r = await withGrades();
    expect(await studentRecord(r, "s2")).toMatchObject({ days: 2, present: 1, absent: 1, average: 8 });
    expect(await studentRecord(r, "s1")).toMatchObject({ days: 2, present: 1, late: 1, average: 12.5 });
  });

  it("builds the group sheet (students x days)", async () => {
    const r = await withGrades();
    const sheet = await groupGradeSheet(r, groupId("MORNING", 1));
    expect(sheet.dates).toEqual(["2026-10-04", "2026-10-05"]);
    expect(sheet.students.map((s) => s.cells["2026-10-04"]?.attendance)).toEqual(["present", "absent"]);
  });

  it("computes group statistics", async () => {
    const r = await withGrades();
    const { maxTotal, groups } = await courseStatistics(r, IDS.course);
    expect(maxTotal).toBe(15);
    const m1 = groups.find((g) => g.groupId === groupId("MORNING", 1))!;
    expect(m1).toMatchObject({ students: 2, evaluations: 4, attendanceRate: 0.75, lowScoreStudents: 1 });
    expect(m1.average).toBeCloseTo((15 + 10 + 8) / 3);
  });
});

describe("evaluators", () => {
  it("adds, edits, assigns hospitals and deactivates", async () => {
    const r = await seeded(0);
    const id = await saveEvaluator(r, { name: "د. نور", email: "Noor@X.iq" });
    await expect(saveEvaluator(r, { name: "x", email: "noor@x.iq" })).rejects.toThrow(/مستخدم/);
    await setEvaluatorHospitals(r, id, IDS.course, [IDS.hospitals[1], IDS.hospitals[2]]);
    await setEvaluatorHospitals(r, id, IDS.course, [IDS.hospitals[2]]);
    let noor = (await listEvaluators(r)).find((e) => e.id === id)!;
    expect(noor.email).toBe("noor@x.iq");
    expect(noor.hospitals.map((h) => h.hospitalName)).toEqual(["مستشفى العلوية"]);
    await setEvaluatorActive(r, id, false);
    noor = (await listEvaluators(r)).find((e) => e.id === id)!;
    expect(noor.active).toBe(false);
  });

  it("records every change in the audit log", async () => {
    const r = await seeded(0);
    await saveStudent(r, { universityNumber: "1", nameAr: "أ", groupId: null });
    await saveEvaluator(r, { name: "ب", email: "b@x.iq" });
    const log = await recentAudit(r);
    expect(log.map((a) => a.entityType).sort()).toEqual(["Evaluator", "Student"]);
  });
});
