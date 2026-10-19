import { describe, expect, it } from "vitest";
import type { EvaluatorBundle, GuestInfo } from "@eva/core/sync/contract";
import { checkDaySubmission } from "@eva/core/sync/contract";
import { buildSubmission, compactColumns, dayStudents, evaluatedDays, gradeColumns, groupsForDate, guestGroups, guestProblem, maxTotal, missing, overdueDrafts, rowTotal, type Draft } from "./day";

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
  it("shows the scheduled group first, and every other group of the evaluator on any date", () => {
    const gs = groupsForDate(bundle, "2026-10-05");
    expect(gs.map((g) => [g.id, g.scheduled])).toEqual([["gm1", true], ["ge3", false]]);
    expect(groupsForDate(bundle, "2027-06-01").map((g) => [g.id, g.scheduled])).toEqual([["gm1", false], ["ge3", false]]);
  });
});

describe("compactColumns", () => {
  it("folds a section of checkboxes into one cell and keeps number items", () => {
    expect(compactColumns(bundle).map((c) => [c.kind, c.id, c.max])).toEqual([["number", "dn", 5], ["checks", "rs2", 1], ["number", "rs9", 2]]);
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

describe("hosted students", () => {
  const withDirectory: EvaluatorBundle = {
    ...bundle,
    directory: [
      { id: "gm1", name: "المجموعة الصباحية 1", shift: "MORNING", students: bundle.groups[0].students },
      { id: "gm2", name: "المجموعة الصباحية 2", shift: "MORNING", students: [{ id: "s7", name: "مريم", universityNumber: "7", evaluated: [
        { dateISO: "2026-10-04", groupName: "المجموعة الصباحية 2", hospitalName: "مستشفى الكندي", evaluatorName: "م. علي", attendance: "present", total: 7 },
      ] }] },
      { id: "ge3", name: "المجموعة المسائية 3", shift: "EVENING", students: [{ id: "s3", name: "زينب", universityNumber: "3" }] },
    ],
  };
  const maryam: GuestInfo = { kind: "same-shift", homeGroupId: "gm2", homeGroupName: "المجموعة الصباحية 2", shift: "MORNING", name: "مريم", universityNumber: "7",
    priorEvaluation: { dateISO: "2026-10-04", evaluatorName: "م. علي", total: 7 } };
  const typed: GuestInfo = { kind: "other-shift", homeGroupId: null, homeGroupName: "المجموعة المسائية 9", shift: "EVENING", name: "علي حسن", universityNumber: "900" };

  it("offers the groups of the chosen study type, never the host group", () => {
    expect(guestGroups(withDirectory, "gm1", "MORNING").map((g) => g.id)).toEqual(["gm2"]);
    expect(guestGroups(withDirectory, "gm1", "EVENING").map((g) => g.id)).toEqual(["ge3"]);
    expect(guestGroups(bundle, "gm1", "MORNING")).toEqual([]); // an older bundle has no directory
  });

  it("finds the days a student was already evaluated", () => {
    expect(evaluatedDays(withDirectory, "s7").map((d) => [d.dateISO, d.total])).toEqual([["2026-10-04", 7]]);
    expect(evaluatedDays(withDirectory, "s3")).toEqual([]);
  });

  it("lists hosted students after the group, and refuses one already on the list", () => {
    const d = { ...draft({}), guests: { s7: maryam } };
    expect(dayStudents(withDirectory, "gm1", d.guests).map((s) => [s.id, !!s.guest])).toEqual([["s1", false], ["s2", false], ["s7", true]]);
    expect(guestProblem(withDirectory, "gm1", d, maryam)).toMatch(/أصلًا/);
    expect(guestProblem(withDirectory, "gm1", d, { ...typed, universityNumber: " 1 " })).toMatch(/أصلًا/); // a member of the group
    expect(guestProblem(withDirectory, "gm1", d, { ...typed, name: " " })).toMatch(/اسم/);
    expect(guestProblem(withDirectory, "gm1", d, typed)).toBeNull();
  });

  it("a hosted student must be graded too, and goes in the submission with who they are", () => {
    const rows: Draft["rows"] = {
      s1: { attendance: "present", dailyNote: true, scores: { dn: 5 }, touched: true },
      s2: { attendance: "absent", dailyNote: null, scores: {}, touched: false },
      s7: { attendance: null, dailyNote: null, scores: {}, touched: false },
      "guest-1": { attendance: "present", dailyNote: false, scores: { dn: 2 }, touched: true },
    };
    const d = { ...draft(rows), guests: { s7: maryam, "guest-1": typed } };
    expect(missing(withDirectory, "gm1", d).noAttendance).toEqual(["مريم"]);
    d.rows.s7 = { attendance: "late", dailyNote: true, scores: { dn: 4 }, touched: true };
    expect(missing(withDirectory, "gm1", d).ok).toBe(true);
    const sub = buildSubmission(withDirectory, d, "cid-2", new Date("2026-10-04T10:00:00Z"));
    expect(checkDaySubmission(sub)).toBeNull();
    expect(sub.records.map((r) => [r.studentId, r.guest?.universityNumber ?? null])).toEqual([["s1", null], ["s2", null], ["s7", "7"], ["guest-1", "900"]]);
    expect(sub.records[2].guest?.priorEvaluation).toEqual({ dateISO: "2026-10-04", evaluatorName: "م. علي", total: 7 });
  });

  it("the relay refuses a hosted student without details or twice in a day", () => {
    const base = buildSubmission(withDirectory, { ...draft({
      s1: { attendance: "absent", dailyNote: null, scores: {}, touched: false },
      s2: { attendance: "absent", dailyNote: null, scores: {}, touched: false },
    }) }, "cid-3", new Date());
    const rec = (studentId: string, guest: unknown) => ({ studentId, attendance: "absent", dailyNote: null, scores: {}, guest });
    expect(checkDaySubmission({ ...base, records: [...base.records, rec("g1", { ...typed, shift: "NIGHT" })] })).toMatch(/نوع الدراسة/);
    expect(checkDaySubmission({ ...base, records: [...base.records, rec("g1", { ...typed, universityNumber: "" })] })).toMatch(/ناقصة/);
    expect(checkDaySubmission({ ...base, records: [...base.records, rec("g1", { ...typed, priorEvaluation: { total: -1 } })] })).toMatch(/السابق/);
    expect(checkDaySubmission({ ...base, records: [...base.records, rec("g1", typed), rec("g2", typed)] })).toMatch(/مكرر/);
    expect(checkDaySubmission({ ...base, records: [...base.records, rec("g1", typed)] })).toBeNull();
  });
});
