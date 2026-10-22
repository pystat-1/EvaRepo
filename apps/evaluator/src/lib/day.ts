// Grading rules on the phone. Pure functions: which groups to show today,
// a day's completeness, totals, and the validated-day package the relay
// receives. The desktop re-checks everything when it applies the day.
import type { DayRecord, DaySubmission, EvaluatedDay, EvaluatorBundle, GuestInfo } from "@eva/core/sync/contract";
import { pickPlacement, OFF_SCHEDULE_GRACE_DAYS } from "@eva/core/grading/placement";
import { addDaysISO } from "@eva/core/date";
import { withMakeupDays } from "@eva/core/schedule/holidays";
import { rubricFor, type ScoringMode } from "@eva/core/grading/scoring";

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
  /** Hosted students added to this day (studentId -> who they are), in the order added. */
  guests?: Record<string, GuestInfo>;
  /** «الدرجات المعدّلة» for this day: discussion 2.5 + 2.5 + quiz 2. Absent = standard. */
  scoring?: ScoringMode;
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

/** The holiday on a date, if the admin declared one. */
export const holidayOn = (bundle: EvaluatorBundle, dateISO: string) => (bundle.holidays ?? []).find((h) => h.dateISO === dateISO) ?? null;

/**
 * Groups this evaluator can grade on a date: scheduled first (a holiday's
 * make-up day counts; the holiday itself does not), then the others.
 */
