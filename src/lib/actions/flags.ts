"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { markFlagSeen } from "../models/flags";

export async function markFlagSeenAction(formData: FormData) {
  await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await markFlagSeen(id);
  revalidatePath("/flags");
  revalidatePath("/dashboard");
}
