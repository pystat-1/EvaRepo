"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { requireRole } from "../auth";
import { createRotationBlock, toggleRotationBlockActive, importRotationBlocks } from "../models/rotationBlocks";
import type { ImportActionState } from "../importHelpers";

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

// CSV columns expected: group, hospital, startDate, endDate, daysOfWeek
export async function importRotationBlocksAction(
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
    group: r.group,
    hospital: r.hospital,
    startDate: r.startDate,
    endDate: r.endDate,
    daysOfWeek: r.daysOfWeek,
  }));
  const result = await importRotationBlocks(session.sub, rows);
  revalidatePath("/groups");
  revalidatePath("/setup");
  revalidatePath("/master");
  return { result };
}
