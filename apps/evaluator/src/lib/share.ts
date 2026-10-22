// «الزملاء»: a group-day's work sent from one evaluator's phone to a
// colleague of the same group, compared with the colleague's own draft and
// merged into it. Pure functions: the screens only store the results.
//
// Merging never validates anything: the merged day stays a draft that the
// receiver checks and validates once, so the manager gets one grade per
// student-day instead of a conflict between two evaluators.
import type { DayShare, EvaluatorBundle, GuestInfo, ShareRecord, SharedAssignment } from "@eva/core/sync/contract";
import { convertScores, type ScoringMode } from "@eva/core/grading/scoring";
import { dayBundle, dayStudents, draftKey, rowTotal, type Draft, type DraftRow } from "./day";
import type { Assignment } from "./store";

const hasContent = (r: DraftRow | undefined) => !!r && (r.attendance !== null || r.dailyNote !== null || Object.keys(r.scores).length > 0 || !!r.notes?.trim());

/** What a share carries from a draft: every student with something entered (hosted students included). */
export function shareRecords(bundle: EvaluatorBundle, draft: Draft): ShareRecord[] {
  return dayStudents(bundle, draft.groupId, draft.guests).flatMap((s): ShareRecord[] => {
    const r = draft.rows[s.id];
    if (!hasContent(r)) return [];
    const absent = r!.attendance === "absent";
    return [
      {
        studentId: s.id,
        attendance: r!.attendance,
        dailyNote: absent ? null : r!.dailyNote,
        scores: absent ? {} : r!.scores,
        ...(r!.notes?.trim() ? { notes: r!.notes.trim() } : {}),
        ...(s.guest ? { guest: s.guest } : {}),
      },
    ];
  });
}

export function buildShare(
  bundle: EvaluatorBundle,
  draft: Draft,
  o: { id: string; toId: string; message?: string; assignments?: SharedAssignment[]; now: Date }
): DayShare {
  return {
    id: o.id,
    kind: "share",
    fromId: bundle.evaluator.id,
    fromName: bundle.evaluator.name,
    toId: o.toId,
    groupId: draft.groupId,
    dateISO: draft.dateISO,
    ...(draft.scoring === "modified" ? { scoring: "modified" as const } : {}),
    ...(o.message?.trim() ? { message: o.message.trim() } : {}),
    sentAt: o.now.toISOString(),
    records: shareRecords(bundle, draft),
    ...(o.assignments?.length ? { assignments: o.assignments } : {}),
  };
}

/**
 * One student of a share against the receiver's day:
 * - new: nothing entered for them yet (or a hosted student not on my list);
 * - same: everything they sent is what I have;
 * - fills: they only fill what I left empty;
 * - differs: at least one value differs from mine;
 * - unknown: not in this group and not a hosted student (cannot be merged).
 */
export type MergeState = "new" | "same" | "fills" | "differs" | "unknown";

export interface MergeLine {
  studentId: string; // as in the share
  myId: string | null; // the student in my day (null: a hosted student to add)
  name: string;
  guest?: GuestInfo;
  state: MergeState;
  theirs: ShareRecord;
  theirTotal: number | null;
  myTotal: number | null;
}

function myIdOf(bundle: EvaluatorBundle, share: DayShare, draft: Draft | null, rec: ShareRecord): string | null {
  const mine = dayStudents(bundle, share.groupId, draft?.guests);
  if (mine.some((s) => s.id === rec.studentId)) return rec.studentId;
  const number = rec.guest?.universityNumber.trim();
  return (number && mine.find((s) => s.universityNumber.trim() === number)?.id) || null;
}

function stateOf(mine: DraftRow | undefined, theirs: ShareRecord): MergeState {
  if (!hasContent(mine)) return "new";
  const m = mine!;
  let fills = false;
  let differs = false;
  const pair = (a: unknown, b: unknown) => {
    if (b === null || b === undefined || b === "") return;
    if (a === null || a === undefined || a === "") fills = true;
    else if (a !== b) differs = true;
  };
  pair(m.attendance, theirs.attendance);
  pair(m.dailyNote, theirs.dailyNote);
  for (const [k, v] of Object.entries(theirs.scores)) pair(m.scores[k], v);
  pair(m.notes?.trim(), theirs.notes?.trim());
  return differs ? "differs" : fills ? "fills" : "same";
}

