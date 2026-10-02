import { describe, expect, it } from "vitest";
import { expandAttendanceDates } from "./attendanceDates";

describe("expandAttendanceDates", () => {
  it("returns one week per weekCount, with only the allowed weekdays", () => {
    // 2026-10-04 is a Sunday.
    const weeks = expandAttendanceDates({
      startDate: "2026-10-04",
      weekCount: 2,
      daysOfWeek: "SUN,TUE",
    });
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ weekIndex: 0, startDate: "2026-10-04", endDate: "2026-10-10" });
    expect(weeks[0].dates).toEqual(["2026-10-04", "2026-10-06"]);
    expect(weeks[1]).toMatchObject({ weekIndex: 1, startDate: "2026-10-11", endDate: "2026-10-17" });
    expect(weeks[1].dates).toEqual(["2026-10-11", "2026-10-13"]);
  });

  it("removes holiday dates even when they fall on an attendance weekday", () => {
    const weeks = expandAttendanceDates({
      startDate: "2026-10-04",
      weekCount: 1,
      daysOfWeek: "SUN,TUE",
      holidays: ["2026-10-06"],
    });
    expect(weeks[0].dates).toEqual(["2026-10-04"]);
  });

  it("is case-insensitive and tolerates whitespace in daysOfWeek", () => {
    const weeks = expandAttendanceDates({
      startDate: "2026-10-04",
      weekCount: 1,
      daysOfWeek: " sun , tue ",
    });
    expect(weeks[0].dates).toEqual(["2026-10-04", "2026-10-06"]);
  });

  it("rejects a non-positive weekCount", () => {
    expect(() => expandAttendanceDates({ startDate: "2026-10-04", weekCount: 0, daysOfWeek: "SUN" })).toThrow();
  });

  it("rejects an empty daysOfWeek", () => {
    expect(() => expandAttendanceDates({ startDate: "2026-10-04", weekCount: 1, daysOfWeek: "" })).toThrow();
  });
});
