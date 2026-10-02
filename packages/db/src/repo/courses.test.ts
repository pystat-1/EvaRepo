import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as t from "../schema";
import { courseOverview, createCourse, listCourses, saveHospital, setBlockHospital } from "./courses";
import { IDS, groupId, seeded } from "./testSeed";

describe("courseOverview", () => {
  it("lays the rotation out as groups x weeks", async () => {
    const r = await seeded(2);
    const o = (await courseOverview(r, IDS.course))!;
    expect(o.groups.map((g) => g.name)).toEqual([
      "المجموعة الصباحية 1", "المجموعة الصباحية 2", "المجموعة الصباحية 3",
      "المجموعة المسائية 1", "المجموعة المسائية 2", "المجموعة المسائية 3",
    ]);
    expect(o.groups[0].studentCount).toBe(2);
    expect(o.weeks.map((w) => w.start)).toEqual(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"]);
    const m1 = o.cells[groupId("MORNING", 1)];
    expect([0, 2, 4].map((w) => m1[w].hospitalName)).toEqual(["مستشفى اليرموك", "مستشفى مدينة الطب", "مستشفى العلوية"]);
  });
});

describe("setBlockHospital", () => {
  it("moves one week, bumps the schedule version and audits", async () => {
    const r = await seeded(1);
    const blockId = `b-${groupId("MORNING", 1)}-w0`;
    await setBlockHospital(r, blockId, IDS.hospitals[2]);
    const o = (await courseOverview(r, IDS.course))!;
    expect(o.cells[groupId("MORNING", 1)][0].hospitalName).toBe("مستشفى العلوية");
    expect(o.course.scheduleVersion).toBe(1);
    const audit = await r.db.select().from(t.auditLog).where(eq(t.auditLog.entityId, blockId));
    expect(audit).toHaveLength(1);
  });
});

describe("createCourse", () => {
  const base = {
    year: 2027, number: 1, label: "دورة 2027", startDate: "2027-01-03", weekCount: 6, weeksPerHospital: 2,
    daysOfWeek: "SUN,MON,TUE,WED,THU", groupsPerShift: { MORNING: 3, EVENING: 3 }, hospitalIds: IDS.hospitals, studyTypeId: "st-n",
  };

  it("creates groups and a fair rotation: every group visits every hospital", async () => {
    const r = await seeded(0);
    const id = await createCourse(r, base);
    const o = (await courseOverview(r, id))!;
    expect(o.groups).toHaveLength(6);
    expect(o.weeks).toHaveLength(6);
    for (const g of o.groups) {
      const visited = new Set(Object.values(o.cells[g.id]).map((c) => c.hospitalId));
      expect(visited.size).toBe(3);
    }
    // In any week, a shift's groups are at different hospitals.
    for (const w of [0, 2, 4]) {
      const morning = o.groups.filter((g) => g.shift === "MORNING").map((g) => o.cells[g.id][w].hospitalId);
      expect(new Set(morning).size).toBe(3);
    }
    expect((await listCourses(r))[0].label).toBe("دورة 2027");
  });

  it("validates the input", async () => {
    const r = await seeded(0);
    await expect(createCourse(r, { ...base, startDate: "2027-01-04" })).rejects.toThrow(/يوم أحد/);
    await expect(createCourse(r, { ...base, year: 2026, number: 1 })).rejects.toThrow(/موجودة مسبقًا/);
    await expect(createCourse(r, { ...base, hospitalIds: [] })).rejects.toThrow(/مستشفى واحدًا/);
  });

  it("saves hospitals", async () => {
    const r = await seeded(0);
    const id = await saveHospital(r, { name: "  مستشفى   الكندي " });
    const [h] = await r.db.select().from(t.hospitals).where(eq(t.hospitals.id, id));
    expect(h.name).toBe("مستشفى الكندي");
  });
});

describe("attendance days", () => {
  it("sets the course's days, overrides one hospital, and lays the calendar out by hospital", async () => {
    const { attendanceDays, setAttendanceDays, attendanceCalendar } = await import("./courses");
    const r = await seeded(1);
    await setAttendanceDays(r, IDS.course, ["tue", "MON"]);
    let days = await attendanceDays(r, IDS.course);
    expect(days.course).toEqual(["MON", "TUE"]);
    expect(days.hospitals.every((h) => h.days.join() === "MON,TUE" && !h.own)).toBe(true);

    await setAttendanceDays(r, IDS.course, ["WED"], IDS.hospitals[2]);
    days = await attendanceDays(r, IDS.course);
    expect(days.hospitals.find((h) => h.hospitalId === IDS.hospitals[2])).toMatchObject({ days: ["WED"], own: true });

    const cal = await attendanceCalendar(r, IDS.course);
    const yarmouk = cal.find((h) => h.hospitalId === IDS.hospitals[0])!;
    // week 1 (from Sunday 2026-10-04): Monday and Tuesday only, with the groups there
    expect(yarmouk.weeks[0].days.map((d) => [d.dateISO, d.weekday])).toEqual([["2026-10-05", "MON"], ["2026-10-06", "TUE"]]);
    expect(yarmouk.weeks[0].days[0].groups.map((g) => g.name)).toEqual(["المجموعة الصباحية 1", "المجموعة المسائية 1"]);
    expect(cal.find((h) => h.hospitalId === IDS.hospitals[2])!.weeks[0].days.map((d) => d.weekday)).toEqual(["WED"]);
    await expect(setAttendanceDays(r, IDS.course, [])).rejects.toThrow("يومًا واحدًا");
  });
});

describe("current course", () => {
  const next = {
    year: 2026, number: 2, label: "الدورة الثانية", startDate: "2027-01-03", weekCount: 6, weeksPerHospital: 2,
    daysOfWeek: "SUN,MON,TUE,WED,THU", groupsPerShift: { MORNING: 3, EVENING: 3 }, hospitalIds: IDS.hospitals, studyTypeId: "st-n",
  };

  it("stays the chosen course: a newer course does not take over until chosen", async () => {
    const { currentCourse, setCurrentCourse } = await import("./students");
    const r = await seeded(1);
    expect((await currentCourse(r))!.id).toBe(IDS.course);
    const second = await createCourse(r, next);
    expect((await currentCourse(r))!.id).toBe(IDS.course);
    await setCurrentCourse(r, second);
    expect((await currentCourse(r))!.id).toBe(second);
    await createCourse(r, { ...next, number: 3, label: "الثالثة" });
    expect((await currentCourse(r))!.id).toBe(second);
    await setCurrentCourse(r, IDS.course);
    expect((await currentCourse(r))!.id).toBe(IDS.course);
  });

  it("the first course ever becomes current", async () => {
    const { currentCourse } = await import("./students");
    const r = await seeded(0);
    await r.db.delete(t.evaluatorAssignments);
    await r.db.delete(t.rotationBlocks);
    await r.db.delete(t.groups);
    await r.db.delete(t.courseStudyTypes);
    await r.db.delete(t.courseHospitals);
    await r.db.delete(t.courses);
    const id = await createCourse(r, next);
    expect((await currentCourse(r))!.id).toBe(id);
  });
});

describe("deleteCourse", () => {
  it("removes the course and everything in it, and nothing of another course", async () => {
    const { addEvaluation } = await import("./testSeed");
    const { courseDeletionImpact, deleteCourse } = await import("./courses");
    const { currentCourse, setCurrentCourse } = await import("./students");
    const r = await seeded(2);
    await addEvaluation(r, { id: "ev1", studentId: "s1", dateISO: "2026-10-05", scores: [5, 7, 1, 1, 1], groupId: groupId("MORNING", 1) });
    await r.db.insert(t.attendanceRecords).values({ id: "ar1", studentId: "s1", dateISO: "2026-10-05", groupId: groupId("MORNING", 1), status: "present", markedById: IDS.evaluators[0] });
    await r.db.insert(t.flags).values({ id: "f1", studentId: "s1", ruleId: "r", severity: "low", msg: "m", dateISO: "2026-10-05" });
    const other = await createCourse(r, {
      year: 2026, number: 2, label: "الثانية", startDate: "2027-01-03", weekCount: 4, weeksPerHospital: 2,
      daysOfWeek: "SUN,MON", groupsPerShift: { MORNING: 2, EVENING: 0 }, hospitalIds: IDS.hospitals, studyTypeId: "st-n",
    });

    expect(await courseDeletionImpact(r, IDS.course)).toEqual({
      label: "دورة التمريض الأولى 2026", groups: 6, students: 12, gradedDays: 1, assignments: 2, isCurrent: true,
    });
    await deleteCourse(r, IDS.course);

    expect(await r.db.select().from(t.courses).where(eq(t.courses.id, IDS.course))).toHaveLength(0);
    for (const table of [t.students, t.evaluations, t.evaluationScores, t.attendanceRecords, t.flags, t.evaluatorAssignments, t.courseHospitals]) {
      expect(await r.db.select().from(table)).toHaveLength(table === t.courseHospitals ? 3 : 0);
    }
    expect((await courseOverview(r, other))!.groups).toHaveLength(2);
    expect(await r.db.select().from(t.hospitals)).toHaveLength(3);
    expect(await r.db.select().from(t.accounts)).toHaveLength(2);
    // The deleted course was current: the remaining one takes over.
    expect((await currentCourse(r))!.id).toBe(other);

    // Deleting a course that is not current leaves the choice alone.
    const third = await createCourse(r, {
      year: 2026, number: 3, label: "الثالثة", startDate: "2027-03-07", weekCount: 2, weeksPerHospital: 1,
      daysOfWeek: "SUN", groupsPerShift: { MORNING: 1, EVENING: 0 }, hospitalIds: IDS.hospitals, studyTypeId: "st-n",
    });
    await setCurrentCourse(r, other);
    await deleteCourse(r, third);
    expect((await currentCourse(r))!.id).toBe(other);
    await expect(deleteCourse(r, third)).rejects.toThrow(/غير موجودة/);
  });
});
