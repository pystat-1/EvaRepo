import type { EvaluatedDay, EvaluatorBundle, GuestInfo } from "@eva/core/sync/contract";
import { evaluatedDays, maxTotal } from "../lib/day";
import { ATTENDANCE_AR, SHIFT_AR, weekdayAr } from "../lib/views";

const SHOWN = 6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The days a student was evaluated (newest first); the day being graded stands out. */
export function EvaluatedList({ days, dateISO, max }: { days: EvaluatedDay[]; dateISO: string; max: number }) {
  return (
    <div className="evaluated">
      {days.slice(0, SHOWN).map((d) => (
        <div key={`${d.dateISO}:${d.groupName}:${d.evaluatorName}`} className={`row between small day-line ${d.dateISO === dateISO ? "same-day" : ""}`}>
          <span>
            <span className="tabular">{d.dateISO}</span> {weekdayAr(d.dateISO)} · {d.groupName}
            {d.hospitalName ? ` · ${d.hospitalName}` : ""} · {d.evaluatorName}
          </span>
          <b className={d.attendance === "absent" ? "att-absent" : undefined}>{d.attendance === "absent" ? ATTENDANCE_AR.absent : `${r2(d.total)}/${max}`}</b>
        </div>
      ))}
      {days.length > SHOWN && <p className="muted small">و{days.length - SHOWN} أيام أخرى.</p>}
    </div>
  );
}

const KIND_AR: Record<GuestInfo["kind"], string> = { "same-shift": "من مجموعة أخرى", "other-shift": "من نوع دراسة آخر" };

/** A hosted student's card: where they come from and what is known of their evaluations. */
export function GuestPanel({ bundle, studentId, guest, dateISO }: { bundle: EvaluatorBundle; studentId: string; guest: GuestInfo; dateISO: string }) {
  const days = evaluatedDays(bundle, studentId);
  const p = guest.priorEvaluation;
  const today = days.find((d) => d.dateISO === dateISO);
  return (
    <div className="guest-panel stack tight">
      <div className="small">
        <span className="guest-tag">مستضاف</span> {KIND_AR[guest.kind]} · {guest.homeGroupName} ({SHIFT_AR[guest.shift]}) · <span className="tabular">{guest.universityNumber}</span>
      </div>
      {p && (
        <p className="note ok small">
          قُيّم في مجموعته
          {p.dateISO ? ` يوم ${p.dateISO}` : ""}
          {p.evaluatorName ? ` — ${p.evaluatorName}` : ""}
          {p.total !== undefined ? ` — ${r2(p.total)}/${maxTotal(bundle)}` : ""}
          {p.notes ? ` — ${p.notes}` : ""}
        </p>
      )}
      {today && <p className="note warn small">قُيّم اليوم أيضًا في {today.groupName} ({today.evaluatorName}) — يقرّر المدير أي التقييمين يُعتمد.</p>}
      {days.length > 0 && (
        <details>
          <summary className="muted small">تقييماته المسجّلة ({days.length})</summary>
          <EvaluatedList days={days} dateISO={dateISO} max={maxTotal(bundle)} />
        </details>
      )}
    </div>
  );
}
