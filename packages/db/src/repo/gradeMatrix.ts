// The Grading Center matrix for Eva Desktop: one course's schedule and
// grades in the shape the shared views read (@eva/core/gradeMatrix/types),
// the same data the website builds from Postgres. Read-only. Only validated
// grades (pendingValidation = false) carry numbers; a day the evaluator saved
// but has not validated shows as "awaiting".
import { and, eq, inArray, sql } from "drizzle-orm";
import { todayISO } from "@eva/core/date";
import { compareArabic } from "@eva/core/text/arabic";
import { HOSPITAL_PALETTE, SUBMIT_WINDOW_DAYS, addDays, asAttendance, groupDates, resolveDayState } from "@eva/core/gradeMatrix/build";
import type { GradeMatrixData, MatrixDay, MatrixGroup, MatrixHospital, MatrixStint, ProgramId } from "@eva/core/gradeMatrix/types";
import * as t from "../schema";
import { type Repo } from "./common";

const PROGRAM_LABEL: Record<ProgramId, string> = { MORNING: "البرنامج الصباحي", EVENING: "البرنامج المسائي", NONE: "بدون وردية" };
const DEFAULT_DAYS = "SUN,MON,TUE,WED,THU";
const CHUNK = 5000; // SQLite caps a query's parameters

async function inChunks<T>(ids: string[], read: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let k = 0; k < ids.length; k += CHUNK) out.push(...(await read(ids.slice(k, k + CHUNK))));
  return out;
}

/**
 * The desktop stores a rotation one block per week; the views want one stay
 * per hospital. Back-to-back blocks at the same hospital (the next starts
 * within a weekend of the last one's end) become one stint.
 */
export function mergeStints(blocks: { hospitalId: string; startDate: string; endDate: string }[]): MatrixStint[] {
  const out: MatrixStint[] = [];
  for (const b of blocks.slice().sort((a, b) => a.startDate.localeCompare(b.startDate))) {
    const last = out[out.length - 1];
    if (last && last.hospitalId === b.hospitalId && b.startDate <= addDays(last.end, 3)) {
      if (b.endDate > last.end) last.end = b.endDate;
    } else out.push({ hospitalId: b.hospitalId, start: b.startDate, end: b.endDate });
  }
  return out;
}

