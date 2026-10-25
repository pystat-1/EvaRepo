import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as t from "../schema";
import { rubric } from "./grading";
import { rubricCenter, saveRubric } from "./rubric";
import { addEvaluation, groupId, seeded } from "./testSeed";

describe("rubric center", () => {
  it("reads every criterion with its grade counts", async () => {
    const r = await seeded(1);
    await addEvaluation(r, { id: "v1", studentId: "s1", dateISO: "2026-10-04", scores: [5, 7, 1, 1, 1], groupId: groupId("MORNING", 1) });
    await r.db.update(t.evaluations).set({ itemScores: { "ri-gdisc": 3.5, "ri-cdisc": 3.5 } }).where(eq(t.evaluations.id, "v1"));
    const c = await rubricCenter(r);
    expect(c.sections.map((s) => s.labelAr)).toEqual(["الملاحظة اليومية", "المناقشة والتغذية الراجعة", "الموقف والتواصل", "الانتظام", "المظهر"]);
    expect(c.sections[1].items.map((i) => i.id)).toEqual(["ri-gdisc", "ri-cdisc"]);
    expect(c.gradesBySection.rs1).toBe(1);
    expect(c.gradesByItem["ri-gdisc"]).toBe(1);
  });

  it("saves edits, new rows, order and turned-off rows in one go, with audit entries", async () => {
    const r = await seeded(1);
    const { sections } = await rubricCenter(r);
    sections[1].labelAr = "المناقشة";
    sections[4].active = false; // المظهر
    [sections[2], sections[3]] = [sections[3], sections[2]];
    sections.push({ labelAr: "المهارات", labelEn: "Skills", maxScore: 2, active: true, items: [{ labelAr: "سحب الدم", labelEn: null, maxScore: 1, kind: "number", active: true }, { labelAr: "قياس الضغط", labelEn: null, maxScore: 1, kind: "check", active: true }] });
    expect(await saveRubric(r, sections)).toEqual({ changed: 7 }); // rename, 2 moves, off, new section + 2 items

    const now = await rubric(r); // what grading and the phones use: active only
    expect(now.map((s) => s.labelAr)).toEqual(["الملاحظة اليومية", "المناقشة", "الانتظام", "الموقف والتواصل", "المهارات"]);
    expect(now[4].items.map((i) => [i.labelAr, i.kind])).toEqual([["سحب الدم", "number"], ["قياس الضغط", "check"]]);
    const audit = await r.db.select().from(t.auditLog);
    expect(audit.filter((a) => a.entityType === "RubricSection").map((a) => a.action).sort()).toEqual(["create", "deactivate", "update", "update", "update"]);
    expect((await rubricCenter(r)).sections).toHaveLength(6); // the turned-off one is kept

    expect(await saveRubric(r, (await rubricCenter(r)).sections)).toEqual({ changed: 0 });
  });

  it("refuses problems, dropped rows and items moved between criteria", async () => {
    const r = await seeded(1);
    const bad = (await rubricCenter(r)).sections;
    bad[1].maxScore = 8;
    await expect(saveRubric(r, bad)).rejects.toThrow("مجموع البنود 7 لا يساوي الدرجة القصوى للمعيار 8");

    const dropped = (await rubricCenter(r)).sections.slice(1);
    await expect(saveRubric(r, dropped)).rejects.toThrow("عطّلها بدلًا من ذلك");

    const moved = (await rubricCenter(r)).sections;
    moved[0].items.push(moved[1].items.pop()!);
    moved[0].maxScore = 8.5;
    moved[1].maxScore = 3.5;
    await expect(saveRubric(r, moved)).rejects.toThrow("لا يمكن نقل بند إلى معيار آخر");
    expect((await rubric(r))[1].maxScore).toBe(7); // nothing written
  });
});
