import { useEffect, useMemo, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { todayISO } from "@eva/core/date";
import { matchesSearch } from "@eva/core/text/arabic";
import { allAssignments, deleteAssignment, putAssignments, type Assignment } from "../lib/store";
import { assignmentFiles, buildFile, dayFileTitle, fileProblem, type AssignmentFile, type SubjectDraft } from "../lib/assignments";
import { assignmentsExcel, assignmentsWord } from "../lib/exports";
import { weekdayAr } from "../lib/views";
import { DownloadMenu } from "../components/DownloadMenu";

type Editing = { kind: "new" } | { kind: "add"; file: AssignmentFile };

// الواجبات: assignment files (ملفات الواجبات). One file holds several
// subjects, each with its own students — 2 students on one subject, 3 on
// another… — written in one go and downloaded as one Excel or Word file,
// subject by subject. More subjects can be added to a file later. Kept on
// this phone (works offline); a colleague's arrive with their shares
// («الزملاء») marked with who sent them.
export function Assignments({ evaluatorId, bundle, tick }: { evaluatorId: string; bundle: EvaluatorBundle; tick: number }) {
  const [list, setList] = useState<Assignment[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [q, setQ] = useState("");
  const reload = () => allAssignments(evaluatorId).then(setList);
  useEffect(() => {
    void allAssignments(evaluatorId).then(setList);
  }, [evaluatorId, tick]);

  const files = useMemo(() => assignmentFiles(list), [list]);
  // A search or group shows only the matching students (and the files they are in).
  const shown = useMemo(() => {
    const keep = (a: Assignment) => (!groupId || a.groupId === groupId) && matchesSearch(q, a.studentName, a.universityNumber, a.title, a.fileTitle);
    if (!q.trim() && !groupId) return files;
    return assignmentFiles(list.filter(keep));
  }, [files, list, q, groupId]);
  const groupName = (id: string) => bundle.groups.find((g) => g.id === id)?.name ?? "";
  const filtered = shown !== files;

  if (editing)
    return (
      <FileEditor
        bundle={bundle}
        titles={[...new Set(list.map((a) => a.title))]}
        adding={editing.kind === "add" ? editing.file : null}
        onCancel={() => setEditing(null)}
        onSave={async (items, key) => {
          await putAssignments(evaluatorId, items);
          await reload();
          setEditing(null);
          setOpen(key);
          setSaved(key);
        }}
      />
    );

  return (
    <>
      <div className="row between">
        <h2>الواجبات</h2>
        <DownloadMenu
          label={filtered ? "تنزيل ما يظهر" : "تنزيل الكل"}
          items={[
            { label: "كل الملفات في ملف واحد — Excel", run: () => assignmentsExcel(bundle, shown), disabled: shown.length === 0 },
            { label: "كل الملفات في ملف واحد — Word", run: () => assignmentsWord(bundle, shown), disabled: shown.length === 0 },
          ]}
        />
      </div>
      <button className="btn primary big" onClick={() => setEditing({ kind: "new" })}>
        ＋ ملف واجبات جديد
      </button>
      {files.length > 0 && (
        <>
          <input className="input" type="search" placeholder="بحث بالطالب أو الواجب…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="المجموعة">
            <option value="">كل المجموعات</option>
            {bundle.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </>
      )}
      {files.length === 0 && <p className="muted">لا توجد واجبات بعد. أنشئ ملفًا وأضف فيه واجبًا أو أكثر، لكل واجب طلابه.</p>}
      {filtered && shown.length === 0 && <p className="muted">لا نتائج.</p>}
      {shown.map((f) => (
        <FileCard
          key={f.key}
          bundle={bundle}
          file={f}
          groupName={groupName}
          open={open === f.key}
          justSaved={saved === f.key}
          partial={filtered}
          onToggle={() => setOpen(open === f.key ? null : f.key)}
          onAdd={() => setEditing({ kind: "add", file: files.find((x) => x.key === f.key) ?? f })}
          onDelete={async (ids) => {
            for (const id of ids) await deleteAssignment(evaluatorId, id);
            await reload();
          }}
        />
      ))}
    </>
  );
}

function FileCard({
  bundle,
  file,
  groupName,
  open,
  justSaved,
  partial,
  onToggle,
  onAdd,
  onDelete,
}: {
  bundle: EvaluatorBundle;
  file: AssignmentFile;
  groupName: (id: string) => string;
  open: boolean;
  justSaved: boolean;
  partial: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onDelete: (ids: string[]) => void;
}) {
  const [sure, setSure] = useState<string | null>(null); // an assignment id, or "file"
  return (
    <section className={`card afile ${justSaved ? "fresh" : ""}`}>
      <button className="afile-head" aria-expanded={open} onClick={onToggle}>
        <div className="grow min0">
          <b>{file.title}</b>
          <div className="muted small">
            {weekdayAr(file.dateISO)} {file.dateISO} · {file.subjects.length} {file.subjects.length === 1 ? "واجب" : "واجبات"} · {file.count} {file.count === 1 ? "طالب" : "طلاب"}
            {file.from && <span className="tag">من {file.from}</span>}
          </div>
          <div className="afile-subjects small">
            {file.subjects.map((s) => (
              <span key={s.title + s.dateISO} className="unit-tag">
                {s.title} {s.items.length}
              </span>
            ))}
          </div>
        </div>
        <span className="muted" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {justSaved && <p className="note ok">حُفظ الملف — نزّله Excel أو Word من الأسفل.</p>}
      {open && (
        <div className="stack tight">
          {file.subjects.map((s) => (
            <div key={s.title + s.dateISO} className="asubject">
              <div className="row between">
                <b>{s.title}</b>
                <span className="muted small">
                  {s.dateISO !== file.dateISO ? `${s.dateISO} · ` : ""}
                  {s.items.length} {s.items.length === 1 ? "طالب" : "طلاب"}
                </span>
              </div>
              {s.items.map((a, i) => (
                <div key={a.id} className="assign-line">
                  <span className="idx">{i + 1}</span>
                  <div className="grow min0">
                    {a.studentName} <span className="muted small">{a.universityNumber}</span>
                    <div className="muted small">
                      {groupName(a.groupId)}
                      {a.notes ? ` · ${a.notes}` : ""}
                    </div>
                  </div>
                  {sure === a.id ? (
                    <span className="row">
                      <button className="btn tiny danger" onClick={() => onDelete([a.id])}>
                        حذف
                      </button>
                      <button className="btn tiny" onClick={() => setSure(null)}>
                        لا
                      </button>
                    </span>
                  ) : (
                    <button className="btn ghost tiny" aria-label={`حذف ${a.studentName} من ${s.title}`} onClick={() => setSure(a.id)}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
          {partial && <p className="muted small">يظهر هنا ما يطابق البحث فقط؛ التنزيل يشمل ما يظهر.</p>}
          <div className="row">
            <DownloadMenu
              label="تنزيل هذا الملف"
              items={[
                { label: `${file.title} — Excel`, run: () => assignmentsExcel(bundle, [file]) },
                { label: `${file.title} — Word`, run: () => assignmentsWord(bundle, [file]) },
              ]}
            />
            {!partial && (
              <button className="btn" onClick={onAdd}>
                ＋ إضافة واجب لهذا الملف
              </button>
            )}
          </div>
          {!partial &&
            (sure === "file" ? (
              <div className="row">
                <span className="small grow">حذف الملف كله ({file.count} طالب)؟</span>
                <button className="btn tiny danger" onClick={() => onDelete(file.subjects.flatMap((s) => s.items.map((a) => a.id)))}>
                  نعم، حذف
                </button>
                <button className="btn tiny" onClick={() => setSure(null)}>
                  لا
                </button>
              </div>
            ) : (
              <button className="btn ghost tiny remove-guest" onClick={() => setSure("file")}>
                حذف الملف
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

// A new file, or more subjects for an existing one: the file's name and
// date, then one block per subject — its name, group and students.
function FileEditor({
  bundle,
  titles,
  adding,
  onSave,
  onCancel,
}: {
  bundle: EvaluatorBundle;
  titles: string[];
  adding: AssignmentFile | null;
  onSave: (items: Assignment[], fileKey: string) => void;
  onCancel: () => void;
}) {
  const firstGroup = adding?.groupIds[0] ?? bundle.groups[0]?.id ?? "";
  const [fileTitle, setFileTitle] = useState("");
  const [dateISO, setDateISO] = useState(todayISO());
  const [subjects, setSubjects] = useState<SubjectDraft[]>([{ title: "", groupId: firstGroup, studentIds: [] }]);
  const [problem, setProblem] = useState<string | null>(null);
  const change = (i: number, s: SubjectDraft) => {
    setSubjects(subjects.map((x, n) => (n === i ? s : x)));
    setProblem(null);
  };
  const students = subjects.reduce((a, s) => a + s.studentIds.length, 0);

  function save() {
    const p = fileProblem(subjects);
    if (p) return setProblem(p);
    if (!dateISO) return setProblem("اختر التاريخ");
    // An old date-grouped file (no id) becomes a real file when added to.
    const id = adding?.fileId ?? crypto.randomUUID();
    const title = adding ? adding.title : fileTitle.trim() || dayFileTitle(dateISO);
    const startAt = adding ? Math.max(0, ...adding.subjects.map((s) => (Number.isFinite(s.position) && s.position < Number.MAX_SAFE_INTEGER ? s.position + 1 : 0)), adding.subjects.length) : 0;
    const made = buildFile(bundle, { id, title, dateISO }, subjects, { startAt, now: new Date(), newId: () => crypto.randomUUID() });
    const joined = adding && !adding.fileId ? adding.subjects.flatMap((s, n) => s.items.map((a) => ({ ...a, fileId: id, fileTitle: title, position: n }))) : [];
    onSave([...joined, ...made], `file:${id}`);
  }

  return (
    <>
      <div className="row between">
        <h2>{adding ? `إضافة إلى «${adding.title}»` : "ملف واجبات جديد"}</h2>
        <button className="btn ghost" onClick={onCancel}>
          إلغاء
        </button>
      </div>
      <div className="card stack">
        {!adding && (
          <label className="field">
            اسم الملف
            <input className="input" value={fileTitle} maxLength={200} placeholder={dayFileTitle(dateISO)} onChange={(e) => setFileTitle(e.target.value)} />
          </label>
        )}
        <label className="field">
          التاريخ
          <input className="input" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
        </label>
      </div>
      <datalist id="assignment-titles">
        {titles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {subjects.map((s, i) => (
        <SubjectBlock
          key={i}
          bundle={bundle}
          index={i}
          count={subjects.length}
          value={s}
          onChange={(v) => change(i, v)}
          onRemove={() => setSubjects(subjects.filter((_, n) => n !== i))}
        />
      ))}
      <button className="btn add-guest" onClick={() => setSubjects([...subjects, { title: "", groupId: subjects[subjects.length - 1]?.groupId ?? firstGroup, studentIds: [] }])}>
        ＋ واجب آخر في هذا الملف
      </button>
      {problem && <p className="note err">{problem}</p>}
      <div className="validate-bar">
        <button className="btn primary big" onClick={save}>
          حفظ ({subjects.length} {subjects.length === 1 ? "واجب" : "واجبات"} · {students} {students === 1 ? "طالب" : "طلاب"})
        </button>
      </div>
    </>
  );
}

function SubjectBlock({
  bundle,
  index,
  count,
  value,
  onChange,
  onRemove,
}: {
  bundle: EvaluatorBundle;
  index: number;
  count: number;
  value: SubjectDraft;
  onChange: (v: SubjectDraft) => void;
  onRemove: () => void;
}) {
  const [q, setQ] = useState("");
  const group = bundle.groups.find((g) => g.id === value.groupId);
  const all = group?.students ?? [];
  const students = all.filter((s) => matchesSearch(q, s.name, s.universityNumber));
  const picked = new Set(value.studentIds);
  const allPicked = all.length > 0 && picked.size === all.length;
  const toggle = (id: string) => onChange({ ...value, studentIds: picked.has(id) ? value.studentIds.filter((x) => x !== id) : [...value.studentIds, id] });
  return (
    <section className="card stack subject-block">
      <div className="row between">
        <b>الواجب {index + 1}</b>
        {count > 1 && (
          <button className="btn ghost tiny remove-guest" onClick={onRemove}>
            إزالة هذا الواجب
          </button>
        )}
      </div>
      <label className="field">
        اسم الواجب
        <input className="input" list="assignment-titles" value={value.title} maxLength={200} placeholder="مثلًا: خطة رعاية تمريضية" onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </label>
      {bundle.groups.length > 1 && (
        <label className="field">
          المجموعة
          <select className="input" value={value.groupId} onChange={(e) => onChange({ ...value, groupId: e.target.value, studentIds: [] })}>
            {bundle.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="row between">
        <span className="field-label">الطلاب ({picked.size} محدد)</span>
        <button className="btn ghost tiny" onClick={() => onChange({ ...value, studentIds: allPicked ? [] : all.map((s) => s.id) })}>
          {allPicked ? "إلغاء التحديد" : "تحديد الكل"}
        </button>
      </div>
      {all.length > 8 && <input className="input" type="search" placeholder="بحث عن طالب…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن طالب" />}
      <div className="guest-list" role="group" aria-label={`طلاب الواجب ${index + 1}`}>
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
        <input className="input" value={value.notes ?? ""} maxLength={500} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </label>
    </section>
  );
}
