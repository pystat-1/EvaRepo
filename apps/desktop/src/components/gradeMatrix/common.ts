import { dayMatches, fullDate, matchesSearch, studentStats, type FilterId } from "@eva/core/gradeMatrix/build";
import { cellVisual } from "@eva/core/gradeMatrix/visual";
import type { GradeMatrixData, MatrixDay, MatrixHospital, MatrixProgram, MatrixStudent } from "@eva/core/gradeMatrix/types";

export type Mode = "totals" | "criteria";

export interface ViewProps {
  data: GradeMatrixData;
  program: MatrixProgram;
  hospitalBy: Map<string, MatrixHospital>;
  hospitalOrder: string[];
  mode: Mode;
  filter: FilterId;
  query: string;
  /** Desktop: at most this many student rows are drawn (a big course draws in steps). */
  limit?: number;
}

/** Keeps the first `limit` rows across the groups, in order. */
export function capRows<T>(lists: T[][], limit = Infinity): T[][] {
  let left = limit;
  return lists.map((rows) => {
    const kept = rows.slice(0, Math.max(0, left));
    left -= kept.length;
    return kept;
  });
}

// The sticky student column; narrower on phones (see gradeMatrix.module.css).
export const STUDENT_COL = "var(--student-col)";

export function gridCols(widths: (number | string)[]): string {
  return widths.map((w) => (typeof w === "number" ? `${w}px` : w)).join(" ");
}

export function shortHospital(name: string): string {
  return name.replace(/^(مستشفى|مستشفي|مدينة)\s+/, "").trim() || name;
}

export function hospitalName(hospitalBy: Map<string, MatrixHospital>, id: string | null): string {
  return (id && hospitalBy.get(id)?.name) || "—";
}

export function dayAria(
  student: MatrixStudent,
  day: MatrixDay,
  hospitalBy: Map<string, MatrixHospital>,
  maxTotal: number
): string {
  const v = cellVisual(day, maxTotal);
  const value =
    day.total !== null && day.state !== "absent" ? `المجموع ${v.main} من ${maxTotal}` : v.main || "لم يحن موعده";
  return [student.name, hospitalName(hospitalBy, day.hospitalId), fullDate(day.dateISO), v.tag, value]
    .filter(Boolean)
    .join("، ");
}

// Students shown under the current search and filter. A filter keeps the
// students who have at least one matching day among `days(student)`.
export function visibleStudents(
  students: MatrixStudent[],
  query: string,
  filter: FilterId,
  maxTotal: number,
  days: (s: MatrixStudent) => MatrixDay[] = (s) => s.days
): { student: MatrixStudent; index: number }[] {
  return students
    .map((student, index) => ({ student, index }))
    .filter(({ student }) => matchesSearch(query, [student.name, student.uni, student.code]))
    .filter(({ student }) => filter === "all" || days(student).some((d) => dayMatches(filter, d, maxTotal)));
}

export type StatsLookup = { get(studentId: string): ReturnType<typeof studentStats> | undefined };

/** Per-student statistics, computed the first time a row asks for them. */
export function lazyStats(program: MatrixProgram, criteriaCount: number, maxTotal: number): StatsLookup {
  const byId = new Map(program.groups.flatMap((g) => g.students.map((s) => [s.id, s] as const)));
  const cache = new Map<string, ReturnType<typeof studentStats>>();
  return {
    get(id) {
      let v = cache.get(id);
      const s = v ? undefined : byId.get(id);
      if (s) cache.set(id, (v = studentStats(s.days, criteriaCount, maxTotal)));
      return v;
    },
  };
}

// "المجموعة A" whether or not the stored name already starts with the word.
export function groupTitle(name: string): string {
  return /^المجموعة(\s|$)/.test(name.trim()) ? name.trim() : `المجموعة ${name}`;
}
