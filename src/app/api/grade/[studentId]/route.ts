import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth";
import { getStudent } from "@/lib/models/students";
import { listRubricSections, getMaxTotal } from "@/lib/models/rubric";
import { getEvaluationForStudentDate } from "@/lib/models/evaluations";
import { getWorkDay, resolveGroupPlacement } from "@/lib/models/workDays";
import { todayISO } from "@/lib/date";
import { getAttendanceRecord } from "@/lib/models/attendance";

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

  // Same rule as a save (src/lib/evaluator/scope.ts): the schedule is the
  // default, but a day moved by a holiday is accepted near the rotation.
  const dateISO = todayISO();
  const placement = student.groupId ? await resolveGroupPlacement(evaluatorId, student.groupId, dateISO) : null;
  if (!student.groupId || !placement) {
    return NextResponse.json({ ok: false, reason: "out_of_scope" });
  }

  const sections = await listRubricSections();
  const maxTotal = await getMaxTotal();
  const [existing, record, workDay] = await Promise.all([
    getEvaluationForStudentDate(studentId, dateISO),
    getAttendanceRecord(studentId, dateISO),
    getWorkDay(student.groupId, dateISO),
  ]);

  return NextResponse.json({
    ok: true,
    dateISO,
    student: { nameAr: student.nameAr, nameEn: student.nameEn, universityNumber: student.universityNumber },
    groupId: student.groupId,
    hospitalName: placement.hospitalName,
    offSchedule: !placement.scheduled,
    dayValidated: !!workDay?.validatedAt,
    sections,
    maxTotal,
    existing: existing ? { ...existing, dailyNote: record ? record.dailyNote : undefined } : null,
    record: record ? { attendance: record.status, dailyNote: record.dailyNote } : null,
  });
}
