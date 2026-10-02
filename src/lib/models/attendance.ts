import { prisma } from "../db";
import { recordAudit } from "../audit";
import { isDateInScheduledDays } from "../weekdays";
import { pickPlacement } from "../evaluator/placement";
import { getEvaluatorSchedule, EvaluatorStint } from "./evaluators";
import { listActiveStudentsInGroup } from "./students";
import { getMaxTotal } from "./rubric";
import { getEvaluationForStudentDate, upsertEvaluation, Attendance } from "./evaluations";

const SHIFT_LABEL_AR: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

export interface AttendanceRecordView {
  status: Attendance;
  markedAt: string;
  dailyNote: boolean | null;
  dailyNoteAt: string | null;
}

function serializeRecord(row: {
  status: string;
  markedAt: Date;
  dailyNote: boolean | null;
  dailyNoteAt: Date | null;
}): AttendanceRecordView {
  return {
    status: row.status as Attendance,
    markedAt: row.markedAt.toISOString(),
    dailyNote: row.dailyNote,
    dailyNoteAt: row.dailyNoteAt ? row.dailyNoteAt.toISOString() : null,
  };
}

export async function getAttendanceRecord(
  studentId: string,
  dateISO: string
): Promise<AttendanceRecordView | null> {
  const row = await prisma.attendanceRecord.findUnique({
    where: { studentId_dateISO: { studentId, dateISO } },
  });
  return row ? serializeRecord(row) : null;
}

// ---- Groups this evaluator can work with on a date ----

export interface ScheduledGroup {
  groupId: string;
  groupName: string;
  hospitalId: string;
  hospitalName: string;
  shift: string | null;
  shiftLabel: string | null;
  studentCount: number;
  // true = the rotation schedule has this group meeting that day;
  // false = an off-schedule day (moved by a holiday etc.)
  scheduled: boolean;
  // Day already started (something recorded) / already validated.
  started: boolean;
  validated: boolean;
}

// Every group of this evaluator that can be worked with on `dateISO`:
// the schedule's groups for the day first (morning before evening), then
// their other groups near their rotation, for days moved by holidays.
export async function getAvailableGroupsForDate(accountId: string, dateISO: string): Promise<ScheduledGroup[]> {
  const stints = await getEvaluatorSchedule(accountId);
  const groupIds = Array.from(new Set(stints.map((s) => s.groupId)));
  if (groupIds.length === 0) return [];
  const [groups, workDays] = await Promise.all([
    prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, shift: true } }),
    prisma.groupWorkDay.findMany({ where: { groupId: { in: groupIds }, dateISO } }),
  ]);
  const shiftById = new Map(groups.map((g) => [g.id, g.shift as string | null]));
  const dayBy = new Map(workDays.map((d) => [d.groupId, d]));
  const out: ScheduledGroup[] = [];
  for (const groupId of groupIds) {
    const placement = pickPlacement(stints, groupId, dateISO);
    if (!placement) continue;
    const stint = stints.find((s) => s.groupId === groupId)!;
    const shift = shiftById.get(groupId) ?? null;
    const day = dayBy.get(groupId);
    out.push({
      groupId,
      groupName: stint.groupName,
      hospitalId: placement.hospitalId,
      hospitalName: placement.hospitalName,
      shift,
      shiftLabel: shift ? SHIFT_LABEL_AR[shift] ?? null : null,
      studentCount: stint.studentCount,
      scheduled: placement.scheduled,
      started: !!day,
      validated: !!day?.validatedAt,
    });
  }
  const rank = (g: ScheduledGroup) => (g.scheduled || g.started ? 0 : 2) + (g.shift === "EVENING" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.groupName.localeCompare(b.groupName, "ar"));
}

// ---- One group's roster for one day ----

export interface DayRosterRow {
  id: string;
  nameAr: string;
  universityNumber: string;
  attendance: Attendance | null;
  markedAt: string | null;
  dailyNote: boolean | null;
  evaluated: boolean;
  total: number | null;
  locked: boolean;
}