const asRow = (r: ShareRecord): DraftRow => ({ attendance: r.attendance, dailyNote: r.dailyNote, scores: r.scores, touched: Object.keys(r.scores).length > 0, notes: r.notes });

/** The share student by student, against my draft of that day (null: none yet). */
export function compareShare(bundle: EvaluatorBundle, share: DayShare, draft: Draft | null): MergeLine[] {
  const group = bundle.groups.find((g) => g.id === share.groupId);
  const theirsBundle = dayBundle(bundle, share.scoring);
  const mineBundle = dayBundle(bundle, draft?.scoring);
  return share.records.map((rec) => {
    const myId = myIdOf(bundle, share, draft, rec);
    const mine = myId ? draft?.rows[myId] : undefined;
    const known = !!myId || !!rec.guest;
    const name = group?.students.find((s) => s.id === rec.studentId)?.name ?? draft?.guests?.[myId ?? ""]?.name ?? rec.guest?.name ?? "—";
    return {
      studentId: rec.studentId,
      myId,
      name,
      ...(rec.guest ? { guest: rec.guest } : {}),
      state: known ? stateOf(mine, rec) : "unknown",
      theirs: rec,
      theirTotal: rec.attendance ? rowTotal(theirsBundle, asRow(rec)) : null,
      myTotal: mine?.attendance ? rowTotal(mineBundle, mine) : null,
    };
  });
}

/** Has the receiver graded anything in this day (then a different scoring mode matters)? */
export const hasGrades = (draft: Draft | null) => !!draft && Object.values(draft.rows).some((r) => Object.keys(r.scores).length > 0);

/**
 * My day with the colleague's work merged in, for the students picked.
 * `replace` false: their values only fill what I left empty; true: their
 * values win where both entered something. The day takes `scoring`; scores
 * on either side are converted to it (grading/scoring.ts convertScores).
 */
export function mergeShare(
  bundle: EvaluatorBundle,
  draft: Draft | null,
  share: DayShare,
  o: { pick: Set<string>; replace: boolean; scoring: ScoringMode; now: Date }
): Draft {
  const base: Draft = draft ?? { key: draftKey(share.groupId, share.dateISO), groupId: share.groupId, dateISO: share.dateISO, rows: {}, status: "draft", updatedAt: o.now.toISOString() };
  const conv = (scores: Record<string, number>) => convertScores(bundle.rubric, scores, o.scoring);
  const rows: Record<string, DraftRow> = Object.fromEntries(Object.entries(base.rows).map(([k, r]) => [k, { ...r, scores: conv(r.scores) }]));
  const guests = { ...(base.guests ?? {}) };
  for (const line of compareShare(bundle, share, draft)) {
    if (!o.pick.has(line.studentId) || line.state === "unknown") continue;
    const id = line.myId ?? line.studentId;
    if (!line.myId && line.guest) guests[id] = line.guest;
    const mine = rows[id] ?? { attendance: null, dailyNote: null, scores: {}, touched: false };
    const t = line.theirs;
    const theirs = conv(t.scores);
    const pick = <T>(a: T | null | undefined, b: T | null | undefined): T | null => (o.replace ? (b ?? a ?? null) : (a ?? b ?? null));
    const attendance = pick(mine.attendance, t.attendance);
    const notes = pick(mine.notes?.trim() || null, t.notes?.trim() || null);
    rows[id] = {
      attendance,
      dailyNote: attendance === "absent" ? null : pick(mine.dailyNote, t.dailyNote),
      scores: attendance === "absent" ? mine.scores : o.replace ? { ...mine.scores, ...theirs } : { ...theirs, ...mine.scores },
      touched: mine.touched || Object.keys(theirs).length > 0,
      ...(notes ? { notes } : {}),
    };
  }
  return {
    ...base,
    rows,
    ...(Object.keys(guests).length ? { guests } : {}),
    scoring: o.scoring === "modified" ? "modified" : undefined,
    updatedAt: o.now.toISOString(),
  };
}

/** A share's assignments as this phone keeps them (marked with who sent them). */
export function assignmentsOf(share: DayShare, now: Date): Assignment[] {
  return (share.assignments ?? []).map((a) => ({ ...a, groupId: share.groupId, createdAt: now.toISOString(), from: share.fromName }));
}
