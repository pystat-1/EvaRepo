// «مركز المعايير»: reading and saving the criteria (rubric_sections) and
// their items (rubric_items). The screen edits the whole set as a draft and
// saves it here in one transaction, with an audit entry per change. Rows
// are never deleted (grades point to them), only turned off. The phones get
// the new criteria on their next sync: the bundle's version is a hash of
// its content, rubric included (sync.ts buildPublication).
import { eq, sql } from "drizzle-orm";
import { sha256Hex } from "@eva/core/sync/tokens";
import { draftProblems, type DraftSection, type SavedState } from "@eva/core/grading/rubricDraft";
import { round2 } from "@eva/core/grading/validation";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";

/** The active criteria with their active items, in form order: what grading and the phones use. */
export async function rubricWithItems(r: Repo): Promise<t.RubricSnapshot["sections"]> {
  const sections = (await r.db.select().from(t.rubricSections).where(eq(t.rubricSections.active, true))).sort((a, b) => a.sortOrder - b.sortOrder);
  const items = await r.db.select().from(t.rubricItems).where(eq(t.rubricItems.active, true));
  return sections.map((s) => ({
    id: s.id,
    labelAr: s.labelAr,
    labelEn: s.labelEn,
    maxScore: s.maxScore,
    items: items
      .filter((i) => i.sectionId === s.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ id: i.id, labelAr: i.labelAr, labelEn: i.labelEn, maxScore: i.maxScore, kind: i.kind })),
  }));
}

// ---- versions -------------------------------------------------------------
// Each set of criteria sent to the phones is kept (rubric_versions), keyed by
// a hash of its content: publishing the same criteria again reuses its
// number. A day validated on a phone names the version it was graded with,
// so changing the criteria never rejects work already done with the old ones.

/** The version number of these criteria, recorded the first time they are published. */
export async function ensureRubricVersion(r: Repo, sections: t.RubricSnapshot["sections"]): Promise<number> {
  const hash = await sha256Hex(JSON.stringify(sections));
  await r.db.insert(t.rubricVersions).values({ hash, rubric: { sections } }).onConflictDoNothing({ target: t.rubricVersions.hash });
  const [row] = await r.db.select({ version: t.rubricVersions.version }).from(t.rubricVersions).where(eq(t.rubricVersions.hash, hash));
  return row.version;
}

/** Every published version's criteria, by version number. */
export async function rubricVersionMap(r: Repo): Promise<Record<number, t.RubricSnapshot["sections"]>> {
  const rows = await r.db.select().from(t.rubricVersions);
  return Object.fromEntries(rows.map((x) => [x.version, x.rubric.sections]));
}

/** The criteria of a published version, or null when this computer never published it. */
export async function rubricOfVersion(r: Repo, version: number): Promise<t.RubricSnapshot["sections"] | null> {
  const [row] = await r.db.select({ rubric: t.rubricVersions.rubric }).from(t.rubricVersions).where(eq(t.rubricVersions.version, version));
  return row?.rubric.sections ?? null;
}

