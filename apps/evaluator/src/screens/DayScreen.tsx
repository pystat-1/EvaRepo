import { useEffect, useRef, useState } from "react";
import type { EvaluatorBundle, HistoryRecord } from "@eva/core/sync/contract";
import { getDraft, putDraft, queueValidatedDay, type Session } from "../lib/store";
import { buildSubmission, draftKey, gradeColumns, groupsForDate, maxTotal, missing, rowTotal, type Draft, type DraftRow } from "../lib/day";
import { draftRecord, weekdayAr, type DayEntry } from "../lib/views";
import { DownloadMenu } from "../components/DownloadMenu";
import { dayExcel, dayWord, type DayMeta } from "../lib/exports";

const emptyRow = (): DraftRow => ({ attendance: null, dailyNote: null, scores: {}, touched: false });

/** A desktop record shown in the grid (read-only). */
function recordRow(bundle: EvaluatorBundle, r: HistoryRecord): DraftRow {
  const scores: Record<string, number> = { ...(r.items ?? {}) };
  for (const s of bundle.rubric) if (!s.items.length && scores[s.id] === undefined && r.sections[s.id] !== undefined) scores[s.id] = r.sections[s.id];
  return { attendance: r.attendance, dailyNote: r.dailyNote, scores, touched: true, notes: r.notes };
}

