"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { requireRole } from "../auth";
import {
  createEvaluator,
  toggleEvaluatorActive,
  addAssignment,
  toggleAssignmentActive,
  importEvaluators,
} from "../models/evaluators";
import type { ImportActionState } from "../importHelpers";

export async function createEvaluatorAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  await createEvaluator(session.sub, {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    hospitalId: String(formData.get("hospitalId") ?? "").trim(),
    groupId: String(formData.get("groupId") ?? "") || null,
  });
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

export async function toggleEvaluatorActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const accountId = String(formData.get("accountId") ?? "");
  const active = formData.get("active") === "1";
  await toggleEvaluatorActive(session.sub, accountId, active);
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

export async function addAssignmentAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const accountId = String(formData.get("accountId") ?? "");
  const hospitalId = String(formData.get("hospitalId") ?? "").trim();
  const groupId = String(formData.get("groupId") ?? "") || null;
  await addAssignment(session.sub, accountId, hospitalId, groupId);
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

export async function toggleAssignmentActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const active = formData.get("active") === "1";
  await toggleAssignmentActive(session.sub, assignmentId, active);
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

// CSV columns expected: name, email, password, hospital, group
export async function importEvaluatorsAction(
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
    email: r.email,
    password: r["password (مبدئية)"] ?? r.password,
    hospital: r.hospital,
    group: r["group (اختياري)"] ?? r.group,
  }));
  const result = await importEvaluators(session.sub, rows);
  revalidatePath("/evaluators");
  revalidatePath("/master");
  return { result };
}
