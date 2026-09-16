"use client";

import { useMemo, useState } from "react";
import type { GradingTreeData, TreeGroup, TreeStint } from "@/lib/models/gradingTree";

const SHIFT_ICON: Record<string, string> = { MORNING: "☀️", EVENING: "🌙" };
const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
const ATTENDANCE_BADGE: Record<string, string> = { present: "badge-green", late: "badge-amber", absent: "badge-red" };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 transition-transform duration-150"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TreeRow({
  icon,
  label,
  muted,
  count,
  open,
  onToggle,
  tint,
}: {
  icon: string;
  label: string;
  muted?: string;
  count: string;
  open: boolean;
  onToggle: () => void;
  tint?: boolean;
}) {
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-2.5 min-h-[46px] px-3 cursor-pointer select-none hover:bg-slate-50 active:bg-slate-100 ${
        tint ? "bg-[var(--brand-tint,#eaf1f5)]" : ""
      }`}
    >
      <span className="text-slate-400"><Chevron open={open} /></span>
      <span className="text-[15px] w-5 text-center shrink-0">{icon}</span>
      <span className={`font-bold flex-1 min-w-0 truncate ${tint ? "text-base" : "text-sm"}`} style={tint ? { color: "var(--brand-dark)" } : undefined}>
        {label} {muted && <span className="font-normal text-slate-400 text-xs">{muted}</span>}
      </span>
      <span
        className="font-mono text-[10.5px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
        style={{ color: "var(--brand)", background: "var(--brand-tint, #eaf1f5)" }}
      >
        {count}
      </span>
    </div>
  );
}

function stintState(today: string, stint: TreeStint): "upcoming" | "current" | "past" {
  if (today < stint.startDate) return "upcoming";
  if (today > stint.endDate) return "past";
  return "current";
}

function GroupDetail({ group, maxTotal }: { group: TreeGroup; maxTotal: number }) {
  const today = todayISO();
  const currentStint = group.stints.find((s) => today >= s.startDate && today <= s.endDate);
  const nextStint = !currentStint ? group.stints.find((s) => today < s.startDate) : null;

  const rubricLabels = useMemo(() => {
    const labels = new Set<string>();
    group.students.forEach((s) => s.latestEvaluation?.scores.forEach((sc) => labels.add(sc.labelAr)));
    return Array.from(labels);
  }, [group.students]);

  return (
    <div className="px-3.5 pb-3.5 pt-2.5">
      {group.stints.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {group.stints.map((stint) => {
            const state = stintState(today, stint);
            return (
              <div
                key={stint.hospitalId + stint.startDate}
                className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold rounded-full px-2.5 py-1 border ${
                  state === "current" ? "border-transparent" : "border-slate-200"
                } ${state === "past" ? "opacity-50" : ""}`}
                style={state === "current" ? { background: "var(--brand-tint, #eaf1f5)", color: "var(--brand-dark)" } : { background: "#f8fafc", color: "#94a3b8" }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: state === "current" ? "var(--brand)" : "#cbd5e1" }} />
                <span>{stint.hospitalName}</span>
                <span className="font-mono font-normal">
                  {stint.startDate} – {stint.endDate}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th className="text-start font-bold text-[10.5px] text-slate-400 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">الطالب</th>
              <th className="text-start font-bold text-[10.5px] text-slate-400 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">الرقم الجامعي</th>
              <th className="text-start font-bold text-[10.5px] text-slate-400 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">المستشفى الآن</th>
              <th className="text-start font-bold text-[10.5px] text-slate-400 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">الحضور</th>
              {rubricLabels.map((l) => (
                <th key={l} className="text-start font-bold text-[9.5px] px-2 py-1.5 border-b border-slate-200 whitespace-nowrap" style={{ color: "var(--brand)" }}>
                  {l}
                </th>
              ))}
              <th className="text-start font-bold text-[10.5px] text-slate-400 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">المجموع</th>
              <th className="text-start font-bold text-[10.5px] text-slate-400 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {group.students.map((s) => {
              const hospitalCell = currentStint ? currentStint.hospitalName : nextStint ? `يبدأ ${nextStint.startDate}` : "—";
              const ev = s.latestEvaluation;
              const scoreByLabel = new Map((ev?.scores ?? []).map((sc) => [sc.labelAr, sc]));
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-2 py-1.5 border-b border-slate-100 font-semibold whitespace-nowrap">
                    <a href={`/grading-center/student/${s.id}`} className="hover:underline">
                      {s.name}
                    </a>
                  </td>
                  <td className="px-2 py-1.5 border-b border-slate-100 font-mono text-slate-400 whitespace-nowrap">{s.universityNumber}</td>
                  <td className={`px-2 py-1.5 border-b border-slate-100 whitespace-nowrap ${currentStint ? "" : "text-slate-400"}`}>{hospitalCell}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                    {ev ? (
                      <span className={`badge ${ATTENDANCE_BADGE[ev.attendance]}`}>{ATTENDANCE_LABEL[ev.attendance]}</span>
                    ) : (
                      <span className="badge badge-gray">لم يُقيَّم بعد</span>
                    )}
                  </td>
                  {rubricLabels.map((l) => {
                    const sc = scoreByLabel.get(l);
                    return (
                      <td key={l} className="px-2 py-1.5 border-b border-slate-100 font-mono text-slate-400 whitespace-nowrap">
                        {sc ? `${sc.score}/${sc.maxScore}` : "—"}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 border-b border-slate-100 font-mono whitespace-nowrap">{ev ? `${ev.total}/${maxTotal}` : `—/${maxTotal}`}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 text-slate-400 whitespace-nowrap">{ev?.dateISO ?? "—"}</td>
                </tr>
              );
            })}
            {group.students.length === 0 && (
              <tr>
                <td colSpan={5 + rubricLabels.length} className="text-center text-slate-400 py-4">
                  لا طلاب في هذه المجموعة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GradingTree({ data }: { data: GradingTreeData }) {
  const [view, setView] = useState<"tree" | "alpha">("tree");
  const [open, setOpen] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const c of data.courses) {
      initial.add(`c:${c.id}`);
      for (const sh of c.shifts) {
        initial.add(`s:${c.id}:${sh.key}`);
        for (const g of sh.groups) initial.add(`g:${g.id}`);
      }
    }
    return initial;
  });

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    for (const c of data.courses) {
      all.add(`c:${c.id}`);
      for (const sh of c.shifts) {
        all.add(`s:${c.id}:${sh.key}`);
        for (const g of sh.groups) all.add(`g:${g.id}`);
      }
    }
    setOpen(all);
  }
  function collapseAll() {
    setOpen(new Set());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap sticky top-0 z-20 bg-slate-50/95 backdrop-blur py-2 -my-2">
        <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5 gap-0.5">
          <button
            onClick={() => setView("tree")}
            className={`text-xs font-bold rounded-md px-3.5 py-1.5 ${view === "tree" ? "text-white" : "text-slate-500"}`}
            style={view === "tree" ? { background: "var(--brand)" } : undefined}
          >
            🌳 شجري
          </button>
          <button
            onClick={() => setView("alpha")}
            className={`text-xs font-bold rounded-md px-3.5 py-1.5 ${view === "alpha" ? "text-white" : "text-slate-500"}`}
            style={view === "alpha" ? { background: "var(--brand)" } : undefined}
          >
            🔤 أبجدي
          </button>
        </div>
        {view === "tree" && (
          <div className="flex gap-1.5">
            <button onClick={expandAll} className="text-[11.5px] font-bold rounded-md px-2.5 py-1.5" style={{ color: "var(--brand)", background: "var(--brand-tint, #eaf1f5)" }}>
              توسيع الكل
            </button>
            <button onClick={collapseAll} className="text-[11.5px] font-bold rounded-md px-2.5 py-1.5" style={{ color: "var(--brand)", background: "var(--brand-tint, #eaf1f5)" }}>
              طي الكل
            </button>
          </div>
        )}
      </div>

      {view === "tree" ? (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {data.courses.map((c) => {
            const cOpen = open.has(`c:${c.id}`);
            return (
              <div key={c.id} className="border-b border-slate-200 last:border-b-0">
                <TreeRow
                  icon="📚"
                  label={`الدورة ${c.label ?? `${c.year}-${c.number}`}`}
                  count={`${c.totalStudents} طالبًا`}
                  open={cOpen}
                  onToggle={() => toggle(`c:${c.id}`)}
                  tint
                />
                {cOpen &&
                  c.shifts.map((sh) => {
                    const sKey = `s:${c.id}:${sh.key}`;
                    const sOpen = open.has(sKey);
                    const shiftTotal = sh.groups.reduce((n, g) => n + g.students.length, 0);
                    return (
                      <div key={sh.key} className="border-t border-slate-200 ps-5">
                        <TreeRow
                          icon={SHIFT_ICON[sh.key]}
                          label={`الوردية ${sh.label}`}
                          count={`${shiftTotal} طالبًا`}
                          open={sOpen}
                          onToggle={() => toggle(sKey)}
                        />
                        {sOpen &&
                          sh.groups.map((g) => {
                            const gKey = `g:${g.id}`;
                            const gOpen = open.has(gKey);
                            return (
                              <div key={g.id} className="border-t border-slate-200 ps-5">
                                <TreeRow
                                  icon="👥"
                                  label={g.name}
                                  count={`${g.students.length} طالبًا`}
                                  open={gOpen}
                                  onToggle={() => toggle(gKey)}
                                />
                                {gOpen && <GroupDetail group={g} maxTotal={data.maxTotal} />}
                              </div>
                            );
                          })}
                      </div>
                    );
                  })}
              </div>
            );
          })}
          {data.courses.length === 0 && <p className="text-center text-slate-400 py-8">لا توجد دورات بعد</p>}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          {(() => {
            let lastLetter: string | null = null;
            return data.allStudents.map((s) => {
              const letter = s.name.trim()[0];
              const showHeader = letter !== lastLetter;
              lastLetter = letter;
              return (
                <div key={s.id}>
                  {showHeader && (
                    <div
                      className="sticky top-[52px] font-extrabold text-sm px-3.5 py-1.5 border-y border-slate-200"
                      style={{ background: "var(--brand-tint, #eaf1f5)", color: "var(--brand-dark)" }}
                    >
                      {letter}
                    </div>
                  )}
                  <div className="flex items-center gap-2.5 min-h-[44px] px-3.5 border-b border-slate-100 last:border-b-0">
                    <span className="text-[15px] w-5 text-center shrink-0">🎓</span>
                    <a href={`/grading-center/student/${s.id}`} className="flex items-baseline gap-1.5 flex-1 min-w-0 hover:underline">
                      <span className="font-medium text-sm truncate">{s.name}</span>
                      <span className="font-mono text-[10.5px] text-slate-400">{s.universityNumber}</span>
                    </a>
                    <span className="text-[11px] text-slate-400 shrink-0">{s.groupName ?? "—"}</span>
                  </div>
                </div>
              );
            });
          })()}
          {data.allStudents.length === 0 && <p className="text-center text-slate-400 py-8">لا يوجد طلاب بعد</p>}
        </div>
      )}
    </div>
  );
}