export function groupsForDate(bundle: EvaluatorBundle, dateISO: string): DayGroup[] {
  const stints = withMakeupDays(bundle.stints, bundle.holidays ?? []);
  const holiday = !!holidayOn(bundle, dateISO);
  const out: DayGroup[] = [];
  for (const g of bundle.groups) {
    const p = pickPlacement(stints, g.id, dateISO, OFF_SCHEDULE_GRACE_DAYS);
    if (p) out.push({ id: g.id, name: g.name, shift: g.shift, hospitalName: p.hospitalName, scheduled: p.scheduled && !holiday, studentCount: g.students.length });
  }
  const rank = (g: DayGroup) => (g.scheduled ? 0 : 2) + (g.shift === "EVENING" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ar", { numeric: true }));
}

/**
 * The bundle as one day is graded: its rubric is the course's, or the
 * modified one (discussion 2.5 + 2.5 + quiz 2). Everything that reads the
 * rubric for that day (table, card, totals, files, the package) uses it.
 */
export function dayBundle(bundle: EvaluatorBundle, mode: ScoringMode | undefined): EvaluatorBundle {
  return mode === "modified" ? { ...bundle, rubric: rubricFor(bundle.rubric, mode) } : bundle;
}

/** Columns of the grading table: every rubric item, or the section itself when it has no items. */
export function gradeColumns(bundle: EvaluatorBundle) {
  return bundle.rubric.flatMap((s) =>
    s.items.length
      ? s.items.map((i, n) => ({ id: i.id, label: i.labelAr, section: s.labelAr, max: i.maxScore, kind: i.kind, first: n === 0 }))
      : [{ id: s.id, label: s.labelAr, section: s.labelAr, max: s.maxScore, kind: "number" as const, first: true }]
  );
}

export type CompactColumn =
  | { kind: "number"; id: string; label: string; max: number }
  | { kind: "checks"; id: string; label: string; max: number; items: Array<{ id: string; max: number }> };

/**
 * Columns of the phone table, narrow enough to fit a phone's width: a
 * section of checkboxes becomes one tap cell (all or none; the student's
 * card edits single items), a number item keeps its own cell.
 */
export function compactColumns(bundle: EvaluatorBundle): CompactColumn[] {
  return bundle.rubric.flatMap((s): CompactColumn[] => {
    if (!s.items.length) return [{ kind: "number", id: s.id, label: s.labelAr, max: s.maxScore }];
    if (s.items.every((i) => i.kind === "check")) return [{ kind: "checks", id: s.id, label: s.labelAr, max: s.maxScore, items: s.items.map((i) => ({ id: i.id, max: i.maxScore })) }];
    return s.items.map((i): CompactColumn =>
      i.kind === "check"
        ? { kind: "checks", id: i.id, label: i.labelAr, max: i.maxScore, items: [{ id: i.id, max: i.maxScore }] }
        : { kind: "number", id: i.id, label: i.labelAr, max: i.maxScore }
    );
  });
}

export const maxTotal =(bundle: EvaluatorBundle) => bundle.rubric.reduce((a, s) => a + s.maxScore, 0);

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

/** A student in a day's list: one of the group, or a hosted student (guest). */
export type DayStudent = EvaluatorBundle["groups"][number]["students"][number] & { guest?: GuestInfo };

/** The day's list: the group's students, then the hosted students added to the day. */
export function dayStudents(bundle: EvaluatorBundle, groupId: string, guests: Record<string, GuestInfo> | undefined): DayStudent[] {
  const g = bundle.groups.find((x) => x.id === groupId);
  const hosted = Object.entries(guests ?? {}).map(([id, guest]): DayStudent => ({ id, name: guest.name, universityNumber: guest.universityNumber, guest }));
  return [...(g?.students ?? []), ...hosted];
}

/** Groups of the course a hosted student can come from: of that study type, not the host group. */
export function guestGroups(bundle: EvaluatorBundle, hostGroupId: string, shift: "MORNING" | "EVENING") {
  return (bundle.directory ?? []).filter((g) => g.id !== hostGroupId && g.shift === shift);
}

/** The days a student of the course was already evaluated (newest first), wherever it was. */
export function evaluatedDays(bundle: EvaluatorBundle, studentId: string): EvaluatedDay[] {
  for (const g of bundle.directory ?? []) {
    const s = g.students.find((x) => x.id === studentId);
    if (s) return s.evaluated ?? [];
  }
  return [];
}

/** Why a hosted student cannot be added to the day, or null. */
export function guestProblem(bundle: EvaluatorBundle, groupId: string, draft: Draft | undefined, guest: GuestInfo): string | null {
  if (!guest.name.trim()) return "اكتب اسم الطالب";
  if (!guest.universityNumber.trim()) return "اكتب الرقم الجامعي";
  if (!guest.homeGroupName.trim()) return "اختر مجموعة الطالب أو اكتبها";
  const number = guest.universityNumber.trim();
  if (dayStudents(bundle, groupId, draft?.guests).some((s) => s.universityNumber.trim() === number)) return "هذا الطالب في قائمة اليوم أصلًا";
  return null;
}

/** What still blocks validation: students without attendance, and present students not graded. */
export function missing(bundle: EvaluatorBundle, groupId: string, draft: Draft | undefined) {
  const noAttendance: string[] = [];
  const notGraded: string[] = [];
  for (const s of dayStudents(bundle, groupId, draft?.guests)) {
    const row = draft?.rows[s.id];
    if (!row?.attendance) noAttendance.push(s.name);
    else if (row.attendance !== "absent" && !row.touched) notGraded.push(s.name);
  }
  return { noAttendance, notGraded, ok: noAttendance.length === 0 && notGraded.length === 0 };
}

/** The package sent to the relay when the evaluator validates (اعتماد) the day. */
export function buildSubmission(bundle: EvaluatorBundle, draft: Draft, clientId: string, now: Date): DaySubmission {
  return {
    clientId,
    kind: "day",
    evaluatorId: bundle.evaluator.id,
    groupId: draft.groupId,
    dateISO: draft.dateISO,
    bundleVersion: bundle.version,
    validatedAt: now.toISOString(),
    ...(draft.scoring === "modified" ? { scoring: "modified" as const } : {}),
    records: dayStudents(bundle, draft.groupId, draft.guests).map((s) => {
      const r = draft.rows[s.id]!;
      const absent = r.attendance === "absent";
      return {
        studentId: s.id,
        attendance: r.attendance!,
        dailyNote: absent ? null : r.dailyNote,
        scores: absent ? {} : r.scores,
        ...(r.notes?.trim() ? { notes: r.notes.trim() } : {}),
        ...(s.guest ? { guest: s.guest } : {}),
      };
    }),
  };
}

/** Drafts from before today that were never validated (the reminder). */
export function overdueDrafts(drafts: Draft[], todayISO: string): Draft[] {
  return drafts.filter((d) => d.status === "draft" && d.dateISO < todayISO && d.dateISO >= addDaysISO(todayISO, -14));
}
