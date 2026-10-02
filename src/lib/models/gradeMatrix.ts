import { prisma } from "../db";
import { todayISO } from "../date";
import { listGroups } from "./groups";
import { listAllRotationBlocks } from "./rotationBlocks";
import { listRubricSections } from "./rubric";
import { getTermSettings } from "./termSettings";
import {
  HOSPITAL_PALETTE,
  SUBMIT_WINDOW_DAYS,
  asAttendance,
  groupDates,
  resolveDayState,
} from "../gradeMatrix/build";
import type {
  GradeMatrixData,
  MatrixDay,
  MatrixGroup,
  MatrixHospital,
  MatrixProgram,
  ProgramId,
} from "../gradeMatrix/types";

// Loads one course's grades into the Grading Center matrix (see
// src/lib/gradeMatrix/types.ts). Read-only. Only validated evaluations
// (pendingValidation = false) carry grades; a day the evaluator saved but
// hasn't validated shows as "awaiting" with no numbers.

const PROGRAM_LABEL: Record<ProgramId, string> = {
  MORNING: "البرنامج الصباحي",
  EVENING: "البرنامج المسائي",
  NONE: "بدون وردية",
};

const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

// Tables added by later migrations may be missing on an older database:
// those reads degrade to "nothing recorded" instead of failing the page.
async function optional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.error("[gradeMatrix] optional read failed", err);
    return fallback;
  }
}

