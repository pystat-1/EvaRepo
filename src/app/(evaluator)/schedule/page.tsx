import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getEvaluatorSchedule } from "@/lib/models/evaluators";
import { listActiveStudentsInGroup } from "@/lib/models/students";
import { ImportOfflineButton } from "./import-offline-button";

const STATUS_LABEL: Record<string, string> = { past: "منتهية", current: "حالية", future: "قادمة" };
const STATUS_BADGE: Record<string, string> = {
  past: "badge-gray",
  current: "badge-green",
  future: "badge-gray",
};

export default async function EvaluatorSchedulePage() {
  const session = await getSession();
  const stints = await getEvaluatorSchedule(session!.sub);

  const rosters = await Promise.all(
    stints.map((s) => (s.status !== "past" ? listActiveStudentsInGroup(s.groupId) : Promise.resolve([])))
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">جدولي</h1>
        <p className="text-sm text-slate-500 mt-1">
          كل فترات دورانك المخصصة — الماضية والحالية والقادمة. افتح أي مجموعة لاستيراد
          قائمة طلابها والبدء بالتقييم.
        </p>
      </div>

      <ImportOfflineButton />

      <div className="flex flex-col gap-3">
        {stints.map((s, i) => (
          <div key={s.blockId} className="card">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-medium">
                  {s.groupName} — {s.hospitalName}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {s.startDate} إلى {s.endDate}
                  {s.daysOfWeek ? ` · ${s.daysOfWeek}` : ""} · {s.studentCount} طالب
                </div>
              </div>
              <span className={`badge ${STATUS_BADGE[s.status]}`}>{STATUS_LABEL[s.status]}</span>
            </div>

            {s.status !== "past" && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate-600 select-none">
                  استيراد قائمة الطلاب ({rosters[i].length})
                </summary>
                <div className="flex flex-col gap-1.5 mt-2">
                  {rosters[i].map((st) => (
                    <Link
                      key={st.id}
                      href={`/grade/${st.id}`}
                      className="flex items-center justify-between text-sm px-3 py-2 rounded-md bg-slate-50 hover:bg-slate-100"
                    >
                      <span>
                        {st.nameAr}
                        {st.nameEn ? ` (${st.nameEn})` : ""}
                        <span className="text-slate-400"> — {st.universityNumber}</span>
                      </span>
                      {s.status === "current" ? (
                        <span className="text-xs text-slate-500">قيّم الآن ←</span>
                      ) : (
                        <span className="text-xs text-slate-400">لم تبدأ بعد</span>
                      )}
                    </Link>
                  ))}
                  {rosters[i].length === 0 && (
                    <div className="text-xs text-slate-400 px-3 py-2">لا يوجد طلاب في هذه المجموعة بعد</div>
                  )}
                </div>
              </details>
            )}
          </div>
        ))}
        {stints.length === 0 && (
          <div className="card text-center text-slate-400 py-6 text-sm">
            لا يوجد جدول دوران مخصص لك بعد — تواصل مع المدير.
          </div>
        )}
      </div>
    </div>
  );
}
