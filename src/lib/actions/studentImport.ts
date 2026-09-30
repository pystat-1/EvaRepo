"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import type { StudentRowInput } from "../studentImport/rows";
import {
  finishStudentImport,
  importStudentBatch,
  listCourseStudentsForExport,
  type BatchResult,
  type FinishResult,
} from "../models/studentImport";

// The browser sends at most this many rows per call (see ExcelStudentImport).
const MAX_BATCH = 50;

export async function importStudentBatchAction(
  courseId: string,
  rows: Array<StudentRowInput & { row: number }>
): Promise<BatchResult & { error?: string }> {
  const session = await requireRole("ADMIN");
  if (!Array.isArray(rows) || rows.length > MAX_BATCH) {
    return { created: 0, updated: 0, issues: [], error: "دفعة غير صالحة" };
  }
  try {
    return await importStudentBatch(session.sub, courseId, rows);
  } catch (err) {
    return { created: 0, updated: 0, issues: [], error: err instanceof Error ? err.message : "تعذّر الاستيراد" };
  }
}

export async function finishStudentImportAction(
  courseId: string,
  opts: { removeSamples: boolean; deactivateMissing: boolean; universityNumbers: string[] }
): Promise<FinishResult & { error?: string }> {
  const session = await requireRole("ADMIN");
  try {
    const result = await finishStudentImport(session.sub, courseId, {
      removeSamples: !!opts.removeSamples,
      deactivateMissing: !!opts.deactivateMissing,
      universityNumbers: Array.isArray(opts.universityNumbers) ? opts.universityNumbers.map(String) : [],
    });
    for (const p of ["/students", "/master", "/grading-center", "/statistics", "/dashboard", "/setup"]) revalidatePath(p);
    return result;
  } catch (err) {
    return { samplesRemoved: 0, deactivated: 0, error: err instanceof Error ? err.message : "تعذّر إنهاء الاستيراد" };
  }
}

export async function exportCourseStudentsAction(courseId: string) {
  await requireRole("ADMIN");
  return listCourseStudentsForExport(courseId);
}
