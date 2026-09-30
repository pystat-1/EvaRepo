// Grading rules on the phone. Pure functions: which groups to show today,
// a day's completeness, totals, and the validated-day package the relay
// receives. The desktop re-checks everything when it applies the day.
import type { DayRecord, DaySubmission, EvaluatorBundle } from "@eva/core/sync/contract";
import { pickPlacement, OFF_SCHEDULE_GRACE_DAYS } from "@eva/core/grading/placement";
import { addDaysISO } from "@eva/core/date";

export type Attendance = DayRecord["attendance"];

/** One student's row while grading (a draft until the day is validated). */
export interface DraftRow {
  attendance: Attendance | null;
  dailyNote: boolean | null;
  scores: Record<string, number>; // rubric item id (or section id) -> score
  touched: boolean; // a score was entered (a present student with nothing entered is "not graded")
  notes?: string;
}

export interface Draft {
  key: string; // `${groupId}:${dateISO}`
  groupId: string;
  dateISO: string;
  rows: Record<string, DraftRow>; // studentId -> row
  status: "draft" | "validated";
  clientId?: string;
  updatedAt: string;
}

export const draftKey = (groupId: string, dateISO: string) => `${groupId}:${dateISO}`;

export interface DayGroup {
  id: string;
  name: string;
  shift: "MORNING" | "EVENING" | null;
  hospitalName: string;
  scheduled: boolean;
  studentCount: number;
}

/** Groups this evaluator can grade on a date: scheduled first, then nearby (holiday-moved) ones. */
export function groupsForDate(bundle: EvaluatorBundle, dateISO: string): DayGroup[] {
  const out: DayGroup[] = [];
  for (const g of bundle.groups) {
    const p = pickPlacement(bundle.stints, g.id, dateISO, OFF_SCHEDULE_GRACE_DAYS);
    if (p) out.push({ id: g.id, name: g.name, shift: g.shift, hospitalName: p.hospitalName, scheduled: p.scheduled, studentCount: g.students.length });
  }
  const rank = (g: DayGroup) => (g.scheduled ? 0 : 2) + (g.shift === "EVENING" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ar", { numeric: true }));
}

/** Columns of the grading table: every rubric item, or the section itself when it has no items. */
export function gradeColumns(bundle: EvaluatorBundle) {
  return bundle.rubric.flatMap((s) =>
    s.items.length
      ? s.items.map((i, n) => ({ id: i.id, label: i.labelAr, section: s.labelAr, max: i.maxScore, kind: i.kind, first: n === 0 }))
      : [{ id: s.id, label: s.labelAr, section: s.labelAr, max: s.maxScore, kind: "number" as const, first: true }]
  );
}

export const maxTotal = (bundle: EvaluatorBundle) => bundle.rubric.reduce((a, s) => a + s.maxScore, 0);

export function rowTotal(bundle: EvaluatorBundle, row: DraftRow | undefined): number {
  if (!row || row.attendance === "absent") return 0;
  let total = 0;
  for (const s of bundle.rubric) {
    const ids = s.items.length ? s.items.map((i) => i.id) : [s.id];
    const sum = ids.reduce((a, id) => a + (row.scores[id] ?? 0), 0);
    total += Math.min(sum, s.maxScore);
  }
  return Math.round(total * 100) / 100;
}

/** What still blocks validation: students without attendance, and present students not graded. */
export function missing(bundle: EvaluatorBundle, groupId: string, draft: Draft | undefined) {
  const g = bundle.groups.find((x) => x.id === groupId);
  const noAttendance: string[] = [];
  const notGraded: string[] = [];
  for (const s of g?.students ?? []) {
    const row = draft?.rows[s.id];
    if (!row?.attendance) noAttendance.push(s.name);
    else if (row.attendance !== "absent" && !row.touched) notGraded.push(s.name);
  }
  return { noAttendance, notGraded, ok: noAttendance.length === 0 && notGraded.length === 0 };
}

/** The package sent to the relay when the evaluator validates (اعتماد) the day. */
export function buildSubmission(bundle: EvaluatorBundle, draft: Draft, clientId: string, now: Date): DaySubmission {
  const g = bundle.groups.find((x) => x.id === draft.groupId)!;
  return {
    clientId,
    kind: "day",
    evaluatorId: bundle.evaluator.id,
    groupId: draft.groupId,
    dateISO: draft.dateISO,
    bundleVersion: bundle.version,
    validatedAt: now.toISOString(),
    records: g.students.map((s) => {
      const r = draft.rows[s.id]!;
      const absent = r.attendance === "absent";
      return {
        studentId: s.id,
        attendance: r.attendance!,
        dailyNote: absent ? null : r.dailyNote,
        scores: absent ? {} : r.scores,
        ...(r.notes?.trim() ? { notes: r.notes.trim() } : {}),
      };
    }),
  };
}

/** Drafts from before today that were never validated (the reminder). */
export function overdueDrafts(drafts: Draft[], todayISO: string): Draft[] {
  return drafts.filter((d) => d.status === "draft" && d.dateISO < todayISO && d.dateISO >= addDaysISO(todayISO, -14));
}
