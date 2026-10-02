import { dayMatches, fullDate, matchesSearch, type FilterId } from "@/lib/gradeMatrix/build";
import { cellVisual } from "@/lib/gradeMatrix/visual";
import type { GradeMatrixData, MatrixDay, MatrixHospital, MatrixProgram, MatrixStudent } from "@/lib/gradeMatrix/types";

export type Mode = "totals" | "criteria";

export interface ViewProps {
  data: GradeMatrixData;
  program: MatrixProgram;
  hospitalBy: Map<string, MatrixHospital>;
  hospitalOrder: string[];
  mode: Mode;
  filter: FilterId;
  query: string;
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
