"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createGroup, updateGroup, Shift } from "../models/groups";

function parseShift(value: FormDataEntryValue | null): Shift | null {
  const s = String(value ?? "").trim();
  return s === "MORNING" || s === "EVENING" ? s : null;
}

export async function createGroupAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const cycleLabel = String(formData.get("cycleLabel") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "").trim();
  const studyTypeId = String(formData.get("studyTypeId") ?? "").trim();
  if (!name) throw new Error("Name is required");
  await createGroup(session.sub, {
    name,
    cycleLabel: cycleLabel || undefined,
    courseId: courseId || null,
    shift: parseShift(formData.get("shift")),
    studyTypeId: studyTypeId || null,
  });
  revalidatePath("/groups");
  revalidatePath("/setup");
}

export async function updateGroupAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const cycleLabel = String(formData.get("cycleLabel") ?? "").trim();
  const courseId = String(formData.get("courseId") ?? "").trim();
  const studyTypeId = String(formData.get("studyTypeId") ?? "").trim();
  await updateGroup(session.sub, id, {
    name,
    cycleLabel,
    courseId: courseId || null,
    shift: parseShift(formData.get("shift")),
    studyTypeId: studyTypeId || null,
  });
  revalidatePath("/groups");
  revalidatePath("/setup");
}

export async function toggleGroupActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateGroup(session.sub, id, { active });
  revalidatePath("/groups");
  revalidatePath("/setup");
}
