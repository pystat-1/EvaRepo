import { describe, expect, it } from "vitest";
import * as t from "../schema";
import { deleteCourse, saveHoliday } from "./courses";
import { buildPublication } from "./sync";
import { IDS, groupId, seeded } from "./testSeed";
import { listUnits, saveUnit, setGroupDayUnit, setStudentUnit, setUnitActive, unitPlan } from "./units";

const g1 = groupId("MORNING", 1);

describe("units (توزيع الأقسام)", () => {
  it("starts with the standard list, in order", async () => {
    const r = await seeded(1);
    expect((await listUnits(r)).map((u) => u.name)).toEqual(["صالة الولادة", "العناية", "العمليات", "الردهة"]);
  });

  it("adds, refuses a duplicate name, and hides a unit", async () => {
    const r = await seeded(1);
    const id = await saveUnit(r, { name: "  الطوارئ " });
    expect((await listUnits(r)).at(-1)).toMatchObject({ id, name: "الطوارئ" });
    await expect(saveUnit(r, { name: "العناية" })).rejects.toThrow("يوجد قسم بهذا الاسم");
    await setUnitActive(r, id, false);
    expect((await listUnits(r)).map((u) => u.id)).not.toContain(id);
    expect((await listUnits(r, true)).map((u) => u.id)).toContain(id);
  });

  it("the grid lists the group's attendance days and each student's unit", async () => {
    const r = await seeded(2);
    await saveHoliday(r, IDS.course, { dateISO: "2026-10-05", label: null, movedTo: null });
    const before = await unitPlan(r, g1);
    expect(before.dates.slice(0, 4)).toEqual(["2026-10-04", "2026-10-06", "2026-10-07", "2026-10-08"]);
    expect(before.students.map((s) => s.id)).toEqual(["s1", "s2"]);

    await setGroupDayUnit(r, g1, "2026-10-04", "unit-icu");
    await setStudentUnit(r, "s2", "2026-10-04", "unit-theatre");
    await setStudentUnit(r, "s1", "2026-10-06", "unit-ward");
    await setStudentUnit(r, "s1", "2026-10-06", null);
    expect((await unitPlan(r, g1)).cells).toEqual({ s1: { "2026-10-04": "unit-icu" }, s2: { "2026-10-04": "unit-theatre" } });
    await expect(setStudentUnit(r, "s1", "2026-10-06", "nope")).rejects.toThrow("القسم غير موجود");
  });

  it("reaches the evaluators' phones with each student's units by date", async () => {
    const r = await seeded(2);
    await setStudentUnit(r, "s1", "2026-10-04", "unit-labour");
    const { bundles } = await buildPublication(r);
    const sara = bundles.find((b) => b.evaluator.id === IDS.evaluators[0])!;
    const students = sara.groups.find((g) => g.id === g1)!.students;
    expect(students[0]).toMatchObject({ id: "s1", units: { "2026-10-04": "صالة الولادة" } });
    expect(students[1].units).toBeUndefined();
  });

  it("goes with the course when it is deleted", async () => {
    const r = await seeded(1);
    await setGroupDayUnit(r, g1, "2026-10-04", "unit-icu");
    await deleteCourse(r, IDS.course);
    expect(await r.db.select().from(t.studentDayUnits)).toEqual([]);
  });
});
