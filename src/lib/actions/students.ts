"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { requireRole } from "../auth";
import { createStudent, updateStudent, importStudents, ImportResult } from "../models/students";

function parseShift(value: FormDataEntryValue | null): "MORNING" | "EVENING" | null {
  const s = String(value ?? "").trim();
  return s === "MORNING" || s === "EVENING" ? s : null;
}

export async function createStudentAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  await createStudent(session.sub, {
    universityNumber: String(formData.get("universityNumber") ?? "").trim(),
    nameAr: String(formData.get("nameAr") ?? "").trim(),
    nameEn: String(formData.get("nameEn") ?? "").trim() || undefined,
    email: String(formData.get("email") ?? "").trim() || undefined,
    studyTypeId: String(formData.get("studyTypeId") ?? "") || null,
    groupId: String(formData.get("groupId") ?? "") || null,
    courseId: String(formData.get("courseId") ?? "") || null,
    shift: parseShift(formData.get("shift")),
  });
  revalidatePath("/students");
}

export async function updateStudentAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  await updateStudent(session.sub, id, {
    universityNumber: String(formData.get("universityNumber") ?? "").trim(),
    nameAr: String(formData.get("nameAr") ?? "").trim(),
    nameEn: String(formData.get("nameEn") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    studyTypeId: String(formData.get("studyTypeId") ?? "") || null,
    groupId: String(formData.get("groupId") ?? "") || null,
    courseId: String(formData.get("courseId") ?? "") || null,
    shift: parseShift(formData.get("shift")),
  });
  revalidatePath("/students");
}

export async function toggleStudentActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await updateStudent(session.sub, id, { active });
  revalidatePath("/students");
}

export interface ImportActionState {
  result?: ImportResult;
  error?: string;
}

// Bulk import: CSV columns expected are
// universityNumber,nameAr,nameEn,email,studyType,group,course,shift
// (course is "YYYY-N", e.g. "2026-1"; shift is MORNING/EVENING)
export async function importStudentsAction(
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
    universityNumber: r.universityNumber ?? r["الرقم الجامعي"] ?? "",
    nameAr: r.nameAr ?? r["الاسم"] ?? "",
    nameEn: r.nameEn,
    email: r.email,
    studyType: r.studyType,
    group: r.group,
    course: r.course ?? r["الدورة"],
    shift: r.shift ?? r["الوردية"],
  }));
  const result = await importStudents(session.sub, rows);
  revalidatePath("/students");
  return { result };
}
