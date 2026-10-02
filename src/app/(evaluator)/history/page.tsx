import { getSession } from "@/lib/auth";
import { listGradingCenter } from "@/lib/models/gradingCenter";

const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
const ATTENDANCE_BADGE: Record<string, string> = { present: "badge-green", late: "badge-amber", absent: "badge-red" };

// The evaluator's own grading history — every evaluation they have saved,
// across all their past and current hospital stints, grouped by hospital.
// Read straight from the evaluations linked to the logged-in account
// (evaluatorId), so it always reflects what's on the main board.
export default async function EvaluatorHistoryPage() {
  const session = await getSession();
  const { rows, maxTotal, total } = await listGradingCenter(
    { evaluatorId: session!.sub },
    { pageSize: 500 }
  );

  // Group by hospital, preserving the date-desc order the query returns.
  const byHospital = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.hospitalName ?? "— بدون مستشفى —";
    if (!byHospital.has(key)) byHospital.set(key, []);
    byHospital.get(key)!.push(r);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">التقييمات السابقة</h1>
        <p className="text-sm text-slate-500 mt-1">
          كل تقييماتك المحفوظة عبر مستشفياتك — مرتبطة بحسابك ({total} تقييم).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card text-center text-slate-400 py-8 text-sm">
          لا توجد تقييمات محفوظة بعد. ستظهر هنا بمجرد أن تبدأ بالتقييم.
        </div>
      ) : (
        Array.from(byHospital.entries()).map(([hospital, list]) => (
          <section key={hospital} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span>🏥</span>
              <h2 className="font-semibold">{hospital}</h2>
              <span className="text-xs text-slate-400">({list.length})</span>
            </div>

            <div className="flex flex-col gap-2">
              {list.map((r) => (
                <div key={r.id} className="card flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.studentName}</div>
                      <div className="text-xs text-slate-400">
                        {r.universityNumber} · {r.dateISO}
                        {r.groupName ? ` · ${r.groupName}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`badge ${ATTENDANCE_BADGE[r.attendance]}`}>
                        {ATTENDANCE_LABEL[r.attendance]}
                      </span>
                      <span className="text-sm font-bold whitespace-nowrap">
                        {r.total} / {maxTotal}
                      </span>
                    </div>
                  </div>

                  {r.attendance !== "absent" && r.scores.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.scores.map((s) => (
                        <span key={s.sectionId} className="badge badge-gray whitespace-nowrap" title={s.labelAr}>
                          {s.labelAr}: {s.score}/{s.maxScore}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={r.dailyNoteSubmitted ? "text-green-700" : "text-slate-400"}>
                      {r.dailyNoteSubmitted ? "📝 سلّم الملاحظة اليومية" : "📝 لم يسلّم الملاحظة اليومية"}
                    </span>
                    {r.locked && <span className="badge badge-gray">مقفل</span>}
                  </div>

                  {(r.notes || r.feedback) && (
                    <div className="text-xs text-slate-500 border-t border-slate-100 pt-1.5">
                      {r.notes && <div>ملاحظات: {r.notes}</div>}
                      {r.feedback && <div>التغذية الراجعة: {r.feedback}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
