import { useEffect, useRef, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { getDraft, putDraft, queueValidatedDay, type Session } from "../lib/store";
import { buildSubmission, draftKey, gradeColumns, groupsForDate, maxTotal, missing, rowTotal, type Draft, type DraftRow } from "../lib/day";

const emptyRow = (): DraftRow => ({ attendance: null, dailyNote: null, scores: {}, touched: false });

// One group's day: students x criteria, the name column and the header stay
// fixed while scrolling. Every change is saved to the phone at once
// (draft); اعتماد closes the day and queues it for sending.
export function DayScreen({
  session,
  bundle,
  groupId,
  dateISO,
  onBack,
  onValidated,
}: {
  session: Session;
  bundle: EvaluatorBundle;
  groupId: string;
  dateISO: string;
  onBack: () => void;
  onValidated: () => void;
}) {
  const id = session.evaluator.id;
  const key = draftKey(groupId, dateISO);
  const group = bundle.groups.find((g) => g.id === groupId);
  const info = groupsForDate(bundle, dateISO).find((g) => g.id === groupId);
  const columns = gradeColumns(bundle);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getDraft(id, key).then((d) => setDraft(d ?? { key, groupId, dateISO, rows: {}, status: "draft", updatedAt: new Date().toISOString() }));
  }, [id, key, groupId, dateISO]);

  if (!group || !draft) return <div className="screen center muted">…</div>;
  const locked = draft.status === "validated";

  function update(studentId: string, change: (r: DraftRow) => DraftRow) {
    if (locked || !draft) return;
    const next: Draft = { ...draft, rows: { ...draft.rows, [studentId]: change(draft.rows[studentId] ?? emptyRow()) }, updatedAt: new Date().toISOString() };
    setDraft(next);
    setProblem(null);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void putDraft(id, next), 250);
  }

  const setScore = (sid: string, col: string, value: number) =>
    update(sid, (r) => ({ ...r, attendance: r.attendance ?? "present", scores: { ...r.scores, [col]: value }, touched: true }));

  async function validate() {
    const m = missing(bundle, groupId, draft!);
    if (!m.ok) {
      const parts = [m.noAttendance.length ? `بلا حضور: ${m.noAttendance.join("، ")}` : "", m.notGraded.length ? `بلا درجات: ${m.notGraded.join("، ")}` : ""];
      setProblem(parts.filter(Boolean).join(" · "));
      setConfirming(false);
      return;
    }
    clearTimeout(saveTimer.current);
    const sub = buildSubmission(bundle, draft!, crypto.randomUUID(), new Date());
    await queueValidatedDay(id, draft!, sub);
    onValidated();
  }

  const rows = group.students.map((s) => ({ s, r: draft.rows[s.id] }));
  const marked = rows.filter((x) => x.r?.attendance).length;

  return (
    <div className="screen day">
      <header className="top">
        <button className="btn ghost" onClick={onBack} aria-label="رجوع">‹ رجوع</button>
        <div className="grow">
          <b>{group.name}</b>
          <div className="muted small">
            {dateISO} · {info?.hospitalName ?? ""} {info && !info.scheduled ? "· خارج الجدول" : ""}
          </div>
        </div>
        <span className="muted small">{marked}/{group.students.length}</span>
      </header>
      {locked && <p className="note ok">هذا اليوم معتمد — لا يمكن تعديله. يصل للمدير عند المزامنة.</p>}

      <div className="grid-wrap" role="region" aria-label="جدول الدرجات" tabIndex={0}>
        <table className="grid">
          <thead>
            <tr>
              <th className="sticky-name">الطالب</th>
              <th>الحضور</th>
              <th>الديلي نوت</th>
              {columns.map((c) => (
                <th key={c.id} className={c.first ? "sec" : undefined} title={`${c.section} — ${c.label}`}>
                  <span className="sec-name">{c.section}</span>
                  <span>{c.label === c.section ? "الدرجة" : c.label} <span className="muted">/{c.max}</span></span>
                </th>
              ))}
              <th>المجموع <span className="muted">/{maxTotal(bundle)}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, r }, i) => {
              const absent = r?.attendance === "absent";
              return (
                <tr key={s.id} className={absent ? "absent" : undefined}>
                  <th className="sticky-name" scope="row">
                    <span className="idx">{i + 1}</span> {s.name}
                  </th>
                  <td>
                    <select
                      aria-label={`حضور ${s.name}`}
                      value={r?.attendance ?? ""}
                      disabled={locked}
                      onChange={(e) => update(s.id, (x) => ({ ...x, attendance: (e.target.value || null) as DraftRow["attendance"], dailyNote: e.target.value === "absent" ? null : x.dailyNote }))}
                    >
                      <option value="">—</option>
                      <option value="present">✓ حاضر</option>
                      <option value="late">م متأخر</option>
                      <option value="absent">✗ غائب</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`الديلي نوت ${s.name}`}
                      value={r?.dailyNote === true ? "1" : r?.dailyNote === false ? "0" : ""}
                      disabled={locked || absent}
                      onChange={(e) => update(s.id, (x) => ({ ...x, attendance: x.attendance ?? "present", dailyNote: e.target.value === "1" ? true : e.target.value === "0" ? false : null }))}
                    >
                      <option value="">—</option>
                      <option value="1">سلّم</option>
                      <option value="0">لم يسلّم</option>
                    </select>
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className={c.first ? "sec" : undefined}>
                      {c.kind === "check" ? (
                        <input
                          type="checkbox"
                          aria-label={`${c.label} — ${s.name}`}
                          checked={!absent && (r?.scores[c.id] ?? 0) === c.max}
                          disabled={locked || absent}
                          onChange={(e) => setScore(s.id, c.id, e.target.checked ? c.max : 0)}
                        />
                      ) : (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={c.max}
                          step="0.01"
                          aria-label={`${c.label} — ${s.name}`}
                          value={absent || r?.scores[c.id] === undefined ? "" : r.scores[c.id]}
                          placeholder="0"
                          disabled={locked || absent}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : Math.max(0, Math.min(c.max, Math.round(Number(e.target.value) * 100) / 100));
                            if (Number.isFinite(v)) setScore(s.id, c.id, v);
                          }}
                        />
                      )}
                    </td>
                  ))}
                  <td className="total">{r?.attendance ? rowTotal(bundle, r).toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {problem && <p className="note err" role="alert">لا يمكن الاعتماد بعد — {problem}</p>}
      {!locked && (
        <div className="bottom">
          {!confirming ? (
            <button className="btn primary big" onClick={() => setConfirming(true)}>اعتماد اليوم وإرساله للمدير</button>
          ) : (
            <>
              <p>اعتماد درجات {group.students.length} طالب ليوم {dateISO}؟ لا يمكن التعديل بعده.</p>
              <div className="row">
                <button className="btn primary big" onClick={validate}>نعم، اعتماد</button>
                <button className="btn big" onClick={() => setConfirming(false)}>إلغاء</button>
              </div>
            </>
          )}
          <p className="muted small">تُحفظ الدرجات على الهاتف فورًا (حتى دون اتصال) ويمكن تعديلها حتى الاعتماد.</p>
        </div>
      )}
    </div>
  );
}
