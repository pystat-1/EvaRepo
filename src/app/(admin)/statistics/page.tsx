import { getGroupStats, getHospitalStats, getOverallStats } from "@/lib/models/statistics";

export default async function StatisticsPage() {
  const [groupStats, hospitalStats, overall] = await Promise.all([
    getGroupStats(),
    getHospitalStats(),
    getOverallStats(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الإحصائيات</h1>
        <p className="text-slate-500 mt-1">
          إجمالي {overall.totalEvaluations} تقييمًا، بمتوسط {overall.averageTotal.toFixed(1)} من{" "}
          {overall.maxTotal}.
        </p>
      </div>

      <div>
        <h2 className="font-semibold mb-3">حسب المستشفى</h2>
        <div className="card p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>المستشفى</th>
                <th>عدد التقييمات</th>
                <th>المتوسط</th>
              </tr>
            </thead>
            <tbody>
              {hospitalStats.map((h) => (
                <tr key={h.hospitalId}>
                  <td>{h.hospitalName}</td>
                  <td>{h.evaluationCount}</td>
                  <td>{h.averageTotal.toFixed(1)}</td>
                </tr>
              ))}
              {hospitalStats.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-slate-400 py-6">
                    لا توجد بيانات بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="font-semibold mb-3">حسب المجموعة</h2>
        <div className="card p-0 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>المجموعة</th>
                <th>المستشفى</th>
                <th>عدد الطلاب</th>
                <th>عدد التقييمات</th>
                <th>المتوسط</th>
                <th>نسبة النجاح</th>
              </tr>
            </thead>
            <tbody>
              {groupStats.map((g) => (
                <tr key={g.groupId}>
                  <td>{g.groupName}</td>
                  <td>{g.hospitalName ?? "—"}</td>
                  <td>{g.studentCount}</td>
                  <td>{g.evaluationCount}</td>
                  <td>{g.averageTotal.toFixed(1)}</td>
                  <td>{(g.passRate * 100).toFixed(0)}%</td>
                </tr>
              ))}
              {groupStats.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 py-6">
                    لا توجد بيانات بعد
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
