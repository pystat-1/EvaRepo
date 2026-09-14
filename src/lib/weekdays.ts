// Shared weekday vocabulary for RotationBlock.daysOfWeek — a comma list of
// these 3-letter codes, e.g. "SUN,TUE". Empty/null means "every day in the
// block's date range counts," for backward compatibility with blocks
// created before day-level scheduling existed.
export const WEEKDAYS = [
  { code: "SUN", labelAr: "أحد" },
  { code: "MON", labelAr: "اثنين" },
  { code: "TUE", labelAr: "ثلاثاء" },
  { code: "WED", labelAr: "أربعاء" },
  { code: "THU", labelAr: "خميس" },
  { code: "FRI", labelAr: "جمعة" },
  { code: "SAT", labelAr: "سبت" },
] as const;

const CODE_BY_JS_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function weekdayCodeOf(dateISO: string): string {
  return CODE_BY_JS_DAY[new Date(`${dateISO}T00:00:00Z`).getUTCDay()];
}

export function isDateInScheduledDays(dateISO: string, daysOfWeek: string | null): boolean {
  if (!daysOfWeek?.trim()) return true; // no pattern set — every day in range counts
  const allowed = daysOfWeek.split(",").map((d) => d.trim().toUpperCase());
  return allowed.includes(weekdayCodeOf(dateISO));
}
