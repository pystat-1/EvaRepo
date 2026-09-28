"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  GradingSheetData,
  SheetGroup,
  SheetColumn,
  SheetCell,
  SheetCriterion,
} from "@/lib/models/gradingSheet";

// Read-only gradebook matrix: study type → group → student rows, with
// hospital → week → day columns. Mirrors the paper grading sheet. Each day
// cell shows only the day total; clicking (or Enter on) a cell pops out the
// full per-criterion breakdown (GRADING_CENTER_PLAN.md §4).

const ATTENDANCE: Record<string, { label: string; short: string; cls: string }> = {
  present: { label: "حاضر", short: "ح", cls: "badge-green" },
  late: { label: "متأخر", short: "ت", cls: "badge-amber" },
  absent: { label: "غائب", short: "غ", cls: "badge-red" },
};

const BRAND = "#0e5c6b";

// Group a flat column list into hospital → week spans so the header can carry
// the right colSpans across its three tiers (hospital / week / day).
function headerSpans(columns: SheetColumn[]) {
  const hospitals: { name: string; span: number; weeks: { label: string; span: number }[] }[] = [];
  for (const col of columns) {
    let h = hospitals[hospitals.length - 1];
    if (!h || h.name !== col.hospitalName) {
      h = { name: col.hospitalName, span: 0, weeks: [] };
      hospitals.push(h);
    }
    h.span += 1;
    let w = h.weeks[h.weeks.length - 1];
    const weekLabel = `الأسبوع ${col.weekIndex}`;
    if (!w || w.label !== weekLabel) {
      w = { label: weekLabel, span: 0 };
      h.weeks.push(w);
    }
    w.span += 1;
  }
  return hospitals;
}

// Score-band tint for the compact cell — a secondary cue only; the number and
// the attendance badge carry the meaning.
function bandTint(total: number, maxTotal: number): string {
  if (maxTotal <= 0) return "transparent";
  const r = total / maxTotal;
  if (r >= 0.85) return "rgba(22,163,74,0.08)";
  if (r >= 0.6) return "transparent";
  return "rgba(220,38,38,0.07)";
}

interface OpenCell {
  group: SheetGroup;
  studentIdx: number;
  colIdx: number;
  anchor: DOMRect;
}

