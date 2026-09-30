// Where a group is on a given date, for grading purposes. The rotation
// schedule is guidance, never a limit: real days move (holidays, cancelled
// days, catch-up days), so an evaluator may work with any of their groups
// on any date. A day the schedule lists is "scheduled"; any other day is
// recorded as off-schedule at the hospital of the nearest rotation block.
// Pure so it can be unit-tested; the DB lookups live in workDays.ts.
import { addDaysISO } from "../date";
import { isDateInScheduledDays } from "../weekdays";

// How far outside a rotation's dates an off-schedule day is accepted:
// without limit (callers may still pass a number, e.g. to rank suggestions).
export const OFF_SCHEDULE_GRACE_DAYS = Infinity;

export interface StintForPlacement {
  groupId: string;
  hospitalId: string;
  hospitalName: string;
  startDate: string;
  endDate: string;
  daysOfWeek: string | null;
}

export interface Placement {
  hospitalId: string;
  hospitalName: string;
  scheduled: boolean;
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}

export function pickPlacement(
  stints: StintForPlacement[],
  groupId: string,
  dateISO: string,
  graceDays = OFF_SCHEDULE_GRACE_DAYS
): Placement | null {
  const mine = stints.filter((s) => s.groupId === groupId);
  const meeting = mine.find(
    (s) => s.startDate <= dateISO && s.endDate >= dateISO && isDateInScheduledDays(dateISO, s.daysOfWeek)
  );
  if (meeting) return { hospitalId: meeting.hospitalId, hospitalName: meeting.hospitalName, scheduled: true };

  let best: StintForPlacement | null = null;
  let bestDistance = Infinity;
  for (const s of mine) {
    if (Number.isFinite(graceDays) && (dateISO < addDaysISO(s.startDate, -graceDays) || dateISO > addDaysISO(s.endDate, graceDays))) continue;
    const distance =
      dateISO >= s.startDate && dateISO <= s.endDate
        ? 0
        : Math.min(dayDistance(dateISO, s.startDate), dayDistance(dateISO, s.endDate));
    if (distance < bestDistance) {
      best = s;
      bestDistance = distance;
    }
  }
  return best ? { hospitalId: best.hospitalId, hospitalName: best.hospitalName, scheduled: false } : null;
}
