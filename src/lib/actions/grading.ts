"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { upsertEvaluation, Attendance } from "../models/evaluations";
import { listRubricSections } from "../models/rubric";
import { prepareEvaluatorWrite } from "../evaluator/scope";

export async function gradeStudentAction(formData: FormData) {
  const session = await requireRole("EVALUATOR");
  const studentId = String(formData.get("studentId") ?? "");
  const dateISO = String(formData.get("dateISO") ?? "");
  const attendance = String(formData.get("attendance") ?? "present") as Attendance;
  const notes = String(formData.get("notes") ?? "").trim();
  const feedback = String(formData.get("feedback") ?? "").trim();
  // Checkbox posts "on"/"1"/"true" when ticked, nothing when not.
  const dnRaw = formData.get("dailyNoteSubmitted");
  const dailyNoteSubmitted = dnRaw === "on" || dnRaw === "1" || dnRaw === "true";
  // Tri-state daily note from the grading form: "1" handed in, "0" not
  // handed in, "" not recorded. Older offline entries only carry the
  // checkbox above, so it stays the fallback.
  const dnState = formData.get("dailyNote");
  const dailyNote =
    dnState === "1" ? true : dnState === "0" ? false : dnState === "" ? null : undefined;

  const { groupId, placement } = await prepareEvaluatorWrite(session.sub, studentId, dateISO);

  const sections = await listRubricSections();
  const scores: Record<string, number> = {};
  const itemScores: Record<string, number> = {};
  for (const section of sections) {
    if (section.items.length > 0) {
      for (const item of section.items) {
        const raw = formData.get(`item_${item.id}`);
        itemScores[item.id] = raw === null || raw === "" ? 0 : Number(raw);
      }
      continue;
    }
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
    dailyNoteSubmitted,
    dailyNote,
    scores,
    itemScores,
    pendingValidation: true,
    hospitalId: placement.hospitalId,
    groupId,
  });

  // The Google Sheets backup is written when the day is validated
  // (workDays.validateWorkDay), not on every draft save.

  // Keep every grade-displaying view in sync with this save — this same
  // action is what the offline outbox replays through, so a synced-later
  // evaluation propagates everywhere too. Path-based revalidation covers all
  // query variants of a route (e.g. every filter/mode of /grading-center).
  revalidatePath(`/grade/${studentId}`);
  revalidatePath(`/grading-center/student/${studentId}`);
  revalidatePath("/grading-center");
  revalidatePath("/master");
  revalidatePath("/statistics");
  revalidatePath("/flags");
  revalidatePath("/dashboard");
  revalidatePath("/my");
  revalidatePath("/schedule");
  revalidatePath("/history");
  revalidatePath("/attendance");
  revalidatePath("/daily-note");
  revalidatePath("/attendance-log");
  revalidatePath("/day-grades");
}
