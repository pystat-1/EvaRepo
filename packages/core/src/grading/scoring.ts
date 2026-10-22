// «الدرجات المعدّلة» (modified scoring): on a day the evaluator gives a
// quiz, the discussion criterion is split 2.5 + 2.5 + 2 — group discussion
// 2.5, case discussion 2.5 and a quiz (اختبار قصير) 2 — instead of 3.5 + 3.5.
// The section's total (7) and the day's total (15) do not change, so the
// desktop keeps one score per section whichever way the day was graded.
// The phone chooses the mode per group-day; the desktop re-validates the
// items against the same derived rubric. A grade's mode is known from its
// items: modified grades carry a QUIZ_ITEM_ID score.

export type ScoringMode = "standard" | "modified";

export const QUIZ_ITEM_ID = "quiz";
export const MODIFIED_DISCUSSION_MAX = 2.5;
export const QUIZ_MAX = 2;

interface ItemLike {
  id: string;
  labelAr: string;
  labelEn?: string | null;
  maxScore: number;
  kind: "check" | "number";
}
interface SectionLike<I extends ItemLike> {
  id: string;
  maxScore: number;
  items: I[];
}

const isGroupDiscussion = (i: ItemLike) => /group\s*discussion/i.test(i.labelEn ?? "") || i.labelAr.trim() === "مناقشة جماعية";
const isCaseDiscussion = (i: ItemLike) => /case\s*discussion/i.test(i.labelEn ?? "") || i.labelAr.trim() === "مناقشة الحالة";

/** The section holding both group and case discussion, or null (then the mode is not available). */
export function discussionSection<I extends ItemLike, S extends SectionLike<I>>(rubric: S[]): S | null {
  return rubric.find((s) => s.items.some(isGroupDiscussion) && s.items.some(isCaseDiscussion)) ?? null;
}

export const canModify = <I extends ItemLike, S extends SectionLike<I>>(rubric: S[]) => discussionSection(rubric) !== null;

/** The rubric a day is graded with: unchanged, or with the discussion split 2.5 + 2.5 + quiz 2. */
export function rubricFor<I extends ItemLike, S extends SectionLike<I>>(rubric: S[], mode: ScoringMode | undefined): S[] {
  if (mode !== "modified") return rubric;
  const target = discussionSection(rubric);
  if (!target) return rubric;
  return rubric.map((s) => {
    if (s !== target) return s;
    const items: I[] = [];
    for (const i of s.items) {
      const disc = isGroupDiscussion(i) || isCaseDiscussion(i);
      items.push(disc ? { ...i, maxScore: MODIFIED_DISCUSSION_MAX } : i);
      // The quiz comes right after case discussion, as on the paper form.
      if (isCaseDiscussion(i)) items.push({ ...i, id: QUIZ_ITEM_ID, labelAr: "اختبار قصير", labelEn: "Quiz", maxScore: QUIZ_MAX, kind: "number" });
    }
    return { ...s, items };
  });
}

/** How a saved grade was given, from its item scores. */
export const scoringOf = (items: Record<string, number> | null | undefined): ScoringMode => (items && QUIZ_ITEM_ID in items ? "modified" : "standard");

/**
 * Item scores moved to another mode: discussion items above their new
 * maximum are lowered to it; leaving the modified mode drops the quiz.
 */
export function convertScores<I extends ItemLike, S extends SectionLike<I>>(rubric: S[], scores: Record<string, number>, to: ScoringMode): Record<string, number> {
  const target = discussionSection(rubric);
  if (!target) return scores;
  const out = { ...scores };
  if (to === "standard") {
    delete out[QUIZ_ITEM_ID];
    return out;
  }
  for (const i of target.items) {
    if ((isGroupDiscussion(i) || isCaseDiscussion(i)) && out[i.id] !== undefined) out[i.id] = Math.min(out[i.id], MODIFIED_DISCUSSION_MAX);
  }
  return out;
}