export async function getGradeMatrix(courseId: string | null, courseLabel: string): Promise<GradeMatrixData> {
  const today = todayISO();
  const [groups, blocks, sections, term] = await Promise.all([
    listGroups(true),
    listAllRotationBlocks(false),
    listRubricSections(false),
    getTermSettings(),
  ]);

  const criteria = sections.map((s) => ({ id: s.id, label: s.labelAr, max: s.maxScore }));
  const criteriaIndex = new Map(criteria.map((c, i) => [c.id, i]));
  const maxTotal = criteria.reduce((sum, c) => sum + c.max, 0);

  const scoped = groups.filter((g) => g.active && (!courseId || g.courseId === courseId));
  const groupIds = scoped.map((g) => g.id);
  const inScope = new Set(groupIds);

  const blocksByGroup = new Map<string, typeof blocks>();
  for (const b of blocks) {
    if (!inScope.has(b.groupId)) continue;
    if (!blocksByGroup.has(b.groupId)) blocksByGroup.set(b.groupId, []);
    blocksByGroup.get(b.groupId)!.push(b);
  }

  const students = groupIds.length
    ? await prisma.student.findMany({
        where: { active: true, groupId: { in: groupIds } },
        select: { id: true, nameAr: true, universityNumber: true, code: true, groupId: true },
      })
    : [];
  const studentIds = students.map((s) => s.id);

  // Only the columns this view uses — the EvaluationScore snapshot columns
  // may not exist on every database (see gradingSheet.ts).
  const [evaluations, attendance, workDays, holidays, conflicts] = studentIds.length
    ? await Promise.all([
        prisma.evaluation.findMany({
          where: { studentId: { in: studentIds } },
          select: {
            studentId: true,
            dateISO: true,
            hospitalId: true,
            attendance: true,
            total: true,
            dailyNoteSubmitted: true,
            locked: true,
            notes: true,
            feedback: true,
            pendingValidation: true,
            updatedAt: true,
            evaluator: { select: { name: true } },
            scores: { select: { rubricSectionId: true, score: true } },
          },
        }),
        optional(
          () =>
            prisma.attendanceRecord.findMany({
              where: { studentId: { in: studentIds } },
              select: { studentId: true, dateISO: true, status: true, dailyNote: true },
            }),
          []
        ),
        optional(
          () =>
            prisma.groupWorkDay.findMany({
              where: { groupId: { in: groupIds }, validatedAt: { not: null } },
              select: { groupId: true, dateISO: true },
            }),
          []
        ),
        courseId
          ? optional(
              () =>
                prisma.courseHoliday.findMany({ where: { courseId }, select: { dateISO: true, label: true } }),
              []
            )
          : Promise.resolve([] as { dateISO: string; label: string | null }[]),
        optional(
          () =>
            prisma.evaluationConflict.findMany({
              where: { status: "open", studentId: { in: studentIds } },
              select: { studentId: true, dateISO: true },
            }),
          []
        ),
      ])
    : [[], [], [], [], []];

  const evalBy = new Map(evaluations.map((e) => [`${e.studentId}|${e.dateISO}`, e]));
  const attendanceBy = new Map(attendance.map((a) => [`${a.studentId}|${a.dateISO}`, a]));
  const validatedDays = new Set(workDays.map((w) => `${w.groupId}|${w.dateISO}`));
  const holidayBy = new Map(holidays.map((h) => [h.dateISO, h.label ?? "عطلة رسمية"]));
  const disputed = new Set(conflicts.map((c) => `${c.studentId}|${c.dateISO}`));

  // Hospitals in the order groups first reach them; that order fixes each
  // hospital's color for both programs.
  const hospitalName = new Map<string, string>();
  const firstSeen = new Map<string, string>();
  const datesByGroup = new Map<string, { dateISO: string; hospitalId: string }[]>();
  for (const g of scoped) {
    const gb = blocksByGroup.get(g.id) ?? [];
    for (const b of gb) hospitalName.set(b.hospitalId, b.hospitalName);
    const dates = groupDates(gb, term.weekdays ?? null);
    datesByGroup.set(g.id, dates);
    for (const d of dates) {
      const seen = firstSeen.get(d.hospitalId);
      if (!seen || d.dateISO < seen) firstSeen.set(d.hospitalId, d.dateISO);
    }
  }
  const hospitals: MatrixHospital[] = Array.from(firstSeen.entries())
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : collator.compare(hospitalName.get(a[0])!, hospitalName.get(b[0])!)))
    .map(([id], i) => ({ id, name: hospitalName.get(id) ?? "—", color: HOSPITAL_PALETTE[i % HOSPITAL_PALETTE.length] }));

  function toDay(
    studentId: string,
    groupId: string,
    dateISO: string,
    hospitalId: string
  ): MatrixDay {
    const key = `${studentId}|${dateISO}`;
    const e = evalBy.get(key);
    const a = attendanceBy.get(key);
    const holidayLabel = holidayBy.get(dateISO) ?? null;
    const state = resolveDayState({
      dateISO,
      todayISO: today,
      holiday: holidayLabel !== null,
      evaluation: e ? { pendingValidation: e.pendingValidation, attendance: e.attendance } : null,
      attendanceStatus: a?.status ?? null,
      workDayValidated: validatedDays.has(`${groupId}|${dateISO}`),
      disputed: disputed.has(key),
    });
    const visible = e && !e.pendingValidation;
    let scores: (number | null)[] | null = null;
    if (visible) {
      scores = criteria.map(() => null);
      for (const s of e.scores) {
        const ci = criteriaIndex.get(s.rubricSectionId);
        if (ci !== undefined) scores[ci] = s.score;
      }
    }
    return {
      dateISO,
      hospitalId,
      state,
      attendance: visible ? asAttendance(e.attendance) : state === "absent" ? "absent" : null,
      total: visible ? e.total : null,
      scores,
      evaluatorName: e?.evaluator?.name ?? null,
      notes: visible ? e.notes : null,
      feedback: visible ? e.feedback : null,
      dailyNote: visible ? e.dailyNoteSubmitted : a?.dailyNote ?? null,
      locked: e?.locked ?? false,
      savedAt: e ? e.updatedAt.toISOString() : null,
      holidayLabel,
    };
  }

  const studentsByGroup = new Map<string, typeof students>();
  for (const s of students) {
    if (!s.groupId) continue;
    if (!studentsByGroup.has(s.groupId)) studentsByGroup.set(s.groupId, []);
    studentsByGroup.get(s.groupId)!.push(s);
  }
  const evalsByStudent = new Map<string, typeof evaluations>();
  for (const e of evaluations) {
    if (!evalsByStudent.has(e.studentId)) evalsByStudent.set(e.studentId, []);
    evalsByStudent.get(e.studentId)!.push(e);
  }

  const programs = new Map<ProgramId, MatrixGroup[]>();
  for (const g of scoped.slice().sort((a, b) => collator.compare(a.name, b.name))) {
    const dates = datesByGroup.get(g.id) ?? [];
    const scheduled = new Set(dates.map((d) => d.dateISO));
    const stints = (blocksByGroup.get(g.id) ?? [])
      .slice()
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
      .map((b) => ({ hospitalId: b.hospitalId, start: b.startDate, end: b.endDate }));
    const roster = (studentsByGroup.get(g.id) ?? [])
      .slice()
      .sort((a, b) => collator.compare(a.nameAr, b.nameAr) || a.universityNumber.localeCompare(b.universityNumber));
    const group: MatrixGroup = {
      id: g.id,
      name: g.name,
      stints,
      dates,
      students: roster.map((s) => ({
        id: s.id,
        name: s.nameAr,
        uni: s.universityNumber,
        code: s.code,
        days: dates.map((d) => toDay(s.id, g.id, d.dateISO, d.hospitalId)),
        unplaced: (evalsByStudent.get(s.id) ?? [])
          .filter((e) => !e.pendingValidation && !scheduled.has(e.dateISO))
          .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1))
          .map((e) => toDay(s.id, g.id, e.dateISO, e.hospitalId ?? "")),
      })),
    };
    const pid: ProgramId = g.shift === "MORNING" || g.shift === "EVENING" ? g.shift : "NONE";
    if (!programs.has(pid)) programs.set(pid, []);
    programs.get(pid)!.push(group);
  }

  const order: ProgramId[] = ["MORNING", "EVENING", "NONE"];
  const programList: MatrixProgram[] = order
    .filter((id) => programs.has(id))
    .map((id) => ({ id, label: PROGRAM_LABEL[id], groups: programs.get(id)! }));

  return {
    courseId,
    courseLabel,
    todayISO: today,
    windowDays: SUBMIT_WINDOW_DAYS,
    criteria,
    maxTotal,
    hospitals,
    programs: programList,
    holidays: Object.fromEntries(holidayBy),
  };
}
