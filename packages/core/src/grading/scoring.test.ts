import { describe, expect, it } from "vitest";
import { applyItemScores } from "./validation";
import { QUIZ_ITEM_ID, canModify, convertScores, rubricFor, scoringOf } from "./scoring";

const rubric = [
  { id: "rs0", labelAr: "الملاحظة اليومية", maxScore: 5, items: [{ id: "dn", labelAr: "الملاحظة اليومية", maxScore: 5, kind: "number" as const }] },
  {
    id: "rs1",
    labelAr: "المناقشة والتغذية الراجعة",
    maxScore: 7,
    items: [
      { id: "g", labelAr: "مناقشة جماعية", labelEn: "Group discussion", maxScore: 3.5, kind: "number" as const },
      { id: "c", labelAr: "مناقشة الحالة", labelEn: null, maxScore: 3.5, kind: "number" as const },
    ],
  },
];

describe("modified scoring", () => {
  it("splits discussion 2.5 + 2.5 and adds a 2-mark quiz after case discussion", () => {
    const m = rubricFor(rubric, "modified");
    expect(m[1].items.map((i) => [i.id, i.maxScore])).toEqual([
      ["g", 2.5],
      ["c", 2.5],
      [QUIZ_ITEM_ID, 2],
    ]);
    expect(m[1].maxScore).toBe(7);
    expect(m[0]).toBe(rubric[0]);
    expect(rubricFor(rubric, "standard")).toBe(rubric);
    expect(rubricFor(rubric, undefined)).toBe(rubric);
  });

  it("is only offered when the rubric has both discussions", () => {
    expect(canModify(rubric)).toBe(true);
    expect(canModify([rubric[0]])).toBe(false);
    expect(rubricFor([rubric[0]], "modified")).toEqual([rubric[0]]);
  });

  it("validates against the derived rubric: quiz counts, 3.5 discussion does not", () => {
    const m = rubricFor(rubric, "modified");
    expect(applyItemScores({}, { dn: 5, g: 2.25, c: 2.5, [QUIZ_ITEM_ID]: 1.75 }, m).scores).toEqual({ rs0: 5, rs1: 6.5 });
    expect(() => applyItemScores({}, { g: 3.5 }, m)).toThrow();
    // Standard ignores a stray quiz score.
    expect(applyItemScores({}, { g: 3.5, c: 3.5, [QUIZ_ITEM_ID]: 2 }, rubric).scores.rs1).toBe(7);
  });

  it("knows a grade's mode from its items and converts scores between modes", () => {
    expect(scoringOf({ g: 1, [QUIZ_ITEM_ID]: 0 })).toBe("modified");
    expect(scoringOf({ g: 1 })).toBe("standard");
    expect(scoringOf(null)).toBe("standard");
    expect(convertScores(rubric, { g: 3.25, c: 2, dn: 4 }, "modified")).toEqual({ g: 2.5, c: 2, dn: 4 });
    expect(convertScores(rubric, { g: 2, [QUIZ_ITEM_ID]: 2 }, "standard")).toEqual({ g: 2 });
  });
});
