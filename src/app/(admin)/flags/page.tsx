import { listAllFlags } from "@/lib/models/flags";
import { markFlagSeenAction } from "@/lib/actions/flags";

const RULE_LABELS: Record<string, string> = {
  low_score: "درجات منخفضة",
  attendance: "غياب متكرر",
  declining_trend: "اتجاه تنازلي",
};

export default async function FlagsPage() {
  const flags = await listAllFlags();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">التنبيهات</h1>
        <p className="text-slate-500 mt-1">
          تُحسب تلقائيًا بعد كل تقييم: درجات منخفضة متكررة، غياب متكرر، أو اتجاه تنازلي في الدرجات.
        </p>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>الطالب</th>
              <th>النوع</th>
              <th>التفاصيل</th>
              <th>آخر تحديث</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id} className={f.seen ? "" : "bg-amber-50"}>
                <td>
                  {f.studentNameAr} <span className="text-slate-400 text-xs">({f.universityNumber})</span>
                </td>
                <td>
                  <span className={`badge ${f.severity === "danger" ? "badge-gray" : "badge-green"}`}>
                    {RULE_LABELS[f.ruleId] ?? f.ruleId}
                  </span>
                </td>
                <td className="text-sm">{f.msg}</td>
                <td className="text-xs text-slate-500">{f.dateISO}</td>
                <td>
                  {!f.seen && (
                    <form action={markFlagSeenAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                        تمت المراجعة
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {flags.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  لا توجد تنبيهات حاليًا
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
