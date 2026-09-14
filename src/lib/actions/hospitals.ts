"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createHospital, updateHospital } from "../models/hospitals";

export async function createHospitalAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name) throw new Error("Name is required");
  await createHospital(session.sub, { name, nameAr: nameAr || undefined, address: address || undefined });
  revalidatePath("/hospitals");
}

export async function updateHospitalAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  await updateHospital(session.sub, id, { name, nameAr, address });
  revalidatePath("/hospitals");
}

export async function toggleHospitalActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateHospital(session.sub, id, { active });
  revalidatePath("/hospitals");
}
