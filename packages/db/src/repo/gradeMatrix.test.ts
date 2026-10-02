import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { derivePeriods } from "@eva/core/gradeMatrix/build";
import * as t from "../schema";
import { gradeMatrix, mergeStints } from "./gradeMatrix";
import { IDS, addEvaluation, groupId, seeded } from "./testSeed";

describe("gradeMatrix", () => {
  it("merges the weekly blocks into one stay per hospital", () => {
    const h = (hospitalId: string, startDate: string, endDate: string) => ({ hospitalId, startDate, endDate });
    expect(mergeStints([h("b", "2026-10-11", "2026-10-15"), h("a", "2026-10-04", "2026-10-08"), h("b", "2026-10-18", "2026-10-22")])).toEqual([
      { hospitalId: "a", start: "2026-10-04", end: "2026-10-08" },
      { hospitalId: "b", start: "2026-10-11", end: "2026-10-22" },
    ]);
  });

  it("builds programs, rotation periods and day states from the database", async () => {
    const r = await seeded(2);
    const g = groupId("MORNING", 1);
    await addEvaluation(r, { id: "v1", studentId: "s1", dateISO: "2026-10-04", scores: [5, 7, 1, 1, 1], groupId: g });
    await addEvaluation(r, { id: "v2", studentId: "s2", dateISO: "2026-10-04", scores: [0, 0, 0, 0, 0], groupId: g, attendance: "absent" });
    await addEvaluation(r, { id: "v3", studentId: "s1", dateISO: "2026-10-05", scores: [4, 6, 1, 1, 1], groupId: g, pending: true });
    await addEvaluation(r, { id: "v4", studentId: "s2", dateISO: "2026-10-05", scores: [4, 6, 1, 1, 1], groupId: g });
    await r.db.update(t.evaluations).set({ status: "DISPUTED" }).where(eq(t.evaluations.id, "v4"));
    await r.db.insert(t.courseHolidays).values({ id: "hol", courseId: IDS.course, dateISO: "2026-10-07", label: "عطلة" });

    const m = await gradeMatrix(r, IDS.course, "2026-10-20");
    expect(m.programs.map((p) => p.id)).toEqual(["MORNING", "EVENING"]);
    expect(m.maxTotal).toBe(15);
    expect(m.hospitals.map((h) => h.id)).toHaveLength(3);
    const group = m.programs[0].groups[0];
    expect(group.id).toBe(g);
    expect(group.stints).toHaveLength(3); // 6 weekly blocks → 3 two-week stays
    expect(derivePeriods(m.programs.flatMap((p) => p.groups))).toHaveLength(3);
    expect(group.dates).toHaveLength(30); // 6 weeks x 5 days

    const day = (sid: string, d: string) => group.students.find((s) => s.id === sid)!.days.find((x) => x.dateISO === d)!;
    expect(day("s1", "2026-10-04")).toMatchObject({ state: "ok", total: 15, scores: [5, 7, 1, 1, 1], evaluatorName: "د. سارة" });
    expect(day("s2", "2026-10-04")).toMatchObject({ state: "absent", attendance: "absent" });
    expect(day("s1", "2026-10-05")).toMatchObject({ state: "awaiting", total: null, scores: null });
    expect(day("s2", "2026-10-05").state).toBe("disputed");
    expect(day("s1", "2026-10-06").state).toBe("missing"); // 14 days ago, nothing saved
    expect(day("s1", "2026-10-07").state).toBe("holiday");
    expect(day("s1", "2026-10-15").state).toBe("pending"); // within the 7-day window
    expect(day("s1", "2026-10-28").state).toBe("future");
  });
});
