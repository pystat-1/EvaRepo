"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { todayISO } from "../date";
import { markAttendance, setDailyNote } from "../models/attendance";
import type { Attendance } from "../models/evaluations";
import { assertEvaluatorCanGrade } from "./grading";

// The quick الحضور and الديلي نوت screens always work on today (Baghdad),
// the same as the reference app; the date is never taken from the client.
// Scope and schedule are re-checked exactly like a grade save.

function revalidateDay(studentId: string) {
  revalidatePath("/attendance");
  revalidatePath("/daily-note");
  revalidatePath("/attendance-log");
  revalidatePath("/my");
  revalidatePath("/schedule");
  revalidatePath(`/grade/${studentId}`);
  revalidatePath("/grading-center");
}

export async function markAttendanceAction(studentId: string, status: Attendance): Promise<{ error?: string }> {
  const session = await requireRole("EVALUATOR");
  if (status !== "present" && status !== "late" && status !== "absent") return { error: "حالة حضور غير صالحة" };
  const dateISO = todayISO();
  try {
    await assertEvaluatorCanGrade(session.sub, studentId, dateISO);
    await markAttendance(session.sub, studentId, dateISO, status);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "تعذّر حفظ الحضور" };
  }
  revalidateDay(studentId);
  return {};
}

export async function setDailyNoteAction(studentId: string, delivered: boolean | null): Promise<{ error?: string }> {
  const session = await requireRole("EVALUATOR");
  const dateISO = todayISO();
  try {
    await assertEvaluatorCanGrade(session.sub, studentId, dateISO);
    await setDailyNote(session.sub, studentId, dateISO, delivered);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "تعذّر حفظ تسليم الملاحظة اليومية" };
  }
  revalidateDay(studentId);
  return {};
}
