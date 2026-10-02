// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { listRubricSections } from "./rubric";
import { recomputeFlagsForStudent } from "./flags";
import { getScheduledRotationForDate } from "./rotationBlocks";
import { todayISO } from "../date";
import {
  applyItemScores,
  isWithinSubmissionWindow,
  normalizeScoresForAttendance,
  round2,
  validateScores,
} from "../evaluator/validation";

export type Attendance = "present" | "absent" | "late";

export interface Evaluation {
  id: string;
  studentId: string;
  evaluatorId: string;
  groupId: string | null;
  hospitalId: string | null;
  dateISO: string;
  attendance: Attendance;
  notes: string | null;
  feedback: string | null;
  dailyNoteSubmitted: boolean;
  // rubricItemId -> score, for sections broken into items (empty if none)
  itemScores: Record<string, number>;
  total: number;
  locked: boolean;
  pendingValidation: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationWithScores extends Evaluation {
  scores: Record<string, number>;
  evaluatorName: string | null;
}

function serialize(row: {
  id: string;
  studentId: string;
  evaluatorId: string;
  groupId: string | null;
  hospitalId: string | null;
  dateISO: string;
  attendance: string;
  notes: string | null;
  feedback: string | null;
  dailyNoteSubmitted: boolean;
  itemScores?: unknown;
  total: number;
  locked: boolean;
  pendingValidation?: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Evaluation {
  return {
    id: row.id,
    studentId: row.studentId,
    evaluatorId: row.evaluatorId,
    groupId: row.groupId,
    hospitalId: row.hospitalId,
    dateISO: row.dateISO,
    attendance: row.attendance as Attendance,
    notes: row.notes,
    feedback: row.feedback,
    dailyNoteSubmitted: row.dailyNoteSubmitted,
    itemScores: parseItemScores(row.itemScores),
    total: row.total,
    locked: row.locked,
    pendingValidation: row.pendingValidation ?? false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseItemScores(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Resolves the student's group's hospital for a given date off the
// rotation schedule (see RotationBlock) rather than a static field — a
// group's hospital changes as it rotates, so this is looked up per date.
async function getStudentGroupHospital(
  studentId: string,
  dateISO: string
): Promise<{ groupId: string | null; hospitalId: string | null }> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { groupId: true },
  });
  if (!student) throw new Error("Student not found");
  if (!student.groupId) return { groupId: null, hospitalId: null };
  const block = await getScheduledRotationForDate(student.groupId, dateISO);
  return { groupId: student.groupId, hospitalId: block?.hospitalId ?? null };
}

function attachScoresFromRelation(scores: { rubricSectionId: string; score: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  scores.forEach((s) => (out[s.rubricSectionId] = s.score));
  return out;
}

export async function getEvaluation(id: string): Promise<EvaluationWithScores | undefined> {
  const row = await prisma.evaluation.findUnique({
    where: { id },
    include: { evaluator: { select: { name: true } }, scores: true },
  });
  if (!row) return undefined;
  return { ...serialize(row), scores: attachScoresFromRelation(row.scores), evaluatorName: row.evaluator?.name ?? null };
}

export async function getEvaluationForStudentDate(
  studentId: string,
  dateISO: string
): Promise<EvaluationWithScores | undefined> {
  const row = await prisma.evaluation.findUnique({
    where: { studentId_dateISO: { studentId, dateISO } },
    include: { evaluator: { select: { name: true } }, scores: true },
  });
  if (!row) return undefined;
  return { ...serialize(row), scores: attachScoresFromRelation(row.scores), evaluatorName: row.evaluator?.name ?? null };
}

// Batch version of getEvaluationForStudentDate for a whole roster on one day
// — a single query instead of one per student, which is what makes the
// offline-bundle import fast (previously N+1 over the network).
export async function getEvaluationsForStudentsOnDate(
  studentIds: string[],
  dateISO: string
): Promise<EvaluationWithScores[]> {
  if (studentIds.length === 0) return [];
  const rows = await prisma.evaluation.findMany({
    where: { studentId: { in: studentIds }, dateISO },
    include: { evaluator: { select: { name: true } }, scores: true },
  });
  return rows.map((row) => ({
    ...serialize(row),
    scores: attachScoresFromRelation(row.scores),
    evaluatorName: row.evaluator?.name ?? null,
  }));
}

export async function listEvaluationsForStudent(
  studentId: string,
  limit = 90
): Promise<EvaluationWithScores[]> {
  // The student's own view: validated grades only.
  const rows = await prisma.evaluation.findMany({
    where: { studentId, pendingValidation: false },
    orderBy: { dateISO: "desc" },
    take: limit,
    include: { evaluator: { select: { name: true } }, scores: true },
  });
  return rows.map((r: any) => ({
    ...serialize(r),
    scores: attachScoresFromRelation(r.scores),
    evaluatorName: r.evaluator?.name ?? null,
  }));
}

export interface UpsertEvaluationInput {
  studentId: string;
  evaluatorId: string;
  dateISO: string;
  attendance: Attendance;
  notes?: string;
  feedback?: string;
  dailyNoteSubmitted?: boolean;
  // Tri-state daily-note status for the attendance record (null = not
  // recorded). When omitted, it is derived from dailyNoteSubmitted.
  dailyNote?: boolean | null;
  scores: Record<string, number>; // rubricSectionId -> score (sections without items)
  itemScores?: Record<string, number>; // rubricItemId -> score
  // Evaluator saves stay hidden from the admin until the day is validated.
  pendingValidation?: boolean;
  // Where the day was actually worked; needed for off-schedule days, which
  // have no rotation block on that date to look the hospital up from.
  hospitalId?: string | null;
  // The student's group, when the caller already knows it (skips a lookup).
  groupId?: string | null;
}

// The Tier 0 fix from the data-integrity roadmap, applied structurally: the
// unit of write is one evaluation row for one student on one day (enforced
// by the @@unique([studentId, dateISO]) constraint in prisma/schema.prisma),
// never a whole day's session object. Two evaluators grading two different
// students on the same day write two independent rows — there is nothing to
// blindly overwrite. Re-saving the same student/day updates that one row
// (an ordinary upsert), which is the correct behavior for "the evaluator
// corrected today's entry," not a data-loss risk.
// Which of these students already have a saved evaluation on a given date —
// one query instead of one lookup per student (used by the schedule/roster
// views to badge graded vs pending without an N+1 storm).
export async function getEvaluatedStudentIdsForDate(
  studentIds: string[],
  dateISO: string
): Promise<Set<string>> {
  if (studentIds.length === 0) return new Set();
  const rows = await prisma.evaluation.findMany({
    where: { studentId: { in: studentIds }, dateISO },
    select: { studentId: true },
  });
  return new Set(rows.map((r) => r.studentId));
}

export async function upsertEvaluation(
  actorId: string,
  input: UpsertEvaluationInput
): Promise<EvaluationWithScores> {
  // EVALUATOR_APP_PLAN.md C5: an evaluation can only be saved for a date
  // within the 7-day Baghdad window (backdating/grading-ahead were both
  // previously accepted with no check at all).
  if (!isWithinSubmissionWindow(input.dateISO, todayISO())) {
    throw new Error("لا يمكن حفظ تقييم لهذا التاريخ — تجاوز المدة المسموحة (7 أيام)");
  }

  const key = { studentId: input.studentId, dateISO: input.dateISO };
  // Independent reads in parallel: each is a network round trip to the
  // database, and a save used to make ~30 of them one after another.
  const [sections, located, existing, record] = await Promise.all([
    listRubricSections(),
    input.groupId && input.hospitalId !== undefined
      ? Promise.resolve({ groupId: input.groupId, hospitalId: input.hospitalId })
      : getStudentGroupHospital(input.studentId, input.dateISO),
    getEvaluationForStudentDate(input.studentId, input.dateISO),
    prisma.attendanceRecord.findUnique({ where: { studentId_dateISO: key } }),
  ]);

  const absent = input.attendance === "absent";
  const fromItems = applyItemScores(input.scores, absent ? {} : input.itemScores ?? {}, sections);
  const scores = normalizeScoresForAttendance(input.attendance, fromItems.scores, sections);
  const itemScores = fromItems.itemScores;
  validateScores(scores, sections);
  const total = round2(Object.values(scores).reduce((sum, score) => sum + score, 0));
  const dailyNote =
    input.dailyNote !== undefined ? input.dailyNote : input.dailyNoteSubmitted ? true : null;
  const dailyNoteSubmitted = !absent && dailyNote === true;

  const groupId = located.groupId;
  const hospitalId = input.hospitalId ?? located.hospitalId;
  const pendingValidation = input.pendingValidation ?? false;

  if (existing?.locked) throw new Error("هذا التقييم مقفل ولا يمكن تعديله");

  // Keep the day's attendance record (الحضور / الديلي نوت screens) in step
  // with what was saved. The marked time only moves when the attendance
  // status actually changes.
  const now = new Date();
  const statusChanged = !record || record.status !== input.attendance;
  const noteValue = absent ? null : dailyNote;
  const noteChanged = !record || record.dailyNote !== noteValue;
  const scoreRows = Object.entries(scores).map(([rubricSectionId, score]) => ({ rubricSectionId, score }));
  const fields = {
    evaluatorId: input.evaluatorId,
    groupId,
    hospitalId,
    attendance: input.attendance,
    notes: input.notes ?? null,
    feedback: input.feedback ?? null,
    dailyNoteSubmitted,
    itemScores,
    total,
    pendingValidation,
  };

  // One batch transaction of plain statements (a single round trip): the
  // evaluation, its scores replaced wholesale (delete + insert, as the old
  // DELETE-then-INSERT did), and the attendance record. The id is chosen
  // here so the score rows can reference a brand-new evaluation; a nested
  // write would have cost Prisma's multi-step internal transaction instead.
  const evaluationId = existing?.id ?? crypto.randomUUID();
  const [row] = await prisma.$transaction([
    prisma.evaluation.upsert({
      where: { studentId_dateISO: key },
      create: { id: evaluationId, ...key, ...fields },
      update: fields,
    }),
    prisma.evaluationScore.deleteMany({ where: { evaluationId } }),
    prisma.evaluationScore.createMany({ data: scoreRows.map((r) => ({ ...r, evaluationId })) }),
    prisma.attendanceRecord.upsert({
      where: { studentId_dateISO: key },
      create: {
        ...key,
        groupId,
        hospitalId,
        status: input.attendance,
        markedAt: now,
        markedById: actorId,
        dailyNote: noteValue,
        dailyNoteAt: noteValue === null ? null : now,
        dailyNoteById: noteValue === null ? null : actorId,
      },
      update: {
        groupId,
        hospitalId,
        ...(statusChanged ? { status: input.attendance, markedAt: now, markedById: actorId } : {}),
        ...(noteChanged
          ? {
              dailyNote: noteValue,
              dailyNoteAt: noteValue === null ? null : now,
              dailyNoteById: noteValue === null ? null : actorId,
            }
          : {}),
      },
    }),
  ]);

  const result: EvaluationWithScores = {
    ...serialize(row),
    scores: Object.fromEntries(scoreRows.map((r) => [r.rubricSectionId, r.score])),
    evaluatorName: existing && existing.evaluatorId === input.evaluatorId ? existing.evaluatorName : null,
  };
  await recordAudit({
    actorId,
    entityType: "Evaluation",
    entityId: row.id,
    action: existing ? "update" : "create",
    before: existing,
    after: result,
  });

  // Flags only count validated grades, so a draft save changes nothing —
  // unless it just turned a previously visible grade back into a draft.
  if (!pendingValidation || (existing && !existing.pendingValidation)) {
    await recomputeFlagsForStudent(input.studentId);
  }

  return result;
}
