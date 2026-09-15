import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { getEvaluatorSchedule } from "@/lib/models/evaluators";
import { listActiveStudentsInGroup, StudentBasic } from "@/lib/models/students";
import { listRubricSections } from "@/lib/models/rubric";
import { getEvaluationForStudentDate, EvaluationWithScores } from "@/lib/models/evaluations";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Bundles everything an evaluator needs to grade offline — their schedule,
// each non-past stint's roster, the active rubric, and today's already-saved
// evaluations for context — into one response the client caches into
// IndexedDB in a single "import" action (Goal 4 Phase 4b).
export async function GET() {
  let evaluatorId: string;
  try {
    const session = await requireRole("EVALUATOR");
    evaluatorId = session.sub;
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.code }, { status: err.code === "unauthenticated" ? 401 : 403 });
    }
    throw err;
  }

  const dateISO = todayISO();
  const schedule = await getEvaluatorSchedule(evaluatorId);
  const activeStints = schedule.filter((s) => s.status !== "past");

  const rosterEntries = await Promise.all(
    activeStints.map(async (s) => [s.groupId, await listActiveStudentsInGroup(s.groupId)] as const)
  );
  const rosters: Record<string, StudentBasic[]> = Object.fromEntries(rosterEntries);

  const allStudentIds = Array.from(new Set(rosterEntries.flatMap(([, roster]) => roster.map((st) => st.id))));
  const evaluationEntries = await Promise.all(
    allStudentIds.map(async (studentId) => {
      const ev = await getEvaluationForStudentDate(studentId, dateISO);
      return ev ? ([`${studentId}:${dateISO}`, ev] as [string, EvaluationWithScores]) : null;
    })
  );
  const evaluations: Record<string, EvaluationWithScores> = Object.fromEntries(
    evaluationEntries.filter((e): e is [string, EvaluationWithScores] => e !== null)
  );

  const rubricSections = await listRubricSections();

  return NextResponse.json({ dateISO, schedule, rosters, rubricSections, evaluations });
}
