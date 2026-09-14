"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createStudyType, updateStudyType } from "../models/studyTypes";

export async function createStudyTypeAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (!name) throw new Error("Name is required");
  await createStudyType(session.sub, { name, nameAr: nameAr || undefined, code });
  revalidatePath("/study-types");
  revalidatePath("/setup");
}

export async function updateStudyTypeAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  await updateStudyType(session.sub, id, { name, nameAr, code: code || undefined });
  revalidatePath("/study-types");
  revalidatePath("/setup");
}

export async function toggleStudyTypeActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateStudyType(session.sub, id, { active });
  revalidatePath("/study-types");
  revalidatePath("/setup");
}
