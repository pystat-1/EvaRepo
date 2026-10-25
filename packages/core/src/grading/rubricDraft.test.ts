import { describe, expect, it } from "vitest";
import { draftChanged, draftProblems, draftTotal, draftWarnings, type DraftSection } from "./rubricDraft";

const item = (id: string, labelAr: string, maxScore: number, kind: "check" | "number" = "number") => ({ id, labelAr, labelEn: null, maxScore, kind, active: true });
// The college's form: 5 + 7 (3.5 + 3.5) + three sections of four 0.25 ticks.
const form = (): DraftSection[] => [
  { id: "rs0", labelAr: "الملاحظة اليومية", labelEn: null, maxScore: 5, active: true, items: [item("dn", "الملاحظة اليومية", 5)] },
  { id: "rs1", labelAr: "المناقشة", labelEn: null, maxScore: 7, active: true, items: [item("g", "مناقشة جماعية", 3.5), item("c", "مناقشة الحالة", 3.5)] },
  { id: "rs2", labelAr: "المظهر", labelEn: null, maxScore: 1, active: true, items: ["a", "b", "c2", "d"].map((k) => item(k, k, 0.25, "check")) },
  { id: "rs3", labelAr: "الانتظام", labelEn: null, maxScore: 1, active: true, items: [] },
];
const saved = (counts: Record<string, number> = {}, items: Record<string, number> = {}) => ({ sections: form(), gradesBySection: counts, gradesByItem: items });

describe("rubric draft", () => {
  it("accepts the college's form and totals the active criteria", () => {
    expect(draftProblems(form())).toEqual([]);
    expect(draftTotal(form())).toBe(14);
    const d = form();
    d[3].active = false;
    expect(draftTotal(d)).toBe(13);
  });

  it("needs items that add up to the criterion's maximum", () => {
    const d = form();
    d[1].items[0].maxScore = 3;
    expect(draftProblems(d)).toEqual([{ section: 1, message: "مجموع البنود 6.5 لا يساوي الدرجة القصوى للمعيار 7" }]);
    d[1].items[1].active = false; // a turned-off item does not count
    d[1].maxScore = 3;
    expect(draftProblems(d)).toEqual([]);
  });

  it("refuses empty names, bad maximums, duplicates and no active criterion", () => {
    const d = form();
    d[0].labelAr = "  ";
    d[3].maxScore = 0;
    d[2].items[1].maxScore = 0.255;
    d[2].items[1].labelAr = "a";
    const msgs = draftProblems(d).map((p) => p.message);
    expect(msgs).toContain("الاسم مطلوب");
    expect(msgs).toContain("الدرجة القصوى يجب أن تكون أكبر من صفر");
    expect(msgs).toContain("الدرجة القصوى بمنزلتين عشريتين على الأكثر");
    expect(msgs).toContain("يوجد بند فعّال آخر بالاسم نفسه في هذا المعيار");
    expect(draftProblems(form().map((s) => ({ ...s, active: false }))).map((p) => p.message)).toContain("يجب أن يبقى معيار واحد فعّال على الأقل");
  });

  it("warns about recorded grades, the total and the quiz option", () => {
    const d = form();
    d[0].maxScore = 6;
    d[0].items[0].maxScore = 6;
    d[3].active = false;
    const w = draftWarnings(saved({ rs0: 40, rs3: 12 }, { dn: 40 }), d);
    expect(w.some((x) => x.includes("«الملاحظة اليومية»: الدرجة القصوى من 5 إلى 6") && x.includes("40"))).toBe(true);
    expect(w.some((x) => x.includes("«الانتظام» عليه 12 درجة"))).toBe(true);
    expect(w.some((x) => x.includes("البند «الملاحظة اليومية» تغيّر"))).toBe(true);
    expect(w.some((x) => x.startsWith("المجموع الكلي"))).toBe(false); // +1 and −1: still 14 (6 + 7 + 1)
    d[0].active = true;
    d[2].active = false;
    expect(draftWarnings(saved(), d)).toContain("المجموع الكلي لليوم يتغيّر من 14 إلى 13.");

    const renamed = form();
    renamed[1].items[0].labelAr = "نقاش";
    expect(draftWarnings(saved(), renamed).some((x) => x.includes("لن تكون متاحة"))).toBe(true);

    const bigger = form();
    bigger[1].maxScore = 8;
    bigger[1].items[0].maxScore = 4;
    bigger[1].items[1].maxScore = 4;
    expect(draftWarnings(saved(), bigger).some((x) => x.includes("يصير 7 لا 8"))).toBe(true);
    expect(draftWarnings(saved(), form())).toEqual([]);
  });

  it("notices changes, order included", () => {
    expect(draftChanged(form(), form())).toBe(false);
    const d = form();
    [d[2], d[3]] = [d[3], d[2]];
    expect(draftChanged(form(), d)).toBe(true);
  });
});
