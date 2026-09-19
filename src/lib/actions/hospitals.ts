"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { requireRole } from "../auth";
import { createHospital, updateHospital, importHospitals } from "../models/hospitals";
import type { ImportActionState } from "../importHelpers";

export async function createHospitalAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name) throw new Error("Name is required");
  await createHospital(session.sub, { name, nameAr: nameAr || undefined, address: address || undefined });
  revalidatePath("/hospitals");
  revalidatePath("/setup");
  revalidatePath("/master");
}

export async function updateHospitalAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const nameAr = String(formData.get("nameAr") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  await updateHospital(session.sub, id, { name, nameAr, address });
  revalidatePath("/hospitals");
  revalidatePath("/setup");
}

export async function toggleHospitalActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateHospital(session.sub, id, { active });
  revalidatePath("/hospitals");
  revalidatePath("/setup");
  revalidatePath("/master");
}

// CSV columns expected: name, nameAr, address
export async function importHospitalsAction(
  _prev: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  const session = await requireRole("ADMIN");
  const phase = String(formData.get("phase") ?? "preview");
  let text: string;
  if (phase === "confirm") {
    text = String(formData.get("raw") ?? "");
  } else {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { error: "الرجاء اختيار ملف CSV" };
    }
    text = await file.text();
  }
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
    nameAr: r.nameAr,
    address: r.address,
  }));
  const result = await importHospitals(session.sub, rows, { commit: phase === "confirm" });
  if (phase !== "confirm") {
    return { preview: { ...result, raw: text } };
  }
  revalidatePath("/hospitals");
  revalidatePath("/setup");
  revalidatePath("/master");
  return { result };
}
