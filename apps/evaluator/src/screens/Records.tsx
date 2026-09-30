import { useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { maxTotal } from "../lib/day";
import { ATTENDANCE_MARK, STATE_AR, weekdayAr, type DayEntry } from "../lib/views";
import { attendanceExcel, historyExcel } from "../lib/exports";
import { DownloadMenu } from "../components/DownloadMenu";

// السجلات: previous assessments (validated days, newest first) and the
// attendance log (students x days) for one group. Both include what a
// colleague graded for the same groups, marked as such. All offline.
export function Records({ bundle, entries, onOpen }: { bundle: EvaluatorBundle; entries: DayEntry[]; onOpen: (x: { groupId: string; dateISO: string }) => void }) {
  const [view, setView] = useState<"history" | "attendance">("history");
  return (
    <>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={view === "history"} className={view === "history" ? "on" : ""} onClick={() => setView("history")}>
          التقييمات السابقة
        </button>
        <button role="tab" aria-selected={view === "attendance"} className={view === "attendance" ? "on" : ""} onClick={() => setView("attendance")}>
          سجل الحضور
        </button>
      </div>
      {view === "history" ? <History bundle={bundle} entries={entries} onOpen={onOpen} /> : <AttendanceLog bundle={bundle} entries={entries} />}
    </>
  );
}

function History({ bundle, entries, onOpen }: { bundle: EvaluatorBundle; entries: DayEntry[]; onOpen: (x: { groupId: string; dateISO: string }) => void }) {
  const [all, setAll] = useState(false);
  const shown = entries.filter((e) => all || e.mine);
  const groupName = (id: string) => bundle.groups.find((g) => g.id === id)?.name ?? "—";
  return (
    <>
      <div className="row between">
        <label className="row check small">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> إظهار تقييمات الزملاء للمجموعات نفسها
        </label>
        <DownloadMenu items={[{ label: "التقييمات السابقة — Excel", run: () => historyExcel(bundle, shown), disabled: shown.length === 0 }]} />
      </div>
      {shown.length === 0 && <p className="muted">لا توجد أيام معتمدة بعد. تظهر هنا كل الأيام التي تعتمدها، وتُحفظ حتى دون اتصال.</p>}
      {shown.map((e) => {
        const recs = [...e.records.values()];
        const attended = recs.filter((r) => r.attendance !== "absent");
        const avg = attended.length ? attended.reduce((a, r) => a + r.total, 0) / attended.length : null;
        return (
          <button key={`${e.groupId}:${e.dateISO}:${e.evaluatorName}`} className="card group" onClick={() => onOpen({ groupId: e.groupId, dateISO: e.dateISO })}>
            <div>
              <b>{groupName(e.groupId)}</b>
              <div className="muted small">
                {weekdayAr(e.dateISO)} {e.dateISO} · {e.hospitalName}
                {e.mine ? "" : ` · ${e.evaluatorName}`}
              </div>
              <div className="muted small">
                {recs.length} طالب · غائب {recs.length - attended.length}
                {avg !== null && ` · المعدل ${avg.toFixed(2)}/${maxTotal(bundle)}`}
              </div>
            </div>
            <span className={`status ${e.state === "applied" ? "ok" : e.state === "conflict" || e.state === "rejected" ? "err" : "warn"}`}>{STATE_AR[e.state]}</span>
          </button>
        );
      })}
    </>
  );
}

function AttendanceLog({ bundle, entries }: { bundle: EvaluatorBundle; entries: DayEntry[] }) {
  const withDays = bundle.groups.filter((g) => entries.some((e) => e.groupId === g.id));
  const [groupId, setGroupId] = useState(withDays[0]?.id ?? "");
  const g = bundle.groups.find((x) => x.id === groupId);
  if (!g) return <p className="muted">لا توجد أيام معتمدة بعد لأي مجموعة.</p>;
  // One column per day (if two evaluators graded the same day, this evaluator's wins).
  const byDate = new Map<string, DayEntry>();
  for (const e of entries.filter((x) => x.groupId === groupId)) if (!byDate.has(e.dateISO) || e.mine) byDate.set(e.dateISO, e);
  const days = [...byDate.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return (
    <>
      <div className="chips" role="tablist" aria-label="المجموعات">
        {withDays.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === groupId} className={`pill ${x.id === groupId ? "on" : ""}`} onClick={() => setGroupId(x.id)}>
            {x.name}
          </button>
        ))}
      </div>
      <div className="row between">
        <span className="muted small">✓ حاضر · م متأخر · ✗ غائب · • سلّم الديلي نوت</span>
        <DownloadMenu items={[{ label: `سجل حضور ${g.name} — Excel`, run: () => attendanceExcel(bundle, groupId, [...byDate.values()]) }]} />
      </div>
      <div className="grid-wrap" role="region" aria-label={`سجل حضور ${g.name}`} tabIndex={0}>
        <table className="grid log">
          <thead>
            <tr>
              <th className="sticky-name">الطالب</th>
              {days.map((d) => (
                <th key={d.dateISO}>
                  <span className="sec-name">{weekdayAr(d.dateISO)}</span>
                  {d.dateISO.slice(8)}/{d.dateISO.slice(5, 7)}
                </th>
              ))}
              <th>✓</th>
              <th>م</th>
              <th>✗</th>
            </tr>
          </thead>
          <tbody>
            {g.students.map((s, i) => {
              const recs = days.map((d) => d.records.get(s.id));
              const count = (a: "present" | "late" | "absent") => recs.filter((r) => r?.attendance === a).length;
              return (
                <tr key={s.id}>
                  <th className="sticky-name" scope="row">
                    <span className="idx">{i + 1}</span> {s.name}
                  </th>
                  {recs.map((r, n) => (
                    <td key={n} className={r ? `att-${r.attendance}` : undefined}>
                      {r ? ATTENDANCE_MARK[r.attendance] : ""}
                      {r?.dailyNote ? <span className="note-dot">•</span> : null}
                    </td>
                  ))}
                  <td className="total">{count("present")}</td>
                  <td className="total">{count("late")}</td>
                  <td className="total">{count("absent")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
