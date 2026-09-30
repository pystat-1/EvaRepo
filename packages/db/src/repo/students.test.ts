import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as t from "../schema";
import { importContext, importStudents, listStudents, previewImport, saveStudent, setStudentActive } from "./students";
import { addEvaluation, groupId, seeded } from "./testSeed";
import { Plan } from "./common";

const row = (n: number, over: Partial<Record<string, string>> = {}) => ({
  row: n + 1,
  universityNumber: `44100${String(n).padStart(2, "0")}`,
  nameAr: `طالب حقيقي ${n}`,
  shift: "صباحي",
  group: "1",
  ...over,
});

describe("listStudents", () => {
  it("filters by group/shift and searches Arabic names loosely", async () => {
    const r = await seeded(2);
    await saveStudent(r, { universityNumber: "9001", nameAr: "أحمد كريم الربيعي", groupId: groupId("EVENING", 2) });
    expect((await listStudents(r, { groupId: groupId("MORNING", 1) })).length).toBe(2);
    expect((await listStudents(r, { shift: "EVENING" })).length).toBe(7);
    const hit = await listStudents(r, { search: "احمد الربيعي" });
    expect(hit.map((s) => s.universityNumber)).toEqual(["9001"]);
    expect(hit[0].groupName).toBe("المجموعة المسائية 2");
  });
});

describe("saveStudent", () => {
  it("creates with a code from the group's course, and audits it", async () => {
    const r = await seeded(2);
    const id = await saveStudent(r, { universityNumber: "9001", nameAr: " زينب   علي ", groupId: groupId("MORNING", 3) });
    const [s] = await r.db.select().from(t.students).where(eq(t.students.id, id));
    expect(s).toMatchObject({ nameAr: "زينب علي", shift: "MORNING", courseId: "c1", code: "26-1-N-0013" });
    const audit = await r.db.select().from(t.auditLog).where(eq(t.auditLog.entityId, id));
    expect(audit.map((a) => a.action)).toEqual(["create"]);
  });

  it("refuses a duplicate university number and bad input", async () => {
    const r = await seeded(1);
    await expect(saveStudent(r, { universityNumber: "SMP-001", nameAr: "x", groupId: null })).rejects.toThrow(/بهذا الرقم/);
    await expect(saveStudent(r, { universityNumber: "", nameAr: "x", groupId: null })).rejects.toThrow(/مطلوب/);
    await expect(saveStudent(r, { universityNumber: "1", nameAr: "x", email: "bad@", groupId: null })).rejects.toThrow(/البريد/);
  });

  it("edits and moves a student to another group (course/shift follow the group)", async () => {
    const r = await seeded(1);
    await saveStudent(r, { id: "s1", universityNumber: "SMP-001", nameAr: "اسم جديد", groupId: groupId("EVENING", 1) });
    const [s] = await r.db.select().from(t.students).where(eq(t.students.id, "s1"));
    expect(s).toMatchObject({ nameAr: "اسم جديد", shift: "EVENING", groupId: groupId("EVENING", 1) });
  });

  it("deactivates and reactivates", async () => {
    const r = await seeded(1);
    await setStudentActive(r, "s1", false);
    expect((await listStudents(r)).some((s) => s.id === "s1")).toBe(false);
    expect((await listStudents(r, { includeInactive: true })).some((s) => s.id === "s1")).toBe(true);
    await setStudentActive(r, "s1", true);
    expect((await listStudents(r)).some((s) => s.id === "s1")).toBe(true);
  });
});

