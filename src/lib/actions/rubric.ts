"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createRubricSection, updateRubricSection } from "../models/rubric";

export async function createRubricSectionAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  await createRubricSection(session.sub, {
    label: String(formData.get("label") ?? "").trim(),
    labelAr: String(formData.get("labelAr") ?? "").trim(),
    maxScore: Number(formData.get("maxScore") ?? 0),
    sortOrder: Number(formData.get("sortOrder") ?? 999),
  });
  revalidatePath("/rubric");
}

export async function toggleRubricSectionActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateRubricSection(session.sub, id, { active });
  revalidatePath("/rubric");
}

export async function updateRubricSectionAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await updateRubricSection(session.sub, id, {
    label: String(formData.get("label") ?? "").trim(),
    labelAr: String(formData.get("labelAr") ?? "").trim(),
    maxScore: Number(formData.get("maxScore") ?? 0),
  });
  revalidatePath("/rubric");
}
