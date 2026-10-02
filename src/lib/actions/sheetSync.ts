"use server";

import { requireRole } from "../auth";
import { syncAllToSheet, isSheetsConfigured, type SyncResult } from "../models/sheetSync";

// Admin-triggered full backup: rewrites the Google Sheet's Grades tab from the
// entire grading center. Returns a structured result so the button can report
// exactly what happened; never throws.
export async function syncAllToSheetAction(): Promise<SyncResult> {
  await requireRole("ADMIN");
  return syncAllToSheet();
}

export async function sheetsStatusAction(): Promise<{ configured: boolean }> {
  await requireRole("ADMIN");
  return { configured: isSheetsConfigured() };
}
