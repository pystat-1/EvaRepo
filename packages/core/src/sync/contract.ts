// The sync contract between Eva Desktop, the relay and the evaluator phone
// app (docs/adr/0002). Plain data, versioned by `BUNDLE_FORMAT`; every
// side validates what it receives with the checkers below.

import type { Attendance } from "../grading/validation";
import type { Holiday } from "../schedule/holidays";

export const BUNDLE_FORMAT = 1;

/** What an evaluator's phone downloads: everything needed to grade offline. */
export interface EvaluatorBundle {
  format: typeof BUNDLE_FORMAT;
  version: string; // content hash: unchanged bundles are not re-sent
  generatedAt: string;
  /** `supervisor`: this bundle holds the whole course (every hospital, group and day) and the team. */
  evaluator: { id: string; name: string; supervisor?: boolean };
  course: { id: string; label: string; startDate: string | null };
  hospitals: Array<{ id: string; name: string }>;
  groups: Array<{
    id: string;
    name: string;
    shift: "MORNING" | "EVENING" | null;
    /**
     * `units`: the hospital unit (القسم) the student is in, by date
     * ("YYYY-MM-DD" -> "العناية"). Optional: older bundles have none.
     */
    students: Array<{ id: string; name: string; universityNumber: string; units?: Record<string, string> }>;
  }>;
  /** Rotation blocks at this evaluator's hospitals (same shape as @eva/core placement stints). */
  stints: Array<{ groupId: string; hospitalId: string; hospitalName: string; startDate: string; endDate: string; daysOfWeek: string | null }>;
  /**
   * The course's holidays: no attendance that day; with `movedTo`, the
   * groups meeting that day meet on `movedTo` instead (same hospital).
   * Optional: bundles from before holidays existed have none.
   */
  holidays?: Holiday[];
  /** In the order of the college's paper form (right to left). labelEn = the form's wording. */
  rubric: Array<{
    id: string;
    labelAr: string;
    labelEn?: string | null;
    maxScore: number;
    items: Array<{ id: string; labelAr: string; labelEn?: string | null; maxScore: number; kind: "check" | "number" }>;
  }>;
  /**
   * Validated days already on the desktop for this evaluator's groups at
   * their hospitals (theirs and a colleague's): previous assessments, the
   * attendance log and student records, all readable offline.
   */
  history?: HistoryDay[];
  /** Supervisors only: every evaluator of the course and their activity. */
  team?: TeamMember[];
  /**
   * Every group of the course with its students, to add a hosted student
   * (طالب مستضاف) from another group, and the days each was already
   * evaluated. Optional: older bundles have none.
   */
  directory?: DirectoryGroup[];
}

/** A group of the course as the hosted-student picker sees it. */
export interface DirectoryGroup {
  id: string;
  name: string;
  shift: "MORNING" | "EVENING" | null;
  students: Array<{ id: string; name: string; universityNumber: string; evaluated?: EvaluatedDay[] }>;
}

/** One validated evaluation of a student, wherever it was given. */
export interface EvaluatedDay {
  dateISO: string;
  groupName: string;
  hospitalName: string;
  evaluatorName: string;
  attendance: Attendance;
  total: number;
}

/**
 * A hosted student (طالب مستضاف): graded for one day with a group they
 * are not in. `same-shift`: from another group of the same study type;
 * `other-shift`: from the other study type (صباحي / مسائي).
 */
export interface GuestInfo {
  kind: "same-shift" | "other-shift";
  /** Their own group: picked from the course (its id), or typed when it is not listed (null). */
  homeGroupId: string | null;
  homeGroupName: string;
  shift: "MORNING" | "EVENING";
  name: string;
  universityNumber: string;
  /** «قُيّم في مجموعته»: what the evaluator records about an evaluation in their own group. */
  priorEvaluation?: PriorEvaluation | null;
}

export interface PriorEvaluation {
  dateISO?: string;
  evaluatorName?: string;
  total?: number;
  notes?: string;
}

/** One evaluator as a supervisor sees them on the phone (المقيّمون). */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  active: boolean;
  supervisor: boolean;
  /** What they cover in this course: a hospital, and one group or (null) all of its groups. */
  covers: Array<{ hospitalName: string; groupName: string | null }>;
  /** Their last Google sign-in on a phone, if any. */
  phone: { googleName: string | null; lastLoginAt: string; lastSeenAt: string | null } | null;
  /** From their phone: last day received, days applied, conflicts waiting for the manager. */
  lastReceivedAt: string | null;
  daysApplied: number;
  openConflicts: number;
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
  /** A hosted student: who they are (they are not in the group's list). */
  guest?: GuestInfo;
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
  /** A hosted student (not in the group's list); their studentId may be one made on the phone. */
  guest?: GuestInfo;
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

/** Shape check for a hosted student's details. Returns an Arabic problem, or null. */
export function checkGuest(g: unknown): string | null {
  if (!g || typeof g !== "object") return "بيانات الطالب المستضاف غير صالحة";
  const x = g as Record<string, unknown>;
  if (x.kind !== "same-shift" && x.kind !== "other-shift") return "نوع الاستضافة غير معروف";
  if (x.shift !== "MORNING" && x.shift !== "EVENING") return "نوع الدراسة غير صالح";
  if (!isStr(x.name) || !isStr(x.universityNumber, 80) || !isStr(x.homeGroupName)) return "بيانات الطالب المستضاف ناقصة";
  if (x.homeGroupId !== null && !isStr(x.homeGroupId, 80)) return "مجموعة الطالب المستضاف غير صالحة";
  const p = x.priorEvaluation;
  if (p !== undefined && p !== null) {
    if (typeof p !== "object") return "بيانات التقييم السابق غير صالحة";
    const q = p as Record<string, unknown>;
    if (q.dateISO !== undefined && (typeof q.dateISO !== "string" || !ISO_DAY.test(q.dateISO))) return "تاريخ التقييم السابق غير صالح";
    if (q.evaluatorName !== undefined && (typeof q.evaluatorName !== "string" || q.evaluatorName.length > 200)) return "اسم مقيّم التقييم السابق طويل جدًا";
    if (q.total !== undefined && (typeof q.total !== "number" || !Number.isFinite(q.total) || q.total < 0)) return "درجة التقييم السابق غير صالحة";
    if (q.notes !== undefined && (typeof q.notes !== "string" || q.notes.length > 2000)) return "ملاحظة التقييم السابق طويلة جدًا";
  }
  return null;
}

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
    if (x.guest !== undefined) {
      const problem = checkGuest(x.guest);
      if (problem) return problem;
    }
  }
  const ids = (d.records as Array<{ studentId: string }>).map((x) => x.studentId);
  if (new Set(ids).size !== ids.length) return "طالب مكرر في اليوم";
  const guestNumbers = (d.records as Array<{ guest?: GuestInfo }>).flatMap((x) => (x.guest ? [x.guest.universityNumber.trim()] : []));
  if (new Set(guestNumbers).size !== guestNumbers.length) return "طالب مستضاف مكرر في اليوم";
  return null;
}
