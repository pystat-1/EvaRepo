"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { todayISO } from "../date";
import { isWithinSubmissionWindow } from "../evaluator/validation";
import { prepareEvaluatorWrite } from "../evaluator/scope";
import { markAttendance, setDailyNote } from "../models/attendance";
import { getEvaluationForStudentDate, upsertEvaluation, type Attendance } from "../models/evaluations";
import { resolveGroupPlacement, validateWorkDay } from "../models/workDays";

// The date defaults to today (Baghdad). A past date is only accepted inside
// the 7-day window, so an evaluator can finish and validate a day they
// forgot; it is never a future date.
function resolveDate(dateISO?: string): string {
  const today = todayISO();
  if (!dateISO) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !isWithinSubmissionWindow(dateISO, today)) {
    throw new Error("لا يمكن التعديل على هذا التاريخ — تجاوز المدة المسموحة (7 أيام)");
  }
  return dateISO;
}

// Only validation revalidates. The quick saves below deliberately don't:
// evaluator pages are dynamic (never cached by the client router), and a
// revalidatePath inside an action re-renders the whole current page in the
// action's response, which made every autosave in the grades table wait on
// a full page render. The lists refresh themselves (router.refresh) and the
// table already shows what it saved.
function revalidateAfterValidation() {
  for (const p of ["/attendance", "/daily-note", "/attendance-log", "/day-grades", "/my", "/schedule"]) {
    revalidatePath(p);
  }
}

function errorOf(err: unknown, fallback: string): { error: string } {
  return { error: err instanceof Error ? err.message : fallback };
}

export async function markAttendanceAction(
  studentId: string,
  status: Attendance,
  dateISO?: string
): Promise<{ error?: string }> {
  const session = await requireRole("EVALUATOR");
  if (status !== "present" && status !== "late" && status !== "absent") return { error: "حالة حضور غير صالحة" };
  try {
    const date = resolveDate(dateISO);
    const { groupId, placement } = await prepareEvaluatorWrite(session.sub, studentId, date);
    await markAttendance(session.sub, studentId, date, status, { groupId, hospitalId: placement.hospitalId });
  } catch (err) {
    return errorOf(err, "تعذّر حفظ الحضور");
  }
  return {};
}

export async function setDailyNoteAction(
  studentId: string,
  delivered: boolean | null,
  dateISO?: string
): Promise<{ error?: string }> {
  const session = await requireRole("EVALUATOR");
  try {
    const date = resolveDate(dateISO);
    const { groupId, placement } = await prepareEvaluatorWrite(session.sub, studentId, date);
    await setDailyNote(session.sub, studentId, date, delivered, { groupId, hospitalId: placement.hospitalId });
  } catch (err) {
    return errorOf(err, "تعذّر حفظ تسليم الملاحظة اليومية");
  }
  return {};
}

export interface GradeRowInput {
  studentId: string;
  dateISO?: string;
  attendance: Attendance;
  dailyNote: boolean | null;
  scores: Record<string, number>; // sections without items
  itemScores: Record<string, number>;
}

// Autosave of one row of the درجات اليوم table: the same evaluation record
// the grading form writes (notes and feedback are kept as they were).
export async function saveGradeRowAction(input: GradeRowInput): Promise<{ total?: number; error?: string }> {
  const session = await requireRole("EVALUATOR");
  if (!["present", "late", "absent"].includes(input.attendance)) return { error: "حالة حضور غير صالحة" };
  let total: number;
  try {
    const date = resolveDate(input.dateISO);
    const { groupId, placement } = await prepareEvaluatorWrite(session.sub, input.studentId, date);
    const existing = await getEvaluationForStudentDate(input.studentId, date);
    const saved = await upsertEvaluation(session.sub, {
      studentId: input.studentId,
      evaluatorId: session.sub,
      dateISO: date,
      attendance: input.attendance,
      notes: existing?.notes ?? undefined,
      feedback: existing?.feedback ?? undefined,
      dailyNote: input.dailyNote,
      scores: input.scores,
      itemScores: input.itemScores,
      pendingValidation: true,
      hospitalId: placement.hospitalId,
      groupId,
    });
    total = saved.total;
  } catch (err) {
    return errorOf(err, "تعذّر حفظ الدرجات");
  }
  return { total };
}

export type ValidateDayResult =
  | { ok: true; count: number }
  | { ok: false; error?: string; missingAttendance?: string[]; missingGrades?: string[] };

// اعتماد: closes the group's day and releases its grades to the admin.
export async function validateDayAction(groupId: string, dateISO?: string): Promise<ValidateDayResult> {
  const session = await requireRole("EVALUATOR");
  let result: ValidateDayResult;
  try {
    const date = dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) && dateISO <= todayISO() ? dateISO : todayISO();
    const placement = await resolveGroupPlacement(session.sub, groupId, date);
    if (!placement) return { ok: false, error: "هذه المجموعة خارج نطاقك في هذا التاريخ" };
    result = await validateWorkDay(session.sub, groupId, date, placement);
  } catch (err) {
    return { ok: false, ...errorOf(err, "تعذّر الاعتماد") };
  }
  if (result.ok) {
    revalidateAfterValidation();
    revalidatePath("/grading-center");
    revalidatePath("/master");
    revalidatePath("/statistics");
    revalidatePath("/flags");
    revalidatePath("/dashboard");
  }
  return result;
}
