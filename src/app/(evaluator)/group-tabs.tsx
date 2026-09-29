import Link from "next/link";
import type { ScheduledGroup } from "@/lib/models/attendance";

// The group shown by default: the one asked for in the URL, else the
// first group the schedule has today (or one already started today).
// Null = nothing scheduled; the evaluator picks a group to load.
export function pickSelectedGroup(groups: ScheduledGroup[], requested?: string): ScheduledGroup | null {
  return (
    groups.find((g) => g.groupId === requested) ?? groups.find((g) => g.scheduled || g.started) ?? null
  );
}

function tabLabel(g: ScheduledGroup): string {
  return `${g.groupName}${g.shiftLabel ? ` · ${g.shiftLabel}` : ""}`;
}

// Today's groups as tabs, plus a picker for the evaluator's other groups:
// the schedule is the default, but a day moved by a holiday can still be
// worked. The first thing recorded then creates that day as a work day.
export function GroupPicker({
  groups,
  selected,
  basePath,
}: {
  groups: ScheduledGroup[];
  selected: ScheduledGroup | null;
  basePath: string;
}) {
  const tabs = groups.filter((g) => g.scheduled || g.started || g.groupId === selected?.groupId);
  const others = groups.filter((g) => !tabs.includes(g));
  return (
    <div className="flex flex-col gap-2">
      {tabs.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" aria-label="مجموعات اليوم">
          {tabs.map((g) => {
            const on = g.groupId === selected?.groupId;
            return (
              <Link
                key={g.groupId}
                href={`${basePath}?group=${g.groupId}`}
                aria-current={on ? "page" : undefined}
                className="shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap"
                style={
                  on
                    ? { background: "var(--brand-dark)", borderColor: "var(--brand-dark)", color: "#fff" }
                    : { borderColor: "var(--border-strong)", color: "var(--ink)" }
                }
              >
                {tabLabel(g)}
                {g.validated ? " ✓" : ""}
              </Link>
            );
          })}
        </nav>
      )}
      {others.length > 0 && (
        <form action={basePath} className="flex gap-2 items-center">
          <label htmlFor="load-group" className="text-xs shrink-0" style={{ color: "var(--ink-muted)" }}>
            مجموعة أخرى:
          </label>
          <select id="load-group" name="group" className="input py-1.5 text-sm flex-1 min-w-0" defaultValue="">
            <option value="" disabled>
              اختر مجموعة لتحميلها
            </option>
            {others.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {tabLabel(g)} — {g.hospitalName}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary text-sm px-3 py-1.5 shrink-0">
            تحميل
          </button>
        </form>
      )}
    </div>
  );
}

export function GroupHeader({ group, dateISO, title }: { group: ScheduledGroup; dateISO: string; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--ink-muted)" }}>
          {group.groupName}
          {group.shiftLabel ? ` (${group.shiftLabel})` : ""} · <bdi>{group.hospitalName}</bdi> ·{" "}
          <bdi className="tabular-nums">{dateISO}</bdi>
        </p>
      </div>
      {group.validated ? (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--green-700)", background: "var(--green-100)" }}>
          تم اعتماد درجات هذا اليوم وإرسالها للإدارة — التعديل مغلق.
        </p>
      ) : (
        !group.scheduled && (
          <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--amber-700)", background: "var(--amber-100)" }}>
            هذا اليوم ليس ضمن جدول الدوران لهذه المجموعة (مثلًا بسبب عطلة) — سيُسجَّل تاريخ اليوم يومَ عمل فعليًا عند
            أول تسجيل.
          </p>
        )
      )}
    </div>
  );
}

export function NoGroupToday({
  title,
  groups,
  basePath,
}: {
  title: string;
  groups: ScheduledGroup[];
  basePath: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="card flex flex-col gap-3">
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          لا توجد مجموعة مجدولة لك اليوم حسب جدول الدوران.
          {groups.length > 0 ? " إذا تغيّر موعد الدوام (عطلة أو غيرها) يمكنك تحميل إحدى مجموعاتك والبدء." : ""}
        </p>
        {groups.length > 0 ? (
          <GroupPicker groups={groups} selected={null} basePath={basePath} />
        ) : (
          <Link href="/schedule" className="btn btn-secondary text-sm self-start">
            عرض جدولي
          </Link>
        )}
      </div>
    </div>
  );
}
