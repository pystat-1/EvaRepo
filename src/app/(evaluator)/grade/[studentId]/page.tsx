import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getStudent } from "@/lib/models/students";
import { getScopedGroupIds } from "@/lib/models/evaluators";
import { listRubricSections, getMaxTotal } from "@/lib/models/rubric";
import { getEvaluationForStudentDate } from "@/lib/models/evaluations";
import { gradeStudentAction } from "@/lib/actions/grading";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function GradeStudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const session = await getSession();
  if (!session || session.role !== "EVALUATOR") redirect("/login");

  const student = await getStudent(studentId);
  if (!student) notFound();

  // Server-side scope re-check on render too, not just on save — an
  // evaluator should never even see the form for a student outside their
  // assignment (plan §2.4/§4).
  const scopedGroupIds = await getScopedGroupIds(session!.sub);
  if (!student.groupId || !scopedGroupIds.includes(student.groupId)) {
    return (
      <div className="card border-red-200 bg-red-50">
        <p className="text-sm text-red-700">هذا الطالب خارج نطاقك المخصص.</p>
      </div>
    );
  }

  const sections = await listRubricSections();
  const maxTotal = await getMaxTotal();
  const dateISO = todayISO();
  const existing = await getEvaluationForStudentDate(studentId, dateISO);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">
          {student.nameAr}
          {student.nameEn ? ` (${student.nameEn})` : ""}
        </h1>
        <p className="text-xs text-slate-500">
          {student.universityNumber} — تقييم يوم {dateISO}
          {existing ? " (تعديل تقييم محفوظ مسبقًا)" : ""}
        </p>
      </div>

      <form action={gradeStudentAction} className="flex flex-col gap-4">
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="dateISO" value={dateISO} />

        <div className="card">
          <label className="block text-sm font-medium mb-2">الحضور</label>
          <div className="flex gap-4 text-sm">
            {[
              { value: "present", label: "حاضر" },
              { value: "late", label: "متأخر" },
              { value: "absent", label: "غائب" },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="attendance"
                  value={opt.value}
                  defaultChecked={(existing?.attendance ?? "present") === opt.value}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="card flex flex-col gap-3">
          <div className="font-semibold text-sm">الدرجات (المجموع من {maxTotal})</div>
          {sections.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <label className="text-sm flex-1">
                {s.labelAr} <span className="text-slate-400">(من {s.maxScore})</span>
              </label>
              <input
                type="number"
                name={`score_${s.id}`}
                min={0}
                max={s.maxScore}
                step="0.5"
                required
                defaultValue={existing?.scores[s.id] ?? ""}
                className="input w-24"
              />
            </div>
          ))}
        </div>

        <div className="card flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" rows={2} className="input" defaultValue={existing?.notes ?? ""} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">التغذية الراجعة للطالب</label>
            <textarea
              name="feedback"
              rows={2}
              className="input"
              defaultValue={existing?.feedback ?? ""}
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary">
          حفظ التقييم
        </button>
      </form>
    </div>
  );
}
