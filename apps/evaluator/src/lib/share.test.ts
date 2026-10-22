import { describe, expect, it } from "vitest";
import { checkShare, type EvaluatorBundle, type GuestInfo } from "@eva/core/sync/contract";
import { QUIZ_ITEM_ID } from "@eva/core/grading/scoring";
import { buildSubmission, dayBundle, maxTotal, rowTotal, type Draft } from "./day";
import { assignmentsOf, buildShare, compareShare, mergeShare } from "./share";

const bundle: EvaluatorBundle = {
  format: 1, version: "v1", generatedAt: "t", evaluator: { id: "e1", name: "د. سارة" },
  course: { id: "c1", label: "دورة", startDate: "2026-10-04" },
  hospitals: [{ id: "h1", name: "مستشفى اليرموك" }],
  groups: [{ id: "g1", name: "المجموعة الصباحية 1", shift: "MORNING", students: ["s1", "s2", "s3", "s4"].map((id, i) => ({ id, name: `طالب ${i + 1}`, universityNumber: String(i + 1) })) }],
  stints: [{ groupId: "g1", hospitalId: "h1", hospitalName: "مستشفى اليرموك", startDate: "2026-10-04", endDate: "2026-10-15", daysOfWeek: "SUN,MON,TUE,WED,THU" }],
  rubric: [
    { id: "rs0", labelAr: "الملاحظة اليومية", maxScore: 5, items: [{ id: "dn", labelAr: "الملاحظة اليومية", maxScore: 5, kind: "number" }] },
    {
      id: "rs1", labelAr: "المناقشة", maxScore: 7,
      items: [
        { id: "gd", labelAr: "مناقشة جماعية", labelEn: "Group discussion", maxScore: 3.5, kind: "number" },
        { id: "cd", labelAr: "مناقشة الحالة", labelEn: "Case discussion", maxScore: 3.5, kind: "number" },
      ],
    },
  ],
};
const row = (attendance: "present" | "late" | "absent" | null, scores: Record<string, number> = {}, dailyNote: boolean | null = null) => ({ attendance, dailyNote, scores, touched: Object.keys(scores).length > 0 });
const draft = (rows: Draft["rows"], over: Partial<Draft> = {}): Draft => ({ key: "g1:2026-10-05", groupId: "g1", dateISO: "2026-10-05", rows, status: "draft", updatedAt: "t", ...over });
const guest: GuestInfo = { kind: "same-shift", homeGroupId: null, homeGroupName: "المجموعة الصباحية 2", shift: "MORNING", name: "ضيف", universityNumber: "99" };
const now = new Date("2026-10-05T10:00:00Z");

describe("modified scoring on the phone", () => {
  it("grades the day out of the same total, with the quiz, and sends the mode", () => {
    const b = dayBundle(bundle, "modified");
    expect(b.rubric[1].items.map((i) => [i.id, i.maxScore])).toEqual([["gd", 2.5], ["cd", 2.5], [QUIZ_ITEM_ID, 2]]);
    expect(maxTotal(b)).toBe(maxTotal(bundle));
    expect(rowTotal(b, row("present", { dn: 5, gd: 2.25, cd: 2.5, [QUIZ_ITEM_ID]: 1.75 }))).toBe(11.5);
    const d = draft({ s1: row("present", { gd: 2 }), s2: row("absent"), s3: row("absent"), s4: row("absent") }, { scoring: "modified" });
    expect(buildSubmission(b, d, "c", now).scoring).toBe("modified");
    expect(buildSubmission(bundle, { ...d, scoring: undefined }, "c", now).scoring).toBeUndefined();
  });
});

