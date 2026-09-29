import { prisma } from "../db";
import { recordAudit } from "../audit";
import { isDateInScheduledDays } from "../weekdays";
import { getEvaluatorSchedule, EvaluatorStint } from "./evaluators";
import { listActiveStudentsInGroup } from "./students";
import { getMaxTotal } from "./rubric";
import { getScheduledRotationForDate } from "./rotationBlocks";
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

// ---- Groups the schedule puts in front of this evaluator on a date ----

export interface ScheduledGroup {
  groupId: string;
  groupName: string;
  hospitalId: string;
  hospitalName: string;
  shift: string | null;
  shiftLabel: string | null;
  studentCount: number;
}

function meetsOn(stint: EvaluatorStint, dateISO: string): boolean {
  return stint.startDate <= dateISO && stint.endDate >= dateISO && isDateInScheduledDays(dateISO, stint.daysOfWeek);
}

// The groups whose rotation block meets on `dateISO` at a hospital this
// evaluator is assigned to: what "load the group by the schedule" means.
// Morning groups come first, the same default the reference app uses.
export async function getScheduledGroupsForDate(accountId: string, dateISO: string): Promise<ScheduledGroup[]> {
  const stints = (await getEvaluatorSchedule(accountId)).filter((s) => meetsOn(s, dateISO));
  if (stints.length === 0) return [];
  const groups = await prisma.group.findMany({
    where: { id: { in: stints.map((s) => s.groupId) } },
    select: { id: true, shift: true },
  });
  const shiftById = new Map(groups.map((g) => [g.id, g.shift as string | null]));
  const seen = new Set<string>();
  const out: ScheduledGroup[] = [];
  for (const s of stints) {
    if (seen.has(s.groupId)) continue;
    seen.add(s.groupId);
    const shift = shiftById.get(s.groupId) ?? null;
    out.push({
      groupId: s.groupId,
      groupName: s.groupName,
      hospitalId: s.hospitalId,
      hospitalName: s.hospitalName,
      shift,
      shiftLabel: shift ? SHIFT_LABEL_AR[shift] ?? null : null,
      studentCount: s.studentCount,
    });
  }
  const order = (g: ScheduledGroup) => (g.shift === "EVENING" ? 1 : 0);
  return out.sort((a, b) => order(a) - order(b) || a.groupName.localeCompare(b.groupName, "ar"));
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

async function groupHospitalFor(studentId: string, dateISO: string) {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { groupId: true } });
  if (!student?.groupId) return { groupId: null, hospitalId: null };
  const block = await getScheduledRotationForDate(student.groupId, dateISO);
  return { groupId: student.groupId, hospitalId: block?.hospitalId ?? null };
}

// Marks attendance from the quick list. Absent also saves a zero evaluation
// (so absences reach the grading center and at-risk flags). Undoing an
// absence removes that zero evaluation again, but only if it is still the
// untouched absent one and not locked; a real graded evaluation just gets
// its attendance updated.
export async function markAttendance(
  actorId: string,
  studentId: string,
  dateISO: string,
  status: Attendance
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
    await prisma.evaluation.update({ where: { id: existingEval.id }, data: { attendance: status } });
  }

  const { groupId, hospitalId } = await groupHospitalFor(studentId, dateISO);
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
  delivered: boolean | null
): Promise<void> {
  const before = await getAttendanceRecord(studentId, dateISO);
  const existingEval = await getEvaluationForStudentDate(studentId, dateISO);
  const status = before?.status ?? existingEval?.attendance ?? null;
  if (status === "absent") throw new Error("الطالب غائب اليوم — لا يمكن تسجيل تسليم الملاحظة اليومية");
  if (existingEval?.locked) throw new Error("هذا التقييم مقفل ولا يمكن تعديله");

  const { groupId, hospitalId } = await groupHospitalFor(studentId, dateISO);
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
      data: { dailyNoteSubmitted: delivered === true },
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
  const dates = meetingDatesUpTo(stints, groupId, untilISO);
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
