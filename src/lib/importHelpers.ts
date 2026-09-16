// Shared CSV-import plumbing used by every entity's bulk-import action
// (students, hospitals, groups, evaluators, rotation blocks) — one place
// for the cell-parsing/lookup rules so "course cell is YYYY-N", "shift
// cell accepts MORNING/صباحي/AM", etc. stay consistent across all of them
// instead of drifting import by import.
import { prisma } from "./db";
import type { Shift } from "./models/students";

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export interface ImportActionState {
  result?: ImportResult;
  error?: string;
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
