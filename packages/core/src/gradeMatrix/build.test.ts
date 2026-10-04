import { describe, expect, it } from "vitest";
import {
  currentColumn,
  dateLayout,
  dayBoard,
  dayMatches,
  dayPosition,
  derivePeriods,
  groupDates,
  hospitalRuns,
  matchesSearch,
  meetingDates,
  resolveDayState,
  rotationLayout,
  sparkline,
  studentStats,
  weekKey,
} from "./build";
import type { MatrixDay, MatrixGroup, MatrixProgram } from "./types";

function day(p: Partial<MatrixDay> & { dateISO: string; hospitalId: string }): MatrixDay {
  return {
    state: "ok",
    attendance: "present",
    total: null,
    scores: null,
    evaluatorName: null,
    notes: null,
    feedback: null,
    dailyNote: null,
    locked: false,
    savedAt: null,
    holidayLabel: null,
    ...p,
  };
}

// Three groups rotating through three hospitals, two weeks each, meeting
// Sunday and Tuesday — the shape of the design mock-ups.
function rotatingProgram(): MatrixProgram {
  const hospitals = ["A", "B", "C"];
  const starts = ["2026-08-16", "2026-08-30", "2026-09-13"];
  const groups: MatrixGroup[] = [0, 1, 2].map((gi) => {
    const blocks = [0, 1, 2].map((k) => ({
      hospitalId: hospitals[(gi + k) % 3],
      startDate: starts[k],
      endDate: new Date(Date.parse(`${starts[k]}T00:00:00Z`) + 11 * 86_400_000).toISOString().slice(0, 10),
      daysOfWeek: "SUN,TUE",
    }));
    return {
      id: `g${gi}`,
      name: `G${gi}`,
      stints: blocks.map((b) => ({ hospitalId: b.hospitalId, start: b.startDate, end: b.endDate })),
      dates: groupDates(blocks, null),
      students: [],
    };
  });
  return { id: "MORNING", label: "صباحي", groups };
}

describe("scheduling", () => {
  it("enumerates meeting dates by weekday pattern", () => {
    expect(meetingDates("2026-08-16", "2026-08-27", "SUN,TUE")).toEqual([
      "2026-08-16",
      "2026-08-18",
      "2026-08-23",
      "2026-08-25",
    ]);
    expect(meetingDates("2026-08-20", "2026-08-16", null)).toEqual([]);
  });

  it("keys a Sunday–Thursday week by its Saturday", () => {
    expect(weekKey("2026-08-16")).toBe("2026-08-15"); // Sunday
    expect(weekKey("2026-08-20")).toBe("2026-08-15"); // Thursday
    expect(weekKey("2026-08-15")).toBe("2026-08-15"); // Saturday
    expect(weekKey("2026-08-21")).toBe("2026-08-15"); // Friday
    expect(weekKey("2026-08-22")).toBe("2026-08-22");
  });

  it("merges overlapping blocks, earlier block wins", () => {
    const dates = groupDates(
      [
        { hospitalId: "B", startDate: "2026-08-18", endDate: "2026-08-25", daysOfWeek: "TUE" },
        { hospitalId: "A", startDate: "2026-08-16", endDate: "2026-08-18", daysOfWeek: "SUN,TUE" },
      ],
      null
    );
    expect(dates).toEqual([
      { dateISO: "2026-08-16", hospitalId: "A" },
      { dateISO: "2026-08-18", hospitalId: "A" },
      { dateISO: "2026-08-25", hospitalId: "B" },
    ]);
  });
});

