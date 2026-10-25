// «مركز المعايير»: the rules for editing the criteria (rubric) on the
// desktop. The admin edits the whole set as a draft and saves it at once;
// these pure checks run live on the screen and again before the database
// write, so both agree.
//
// Saved criteria and items are never deleted — grades point to them — only
// turned off. A criterion with active items is scored by their sum, so the
// items must add up to exactly its maximum (more would be capped, less
// would make full marks impossible).
import { round2 } from "./validation";
import { MODIFIED_DISCUSSION_MAX, QUIZ_MAX, canModify, discussionSection, rubricFor } from "./scoring";

export type ItemKind = "check" | "number";

export interface DraftItem {
  id?: string; // absent: new, made on save
  labelAr: string;
  labelEn: string | null;
  maxScore: number;
  kind: ItemKind;
  active: boolean;
}

export interface DraftSection {
  id?: string;
  labelAr: string;
  labelEn: string | null;
  maxScore: number;
  active: boolean;
  items: DraftItem[]; // in order
}

/** A problem that blocks saving. `section`/`item` are indexes into the draft. */
export interface DraftProblem {
  section?: number;
  item?: number;
  message: string;
}

export const LABEL_MAX = 80;
export const SCORE_LIMIT = 100;

const onCent = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;
const sameLabel = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

function scoreProblem(n: number): string | null {
  if (!Number.isFinite(n)) return "الدرجة القصوى غير صالحة";
  if (n <= 0) return "الدرجة القصوى يجب أن تكون أكبر من صفر";
  if (n > SCORE_LIMIT) return `الدرجة القصوى لا تتجاوز ${SCORE_LIMIT}`;
  if (!onCent(n)) return "الدرجة القصوى بمنزلتين عشريتين على الأكثر";
  return null;
}

function labelProblem(s: string): string | null {
  if (!s.trim()) return "الاسم مطلوب";
  if (s.trim().length > LABEL_MAX) return `الاسم لا يتجاوز ${LABEL_MAX} حرفًا`;
  return null;
}

const activeItems = (s: DraftSection) => s.items.filter((i) => i.active);

/** Sum of a criterion's active items (0 when it has none: then it is scored directly). */
export const itemsSum = (s: DraftSection) => round2(activeItems(s).reduce((a, i) => a + i.maxScore, 0));

/** The day's total: the active criteria's maximums. */
export const draftTotal = (draft: DraftSection[]) => round2(draft.filter((s) => s.active).reduce((a, s) => a + s.maxScore, 0));

/** Everything that blocks saving the draft; empty when it can be saved. */
export function draftProblems(draft: DraftSection[]): DraftProblem[] {
  const out: DraftProblem[] = [];
  if (!draft.some((s) => s.active)) out.push({ message: "يجب أن يبقى معيار واحد فعّال على الأقل" });
  draft.forEach((s, si) => {
    const lp = labelProblem(s.labelAr);
    if (lp) out.push({ section: si, message: lp });
    const sp = scoreProblem(s.maxScore);
    if (sp) out.push({ section: si, message: sp });
    if (s.active && draft.some((o, oi) => oi < si && o.active && sameLabel(o.labelAr, s.labelAr)))
      out.push({ section: si, message: "يوجد معيار فعّال آخر بالاسم نفسه" });
    s.items.forEach((i, ii) => {
      const il = labelProblem(i.labelAr);
      if (il) out.push({ section: si, item: ii, message: il });
      const is = scoreProblem(i.maxScore);
      if (is) out.push({ section: si, item: ii, message: is });
      if (i.kind !== "check" && i.kind !== "number") out.push({ section: si, item: ii, message: "نوع البند غير معروف" });
      if (i.active && s.items.some((o, oi) => oi < ii && o.active && sameLabel(o.labelAr, i.labelAr)))
        out.push({ section: si, item: ii, message: "يوجد بند فعّال آخر بالاسم نفسه في هذا المعيار" });
    });
    if (s.active && activeItems(s).length > 0 && !scoreProblem(s.maxScore) && itemsSum(s) !== round2(s.maxScore))
      out.push({ section: si, message: `مجموع البنود ${itemsSum(s)} لا يساوي الدرجة القصوى للمعيار ${s.maxScore}` });
  });
  return out;
}

