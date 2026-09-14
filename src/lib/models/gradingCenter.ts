import { prisma } from "../db";
import { getMaxTotal } from "./rubric";
import { Attendance } from "./evaluations";

export interface GradingCenterFilters {
  hospitalId?: string;
  courseId?: string;
  studyTypeId?: string;
  groupId?: string;
  evaluatorId?: string;
  studentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface GradingCenterScore {
  sectionId: string;
  labelAr: string;
  maxScore: number;
  score: number;
}

export interface GradingCenterRow {
  id: string;
  dateISO: string;
  attendance: Attendance;
  total: number;
  locked: boolean;
  notes: string | null;
  feedback: string | null;
  studentId: string;
  studentName: string;
  studentCode: string | null;
  universityNumber: string;
  courseLabel: string | null;
  studyTypeName: string | null;
  groupName: string | null;
  evaluatorId: string;
  evaluatorName: string;
  hospitalId: string | null;
  hospitalName: string | null;
  scores: GradingCenterScore[];
}

export interface GradingCenterResult {
  rows: GradingCenterRow[];
  maxTotal: number;
  summary: {
    evaluationCount: number;
    studentCount: number;
    evaluatorCount: number;
    hospitalCount: number;
    averageTotal: number;
  };
}

// The admin-facing rollup of every evaluator's grading, across every
// hospital, filterable by the same classification dimensions used to set
// the registry up in /setup (course, study type, group) plus hospital and
// evaluator — "one place that combines all the grades."
export async function listGradingCenter(
  filters: GradingCenterFilters,
  limit = 300
): Promise<GradingCenterResult> {
  const where: Record<string, unknown> = {};
  if (filters.hospitalId) where.hospitalId = filters.hospitalId;
  if (filters.groupId) where.groupId = filters.groupId;
  if (filters.evaluatorId) where.evaluatorId = filters.evaluatorId;
  if (filters.studentId) where.studentId = filters.studentId;
  if (filters.dateFrom || filters.dateTo) {
    where.dateISO = {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }
  if (filters.courseId || filters.studyTypeId) {
    where.student = {
      ...(filters.courseId ? { courseId: filters.courseId } : {}),
      ...(filters.studyTypeId ? { studyTypeId: filters.studyTypeId } : {}),
    };
  }

  const [rawRows, maxTotal] = await Promise.all([
    prisma.evaluation.findMany({
      where,
      orderBy: [{ dateISO: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: {
        student: { include: { course: true, studyType: true, group: true } },
        evaluator: { select: { name: true } },
        scores: { include: { rubricSection: true } },
      },
    }),
    getMaxTotal(),
  ]);

  const hospitalIds = Array.from(new Set(rawRows.map((r) => r.hospitalId).filter((x): x is string => !!x)));
  const hospitals = hospitalIds.length
    ? await prisma.hospital.findMany({ where: { id: { in: hospitalIds } }, select: { id: true, name: true } })
    : [];
  const hospitalNameById = new Map(hospitals.map((h) => [h.id, h.name]));

  const rows: GradingCenterRow[] = rawRows.map((r) => ({
    id: r.id,
    dateISO: r.dateISO,
    attendance: r.attendance as Attendance,
    total: r.total,
    locked: r.locked,
    notes: r.notes,
    feedback: r.feedback,
    studentId: r.studentId,
    studentName: r.student.nameAr,
    studentCode: r.student.code,
    universityNumber: r.student.universityNumber,
    courseLabel: r.student.course ? r.student.course.label ?? `${r.student.course.year}-${r.student.course.number}` : null,
    studyTypeName: r.student.studyType?.name ?? null,
    groupName: r.student.group?.name ?? null,
    evaluatorId: r.evaluatorId,
    evaluatorName: r.evaluator?.name ?? "—",
    hospitalId: r.hospitalId,
    hospitalName: r.hospitalId ? hospitalNameById.get(r.hospitalId) ?? null : null,
    scores: r.scores
      .map((s) => ({
        sectionId: s.rubricSectionId,
        labelAr: s.rubricSection.labelAr,
        maxScore: s.rubricSection.maxScore,
        score: s.score,
      }))
      .sort((a, b) => a.labelAr.localeCompare(b.labelAr)),
  }));

  const uniqueStudents = new Set(rows.map((r) => r.studentId));
  const uniqueEvaluators = new Set(rows.map((r) => r.evaluatorId));
  const uniqueHospitals = new Set(rows.map((r) => r.hospitalId).filter(Boolean));
  const averageTotal = rows.length > 0 ? rows.reduce((sum, r) => sum + r.total, 0) / rows.length : 0;

  return {
    rows,
    maxTotal,
    summary: {
      evaluationCount: rows.length,
      studentCount: uniqueStudents.size,
      evaluatorCount: uniqueEvaluators.size,
      hospitalCount: uniqueHospitals.size,
      averageTotal,
    },
  };
}