describe("Excel import", () => {
  it("imports into the chosen course, not just the newest one", async () => {
    const r = await seeded(0);
    const { createCourse } = await import("./courses");
    const newer = await createCourse(r, {
      year: 2027, number: 1, label: "2027", startDate: "2027-01-03", weekCount: 2, weeksPerHospital: 1,
      daysOfWeek: "SUN", groupsPerShift: { MORNING: 1, EVENING: 0 }, hospitalIds: ["h-yarmouk"], studyTypeId: "st-n",
    });
    expect((await importContext(r)).course?.id).toBe(newer); // default: newest
    const res = await importStudents(r, [row(1)], { removeSamples: false, deactivateMissing: false, courseId: "c1" });
    expect(res.created).toBe(1);
    const [s] = await listStudents(r, { search: "4410001" });
    expect(s).toMatchObject({ courseId: "c1", groupName: "المجموعة الصباحية 1", code: "26-1-N-0001" });
  });

  it("knows the course, its groups and the sample students", async () => {
    const r = await seeded(2);
    const ctx = await importContext(r);
    expect(ctx.course?.label).toBe("دورة التمريض الأولى 2026");
    expect(ctx.groups.map((g) => `${g.shift}:${g.number}:${g.studentCount}`)).toEqual([
      "MORNING:1:2", "MORNING:2:2", "MORNING:3:2", "EVENING:1:2", "EVENING:2:2", "EVENING:3:2",
    ]);
    expect(ctx.sampleCount).toBe(12);
  });

  it("previews without writing", async () => {
    const r = await seeded(1);
    const p = await previewImport(r, [row(1), row(2, { shift: "ليلي" })]);
    expect(p.valid).toHaveLength(1);
    expect(p.issues).toHaveLength(1);
    expect(await listStudents(r)).toHaveLength(6);
  });

  it("imports a file in one go: removes samples first so codes start at 0001", async () => {
    const r = await seeded(2);
    await addEvaluation(r, { id: "v1", studentId: "s1", dateISO: "2026-10-04", scores: [5, 7, 1, 1, 1] });
    const res = await importStudents(r, [row(1), row(2, { shift: "مسائي", group: "3" }), row(3, { group: "9" })], { removeSamples: true, deactivateMissing: false });
    expect(res).toMatchObject({ created: 2, updated: 0, samplesRemoved: 12, deactivated: 0 });
    expect(res.issues).toHaveLength(1);
    const all = await listStudents(r, { includeInactive: true });
    expect(all.map((s) => `${s.universityNumber}:${s.code}:${s.groupName}`).sort()).toEqual([
      "4410001:26-1-N-0001:المجموعة الصباحية 1",
      "4410002:26-1-N-0002:المجموعة المسائية 3",
    ]);
    expect(await r.db.select().from(t.evaluations)).toHaveLength(0); // sample's grade went with it
  });

  it("re-import updates by university number and can deactivate the rest", async () => {
    const r = await seeded(1);
    await importStudents(r, [row(1), row(2)], { removeSamples: true, deactivateMissing: false });
    const res = await importStudents(r, [row(1, { nameAr: "اسم مصحح", group: "2" })], { removeSamples: false, deactivateMissing: true });
    expect(res).toMatchObject({ created: 0, updated: 1, deactivated: 1 });
    const active = await listStudents(r);
    expect(active.map((s) => `${s.nameAr}:${s.groupName}`)).toEqual(["اسم مصحح:المجموعة الصباحية 2"]);
  });

  it("is all-or-nothing: if any statement fails, none of the change is kept", async () => {
    const r = await seeded(1);
    const plan = new Plan(r);
    plan.add(r.db.insert(t.students).values({ id: "new1", universityNumber: "7001", nameAr: "سيُلغى" }));
    plan.audit("Student", "new1", "create");
    plan.add(r.db.insert(t.students).values({ id: "new2", universityNumber: "7002", nameAr: "خطأ", groupId: "no-such-group" }));
    await expect(plan.commit()).rejects.toThrow(/FOREIGN KEY/);
    expect(await r.db.select().from(t.students).where(eq(t.students.id, "new1"))).toHaveLength(0);
    expect(await r.db.select().from(t.auditLog).where(eq(t.auditLog.entityId, "new1"))).toHaveLength(0);
  });
});