export interface DayRoster {
  dateISO: string;
  maxTotal: number;
  rows: DayRosterRow[];
}

export async function getGroupDayRoster(groupId: string, dateISO: string): Promise<DayRoster> {
  const students = await listActiveStudentsInGroup(groupId);
  const ids = students.map((s) => s.id);
  const [records, evaluations, maxTotal] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { studentId: { in: ids }, dateISO } }),
    prisma.evaluation.findMany({
      where: { studentId: { in: ids }, dateISO },
      select: { studentId: true, attendance: true, total: true, locked: true, dailyNoteSubmitted: true },
    }),
    getMaxTotal(),
  ]);
  const recordBy = new Map(records.map((r) => [r.studentId, r]));
  const evalBy = new Map(evaluations.map((e) => [e.studentId, e]));
  const rows = students
    .map((s): DayRosterRow => {
      const rec = recordBy.get(s.id);
      const ev = evalBy.get(s.id);
      // An evaluation saved before attendance records existed still shows
      // its attendance; the record wins when both exist.
      const attendance = (rec?.status ?? ev?.attendance ?? null) as Attendance | null;
      return {
        id: s.id,
        nameAr: s.nameAr,
        universityNumber: s.universityNumber,
        attendance,
        markedAt: rec ? rec.markedAt.toISOString() : null,
        dailyNote: rec ? rec.dailyNote : ev ? (ev.dailyNoteSubmitted ? true : null) : null,
        evaluated: !!ev,
        total: ev ? ev.total : null,
        locked: ev?.locked ?? false,
      };
    })
    .sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar"));
  return { dateISO, maxTotal, rows };
}

// ---- Writes (scope is checked by the caller: src/lib/actions/attendance.ts) ----

// Marks attendance from the quick list. Absent also saves a zero evaluation
// (so absences reach the grading center and at-risk flags). Undoing an
// absence removes that zero evaluation again, but only if it is still the
// untouched absent one and not locked; a real graded evaluation just gets
// its attendance updated.
export async function markAttendance(
  actorId: string,
  studentId: string,
  dateISO: string,
  status: Attendance,
  where: { groupId: string; hospitalId: string | null }
): Promise<void> {
  const existingEval = await getEvaluationForStudentDate(studentId, dateISO);
  if (existingEval?.locked) throw new Error("هذا التقييم مقفل ولا يمكن تعديله");

  const before = await getAttendanceRecord(studentId, dateISO);

  if (status === "absent") {
    await upsertEvaluation(actorId, {
      studentId,
      evaluatorId: actorId,
      dateISO,
      attendance: "absent",
      notes: existingEval?.notes ?? undefined,
      feedback: existingEval?.feedback ?? undefined,
      dailyNote: null,
      scores: {},
      pendingValidation: true,
      hospitalId: where.hospitalId,
      groupId: where.groupId,
    });
    return; // upsertEvaluation wrote the attendance record
  }

  if (existingEval && existingEval.attendance === "absent") {
    await prisma.$transaction([
      prisma.evaluationScore.deleteMany({ where: { evaluationId: existingEval.id } }),
      prisma.evaluation.delete({ where: { id: existingEval.id } }),
    ]);
    await recordAudit({
      actorId,
      entityType: "Evaluation",
      entityId: existingEval.id,
      action: "delete",
      before: existingEval,
      after: { reason: "attendance changed from absent to " + status },
    });
  } else if (existingEval && existingEval.attendance !== status) {
    await prisma.evaluation.update({
      where: { id: existingEval.id },
      data: { attendance: status, pendingValidation: true },
    });
  }

  const { groupId, hospitalId } = where;
  if (before?.status === status) return;
  const now = new Date();
  await prisma.attendanceRecord.upsert({
    where: { studentId_dateISO: { studentId, dateISO } },
    create: { studentId, dateISO, groupId, hospitalId, status, markedAt: now, markedById: actorId },
    update: { groupId, hospitalId, status, markedAt: now, markedById: actorId },
  });
  await recordAudit({
    actorId,
    entityType: "AttendanceRecord",
    entityId: `${studentId}:${dateISO}`,
    action: before ? "update" : "create",
    before,
    after: { status },
  });
}

