"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { requireRole } from "../auth";
import { createGroup, updateGroup, importGroups, Shift } from "../models/groups";
import type { ImportActionState } from "../importHelpers";

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
  revalidatePath("/master");
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
  revalidatePath("/master");
}

// CSV columns expected: name, shift, course, studyType, cycleLabel
export async function importGroupsAction(
  _prev: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  const session = await requireRole("ADMIN");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "الرجاء اختيار ملف CSV" };
  }
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  if (parsed.errors.length > 0) {
    return { error: `تعذرت قراءة الملف: ${parsed.errors[0].message}` };
  }
  const rows = parsed.data.map((r) => ({
    name: r.name ?? r["الاسم"] ?? "",
    shift: r.shift,
    course: r.course,
    studyType: r.studyType,
    cycleLabel: r.cycleLabel,
  }));
  const result = await importGroups(session.sub, rows);
  revalidatePath("/groups");
  revalidatePath("/setup");
  revalidatePath("/master");
  return { result };
}
