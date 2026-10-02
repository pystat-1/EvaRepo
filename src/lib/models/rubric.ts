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

export type RubricItemKind = "check" | "number";

// One item (فقرة) inside a section. "check" items score all or nothing
// (0 or maxScore); "number" items take any value from 0 to maxScore.
export interface RubricItem {
  id: string;
  key: string;
  labelAr: string;
  label: string;
  maxScore: number;
  kind: RubricItemKind;
  sortOrder: number;
}

export interface RubricSection {
  id: string;
  label: string;
  labelAr: string;
  maxScore: number;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  // Active items only, in display order. Empty = graded as one number.
  items: RubricItem[];
}

type ItemRow = {
  id: string;
  key: string;
  labelAr: string;
  labelEn: string | null;
  maxScore: number;
  kind: string;
  sortOrder: number;
  active: boolean;
};

function serializeItem(row: ItemRow): RubricItem {
  return {
    id: row.id,
    key: row.key,
    labelAr: row.labelAr,
    label: row.labelEn ?? "",
    maxScore: row.maxScore,
    kind: row.kind === "check" ? "check" : "number",
    sortOrder: row.sortOrder,
  };
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
  items?: ItemRow[];
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
    items: (row.items ?? [])
      .filter((i) => i.active)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(serializeItem),
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

// The items (فقرات) of each default section, taken from the reference
// daily-evaluation app: daily note 5, discussion 3.5 + 3.5, and four 0.25
// checks each for attitude, punctuality and appearance (15 in total).
const DEFAULT_ITEMS: Record<
  string,
  Array<{ key: string; label: string; labelAr: string; maxScore: number; kind: RubricItemKind }>
> = {
  "Daily Note": [{ key: "dailynote", label: "Daily Note", labelAr: "الملاحظة اليومية", maxScore: 5, kind: "number" }],
  "Discussion & Feedback": [
    { key: "gdisc", label: "Group discussion", labelAr: "مناقشة جماعية", maxScore: 3.5, kind: "number" },
    { key: "cdisc", label: "Case discussion", labelAr: "مناقشة الحالة", maxScore: 3.5, kind: "number" },
  ],
  "Attitude & Communication": [
    { key: "staff", label: "Medical staff", labelAr: "الطاقم الطبي", maxScore: 0.25, kind: "check" },
    { key: "std", label: "Student", labelAr: "الطالب", maxScore: 0.25, kind: "check" },
    { key: "tchr", label: "Teacher", labelAr: "المعلم", maxScore: 0.25, kind: "check" },
    { key: "pat", label: "Patient", labelAr: "المريض", maxScore: 0.25, kind: "check" },
  ],
  Punctuality: [
    { key: "late", label: "Lateness", labelAr: "التأخر", maxScore: 0.25, kind: "check" },
    { key: "meet", label: "Meeting", labelAr: "الاجتماع", maxScore: 0.25, kind: "check" },
    { key: "loc", label: "Location", labelAr: "الموقع", maxScore: 0.25, kind: "check" },
    { key: "ord", label: "Orders / execution", labelAr: "أوامر/تنفيذ", maxScore: 0.25, kind: "check" },
  ],
  Appearance: [
    { key: "badge", label: "Badge", labelAr: "الشارة", maxScore: 0.25, kind: "check" },
    { key: "veil", label: "Hijab", labelAr: "الحجاب", maxScore: 0.25, kind: "check" },
    { key: "uni", label: "Uniform", labelAr: "الزي الرسمي", maxScore: 0.25, kind: "check" },
    { key: "coat", label: "Coat", labelAr: "المعطف", maxScore: 0.25, kind: "check" },
  ],
};

export async function ensureDefaultRubric(): Promise<void> {
  const count = await prisma.rubricSection.count();
  if (count === 0) {
    await prisma.rubricSection.createMany({
      data: DEFAULT_SECTIONS.map((s) => ({
        labelEn: s.label,
        labelAr: s.labelAr,
        maxScore: s.maxScore,
        sortOrder: s.sortOrder,
      })),
    });
  }
  await ensureDefaultRubricItems();
}

// Seeds the default items once (if no items exist at all) under the
// sections they belong to, matched by English label then Arabic label. A
// section is only given items when they add up to its max score exactly,
// so an admin-rescaled section keeps being graded as one number.
async function ensureDefaultRubricItems(): Promise<void> {
  const itemCount = await prisma.rubricItem.count();
  if (itemCount > 0) return;
  const sections = await prisma.rubricSection.findMany();
  const data: Array<{
    sectionId: string;
    key: string;
    labelAr: string;
    labelEn: string;
    maxScore: number;
    kind: string;
    sortOrder: number;
  }> = [];
  for (const def of DEFAULT_SECTIONS) {
    const section =
      sections.find((s) => s.labelEn === def.label) ?? sections.find((s) => s.labelAr === def.labelAr);
    const items = DEFAULT_ITEMS[def.label];
    if (!section || !items) continue;
    const sum = items.reduce((t, i) => t + i.maxScore, 0);
    if (Math.abs(sum - section.maxScore) > 1e-9) continue;
    items.forEach((item, idx) =>
      data.push({
        sectionId: section.id,
        key: item.key,
        labelAr: item.labelAr,
        labelEn: item.label,
        maxScore: item.maxScore,
        kind: item.kind,
        sortOrder: idx + 1,
      })
    );
  }
  if (data.length > 0) await prisma.rubricItem.createMany({ data, skipDuplicates: true });
}

// Rubric sections are near-static reference data (edited a few times a
// year from /rubric) but were being re-fetched from the DB on every call —
// up to 4 round trips in a single page render (e.g. statistics.ts calls
// getMaxTotal twice). react's cache() dedupes identical calls within one
// request's render pass; it's cleared automatically between requests, so
// an edit is visible on the very next request with no manual invalidation.
export const listRubricSections = cache(async (includeInactive = false): Promise<RubricSection[]> => {
  const query = () =>
    prisma.rubricSection.findMany({
      where: includeInactive ? undefined : { active: true },
      orderBy: { sortOrder: "asc" },
      include: { items: true },
    });
  // Read first and only seed when something is missing: the seeding checks
  // are two extra round trips that every grade save used to pay.
  let rows = await query();
  if (rows.length === 0 || rows.every((r) => r.items.length === 0)) {
    await ensureDefaultRubric();
    rows = await query();
  }
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
