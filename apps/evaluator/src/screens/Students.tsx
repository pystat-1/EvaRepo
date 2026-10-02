import { useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { matchesSearch } from "@eva/core/text/arabic";
import { maxTotal } from "../lib/day";
import { ATTENDANCE_AR, studentSummaries, weekdayAr, type DayEntry } from "../lib/views";
import { studentsExcel } from "../lib/exports";
import { DownloadMenu } from "../components/DownloadMenu";

// طلابي: every student in this evaluator's groups with their record so far
// (attendance, daily notes, average); tap a student for day-by-day grades.
export function Students({ bundle, entries }: { bundle: EvaluatorBundle; entries: DayEntry[] }) {
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const all = studentSummaries(bundle, entries);
  const shown = all.filter((s) => (!groupId || s.groupId === groupId) && matchesSearch(q, s.name, s.universityNumber));
  return (
    <>
      <div className="row between">
        <h2>طلابي</h2>
        <DownloadMenu items={[{ label: "سجل الطلاب — Excel", run: () => studentsExcel(bundle, shown) }]} />
      </div>
      <input className="input" type="search" placeholder="بحث بالاسم أو الرقم الجامعي…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="المجموعة">
        <option value="">كل المجموعات ({all.length} طالب)</option>
        {bundle.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.students.length})
          </option>
        ))}
      </select>
      {shown.length === 0 && <p className="muted">لا نتائج.</p>}
      {shown.map((s) => (
        <div key={s.id} className="card student">
          <button className="student-head" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
            <div className="grow">
              <b>{s.name}</b>
              <div className="muted small">
                {s.universityNumber} · {s.groupName}
              </div>
            </div>
            <div className="student-stats">
              <b>{s.average === null ? "—" : s.average.toFixed(2)}</b>
              <span className="muted small">
                {s.days.length} يوم · غياب {s.absent}
              </span>
            </div>
          </button>
          {open === s.id && (
            <div className="student-days">
              <p className="muted small">
                حاضر {s.present} · متأخر {s.late} · غائب {s.absent} · سلّم الديلي نوت {s.notes} · المعدل من {maxTotal(bundle)}
              </p>
              {s.days.length === 0 && <p className="muted small">لم يُقيَّم بعد.</p>}
              {s.days
                .slice()
                .reverse()
                .map((d) => (
                  <div key={d.dateISO + d.evaluatorName} className="row between small day-line">
                    <span>
                      {weekdayAr(d.dateISO)} {d.dateISO}
                    </span>
                    <span>{ATTENDANCE_AR[d.record.attendance]}</span>
                    <span>{d.record.attendance === "absent" ? "—" : d.record.dailyNote ? "سلّم" : "لم يسلّم"}</span>
                    <b>{d.record.total.toFixed(2)}</b>
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
