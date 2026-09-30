import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeArabic } from "./arabic";

describe("normalizeArabic", () => {
  it("unifies hamza, taa marbuta, alef maqsura, diacritics and tatweel", () => {
    expect(normalizeArabic("أحْمَد")).toBe(normalizeArabic("احمد"));
    expect(normalizeArabic("فاطمة")).toBe(normalizeArabic("فاطمه"));
    expect(normalizeArabic("مصطفى")).toBe(normalizeArabic("مصطفي"));
    expect(normalizeArabic("إسـراء")).toBe("اسراء");
    expect(normalizeArabic("٤٤١٠")).toBe("4410");
  });
});

describe("matchesSearch", () => {
  it("matches every word in any field, in any order", () => {
    expect(matchesSearch("احمد الربيعي", "أحمد كريم الربيعي", "4410001")).toBe(true);
    expect(matchesSearch("الربيعي احمد", "أحمد كريم الربيعي")).toBe(true);
    expect(matchesSearch("٤٤١٠", "علي", "4410001")).toBe(true);
    expect(matchesSearch("زينب", "أحمد كريم الربيعي")).toBe(false);
    expect(matchesSearch("  ", "anything")).toBe(true);
  });
});
