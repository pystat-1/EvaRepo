import { addDaysISO, todayISO } from "@/lib/date";
import { listPendingWorkDays, listRecentValidatedWorkDays } from "@/lib/models/workDays";
import { reopenWorkDayAction } from "@/lib/actions/workDays";

// اعتماد الأيام: evaluator days whose grades are not validated yet (so they
// are not in the grading center, statistics or flags yet), and recently
// validated days, which the admin can reopen for correction.
export default async function ValidationsPage() {
  const [pending, validated] = await Promise.all([listPendingWorkDays(), listRecentValidatedWorkDays(40)]);
  const today = todayISO();
  const overdueFrom = addDaysISO(today, -1);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">اعتماد الأيام</h1>
        <p className="mt-1" style={{ color: "var(--ink-muted)" }}>
          درجات يوم العمل لا تظهر في مركز التقييم والإحصائيات والتنبيهات إلا بعد أن يعتمدها المقيّم.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">بانتظار الاعتماد ({pending.length})</h2>
        <div className="card p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المجموعة</th>
                <th>المستشفى</th>
                <th>مُقيَّم</th>
                <th>النوع</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((d) => (
                <tr key={`${d.groupId}:${d.dateISO}`}>
                  <td className="tabular-nums">{d.dateISO}</td>
                  <td>{d.groupName}</td>
                  <td>{d.hospitalName ?? "—"}</td>
                  <td className="tabular-nums">
                    {d.graded}/{d.students}
                  </td>
                  <td>
                    <span className={`badge ${d.scheduled ? "badge-gray" : "badge-amber"}`}>
                      {d.scheduled ? "حسب الجدول" : "خارج الجدول"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${d.dateISO <= overdueFrom ? "badge-red" : "badge-gray"}`}>
                      {d.dateISO === today ? "اليوم" : "متأخر"}
                    </span>
                  </td>
                </tr>
              ))}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-6" style={{ color: "var(--ink-muted)" }}>
                    لا توجد أيام بانتظار الاعتماد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">أيام معتمدة مؤخرًا</h2>
        <div className="card p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المجموعة</th>
                <th>النوع</th>
                <th>وقت الاعتماد</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {validated.map((d) => (
                <tr key={`${d.groupId}:${d.dateISO}`}>
                  <td className="tabular-nums">{d.dateISO}</td>
                  <td>{d.groupName}</td>
                  <td>
                    <span className={`badge ${d.scheduled ? "badge-gray" : "badge-amber"}`}>
                      {d.scheduled ? "حسب الجدول" : "خارج الجدول"}
                    </span>
                  </td>
                  <td className="tabular-nums">
                    {new Date(d.validatedAt).toLocaleString("ar-IQ-u-nu-latn", { timeZone: "Asia/Baghdad" })}
                  </td>
                  <td>
                    <form action={reopenWorkDayAction}>
                      <input type="hidden" name="groupId" value={d.groupId} />
                      <input type="hidden" name="dateISO" value={d.dateISO} />
                      <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                        إعادة فتح للتعديل
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {validated.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-6" style={{ color: "var(--ink-muted)" }}>
                    لا توجد أيام معتمدة بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