function CellButton({
  cell,
  maxTotal,
  onOpen,
}: {
  cell: SheetCell | null;
  maxTotal: number;
  onOpen: (el: HTMLElement) => void;
}) {
  if (!cell) return <span className="block text-center text-slate-300 py-1">—</span>;
  const att = ATTENDANCE[cell.attendance];
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${att.label} · ${cell.total} من ${maxTotal} — عرض التفاصيل`}
      onClick={(e) => onOpen(e.currentTarget)}
      className="w-full flex items-center justify-between gap-1 rounded px-1.5 py-1 cursor-pointer transition hover:ring-2 hover:ring-[#0e5c6b]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e5c6b]"
      style={{ background: bandTint(cell.total, maxTotal) }}
    >
      <span className={`badge ${att.cls} !px-1.5 !py-0 text-[10px]`} title={att.label}>
        {att.short}
      </span>
      <span className="flex items-center gap-1">
        {cell.locked && (
          <span className="text-[10px]" title="مقفل">
            🔒
          </span>
        )}
        <span
          className={cell.dailyNoteSubmitted ? "text-[10px]" : "text-[10px] opacity-25 grayscale"}
          title={cell.dailyNoteSubmitted ? "سلّم الملاحظة اليومية" : "لم يسلّم الملاحظة اليومية"}
        >
          📝
        </span>
        <span className="font-bold text-[12px] tabular-nums">{cell.total}</span>
      </span>
    </button>
  );
}

// The read-only detail card for one student-day. Rendered in the browser's
// top layer via the native Popover API, so it escapes the table's
// scroll/overflow clipping and gets Esc + click-outside dismissal for free.
function CellPopover({
  open,
  criteria,
  maxTotal,
  onClose,
}: {
  open: OpenCell | null;
  criteria: SheetCriterion[];
  maxTotal: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!open) {
      if (el.matches(":popover-open")) el.hidePopover();
      return;
    }
    if (!el.matches(":popover-open")) el.showPopover();
    // Place beside the cell (RTL: prefer its left side, the reading
    // direction), flipping and clamping so it stays inside the viewport.
    const W = el.offsetWidth;
    const H = el.offsetHeight;
    const a = open.anchor;
    const gap = 6;
    let left = a.left - W - gap;
    if (left < 8) left = a.right + gap;
    left = Math.max(8, Math.min(left, window.innerWidth - W - 8));
    const top = Math.max(8, Math.min(a.top, window.innerHeight - H - 8));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") onClose();
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [onClose]);

  const student = open ? open.group.students[open.studentIdx] : null;
  const col = open ? open.group.columns[open.colIdx] : null;
  const cell = student && open ? student.cells[open.colIdx] : null;

  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-label="تفاصيل التقييم"
      dir="rtl"
      className="w-[300px] max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl"
      style={{ position: "fixed", margin: 0, right: "auto", bottom: "auto", top: pos.top, left: pos.left }}
    >
      {open && student && col && cell && (
        <div className="flex flex-col text-xs">
          <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <div>
              <div className="font-bold text-sm leading-tight">{student.name}</div>
              <div className="text-[10px] text-slate-400 tabular-nums">{student.universityNumber}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2 text-[11px] text-slate-600 bg-slate-50">
            <span>
              📅 <span className="tabular-nums">{col.dateISO}</span>
            </span>
            <span>🏥 {col.hospitalName}</span>
            <span>👥 {open.group.name}</span>
            <span>
              الأسبوع {col.weekIndex} · اليوم {col.dayIndex}
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-2">
            <span className={`badge ${ATTENDANCE[cell.attendance].cls}`}>{ATTENDANCE[cell.attendance].label}</span>
            <span className="text-sm">
              <span className="font-bold tabular-nums text-base">{cell.total}</span>
              <span className="text-slate-400">/{maxTotal}</span>
              {maxTotal > 0 && (
                <span className="text-slate-500 mr-1.5">({Math.round((cell.total / maxTotal) * 100)}٪)</span>
              )}
            </span>
          </div>

          {cell.attendance !== "absent" && (
            <div className="flex flex-col gap-1.5 px-3 pb-2">
              {criteria.map((c, i) => {
                const v = cell.scores[i];
                const r = v != null && c.maxScore > 0 ? v / c.maxScore : 0;
                return (
                  <div key={c.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">{c.labelAr}</span>
                      <span className="tabular-nums font-semibold shrink-0">
                        {v ?? "—"}
                        <span className="text-slate-400 font-normal">/{c.maxScore}</span>
                      </span>
                    </div>
                    <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${r * 100}%`, background: BRAND }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-1 border-t border-slate-100 px-3 py-2 text-[11px]">
            <div>
              <span className="text-slate-400">المقيّم: </span>
              {cell.evaluatorName ?? "—"}
            </div>
            <div>
              <span className="text-slate-400">الملاحظة اليومية: </span>
              {cell.dailyNoteSubmitted ? "سُلّمت ✓" : "لم تُسلَّم"}
            </div>
            {cell.locked && <div className="text-slate-500">🔒 التقييم مقفل</div>}
            {cell.notes && (
              <div>
                <span className="text-slate-400">ملاحظات: </span>
                <span className="whitespace-pre-wrap">{cell.notes}</span>
              </div>
            )}
            {cell.feedback && (
              <div>
                <span className="text-slate-400">التغذية الراجعة: </span>
                <span className="whitespace-pre-wrap">{cell.feedback}</span>
              </div>
            )}
          </div>

          <a
            href={`/grading-center/student/${student.id}`}
            className="border-t border-slate-100 px-3 py-2 text-center text-[11px] font-semibold hover:bg-slate-50 rounded-b-xl"
            style={{ color: BRAND }}
          >
            عرض سجل الطالب الكامل ←
          </a>
        </div>
      )}
    </div>
  );
}

