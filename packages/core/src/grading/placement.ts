// Where a group is on a given date, for grading purposes. The rotation
// schedule is the default, but real days move (holidays, cancelled days),
// so an evaluator may also work with one of their groups on a day the
// schedule doesn't list, as long as it is near that group's rotation with
// them. Pure so it can be unit-tested; the DB lookups live in workDays.ts.
import { addDaysISO } from "../date";
import { isDateInScheduledDays } from "../weekdays";

// How far outside a rotation's dates an off-schedule day is still accepted.
export const OFF_SCHEDULE_GRACE_DAYS = 21;

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
    if (dateISO < addDaysISO(s.startDate, -graceDays) || dateISO > addDaysISO(s.endDate, graceDays)) continue;
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