// One group's day: students x criteria, the name column and the header stay
// fixed while scrolling. Every change is saved to the phone at once
// (draft); اعتماد closes the day and queues it for sending. A day the
// desktop already has (from this evaluator or a colleague) opens read-only.
export function DayScreen({
  session,
  bundle,
  groupId,
  dateISO,
  entries,
  onBack,
  onValidated,
}: {
  session: Session;
  bundle: EvaluatorBundle;
  groupId: string;
  dateISO: string;
  entries: DayEntry[];
  onBack: () => void;
  onValidated: () => void;
}) {
  const id = session.evaluator.id;
  const key = draftKey(groupId, dateISO);
  const group = bundle.groups.find((g) => g.id === groupId);
  const info = groupsForDate(bundle, dateISO).find((g) => g.id === groupId);
  const columns = gradeColumns(bundle);
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getDraft(id, key).then((d) => setDraft(d));
  }, [id, key]);

  if (!group || draft === undefined) return <div className="screen center muted">…</div>;

  // What the desktop already holds for this group-day (mine first).
  const onDesktop = entries.filter((e) => e.groupId === groupId && e.dateISO === dateISO && e.state === "applied").sort((a, b) => Number(b.mine) - Number(a.mine))[0];
  const fromDesktop = !draft && onDesktop ? onDesktop : null;
  const working: Draft = draft ?? { key, groupId, dateISO, rows: {}, status: "draft", updatedAt: new Date().toISOString() };
  const locked = working.status === "validated" || !!fromDesktop;
  const rowOf = (sid: string): DraftRow | undefined => {
    if (fromDesktop) {
      const r = fromDesktop.records.get(sid);
      return r ? recordRow(bundle, r) : undefined;
    }
    return working.rows[sid];
  };
  const totalOf = (sid: string, r: DraftRow) => (fromDesktop ? (fromDesktop.records.get(sid)?.total ?? 0) : rowTotal(bundle, r));

  function update(studentId: string, change: (r: DraftRow) => DraftRow) {
    if (locked) return;
    const next: Draft = { ...working, rows: { ...working.rows, [studentId]: change(working.rows[studentId] ?? emptyRow()) }, updatedAt: new Date().toISOString() };
    setDraft(next);
    setProblem(null);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void putDraft(id, next), 250);
  }

  const setScore = (sid: string, col: string, value: number) =>
    update(sid, (r) => ({ ...r, attendance: r.attendance ?? "present", scores: { ...r.scores, [col]: value }, touched: true }));

  async function validate() {
    const m = missing(bundle, groupId, working);
    if (!m.ok) {
      const parts = [m.noAttendance.length ? `بلا حضور: ${m.noAttendance.join("، ")}` : "", m.notGraded.length ? `بلا درجات: ${m.notGraded.join("، ")}` : ""];
      setProblem(parts.filter(Boolean).join(" · "));
      setConfirming(false);
      return;
    }
    clearTimeout(saveTimer.current);
    const sub = buildSubmission(bundle, working, crypto.randomUUID(), new Date());
    await queueValidatedDay(id, working, sub);
    onValidated();
  }

  const rows = group.students.map((s) => ({ s, r: rowOf(s.id) }));
  const marked = rows.filter((x) => x.r?.attendance).length;
  const meta: DayMeta = {
    groupId,
    dateISO,
    hospitalName: info?.hospitalName ?? onDesktop?.hospitalName ?? "",
    evaluatorName: fromDesktop?.evaluatorName ?? bundle.evaluator.name,
  };
  const filled = () =>
    fromDesktop
      ? fromDesktop.records
      : new Map(Object.entries(working.rows).filter(([, r]) => r.attendance).map(([sid, r]) => [sid, draftRecord(bundle, sid, r)]));

  return (
    <div className="screen day">
      <header className="top">
        <button className="btn ghost" onClick={onBack} aria-label="رجوع">
          ‹ رجوع
        </button>
        <div className="grow">
          <b>{group.name}</b>
          <div className="muted small">
            {weekdayAr(dateISO)} {dateISO} · {meta.hospitalName} {info && !info.scheduled ? "· خارج الجدول" : ""}
          </div>
        </div>
        <DownloadMenu
          items={[
            { label: "درجات اليوم — Excel", run: () => dayExcel(bundle, meta, filled()), disabled: marked === 0 },
            { label: "درجات اليوم — Word", run: () => dayWord(bundle, meta, filled()), disabled: marked === 0 },
            { label: "قالب فارغ للطباعة — Word", run: () => dayWord(bundle, meta, null) },
            { label: "قالب فارغ للطباعة — Excel", run: () => dayExcel(bundle, meta, null) },
          ]}
        />
      </header>
      <div className="muted small">
        {marked}/{group.students.length} طالب
      </div>
      {fromDesktop && (
        <p className="note ok">
          {fromDesktop.mine ? "هذا اليوم معتمد لدى المدير — للعرض فقط." : `قيّم هذا اليوم زميلك ${fromDesktop.evaluatorName} — للعرض فقط.`}
        </p>
      )}
      {!fromDesktop && working.status === "validated" && (
        <p className="note ok">{onDesktop?.mine ? "وصل للمدير ✓ — للعرض فقط." : "هذا اليوم معتمد — لا يمكن تعديله. يصل للمدير عند المزامنة."}</p>
      )}

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
                  <span>
                    {c.label === c.section ? "الدرجة" : c.label} <span className="muted">/{c.max}</span>
                  </span>
                </th>
              ))}
              <th>
                المجموع <span className="muted">/{maxTotal(bundle)}</span>
              </th>
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
                      onChange={(e) =>
                        update(s.id, (x) => ({ ...x, attendance: (e.target.value || null) as DraftRow["attendance"], dailyNote: e.target.value === "absent" ? null : x.dailyNote }))
                      }
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
                      onChange={(e) =>
                        update(s.id, (x) => ({ ...x, attendance: x.attendance ?? "present", dailyNote: e.target.value === "1" ? true : e.target.value === "0" ? false : null }))
                      }
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
                  <td className="total">{r?.attendance ? totalOf(s.id, r).toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {problem && (
        <p className="note err" role="alert">
          لا يمكن الاعتماد بعد — {problem}
        </p>
      )}
      {!locked && (
        <div className="bottom">
          {!confirming ? (
            <button className="btn primary big" onClick={() => setConfirming(true)}>
              اعتماد اليوم وإرساله للمدير
            </button>
          ) : (
            <>
              <p>
                اعتماد درجات {group.students.length} طالب ليوم {dateISO}؟ لا يمكن التعديل بعده.
              </p>
              <div className="row">
                <button className="btn primary big" onClick={validate}>
                  نعم، اعتماد
                </button>
                <button className="btn big" onClick={() => setConfirming(false)}>
                  إلغاء
                </button>
              </div>
            </>
          )}
          <p className="muted small">تُحفظ الدرجات على الهاتف فورًا (حتى دون اتصال) ويمكن تعديلها حتى الاعتماد.</p>
        </div>
      )}
    </div>
  );
}
