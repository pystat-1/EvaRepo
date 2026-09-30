import { describe, expect, it } from "vitest";
import { pickPlacement, StintForPlacement } from "./placement";

// 2026-10-04 is a Sunday.
const stints: StintForPlacement[] = [
  { groupId: "g1", hospitalId: "h1", hospitalName: "A", startDate: "2026-10-04", endDate: "2026-10-15", daysOfWeek: "SUN,TUE" },
  { groupId: "g1", hospitalId: "h2", hospitalName: "B", startDate: "2026-11-01", endDate: "2026-11-12", daysOfWeek: "SUN,TUE" },
  { groupId: "g2", hospitalId: "h1", hospitalName: "A", startDate: "2026-10-04", endDate: "2026-10-15", daysOfWeek: null },
];

describe("pickPlacement", () => {
  it("uses the schedule when the group meets that day", () => {
    expect(pickPlacement(stints, "g1", "2026-10-06")).toEqual({ hospitalId: "h1", hospitalName: "A", scheduled: true });
  });

  it("accepts a non-meeting weekday inside the rotation as off-schedule", () => {
    expect(pickPlacement(stints, "g1", "2026-10-07")).toEqual({ hospitalId: "h1", hospitalName: "A", scheduled: false });
  });

  it("accepts a day shortly after the rotation ended (moved by a holiday)", () => {
    expect(pickPlacement(stints, "g1", "2026-10-19")?.hospitalId).toBe("h1");
    expect(pickPlacement(stints, "g1", "2026-10-19")?.scheduled).toBe(false);
  });

  it("picks the nearest rotation when two are in range", () => {
    expect(pickPlacement(stints, "g1", "2026-10-28")?.hospitalId).toBe("h2");
  });

  it("rejects a day far from any rotation of the group", () => {
    expect(pickPlacement(stints, "g1", "2027-01-20")).toBeNull();
  });

  it("rejects a group that is not on the evaluator's schedule", () => {
    expect(pickPlacement(stints, "g9", "2026-10-06")).toBeNull();
  });

  it("treats an empty weekday pattern as every day scheduled", () => {
    expect(pickPlacement(stints, "g2", "2026-10-09")?.scheduled).toBe(true);
  });
});