// Daily note handed in (true), not handed in (false) or cleared (null).
// Only for a student who isn't absent; a graded evaluation's
// dailyNoteSubmitted flag follows it so exports stay consistent.
export async function setDailyNote(
  actorId: string,
  studentId: string,
  dateISO: string,
  delivered: boolean | null,
  where: { groupId: string; hospitalId: string | null }
): Promise<void> {
  const before = await getAttendanceRecord(studentId, dateISO);
  const existingEval = await getEvaluationForStudentDate(studentId, dateISO);
  const status = before?.status ?? existingEval?.attendance ?? null;
  if (status === "absent") throw new Error("الطالب غائب اليوم — لا يمكن تسجيل تسليم الملاحظة اليومية");
  if (existingEval?.locked) throw new Error("هذا التقييم مقفل ولا يمكن تعديله");

  const { groupId, hospitalId } = where;
  const now = new Date();
  const note = {
    dailyNote: delivered,
    dailyNoteAt: delivered === null ? null : now,
    dailyNoteById: delivered === null ? null : actorId,
  };
  // Handing in a daily note means the student is there: an unmarked
  // student is recorded present at the same time.
  await prisma.attendanceRecord.upsert({
    where: { studentId_dateISO: { studentId, dateISO } },
    create: {
      studentId,
      dateISO,
      groupId,
      hospitalId,
      status: status ?? "present",
      markedAt: now,
      markedById: actorId,
      ...note,
    },
    update: { groupId, hospitalId, ...note },
  });
  if (existingEval) {
    await prisma.evaluation.update({
      where: { id: existingEval.id },
      data: { dailyNoteSubmitted: delivered === true, pendingValidation: true },
    });
  }
  await recordAudit({
    actorId,
    entityType: "AttendanceRecord",
    entityId: `${studentId}:${dateISO}`,
    action: before ? "update" : "create",
    before,
    after: { dailyNote: delivered },
  });
}

// ---- Attendance log: one group, every scheduled day up to today ----

export interface AttendanceLogCell {
  status: Attendance | null;
  markedAt: string | null;
  dailyNote: boolean | null;
  total: number | null;
}

export interface AttendanceLog {
  groupId: string;
  dates: string[];
  // Days worked that the schedule didn't list (holidays moved them), and
  // days whose grades are validated.
  offScheduleDates: string[];
  validatedDates: string[];
  students: Array<{
    id: string;
    nameAr: string;
    universityNumber: string;
    cells: Record<string, AttendanceLogCell>;
    present: number;
    late: number;
    absent: number;
    notesDelivered: number;
  }>;
}

