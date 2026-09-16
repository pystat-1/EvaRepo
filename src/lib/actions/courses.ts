"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createCourse, updateCourse } from "../models/courses";

export async function createCourseAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const year = Number(formData.get("year"));
  const number = Number(formData.get("number"));
  const label = String(formData.get("label") ?? "").trim();
  await createCourse(session.sub, { year, number, label: label || undefined });
  revalidatePath("/courses");
  revalidatePath("/setup");
  revalidatePath("/master");
}

export async function toggleCourseActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateCourse(session.sub, id, { active });
  revalidatePath("/courses");
  revalidatePath("/setup");
  revalidatePath("/master");
}
