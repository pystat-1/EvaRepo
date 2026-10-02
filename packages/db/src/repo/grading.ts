// Grades: the evaluation list with filters, a student's record, the group
// grade sheet (students x days), and statistics. Only validated grades
// count (pendingValidation = false), the same rule as the website.
import { and, asc, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { compareArabic, matchesSearch } from "@eva/core/text/arabic";
import * as t from "../schema";
import { type Repo } from "./common";

export interface EvaluationRow {
  id: string;
  dateISO: string;
  studentId: string;
  studentName: string;
  universityNumber: string;
  groupId: string | null;
  groupName: string | null;
  hospitalName: string | null;
  evaluatorName: string | null;
  attendance: t.Attendance;
  total: number;
  locked: boolean;
  notes: string | null;
  sections: Record<string, number>; // rubricSectionId -> score
  /** rubricItemId -> score (null for older grades recorded by section only). */
  items: Record<string, number> | null;
}

export interface EvaluationFilter {
  courseId?: string;
  groupId?: string;
  hospitalId?: string;
  evaluatorId?: string;
  from?: string;
  to?: string;
  search?: string;
  studentId?: string;
}

/** The criteria in form order, each with its sub-criteria (items). */
export async function rubric(r: Repo) {
  const rows = await r.db.select().from(t.rubricSections).where(eq(t.rubricSections.active, true));
  const items = await r.db.select().from(t.rubricItems).where(eq(t.rubricItems.active, true));
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ ...s, items: items.filter((i) => i.sectionId === s.id).sort((a, b) => a.sortOrder - b.sortOrder) }));
}

function evaluationWhere(f: EvaluationFilter) {
  return and(
    eq(t.evaluations.pendingValidation, false),
    f.courseId ? eq(t.students.courseId, f.courseId) : undefined,
    f.groupId ? eq(t.evaluations.groupId, f.groupId) : undefined,
    f.hospitalId ? eq(t.evaluations.hospitalId, f.hospitalId) : undefined,
    f.evaluatorId ? eq(t.evaluations.evaluatorId, f.evaluatorId) : undefined,
    f.studentId ? eq(t.evaluations.studentId, f.studentId) : undefined,
    f.from ? gte(t.evaluations.dateISO, f.from) : undefined,
    f.to ? lte(t.evaluations.dateISO, f.to) : undefined
  );
}

/** How many validated grades match (cheap: no rows are read out). */
export async function countEvaluations(r: Repo, f: EvaluationFilter = {}): Promise<number> {
  const [row] = await r.db
    .select({ n: count() })
    .from(t.evaluations)
    .innerJoin(t.students, eq(t.students.id, t.evaluations.studentId))
    .where(evaluationWhere(f));
  return row?.n ?? 0;
}

/**
 * Validated grades, newest first. `limit` keeps the screen fast on a full
 * course (tens of thousands of grades); search, "show all" and exports read
 * everything. Scores are fetched in chunks (SQLite caps a query at 32 766
 * parameters).
 */
export async function listEvaluations(r: Repo, f: EvaluationFilter = {}, limit?: number): Promise<EvaluationRow[]> {
  const q = r.db
    .select({
      id: t.evaluations.id,
      dateISO: t.evaluations.dateISO,
      studentId: t.evaluations.studentId,
      groupId: t.evaluations.groupId,
      attendance: t.evaluations.attendance,
      total: t.evaluations.total,
      locked: t.evaluations.locked,
      notes: t.evaluations.notes,
      items: t.evaluations.itemScores,
      studentName: t.students.nameAr,
      universityNumber: t.students.universityNumber,
      groupName: t.groups.name,
      hospitalName: t.hospitals.name,
      evaluatorName: t.accounts.name,
    })
    .from(t.evaluations)
    .innerJoin(t.students, eq(t.students.id, t.evaluations.studentId))
    .leftJoin(t.groups, eq(t.groups.id, t.evaluations.groupId))
    .leftJoin(t.hospitals, eq(t.hospitals.id, t.evaluations.hospitalId))
    .leftJoin(t.accounts, eq(t.accounts.id, t.evaluations.evaluatorId))
    .where(evaluationWhere(f))
    .orderBy(desc(t.evaluations.dateISO), asc(t.students.nameAr));
  const rows = (limit && !f.search ? await q.limit(limit) : await q).filter(
    (x) => !f.search || matchesSearch(f.search, x.studentName, x.universityNumber)
  );
  const byEval = new Map<string, Record<string, number>>();
  const ids = rows.map((x) => x.id);
  for (let k = 0; k < ids.length; k += 5000) {
    const chunk = ids.slice(k, k + 5000);
    const scores = await r.db
      .select({ evaluationId: t.evaluationScores.evaluationId, sectionId: t.evaluationScores.rubricSectionId, score: t.evaluationScores.score })
      .from(t.evaluationScores)
      .where(inArray(t.evaluationScores.evaluationId, chunk));
    for (const s of scores) {
      let m = byEval.get(s.evaluationId);
      if (!m) byEval.set(s.evaluationId, (m = {}));
      m[s.sectionId] = s.score;
    }
  }
  return rows.map((x) => ({ ...x, sections: byEval.get(x.id) ?? {} }));
}

