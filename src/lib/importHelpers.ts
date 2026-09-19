// Shared CSV-import plumbing used by every entity's bulk-import action
// (students, hospitals, groups, evaluators, rotation blocks) — one place
// for the cell-parsing/lookup rules so "course cell is YYYY-N", "shift
// cell accepts MORNING/صباحي/AM", etc. stay consistent across all of them
// instead of drifting import by import.
import { prisma } from "./db";
import { recordAudit, type EntityType } from "./audit";
import type { Shift } from "./models/students";

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

// Every import model function takes this so the CSV-upload action can run
// it twice: once as a read-only dry run to build a preview (nothing is
// written — matches the "staging/preview before any DB mutation" pattern
// standard across bulk-import tooling), and once for real after the admin
// confirms the preview.
export interface ImportOptions {
  commit: boolean;
}

// Preview payload the action returns after the dry run — carries the raw
// CSV text back to the browser so the confirm step can resubmit it without
// re-uploading the file.
export interface ImportPreview extends ImportResult {
  raw: string;
}

export interface ImportActionState {
  result?: ImportResult;
  preview?: ImportPreview;
  error?: string;
}

// Records one audit-log row per import *attempt* (not per created/updated
// record — those already get their own rows from create/update). Answers
// "who imported what, when, with what result" in one query instead of only
// reconstructing it from a burst of per-record rows with the same timestamp.
export async function recordImportAudit(params: {
  actorId: string;
  entityType: EntityType;
  result: ImportResult;
}): Promise<void> {
  await recordAudit({
    actorId: params.actorId,
    entityType: params.entityType,
    entityId: `import-${Date.now()}`,
    action: "import",
    after: {
      created: params.result.created,
      updated: params.result.updated,
      errorCount: params.result.errors.length,
      errors: params.result.errors,
    },
  });
}

export function parseShiftCell(value: string | undefined): Shift | undefined {
  const s = value?.trim().toUpperCase();
  if (!s) return undefined;
  if (s === "MORNING" || s === "صباحي" || s === "AM") return "MORNING";
  if (s === "EVENING" || s === "مسائي" || s === "PM") return "EVENING";
  throw new Error(`Unknown shift "${value}" (expected MORNING/EVENING)`);
}

// Course cell is "year-number", e.g. "2026-1" — matches how it's exported.
export async function resolveCourseId(value: string | undefined): Promise<string | null> {
  const v = value?.trim();
  if (!v) return null;
  const match = v.match(/^(\d{4})-(\d)$/);
  if (!match) throw new Error(`Unknown course format "${v}" (expected "YYYY-N", e.g. "2026-1")`);
  const course = await prisma.course.findUnique({
    where: { year_number: { year: Number(match[1]), number: Number(match[2]) } },
  });
  if (!course) throw new Error(`Unknown course "${v}"`);
  return course.id;
}

export async function resolveStudyTypeId(value: string | undefined): Promise<string | null> {
  const v = value?.trim();
  if (!v) return null;
  const st = await prisma.studyType.findFirst({ where: { OR: [{ name: v }, { nameAr: v }] }, select: { id: true } });
  if (!st) throw new Error(`Unknown study type "${v}"`);
  return st.id;
}

export async function resolveGroupId(value: string | undefined): Promise<string | null> {
  const v = value?.trim();
  if (!v) return null;
  const g = await prisma.group.findFirst({ where: { name: v }, select: { id: true } });
  if (!g) throw new Error(`Unknown group "${v}"`);
  return g.id;
}

export async function resolveHospitalId(value: string | undefined): Promise<string> {
  const v = value?.trim();
  if (!v) throw new Error("Hospital is required");
  const h = await prisma.hospital.findFirst({ where: { OR: [{ name: v }, { nameAr: v }] }, select: { id: true } });
  if (!h) throw new Error(`Unknown hospital "${v}"`);
  return h.id;
}
