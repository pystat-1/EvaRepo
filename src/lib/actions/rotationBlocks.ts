"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createRotationBlock, toggleRotationBlockActive } from "../models/rotationBlocks";

export async function createRotationBlockAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  await createRotationBlock(session.sub, {
    groupId: String(formData.get("groupId") ?? "").trim(),
    hospitalId: String(formData.get("hospitalId") ?? "").trim(),
    startDate: String(formData.get("startDate") ?? "").trim(),
    endDate: String(formData.get("endDate") ?? "").trim(),
    daysOfWeek: formData.getAll("daysOfWeek").map(String).join(",") || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
  });
  revalidatePath("/groups");
  revalidatePath("/setup");
}

export async function toggleRotationBlockActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await toggleRotationBlockActive(session.sub, id, active);
  revalidatePath("/groups");
  revalidatePath("/setup");
}
