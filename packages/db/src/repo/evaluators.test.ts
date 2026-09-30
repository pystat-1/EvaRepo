import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as t from "../schema";
import { ValidationError } from "./common";
import { addAssignment, coverage, saveEvaluator, importEvaluators, listEvaluators, previewEvaluatorImport, removeAssignment } from "./evaluators";
import { IDS, groupId, seeded } from "./testSeed";

const sara = () => IDS.evaluators[0];
const byId = async (r: Awaited<ReturnType<typeof seeded>>, id: string) => (await listEvaluators(r)).find((e) => e.id === id)!;

describe("evaluator covers", () => {
  it("adds a group-level cover with the group's name, and removes it", async () => {
    const r = await seeded(0);
    const g = groupId("EVENING", 2);
    const id = await addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: IDS.hospitals[2], groupId: g });
    const e = await byId(r, sara());
    expect(e.hospitals).toHaveLength(2);
    expect(e.hospitals.map((h) => [h.hospitalId, h.groupName])).toEqual(
      expect.arrayContaining([[IDS.hospitals[0], null], [IDS.hospitals[2], "المجموعة المسائية 2"]])
    );
    await removeAssignment(r, id);
    expect((await byId(r, sara())).hospitals).toHaveLength(1);
  });

  it("refuses duplicates and outside hospitals; a whole-hospital cover replaces its group covers", async () => {
    const r = await seeded(0);
    await expect(addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: IDS.hospitals[0] })).rejects.toThrow("يغطي هذا المستشفى كاملًا");
    await expect(addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: IDS.hospitals[0], groupId: groupId("MORNING", 1) })).rejects.toThrow(ValidationError);
    await expect(addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: "nope" })).rejects.toThrow("ليس ضمن هذه الدورة");
    const g = groupId("MORNING", 1);
    await addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: IDS.hospitals[1], groupId: g });
    await expect(addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: IDS.hospitals[1], groupId: g })).rejects.toThrow("مخصّص لهذه المجموعة");
    await addAssignment(r, { accountId: sara(), courseId: IDS.course, hospitalId: IDS.hospitals[1] });
    const covers = (await byId(r, sara())).hospitals.filter((h) => h.hospitalId === IDS.hospitals[1]);
    expect(covers.map((h) => h.groupId)).toEqual([null]);
  });

  it("reports coverage per hospital (active evaluators only)", async () => {
    const r = await seeded(0);
    const count = async () => Object.fromEntries((await coverage(r, IDS.course)).map((c) => [c.hospitalId, c.evaluators]));
    expect(await count()).toEqual({ [IDS.hospitals[0]]: 1, [IDS.hospitals[1]]: 1, [IDS.hospitals[2]]: 0 });
    await r.db.update(t.accounts).set({ active: false }).where(eq(t.accounts.id, sara()));
    expect(await count()).toEqual({ [IDS.hospitals[0]]: 0, [IDS.hospitals[1]]: 1, [IDS.hospitals[2]]: 0 });
  });

  it("adds an evaluator with the email only", async () => {
    const r = await seeded(0);
    const id = await saveEvaluator(r, { email: " Huda.K@Uni.edu.iq " });
    expect(await byId(r, id)).toMatchObject({ email: "huda.k@uni.edu.iq", name: "huda.k" });
    await expect(saveEvaluator(r, { email: "huda.k@uni.edu.iq" })).rejects.toThrow("مستخدم لحساب آخر");
  });
});

describe("evaluator Excel import", () => {
  const rows = [
    { row: 2, name: "د. هدى", email: "Huda@X.iq", hospital: "مستشفى العلويه", group: "" }, // ة/ه spelling tolerated
    { row: 6, name: "", email: "noname@x.iq", hospital: "مستشفى العلوية", group: "" }, // email only
    { row: 3, name: "", email: "huda@x.iq", hospital: "مستشفى اليرموك", group: "المجموعة الصباحية 2" }, // same person, 2nd cover
    { row: 4, name: "", email: "sara@x.iq", hospital: "مستشفى مدينة الطب", group: "" }, // existing evaluator
    { row: 5, name: "", email: "sara@x.iq", hospital: "مستشفى اليرموك", group: "" }, // already covered
  ];

  it("previews without writing, then applies everything in one go", async () => {
    const r = await seeded(0);
    const p = await previewEvaluatorImport(r, rows, IDS.course);
    expect(p.lines.map((l) => l.action)).toEqual(["new", "new", "assign", "assign", "exists"]);
    expect(p).toMatchObject({ newEvaluators: 2, newCovers: 4, errors: 0 });
    expect(await listEvaluators(r)).toHaveLength(2);

    await importEvaluators(r, rows, IDS.course);
    const all = await listEvaluators(r);
    const huda = all.find((e) => e.email === "huda@x.iq")!;
    expect(huda.name).toBe("د. هدى");
    expect(huda.hospitals.map((h) => h.groupName ?? "كل")).toEqual(expect.arrayContaining(["كل", "المجموعة الصباحية 2"]));
    expect((await byId(r, sara())).hospitals).toHaveLength(2);
    expect(all.find((e) => e.email === "noname@x.iq")?.name).toBe("noname");
    // importing the same file again changes nothing
    expect(await previewEvaluatorImport(r, rows, IDS.course)).toMatchObject({ newEvaluators: 0, newCovers: 0 });
  });

  it("refuses the whole file when a row is wrong", async () => {
    const r = await seeded(0);
    const bad = [...rows, { row: 6, name: "x", email: "bad", hospital: "مستشفى اليرموك", group: "" }, { row: 7, name: "y", email: "y@x.iq", hospital: "مستشفى آخر", group: "" }];
    const p = await previewEvaluatorImport(r, bad, IDS.course);
    expect(p.errors).toBe(2);
    await expect(importEvaluators(r, bad, IDS.course)).rejects.toThrow("صف فيه خطأ");
    expect(await listEvaluators(r)).toHaveLength(2);
  });
});
