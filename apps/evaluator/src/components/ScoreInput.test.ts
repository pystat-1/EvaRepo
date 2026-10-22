import { describe, expect, it } from "vitest";
import { normalizeScoreText, parseScore } from "./ScoreInput";

describe("score entry", () => {
  it("takes quarters and any two-decimal mark, clamped to the maximum", () => {
    expect(parseScore("2.25", 3.5)).toBe(2.25);
    expect(parseScore("0.75", 3.5)).toBe(0.75);
    expect(parseScore("3.4", 3.5)).toBe(3.4);
    expect(parseScore("3.75", 3.5)).toBe(3.5);
    expect(parseScore(".5", 3.5)).toBe(0.5);
    expect(parseScore("2.", 3.5)).toBe(2);
  });

  it("reads Arabic digits and decimal separators", () => {
    expect(normalizeScoreText("٢٫٧٥")).toBe("2.75");
    expect(normalizeScoreText("۱,۲۵")).toBe("1.25");
    expect(parseScore("٣٫٢٥", 3.5)).toBe(3.25);
  });

  it("is not a mark yet while empty or half-typed", () => {
    expect(parseScore("", 5)).toBeNull();
    expect(parseScore(".", 5)).toBeNull();
    expect(parseScore("1.2.3", 5)).toBeNull();
    expect(parseScore("abc", 5)).toBeNull();
  });
});
