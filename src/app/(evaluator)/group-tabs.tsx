import Link from "next/link";
import type { ScheduledGroup } from "@/lib/models/attendance";

// Today's scheduled groups as tabs (morning first). Each screen passes its
// own path so switching group keeps the evaluator on the same screen.
export function GroupTabs({
  groups,
  selectedId,
  basePath,
}: {
  groups: ScheduledGroup[];
  selectedId: string;
  basePath: string;
}) {
  if (groups.length < 2) return null;
  return (
    <nav className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" aria-label="المجموعات المجدولة اليوم">
      {groups.map((g) => {
        const on = g.groupId === selectedId;
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
            {g.groupName}
            {g.shiftLabel ? ` · ${g.shiftLabel}` : ""}
          </Link>
        );
      })}
    </nav>
  );
}

export function GroupHeader({ group, dateISO, title }: { group: ScheduledGroup; dateISO: string; title: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-sm mt-1" style={{ color: "var(--ink-muted)" }}>
        {group.groupName}
        {group.shiftLabel ? ` (${group.shiftLabel})` : ""} · {group.hospitalName} · {dateISO}
      </p>
    </div>
  );
}

export function NoGroupToday({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="card text-center py-8 flex flex-col items-center gap-3">
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          لا توجد مجموعة مجدولة لك اليوم حسب جدول الدوران.
        </p>
        <Link href="/schedule" className="btn btn-secondary text-sm">
          عرض جدولي
        </Link>
      </div>
    </div>
  );
}
