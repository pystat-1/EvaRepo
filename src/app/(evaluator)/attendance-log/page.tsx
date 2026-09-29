import Link from "next/link";
import { getSession } from "@/lib/auth";
import { todayISO, formatTimeBaghdad } from "@/lib/date";
import { getEvaluatorSchedule } from "@/lib/models/evaluators";
import { getAttendanceLog, getScheduledGroupsForDate, AttendanceLogCell } from "@/lib/models/attendance";

const STATUS_VIEW: Record<string, { mark: string; label: string; color: string; bg: string }> = {
  present: { mark: "✓", label: "حاضر", color: "var(--green-700)", bg: "var(--green-100)" },
  late: { mark: "م", label: "متأخر", color: "var(--amber-700)", bg: "var(--amber-100)" },
  absent: { mark: "✗", label: "غائب", color: "var(--red-700)", bg: "var(--red-100)" },
};

// سجل الحضور: every meeting day so far for one of this evaluator's groups,
// student by student, with when attendance was marked and whether the
// daily note came in.
export default async function AttendanceLogPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const session = await getSession();
  const dateISO = todayISO();
  const { group: requested } = await searchParams;

  const [stints, todayGroups] = await Promise.all([
    getEvaluatorSchedule(session!.sub),
    getScheduledGroupsForDate(session!.sub, dateISO),
  ]);
  // Groups that have started (a future group has nothing to log yet),
  // most recent first.
  const started = stints.filter((s) => s.startDate <= dateISO);
  const groupOptions: Array<{ groupId: string; label: string }> = [];
  for (const s of [...started].reverse()) {
    if (groupOptions.some((g) => g.groupId === s.groupId)) continue;
    groupOptions.push({ groupId: s.groupId, label: `${s.groupName} · ${s.hospitalName}` });
  }

  if (groupOptions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">سجل الحضور</h1>
        <div className="card text-center py-8 text-sm" style={{ color: "var(--ink-muted)" }}>
          لا توجد مجموعات بدأت دورانها معك بعد.
        </div>
      </div>
    );
  }

  const selectedId =
    groupOptions.find((g) => g.groupId === requested)?.groupId ??
    todayGroups.find((g) => groupOptions.some((o) => o.groupId === g.groupId))?.groupId ??
    groupOptions[0].groupId;
  const log = await getAttendanceLog(session!.sub, selectedId, dateISO);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">سجل الحضور</h1>
        <p className="text-sm mt-1" style={{ color: "var(--ink-muted)" }}>
          أيام الدوران حتى اليوم ({dateISO}). اضغط على اسم مجموعة للتبديل.
        </p>
      </div>

      {groupOptions.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" aria-label="المجموعات">
          {groupOptions.map((g) => {
            const on = g.groupId === selectedId;
            return (
              <Link
                key={g.groupId}
                href={`/attendance-log?group=${g.groupId}`}
                aria-current={on ? "page" : undefined}
                className="shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap"
                style={
                  on
                    ? { background: "var(--brand-dark)", borderColor: "var(--brand-dark)", color: "#fff" }
                    : { borderColor: "var(--border-strong)", color: "var(--ink)" }
                }
              >
                {g.label}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="flex flex-wrap gap-3 text-xs" style={{ color: "var(--ink-muted)" }}>
        {Object.values(STATUS_VIEW).map((v) => (
          <span key={v.label} className="flex items-center gap-1">
            <span className="inline-flex w-5 h-5 items-center justify-center rounded font-bold" style={{ color: v.color, background: v.bg }}>
              {v.mark}
            </span>
            {v.label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--green-700)" }} />
          سلّم الملاحظة اليومية
        </span>
      </div>

      {!log || log.dates.length === 0 ? (
        <div className="card text-center py-8 text-sm" style={{ color: "var(--ink-muted)" }}>
          لا توجد أيام دوران لهذه المجموعة حتى اليوم.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th className="sticky right-0 z-10" style={{ background: "var(--surface-raised)" }}>
                  الطالب
                </th>
                {log.dates.map((d) => (
                  <th key={d} className="text-center tabular-nums whitespace-nowrap" title={d}>
                    {d.slice(8)}/{d.slice(5, 7)}
                  </th>
                ))}
                <th className="text-center">حضور</th>
                <th className="text-center">غياب</th>
                <th className="text-center">ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {log.students.map((s) => (
                <tr key={s.id}>
                  <td className="sticky right-0 z-10 whitespace-nowrap font-medium" style={{ background: "var(--surface-raised)" }}>
                    {s.nameAr}
                  </td>
                  {log.dates.map((d) => (
                    <td key={d} className="text-center">
                      <LogCell cell={s.cells[d]} date={d} />
                    </td>
                  ))}
                  <td className="text-center tabular-nums">
                    {s.present + s.late}
                    {s.late > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--amber-700)" }}>
                        {" "}
                        ({s.late} م)
                      </span>
                    )}
                  </td>
                  <td
                    className="text-center tabular-nums font-semibold"
                    style={{ color: s.absent > 0 ? "var(--red-700)" : "var(--ink-muted)" }}
                  >
                    {s.absent}
                  </td>
                  <td className="text-center tabular-nums">
                    {s.notesDelivered}/{log.dates.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LogCell({ cell, date }: { cell: AttendanceLogCell | undefined; date: string }) {
  if (!cell || !cell.status) {
    return <span style={{ color: "var(--border-strong)" }}>—</span>;
  }
  const v = STATUS_VIEW[cell.status];
  const time = formatTimeBaghdad(cell.markedAt);
  const note = cell.dailyNote === true ? "سلّم الملاحظة" : cell.dailyNote === false ? "لم يسلّم الملاحظة" : "";
  const title = [date, v.label, time, note, cell.total !== null ? `الدرجة ${cell.total}` : ""].filter(Boolean).join(" · ");
  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={title}>
      <span
        className="inline-flex w-6 h-6 items-center justify-center rounded font-bold"
        style={{ color: v.color, background: v.bg }}
        aria-label={title}
      >
        {v.mark}
      </span>
      {cell.dailyNote === true && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--green-700)" }} />}
      {time && cell.status !== "absent" && (
        <span className="text-[10px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
          {time}
        </span>
      )}
    </span>
  );
}