export async function gradeMatrix(r: Repo, courseId: string, today = todayISO()): Promise<GradeMatrixData> {
  const [course] = await r.db.select().from(t.courses).where(eq(t.courses.id, courseId));
  const courseLabel = course?.label ?? (course ? `${course.year}-${course.number}` : "");
  const sections = (await r.db.select().from(t.rubricSections).where(eq(t.rubricSections.active, true))).sort((a, b) => a.sortOrder - b.sortOrder);
  const criteria = sections.map((s) => ({ id: s.id, label: s.labelAr, max: s.maxScore }));
  const criteriaIndex = new Map(criteria.map((c, i) => [c.id, i]));
  const maxTotal = criteria.reduce((sum, c) => sum + c.max, 0);

  const groups = await r.db
    .select()
    .from(t.groups)
    .where(and(eq(t.groups.courseId, courseId), eq(t.groups.active, true)));
  const groupIds = groups.map((g) => g.id);
  const [pattern] = await r.db.select().from(t.courseAttendancePatterns).where(eq(t.courseAttendancePatterns.courseId, courseId));
  const fallbackDays = pattern?.daysOfWeek ?? DEFAULT_DAYS;

  const blocks = groupIds.length
    ? await r.db
        .select({ groupId: t.rotationBlocks.groupId, hospitalId: t.rotationBlocks.hospitalId, startDate: t.rotationBlocks.startDate, endDate: t.rotationBlocks.endDate, daysOfWeek: t.rotationBlocks.daysOfWeek, hospitalName: t.hospitals.name })
        .from(t.rotationBlocks)
        .innerJoin(t.hospitals, eq(t.hospitals.id, t.rotationBlocks.hospitalId))
        .where(and(inArray(t.rotationBlocks.groupId, groupIds), eq(t.rotationBlocks.active, true)))
    : [];
  const blocksByGroup = new Map<string, typeof blocks>();
  for (const b of blocks) blocksByGroup.set(b.groupId, [...(blocksByGroup.get(b.groupId) ?? []), b]);

  const students = groupIds.length
    ? await r.db
        .select({ id: t.students.id, nameAr: t.students.nameAr, universityNumber: t.students.universityNumber, code: t.students.code, groupId: t.students.groupId })
        .from(t.students)
        .where(and(inArray(t.students.groupId, groupIds), eq(t.students.active, true)))
    : [];
  const studentIds = students.map((s) => s.id);

  const evaluations = await inChunks(studentIds, (ids) =>
    r.db
      .select({
        id: t.evaluations.id, studentId: t.evaluations.studentId, dateISO: t.evaluations.dateISO, hospitalId: t.evaluations.hospitalId,
        attendance: t.evaluations.attendance, total: t.evaluations.total, dailyNote: t.evaluations.dailyNoteSubmitted, locked: t.evaluations.locked,
        notes: t.evaluations.notes, feedback: t.evaluations.feedback, pending: t.evaluations.pendingValidation, status: t.evaluations.status,
        updatedAt: t.evaluations.updatedAt, evaluatorName: t.accounts.name,
        // One string per evaluation ("sectionId=score,…"): a full course has
        // ~5 scores per grade, and one row per grade is far cheaper to read.
        scores: sql<string | null>`(SELECT group_concat(${t.evaluationScores.rubricSectionId} || '=' || ${t.evaluationScores.score}, ',') FROM ${t.evaluationScores} WHERE ${t.evaluationScores.evaluationId} = ${t.evaluations.id})`,
      })
      .from(t.evaluations)
      .leftJoin(t.accounts, eq(t.accounts.id, t.evaluations.evaluatorId))
      .where(inArray(t.evaluations.studentId, ids))
  );
  const attendance = await inChunks(studentIds, (ids) =>
    r.db.select({ studentId: t.attendanceRecords.studentId, dateISO: t.attendanceRecords.dateISO, status: t.attendanceRecords.status, dailyNote: t.attendanceRecords.dailyNote }).from(t.attendanceRecords).where(inArray(t.attendanceRecords.studentId, ids))
  );
  const workDays = groupIds.length
    ? await r.db.select({ groupId: t.groupWorkDays.groupId, dateISO: t.groupWorkDays.dateISO, validatedAt: t.groupWorkDays.validatedAt }).from(t.groupWorkDays).where(inArray(t.groupWorkDays.groupId, groupIds))
    : [];
  const holidays = await r.db.select({ dateISO: t.courseHolidays.dateISO, label: t.courseHolidays.label }).from(t.courseHolidays).where(eq(t.courseHolidays.courseId, courseId));

  const scoresBy = new Map<string, (number | null)[]>();
  for (const e of evaluations) {
    if (!e.scores || e.pending) continue;
    const row: (number | null)[] = criteria.map(() => null);
    for (const pair of e.scores.split(",")) {
      const at = pair.lastIndexOf("=");
      const ci = criteriaIndex.get(pair.slice(0, at));
      if (ci !== undefined) row[ci] = Number(pair.slice(at + 1));
    }
    scoresBy.set(e.id, row);
  }
  const evalBy = new Map(evaluations.map((e) => [`${e.studentId}|${e.dateISO}`, e]));
  const attendanceBy = new Map(attendance.map((a) => [`${a.studentId}|${a.dateISO}`, a]));
  const validatedDays = new Set(workDays.filter((w) => w.validatedAt).map((w) => `${w.groupId}|${w.dateISO}`));
  const holidayBy = new Map(holidays.map((h) => [h.dateISO, h.label ?? "عطلة رسمية"]));

  // Hospitals in the order groups first reach them; that order fixes each
  // hospital's color for both programs.
  const hospitalName = new Map<string, string>();
  const firstSeen = new Map<string, string>();
  const datesByGroup = new Map<string, { dateISO: string; hospitalId: string }[]>();
  for (const g of groups) {
    const gb = blocksByGroup.get(g.id) ?? [];
    for (const b of gb) hospitalName.set(b.hospitalId, b.hospitalName);
    const dates = groupDates(gb, fallbackDays);
    datesByGroup.set(g.id, dates);
    for (const d of dates) {
      const seen = firstSeen.get(d.hospitalId);
      if (!seen || d.dateISO < seen) firstSeen.set(d.hospitalId, d.dateISO);
    }
  }
  const hospitals: MatrixHospital[] = [...firstSeen.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]) || compareArabic(hospitalName.get(a[0])!, hospitalName.get(b[0])!))
    .map(([id], i) => ({ id, name: hospitalName.get(id) ?? "—", color: HOSPITAL_PALETTE[i % HOSPITAL_PALETTE.length] }));

  function toDay(studentId: string, groupId: string, dateISO: string, hospitalId: string): MatrixDay {
    const key = `${studentId}|${dateISO}`;
    const e = evalBy.get(key);
    const a = attendanceBy.get(key);
    const holidayLabel = holidayBy.get(dateISO) ?? null;
    const state = resolveDayState({
      dateISO,
      todayISO: today,
      holiday: holidayLabel !== null,
      evaluation: e ? { pendingValidation: e.pending, attendance: e.attendance } : null,
      attendanceStatus: a?.status ?? null,
      workDayValidated: validatedDays.has(`${groupId}|${dateISO}`),
      disputed: e?.status === "DISPUTED",
    });
    const visible = !!e && !e.pending;
    return {
      dateISO,
      hospitalId,
      state,
      attendance: visible ? asAttendance(e.attendance) : state === "absent" ? "absent" : null,
      total: visible ? e.total : null,
      scores: visible ? (scoresBy.get(e.id) ?? criteria.map(() => null)) : null,
      evaluatorName: e?.evaluatorName ?? null,
      notes: visible ? e.notes : null,
      feedback: visible ? e.feedback : null,
      dailyNote: visible ? e.dailyNote : (a?.dailyNote ?? null),
      locked: e?.locked ?? false,
      savedAt: e?.updatedAt ?? null,
      holidayLabel,
    };
  }

  const studentsByGroup = new Map<string, typeof students>();
  for (const s of students) if (s.groupId) studentsByGroup.set(s.groupId, [...(studentsByGroup.get(s.groupId) ?? []), s]);
  const evalsByStudent = new Map<string, typeof evaluations>();
  for (const e of evaluations) evalsByStudent.set(e.studentId, [...(evalsByStudent.get(e.studentId) ?? []), e]);

  const programs = new Map<ProgramId, MatrixGroup[]>();
  for (const g of groups.slice().sort((a, b) => a.name.localeCompare(b.name, "ar", { numeric: true }))) {
    const dates = datesByGroup.get(g.id) ?? [];
    const scheduled = new Set(dates.map((d) => d.dateISO));
    const roster = (studentsByGroup.get(g.id) ?? []).slice().sort((a, b) => compareArabic(a.nameAr, b.nameAr) || a.universityNumber.localeCompare(b.universityNumber));
    const group: MatrixGroup = {
      id: g.id,
      name: g.name,
      stints: mergeStints(blocksByGroup.get(g.id) ?? []),
      dates,
      students: roster.map((s) => ({
        id: s.id,
        name: s.nameAr,
        uni: s.universityNumber,
        code: s.code,
        days: dates.map((d) => toDay(s.id, g.id, d.dateISO, d.hospitalId)),
        unplaced: (evalsByStudent.get(s.id) ?? [])
          .filter((e) => !e.pending && !scheduled.has(e.dateISO))
          .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
          .map((e) => toDay(s.id, g.id, e.dateISO, e.hospitalId ?? "")),
      })),
    };
    const pid: ProgramId = g.shift === "MORNING" || g.shift === "EVENING" ? g.shift : "NONE";
    programs.set(pid, [...(programs.get(pid) ?? []), group]);
  }

  return {
    courseId,
    courseLabel,
    todayISO: today,
    windowDays: SUBMIT_WINDOW_DAYS,
    criteria,
    maxTotal,
    hospitals,
    programs: (["MORNING", "EVENING", "NONE"] as ProgramId[]).filter((id) => programs.has(id)).map((id) => ({ id, label: PROGRAM_LABEL[id], groups: programs.get(id)! })),
    holidays: Object.fromEntries(holidayBy),
  };
}
