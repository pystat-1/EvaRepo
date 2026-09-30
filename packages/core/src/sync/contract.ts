// The sync contract between Eva Desktop, the relay and the evaluator phone
// app (docs/adr/0002). Plain data, versioned by `BUNDLE_FORMAT`; every
// side validates what it receives with the checkers below.

import type { Attendance } from "../grading/validation";

export const BUNDLE_FORMAT = 1;

/** What an evaluator's phone downloads: everything needed to grade offline. */
export interface EvaluatorBundle {
  format: typeof BUNDLE_FORMAT;
  version: string; // content hash: unchanged bundles are not re-sent
  generatedAt: string;
  evaluator: { id: string; name: string };
  course: { id: string; label: string; startDate: string | null };
  hospitals: Array<{ id: string; name: string }>;
  groups: Array<{
    id: string;
    name: string;
    shift: "MORNING" | "EVENING" | null;
    students: Array<{ id: string; name: string; universityNumber: string }>;
  }>;
  /** Rotation blocks at this evaluator's hospitals (same shape as @eva/core placement stints). */
  stints: Array<{ groupId: string; hospitalId: string; hospitalName: string; startDate: string; endDate: string; daysOfWeek: string | null }>;
  rubric: Array<{
    id: string;
    labelAr: string;
    maxScore: number;
    items: Array<{ id: string; labelAr: string; maxScore: number; kind: "check" | "number" }>;
  }>;
  /**
   * Validated days already on the desktop for this evaluator's groups at
   * their hospitals (theirs and a colleague's): previous assessments, the
   * attendance log and student records, all readable offline.
   */
  history?: HistoryDay[];
}

/** One student's validated grade as the desktop holds it. */
export interface HistoryRecord {
  studentId: string;
  attendance: Attendance;
  dailyNote: boolean | null;
  total: number;
  /** rubricSectionId -> section score. */
  sections: Record<string, number>;
  /** rubricItemId -> score, when graded item by item (older website grades have sections only). */
  items: Record<string, number> | null;
  notes?: string;
}

export interface HistoryDay {
  groupId: string;
  dateISO: string;
  hospitalId: string | null;
  evaluatorId: string;
  evaluatorName: string;
  records: HistoryRecord[];
}


/** One student's grade inside a validated day. */
export interface DayRecord {
  studentId: string;
  attendance: Attendance;
  dailyNote: boolean | null;
  /** rubricItemId -> score for sections with items; rubricSectionId -> score for sections without. */
  scores: Record<string, number>;
  notes?: string;
}

/** A validated group-day (اعتماد): the unit the phone sends and the desktop applies. */
export interface DaySubmission {
  clientId: string; // made on the phone; resending is harmless (idempotent)
  kind: "day";
  evaluatorId: string; // set by the relay from the session, never trusted from the phone
  groupId: string;
  dateISO: string;
  bundleVersion: string;
  validatedAt: string; // phone clock, informational only
  records: DayRecord[];
}

export type SubmissionOutcome = "applied" | "conflict" | "rejected";

export interface SubmissionResult {
  clientId: string;
  outcome: SubmissionOutcome;
  message: string;
}

const isStr = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Shape check for a submission coming from a phone. Returns an Arabic problem, or null. */
export function checkDaySubmission(s: unknown): string | null {
  if (!s || typeof s !== "object") return "طلب غير صالح";
  const d = s as Record<string, unknown>;
  if (d.kind !== "day") return "نوع غير معروف";
  if (!isStr(d.clientId, 80) || !isStr(d.groupId, 80) || !isStr(d.bundleVersion, 80)) return "حقول ناقصة";
  if (typeof d.dateISO !== "string" || !ISO_DAY.test(d.dateISO)) return "تاريخ غير صالح";
  if (!Array.isArray(d.records) || d.records.length === 0 || d.records.length > 300) return "لا توجد سجلات";
  for (const r of d.records as unknown[]) {
    const x = r as Record<string, unknown>;
    if (!x || !isStr(x.studentId, 80)) return "سجل طالب غير صالح";
    if (!["present", "late", "absent"].includes(x.attendance as string)) return "حالة حضور غير صالحة";
    if (x.dailyNote !== null && typeof x.dailyNote !== "boolean") return "قيمة الملاحظة اليومية غير صالحة";
    if (!x.scores || typeof x.scores !== "object") return "الدرجات مفقودة";
    for (const v of Object.values(x.scores as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) return "درجة غير صالحة";
    }
    if (x.notes !== undefined && (typeof x.notes !== "string" || x.notes.length > 2000)) return "ملاحظات طويلة جدًا";
  }
  return null;
}
