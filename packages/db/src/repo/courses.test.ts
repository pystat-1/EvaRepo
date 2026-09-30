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
