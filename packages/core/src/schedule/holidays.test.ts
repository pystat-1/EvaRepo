import { describe, expect, it } from "vitest";
import { pickPlacement } from "../grading/placement";
import { makeupStints, withMakeupDays } from "./holidays";

const stints = [
  { groupId: "g1", hospitalId: "h1", hospitalName: "اليرموك", startDate: "2026-10-04", endDate: "2026-10-08", daysOfWeek: "SUN,MON,TUE,WED,THU" },
  { groupId: "g2", hospitalId: "h2", hospitalName: "العلوية", startDate: "2026-10-04", endDate: "2026-10-08", daysOfWeek: "SUN,TUE" },
];

describe("holiday make-up days", () => {
  it("moves the groups that met on the holiday, at the same hospital", () => {
    // Monday 2026-10-05 → Saturday 2026-10-10: g1 meets Mondays, g2 does not.
    const made = makeupStints(stints, [{ dateISO: "2026-10-05", label: null, movedTo: "2026-10-10" }]);
    expect(made).toEqual([{ ...stints[0], startDate: "2026-10-10", endDate: "2026-10-10", daysOfWeek: "SAT", makeupFor: "2026-10-05" }]);
  });

  it("a holiday without a new date adds nothing", () => {
    expect(makeupStints(stints, [{ dateISO: "2026-10-05", label: "عطلة", movedTo: null }])).toEqual([]);
  });

  it("the make-up day is a scheduled day for placement", () => {
    const all = withMakeupDays(stints, [{ dateISO: "2026-10-06", label: null, movedTo: "2026-10-10" }]);
    expect(pickPlacement(all, "g2", "2026-10-10")).toEqual({ hospitalId: "h2", hospitalName: "العلوية", scheduled: true });
    expect(pickPlacement(stints, "g2", "2026-10-10")?.scheduled).toBe(false);
  });
});
