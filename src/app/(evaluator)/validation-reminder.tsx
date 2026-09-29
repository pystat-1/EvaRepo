import Link from "next/link";
import { addDaysISO, todayISO } from "@/lib/date";
import { getEvaluatorSchedule } from "@/lib/models/evaluators";
import { listPendingWorkDays } from "@/lib/models/workDays";

// Reminder shown on every evaluator page while a worked day has not been
// validated (اعتماد): earlier days in red (the admin can't see those grades
// yet), today's as a gentle nudge.
export async function ValidationReminder({ accountId }: { accountId: string }) {
  const groupIds = Array.from(new Set((await getEvaluatorSchedule(accountId)).map((s) => s.groupId)));
  if (groupIds.length === 0) return null;
  const pending = await listPendingWorkDays(groupIds);
  if (pending.length === 0) return null;

  const today = todayISO();
  const earlier = pending.filter((d) => d.dateISO < today);
  const todays = pending.filter((d) => d.dateISO === today);
  const urgent = earlier.length > 0;

  return (
    <div
      role="status"
      className="rounded-lg px-3 py-2.5 text-sm flex flex-col gap-1.5"
      style={
        urgent
          ? { color: "var(--red-700)", background: "var(--red-100)" }
          : { color: "var(--amber-700)", background: "var(--amber-100)" }
      }
    >
      <div className="font-semibold">
        {urgent
          ? `⚠ لديك ${earlier.length === 1 ? "يوم" : `${earlier.length} أيام`} لم تُعتمد درجاته بعد — لن تصل الدرجات للإدارة قبل الاعتماد`
          : "تذكير: لم تعتمد درجات اليوم بعد"}
      </div>
      <ul className="flex flex-col gap-1">
        {[...earlier, ...todays].map((d) => {
          const overdue = d.dateISO < addDaysISO(today, -7);
          return (
            <li key={`${d.groupId}:${d.dateISO}`} className="flex flex-wrap items-center gap-x-2">
              <span>
                {d.groupName} · {d.dateISO === today ? "اليوم" : d.dateISO}
                {!d.scheduled ? " (خارج الجدول)" : ""} · مُقيَّم {d.graded}/{d.students}
                {overdue ? " · تجاوز 7 أيام" : ""}
              </span>
              <Link
                href={`/day-grades?group=${d.groupId}${d.dateISO === today ? "" : `&date=${d.dateISO}`}`}
                className="underline font-semibold"
              >
                {overdue ? "اعتماد" : "إكمال واعتماد"}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
