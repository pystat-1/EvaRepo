import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getEvaluatorScheduleCalendar, getScopedStudents } from "@/lib/models/evaluators";
import { getEvaluatedStudentIdsForDate } from "@/lib/models/evaluations";
import { ImportOfflineButton } from "./import-offline-button";

const STATUS_LABEL: Record<string, string> = { past: "منتهية", current: "حالية", future: "قادمة" };

export default async function EvaluatorSchedulePage() {
  const session = await getSession();
  const [calendar, todayStudents] = await Promise.all([
    getEvaluatorScheduleCalendar(session!.sub),
    getScopedStudents(session!.sub),
  ]);

  const todayISO = calendar.today;
  // Today's roster = scoped students whose group is actually meeting today.
  const todayRoster = todayStudents.filter((s) => s.scheduledToday);
  const gradedIds = await getEvaluatedStudentIdsForDate(
    todayRoster.map((s) => s.id),
    todayISO
  );
  const firstPendingId = todayRoster.find((s) => !gradedIds.has(s.id))?.id;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">جدولي</h1>
        <p className="text-sm text-slate-500 mt-1">
          كامل جدول دورانك عبر مستشفياتك — لكل مجموعة أسابيعها وأيامها بالتواريخ. اضغط على يوم
          اليوم لتحميل مجموعته والبدء بالتقييم مباشرة.
        </p>
      </div>

      <ImportOfflineButton />

      {calendar.hospitals.length === 0 ? (
        <div className="card text-center text-slate-400 py-6 text-sm">
          لا يوجد جدول دوران مخصص لك بعد — تواصل مع المدير.
        </div>
      ) : (
        calendar.hospitals.map((hospital) => (
          <section key={hospital.hospitalId} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🏥</span>
              <h2 className="font-bold">{hospital.hospitalName}</h2>
            </div>

            {hospital.stints.map((stint) => (
              <div key={stint.blockId} className="card flex flex-col gap-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="font-medium flex items-center gap-2">
                    {stint.groupName}
                    {stint.shiftLabel && <span className="badge badge-gray">{stint.shiftLabel}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{stint.studentCount} طالب</span>
                    <span
                      className={`badge ${stint.status === "current" ? "badge-green" : "badge-gray"}`}
                    >
                      {STATUS_LABEL[stint.status]}
                    </span>
                  </div>
                </div>

                {stint.weeks.map((week) => (
                  <div key={week.weekIndex} className="flex flex-col gap-1.5">
                    <div className="text-xs font-semibold text-slate-500">الأسبوع {week.weekIndex}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {week.days.map((day) =>
                        day.status === "today" ? (
                          <TodayCard
                            key={day.date}
                            date={day.date}
                            weekdayAr={day.weekdayAr}
                            groupName={stint.groupName}
                            roster={todayRoster}
                            gradedIds={gradedIds}
                            firstPendingId={firstPendingId}
                          />
                        ) : (
                          <DayCell key={day.date} day={day} />
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function DayCell({ day }: { day: { date: string; weekdayAr: string; status: "past" | "today" | "future" } }) {
  const dayNum = day.date.slice(8);
  const monthNum = day.date.slice(5, 7);
  const past = day.status === "past";
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${past ? "bg-slate-50 border-slate-200" : "border-dashed border-slate-300"}`}
    >
      <div className={`text-sm ${past ? "text-slate-500" : "text-slate-600"}`}>
        {day.weekdayAr} {dayNum}/{monthNum}
      </div>
      <div className={`text-xs ${past ? "text-green-600" : "text-slate-400"}`}>
        {past ? "منتهٍ" : "قادم"}
      </div>
    </div>
  );
}

function TodayCard({
  date,
  weekdayAr,
  groupName,
  roster,
  gradedIds,
  firstPendingId,
}: {
  date: string;
  weekdayAr: string;
  groupName: string;
  roster: { id: string; nameAr: string; universityNumber: string }[];
  gradedIds: Set<string>;
  firstPendingId: string | undefined;
}) {
  const dayNum = date.slice(8);
  const monthNum = date.slice(5, 7);
  const gradedCount = roster.filter((s) => gradedIds.has(s.id)).length;

  return (
    <div className="col-span-2 rounded-xl border-2 p-3 flex flex-col gap-3" style={{ borderColor: "#2563eb" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "#eff6ff", color: "#1d4ed8" }}
          >
            اليوم
          </span>
          <div>
            <div className="font-semibold text-sm">
              {weekdayAr} {dayNum}/{monthNum}
            </div>
            <div className="text-xs text-slate-500">
              {groupName} · {gradedCount}/{roster.length} مُقيَّم
            </div>
          </div>
        </div>
      </div>

      {roster.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-2">لا يوجد طلاب مجدولون اليوم</div>
      ) : (
        <div className="flex flex-col divide-y divide-slate-100">
          {roster.slice(0, 6).map((s) => {
            const graded = gradedIds.has(s.id);
            return (
              <Link
                key={s.id}
                href={`/grade/${s.id}`}
                className="flex items-center justify-between py-1.5 text-sm hover:bg-slate-50 -mx-1 px-1 rounded"
              >
                <span className="truncate">{s.nameAr}</span>
                <span className={`badge ${graded ? "badge-green" : "badge-gray"}`}>
                  {graded ? "مُقيَّم" : "بانتظار"}
                </span>
              </Link>
            );
          })}
          {roster.length > 6 && (
            <div className="text-xs text-slate-400 pt-1.5 text-center">و{roster.length - 6} طالب آخرين</div>
          )}
        </div>
      )}

      {firstPendingId && (
        <Link href={`/grade/${firstPendingId}`} className="btn btn-primary w-full justify-center text-sm">
          ابدأ تقييم اليوم ←
        </Link>
      )}
    </div>
  );
}
