import { describe, expect, it } from "vitest";
import { applyItemScores, isWithinSubmissionWindow, normalizeScoresForAttendance, validateScores } from "./validation";

const sections = [
  { id: "s1", labelAr: "الانتظام", maxScore: 1 },
  { id: "s2", labelAr: "المناقشة", maxScore: 7 },
];

describe("validateScores", () => {
  it("accepts scores that are complete, in range, and on 0.01 steps", () => {
    expect(() => validateScores({ s1: 1, s2: 5.5 }, sections)).not.toThrow();
  });

  it("rejects a missing section", () => {
    expect(() => validateScores({ s1: 1 }, sections)).toThrow(/مطلوبة/);
  });

  it("rejects an unknown section id", () => {
    expect(() => validateScores({ s1: 1, s2: 5, s3: 1 }, sections)).toThrow(/غير معروف/);
  });

  it("rejects NaN (defect C6)", () => {
    expect(() => validateScores({ s1: NaN, s2: 5 }, sections)).toThrow(/غير صالحة/);
  });

  it("rejects Infinity", () => {
    expect(() => validateScores({ s1: Infinity, s2: 5 }, sections)).toThrow(/غير صالحة/);
  });

  it("rejects a score above maxScore", () => {
    expect(() => validateScores({ s1: 2, s2: 5 }, sections)).toThrow(/بين 0 و 1/);
  });

  it("rejects a negative score", () => {
    expect(() => validateScores({ s1: -1, s2: 5 }, sections)).toThrow(/بين 0 و 1/);
  });

  it("accepts quarter and cent steps", () => {
    expect(() => validateScores({ s1: 0.75, s2: 5.35 }, sections)).not.toThrow();
  });

  it("rejects a score with more than two decimals", () => {
    expect(() => validateScores({ s1: 1, s2: 5.333 }, sections)).toThrow(/منزلتين/);
  });
});

describe("applyItemScores", () => {
  const withItems = [
    {
      id: "att",
      labelAr: "الموقف والتواصل",
      maxScore: 1,
      items: [
        { id: "i1", labelAr: "الطاقم الطبي", maxScore: 0.25, kind: "check" as const },
        { id: "i2", labelAr: "الطالب", maxScore: 0.25, kind: "check" as const },
        { id: "i3", labelAr: "المعلم", maxScore: 0.25, kind: "check" as const },
        { id: "i4", labelAr: "المريض", maxScore: 0.25, kind: "check" as const },
      ],
    },
    {
      id: "disc",
      labelAr: "المناقشة",
      maxScore: 7,
      items: [
        { id: "g", labelAr: "مناقشة جماعية", maxScore: 3.5, kind: "number" as const },
        { id: "c", labelAr: "مناقشة الحالة", maxScore: 3.5, kind: "number" as const },
      ],
    },
    { id: "plain", labelAr: "بند بلا فقرات", maxScore: 2 },
  ];

  it("sums items into their section and keeps plain sections as sent", () => {
    const out = applyItemScores({ plain: 1.5 }, { i1: 0.25, i2: 0.25, i3: 0.25, g: 3.25, c: 2.1 }, withItems);
    expect(out.scores).toEqual({ plain: 1.5, att: 0.75, disc: 5.35 });
    expect(out.itemScores).toEqual({ i1: 0.25, i2: 0.25, i3: 0.25, i4: 0, g: 3.25, c: 2.1 });
  });

  it("rejects a check item that is neither 0 nor its max", () => {
    expect(() => applyItemScores({}, { i1: 0.1 }, withItems)).toThrow(/إما 0/);
  });

  it("rejects a number item above its max", () => {
    expect(() => applyItemScores({}, { g: 4 }, withItems)).toThrow(/بين 0 و 3.5/);
  });

  it("rejects NaN item scores", () => {
    expect(() => applyItemScores({}, { c: NaN }, withItems)).toThrow(/غير صالحة/);
  });
});

describe("normalizeScoresForAttendance", () => {
  it("leaves scores untouched when present", () => {
    expect(normalizeScoresForAttendance("present", { s1: 1, s2: 5 }, sections)).toEqual({ s1: 1, s2: 5 });
  });

  it("leaves scores untouched when late", () => {
    expect(normalizeScoresForAttendance("late", { s1: 1, s2: 5 }, sections)).toEqual({ s1: 1, s2: 5 });
  });

  it("forces every active section to 0 when absent, regardless of submitted scores", () => {
    expect(normalizeScoresForAttendance("absent", { s1: 1, s2: 7 }, sections)).toEqual({ s1: 0, s2: 0 });
  });

  it("forces every active section to 0 when absent, even with no scores submitted", () => {
    expect(normalizeScoresForAttendance("absent", {}, sections)).toEqual({ s1: 0, s2: 0 });
  });
});

describe("isWithinSubmissionWindow", () => {
  it("allows the same day", () => {
    expect(isWithinSubmissionWindow("2026-10-01", "2026-10-01")).toBe(true);
  });

  it("allows exactly 7 days later", () => {
    expect(isWithinSubmissionWindow("2026-10-01", "2026-10-08")).toBe(true);
  });

  it("rejects 8 days later", () => {
    expect(isWithinSubmissionWindow("2026-10-01", "2026-10-09")).toBe(false);
  });

  it("rejects a date in the future relative to today", () => {
    expect(isWithinSubmissionWindow("2026-10-05", "2026-10-01")).toBe(false);
  });

  it("respects a custom window length", () => {
    expect(isWithinSubmissionWindow("2026-10-01", "2026-10-04", 3)).toBe(true);
    expect(isWithinSubmissionWindow("2026-10-01", "2026-10-05", 3)).toBe(false);
  });
});