describe("resolveDayState", () => {
  const base = {
    dateISO: "2026-09-01",
    todayISO: "2026-09-05",
    holiday: false,
    evaluation: null,
    attendanceStatus: null,
    workDayValidated: false,
    disputed: false,
  };

  it("shows validated grades by attendance", () => {
    expect(resolveDayState({ ...base, evaluation: { pendingValidation: false, attendance: "present" } })).toBe("ok");
    expect(resolveDayState({ ...base, evaluation: { pendingValidation: false, attendance: "late" } })).toBe("late");
    expect(resolveDayState({ ...base, evaluation: { pendingValidation: false, attendance: "absent" } })).toBe("absent");
  });

  it("never shows an unvalidated evaluation as a grade", () => {
    expect(resolveDayState({ ...base, evaluation: { pendingValidation: true, attendance: "present" } })).toBe("awaiting");
    expect(
      resolveDayState({ ...base, disputed: true, evaluation: { pendingValidation: true, attendance: "present" } })
    ).toBe("awaiting");
  });

  it("flags disputes on validated days", () => {
    expect(resolveDayState({ ...base, disputed: true, evaluation: { pendingValidation: false, attendance: "present" } })).toBe(
      "disputed"
    );
  });

  it("counts an attendance-only absence once the day is validated", () => {
    expect(resolveDayState({ ...base, attendanceStatus: "absent", workDayValidated: true })).toBe("absent");
    expect(resolveDayState({ ...base, attendanceStatus: "absent" })).toBe("awaiting");
  });

  it("separates holiday, future, pending and missing", () => {
    expect(resolveDayState({ ...base, holiday: true })).toBe("holiday");
    expect(resolveDayState({ ...base, dateISO: "2026-09-06" })).toBe("future");
    expect(resolveDayState({ ...base, dateISO: "2026-09-05" })).toBe("pending");
    expect(resolveDayState({ ...base, dateISO: "2026-08-29" })).toBe("pending"); // day 7
    expect(resolveDayState({ ...base, dateISO: "2026-08-28" })).toBe("missing"); // day 8
  });
});

describe("statistics", () => {
  it("averages only validated, undisputed days", () => {
    const days = [
      day({ dateISO: "2026-08-16", hospitalId: "A", total: 12, scores: [4, 6, 1, 1, 0] }),
      day({ dateISO: "2026-08-18", hospitalId: "A", total: 9, state: "late", scores: [3, 5, 1, 0, 0] }),
      day({ dateISO: "2026-08-23", hospitalId: "B", total: 15, state: "disputed", scores: [5, 7, 1, 1, 1] }),
      day({ dateISO: "2026-08-25", hospitalId: "B", total: null, state: "absent", attendance: "absent" }),
      day({ dateISO: "2026-08-30", hospitalId: "B", total: null, state: "awaiting" }),
      day({ dateISO: "2026-09-01", hospitalId: "C", total: null, state: "holiday" }),
      day({ dateISO: "2026-09-06", hospitalId: "C", total: null, state: "future" }),
    ];
    const s = studentStats(days, 5, 15);
    expect(s.avg).toBe(10.5);
    expect(s.pct).toBe(70);
    expect(s.absences).toBe(1);
    expect(s.graded).toBe(4);
    expect(s.due).toBe(5);
    expect(s.scheduled).toBe(6);
    expect(s.hospAvg).toEqual({ A: 10.5, B: null, C: null });
    expect(s.critAvg).toEqual([3.5, 5.5, 1, 0.5, 0]);
  });

  it("filters point at the right days", () => {
    const low = day({ dateISO: "2026-08-16", hospitalId: "A", total: 8 });
    const fine = day({ dateISO: "2026-08-16", hospitalId: "A", total: 12 });
    const missing = day({ dateISO: "2026-08-16", hospitalId: "A", state: "missing" });
    expect(dayMatches("low", low, 15)).toBe(true);
    expect(dayMatches("low", fine, 15)).toBe(false);
    expect(dayMatches("attention", missing, 15)).toBe(true);
    expect(dayMatches("attention", fine, 15)).toBe(false);
    expect(dayMatches("all", missing, 15)).toBe(false);
    expect(dayMatches("missing", missing, 15)).toBe(true);
  });

  it("draws the sparkline right to left", () => {
    const days = [
      day({ dateISO: "2026-08-16", hospitalId: "A", total: 15 }),
      day({ dateISO: "2026-08-18", hospitalId: "A", total: null, state: "missing" }),
      day({ dateISO: "2026-08-23", hospitalId: "A", total: 0 }),
    ];
    const s = sparkline(days, 15, 120, 34, 4);
    expect(s.points).toBe("116.0,4.0 4.0,30.0");
    expect(s.last).toEqual({ x: 4, y: 30 });
    expect(s.lastTotal).toBe(0);
  });
});

