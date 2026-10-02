// Single source of truth for "today" across the app. Everything that gates
// on the current date — the evaluator schedule, grade-day checks, /my,
// exports, statistics — must agree on which calendar day it is, and that day
// must be the LOCAL day in Iraq, not UTC. Deriving it from
// `new Date().toISOString()` (UTC) meant that between local midnight and
// 03:00 the app thought it was still yesterday, mis-gating grading and the
// schedule. Asia/Baghdad is UTC+3 (no DST since 2015); Intl handles it
// correctly (and would follow any future DST change automatically).
export const APP_TIME_ZONE = "Asia/Baghdad";

// "YYYY-MM-DD" for the current moment in the app's timezone. Works the same
// on the server (models, API routes) and in the browser (offline grading).
export function todayISO(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the ISO date shape we store.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Pure calendar-day arithmetic on "YYYY-MM-DD" strings, shared by the
// attendance-date expander (COURSE_SETUP_PLAN.md) and the evaluator app's
// submission window (EVALUATOR_APP_PLAN.md §2.4) — both need "N days after
// this date" without caring about time-of-day or timezone at all, since the
// dates are already plain calendar days by the time they get here.
export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "08:42 ص" style clock time in Baghdad, for attendance marks.
export function formatTimeBaghdad(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ar-IQ-u-nu-latn", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}
