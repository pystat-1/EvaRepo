// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
//
// Field note: the old SQLite table called the English-name column `label`
// (NOT NULL); the Postgres schema (prisma/schema.prisma) calls the same
// column `labelEn` (optional) — schema.prisma was written first and is the
// source of truth, this file just keeps the `label` name in its own
// exported interface/inputs so nothing calling into this module needs to
// change.
import { cache } from "react";
import { prisma } from "../db";
import { recordAudit } from "../audit";

export interface RubricSection {
  id: string;
  label: string;
  labelAr: string;
  maxScore: number;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: {
  id: string;
  labelEn: string | null;
  labelAr: string;
  maxScore: number;
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): RubricSection {
  return {
    id: row.id,
    label: row.labelEn ?? "",
    labelAr: row.labelAr,
    maxScore: row.maxScore,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The current app's fixed 15-point rubric (plan §5.1) — Daily Note,
// Discussion & Feedback, Attitude & Communication, Punctuality, Appearance
// — seeded once as data so it's admin-editable from day one instead of
// hardcoded in a template.
const DEFAULT_SECTIONS: Array<Pick<RubricSection, "label" | "labelAr" | "maxScore" | "sortOrder">> = [
  { label: "Daily Note", labelAr: "الملاحظة اليومية", maxScore: 5, sortOrder: 1 },
  { label: "Discussion & Feedback", labelAr: "المناقشة والتغذية الراجعة", maxScore: 7, sortOrder: 2 },
  { label: "Attitude & Communication", labelAr: "الموقف والتواصل", maxScore: 1, sortOrder: 3 },
  { label: "Punctuality", labelAr: "الانتظام", maxScore: 1, sortOrder: 4 },
  { label: "Appearance", labelAr: "المظهر", maxScore: 1, sortOrder: 5 },
];

export async function ensureDefaultRubric(): Promise<void> {
  const count = await prisma.rubricSection.count();
  if (count > 0) return;
  await prisma.rubricSection.createMany({
    data: DEFAULT_SECTIONS.map((s) => ({
      labelEn: s.label,
      labelAr: s.labelAr,
      maxScore: s.maxScore,
      sortOrder: s.sortOrder,
    })),
  });
}

// Rubric sections are near-static reference data (edited a few times a
// year from /rubric) but were being re-fetched from the DB on every call —
// up to 4 round trips in a single page render (e.g. statistics.ts calls
// getMaxTotal twice). react's cache() dedupes identical calls within one
// request's render pass; it's cleared automatically between requests, so
// an edit is visible on the very next request with no manual invalidation.
export const listRubricSections = cache(async (includeInactive = false): Promise<RubricSection[]> => {
  await ensureDefaultRubric();
  const rows = await prisma.rubricSection.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(serialize);
});

export async function getMaxTotal(): Promise<number> {
  const sections = await listRubricSections();
  return sections.reduce((sum, s) => sum + s.maxScore, 0);
}

export async function createRubricSection(
  actorId: string,
  data: { label: string; labelAr: string; maxScore: number; sortOrder?: number }
): Promise<RubricSection> {
  const row = await prisma.rubricSection.create({
    data: {
      labelEn: data.label || null,
      labelAr: data.labelAr,
      maxScore: data.maxScore,
      sortOrder: data.sortOrder ?? 999,
    },
  });
  const created = serialize(row);
  await recordAudit({ actorId, entityType: "RubricSection", entityId: created.id, action: "create", after: created });
  return created;
}

export async function updateRubricSection(
  actorId: string,
  id: string,
  data: { label?: string; labelAr?: string; maxScore?: number; active?: boolean }
): Promise<RubricSection> {
  const beforeRow = await prisma.rubricSection.findUnique({ where: { id } });
  if (!beforeRow) throw new Error("Rubric section not found");
  const before = serialize(beforeRow);
  const row = await prisma.rubricSection.update({
    where: { id },
    data: {
      labelEn: data.label ?? before.label,
      labelAr: data.labelAr ?? before.labelAr,
      maxScore: data.maxScore ?? before.maxScore,
      active: data.active === undefined ? before.active : data.active,
    },
  });
  const after = serialize(row);
  await recordAudit({
    actorId,
    entityType: "RubricSection",
    entityId: id,
    action: data.active === false ? "deactivate" : "update",
    before,
    after,
  });
  return after;
}
