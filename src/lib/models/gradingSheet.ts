import { prisma } from "../db";
import { listGroups } from "./groups";
import { listAllRotationBlocks } from "./rotationBlocks";
import { listRubricSections } from "./rubric";
import { getTermSettings } from "./termSettings";
import { isDateInScheduledDays } from "../weekdays";

// The grading sheet is the gradebook-matrix view of stored evaluations,
// mirroring the paper layout: rows are study type → group → student, and
// columns are hospital → week → day. Each day cell carries that student's
// full per-criterion grades for that day (or is blank when no evaluation
// exists yet). See src/components/GradingSheet.tsx for the renderer.

export interface SheetCriterion {
  id: string;
  labelAr: string;
  maxScore: number;
}

export interface SheetColumn {
  key: string; // unique per (hospital block + day)
  hospitalId: string;
  hospitalName: string;
  weekIndex: number; // 1-based, restarts within each hospital block
  dayIndex: number; // 1-based within the week
  dateISO: string;
}

export interface SheetCell {
  attendance: "present" | "late" | "absent";
  total: number;
  dailyNoteSubmitted: boolean;
  // Aligned to the criteria array: score per criterion, or null when that
  // criterion wasn't scored on this evaluation.
  scores: (number | null)[];
}

export interface SheetStudent {
  id: string;
  name: string;
  universityNumber: string;
  // Aligned to the group's columns: one cell per column, null when the
  // student has no evaluation on that day.
  cells: (SheetCell | null)[];
}

export interface SheetGroup {
  id: string;
  name: string;
  shiftLabel: string | null;
  courseLabel: string | null;
  columns: SheetColumn[];
  students: SheetStudent[];
}

export interface SheetStudyType {
  name: string;
  groups: SheetGroup[];
}

export interface GradingSheetData {
  studyTypes: SheetStudyType[];
  criteria: SheetCriterion[];
  maxTotal: number;
}

export interface GradingSheetFilters {
  courseId?: string;
  studyTypeId?: string;
  groupId?: string;
}

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

// Enumerate the calendar dates a rotation block actually meets on: every day
// in [start, end] whose weekday is in the block's attendance-day pattern
// (falling back to the term's weekdays, then to every day as a last resort).
function meetingDates(startISO: string, endISO: string, days: string | null): string[] {
  const out: string[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out;
  // Guard against a pathological range with no day pattern blowing up.
  const MAX_DAYS = 366;
  let i = 0;
  for (let d = new Date(start); d <= end && i < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1), i++) {
    const iso = d.toISOString().slice(0, 10);
    if (isDateInScheduledDays(iso, days)) out.push(iso);
  }
  return out;
}