export interface StudentRecord {
  days: number;
  present: number;
  late: number;
  absent: number;
  average: number | null; // over days attended
  evaluations: EvaluationRow[];
}

export async function studentRecord(r: Repo, studentId: string): Promise<StudentRecord> {
  const evaluations = await listEvaluations(r, { studentId });
  const attended = evaluations.filter((e) => e.attendance !== "absent");
  return {
    days: evaluations.length,
    present: evaluations.filter((e) => e.attendance === "present").length,
    late: evaluations.filter((e) => e.attendance === "late").length,
    absent: evaluations.filter((e) => e.attendance === "absent").length,
    average: attended.length ? attended.reduce((s, e) => s + e.total, 0) / attended.length : null,
    evaluations,
  };
}

export interface GradeSheet {
  dates: string[];
  students: Array<{ id: string; name: string; universityNumber: string; average: number | null; cells: Record<string, { total: number; attendance: t.Attendance }> }>;
}

/** One group: students (Arabic order) x days graded. */
export async function groupGradeSheet(r: Repo, groupId: string): Promise<GradeSheet> {
  const students = await r.db
    .select()
    .from(t.students)
    .where(and(eq(t.students.groupId, groupId), eq(t.students.active, true)));
  const ids = students.map((s) => s.id);
  const evals = ids.length
    ? await r.db
        .select()
        .from(t.evaluations)
        .where(and(inArray(t.evaluations.studentId, ids), eq(t.evaluations.pendingValidation, false)))
    : [];
  const dates = [...new Set(evals.map((e) => e.dateISO))].sort();
  return {
    dates,
    students: students
      .map((s) => {
        const mine = evals.filter((e) => e.studentId === s.id);
        const attended = mine.filter((e) => e.attendance !== "absent");
        return {
          id: s.id,
          name: s.nameAr,
          universityNumber: s.universityNumber,
          average: attended.length ? attended.reduce((a, e) => a + e.total, 0) / attended.length : null,
          cells: Object.fromEntries(mine.map((e) => [e.dateISO, { total: e.total, attendance: e.attendance }])),
        };
      })
      .sort((a, b) => compareArabic(a.name, b.name)),
  };
}

export interface GroupStats {
  groupId: string;
  groupName: string;
  shift: t.Shift | null;
  students: number;
  evaluations: number;
  average: number | null;
  attendanceRate: number | null; // present+late / all evaluated days
  lowScoreStudents: number; // average below 60% of the maximum
}

export async function courseStatistics(r: Repo, courseId: string): Promise<{ maxTotal: number; groups: GroupStats[] }> {
  const maxTotal = (await rubric(r)).reduce((s, x) => s + x.maxScore, 0);
  const groups = await r.db.select().from(t.groups).where(eq(t.groups.courseId, courseId));
  const out: GroupStats[] = [];
  for (const g of groups) {
    const sheet = await groupGradeSheet(r, g.id);
    const cells = sheet.students.flatMap((s) => Object.values(s.cells));
    const attended = cells.filter((c) => c.attendance !== "absent");
    out.push({
      groupId: g.id,
      groupName: g.name,
      shift: g.shift,
      students: sheet.students.length,
      evaluations: cells.length,
      average: attended.length ? attended.reduce((a, c) => a + c.total, 0) / attended.length : null,
      attendanceRate: cells.length ? attended.length / cells.length : null,
      lowScoreStudents: sheet.students.filter((s) => s.average !== null && s.average < maxTotal * 0.6).length,
    });
  }
  const rank = (s: t.Shift | null) => (s === "MORNING" ? 0 : 1);
  return { maxTotal, groups: out.sort((a, b) => rank(a.shift) - rank(b.shift) || a.groupName.localeCompare(b.groupName, "ar", { numeric: true })) };
}

export async function recentAudit(r: Repo, limit = 300) {
  const rows = await r.db.select().from(t.auditLog);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
