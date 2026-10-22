import { useEffect, useMemo, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { todayISO } from "@eva/core/date";
import { matchesSearch } from "@eva/core/text/arabic";
import { allAssignments, deleteAssignment, putAssignments, type Assignment } from "../lib/store";
import { assignmentsExcel, assignmentsWord, type AssignmentLine } from "../lib/exports";
import { weekdayAr } from "../lib/views";
import { DownloadMenu } from "../components/DownloadMenu";

// الواجبات: the assignments (واجبات) students hand in — student, assignment
// and date — kept on this phone (works offline), filtered by group or
// searched, and downloaded as Excel or Word. One assignment can be
// recorded for several students at once. A colleague's assignments arrive
// with their shares («الزملاء») and are marked with who sent them.
export function Assignments({ evaluatorId, bundle, tick }: { evaluatorId: string; bundle: EvaluatorBundle; tick: number }) {
  const [list, setList] = useState<Assignment[]>([]);
  const [adding, setAdding] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [q, setQ] = useState("");
  const [sure, setSure] = useState<string | null>(null);
  const reload = () => allAssignments(evaluatorId).then(setList);
  useEffect(() => {
    void allAssignments(evaluatorId).then(setList);
  }, [evaluatorId, tick]);

  const groupName = (id: string) => bundle.groups.find((g) => g.id === id)?.name ?? "";
  const shown = useMemo(
    () =>
      list
        .filter((a) => (!groupId || a.groupId === groupId) && matchesSearch(q, a.studentName, a.universityNumber, a.title))
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || a.title.localeCompare(b.title, "ar") || a.studentName.localeCompare(b.studentName, "ar")),
    [list, groupId, q]
  );
  const lines = (): AssignmentLine[] => shown.map((a) => ({ ...a, groupName: groupName(a.groupId) }));
  const byDate = shown.reduce((m, a) => m.set(a.dateISO, [...(m.get(a.dateISO) ?? []), a]), new Map<string, Assignment[]>());

  return (
    <>
      <div className="row between">
        <h2>الواجبات</h2>
        <DownloadMenu
          items={[
            { label: "قائمة الواجبات — Excel", run: () => assignmentsExcel(bundle, lines()), disabled: shown.length === 0 },
            { label: "قائمة الواجبات — Word", run: () => assignmentsWord(bundle, lines()), disabled: shown.length === 0 },
          ]}
        />
      </div>
      {adding ? (
        <AddAssignment
          bundle={bundle}
          titles={[...new Set(list.map((a) => a.title))]}
          initialGroup={groupId}
          onCancel={() => setAdding(false)}
          onSave={async (items) => {
            await putAssignments(evaluatorId, items);
            setAdding(false);
            await reload();
          }}
        />
      ) : (
        <button className="btn primary big" onClick={() => setAdding(true)}>
          ＋ تسجيل واجب
        </button>
      )}
      <input className="input" type="search" placeholder="بحث بالطالب أو الواجب…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="المجموعة">
        <option value="">كل المجموعات</option>
        {bundle.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <p className="muted small">
        {shown.length} واجب{list.length !== shown.length ? ` من ${list.length}` : ""} · التنزيل يشمل ما يظهر هنا.
      </p>
      {list.length === 0 && <p className="muted">لم يُسجَّل أي واجب بعد.</p>}
      {[...byDate].map(([date, items]) => (
        <section key={date} className="card stack tight">
          <b>
            {weekdayAr(date)} {date}
          </b>
          {items.map((a) => (
            <div key={a.id} className="assign-line">
              <div className="grow min0">
                <div>
                  <b>{a.studentName}</b> <span className="muted small">{a.universityNumber}</span>
                </div>
                <div className="small">
                  {a.title}
                  <span className="muted"> · {groupName(a.groupId)}</span>
                  {a.from && <span className="tag">من {a.from}</span>}
                </div>
                {a.notes && <div className="muted small">{a.notes}</div>}
              </div>
              {sure === a.id ? (
                <span className="row">
                  <button
                    className="btn tiny danger"
                    onClick={async () => {
                      await deleteAssignment(evaluatorId, a.id);
                      setSure(null);
                      await reload();
                    }}
                  >
                    حذف
                  </button>
                  <button className="btn tiny" onClick={() => setSure(null)}>
                    لا
                  </button>
                </span>
              ) : (
                <button className="btn ghost tiny" aria-label={`حذف واجب ${a.studentName}`} onClick={() => setSure(a.id)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function AddAssignment({
  bundle,
  titles,
  initialGroup,
  onSave,
  onCancel,
}: {
  bundle: EvaluatorBundle;
  titles: string[];
  initialGroup: string;
  onSave: (items: Assignment[]) => void;
  onCancel: () => void;
}) {
  const [groupId, setGroupId] = useState(initialGroup || bundle.groups[0]?.id || "");
  const [title, setTitle] = useState("");
  const [dateISO, setDateISO] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const group = bundle.groups.find((g) => g.id === groupId);
  const students = (group?.students ?? []).filter((s) => matchesSearch(q, s.name, s.universityNumber));
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  function save() {
    if (!title.trim()) return setProblem("اكتب اسم الواجب");
    if (!dateISO) return setProblem("اختر التاريخ");
    if (picked.size === 0) return setProblem("اختر طالبًا واحدًا على الأقل");
    const now = new Date().toISOString();
    onSave(
      (group?.students ?? [])
        .filter((s) => picked.has(s.id))
        .map((s) => ({
          id: crypto.randomUUID(),
          groupId,
          studentId: s.id,
          studentName: s.name,
          universityNumber: s.universityNumber,
          title: title.trim(),
          dateISO,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          createdAt: now,
        }))
    );
  }

  return (
    <div className="card stack">
      <div className="row between">
        <b>تسجيل واجب</b>
        <button className="btn ghost tiny" onClick={onCancel}>
          إلغاء
        </button>
      </div>
      <label className="field">
        اسم الواجب
        <input className="input" list="assignment-titles" value={title} maxLength={200} placeholder="مثلًا: خطة رعاية تمريضية" onChange={(e) => setTitle(e.target.value)} />
        <datalist id="assignment-titles">
          {titles.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <label className="field">
        التاريخ
        <input className="input" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
      </label>
      <label className="field">
        المجموعة
        <select
          className="input"
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value);
            setPicked(new Set());
          }}
        >
          {bundle.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row between">
        <span className="field-label">الطلاب ({picked.size} محدد)</span>
        <button className="btn ghost tiny" onClick={() => setPicked(picked.size === (group?.students.length ?? 0) ? new Set() : new Set(group?.students.map((s) => s.id)))}>
          {picked.size === (group?.students.length ?? 0) && picked.size > 0 ? "إلغاء التحديد" : "تحديد الكل"}
        </button>
      </div>
      <input className="input" type="search" placeholder="بحث عن طالب…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن طالب" />
      <div className="guest-list" role="group" aria-label="الطلاب">
        {students.map((s) => (
          <label key={s.id} className={`guest-opt ${picked.has(s.id) ? "on" : ""}`}>
            <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
            <span className="grow">{s.name}</span>
            <span className="muted small">{s.universityNumber}</span>
          </label>
        ))}
        {students.length === 0 && <p className="muted small pad-s">لا نتائج.</p>}
      </div>
      <label className="field">
        ملاحظة (اختياري)
        <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {problem && <p className="note err">{problem}</p>}
      <button className="btn primary big" onClick={save}>
        حفظ{picked.size > 1 ? ` لـ ${picked.size} طلاب` : ""}
      </button>
    </div>
  );
}
