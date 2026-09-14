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

export interface StudentStint {
  // null for the trailing "unscheduled" bucket (evaluations whose date
  // doesn't fall in any of the student's group's rotation blocks — legacy
  // data, or a block that hasn't been scheduled yet).
  blockId: string | null;
  hospitalId: string | null;
  hospitalName: string;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: string | null;
  evaluations: GradingCenterRow[];
  averageTotal: number;
}

export interface StudentGradingSummary {
  student: {
    id: string;
    name: string;
    universityNumber: string;
    code: string | null;
    courseLabel: string | null;
    studyTypeName: string | null;
    groupName: string | null;
  };
  maxTotal: number;
  overall: {
    evaluationCount: number;
    averageTotal: number;
    attendance: { present: number; late: number; absent: number };
  };
  // One section per rotation block the student's group has ever been
  // scheduled for (chronological), each holding just the evaluations
  // whose date falls in that block's window — so a student who revisits
  // the same hospital later gets two separate sections, not one merged
  // one. A trailing section (hospitalId: null-safe via blockId: null)
  // catches anything outside every scheduled block.
  stints: StudentStint[];
}

export async function getStudentGradingSummary(studentId: string): Promise<StudentGradingSummary | undefined> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { course: true, studyType: true, group: true },
  });
  if (!student) return undefined;

  const { rows, maxTotal } = await listGradingCenter({ studentId }, 2000);

  const blocks = student.groupId
    ? await prisma.rotationBlock.findMany({
        where: { groupId: student.groupId },
        orderBy: { startDate: "asc" },
        include: { hospital: { select: { name: true } } },
      })
    : [];

  const used = new Set<string>();
  const stints: StudentStint[] = blocks.map((b) => {
    const evaluations = rows.filter((r) => r.dateISO >= b.startDate && r.dateISO <= b.endDate);
    evaluations.forEach((e) => used.add(e.id));
    return {
      blockId: b.id,
      hospitalId: b.hospitalId,
      hospitalName: b.hospital.name,
      startDate: b.startDate,
      endDate: b.endDate,
      daysOfWeek: b.daysOfWeek,
      evaluations,
      averageTotal: evaluations.length ? evaluations.reduce((s, e) => s + e.total, 0) / evaluations.length : 0,
    };
  });

  const leftover = rows.filter((r) => !used.has(r.id));
  if (leftover.length > 0) {
    // Group leftovers by their stored hospitalId so they're still readable.
    const byHospital = new Map<string, GradingCenterRow[]>();
    for (const r of leftover) {
      const key = r.hospitalId ?? "__none__";
      if (!byHospital.has(key)) byHospital.set(key, []);
      byHospital.get(key)!.push(r);
    }
    for (const [key, evaluations] of byHospital) {
      stints.push({
        blockId: null,
        hospitalId: key === "__none__" ? null : key,
        hospitalName: evaluations[0].hospitalName ?? "خارج الجدول",
        startDate: null,
        endDate: null,
        daysOfWeek: null,
        evaluations,
        averageTotal: evaluations.reduce((s, e) => s + e.total, 0) / evaluations.length,
      });
    }
  }

  const attendance = { present: 0, late: 0, absent: 0 };
  for (const r of rows) attendance[r.attendance]++;

  return {
    student: {
      id: student.id,
      name: student.nameAr,
      universityNumber: student.universityNumber,
      code: student.code,
      courseLabel: student.course ? student.course.label ?? `${student.course.year}-${student.course.number}` : null,
      studyTypeName: student.studyType?.name ?? null,
      groupName: student.group?.name ?? null,
    },
    maxTotal,
    overall: {
      evaluationCount: rows.length,
      averageTotal: rows.length ? rows.reduce((s, r) => s + r.total, 0) / rows.length : 0,
      attendance,
    },
    stints,
  };
}
