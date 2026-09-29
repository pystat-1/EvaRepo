"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDailyNoteAction } from "@/lib/actions/attendance";
import type { DayRosterRow } from "@/lib/models/attendance";

export function DailyNoteList({ rows: initialRows }: { rows: DayRosterRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Tapping the active choice again clears it back to "not recorded".
  function set(row: DayRosterRow, value: boolean) {
    if (row.locked) return;
    const next = row.dailyNote === value ? null : value;
    const previous = rows;
    setError(null);
    setPendingId(row.id);
    setRows((rs) =>
      rs.map((r) => (r.id === row.id ? { ...r, dailyNote: next, attendance: r.attendance ?? "present" } : r))
    );
    startTransition(async () => {
      const res = await setDailyNoteAction(row.id, next);
      setPendingId(null);
      if (res.error) {
        setRows(previous);
        setError(`${row.nameAr}: ${res.error}`);
        return;
      }
      router.refresh();
    });
  }

  const shown = rows.filter((r) => r.attendance !== "absent");
  const delivered = shown.filter((r) => r.dailyNote === true).length;
  const notDelivered = shown.filter((r) => r.dailyNote === false).length;
  const absentCount = rows.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Count label="سلّم" value={delivered} color="var(--green-700)" />
        <Count label="لم يسلّم" value={notDelivered} color="var(--red-700)" />
        <Count label="لم يُسجَّل" value={shown.length - delivered - notDelivered} color="var(--ink-muted)" />
      </div>

      {absentCount > 0 && (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {absentCount} طالب غائب اليوم ولا يظهر في هذه القائمة.
        </p>
      )}

      {error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--red-700)", background: "var(--red-100)" }}>
          {error}
        </p>
      )}

      <div className="card p-0 divide-y" style={{ borderColor: "var(--border)" }}>
        {shown.length === 0 && (
          <p className="text-sm text-center py-6" style={{ color: "var(--ink-muted)" }}>
            {rows.length === 0 ? "لا يوجد طلاب في هذه المجموعة." : "جميع الطلاب غائبون اليوم."}
          </p>
        )}
        {shown.map((row, i) => {
          const busy = pendingId === row.id;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
              style={
                row.dailyNote === true
                  ? { background: "var(--green-100)" }
                  : row.dailyNote === false
                  ? { background: "var(--red-100)" }
                  : undefined
              }
            >
              <span className="w-6 text-xs tabular-nums text-center" style={{ color: "var(--ink-muted)" }}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-[9rem]">
                <div className="text-sm font-medium">{row.nameAr}</div>
                <div className="text-[11px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
                  {row.universityNumber}
                  {row.attendance === null ? " · لم يُسجَّل حضوره بعد" : ""}
                </div>
              </div>
              <div className="flex gap-2">
                <Choice
                  label="✓ سلّم"
                  on={row.dailyNote === true}
                  color="var(--green-700)"
                  disabled={row.locked || busy}
                  onClick={() => set(row, true)}
                />
                <Choice
                  label="✗ لم يسلّم"
                  on={row.dailyNote === false}
                  color="var(--red-700)"
                  disabled={row.locked || busy}
                  onClick={() => set(row, false)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Choice({
  label,
  on,
  color,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  color: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="h-9 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-60"
      style={on ? { background: color, borderColor: color, color: "#fff" } : { borderColor: color, color, background: "#fff" }}
    >
      {label}
    </button>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card py-2 px-1">
      <div className="text-xl font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
    </div>
  );
}
