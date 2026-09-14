import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getScopedStudents } from "@/lib/models/evaluators";
import { getEvaluationForStudentDate } from "@/lib/models/evaluations";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function MyStudentsPage() {
  const session = await getSession();
  const students = await getScopedStudents(session!.sub);
  const dateISO = todayISO();

  const hospitalNames = Array.from(new Set(students.map((s) => s.hospitalName)));
  const gradedByStudentId = new Map(
    await Promise.all(
      students.map(async (s) => [s.id, await getEvaluationForStudentDate(s.id, dateISO)] as const)
    )
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">طلابي</h1>
        <p className="text-sm text-slate-500 mt-1">
          {hospitalNames.length > 0
            ? `مرتبط بـ: ${hospitalNames.join("، ")} — تقييم اليوم (${dateISO})`
            : "لم يتم تخصيصك لأي مستشفى بعد — تواصل مع المدير."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {students.map((s) => {
          const graded = gradedByStudentId.get(s.id);
          return (
            <Link
              key={s.id}
              href={`/grade/${s.id}`}
              className="card flex items-center justify-between hover:shadow-sm transition-shadow"
            >
              <div>
                <div className="font-medium">
                  {s.nameAr}
                  {s.nameEn ? ` (${s.nameEn})` : ""}
                </div>
                <div className="text-xs text-slate-500">
                  {s.universityNumber} — {s.groupName}
                  {s.hospitalName ? ` — ${s.hospitalName}` : ""}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {!s.scheduledToday && (
                  <span className="badge badge-gray">ليس يوم حضور اليوم</span>
                )}
                <span className={`badge ${graded ? "badge-green" : "badge-gray"}`}>
                  {graded ? `تم اليوم (${graded.total})` : "لم يُقيَّم اليوم"}
                </span>
              </div>
            </Link>
          );
        })}
        {students.length === 0 && (
          <div className="card text-center text-slate-400 py-6 text-sm">
            لا يوجد طلاب ضمن نطاقك الحالي
          </div>
        )}
      </div>
    </div>
  );
}
