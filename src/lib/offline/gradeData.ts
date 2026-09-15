import { isDateInScheduledDays } from "@/lib/weekdays";
import type { RubricSection } from "@/lib/models/rubric";
import type { Attendance } from "@/lib/models/evaluations";
import { findOfflineStudent, getOfflineRubricSections, getOfflineEvaluation, getOfflineSchedule, getOutboxEntry } from "./db";

// The subset of a saved (or queued) evaluation the grading form needs to
// pre-fill its fields — a common shape for both the server's
// EvaluationWithScores and an offline OutboxEntry.
export interface ExistingForForm {
  attendance: Attendance;
  notes: string | null;
  feedback: string | null;
  scores: Record<string, number>;
}

export interface GradeViewData {
  ok: true;
  dateISO: string;
  student: { nameAr: string; nameEn: string | null; universityNumber: string };
  hospitalName: string;
  sections: RubricSection[];
  maxTotal: number;
  existing: ExistingForForm | null;
}

export type GradeViewFailure = {
  ok: false;
  reason: "out_of_scope" | "not_scheduled" | "not_covered" | "not_found";
  hospitalName?: string;
};

export type GradeViewResult = GradeViewData | GradeViewFailure;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Rebuilds the same "can this evaluator grade this student today, and with
// what rubric/existing-answers" view the /api/grade/[studentId] route
// computes from Prisma, but from the Phase 4b IndexedDB cache. A stint only
// appears in the cached schedule if the evaluator's own assignments cover
// it (see getEvaluatorSchedule), so finding a matching stint here already
// implies "covered" — there's no separate not_covered case offline.
export async function loadOfflineGradeData(studentId: string): Promise<GradeViewResult> {
  const dateISO = todayISO();
  const found = await findOfflineStudent(studentId);
  if (!found) return { ok: false, reason: "out_of_scope" };

  const schedule = (await getOfflineSchedule()) ?? [];
  const stint = schedule.find(
    (s) =>
      s.groupId === found.groupId &&
      s.startDate <= dateISO &&
      s.endDate >= dateISO &&
      isDateInScheduledDays(dateISO, s.daysOfWeek)
  );
  if (!stint) return { ok: false, reason: "not_scheduled" };

  const sections = (await getOfflineRubricSections()) ?? [];
  const maxTotal = sections.reduce((sum, s) => sum + s.maxScore, 0);

  // A not-yet-synced local save takes priority over the last-known server
  // evaluation, so reopening the form offline shows what was actually
  // queued, not stale imported data.
  const queued = await getOutboxEntry(studentId, dateISO);
  const saved = queued ? undefined : await getOfflineEvaluation(studentId, dateISO);
  const existing: ExistingForForm | null = queued
    ? { attendance: queued.attendance, notes: queued.notes ?? null, feedback: queued.feedback ?? null, scores: queued.scores }
    : saved
    ? { attendance: saved.attendance, notes: saved.notes, feedback: saved.feedback, scores: saved.scores }
    : null;

  return {
    ok: true,
    dateISO,
    student: { nameAr: found.student.nameAr, nameEn: found.student.nameEn, universityNumber: found.student.universityNumber },
    hospitalName: stint.hospitalName,
    sections,
    maxTotal,
    existing,
  };
}