describe("shares between colleagues", () => {
  it("sends only students with something entered, hosted students included, in a shape the relay accepts", () => {
    const d = draft({ s1: row("present", { cd: 3 }), s2: row(null), g9: row(null, { gd: 2 }) }, { guests: { g9: guest } });
    const share = buildShare(bundle, d, { id: "sh1", toId: "e2", message: " حالة اليوم ", now });
    expect(share.records.map((r) => r.studentId)).toEqual(["s1", "g9"]);
    expect(share.records[1].guest?.name).toBe("ضيف");
    expect(share.message).toBe("حالة اليوم");
    expect(checkShare(share)).toBeNull();
  });

  it("compares student by student: new, same, fills, differs, unknown", () => {
    const share = buildShare(bundle, draft({ s1: row("present", { cd: 3 }), s2: row("present", { cd: 3 }), s3: row("late", { cd: 2 }), s4: row("present", { dn: 4 }) }), { id: "x", toId: "e2", now });
    share.records.push({ studentId: "stranger", attendance: "present", dailyNote: null, scores: {} });
    const mine = draft({ s2: row("present", { cd: 3 }), s3: row("present", { cd: 2 }), s4: row("present", { gd: 1 }) });
    expect(compareShare(bundle, share, mine).map((l) => [l.studentId, l.state])).toEqual([
      ["s1", "new"], ["s2", "same"], ["s3", "differs"], ["s4", "fills"], ["stranger", "unknown"],
    ]);
  });

  it("merging fills only what is empty unless asked to replace, and adds hosted students", () => {
    const share = buildShare(bundle, draft({ s1: row("present", { cd: 3, gd: 2 }, true), g9: row("present", { cd: 1 }) }, { guests: { g9: guest } }), { id: "x", toId: "e2", now });
    const mine = draft({ s1: row("late", { gd: 3 }) });
    const pick = new Set(["s1", "g9"]);
    const filled = mergeShare(bundle, mine, share, { pick, replace: false, scoring: "standard", now });
    expect(filled.rows.s1).toMatchObject({ attendance: "late", dailyNote: true, scores: { gd: 3, cd: 3 }, touched: true });
    expect(filled.guests?.g9?.name).toBe("ضيف");
    expect(filled.rows.g9.scores).toEqual({ cd: 1 });
    const replaced = mergeShare(bundle, mine, share, { pick, replace: true, scoring: "standard", now });
    expect(replaced.rows.s1).toMatchObject({ attendance: "present", scores: { gd: 2, cd: 3 } });
    const none = mergeShare(bundle, mine, share, { pick: new Set(), replace: true, scoring: "standard", now });
    expect(none.rows).toEqual(mine.rows);
  });

  it("starts a draft when there is none, and converts both sides to the day's scoring", () => {
    const share = buildShare(bundle, draft({ s1: row("present", { gd: 2, [QUIZ_ITEM_ID]: 2 }) }, { scoring: "modified" }), { id: "x", toId: "e2", now });
    const fresh = mergeShare(bundle, null, share, { pick: new Set(["s1"]), replace: false, scoring: "modified", now });
    expect(fresh).toMatchObject({ key: "g1:2026-10-05", status: "draft", scoring: "modified" });
    expect(fresh.rows.s1.scores).toEqual({ gd: 2, [QUIZ_ITEM_ID]: 2 });
    const mine = draft({ s2: row("present", { gd: 3.5 }) });
    const merged = mergeShare(bundle, mine, share, { pick: new Set(["s1"]), replace: false, scoring: "modified", now });
    expect(merged.rows.s2.scores.gd).toBe(2.5); // lowered to the modified maximum
    const standard = mergeShare(bundle, mine, share, { pick: new Set(["s1"]), replace: false, scoring: "standard", now });
    expect(standard.rows.s1.scores).toEqual({ gd: 2 }); // the quiz goes
    expect(standard.scoring).toBeUndefined();
  });

  it("keeps a share's assignments with who sent them", () => {
    const share = buildShare(bundle, draft({}), {
      id: "x", toId: "e2", now,
      assignments: [{ id: "a1", studentId: "s1", studentName: "طالب 1", universityNumber: "1", title: "خطة رعاية", dateISO: "2026-10-05" }],
    });
    expect(share.records).toEqual([]);
    expect(checkShare({ ...share, fromName: "د. سارة" })).toBeNull();
    expect(assignmentsOf({ ...share, fromName: "د. سارة" }, now)).toMatchObject([{ id: "a1", groupId: "g1", from: "د. سارة", title: "خطة رعاية" }]);
  });
});
