import { useState } from "react";
import type { EvaluatorBundle, TeamMember } from "@eva/core/sync/contract";
import { matchesSearch } from "@eva/core/text/arabic";
import { maxTotal } from "../lib/day";
import { weekdayAr } from "../lib/views";

const when = (iso: string) =>
  new Date(iso).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" });

// المقيّمون (supervisors only): every evaluator of the course — what they
// cover, whether they have signed in on a phone, what they have sent — and
// a tap shows the days they graded (each opens read-only).
export function Team({ bundle, onOpen }: { bundle: EvaluatorBundle; onOpen: (x: { groupId: string; dateISO: string }) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const team = bundle.team ?? [];
  const shown = team
    .filter((m) => matchesSearch(q, m.name, m.email, ...m.covers.map((c) => `${c.hospitalName} ${c.groupName ?? ""}`)))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "ar"));
  const groupName = (id: string) => bundle.groups.find((g) => g.id === id)?.name ?? "—";
  const hospitalName = (id: string | null) => bundle.hospitals.find((h) => h.id === id)?.name ?? "";
  const daysOf = (m: TeamMember) => (bundle.history ?? []).filter((d) => d.evaluatorId === m.id).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const active = team.filter((m) => m.active);

  return (
    <>
      <div className="row between">
        <h2>المقيّمون</h2>
        <span className="muted small">
          {active.length} فعّال · دخل من الهاتف {active.filter((m) => m.phone).length} · تعارضات {team.reduce((a, m) => a + m.openConflicts, 0)}
        </span>
      </div>
      <input className="input" type="search" placeholder="بحث بالاسم أو البريد أو المستشفى…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      {shown.length === 0 && <p className="muted">لا نتائج.</p>}
      {shown.map((m) => {
        const days = daysOf(m);
        return (
          <div key={m.id} className={`card member ${m.active ? "" : "dim"}`}>
            <button className="student-head" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
              <div className="grow min0">
                <b>{m.name}</b>
                <div className="muted small ltr ellipsis">{m.email}</div>
                <div className="tags">
                  {!m.active && <span className="tag">معطّل</span>}
                  {m.supervisor && <span className="tag sup">مشرف</span>}
                  {m.phone ? <span className="tag ok">دخل من الهاتف</span> : <span className="tag warn">لم يدخل من الهاتف</span>}
                  {m.openConflicts > 0 && <span className="tag err">{m.openConflicts} تعارض</span>}
                </div>
              </div>
              <div className="student-stats">
                <b>{m.daysApplied}</b>
                <span className="muted small">يوم معتمد</span>
              </div>
            </button>
            {open === m.id && (
              <div className="student-days">
                <p className="muted small">
                  {m.covers.length
                    ? m.covers.map((c) => `${c.hospitalName} · ${c.groupName ?? "كل المجموعات"}`).join("، ")
                    : m.supervisor
                      ? "مشرف على كل المستشفيات"
                      : "لا يغطي أي مستشفى"}
                </p>
                <p className="muted small">
                  {m.phone ? `آخر دخول: ${when(m.phone.lastLoginAt)}${m.phone.lastSeenAt ? ` · آخر ظهور: ${when(m.phone.lastSeenAt)}` : ""}` : "لم يدخل من الهاتف بعد"}
                  {m.lastReceivedAt && ` · آخر إرسال: ${when(m.lastReceivedAt)}`}
                </p>
                {days.length === 0 && <p className="muted small">لا أيام معتمدة بعد.</p>}
                {days.map((d) => {
                  const attended = d.records.filter((r) => r.attendance !== "absent");
                  const avg = attended.length ? attended.reduce((a, r) => a + r.total, 0) / attended.length : null;
                  return (
                    <button key={`${d.groupId}:${d.dateISO}`} className="row between small day-line link-line" onClick={() => onOpen({ groupId: d.groupId, dateISO: d.dateISO })}>
                      <span>
                        {weekdayAr(d.dateISO)} {d.dateISO}
                      </span>
                      <span className="grow ellipsis">
                        {groupName(d.groupId)} · {hospitalName(d.hospitalId)}
                      </span>
                      <span>
                        {d.records.length} طالب{avg !== null && ` · ${avg.toFixed(2)}/${maxTotal(bundle)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