function meetingDatesUpTo(stints: EvaluatorStint[], groupId: string, untilISO: string): string[] {
  const dates = new Set<string>();
  for (const s of stints) {
    if (s.groupId !== groupId) continue;
    const start = new Date(`${s.startDate}T00:00:00Z`);
    const endISO = s.endDate < untilISO ? s.endDate : untilISO;
    const end = new Date(`${endISO}T00:00:00Z`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    let guard = 0;
    for (let d = new Date(start); d <= end && guard < 400; d.setUTCDate(d.getUTCDate() + 1), guard++) {
      const iso = d.toISOString().slice(0, 10);
      if (isDateInScheduledDays(iso, s.daysOfWeek)) dates.add(iso);
    }
  }
  return Array.from(dates).sort();
}

// Only groups on this evaluator's own schedule, only their meeting days.
export async function getAttendanceLog(
  accountId: string,
  groupId: string,
  untilISO: string
): Promise<AttendanceLog | null> {
  const stints = await getEvaluatorSchedule(accountId);
  if (!stints.some((s) => s.groupId === groupId)) return null;
  const workDays = await prisma.groupWorkDay.findMany({ where: { groupId, dateISO: { lte: untilISO } } });
  const dates = Array.from(new Set([...meetingDatesUpTo(stints, groupId, untilISO), ...workDays.map((d) => d.dateISO)])).sort();
  const students = await listActiveStudentsInGroup(groupId);
  const ids = students.map((s) => s.id);
  const [records, evaluations] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { studentId: { in: ids }, dateISO: { in: dates } } }),
    prisma.evaluation.findMany({
      where: { studentId: { in: ids }, dateISO: { in: dates } },
      select: { studentId: true, dateISO: true, attendance: true, total: true, dailyNoteSubmitted: true },
    }),
  ]);
  const key = (studentId: string, dateISO: string) => `${studentId}:${dateISO}`;
  const recordBy = new Map(records.map((r) => [key(r.studentId, r.dateISO), r]));
  const evalBy = new Map(evaluations.map((e) => [key(e.studentId, e.dateISO), e]));

  return {
    groupId,
    dates,
    offScheduleDates: workDays.filter((d) => !d.scheduled).map((d) => d.dateISO),
    validatedDates: workDays.filter((d) => d.validatedAt).map((d) => d.dateISO),
    students: students
      .map((s) => {
        const cells: Record<string, AttendanceLogCell> = {};
        let present = 0,
          late = 0,
          absent = 0,
          notesDelivered = 0;
        for (const d of dates) {
          const rec = recordBy.get(key(s.id, d));
          const ev = evalBy.get(key(s.id, d));
          const status = (rec?.status ?? ev?.attendance ?? null) as Attendance | null;
          const dailyNote = rec ? rec.dailyNote : ev ? (ev.dailyNoteSubmitted ? true : null) : null;
          cells[d] = { status, markedAt: rec ? rec.markedAt.toISOString() : null, dailyNote, total: ev ? ev.total : null };
          if (status === "present") present++;
          if (status === "late") late++;
          if (status === "absent") absent++;
          if (dailyNote === true) notesDelivered++;
        }
        return { id: s.id, nameAr: s.nameAr, universityNumber: s.universityNumber, cells, present, late, absent, notesDelivered };
      })
      .sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar")),
  };
}

// ---- درجات اليوم: the whole group's grades for one day, item by item ----

export interface DayGradeRow {
  id: string;
  nameAr: string;
  universityNumber: string;
  attendance: Attendance | null;
  dailyNote: boolean | null;
  evaluated: boolean;
  total: number | null;
  locked: boolean;
  scores: Record<string, number>; // sectionId -> score
  itemScores: Record<string, number>; // itemId -> score
}

export async function getGroupDayGrades(groupId: string, dateISO: string): Promise<DayGradeRow[]> {
  const students = await listActiveStudentsInGroup(groupId);
  const ids = students.map((s) => s.id);
  const [records, evaluations] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { studentId: { in: ids }, dateISO } }),
    prisma.evaluation.findMany({
      where: { studentId: { in: ids }, dateISO },
      include: { scores: { select: { rubricSectionId: true, score: true } } },
    }),
  ]);
  const recordBy = new Map(records.map((r) => [r.studentId, r]));
  const evalBy = new Map(evaluations.map((e) => [e.studentId, e]));
  return students
    .map((s): DayGradeRow => {
      const rec = recordBy.get(s.id);
      const ev = evalBy.get(s.id);
      const itemScores: Record<string, number> = {};
      const raw = ev?.itemScores;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v === "number") itemScores[k] = v;
        }
      }
      const scores: Record<string, number> = {};
      ev?.scores.forEach((x) => (scores[x.rubricSectionId] = x.score));
      return {
        id: s.id,
        nameAr: s.nameAr,
        universityNumber: s.universityNumber,
        attendance: (rec?.status ?? ev?.attendance ?? null) as Attendance | null,
        dailyNote: rec ? rec.dailyNote : ev ? (ev.dailyNoteSubmitted ? true : null) : null,
        evaluated: !!ev,
        total: ev ? ev.total : null,
        locked: ev?.locked ?? false,
        scores,
        itemScores,
      };
    })
    .sort((a, b) => a.nameAr.localeCompare(b.nameAr, "ar"));
}
