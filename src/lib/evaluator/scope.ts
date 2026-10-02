// Evaluator write scope, shared by the grading and attendance actions.
// Deliberately NOT a "use server" module: these take an account id, so
// they must only ever be called with the id from the server session.
import { getStudent } from "../models/students";
import { getEvaluatorSchedule } from "../models/evaluators";
import { ensureOpenWorkDay, Placement } from "../models/workDays";
import { pickPlacement } from "./placement";

// Re-checks the evaluator's scope from the server side on every save — the
// client-submitted studentId is only a reference; the actual permission is
// re-derived from the logged-in account's assignments (plan §2.4/§4), so a
// tampered form post naming a student outside the evaluator's hospital is
// rejected here regardless of what the UI showed.
//
// The rotation schedule is the default but not a hard rule: real days move
// (holidays, cancelled days), so an evaluator may work with one of their
// own groups on a day the schedule doesn't list, as long as it's near that
// group's rotation with them (see evaluator/placement.ts). The day actually
// worked is recorded as a GroupWorkDay by prepareEvaluatorWrite below.
export async function assertEvaluatorCanGrade(
  accountId: string,
  studentId: string,
  dateISO: string
): Promise<{ groupId: string; placement: Placement }> {
  const [student, stints] = await Promise.all([getStudent(studentId), getEvaluatorSchedule(accountId)]);
  if (!student || !student.groupId) throw new Error("الطالب غير موجود أو غير مرتبط بمجموعة");
  const placement = pickPlacement(stints, student.groupId, dateISO);
  if (!placement) {
    throw new Error("هذا الطالب خارج نطاقك المخصص أو خارج فترة دوران مجموعته معك");
  }
  return { groupId: student.groupId, placement };
}

// Every evaluator write goes through here: scope check, then record the
// work day (or refuse if it was already validated).
export async function prepareEvaluatorWrite(accountId: string, studentId: string, dateISO: string) {
  const scope = await assertEvaluatorCanGrade(accountId, studentId, dateISO);
  await ensureOpenWorkDay(accountId, scope.groupId, dateISO, scope.placement);
  return scope;
}

