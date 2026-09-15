import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { getStudent } from "@/lib/models/students";
import { getScopedGroupIds, canEvaluatorGradeGroupAtHospital } from "@/lib/models/evaluators";
import { listRubricSections, getMaxTotal } from "@/lib/models/rubric";
import { getEvaluationForStudentDate } from "@/lib/models/evaluations";
import { getScheduledRotationForDate } from "@/lib/models/rotationBlocks";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// JSON twin of the grading page's server-side data fetch (same checks, same
// order, as src/app/(evaluator)/grade/[studentId]/page.tsx and
// gradeStudentAction's assertEvaluatorCanGrade). Exists so the grading page
// can be a Client Component that tries the network first and falls back to
// the Phase 4b IndexedDB cache when offline — a Server Component's fetch has
// no such fallback (it simply fails to render offline).
export async function GET(_req: Request, { params }: { params: Promise<{ studentId: string }> }) {
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

  const { studentId } = await params;
  const student = await getStudent(studentId);
  if (!student) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const scopedGroupIds = await getScopedGroupIds(evaluatorId);
  if (!student.groupId || !scopedGroupIds.includes(student.groupId)) {
    return NextResponse.json({ ok: false, reason: "out_of_scope" });
  }

  const dateISO = todayISO();
  const scheduled = await getScheduledRotationForDate(student.groupId, dateISO);
  if (!scheduled) {
    return NextResponse.json({ ok: false, reason: "not_scheduled" });
  }
  const covered = await canEvaluatorGradeGroupAtHospital(evaluatorId, student.groupId, scheduled.hospitalId);
  if (!covered) {
    return NextResponse.json({ ok: false, reason: "not_covered", hospitalName: scheduled.hospitalName });
  }

  const sections = await listRubricSections();
  const maxTotal = await getMaxTotal();
  const existing = await getEvaluationForStudentDate(studentId, dateISO);

  return NextResponse.json({
    ok: true,
    dateISO,
    student: { nameAr: student.nameAr, nameEn: student.nameEn, universityNumber: student.universityNumber },
    hospitalName: scheduled.hospitalName,
    sections,
    maxTotal,
    existing: existing ?? null,
  });
}