/** What the saved data already holds, for the warnings before saving. */
export interface SavedState {
  sections: DraftSection[]; // as saved (ids set)
  /** Recorded grades per criterion id, and per item id. */
  gradesBySection: Record<string, number>;
  gradesByItem: Record<string, number>;
}

/**
 * What saving the draft changes for grades already recorded, for the quiz
 * option and for the phones: shown to the admin before confirming. Not
 * problems — saving is allowed — but each one should be a choice.
 */
export function draftWarnings(saved: SavedState, draft: DraftSection[]): string[] {
  const out: string[] = [];
  const before = new Map(saved.sections.map((s) => [s.id!, s]));
  const beforeItems = new Map(saved.sections.flatMap((s) => s.items.map((i) => [i.id!, i] as const)));
  for (const s of draft) {
    const old = s.id ? before.get(s.id) : undefined;
    const n = (s.id && saved.gradesBySection[s.id]) || 0;
    if (old && n > 0) {
      if (old.active && !s.active) out.push(`«${old.labelAr}» عليه ${n} درجة مسجّلة: بعد تعطيله لا يظهر عمودها في مركز الدرجات (يبقى مجموع كل يوم كما سُجّل).`);
      else if (s.active && round2(old.maxScore) !== round2(s.maxScore))
        out.push(`«${old.labelAr}»: الدرجة القصوى من ${old.maxScore} إلى ${s.maxScore}. ${n} درجة مسجّلة تبقى من ${old.maxScore}، وتُحسب في المعدلات على المقياس الجديد.`);
    }
    for (const i of s.items) {
      const oi = i.id ? beforeItems.get(i.id) : undefined;
      const m = (i.id && saved.gradesByItem[i.id]) || 0;
      if (oi && m > 0 && oi.active && !i.active) out.push(`البند «${oi.labelAr}» عليه ${m} درجة مسجّلة وسيُعطَّل.`);
      else if (oi && m > 0 && i.active && (round2(oi.maxScore) !== round2(i.maxScore) || oi.kind !== i.kind))
        out.push(`البند «${oi.labelAr}» تغيّر (الدرجة أو النوع) وعليه ${m} درجة مسجّلة بالقيمة القديمة.`);
    }
  }
  const t0 = draftTotal(saved.sections);
  const t1 = draftTotal(draft);
  if (t0 !== t1) out.push(`المجموع الكلي لليوم يتغيّر من ${t0} إلى ${t1}.`);

  // «الدرجات المعدّلة (كويز)» finds the discussion criterion by its items' names.
  const shape = (d: DraftSection[]) => d.filter((s) => s.active).map((s) => ({ ...s, id: s.id ?? "", items: activeItems(s).map((i) => ({ ...i, id: i.id ?? "" })) }));
  const was = canModify(shape(saved.sections));
  const now = shape(draft);
  if (was && !canModify(now)) out.push("«الدرجات المعدّلة (كويز)» لن تكون متاحة: تحتاج معيارًا فيه بندا «مناقشة جماعية» و«مناقشة الحالة» بهذين الاسمين.");
  const disc = discussionSection(rubricFor(now, "modified"));
  if (disc) {
    const modifiedSum = round2(disc.items.reduce((a, i) => a + i.maxScore, 0));
    if (modifiedSum !== round2(disc.maxScore))
      out.push(`في «الدرجات المعدّلة» تصبح المناقشتان ${MODIFIED_DISCUSSION_MAX} + ${MODIFIED_DISCUSSION_MAX} والاختبار القصير ${QUIZ_MAX}، فمجموع بنود «${disc.labelAr}» يصير ${modifiedSum} لا ${disc.maxScore}.`);
  }
  return out;
}

/** Did anything change? (Order counts.) */
export function draftChanged(saved: DraftSection[], draft: DraftSection[]): boolean {
  const norm = (d: DraftSection[]) =>
    JSON.stringify(d.map((s) => [s.id ?? null, s.labelAr.trim(), (s.labelEn ?? "").trim(), round2(s.maxScore), s.active, s.items.map((i) => [i.id ?? null, i.labelAr.trim(), (i.labelEn ?? "").trim(), round2(i.maxScore), i.kind, i.active])]));
  return norm(saved) !== norm(draft);
}
