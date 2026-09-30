import { describe, expect, it } from "vitest";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { checkDaySubmission } from "@eva/core/sync/contract";
import { buildSubmission, gradeColumns, groupsForDate, maxTotal, missing, overdueDrafts, rowTotal, type Draft } from "./day";

const bundle: EvaluatorBundle = {
  format: 1, version: "v1", generatedAt: "t", evaluator: { id: "e1", name: "د. سارة" },
  course: { id: "c1", label: "دورة", startDate: "2026-10-04" },
  hospitals: [{ id: "h1", name: "مستشفى اليرموك" }],
  groups: [
    { id: "gm1", name: "المجموعة الصباحية 1", shift: "MORNING", students: [{ id: "s1", name: "آمنة", universityNumber: "1" }, { id: "s2", name: "حسين", universityNumber: "2" }] },
    { id: "ge3", name: "المجموعة المسائية 3", shift: "EVENING", students: [{ id: "s3", name: "زينب", universityNumber: "3" }] },
  ],
  stints: [
    { groupId: "gm1", hospitalId: "h1", hospitalName: "مستشفى اليرموك", startDate: "2026-10-04", endDate: "2026-10-15", daysOfWeek: "SUN,MON,TUE,WED,THU" },
    { groupId: "ge3", hospitalId: "h1", hospitalName: "مستشفى اليرموك", startDate: "2026-10-18", endDate: "2026-10-29", daysOfWeek: "SUN,MON,TUE,WED,THU" },
  ],
  rubric: [
    { id: "rs0", labelAr: "الملاحظة اليومية", maxScore: 5, items: [{ id: "dn", labelAr: "الملاحظة اليومية", maxScore: 5, kind: "number" }] },
    { id: "rs2", labelAr: "الموقف", maxScore: 1, items: ["a", "b", "c", "d"].map((x) => ({ id: x, labelAr: x, maxScore: 0.25, kind: "check" as const })) },
    { id: "rs9", labelAr: "بند بلا فقرات", maxScore: 2, items: [] },
  ],
};

const draft = (rows: Draft["rows"]): Draft => ({ key: "gm1:2026-10-04", groupId: "gm1", dateISO: "2026-10-04", rows, status: "draft", updatedAt: "t" });

describe("groupsForDate", () => {
  it("shows the scheduled group first, and a nearby group as off-schedule", () => {
    const gs = groupsForDate(bundle, "2026-10-05");
    expect(gs.map((g) => [g.id, g.scheduled])).toEqual([["gm1", true], ["ge3", false]]);
    expect(groupsForDate(bundle, "2027-06-01")).toEqual([]);
  });
});

describe("grading", () => {
  it("builds columns from rubric items (or the section)", () => {
    expect(gradeColumns(bundle).map((c) => c.id)).toEqual(["dn", "a", "b", "c", "d", "rs9"]);
    expect(maxTotal(bundle)).toBe(8);
  });

  it("totals a row, capped per section, zero when absent", () => {
    const row = { attendance: "present" as const, dailyNote: true, scores: { dn: 4.5, a: 0.25, b: 0.25, rs9: 1.5 }, touched: true };
    expect(rowTotal(bundle, row)).toBe(6.5);
    expect(rowTotal(bundle, { ...row, attendance: "absent" })).toBe(0);
  });

  it("lists what blocks validation", () => {
    expect(missing(bundle, "gm1", draft({ s1: { attendance: "present", dailyNote: null, scores: {}, touched: false } }))).toEqual({
      noAttendance: ["حسين"], notGraded: ["آمنة"], ok: false,
    });
    const done = draft({
      s1: { attendance: "present", dailyNote: true, scores: { dn: 5 }, touched: true },
      s2: { attendance: "absent", dailyNote: null, scores: {}, touched: false },
    });
    expect(missing(bundle, "gm1", done).ok).toBe(true);
  });

  it("builds a submission the relay accepts; absent students send no scores", () => {
    const d = draft({
      s1: { attendance: "late", dailyNote: false, scores: { dn: 3 }, touched: true, notes: "  تأخر ربع ساعة " },
      s2: { attendance: "absent", dailyNote: true, scores: { dn: 5 }, touched: true },
    });
    const sub = buildSubmission(bundle, d, "cid-1", new Date("2026-10-04T10:00:00Z"));
    expect(checkDaySubmission(sub)).toBeNull();
    expect(sub.records).toEqual([
      { studentId: "s1", attendance: "late", dailyNote: false, scores: { dn: 3 }, notes: "تأخر ربع ساعة" },
      { studentId: "s2", attendance: "absent", dailyNote: null, scores: {} },
    ]);
  });

  it("finds unvalidated drafts from earlier days", () => {
    const old = { ...draft({}), dateISO: "2026-10-01" };
    const today = { ...draft({}), dateISO: "2026-10-04" };
    const sent = { ...old, status: "validated" as const };
    expect(overdueDrafts([old, today, sent], "2026-10-04")).toEqual([old]);
  });
});
