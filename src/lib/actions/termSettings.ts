"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { updateTermSettings } from "../models/termSettings";

// Step 1 of the setup wizard — number of weeks in the term.
export async function saveWeeksAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const raw = String(formData.get("weeksCount") ?? "").trim();
  const weeksCount = raw === "" ? null : Number(raw);
  if (weeksCount !== null && (!Number.isInteger(weeksCount) || weeksCount < 1 || weeksCount > 52)) {
    throw new Error("عدد الأسابيع يجب أن يكون بين ١ و ٥٢");
  }
  const startRaw = String(formData.get("startDate") ?? "").trim();
  await updateTermSettings(session.sub, { weeksCount, startDate: startRaw || null });
  revalidatePath("/setup");
  revalidatePath("/master");
}

// Step 2 of the setup wizard — days per week + which weekdays.
export async function saveDaysAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const weekdays = formData.getAll("weekdays").map(String);
  const raw = String(formData.get("daysPerWeek") ?? "").trim();
  // If specific weekdays were picked, the count follows from them; otherwise
  // fall back to the free number the user typed.
  const daysPerWeek = weekdays.length > 0 ? weekdays.length : raw === "" ? null : Number(raw);
  if (daysPerWeek !== null && (!Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7)) {
    throw new Error("عدد الأيام يجب أن يكون بين ١ و ٧");
  }
  await updateTermSettings(session.sub, {
    daysPerWeek,
    weekdays: weekdays.length > 0 ? weekdays.join(",") : null,
  });
  revalidatePath("/setup");
  revalidatePath("/master");
}
