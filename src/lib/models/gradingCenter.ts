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

function buildEvaluationWhere(filters: GradingCenterFilters): Record<string, unknown> {
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
  return where;
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

export interface GradingCenterPage {
  rows: GradingCenterRow[];
  maxTotal: number;
  page: number;
  pageSize: number;
  total: number;
}

// The admin-facing rollup of every evaluator's grading, across every
// hospital, filterable by the same classification dimensions used to set
// the registry up in /setup (course, study type, group) plus hospital and
// evaluator — "one place that combines all the grades." Paginated like
// /students and /evaluators (see listStudentsPage) rather than a single
// capped `take`, so a large course's full detail log stays reachable
// instead of silently hiding everything past the first page.
export async function listGradingCenter(
  filters: GradingCenterFilters,
  params: { page?: number; pageSize?: number } = {}
): Promise<GradingCenterPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? 50;
  const where = buildEvaluationWhere(filters);

  const [rawRows, total, maxTotal] = await Promise.all([
    prisma.evaluation.findMany({
      where,
      orderBy: [{ dateISO: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        student: { include: { course: true, studyType: true, group: true } },
        evaluator: { select: { name: true } },
        scores: { include: { rubricSection: true } },
      },
    }),
    prisma.evaluation.count({ where }),
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

  return { rows, maxTotal, page, pageSize, total };
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

  const { rows, maxTotal } = await listGradingCenter({ studentId }, { pageSize: 2000 });

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

// ---------------------------------------------------------------------
// Dashboard aggregates — computed over the FULL filtered set (not just the
// detail table's current page), so the KPI/trend/heatmap/flagged widgets
// above the table always describe everything the filters match.
// ---------------------------------------------------------------------

export interface GradingCenterHospitalStat {
  hospitalId: string;
  name: string;
  count: number;
  averageTotal: number;
  attendanceRate: number;
}

export interface GradingCenterGroupStat {
  groupId: string;
  name: string;
  count: number;
  studentCount: number;
  averageTotal: number;
  attendanceRate: number;
}

// "blockSeq" is a group's rotation blocks in chronological order (1st,
// 2nd, 3rd block it was ever scheduled for) — comparable across different
// groups even though their actual calendar dates differ, so it doubles as
// an apples-to-apples "how did things trend over the rotation" axis.
// blockSeq 0 holds evaluations whose date falls outside every one of their
// group's rotation blocks (legacy data, or no schedule set at all).
export interface GradingCenterTrendPoint {
  blockSeq: number;
  label: string;
  count: number;
  averageTotal: number;
}

export interface GradingCenterHeatmapRow {
  groupId: string;
  name: string;
  cells: { blockSeq: number; count: number; attendanceRate: number }[];
}

export interface GradingCenterPerformer {
  studentId: string;
  name: string;
  universityNumber: string;
  groupName: string | null;
  count: number;
  averageTotal: number;
  attendanceRate: number;
}

export interface GradingCenterFlaggedStudent {
  studentId: string;
  name: string;
  universityNumber: string;
  groupName: string | null;
  flags: { ruleId: string; severity: "warning" | "danger"; msg: string }[];
}

export interface GradingCenterDashboard {
  maxTotal: number;
  summary: {
    evaluationCount: number;
    studentCount: number;
    evaluatorCount: number;
    hospitalCount: number;
    averageTotal: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    attendanceRate: number;
    flaggedStudentCount: number;
  };
  byHospital: GradingCenterHospitalStat[];
  byGroup: GradingCenterGroupStat[];
  trend: GradingCenterTrendPoint[];
  maxBlockSeq: number;
  heatmap: GradingCenterHeatmapRow[];
  topStudents: GradingCenterPerformer[];
  bottomStudents: GradingCenterPerformer[];
  flagged: GradingCenterFlaggedStudent[];
}

// Hard cap on how many evaluation rows this aggregation ever scans — a
// generous ceiling for how large one filtered view can realistically get
// (a full-year, all-hospitals, all-groups query on a big course), past
// which the numbers would silently become "first N" instead of "all
// matching" without this; ordinary filtered views stay far under it.
const DASHBOARD_ROW_CAP = 20000;

export async function getGradingCenterDashboard(filters: GradingCenterFilters): Promise<GradingCenterDashboard> {
  const where = buildEvaluationWhere(filters);

  const [rows, maxTotal] = await Promise.all([
    prisma.evaluation.findMany({
      where,
      take: DASHBOARD_ROW_CAP,
      select: {
        id: true,
        studentId: true,
        groupId: true,
        hospitalId: true,
        evaluatorId: true,
        dateISO: true,
        attendance: true,
        total: true,
      },
    }),
    getMaxTotal(),
  ]);

  const studentIds = Array.from(new Set(rows.map((r) => r.studentId)));
  const groupIds = Array.from(new Set(rows.map((r) => r.groupId).filter((x): x is string => !!x)));
  const hospitalIds = Array.from(new Set(rows.map((r) => r.hospitalId).filter((x): x is string => !!x)));

  const [students, hospitals, rotationBlocks, flags] = await Promise.all([
    studentIds.length
      ? prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, nameAr: true, universityNumber: true, group: { select: { name: true } } },
        })
      : Promise.resolve([]),
    hospitalIds.length
      ? prisma.hospital.findMany({ where: { id: { in: hospitalIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    groupIds.length
      ? prisma.rotationBlock.findMany({
          where: { groupId: { in: groupIds }, active: true },
          orderBy: { startDate: "asc" },
          select: { groupId: true, startDate: true, endDate: true },
        })
      : Promise.resolve([]),
    studentIds.length
      ? prisma.flag.findMany({ where: { studentId: { in: studentIds } }, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
  ]);

  const studentById = new Map(students.map((s) => [s.id, s]));
  const hospitalNameById = new Map(hospitals.map((h) => [h.id, h.name]));
  const blocksByGroup = new Map<string, { startDate: string; endDate: string }[]>();
  for (const b of rotationBlocks) {
    if (!blocksByGroup.has(b.groupId)) blocksByGroup.set(b.groupId, []);
    blocksByGroup.get(b.groupId)!.push(b);
  }
  function blockSeqFor(groupId: string | null, dateISO: string): number {
    if (!groupId) return 0;
    const blocks = blocksByGroup.get(groupId);
    if (!blocks) return 0;
    const idx = blocks.findIndex((b) => dateISO >= b.startDate && dateISO <= b.endDate);
    return idx === -1 ? 0 : idx + 1;
  }

  type Acc = { count: number; sum: number; present: number; late: number; absent: number };
  function empty(): Acc {
    return { count: 0, sum: 0, present: 0, late: 0, absent: 0 };
  }
  function bump(acc: Acc, attendance: string, total: number) {
    acc.count++;
    acc.sum += total;
    if (attendance === "present") acc.present++;
    else if (attendance === "late") acc.late++;
    else acc.absent++;
  }
  function attendanceRate(acc: Acc): number {
    return acc.count > 0 ? (acc.present + acc.late) / acc.count : 0;
  }

  const overall = empty();
  const byHospitalAcc = new Map<string, Acc>();
  const byGroupAcc = new Map<string, { acc: Acc; studentIds: Set<string> }>();
  const byStudentAcc = new Map<string, Acc>();
  const trendAcc = new Map<number, Acc>();
  const heatmapAcc = new Map<string, Map<number, Acc>>();
  let maxBlockSeq = 0;

  for (const r of rows) {
    bump(overall, r.attendance, r.total);

    if (r.hospitalId) {
      if (!byHospitalAcc.has(r.hospitalId)) byHospitalAcc.set(r.hospitalId, empty());
      bump(byHospitalAcc.get(r.hospitalId)!, r.attendance, r.total);
    }

    if (r.groupId) {
      if (!byGroupAcc.has(r.groupId)) byGroupAcc.set(r.groupId, { acc: empty(), studentIds: new Set() });
      const g = byGroupAcc.get(r.groupId)!;
      bump(g.acc, r.attendance, r.total);
      g.studentIds.add(r.studentId);
    }

    if (!byStudentAcc.has(r.studentId)) byStudentAcc.set(r.studentId, empty());
    bump(byStudentAcc.get(r.studentId)!, r.attendance, r.total);

    const seq = blockSeqFor(r.groupId, r.dateISO);
    maxBlockSeq = Math.max(maxBlockSeq, seq);
    if (!trendAcc.has(seq)) trendAcc.set(seq, empty());
    bump(trendAcc.get(seq)!, r.attendance, r.total);

    if (r.groupId) {
      if (!heatmapAcc.has(r.groupId)) heatmapAcc.set(r.groupId, new Map());
      const groupMap = heatmapAcc.get(r.groupId)!;
      if (!groupMap.has(seq)) groupMap.set(seq, empty());
      bump(groupMap.get(seq)!, r.attendance, r.total);
    }
  }

  // Students were fetched by id, not by group, so pair each groupId back to
  // its name via any row whose student resolved to that group.
  const groupNameById = new Map<string, string>();
  for (const r of rows) {
    if (r.groupId && !groupNameById.has(r.groupId)) {
      const s = studentById.get(r.studentId);
      if (s?.group?.name) groupNameById.set(r.groupId, s.group.name);
    }
  }

  const byHospital: GradingCenterHospitalStat[] = Array.from(byHospitalAcc.entries())
    .map(([hospitalId, acc]) => ({
      hospitalId,
      name: hospitalNameById.get(hospitalId) ?? "—",
      count: acc.count,
      averageTotal: acc.count ? acc.sum / acc.count : 0,
      attendanceRate: attendanceRate(acc),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byGroup: GradingCenterGroupStat[] = Array.from(byGroupAcc.entries())
    .map(([groupId, { acc, studentIds: sIds }]) => ({
      groupId,
      name: groupNameById.get(groupId) ?? "—",
      count: acc.count,
      studentCount: sIds.size,
      averageTotal: acc.count ? acc.sum / acc.count : 0,
      attendanceRate: attendanceRate(acc),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const trend: GradingCenterTrendPoint[] = Array.from(trendAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([blockSeq, acc]) => ({
      blockSeq,
      label: blockSeq === 0 ? "خارج الجدول" : `الفترة ${blockSeq}`,
      count: acc.count,
      averageTotal: acc.count ? acc.sum / acc.count : 0,
    }));

  const heatmap: GradingCenterHeatmapRow[] = Array.from(heatmapAcc.entries())
    .map(([groupId, seqMap]) => ({
      groupId,
      name: groupNameById.get(groupId) ?? "—",
      cells: Array.from({ length: maxBlockSeq }, (_, i) => {
        const seq = i + 1;
        const acc = seqMap.get(seq);
        return { blockSeq: seq, count: acc?.count ?? 0, attendanceRate: acc ? attendanceRate(acc) : 0 };
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const performers: GradingCenterPerformer[] = Array.from(byStudentAcc.entries()).map(([studentId, acc]) => {
    const s = studentById.get(studentId);
    return {
      studentId,
      name: s?.nameAr ?? "—",
      universityNumber: s?.universityNumber ?? "—",
      groupName: s?.group?.name ?? null,
      count: acc.count,
      averageTotal: acc.count ? acc.sum / acc.count : 0,
      attendanceRate: attendanceRate(acc),
    };
  });
  const ranked = [...performers].sort((a, b) => b.averageTotal - a.averageTotal);
  const topStudents = ranked.slice(0, 5);
  const bottomStudents = ranked.length > 5 ? ranked.slice(-5).reverse() : [];

  const flaggedByStudent = new Map<string, GradingCenterFlaggedStudent>();
  for (const f of flags) {
    if (!flaggedByStudent.has(f.studentId)) {
      const s = studentById.get(f.studentId);
      flaggedByStudent.set(f.studentId, {
        studentId: f.studentId,
        name: s?.nameAr ?? "—",
        universityNumber: s?.universityNumber ?? "—",
        groupName: s?.group?.name ?? null,
        flags: [],
      });
    }
    flaggedByStudent.get(f.studentId)!.flags.push({
      ruleId: f.ruleId,
      severity: f.severity as "warning" | "danger",
      msg: f.msg,
    });
  }
  const flagged = Array.from(flaggedByStudent.values()).sort((a, b) => b.flags.length - a.flags.length);

  return {
    maxTotal,
    summary: {
      evaluationCount: overall.count,
      studentCount: studentIds.length,
      evaluatorCount: new Set(rows.map((r) => r.evaluatorId)).size,
      hospitalCount: hospitalIds.length,
      averageTotal: overall.count ? overall.sum / overall.count : 0,
      presentCount: overall.present,
      lateCount: overall.late,
      absentCount: overall.absent,
      attendanceRate: attendanceRate(overall),
      flaggedStudentCount: flaggedByStudent.size,
    },
    byHospital,
    byGroup,
    trend,
    maxBlockSeq,
    heatmap,
    topStudents,
    bottomStudents,
    flagged,
  };
}
