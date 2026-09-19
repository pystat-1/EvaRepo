"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import {
  generateRotationSchedule,
  clearAutoRotationSchedule,
  type GenerateResult,
} from "../models/scheduleEngine";

// Runs the course-setup automation engine. Returns the structured result to
// the caller (the setup wizard) so it can show exactly what was generated —
// and never throws, so a click can't break the page.
export async function generateScheduleAction(): Promise<GenerateResult> {
  const session = await requireRole("ADMIN");
  const result = await generateRotationSchedule(session.sub);
  revalidatePath("/setup");
  revalidatePath("/master");
  revalidatePath("/grading-center");
  return result;
}

export async function clearAutoScheduleAction(): Promise<{ cleared: number }> {
  const session = await requireRole("ADMIN");
  const result = await clearAutoRotationSchedule(session.sub);
  revalidatePath("/setup");
  revalidatePath("/master");
  revalidatePath("/grading-center");
  return result;
}
