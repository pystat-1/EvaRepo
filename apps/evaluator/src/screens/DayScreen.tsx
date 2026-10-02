import { useEffect, useRef, useState } from "react";
import type { EvaluatorBundle, HistoryRecord } from "@eva/core/sync/contract";
import { getDraft, putDraft, queueValidatedDay, type Session } from "../lib/store";
import { buildSubmission, compactColumns, draftKey, gradeColumns, groupsForDate, maxTotal, missing, rowTotal, type Draft, type DraftRow } from "../lib/day";
import { ATTENDANCE_AR, ATTENDANCE_MARK, draftRecord, weekdayAr, type DayEntry } from "../lib/views";
import { DownloadMenu } from "../components/DownloadMenu";
import { dayExcel, dayWord, type DayMeta } from "../lib/exports";

const emptyRow = (): DraftRow => ({ attendance: null, dailyNote: null, scores: {}, touched: false });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A desktop record shown read-only. */
function recordRow(bundle: EvaluatorBundle, r: HistoryRecord): DraftRow {
  const scores: Record<string, number> = { ...(r.items ?? {}) };
  for (const s of bundle.rubric) if (!s.items.length && scores[s.id] === undefined && r.sections[s.id] !== undefined) scores[s.id] = r.sections[s.id];
  return { attendance: r.attendance, dailyNote: r.dailyNote, scores, touched: true, notes: r.notes };
}

// A tap on the attendance cell moves to the next state.
const NEXT_ATTENDANCE = { present: "late", late: "absent", absent: "present" } as const;

const WIDE = "(min-width: 760px)";
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

type View = "work" | "review";