describe("search", () => {
  it("folds Arabic letter forms and digits", () => {
    expect(matchesSearch("احمد", ["أحمد علي"])).toBe(true);
    expect(matchesSearch("فاطمه", ["فاطمة"])).toBe(true);
    expect(matchesSearch("٢٢٠١", [null, "2201347"])).toBe(true);
    expect(matchesSearch("زينب", ["علي"])).toBe(false);
    expect(matchesSearch("  ", ["x"])).toBe(true);
  });
});

describe("layouts", () => {
  it("rotation layout: hospital → week → day for every group", () => {
    const program = rotatingProgram();
    const layout = rotationLayout(program, ["A", "B", "C"], { avgColumns: true });
    // 3 hospitals × (2 weeks × 2 days + 1 average)
    expect(layout.columns).toHaveLength(15);
    expect(layout.heads[0].map((h) => [h.hospitalId, h.span])).toEqual([
      ["A", 5],
      ["B", 5],
      ["C", 5],
    ]);
    // Group 1 starts at B: its first date sits under hospital B, week 1, day 1.
    const g1 = program.groups[1];
    const firstB = layout.columns.findIndex((c) => c.kind === "day" && c.hospitalId === "B");
    expect(g1.dates[layout.slots.g1[firstB]!].dateISO).toBe("2026-08-16");
    expect(layout.slots.g1[4]).toBeNull(); // the A average column
    expect(layout.bands.g1.map((b) => [b.hospitalId, b.order, b.from, b.to])).toEqual([
      ["A", 3, "2026-09-13", "2026-09-22"],
      ["B", 1, "2026-08-16", "2026-08-25"],
      ["C", 2, "2026-08-30", "2026-09-08"],
    ]);
  });

  it("date layout: shared dates label the columns, bands follow hospitals", () => {
    const program = rotatingProgram();
    const layout = dateLayout(program, { "2026-08-18": "عطلة" });
    expect(layout.columns).toHaveLength(12);
    expect(layout.heads[0]).toHaveLength(6);
    expect(layout.heads[0][0]).toMatchObject({ label: "الأسبوع 1", span: 2, sub: "16/8 – 18/8" });
    expect(layout.heads[1][0].label).toBe("الأحد 16/8");
    expect(layout.heads[1][1].holiday).toBe(true);
    expect(layout.bands.g0.map((b) => [b.hospitalId, b.span])).toEqual([
      ["A", 4],
      ["B", 4],
      ["C", 4],
    ]);
  });

  it("date layout limited to a period keeps course week numbers", () => {
    const program = rotatingProgram();
    const layout = dateLayout(program, {}, { start: "2026-08-30", end: "2026-09-10" });
    expect(layout.columns).toHaveLength(4);
    expect(layout.heads[0].map((h) => h.label)).toEqual(["الأسبوع 3", "الأسبوع 4"]);
    expect(layout.bands.g2.map((b) => b.hospitalId)).toEqual(["A"]);
  });

  it("groups meeting on different days get numbered day columns", () => {
    const program = rotatingProgram();
    program.groups[1] = {
      ...program.groups[1],
      dates: groupDates([{ hospitalId: "B", startDate: "2026-08-16", endDate: "2026-08-27", daysOfWeek: "MON,WED" }], null),
    };
    const layout = dateLayout(program, {});
    const week1 = layout.heads[1].slice(0, 2).map((h) => h.label);
    expect(week1).toEqual(["اليوم 1", "اليوم 2"]);
  });

  it("hospital runs absorb empty columns", () => {
    const g: MatrixGroup = {
      id: "g",
      name: "g",
      stints: [],
      dates: [
        { dateISO: "2026-08-16", hospitalId: "A" },
        { dateISO: "2026-08-23", hospitalId: "B" },
      ],
      students: [],
    };
    expect(hospitalRuns(g, [null, 0, null, 1, null]).map((r) => [r.hospitalId, r.span, r.order])).toEqual([
      ["A", 3, 1],
      ["B", 2, 2],
    ]);
  });

  it("derives periods only from aligned, non-overlapping blocks", () => {
    const program = rotatingProgram();
    expect(derivePeriods(program.groups).map((p) => [p.start, p.end])).toEqual([
      ["2026-08-16", "2026-08-27"],
      ["2026-08-30", "2026-09-10"],
      ["2026-09-13", "2026-09-24"],
    ]);
    expect(derivePeriods([{ stints: [{ hospitalId: "A", start: "2026-08-16", end: "2026-08-27" }] }])).toEqual([]);
    expect(
      derivePeriods([
        {
          stints: [
            { hospitalId: "A", start: "2026-08-16", end: "2026-08-27" },
            { hospitalId: "B", start: "2026-08-20", end: "2026-09-01" },
          ],
        },
      ])
    ).toEqual([]);
  });

  it("locates a day in the course and the hospital stay", () => {
    const program = rotatingProgram();
    const g = program.groups[0];
    const i = g.dates.findIndex((d) => d.dateISO === "2026-09-08");
    expect(dayPosition(program, g, i)).toEqual({ courseWeek: 4, hospitalWeek: 2, dayInWeek: 2 });
  });
});

