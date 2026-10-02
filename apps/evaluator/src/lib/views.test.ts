import { describe, expect, it } from "vitest";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { dayEntries, mergeBlocks, schedule, stintDates, studentSummaries } from "./views";
import type { Draft } from "./day";

const block = (groupId: string, startDate: string, endDate: string) => ({ groupId, hospitalId: "h1", hospitalName: "مستشفى اليرموك", startDate, endDate, daysOfWeek: "SUN,MON,TUE,WED,THU" });
const bundle = {
  format: 1, version: "v", generatedAt: "t",
  evaluator: { id: "me", name: "سارة" },
  course: { id: "c", label: "دورة", startDate: "2026-10-04" },
  hospitals: [{ id: "h1", name: "مستشفى اليرموك" }],
  groups: [{ id: "g1", name: "المجموعة 1", shift: "MORNING", students: [{ id: "s1", name: "علي", universityNumber: "1" }, { id: "s2", name: "زهراء", universityNumber: "2" }] }],
  stints: [block("g1", "2026-10-04", "2026-10-08"), block("g1", "2026-10-11", "2026-10-15")],
  rubric: [{ id: "r1", labelAr: "الأداء", maxScore: 10, items: [] }],
  history: [
    {
      groupId: "g1", dateISO: "2026-10-04", hospitalId: "h1", evaluatorId: "other", evaluatorName: "علي",
      records: [
        { studentId: "s1", attendance: "present", dailyNote: true, total: 8, sections: { r1: 8 }, items: null },
        { studentId: "s2", attendance: "absent", dailyNote: null, total: 0, sections: {}, items: null },
      ],
    },
  ],
} as EvaluatorBundle;
const validated: Draft = {
  key: "g1:2026-10-05", groupId: "g1", dateISO: "2026-10-05", status: "validated", clientId: "c1", updatedAt: "t",
  rows: { s1: { attendance: "late", dailyNote: false, scores: { r1: 6 }, touched: true }, s2: { attendance: "present", dailyNote: true, scores: { r1: 12 }, touched: true } },
};

describe("phone views", () => {
  it("lists meeting days and merges back-to-back blocks", () => {
    expect(stintDates(block("g1", "2026-10-04", "2026-10-10"))).toEqual(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(mergeBlocks(bundle.stints)).toEqual([block("g1", "2026-10-04", "2026-10-15")]);
  });

  it("merges the desktop's history with days validated on the phone", () => {
    const entries = dayEntries(bundle, [validated], []);
    expect(entries.map((e) => [e.dateISO, e.mine, e.state])).toEqual([["2026-10-05", true, "pending"], ["2026-10-04", false, "applied"]]);
    expect(entries[0].records.get("s2")).toMatchObject({ total: 10, sections: { r1: 10 } }); // capped at the section max
  });

  it("marks the schedule and summarises students", () => {
    const entries = dayEntries(bundle, [validated], []);
    const [h] = schedule(bundle, entries, [], "2026-10-07");
    expect(h.stints).toHaveLength(1);
    const marks = h.stints[0].weeks.flat().map((d) => d.mark);
    expect(marks.slice(0, 5)).toEqual(["colleague", "done", "missed", "today", "future"]);
    const [ali, zahraa] = studentSummaries(bundle, entries);
    expect(ali).toMatchObject({ present: 1, late: 1, absent: 0, notes: 1, average: 7 });
    expect(zahraa).toMatchObject({ present: 1, absent: 1, average: 10 });
  });
});