// One group's day, in two tabs. التقييم: the work — the group's table (on a
// phone, narrow enough that the criteria fit with little sideways scrolling);
// a tap on a student's name opens that student's card with large controls.
// تقييم اليوم: the final review — attendance and every student's marks,
// where the day is validated (اعتماد) and queued for the manager. Every
// change is saved on the phone at once (draft). A day the desktop already
// has (the evaluator's own or a colleague's) opens read-only.
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
  const ccols = compactColumns(bundle);
  const wide = useWide();
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [current, setCurrent] = useState<number | null>(null); // the student whose card is open
  const lastCard = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getDraft(id, key).then((d) => setDraft(d));
  }, [id, key]);

  // Back on the table: keep the student just graded in sight.
  useEffect(() => {
    if (current === null && lastCard.current) document.getElementById(`row-${lastCard.current}`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!group || draft === undefined) return <div className="center muted pad">…</div>;

  const onDesktop = entries.filter((e) => e.groupId === groupId && e.dateISO === dateISO && e.state === "applied").sort((a, b) => Number(b.mine) - Number(a.mine))[0];
  const fromDesktop = !draft && onDesktop ? onDesktop : null;
  const working: Draft = draft ?? { key, groupId, dateISO, rows: {}, status: "draft", updatedAt: new Date().toISOString() };
  const locked = working.status === "validated" || !!fromDesktop;
  const tab: View = view ?? (locked ? "review" : "work");
  const rowOf = (sid: string): DraftRow | undefined => {
    if (fromDesktop) {
      const r = fromDesktop.records.get(sid);
      return r ? recordRow(bundle, r) : undefined;
    }
    return working.rows[sid];
  };
  const totalOf = (sid: string, r: DraftRow) => (fromDesktop ? (fromDesktop.records.get(sid)?.total ?? 0) : rowTotal(bundle, r));

  // Always from the latest draft, so quick successive taps all count.
  function update(studentId: string, change: (r: DraftRow) => DraftRow) {
    if (locked) return;
    setDraft((prev) => {
      const base = prev ?? working;
      const next: Draft = { ...base, rows: { ...base.rows, [studentId]: change(base.rows[studentId] ?? emptyRow()) }, updatedAt: new Date().toISOString() };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void putDraft(id, next), 250);
      return next;
    });
    setProblem(null);
  }
  const setScores = (sid: string, values: Record<string, number>) =>
    update(sid, (r) => ({ ...r, attendance: r.attendance ?? "present", scores: { ...r.scores, ...values }, touched: true }));
  const setScore = (sid: string, col: string, value: number) => setScores(sid, { [col]: value });
  const setAttendance = (sid: string, a: DraftRow["attendance"]) => update(sid, (x) => ({ ...x, attendance: a, dailyNote: a === "absent" ? null : x.dailyNote }));
  const setNote = (sid: string, v: boolean | null) => update(sid, (x) => ({ ...x, attendance: x.attendance ?? "present", dailyNote: v }));

  const rows = group.students.map((s) => ({ s, r: rowOf(s.id) }));
  const marked = rows.filter((x) => x.r?.attendance).length;
  const meta: DayMeta = { groupId, dateISO, hospitalName: info?.hospitalName ?? onDesktop?.hospitalName ?? "", evaluatorName: fromDesktop?.evaluatorName ?? bundle.evaluator.name };
  const filled = () =>
    fromDesktop ? fromDesktop.records : new Map(Object.entries(working.rows).filter(([, r]) => r.attendance).map(([sid, r]) => [sid, draftRecord(bundle, sid, r)]));
  const stateOf = (r: DraftRow | undefined) => (!r?.attendance ? "todo" : r.attendance === "absent" ? "absent" : r.touched ? "done" : "half");
  const gaps = locked ? null : missing(bundle, groupId, working);

  const openCard = (i: number) => {
    lastCard.current = rows[i].s.id;
    setView("work");
    setCurrent(i);
    window.scrollTo(0, 0);
  };
  const showTab = (v: View) => {
    setView(v);
    setCurrent(null);
    setConfirming(false);
  };

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

  const numberInput = (sid: string, name: string, colId: string, label: string, max: number, r: DraftRow | undefined, absent: boolean) => (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      step="0.01"
      aria-label={`${label} — ${name}`}
      value={absent || r?.scores[colId] === undefined ? "" : r.scores[colId]}
      placeholder="0"
      disabled={locked || absent}
      onChange={(e) => {
        const v = e.target.value === "" ? 0 : Math.max(0, Math.min(max, r2(Number(e.target.value))));
        if (Number.isFinite(v)) setScore(sid, colId, v);
      }}
    />
  );

  return (
    <div className="day">
      <header className="day-head">
        <button className="btn ghost back" onClick={onBack} aria-label="رجوع">
          ‹
        </button>
        <div className="grow min0">
          <b className="ellipsis">{group.name}</b>
          <div className="muted small ellipsis">
            {weekdayAr(dateISO)} {dateISO} · {meta.hospitalName}
            {info && !info.scheduled ? " · خارج الجدول" : ""}
          </div>
        </div>
        <DownloadMenu
          label=""
          items={[
            { label: "التقييم اليومي — Excel", run: () => dayExcel(bundle, meta, filled()), disabled: marked === 0 },
            { label: "التقييم اليومي — Word", run: () => dayWord(bundle, meta, filled()), disabled: marked === 0 },
            { label: "قالب فارغ للطباعة — Word", run: () => dayWord(bundle, meta, null) },
            { label: "قالب فارغ للطباعة — Excel", run: () => dayExcel(bundle, meta, null) },
          ]}
        />
      </header>

      <div className="row between">
        <div className="seg small-seg" role="tablist" aria-label="أقسام اليوم">
          <button role="tab" aria-selected={tab === "work"} className={tab === "work" ? "on" : ""} onClick={() => showTab("work")}>
            التقييم
          </button>
          <button role="tab" aria-selected={tab === "review"} className={tab === "review" ? "on" : ""} onClick={() => showTab("review")}>
            تقييم اليوم
          </button>
        </div>
        <span className="muted small">
          {marked}/{group.students.length} طالب
        </span>
      </div>

      {fromDesktop && (
        <p className="note ok">{fromDesktop.mine ? "هذا اليوم معتمد لدى المدير — للعرض فقط." : `قيّم هذا اليوم زميلك ${fromDesktop.evaluatorName} — للعرض فقط.`}</p>
      )}
      {!fromDesktop && working.status === "validated" && (
        <p className="note ok">{onDesktop?.mine ? "وصل للمدير ✓ — للعرض فقط." : "هذا اليوم معتمد — لا يمكن تعديله. يصل للمدير عند المزامنة."}</p>
      )}

      {tab === "work" && current !== null ? (
        <>
          <div className="row between">
            <button className="btn tiny" onClick={() => setCurrent(null)}>
              ‹ قائمة الطلاب
            </button>
          </div>
          <div className="picker" role="tablist" aria-label="الطلاب">
            {rows.map(({ s, r }, i) => (
              <button key={s.id} role="tab" aria-selected={i === current} className={`pick ${stateOf(r)} ${i === current ? "on" : ""}`} onClick={() => openCard(i)} title={s.name}>
                {i + 1}
              </button>
            ))}
          </div>
          <StudentCard
            bundle={bundle}
            index={current}
            count={rows.length}
            name={rows[current].s.name}
            row={rows[current].r}
            total={rows[current].r?.attendance ? totalOf(rows[current].s.id, rows[current].r!) : null}
            locked={locked}
            onAttendance={(a) => setAttendance(rows[current].s.id, a)}
            onNote={(v) => setNote(rows[current].s.id, v)}
            onScores={(values) => setScores(rows[current].s.id, values)}
            onPrev={() => openCard(Math.max(0, current - 1))}
            onNext={() => openCard(Math.min(rows.length - 1, current + 1))}
          />
        </>
      ) : tab === "work" && wide ? (
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
                  <tr key={s.id} id={`row-${s.id}`} className={absent ? "absent" : undefined}>
                    <th className="sticky-name" scope="row">
                      <button className="name-btn" onClick={() => openCard(i)}>
                        <span className="idx">{i + 1}</span> {s.name}
                      </button>
                    </th>
                    <td>
                      <select aria-label={`حضور ${s.name}`} value={r?.attendance ?? ""} disabled={locked} onChange={(e) => setAttendance(s.id, (e.target.value || null) as DraftRow["attendance"])}>
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
                        onChange={(e) => setNote(s.id, e.target.value === "1" ? true : e.target.value === "0" ? false : null)}
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
                          numberInput(s.id, s.name, c.id, c.label, c.max, r, absent)
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
      ) : tab === "work" ? (
        <>
          <p className="muted small hint">اضغط اسم الطالب لفتح بطاقته وتعديل كل بند على حدة. خانة البنود تمنح البند كاملًا أو تمسحه.</p>
          <div className="grid-wrap" role="region" aria-label="جدول الدرجات" tabIndex={0}>
            <table className="grid cgrid">
              <thead>
                <tr>
                  <th className="sticky-name">
                    الطالب <small>/{maxTotal(bundle)}</small>
                  </th>
                  <th>حضور</th>
                  <th>ديلي نوت</th>
                  {ccols.map((c) => (
                    <th key={c.id} title={c.label}>
                      {c.label}
                      <small>/{c.max}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ s, r }, i) => {
                  const absent = r?.attendance === "absent";
                  return (
                    <tr key={s.id} id={`row-${s.id}`} className={absent ? "absent" : undefined}>
                      <th className="sticky-name" scope="row">
                        <button className="name-btn" onClick={() => openCard(i)}>
                          <span className="idx">{i + 1}</span> {s.name}
                          <span className="name-total">{r?.attendance ? r2(totalOf(s.id, r)) : "—"}</span>
                        </button>
                      </th>
                      <td>
                        <button
                          className={`cyc att-${r?.attendance ?? "none"}`}
                          disabled={locked}
                          aria-label={`حضور ${s.name}: ${r?.attendance ? ATTENDANCE_AR[r.attendance] : "لم يُسجَّل"}`}
                          onClick={() => setAttendance(s.id, r?.attendance ? NEXT_ATTENDANCE[r.attendance] : "present")}
                        >
                          {r?.attendance ? ATTENDANCE_MARK[r.attendance] : "—"}
                        </button>
                      </td>
                      <td>
                        {!absent && (
                          <button
                            className={`cyc ${r?.dailyNote === true ? "yes" : r?.dailyNote === false ? "no" : ""}`}
                            disabled={locked}
                            aria-label={`الديلي نوت ${s.name}: ${r?.dailyNote === true ? "سلّم" : r?.dailyNote === false ? "لم يسلّم" : "لم يُسجَّل"}`}
                            onClick={() => setNote(s.id, r?.dailyNote !== true)}
                          >
                            {r?.dailyNote === true ? "✓" : r?.dailyNote === false ? "✗" : "—"}
                          </button>
                        )}
                      </td>
                      {ccols.map((c) => {
                        if (c.kind === "number") return <td key={c.id}>{numberInput(s.id, s.name, c.id, c.label, c.max, r, absent)}</td>;
                        if (absent) return <td key={c.id} />;
                        const sum = r2(Math.min(c.max, c.items.reduce((a, it) => a + (r?.scores[it.id] ?? 0), 0)));
                        const full = sum >= c.max;
                        return (
                          <td key={c.id}>
                            <button
                              className={`cyc ${full ? "yes" : sum > 0 ? "part" : ""}`}
                              disabled={locked}
                              aria-pressed={full}
                              aria-label={`${c.label} — ${s.name}: ${sum} من ${c.max}`}
                              onClick={() => setScores(s.id, Object.fromEntries(c.items.map((it) => [it.id, full ? 0 : it.max])))}
                            >
                              {r?.touched ? sum : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!locked && (
            <button className="btn" onClick={() => showTab("review")}>
              مراجعة تقييم اليوم واعتماده ›
            </button>
          )}
        </>
      ) : (
        <DayReview bundle={bundle} students={group.students} records={filled()} gaps={gaps} onOpen={openCard} />
      )}

      {tab === "review" && problem && (
        <p className="note err" role="alert">
          لا يمكن الاعتماد بعد — {problem}
        </p>
      )}
      {tab === "review" && !locked && (
        <div className="validate-bar">
          {!confirming ? (
            <button className="btn primary big" onClick={() => setConfirming(true)}>
              اعتماد اليوم وإرساله للمدير ({marked}/{group.students.length})
            </button>
          ) : (
            <>
              <p>
                اعتماد درجات {group.students.length} طالب ليوم {dateISO}؟ لا يمكن التعديل بعده.
              </p>
              <div className="row">
                <button className="btn primary big grow" onClick={validate}>
                  نعم، اعتماد
                </button>
                <button className="btn big grow" onClick={() => setConfirming(false)}>
                  إلغاء
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// تقييم اليوم: the day as it will reach the manager — attendance, the daily
// note, each criterion's mark and the total, read-only. A tap on a student
// opens their card to correct it.
function DayReview({
  bundle,
  students,
  records,
  gaps,
  onOpen,
}: {
  bundle: EvaluatorBundle;
  students: EvaluatorBundle["groups"][number]["students"];
  records: Map<string, HistoryRecord>;
  gaps: ReturnType<typeof missing> | null;
  onOpen: (i: number) => void;
}) {
  const recs = students.map((s) => records.get(s.id));
  const count = (a: HistoryRecord["attendance"]) => recs.filter((r) => r?.attendance === a).length;
  const attended = recs.filter((r): r is HistoryRecord => !!r && r.attendance !== "absent");
  const avg = attended.length ? attended.reduce((a, r) => a + r.total, 0) / attended.length : null;
  const gapOf = (name: string) => (gaps?.noAttendance.includes(name) ? "بلا حضور" : gaps?.notGraded.includes(name) ? "بلا درجات" : null);
  const unmarked = recs.filter((r) => !r).length;
  return (
    <>
      <div className="review-sum">
        <span className="att-present">حاضر {count("present")}</span>
        <span className="att-late">متأخر {count("late")}</span>
        <span className="att-absent">غائب {count("absent")}</span>
        {unmarked > 0 && <span>لم يُسجَّل {unmarked}</span>}
        {avg !== null && (
          <span>
            المعدل {avg.toFixed(2)}/{maxTotal(bundle)}
          </span>
        )}
      </div>
      <div className="grid-wrap" role="region" aria-label="تقييم اليوم" tabIndex={0}>
        <table className="grid cgrid review">
          <thead>
            <tr>
              <th className="sticky-name">الطالب</th>
              <th>الحضور</th>
              <th>ديلي نوت</th>
              {bundle.rubric.map((s) => (
                <th key={s.id} title={s.labelAr}>
                  {s.labelAr}
                  <small>/{s.maxScore}</small>
                </th>
              ))}
              <th>
                المجموع<small>/{maxTotal(bundle)}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, i) => {
              const r = recs[i];
              const absent = r?.attendance === "absent";
              const gap = gapOf(s.name);
              return (
                <tr key={s.id} className={gap ? "missing" : absent ? "absent" : undefined}>
                  <th className="sticky-name" scope="row">
                    <button className="name-btn" onClick={() => onOpen(i)}>
                      <span className="idx">{i + 1}</span> {s.name}
                      {gap && <span className="gap">{gap}</span>}
                    </button>
                  </th>
                  <td className={r ? `att-${r.attendance}` : undefined}>{r ? ATTENDANCE_AR[r.attendance] : "—"}</td>
                  <td>{!r || absent ? "" : r.dailyNote === true ? "سلّم" : r.dailyNote === false ? "لم يسلّم" : "—"}</td>
                  {bundle.rubric.map((sec) => (
                    <td key={sec.id}>{!r || absent ? "" : r2(r.sections[sec.id] ?? 0)}</td>
                  ))}
                  <td className="total">{r ? r.total.toFixed(2) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// One student with large touch controls, in the order of the paper form.
function StudentCard({
  bundle,
  index,
  count,
  name,
  row,
  total,
  locked,
  onAttendance,
  onNote,
  onScores,
  onPrev,
  onNext,
}: {
  bundle: EvaluatorBundle;
  index: number;
  count: number;
  name: string;
  row: DraftRow | undefined;
  total: number | null;
  locked: boolean;
  onAttendance: (a: DraftRow["attendance"]) => void;
  onNote: (v: boolean | null) => void;
  onScores: (values: Record<string, number>) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const absent = row?.attendance === "absent";
  const val = (id: string) => row?.scores[id];
  return (
    <div className="card scard">
      <div className="scard-head">
        <span className="muted small">
          {index + 1} / {count}
        </span>
        <b className="scard-name">{name}</b>
        <span className="scard-total">
          {total === null ? "—" : total.toFixed(2)}
          <small>/{maxTotal(bundle)}</small>
        </span>
      </div>

      <div className="field-label">الحضور</div>
      <div className="choice3">
        {(
          [
            ["present", "✓ حاضر"],
            ["late", "م متأخر"],
            ["absent", "✗ غائب"],
          ] as const
        ).map(([a, label]) => (
          <button key={a} className={`choice ${a} ${row?.attendance === a ? "on" : ""}`} disabled={locked} onClick={() => onAttendance(a)}>
            {label}
          </button>
        ))}
      </div>

      {!absent && (
        <>
          <div className="field-label">تسليم الديلي نوت</div>
          <div className="choice2">
            <button className={`choice ${row?.dailyNote === true ? "on" : ""}`} disabled={locked} onClick={() => onNote(true)}>
              سلّم
            </button>
            <button className={`choice ${row?.dailyNote === false ? "on off" : ""}`} disabled={locked} onClick={() => onNote(false)}>
              لم يسلّم
            </button>
          </div>

          {bundle.rubric.map((s) => {
            const items = s.items.length ? s.items : [{ id: s.id, labelAr: s.labelAr, maxScore: s.maxScore, kind: "number" as const }];
            const sum = r2(Math.min(s.maxScore, items.reduce((a, i) => a + (val(i.id) ?? 0), 0)));
            const checks = items.every((i) => i.kind === "check");
            return (
              <section key={s.id} className="crit">
                <div className="crit-head">
                  <b>{s.labelAr}</b>
                  <span className="muted small">{s.labelEn}</span>
                  <span className="grow" />
                  {checks && !locked && (
                    <button className="btn ghost tiny" onClick={() => onScores(Object.fromEntries(items.map((i) => [i.id, sum === s.maxScore ? 0 : i.maxScore])))}>
                      {sum === s.maxScore ? "مسح" : "كامل"}
                    </button>
                  )}
                  <span className="crit-sum">
                    {sum}/{s.maxScore}
                  </span>
                </div>
                <div className={checks ? "chips4" : "nums"}>
                  {items.map((i) =>
                    i.kind === "check" ? (
                      <button
                        key={i.id}
                        className={`chipbtn ${(val(i.id) ?? 0) === i.maxScore ? "on" : ""}`}
                        disabled={locked}
                        aria-pressed={(val(i.id) ?? 0) === i.maxScore}
                        onClick={() => onScores({ [i.id]: (val(i.id) ?? 0) === i.maxScore ? 0 : i.maxScore })}
                      >
                        {i.labelAr}
                        <small>{i.maxScore}</small>
                      </button>
                    ) : (
                      <div key={i.id} className="numrow">
                        <span className="grow">
                          {i.labelAr === s.labelAr ? "الدرجة" : i.labelAr} <small className="muted">/{i.maxScore}</small>
                        </span>
                        <button className="step" disabled={locked} aria-label={`إنقاص ${i.labelAr}`} onClick={() => onScores({ [i.id]: Math.max(0, r2((val(i.id) ?? 0) - 0.5)) })}>
                          −
                        </button>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={i.maxScore}
                          step="0.25"
                          aria-label={i.labelAr}
                          value={val(i.id) ?? ""}
                          placeholder="0"
                          disabled={locked}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : Math.max(0, Math.min(i.maxScore, r2(Number(e.target.value))));
                            if (Number.isFinite(v)) onScores({ [i.id]: v });
                          }}
                        />
                        <button className="step" disabled={locked} aria-label={`زيادة ${i.labelAr}`} onClick={() => onScores({ [i.id]: Math.min(i.maxScore, r2((val(i.id) ?? 0) + 0.5)) })}>
                          +
                        </button>
                      </div>
                    )
                  )}
                </div>
              </section>
            );
          })}
        </>
      )}

      <div className="row scard-nav">
        <button className="btn big grow" onClick={onPrev} disabled={index === 0}>
          ‹ السابق
        </button>
        <button className="btn primary big grow" onClick={onNext} disabled={index === count - 1}>
          التالي ›
        </button>
      </div>
    </div>
  );
}
