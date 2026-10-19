import { useState } from "react";
import type { EvaluatorBundle, GuestInfo, PriorEvaluation } from "@eva/core/sync/contract";
import { matchesSearch } from "@eva/core/text/arabic";
import { evaluatedDays, guestGroups, guestProblem, maxTotal, type Draft } from "../lib/day";
import { ATTENDANCE_AR, SHIFT_AR } from "../lib/views";
import { EvaluatedList } from "./EvaluatedList";

type Shift = GuestInfo["shift"];
const OTHER = "__other__"; // a group or student not in the list: typed in
const r2 = (n: number) => Math.round(n * 100) / 100;

// إضافة طالب مستضاف: a student from another group, graded with this group
// for this day like any of its students. The evaluator says where they
// come from — another group of the same study type, or the other study
// type (صباحي / مسائي) — and picks them from that group's list (or types
// them in). The days they were already evaluated show at once, and
// «قُيّم في مجموعته» records an evaluation in their own group.
export function AddGuest({
  bundle,
  group,
  dateISO,
  draft,
  onAdd,
  onCancel,
}: {
  bundle: EvaluatorBundle;
  group: { id: string; shift: Shift | null };
  dateISO: string;
  draft: Draft | undefined;
  onAdd: (studentId: string, guest: GuestInfo) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<GuestInfo["kind"] | null>(null);
  const [otherShift, setOtherShift] = useState<Shift | null>(null);
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [q, setQ] = useState("");
  const [prior, setPrior] = useState<{ on: boolean } & PriorEvaluation>({ on: false });
  const [problem, setProblem] = useState<string | null>(null);

  const flip = (s: Shift): Shift => (s === "MORNING" ? "EVENING" : "MORNING");
  // A group without a study type: the evaluator says which one.
  const shift: Shift | null = kind === "same-shift" ? group.shift ?? otherShift : kind === "other-shift" ? (group.shift ? flip(group.shift) : otherShift) : null;
  const groups = shift ? guestGroups(bundle, group.id, shift) : [];
  const listed = groups.find((g) => g.id === groupId);
  const picked = listed?.students.find((s) => s.id === studentId);
  const typed = groupId === OTHER || studentId === OTHER;
  const days = picked ? evaluatedDays(bundle, picked.id) : [];
  const today = days.find((d) => d.dateISO === dateISO);

  function pickStudent(id: string) {
    setStudentId(id);
    setProblem(null);
    const latest = id === OTHER ? undefined : evaluatedDays(bundle, id)[0];
    // Already evaluated: «قُيّم في مجموعته» starts on, with the latest day's data.
    setPrior(latest ? { on: true, dateISO: latest.dateISO, evaluatorName: latest.evaluatorName, total: latest.total } : { on: false });
  }

  function add() {
    if (!kind || !shift) return setProblem("اختر نوع الطالب المستضاف ونوع الدراسة");
    const priorEvaluation: PriorEvaluation | null = prior.on
      ? {
          ...(prior.dateISO ? { dateISO: prior.dateISO } : {}),
          ...(prior.evaluatorName?.trim() ? { evaluatorName: prior.evaluatorName.trim() } : {}),
          ...(prior.total !== undefined && Number.isFinite(prior.total) ? { total: prior.total } : {}),
          ...(prior.notes?.trim() ? { notes: prior.notes.trim() } : {}),
        }
      : null;
    const guest: GuestInfo = {
      kind,
      shift,
      homeGroupId: listed ? listed.id : null,
      homeGroupName: listed ? listed.name : groupName.trim(),
      name: picked ? picked.name : name.trim(),
      universityNumber: picked ? picked.universityNumber : number.trim(),
      priorEvaluation,
    };
    if (!picked && !typed) return setProblem("اختر الطالب من القائمة");
    const p = guestProblem(bundle, group.id, draft, guest);
    if (p) return setProblem(p);
    onAdd(picked ? picked.id : `guest-${crypto.randomUUID()}`, guest);
  }

  const shown = listed ? listed.students.filter((s) => matchesSearch(q, s.name, s.universityNumber)) : [];

  return (
    <div className="card stack guest-add">
      <div className="row between">
        <b>إضافة طالب مستضاف</b>
        <button className="btn ghost tiny" onClick={onCancel}>
          إلغاء
        </button>
      </div>
      <p className="muted small hint">يُضاف لقائمة هذا اليوم فقط، ويُقيَّم مثل بقية طلاب المجموعة.</p>

      <div className="field-label">نوع الطالب المستضاف</div>
      <div className="choice2">
        {(
          [
            ["same-shift", "من مجموعة أخرى", group.shift ? `نفس نوع الدراسة (${SHIFT_AR[group.shift]})` : "نفس نوع الدراسة"],
            ["other-shift", "من نوع دراسة آخر", group.shift ? SHIFT_AR[flip(group.shift)] : "صباحي / مسائي"],
          ] as const
        ).map(([k, label, sub]) => (
          <button
            key={k}
            className={`choice tall ${kind === k ? "on" : ""}`}
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setGroupId("");
              setStudentId("");
              setProblem(null);
            }}
          >
            {label}
            <small>{sub}</small>
          </button>
        ))}
      </div>

      {kind && !group.shift && (
        <>
          <div className="field-label">نوع الدراسة</div>
          <div className="choice2">
            {(["MORNING", "EVENING"] as const).map((s) => (
              <button key={s} className={`choice ${otherShift === s ? "on" : ""}`} aria-pressed={otherShift === s} onClick={() => (setOtherShift(s), setGroupId(""), setStudentId(""))}>
                {SHIFT_AR[s]}
              </button>
            ))}
          </div>
        </>
      )}

      {shift && (
        <label className="field">
          مجموعته ({SHIFT_AR[shift]})
          <select
            className="input"
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setStudentId(e.target.value === OTHER ? OTHER : "");
              setQ("");
              setPrior({ on: false });
              setProblem(null);
            }}
          >
            <option value="">— اختر المجموعة —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.students.length})
              </option>
            ))}
            <option value={OTHER}>مجموعة غير موجودة في القائمة…</option>
          </select>
        </label>
      )}
      {groupId === OTHER && (
        <label className="field">
          اسم المجموعة
          <input className="input" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={`مثلًا: المجموعة ${shift ? (shift === "MORNING" ? "الصباحية" : "المسائية") : ""} 2`} />
        </label>
      )}

      {listed && studentId !== OTHER && (
        <>
          <div className="field-label">الطالب</div>
          <input className="input" type="search" placeholder="بحث بالاسم أو الرقم الجامعي…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن الطالب" />
          <div className="guest-list" role="listbox" aria-label={`طلاب ${listed.name}`}>
            {shown.length === 0 && <p className="muted small">لا نتائج.</p>}
            {shown.map((s) => (
              <button key={s.id} role="option" aria-selected={s.id === studentId} className={`guest-opt ${s.id === studentId ? "on" : ""}`} onClick={() => pickStudent(s.id)}>
                <span className="grow">
                  {s.name}
                  <span className="muted small"> · {s.universityNumber}</span>
                </span>
                {s.evaluated?.length ? <span className="tag ok">قُيّم {s.evaluated.length}</span> : null}
              </button>
            ))}
          </div>
          <button className="link small" onClick={() => pickStudent(OTHER)}>
            الطالب غير موجود في القائمة؟ اكتب بياناته
          </button>
        </>
      )}

      {typed && shift && (
        <>
          <label className="field">
            اسم الطالب
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            الرقم الجامعي
            <input className="input ltr" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" autoComplete="off" />
          </label>
        </>
      )}

      {picked && (
        <div className="stack tight">
          <div className="field-label">تقييماته المسجّلة</div>
          {days.length === 0 ? (
            <p className="muted small">لا توجد تقييمات مسجّلة لهذا الطالب بعد.</p>
          ) : (
            <EvaluatedList days={days} dateISO={dateISO} max={maxTotal(bundle)} />
          )}
          {today && (
            <p className="note warn" role="alert">
              قُيّم هذا الطالب اليوم في {today.groupName} ({today.evaluatorName}، {today.attendance === "absent" ? ATTENDANCE_AR.absent : `${r2(today.total)}/${maxTotal(bundle)}`}). إن قيّمته هنا أيضًا
              فسيقرّر المدير أي التقييمين يُعتمد.
            </p>
          )}
        </div>
      )}

      {shift && (picked || typed) && (
        <div className="stack tight prior">
          <label className="row check">
            <input type="checkbox" checked={prior.on} onChange={(e) => setPrior({ ...prior, on: e.target.checked })} />
            <b>قُيّم في مجموعته</b>
          </label>
          {prior.on && (
            <>
              <p className="muted small hint">بيانات التقييم الذي حصل عليه في مجموعته (اختيارية) — تصل للمدير مع اليوم.</p>
              <div className="row">
                <label className="field grow">
                  التاريخ
                  <input className="input" type="date" value={prior.dateISO ?? ""} onChange={(e) => setPrior({ ...prior, dateISO: e.target.value || undefined })} />
                </label>
                <label className="field grow">
                  الدرجة /{maxTotal(bundle)}
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={maxTotal(bundle)}
                    step="0.25"
                    value={prior.total ?? ""}
                    onChange={(e) => setPrior({ ...prior, total: e.target.value === "" ? undefined : Math.max(0, Math.min(maxTotal(bundle), r2(Number(e.target.value)))) })}
                  />
                </label>
              </div>
              <label className="field">
                المقيّم
                <input className="input" value={prior.evaluatorName ?? ""} onChange={(e) => setPrior({ ...prior, evaluatorName: e.target.value })} />
              </label>
              <label className="field">
                ملاحظة
                <input className="input" value={prior.notes ?? ""} onChange={(e) => setPrior({ ...prior, notes: e.target.value })} placeholder="مثلًا: قُيّم في مستشفى آخر" />
              </label>
            </>
          )}
        </div>
      )}

      {problem && (
        <p className="note err" role="alert">
          {problem}
        </p>
      )}
      <button className="btn primary big" onClick={add} disabled={!shift || !(picked || typed)}>
        إضافة إلى قائمة اليوم
      </button>
    </div>
  );
}