describe("day board", () => {
  const order = ["A", "B", "C"];
  const who = (program: MatrixProgram, column: number) => {
    const layout = dateLayout(program, {});
    return dayBoard(program, layout, column, order).map((p) => ({
      hospitalId: p.hospitalId,
      groups: p.groups.map((g) => `${program.groups[g.groupIndex].id}@${g.dateISO}`),
    }));
  };

  it("puts every group under the hospital it is at that day", () => {
    const program = rotatingProgram();
    expect(who(program, 0)).toEqual([
      { hospitalId: "A", groups: ["g0@2026-08-16"] },
      { hospitalId: "B", groups: ["g1@2026-08-16"] },
      { hospitalId: "C", groups: ["g2@2026-08-16"] },
    ]);
    // Week 3 is the second period: everyone has moved one hospital on.
    expect(who(program, 4)).toEqual([
      { hospitalId: "A", groups: ["g2@2026-08-30"] },
      { hospitalId: "B", groups: ["g0@2026-08-30"] },
      { hospitalId: "C", groups: ["g1@2026-08-30"] },
    ]);
  });

  it("points each group at its own day index", () => {
    const program = rotatingProgram();
    const layout = dateLayout(program, {});
    for (let c = 0; c < layout.columns.length; c++) {
      for (const panel of dayBoard(program, layout, c, order)) {
        for (const g of panel.groups) {
          const d = program.groups[g.groupIndex].dates[g.dateIndex];
          expect(d.hospitalId).toBe(panel.hospitalId);
          expect(d.dateISO).toBe(g.dateISO);
        }
      }
    }
  });

  it("keeps an empty panel for a hospital with no group that day", () => {
    const program = rotatingProgram();
    program.groups = program.groups.slice(0, 2);
    expect(who(program, 0)[2]).toEqual({ hospitalId: "C", groups: [] });
  });

  it("opens on the latest day that has started", () => {
    const program = rotatingProgram();
    const layout = dateLayout(program, {});
    expect(currentColumn(program, layout, "2026-08-01")).toBe(0);
    expect(currentColumn(program, layout, "2026-08-19")).toBe(1); // Wed after the first Tuesday
    expect(currentColumn(program, layout, "2026-08-30")).toBe(4);
    expect(currentColumn(program, layout, "2026-12-01")).toBe(11);
  });
});