function GroupTable({
  group,
  maxTotal,
  onOpen,
}: {
  group: SheetGroup;
  maxTotal: number;
  onOpen: (group: SheetGroup, studentIdx: number, colIdx: number, el: HTMLElement) => void;
}) {
  const hospitals = headerSpans(group.columns);
  const hasColumns = group.columns.length > 0;

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border, #e2e8f0)" }}>
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2 border-b text-sm"
        style={{ borderColor: "var(--border, #e2e8f0)", background: "#f8fafc" }}
      >
        <span className="font-semibold">{group.name}</span>
        {group.courseLabel && <span className="badge badge-gray">{group.courseLabel}</span>}
        {group.shiftLabel && <span className="badge badge-gray">{group.shiftLabel}</span>}
        <span className="text-xs text-slate-400 mr-auto">{group.students.length} طالب</span>
      </div>

      {!hasColumns ? (
        <p className="text-center text-slate-400 py-5 text-sm">لا يوجد جدول دوران لهذه المجموعة بعد</p>
      ) : (
        <div className="overflow-auto max-h-[70vh]">
          <table className="border-collapse text-xs" dir="rtl">
            <thead className="sticky top-0 z-20">
              {/* Tier 1 — hospital */}
              <tr>
                <th
                  rowSpan={3}
                  className="sticky right-0 z-30 border border-slate-200 px-2 py-1.5 text-right font-semibold min-w-[150px]"
                  style={{ background: "#eef2f7" }}
                >
                  الطالب
                </th>
                {hospitals.map((h, i) => (
                  <th
                    key={i}
                    colSpan={h.span}
                    className="border border-slate-200 px-2 py-1 text-center font-bold"
                    style={{ background: "#e8eef6" }}
                  >
                    {h.name}
                  </th>
                ))}
              </tr>
              {/* Tier 2 — week */}
              <tr>
                {hospitals.flatMap((h, hi) =>
                  h.weeks.map((w, wi) => (
                    <th
                      key={`${hi}-${wi}`}
                      colSpan={w.span}
                      className="border border-slate-200 px-2 py-1 text-center font-semibold"
                      style={{ background: "#f1f5f9" }}
                    >
                      {w.label}
                    </th>
                  ))
                )}
              </tr>
              {/* Tier 3 — day */}
              <tr>
                {group.columns.map((col) => (
                  <th
                    key={col.key}
                    className="border border-slate-200 px-2 py-1 text-center font-medium min-w-[84px] whitespace-nowrap"
                    style={{ background: "#f8fafc" }}
                  >
                    <div>اليوم {col.dayIndex}</div>
                    <div className="text-[9px] text-slate-400 tabular-nums">{col.dateISO}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.students.length === 0 ? (
                <tr>
                  <td colSpan={group.columns.length + 1} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    لا يوجد طلاب في هذه المجموعة
                  </td>
                </tr>
              ) : (
                group.students.map((s, ri) => (
                  <tr key={s.id} style={{ background: ri % 2 ? "#fbfcfe" : "#fff" }}>
                    <td
                      className="sticky right-0 z-10 border border-slate-200 px-2 py-1.5 align-middle"
                      style={{ background: ri % 2 ? "#fbfcfe" : "#fff" }}
                    >
                      <div className="font-medium leading-tight">
                        <span className="text-slate-400 tabular-nums ml-1">{ri + 1}.</span>
                        {s.name}
                      </div>
                      <div className="text-[10px] text-slate-400 tabular-nums">{s.universityNumber}</div>
                    </td>
                    {s.cells.map((cell, ci) => (
                      <td key={ci} className="border border-slate-200 p-0.5 align-middle">
                        <CellButton cell={cell} maxTotal={maxTotal} onOpen={(el) => onOpen(group, ri, ci, el)} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GradingSheet({ data }: { data: GradingSheetData }) {
  const { studyTypes, criteria, maxTotal } = data;
  const [open, setOpen] = useState<OpenCell | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const openCell = useCallback(
    (group: SheetGroup, studentIdx: number, colIdx: number, el: HTMLElement) =>
      setOpen({ group, studentIdx, colIdx, anchor: el.getBoundingClientRect() }),
    []
  );

  // The popover is pinned to a viewport position; scrolling would detach it
  // from its cell, so close it instead of letting it drift.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && (e.target as Element).closest?.("[popover]")) return;
      setOpen(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  if (studyTypes.length === 0) {
    return (
      <div className="card text-center text-slate-400 py-10">
        لا توجد بيانات مطابقة — تأكّد من إعداد المجموعات وأنواع الدراسة وجدول الدوران.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>
          الدرجة الكلّية من {maxTotal} · انقر على أي خلية لعرض درجات المعايير ({criteria.length})
        </span>
        <span className="mr-auto flex items-center gap-2">
          <span title="الملاحظة اليومية">📝 = سلّم الملاحظة اليومية</span>
          {Object.values(ATTENDANCE).map((a) => (
            <span key={a.label} className={`badge ${a.cls} !py-0`}>
              {a.short} = {a.label}
            </span>
          ))}
        </span>
      </div>

      {studyTypes.map((st) => (
        <section key={st.name} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧪</span>
            <h2 className="text-lg font-bold">{st.name}</h2>
            <span className="text-xs text-slate-400">({st.groups.length} مجموعة)</span>
          </div>
          <div className="flex flex-col gap-4">
            {st.groups.map((g) => (
              <GroupTable key={g.id} group={g} maxTotal={maxTotal} onOpen={openCell} />
            ))}
          </div>
        </section>
      ))}

      <CellPopover open={open} criteria={criteria} maxTotal={maxTotal} onClose={close} />
    </div>
  );
}
