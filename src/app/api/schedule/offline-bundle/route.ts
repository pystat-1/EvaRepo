import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { getEvaluatorSchedule } from "@/lib/models/evaluators";
import { listActiveStudentsInGroup, StudentBasic } from "@/lib/models/students";
import { listRubricSections } from "@/lib/models/rubric";
import { getEvaluationsForStudentsOnDate, EvaluationWithScores } from "@/lib/models/evaluations";
import { todayISO } from "@/lib/date";

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
  // One batched query for the whole roster's evaluations, instead of one
  // request per student (previously N+1 over the network on every import).
  const evalRows = await getEvaluationsForStudentsOnDate(allStudentIds, dateISO);
  const evaluations: Record<string, EvaluationWithScores> = Object.fromEntries(
    evalRows.map((ev) => [`${ev.studentId}:${dateISO}`, ev] as [string, EvaluationWithScores])
  );

  const rubricSections = await listRubricSections();

  return NextResponse.json({ dateISO, schedule, rosters, rubricSections, evaluations });
}
