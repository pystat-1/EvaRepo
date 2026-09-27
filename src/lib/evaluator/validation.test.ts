import { describe, expect, it } from "vitest";
import { isWithinSubmissionWindow, normalizeScoresForAttendance, validateScores } from "./validation";

const sections = [
  { id: "s1", labelAr: "الانتظام", maxScore: 1 },
  { id: "s2", labelAr: "المناقشة", maxScore: 7 },
];

describe("validateScores", () => {
  it("accepts scores that are complete, in range, and on 0.5 steps", () => {
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

  it("rejects a score off the 0.5 step", () => {
    expect(() => validateScores({ s1: 1, s2: 5.3 }, sections)).toThrow(/0\.5/);
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
