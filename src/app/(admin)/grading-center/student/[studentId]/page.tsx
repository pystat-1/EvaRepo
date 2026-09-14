import { notFound } from "next/navigation";
import { getStudentGradingSummary } from "@/lib/models/gradingCenter";

const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
const ATTENDANCE_BADGE: Record<string, string> = {
  present: "badge-green",
  late: "badge-gray",
  absent: "badge-gray",
};

export default async function StudentGradingSummaryPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const summary = await getStudentGradingSummary(studentId);
  if (!summary) notFound();

  const { student, maxTotal, overall, stints } = summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            {student.name}
            <span className="text-slate-400 font-normal text-base"> — {student.universityNumber}</span>
          </h1>
          <p className="text-slate-500 mt-1">
            {[student.code, student.courseLabel, student.studyTypeName, student.groupName]
              .filter(Boolean)
              .join(" · ") || "بدون تصنيف"}
          </p>
        </div>
        <a href="/grading-center" className="btn btn-secondary">
          ← العودة إلى مركز التقييم
        </a>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="عدد التقييمات" value={overall.evaluationCount} />
        <SummaryCard label="متوسط الدرجة" value={`${overall.averageTotal.toFixed(1)} / ${maxTotal}`} />
        <SummaryCard label="حضور" value={overall.attendance.present} />
        <SummaryCard
          label="تأخر / غياب"
          value={`${overall.attendance.late} / ${overall.attendance.absent}`}
        />
      </div>

      <div>
        <h2 className="font-semibold mb-3">التقييم حسب فترة الدوران</h2>
        <p className="text-sm text-slate-500 mb-4">
          كل قسم أدناه فترة دوران واحدة على مستشفى واحد (بترتيب زمني) — إذا عاد الطالب لنفس
          المستشفى لاحقًا، تظهر كفترة منفصلة، وليست مدمجة مع الأولى.
        </p>

        {stints.length === 0 ? (
          <div className="card text-center text-slate-400 py-8">
            لا يوجد جدول دوران أو تقييمات لهذا الطالب بعد
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {stints.map((stint, i) => (
              <div key={stint.blockId ?? `unscheduled-${i}`} className="card">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <div className="font-semibold">{stint.hospitalName}</div>
                    <div className="text-xs text-slate-500">
                      {stint.startDate && stint.endDate
                        ? `${stint.startDate} إلى ${stint.endDate}${stint.daysOfWeek ? ` · ${stint.daysOfWeek}` : ""}`
                        : "خارج الجدول المُعتمد"}
                    </div>
                  </div>
                  <div className="text-sm text-slate-500">
                    {stint.evaluations.length > 0 ? (
                      <>
                        {stint.evaluations.length} تقييم — متوسط{" "}
                        <span className="font-semibold text-slate-700">
                          {stint.averageTotal.toFixed(1)} / {maxTotal}
                        </span>
                      </>
                    ) : (
                      <span className="badge badge-gray">لم يُقيَّم بعد</span>
                    )}
                  </div>
                </div>

                {stint.evaluations.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>المقيّم</th>
                          <th>الحضور</th>
                          <th>الدرجة</th>
                          <th>تفاصيل المعايير</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stint.evaluations
                          .slice()
                          .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
                          .map((e) => (
                            <tr key={e.id}>
                              <td>{e.dateISO}</td>
                              <td>{e.evaluatorName}</td>
                              <td>
                                <span className={`badge ${ATTENDANCE_BADGE[e.attendance]}`}>
                                  {ATTENDANCE_LABEL[e.attendance]}
                                </span>
                              </td>
                              <td className="font-semibold whitespace-nowrap">
                                {e.total} / {maxTotal}
                              </td>
                              <td className="min-w-[220px]">
                                <div className="flex flex-wrap gap-1">
                                  {e.scores.map((s) => (
                                    <span key={s.sectionId} title={s.labelAr} className="badge badge-gray whitespace-nowrap">
                                      {s.labelAr}: {s.score}/{s.maxScore}
                                    </span>
                                  ))}
                                </div>
                                {(e.notes || e.feedback) && (
                                  <div
                                    className="text-xs text-slate-400 mt-1 max-w-[280px] truncate"
                                    title={[e.notes, e.feedback].filter(Boolean).join(" — ")}
                                  >
                                    {[e.notes, e.feedback].filter(Boolean).join(" — ")}
                                  </div>
                                )}
                              </td>
                              <td>
                                {e.locked ? (
                                  <span className="badge badge-gray">مقفل</span>
                                ) : (
                                  <span className="badge badge-green">مفتوح</span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
