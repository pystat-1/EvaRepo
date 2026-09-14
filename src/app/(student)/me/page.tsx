import { getSession } from "@/lib/auth";
import { getStudent } from "@/lib/models/students";
import { listEvaluationsForStudent } from "@/lib/models/evaluations";
import { listFlagsForStudent } from "@/lib/models/flags";
import { listRubricSections, getMaxTotal } from "@/lib/models/rubric";

const ATTENDANCE_LABELS: Record<string, string> = {
  present: "حاضر",
  late: "متأخر",
  absent: "غائب",
};

export default async function MePage() {
  const session = await getSession();
  const student = await getStudent(session!.studentId!);
  if (!student) {
    return <div className="card text-center text-slate-400 py-6">تعذر العثور على بيانات الطالب</div>;
  }

  const evaluations = await listEvaluationsForStudent(student.id, 30);
  const flags = await listFlagsForStudent(student.id);
  const maxTotal = await getMaxTotal();
  const sections = await listRubricSections();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">
          {student.nameAr}
          {student.nameEn ? ` (${student.nameEn})` : ""}
        </h1>
        <p className="text-sm text-slate-500 mt-1">{student.universityNumber}</p>
      </div>

      {flags.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-sm mb-2">تنبيهات</h2>
          <ul className="text-sm flex flex-col gap-1">
            {flags.map((f) => (
              <li key={f.id}>{f.msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold text-sm">آخر التقييمات</h2>
        {evaluations.map((e) => (
          <div key={e.id} className="card">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{e.dateISO}</span>
              <span className="badge badge-green">
                {e.total}/{maxTotal}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              الحضور: {ATTENDANCE_LABELS[e.attendance] ?? e.attendance}
            </div>
            {e.feedback && <div className="text-sm mt-2">{e.feedback}</div>}
            <details className="mt-2 text-xs text-slate-500">
              <summary className="cursor-pointer">تفاصيل الدرجات</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {sections.map((s) => (
                  <li key={s.id}>
                    {s.labelAr}: {e.scores[s.id] ?? 0} / {s.maxScore}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ))}
        {evaluations.length === 0 && (
          <div className="card text-center text-slate-400 py-6 text-sm">لا توجد تقييمات بعد</div>
        )}
      </div>
    </div>
  );
}
