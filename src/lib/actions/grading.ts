"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { upsertEvaluation, Attendance } from "../models/evaluations";
import { getScopedGroupIds, canEvaluatorGradeGroupAtHospital } from "../models/evaluators";
import { getStudent } from "../models/students";
import { listRubricSections } from "../models/rubric";
import { getScheduledRotationForDate } from "../models/rotationBlocks";

// Re-checks the evaluator's scope from the server side on every save — the
// client-submitted studentId is only a reference; the actual permission is
// re-derived from the logged-in account's assignments (plan §2.4/§4), so a
// tampered form post naming a student outside the evaluator's hospital is
// rejected here regardless of what the UI showed. Also enforces the
// rotation schedule itself: an evaluator can only grade a student on a day
// their group is actually scheduled at that evaluator's assigned hospital
// — not any day within their group scope, and not a hospital they aren't
// assigned to even if the group happens to be there.
async function assertEvaluatorCanGrade(accountId: string, studentId: string, dateISO: string) {
  const student = await getStudent(studentId);
  if (!student || !student.groupId) throw new Error("الطالب غير موجود أو غير مرتبط بمجموعة");
  const scopedGroupIds = await getScopedGroupIds(accountId);
  if (!scopedGroupIds.includes(student.groupId)) {
    throw new Error("هذا الطالب خارج نطاقك المخصص");
  }

  const scheduled = await getScheduledRotationForDate(student.groupId, dateISO);
  if (!scheduled) {
    throw new Error("هذا اليوم ليس يوم حضور مجدول لمجموعة هذا الطالب حسب جدول الدوران");
  }
  const covered = await canEvaluatorGradeGroupAtHospital(accountId, student.groupId, scheduled.hospitalId);
  if (!covered) {
    throw new Error(
      `مجموعة هذا الطالب اليوم في "${scheduled.hospitalName}" وأنت غير مخصص لهذا المستشفى/هذه المجموعة هناك`
    );
  }
}

export async function gradeStudentAction(formData: FormData) {
  const session = await requireRole("EVALUATOR");
  const studentId = String(formData.get("studentId") ?? "");
  const dateISO = String(formData.get("dateISO") ?? "");
  const attendance = String(formData.get("attendance") ?? "present") as Attendance;
  const notes = String(formData.get("notes") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "").trim();

  await assertEvaluatorCanGrade(session.sub, studentId, dateISO);

  const sections = await listRubricSections();
  const scores: Record<string, number> = {};
  for (const section of sections) {
    const raw = formData.get(`score_${section.id}`);
    scores[section.id] = raw === null || raw === "" ? 0 : Number(raw);
  }

  await upsertEvaluation(session.sub, {
    studentId,
    evaluatorId: session.sub,
    dateISO,
    attendance,
    notes: notes || undefined,
    feedback: feedback || undefined,
    scores,
  });

  revalidatePath(`/grade/${studentId}`);
  revalidatePath("/my");
  revalidatePath("/grading-center");
}