export async function getGradingSheet(filters: GradingSheetFilters = {}): Promise<GradingSheetData> {
  const [groups, rotationBlocks, criteriaSections, term] = await Promise.all([
    listGroups(true),
    listAllRotationBlocks(false),
    listRubricSections(false),
    getTermSettings(),
  ]);

  const criteria: SheetCriterion[] = criteriaSections.map((c) => ({
    id: c.id,
    labelAr: c.labelAr,
    maxScore: c.maxScore,
  }));
  const criteriaIndex = new Map(criteria.map((c, i) => [c.id, i]));
  const maxTotal = criteria.reduce((sum, c) => sum + c.maxScore, 0);

  // Apply group-level filters up front.
  let scopedGroups = groups.filter((g) => g.active);
  if (filters.courseId) scopedGroups = scopedGroups.filter((g) => g.courseId === filters.courseId);
  if (filters.studyTypeId) scopedGroups = scopedGroups.filter((g) => g.studyTypeId === filters.studyTypeId);
  if (filters.groupId) scopedGroups = scopedGroups.filter((g) => g.id === filters.groupId);

  const blocksByGroup = new Map<string, typeof rotationBlocks>();
  for (const b of rotationBlocks) {
    if (!blocksByGroup.has(b.groupId)) blocksByGroup.set(b.groupId, []);
    blocksByGroup.get(b.groupId)!.push(b);
  }

  // Students in the scoped groups.
  const scopedGroupIds = scopedGroups.map((g) => g.id);
  const students = scopedGroupIds.length
    ? await prisma.student.findMany({
        where: { active: true, groupId: { in: scopedGroupIds } },
        orderBy: { nameAr: "asc" },
        select: { id: true, nameAr: true, universityNumber: true, groupId: true },
      })
    : [];
  const studentsByGroup = new Map<string, typeof students>();
  for (const s of students) {
    if (!s.groupId) continue;
    if (!studentsByGroup.has(s.groupId)) studentsByGroup.set(s.groupId, []);
    studentsByGroup.get(s.groupId)!.push(s);
  }

  // Every evaluation for these students, keyed by studentId → dateISO.
  const studentIds = students.map((s) => s.id);
  // Select only the columns we use. Notably we do NOT pull the EvaluationScore
  // snapshot columns (labelArAtTime/…): they exist in the Prisma schema but not
  // necessarily in this database, so a blanket `include` would error.
  const evals = studentIds.length
    ? await prisma.evaluation.findMany({
        where: { studentId: { in: studentIds } },
        select: {
          studentId: true,
          dateISO: true,
          attendance: true,
          total: true,
          dailyNoteSubmitted: true,
          scores: { select: { rubricSectionId: true, score: true } },
        },
      })
    : [];
  const evalByStudentDate = new Map<string, (typeof evals)[number]>();
  for (const e of evals) evalByStudentDate.set(`${e.studentId}|${e.dateISO}`, e);

  const daysPerWeek = term.daysPerWeek && term.daysPerWeek > 0 ? term.daysPerWeek : null;

  // Build one SheetGroup per scoped group that has a rotation schedule.
  const sheetGroups: SheetGroup[] = [];
  for (const g of scopedGroups) {
    const blocks = (blocksByGroup.get(g.id) ?? [])
      .slice()
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));

    const columns: SheetColumn[] = [];
    for (const b of blocks) {
      const dates = meetingDates(b.startDate, b.endDate, b.daysOfWeek ?? term.weekdays ?? null);
      // Chunk sequential meeting dates into weeks. Prefer the term's
      // days-per-week; otherwise infer from the block's own day pattern; else
      // fall back to a 1-week-holds-everything grouping.
      const perWeek =
        daysPerWeek ??
        ((b.daysOfWeek ? b.daysOfWeek.split(",").filter(Boolean).length : 0) || dates.length || 1);
      dates.forEach((dateISO, idx) => {
        columns.push({
          key: `${b.id}:${idx}`,
          hospitalId: b.hospitalId,
          hospitalName: b.hospitalName,
          weekIndex: Math.floor(idx / perWeek) + 1,
          dayIndex: (idx % perWeek) + 1,
          dateISO,
        });
      });
    }

    const roster = studentsByGroup.get(g.id) ?? [];
    const sheetStudents: SheetStudent[] = roster.map((s) => ({
      id: s.id,
      name: s.nameAr,
      universityNumber: s.universityNumber,
      cells: columns.map((col) => {
        const e = evalByStudentDate.get(`${s.id}|${col.dateISO}`);
        if (!e) return null;
        const scores: (number | null)[] = criteria.map(() => null);
        for (const sc of e.scores) {
          const ci = criteriaIndex.get(sc.rubricSectionId);
          if (ci !== undefined) scores[ci] = sc.score;
        }
        return {
          attendance: e.attendance as "present" | "late" | "absent",
          total: e.total,
          dailyNoteSubmitted: e.dailyNoteSubmitted,
          scores,
        };
      }),
    }));

    sheetGroups.push({
      id: g.id,
      name: g.name,
      shiftLabel: g.shift ? SHIFT_LABEL[g.shift] : null,
      courseLabel: g.courseLabel,
      columns,
      students: sheetStudents,
    });
  }

  // Group the SheetGroups by study type for the outer rows.
  const byStudyType = new Map<string, SheetGroup[]>();
  for (const g of scopedGroups) {
    const key = g.studyTypeName ?? "بدون نوع دراسة";
    const sheetGroup = sheetGroups.find((sg) => sg.id === g.id);
    if (!sheetGroup) continue;
    if (!byStudyType.has(key)) byStudyType.set(key, []);
    byStudyType.get(key)!.push(sheetGroup);
  }

  const studyTypes: SheetStudyType[] = Array.from(byStudyType.entries())
    .map(([name, groups]) => ({ name, groups }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return { studyTypes, criteria, maxTotal };
}
