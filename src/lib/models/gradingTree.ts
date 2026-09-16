import { prisma } from "../db";
import { listCourses } from "./courses";
import { listGroups, Shift } from "./groups";
import { listAllRotationBlocks } from "./rotationBlocks";
import { getMaxTotal } from "./rubric";

export interface TreeScore {
  labelAr: string;
  score: number;
  maxScore: number;
}

export interface TreeStudent {
  id: string;
  name: string;
  universityNumber: string;
  latestEvaluation: {
    dateISO: string;
    attendance: "present" | "late" | "absent";
    total: number;
    scores: TreeScore[];
  } | null;
}

export interface TreeStint {
  hospitalId: string;
  hospitalName: string;
  startDate: string;
  endDate: string;
}

export interface TreeGroup {
  id: string;
  name: string;
  shift: Shift | null;
  stints: TreeStint[];
  students: TreeStudent[];
}

export interface TreeShift {
  key: Shift;
  label: string;
  groups: TreeGroup[];
}

export interface TreeCourse {
  id: string;
  year: number;
  number: number;
  label: string | null;
  totalStudents: number;
  shifts: TreeShift[];
}

export interface TreeAllStudent {
  id: string;
  name: string;
  universityNumber: string;
  groupName: string | null;
}

export interface GradingTreeData {
  courses: TreeCourse[];
  allStudents: TreeAllStudent[];
  maxTotal: number;
}

const SHIFT_LABEL: Record<Shift, string> = { MORNING: "صباحي", EVENING: "مسائي" };

// One flat drill-down for the grading center's tree navigator: Course ->
// Shift -> Group -> its roster, with each group's rotation schedule
// attached for the reference chips, and each student's most recent
// evaluation (if any) so the roster table is fully populated without a
// second click — see GradingTree.tsx.
export async function getGradingTree(): Promise<GradingTreeData> {
  const [courses, groups, rotationBlocks, students, maxTotal] = await Promise.all([
    listCourses(true),
    listGroups(true),
    listAllRotationBlocks(true),
    prisma.student.findMany({
      where: { active: true },
      orderBy: { nameAr: "asc" },
      select: { id: true, nameAr: true, universityNumber: true, groupId: true, courseId: true },
    }),
    getMaxTotal(),
  ]);

  const studentIds = students.map((s) => s.id);
  const latestEvals = studentIds.length
    ? await prisma.evaluation.findMany({
        where: { studentId: { in: studentIds } },
        orderBy: { dateISO: "desc" },
        include: { scores: { include: { rubricSection: true } } },
      })
    : [];
  const latestByStudent = new Map<string, (typeof latestEvals)[number]>();
  for (const e of latestEvals) {
    if (!latestByStudent.has(e.studentId)) latestByStudent.set(e.studentId, e);
  }

  const rotationByGroup = new Map<string, TreeStint[]>();
  for (const b of rotationBlocks) {
    if (!b.active) continue;
    if (!rotationByGroup.has(b.groupId)) rotationByGroup.set(b.groupId, []);
    rotationByGroup.get(b.groupId)!.push({
      hospitalId: b.hospitalId,
      hospitalName: b.hospitalName,
      startDate: b.startDate,
      endDate: b.endDate,
    });
  }
  for (const stints of rotationByGroup.values()) stints.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));

  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const studentsByGroup = new Map<string, TreeStudent[]>();
  for (const s of students) {
    if (!s.groupId) continue;
    const evalRow = latestByStudent.get(s.id);
    const treeStudent: TreeStudent = {
      id: s.id,
      name: s.nameAr,
      universityNumber: s.universityNumber,
      latestEvaluation: evalRow
        ? {
            dateISO: evalRow.dateISO,
            attendance: evalRow.attendance as "present" | "late" | "absent",
            total: evalRow.total,
            scores: evalRow.scores
              .map((sc) => ({ labelAr: sc.rubricSection.labelAr, score: sc.score, maxScore: sc.rubricSection.maxScore }))
              .sort((a, b) => a.labelAr.localeCompare(b.labelAr)),
          }
        : null,
    };
    if (!studentsByGroup.has(s.groupId)) studentsByGroup.set(s.groupId, []);
    studentsByGroup.get(s.groupId)!.push(treeStudent);
  }

  const treeCourses: TreeCourse[] = courses.map((c) => {
    const courseGroups = groups.filter((g) => g.courseId === c.id);
    const shifts: TreeShift[] = (["MORNING", "EVENING"] as Shift[])
      .map((shiftKey) => {
        const shiftGroups = courseGroups.filter((g) => g.shift === shiftKey);
        return {
          key: shiftKey,
          label: SHIFT_LABEL[shiftKey],
          groups: shiftGroups.map((g) => ({
            id: g.id,
            name: g.name,
            shift: g.shift,
            stints: rotationByGroup.get(g.id) ?? [],
            students: studentsByGroup.get(g.id) ?? [],
          })),
        };
      })
      .filter((s) => s.groups.length > 0);
    const totalStudents = shifts.reduce((sum, s) => sum + s.groups.reduce((n, g) => n + g.students.length, 0), 0);
    return { id: c.id, year: c.year, number: c.number, label: c.label, totalStudents, shifts };
  });

  const allStudents: TreeAllStudent[] = students
    .map((s) => ({
      id: s.id,
      name: s.nameAr,
      universityNumber: s.universityNumber,
      groupName: s.groupId ? groupNameById.get(s.groupId) ?? null : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return { courses: treeCourses, allStudents, maxTotal };
}
