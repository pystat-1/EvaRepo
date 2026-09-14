// TODO(verify-on-deploy): converted from raw SQL to Prisma by hand in a
// sandbox that cannot run `prisma generate` (see the top of src/lib/db.ts
// for why) — re-check this file once a real client has been generated.
import { prisma } from "../db";
import { recordAudit } from "../audit";
import { listRubricSections } from "./rubric";
import { recomputeFlagsForStudent } from "./flags";

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
  total: number;
  locked: boolean;
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
  total: number;
  locked: boolean;
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
    total: row.total,
    locked: row.locked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
  const block = await prisma.rotationBlock.findFirst({
    where: { groupId: student.groupId, active: true, startDate: { lte: dateISO }, endDate: { gte: dateISO } },
    select: { hospitalId: true },
  });
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

export async function listEvaluationsForStudent(
  studentId: string,
  limit = 90
): Promise<EvaluationWithScores[]> {
  const rows = await prisma.evaluation.findMany({
    where: { studentId },
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
  scores: Record<string, number>; // rubricSectionId -> score
}

// The Tier 0 fix from the data-integrity roadmap, applied structurally: the
// unit of write is one evaluation row for one student on one day (enforced
// by the @@unique([studentId, dateISO]) constraint in prisma/schema.prisma),
// never a whole day's session object. Two evaluators grading two different
// students on the same day write two independent rows — there is nothing to
// blindly overwrite. Re-saving the same student/day updates that one row
// (an ordinary upsert), which is the correct behavior for "the evaluator
// corrected today's entry," not a data-loss risk.
export async function upsertEvaluation(
  actorId: string,
  input: UpsertEvaluationInput
): Promise<EvaluationWithScores> {
  const sections = await listRubricSections();
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  let total = 0;
  for (const [sectionId, score] of Object.entries(input.scores)) {
    const section = sectionById.get(sectionId);
    if (!section) throw new Error("Unknown rubric section");
    if (score < 0 || score > section.maxScore) {
      throw new Error(`الدرجة في "${section.labelAr}" يجب أن تكون بين 0 و ${section.maxScore}`);
    }
    total += score;
  }

  const { groupId, hospitalId } = await getStudentGroupHospital(input.studentId, input.dateISO);
  const existing = await getEvaluationForStudentDate(input.studentId, input.dateISO);

  if (existing?.locked) throw new Error("هذا التقييم مقفل ولا يمكن تعديله");

  // Upsert the evaluation row itself, then replace its scores wholesale
  // (delete + recreate) inside the same transaction — mirroring the old
  // db.ts's DELETE-then-INSERT of evaluation_scores exactly, just done
  // atomically instead of as two separate statements.
  const evaluationId: string = await prisma.$transaction(async (tx: any) => {
    const evaluation = await tx.evaluation.upsert({
      where: { studentId_dateISO: { studentId: input.studentId, dateISO: input.dateISO } },
      create: {
        studentId: input.studentId,
        evaluatorId: input.evaluatorId,
        groupId,
        hospitalId,
        dateISO: input.dateISO,
        attendance: input.attendance,
        notes: input.notes ?? null,
        feedback: input.feedback ?? null,
        total,
      },
      update: {
        evaluatorId: input.evaluatorId,
        groupId,
        hospitalId,
        attendance: input.attendance,
        notes: input.notes ?? null,
        feedback: input.feedback ?? null,
        total,
      },
    });

    await tx.evaluationScore.deleteMany({ where: { evaluationId: evaluation.id } });
    if (Object.keys(input.scores).length > 0) {
      await tx.evaluationScore.createMany({
        data: Object.entries(input.scores).map(([rubricSectionId, score]) => ({
          evaluationId: evaluation.id,
          rubricSectionId,
          score,
        })),
      });
    }

    return evaluation.id;
  });

  const result = (await getEvaluation(evaluationId))!;
  await recordAudit({
    actorId,
    entityType: "Evaluation",
    entityId: evaluationId,
    action: existing ? "update" : "create",
    before: existing,
    after: result,
  });

  await recomputeFlagsForStudent(input.studentId);

  return result;
}
