// The Grading Center matrix: everything the three grade views (combined,
// rotation grid, heatmap) need, built once on the server and handed to the
// client as plain JSON. See docs/GRADING_CENTER_PLAN.md (addendum) for the
// design these views implement.

// What a (student, scheduled day) cell shows. Only validated evaluations
// (pendingValidation = false) ever carry grades into these views.
export type DayState =
  | "ok" // validated grade, present
  | "late" // validated grade, arrived late
  | "absent" // validated absence (with or without an evaluation row)
  | "disputed" // two evaluators disagree — waits for the admin's decision
  | "awaiting" // the evaluator saved this day but hasn't validated (اعتماد) it yet
  | "pending" // nothing saved yet, still inside the 7-day window
  | "missing" // nothing saved and the 7-day window has passed
  | "future" // not reached yet
  | "holiday"; // official holiday — no attendance expected

export type Attendance = "present" | "late" | "absent";

export interface MatrixCriterion {
  id: string;
  label: string;
  max: number;
}

export interface MatrixHospital {
  id: string;
  name: string;
  color: string; // categorical hue, always shown next to the name
}

export interface MatrixDay {
  dateISO: string;
  hospitalId: string;
  state: DayState;
  attendance: Attendance | null;
  total: number | null; // null unless the day has a validated evaluation
  scores: (number | null)[] | null; // aligned to criteria
  evaluatorName: string | null;
  notes: string | null;
  feedback: string | null;
  dailyNote: boolean | null;
  locked: boolean;
  savedAt: string | null; // ISO, last write of the evaluation
  holidayLabel: string | null;
  /** A day graded with «الدرجات المعدّلة»: the discussion criterion's items, quiz included. Desktop only. */
  quiz?: MatrixQuiz | null;
  /**
   * Graded with earlier criteria (another maximum): the day's own total
   * maximum, and each criterion's (aligned to criteria). Absent: the
   * current ones. A day shows its own score out of its own maximum;
   * averages scale it to the current maximum (build.ts onScale). Desktop only.
   */
  max?: number;
  maxes?: (number | null)[];
}

// The discussion criterion of a «الدرجات المعدّلة» day: group discussion
// 2.5, case discussion 2.5 and the quiz 2 (grading/scoring.ts); the
// criterion's score in `scores` is their sum, as on any other day.
export interface MatrixQuiz {
  criterionIndex: number; // into GradeMatrixData.criteria
  items: { id: string; label: string; max: number; score: number | null }[];
}

// A rotation block: the group is at this hospital from start to end.
export interface MatrixStint {
  hospitalId: string;
  start: string;
  end: string;
}

export interface MatrixStudent {
  id: string;
  name: string;
  uni: string;
  code: string | null;
  days: MatrixDay[]; // aligned to the group's dates
  // Validated evaluations on dates the schedule doesn't list — counted in
  // nothing here, but never hidden: the views report them.
  unplaced: MatrixDay[];
}

export interface MatrixGroup {
  id: string;
  name: string;
  stints: MatrixStint[]; // chronological
  dates: { dateISO: string; hospitalId: string }[]; // chronological, one per meeting day
  students: MatrixStudent[];
}

export type ProgramId = "MORNING" | "EVENING" | "NONE";

export interface MatrixProgram {
  id: ProgramId;
  label: string;
  groups: MatrixGroup[];
}

export interface GradeMatrixData {
  courseId: string | null;
  courseLabel: string;
  todayISO: string;
  windowDays: number;
  criteria: MatrixCriterion[];
  maxTotal: number;
  hospitals: MatrixHospital[];
  programs: MatrixProgram[];
  holidays: Record<string, string>; // dateISO → label
}
