"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createStudyType, updateStudyType } from "../models/studyTypes";

export async function createStudyTypeAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  if (!name) throw new Error("Name is required");
  await createStudyType(session.sub, { name, nameAr: nameAr || undefined });
  revalidatePath("/study-types");
}

export async function updateStudyTypeAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  await updateStudyType(session.sub, id, { name, nameAr });
  revalidatePath("/study-types");
}

export async function toggleStudyTypeActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateStudyType(session.sub, id, { active });
  revalidatePath("/study-types");
}
