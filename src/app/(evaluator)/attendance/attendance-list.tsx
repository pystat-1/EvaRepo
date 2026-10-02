"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markAttendanceAction } from "@/lib/actions/attendance";
import type { DayRosterRow } from "@/lib/models/attendance";
import type { Attendance } from "@/lib/models/evaluations";
import { formatTimeBaghdad } from "@/lib/date";

const BUTTONS: Array<{ value: Attendance; label: string; short: string; color: string }> = [
  { value: "present", label: "حاضر", short: "✓", color: "var(--green-700)" },
  { value: "late", label: "متأخر", short: "متأخر", color: "var(--amber-700)" },
  { value: "absent", label: "غائب", short: "✗", color: "var(--red-700)" },
];

export function AttendanceList({
  rows: initialRows,
  maxTotal,
  readOnly = false,
}: {
  rows: DayRosterRow[];
  maxTotal: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function mark(row: DayRosterRow, status: Attendance) {
    if (readOnly || row.locked || row.attendance === status) return;
    const previous = rows;
    setError(null);
    setPendingId(row.id);
    // Optimistic: show the new state (and time) at once, roll back on error.
    setRows((rs) =>
      rs.map((r) =>
        r.id === row.id
          ? {
              ...r,
              attendance: status,
              markedAt: new Date().toISOString(),
              dailyNote: status === "absent" ? null : r.dailyNote,
            }
          : r
      )
    );
    startTransition(async () => {
      const res = await markAttendanceAction(row.id, status);
      setPendingId(null);
      if (res.error) {
        setRows(previous);
        setError(`${row.nameAr}: ${res.error}`);
        return;
      }
      router.refresh();
    });
  }

  const q = query.trim();
  const shown = q ? rows.filter((r) => r.nameAr.includes(q) || r.universityNumber.includes(q)) : rows;
  const present = rows.filter((r) => r.attendance === "present" || r.attendance === "late").length;
  const absent = rows.filter((r) => r.attendance === "absent").length;
  const evaluated = rows.filter((r) => r.evaluated && r.attendance !== "absent").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2 text-center">
        <Stat label="الطلاب" value={rows.length} />
        <Stat label="حاضر" value={present} color="var(--green-700)" />
        <Stat label="غائب" value={absent} color="var(--red-700)" />
        <Stat label="مُقيَّم" value={evaluated} color="var(--brand)" />
      </div>

      <input
        type="search"
        className="input"
        placeholder="بحث بالاسم أو الرقم الجامعي"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="بحث"
      />

      {error && (
        <p className="text-sm rounded-md px-3 py-2" style={{ color: "var(--red-700)", background: "var(--red-100)" }}>
          {error}
        </p>
      )}

      <div className="card p-0 divide-y" style={{ borderColor: "var(--border)" }}>
        {shown.length === 0 && (
          <p className="text-sm text-center py-6" style={{ color: "var(--ink-muted)" }}>
            {rows.length === 0 ? "لا يوجد طلاب في هذه المجموعة." : "لا توجد نتائج."}
          </p>
        )}
        {shown.map((row, i) => {
          const isAbsent = row.attendance === "absent";
          const busy = pendingId === row.id;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
              style={isAbsent ? { background: "var(--red-100)" } : undefined}
            >
              <span className="w-6 text-xs tabular-nums text-center" style={{ color: "var(--ink-muted)" }}>
                {i + 1}
              </span>
              <Link href={`/grade/${row.id}`} className="flex-1 min-w-[9rem]">
                <span className="block text-sm font-medium">
                  {row.nameAr}
                  {row.locked && (
                    <span className="badge badge-gray mr-1.5" title="مقفل من الإدارة">
                      مقفل
                    </span>
                  )}
                </span>
                <span className="block text-[11px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
                  {row.universityNumber}
                  {row.markedAt && row.attendance && row.attendance !== "absent"
                    ? ` · ${row.attendance === "late" ? "متأخر" : "حضر"} ${formatTimeBaghdad(row.markedAt)}`
                    : ""}
                </span>
              </Link>

              <div className="flex items-center gap-1.5" role="group" aria-label={`حضور ${row.nameAr}`}>
                {BUTTONS.map((b) => {
                  const on = row.attendance === b.value;
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => mark(row, b.value)}
                      disabled={readOnly || row.locked || busy}
                      aria-pressed={on}
                      aria-label={b.label}
                      title={b.label}
                      className="h-9 min-w-9 rounded-lg border px-2 text-sm font-bold disabled:opacity-60"
                      style={on ? { background: b.color, borderColor: b.color, color: "#fff" } : { borderColor: b.color, color: b.color }}
                    >
                      {b.short}
                    </button>
                  );
                })}
              </div>

              <span
                className="w-16 text-center text-sm tabular-nums font-semibold"
                style={{ color: row.total === null ? "var(--ink-muted)" : "var(--brand-dark)" }}
              >
                {row.total === null ? "—" : `${row.total.toFixed(2)}/${maxTotal}`}
              </span>

              <Link
                href={`/grade/${row.id}`}
                className={`btn text-xs px-2.5 py-1.5 ${row.evaluated && !isAbsent ? "btn-secondary" : "btn-primary"}`}
                aria-disabled={isAbsent}
              >
                {row.evaluated && !isAbsent ? "تعديل" : "تقييم"}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card py-2 px-1">
      <div className="text-xl font-bold tabular-nums" style={{ color: color ?? "var(--ink)" }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
    </div>
  );
}
