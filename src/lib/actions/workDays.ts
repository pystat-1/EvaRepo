"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { reopenWorkDay } from "../models/workDays";

// Admin: reopen a validated day so the evaluator can correct its grades.
export async function reopenWorkDayAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const groupId = String(formData.get("groupId") ?? "");
  const dateISO = String(formData.get("dateISO") ?? "");
  if (!groupId || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return;
  await reopenWorkDay(session.sub, groupId, dateISO);
  revalidatePath("/validations");
  revalidatePath("/grading-center");
}