/** Every criterion and item, turned-off ones too, in form order, with how many grades use each. */
export async function rubricCenter(r: Repo): Promise<SavedState> {
  const sections = (await r.db.select().from(t.rubricSections)).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const items = (await r.db.select().from(t.rubricItems)).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  const bySection = await r.db
    .select({ id: t.evaluationScores.rubricSectionId, n: sql<number>`count(*)` })
    .from(t.evaluationScores)
    .groupBy(t.evaluationScores.rubricSectionId);
  // Item scores live in evaluations.itemScores (JSON: itemId -> score);
  // counted here rather than with SQLite's JSON functions.
  const byItem: Record<string, number> = {};
  for (const e of await r.db.select({ items: t.evaluations.itemScores }).from(t.evaluations)) {
    for (const id of Object.keys(e.items ?? {})) byItem[id] = (byItem[id] ?? 0) + 1;
  }
  return {
    sections: sections.map((s) => ({
      id: s.id,
      labelAr: s.labelAr,
      labelEn: s.labelEn,
      maxScore: s.maxScore,
      active: s.active,
      items: items
        .filter((i) => i.sectionId === s.id)
        .map((i) => ({ id: i.id, labelAr: i.labelAr, labelEn: i.labelEn, maxScore: i.maxScore, kind: i.kind, active: i.active })),
    })),
    gradesBySection: Object.fromEntries(bySection.map((x) => [x.id, Number(x.n)])),
    gradesByItem: byItem,
  };
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const cleanEn = (s: string | null) => (s && clean(s)) || null;

/**
 * Saves the draft: new rows are added, changed rows updated, order taken
 * from the draft. Refuses a draft with problems (draftProblems), one that
 * drops a saved row instead of turning it off, or moves an item to another
 * criterion. Returns how many rows changed.
 */
export async function saveRubric(r: Repo, draft: DraftSection[]): Promise<{ changed: number }> {
  const problems = draftProblems(draft);
  if (problems.length > 0) throw new ValidationError(problems[0].message);

  const saved = await rubricCenter(r);
  const sectionBy = new Map(saved.sections.map((s) => [s.id!, s]));
  const itemSection = new Map(saved.sections.flatMap((s) => s.items.map((i) => [i.id!, s.id!] as const)));
  const itemBy = new Map(saved.sections.flatMap((s) => s.items.map((i) => [i.id!, i] as const)));
  const sortBy = new Map((await r.db.select({ id: t.rubricSections.id, sortOrder: t.rubricSections.sortOrder }).from(t.rubricSections)).map((x) => [x.id, x.sortOrder]));
  const itemSortBy = new Map((await r.db.select({ id: t.rubricItems.id, sortOrder: t.rubricItems.sortOrder }).from(t.rubricItems)).map((x) => [x.id, x.sortOrder]));

  const seenSections = new Set<string>();
  const seenItems = new Set<string>();
  for (const s of draft) {
    if (s.id) {
      if (!sectionBy.has(s.id)) throw new ValidationError("معيار غير موجود؛ أعد فتح مركز المعايير");
      if (seenSections.has(s.id)) throw new ValidationError("معيار مكرر في المسودة");
      seenSections.add(s.id);
    }
    for (const i of s.items) {
      if (!i.id) continue;
      if (!itemBy.has(i.id)) throw new ValidationError("بند غير موجود؛ أعد فتح مركز المعايير");
      if (seenItems.has(i.id)) throw new ValidationError("بند مكرر في المسودة");
      if (!s.id || itemSection.get(i.id) !== s.id) throw new ValidationError("لا يمكن نقل بند إلى معيار آخر");
      seenItems.add(i.id);
    }
  }
  if (saved.sections.some((s) => !seenSections.has(s.id!)) || [...itemBy.keys()].some((id) => !seenItems.has(id)))
    throw new ValidationError("لا تُحذف المعايير والبنود المحفوظة؛ عطّلها بدلًا من ذلك");

  // Order: kept as saved when the draft did not reorder (new rows go last),
  // else renumbered 1, 2, 3… — so saving a rename never touches every row.
  const orderFor = (ids: (string | undefined)[], savedIds: string[], sortOf: Map<string, number>): number[] => {
    const kept = ids.filter((id): id is string => !!id && savedIds.includes(id));
    const sameOrder = kept.join("|") === savedIds.filter((id) => kept.includes(id)).join("|");
    if (!sameOrder) return ids.map((_, k) => k + 1);
    let next = Math.max(0, ...kept.map((id) => sortOf.get(id) ?? 0));
    return ids.map((id) => (id && sortOf.has(id) ? sortOf.get(id)! : ++next));
  };
  const sectionOrder = orderFor(draft.map((s) => s.id), saved.sections.map((s) => s.id!), sortBy);

  const plan = new Plan(r);
  const at = nowISO();
  let changed = 0;
  draft.forEach((s, si) => {
    const row = { labelAr: clean(s.labelAr), labelEn: cleanEn(s.labelEn), maxScore: round2(s.maxScore), active: s.active, sortOrder: sectionOrder[si] };
    let sectionId = s.id;
    if (!sectionId) {
      sectionId = newId();
      plan.add(r.db.insert(t.rubricSections).values({ id: sectionId, ...row, createdAt: at, updatedAt: at }));
      plan.audit("RubricSection", sectionId, "create", undefined, row);
      changed++;
    } else {
      const old = sectionBy.get(sectionId)!;
      const before = { labelAr: old.labelAr, labelEn: old.labelEn, maxScore: old.maxScore, active: old.active, sortOrder: sortBy.get(sectionId) };
      if (JSON.stringify(before) !== JSON.stringify(row)) {
        plan.add(r.db.update(t.rubricSections).set({ ...row, updatedAt: at }).where(eq(t.rubricSections.id, sectionId)));
        plan.audit("RubricSection", sectionId, old.active && !row.active ? "deactivate" : !old.active && row.active ? "reactivate" : "update", before, row);
        changed++;
      }
    }
    const itemOrder = orderFor(s.items.map((i) => i.id), s.id ? sectionBy.get(s.id)!.items.map((i) => i.id!) : [], itemSortBy);
    s.items.forEach((i, ii) => {
      const irow = { labelAr: clean(i.labelAr), labelEn: cleanEn(i.labelEn), maxScore: round2(i.maxScore), kind: i.kind, active: i.active, sortOrder: itemOrder[ii] };
      if (!i.id) {
        const id = newId();
        // `key` is unique and only ever read by migrations of the original rubric.
        plan.add(r.db.insert(t.rubricItems).values({ id, sectionId: sectionId!, key: `item-${id}`, ...irow, createdAt: at, updatedAt: at }));
        plan.audit("RubricItem", id, "create", undefined, { sectionId, ...irow });
        changed++;
        return;
      }
      const old = itemBy.get(i.id)!;
      const before = { labelAr: old.labelAr, labelEn: old.labelEn, maxScore: old.maxScore, kind: old.kind, active: old.active, sortOrder: itemSortBy.get(i.id) };
      if (JSON.stringify(before) !== JSON.stringify(irow)) {
        plan.add(r.db.update(t.rubricItems).set({ ...irow, updatedAt: at }).where(eq(t.rubricItems.id, i.id)));
        plan.audit("RubricItem", i.id, old.active && !irow.active ? "deactivate" : !old.active && irow.active ? "reactivate" : "update", before, irow);
        changed++;
      }
    });
  });
  await plan.commit();
  return { changed };
}
