// COURSE_SETUP_PLAN.md §4 step 7 / §7: turns "start date + week count +
// attendance weekdays − holidays" into the concrete calendar dates a group
// actually attends. This is what the rotation generator schedules against
// and what the grading-day check and announced schedule both read, so it
// is pure and DB-free — every caller (wizard preview, model layer, tests)
// gets the same answer from the same inputs.
import { weekdayCodeOf } from "../weekdays";

export interface AttendanceWeek {
  weekIndex: number; // 0-based
  startDate: string; // "YYYY-MM-DD", the Sunday (or startDate's weekday) this week begins on
  endDate: string; // "YYYY-MM-DD", 6 days after startDate
  dates: string[]; // attendance dates in this week, holidays already removed
}

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ExpandAttendanceDatesInput {
  startDate: string; // "YYYY-MM-DD", course week-1 anchor day
  weekCount: number;
  daysOfWeek: string; // comma-separated weekday codes, e.g. "SUN,TUE"
  holidays?: string[]; // "YYYY-MM-DD" dates to exclude
}

export function expandAttendanceDates(input: ExpandAttendanceDatesInput): AttendanceWeek[] {
  if (!input.startDate) throw new Error("startDate is required");
  if (!Number.isInteger(input.weekCount) || input.weekCount < 1) {
    throw new Error("weekCount must be a positive integer");
  }
  const allowedDays = new Set(
    input.daysOfWeek
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .filter(Boolean)
  );
  if (allowedDays.size === 0) throw new Error("daysOfWeek must include at least one weekday");
  const holidays = new Set(input.holidays ?? []);

  const weeks: AttendanceWeek[] = [];
  for (let weekIndex = 0; weekIndex < input.weekCount; weekIndex++) {
    const weekStart = addDays(input.startDate, weekIndex * 7);
    const weekEnd = addDays(weekStart, 6);
    const dates: string[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(weekStart, offset);
      if (!allowedDays.has(weekdayCodeOf(date))) continue;
      if (holidays.has(date)) continue;
      dates.push(date);
    }
    weeks.push({ weekIndex, startDate: weekStart, endDate: weekEnd, dates });
  }
  return weeks;
}
