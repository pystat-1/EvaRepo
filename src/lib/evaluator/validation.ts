// EVALUATOR_APP_PLAN.md §2.6 "Server checks on every save" — the parts that
// are pure business rules (not DB lookups) live here so both the current
// admin/evaluator save path (src/lib/models/evaluations.ts) and the future
// offline-submission API (E3) can share one tested implementation instead
// of duplicating (and drifting on) these rules.
import { addDaysISO } from "../date";

export type Attendance = "present" | "absent" | "late";

export interface RubricSectionForValidation {
  id: string;
  labelAr: string;
  maxScore: number;
}

// Fixes defect C6 (NaN scores pass validation) and adds the two checks the
// old code never had at all: every active section must be present, and
// every score must land on a 0.5 step. Throws a single Arabic message on
// the first violation found, matching the existing error-throwing
// convention in evaluations.ts.
export function validateScores(
  scores: Record<string, number>,
  sections: RubricSectionForValidation[]
): void {
  for (const section of sections) {
    if (!(section.id in scores)) {
      throw new Error(`الدرجة في "${section.labelAr}" مطلوبة`);
    }
  }
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  for (const [sectionId, score] of Object.entries(scores)) {
    const section = sectionById.get(sectionId);
    if (!section) throw new Error("قسم تقييم غير معروف");
    if (!Number.isFinite(score)) {
      throw new Error(`الدرجة في "${section.labelAr}" غير صالحة`);
    }
    if (score < 0 || score > section.maxScore) {
      throw new Error(`الدرجة في "${section.labelAr}" يجب أن تكون بين 0 و ${section.maxScore}`);
    }
    if (Math.round(score * 2) !== score * 2) {
      throw new Error(`الدرجة في "${section.labelAr}" يجب أن تكون بخطوات 0.5`);
    }
  }
}

// Plan §2.6 point 5: "Absent forces all scores to 0" — a normalization
// applied before validation, not a way to skip it, so an absent day still
// always has every active section present (all zero).
export function normalizeScoresForAttendance(
  attendance: Attendance,
  scores: Record<string, number>,
  sections: RubricSectionForValidation[]
): Record<string, number> {
  if (attendance !== "absent") return scores;
  return Object.fromEntries(sections.map((s) => [s.id, 0]));
}

// Fixes defect C5 (server accepted any scheduled dateISO — backdating or
// grading ahead of time). Plan §2.4: "An evaluation dated D can be
// submitted or synced from D up to the end of D + 7", measured in Baghdad
// time — so this never looks at the wall clock itself, only the caller's
// `todayISO` (from src/lib/date.ts's todayISO()) and the date being graded.
export function isWithinSubmissionWindow(dateISO: string, todayISO: string, windowDays = 7): boolean {
  if (dateISO > todayISO) return false; // can't grade a day that hasn't happened yet
  return todayISO <= addDaysISO(dateISO, windowDays);
}
