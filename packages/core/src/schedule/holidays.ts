// Holidays (العطل) and the days they move to. A holiday is a course-wide
// date with no attendance; when it has `movedTo`, every group that met on
// it meets on `movedTo` instead, at the same hospital (a make-up day). The
// rotation blocks stay as they are: make-up days are derived here, so the
// desktop, the Grading Center and the phones all read the same answer.
import { isDateInScheduledDays, weekdayCodeOf } from "../weekdays";

export interface Holiday {
  dateISO: string;
  label: string | null;
  movedTo: string | null;
}

interface StintLike {
  groupId: string;
  startDate: string;
  endDate: string;
  daysOfWeek: string | null;
}

/** Does this block meet on this date (in its range, on one of its weekdays)? */
export function meetsOn(s: { startDate: string; endDate: string; daysOfWeek: string | null }, dateISO: string): boolean {
  return s.startDate <= dateISO && dateISO <= s.endDate && isDateInScheduledDays(dateISO, s.daysOfWeek);
}

/**
 * One-day blocks for the make-up days: a copy of each block that meets on a
 * moved holiday, dated on the day it moved to (its weekday as the only
 * meeting day, so every reader sees it as a scheduled day).
 */
export function makeupStints<S extends StintLike>(stints: S[], holidays: Holiday[]): Array<S & { makeupFor: string }> {
  const out: Array<S & { makeupFor: string }> = [];
  for (const h of holidays) {
    if (!h.movedTo) continue;
    for (const s of stints) {
      if (meetsOn(s, h.dateISO)) out.push({ ...s, startDate: h.movedTo, endDate: h.movedTo, daysOfWeek: weekdayCodeOf(h.movedTo), makeupFor: h.dateISO });
    }
  }
  return out;
}

/** The blocks plus the make-up days, for placement (which hospital, scheduled or not). */
export function withMakeupDays<S extends StintLike>(stints: S[], holidays: Holiday[]): S[] {
  return [...stints, ...makeupStints(stints, holidays)];
}
