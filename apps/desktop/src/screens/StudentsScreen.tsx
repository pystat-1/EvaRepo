import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { courseOverview, listCourses } from "@eva/db/repo/courses";
import {
  currentCourse,
  exportForTemplate,
  importContext,
  importStudents,
  listStudents,
  previewImport,
  saveStudent,
  setStudentActive,
  type ImportResult,
  type StudentRow,
} from "@eva/db/repo/students";
import { studentRecord } from "@eva/db/repo/grading";
import { ValidationError } from "@eva/db/repo/common";
import { buildStudentTemplate, readStudentTemplate } from "@eva/core/students/excelTemplate";
import type { StudentRowInput } from "@eva/core/students/importRows";
import { matchesSearch } from "@eva/core/text/arabic";
import { DataTable } from "../components/DataTable";
import { ATTENDANCE_AR, Dialog, Empty, Field, Notice, PageHeader, SHIFT_AR, fmt2 } from "../components/ui";
import { errorText, r } from "../lib/repo";
import { loadExcel, saveFile } from "../lib/files";

const columns: ColumnDef<StudentRow, unknown>[] = [
  { accessorKey: "code", header: "الرمز", size: 120, cell: (c) => <span className="ltr tabular">{c.getValue() as string}</span> },
  { accessorKey: "universityNumber", header: "الرقم الجامعي", size: 130, cell: (c) => <span className="tabular">{c.getValue() as string}</span> },
  { accessorKey: "nameAr", header: "الاسم" },
  { accessorKey: "groupName", header: "المجموعة", size: 190 },
  { accessorKey: "shift", header: "الدوام", size: 80, cell: (c) => SHIFT_AR[c.getValue() as string] ?? "—" },
  {
    accessorKey: "active",
    header: "الحالة",
    size: 80,
    cell: (c) => (c.getValue() ? <span className="badge badge-ok">فعّال</span> : <span className="badge">معطّل</span>),
  },
];

export function StudentsScreen({ openStudentId, onOpened }: { openStudentId?: string | null; onOpened?: () => void }) {
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState<string | "">("");
  const [groupId, setGroupId] = useState("");
  const [shift, setShift] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editing, setEditing] = useState<StudentRow | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(openStudentId ?? null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  if (openStudentId && openStudentId !== viewing) {
    setViewing(openStudentId);
    onOpened?.();
  }

  const courses = useQuery({ queryKey: ["courses"], queryFn: () => listCourses(r) });
  const current = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const activeCourseId = courseId || current.data?.id || "";
  const overview = useQuery({
    queryKey: ["courseOverview", activeCourseId],
    queryFn: () => courseOverview(r, activeCourseId),
    enabled: !!activeCourseId,
  });
  const students = useQuery({
    queryKey: ["students", activeCourseId, groupId, shift, includeInactive],
    queryFn: () => listStudents(r, { courseId: activeCourseId || undefined, groupId: groupId || undefined, shift: (shift || undefined) as never, includeInactive }),
  });
  const shown = useMemo(() => {
    const all = students.data ?? [];
    if (!search.trim()) return all;
    return all.filter((s) => matches(search, s));
  }, [students.data, search]);

  async function exportList() {
    setNote(null);
    try {
      const ctx = await importContext(r, activeCourseId || undefined);
      if (!ctx.course) throw new Error("لا توجد دورة منشورة");
      const data = await exportForTemplate(r, activeCourseId || ctx.course.id);
      const bytes = await buildStudentTemplate(await loadExcel(), templateCtx(ctx), data);
      if (await saveFile(data.length ? "قائمة-الطلاب.xlsx" : "قالب-الطلاب.xlsx", bytes, { name: "Excel", extensions: ["xlsx"] }))
        setNote({ kind: "ok", text: `حُفظ الملف (${data.length} طالب).` });
    } catch (e) {
      setNote({ kind: "err", text: errorText(e) });
    }
  }

  async function downloadTemplate() {
    setNote(null);
    try {
      const ctx = await importContext(r, activeCourseId || undefined);
      const bytes = await buildStudentTemplate(await loadExcel(), templateCtx(ctx));
      if (await saveFile("قالب-الطلاب.xlsx", bytes, { name: "Excel", extensions: ["xlsx"] })) setNote({ kind: "ok", text: "حُفظ القالب." });
    } catch (e) {
      setNote({ kind: "err", text: errorText(e) });
    }
  }

  const groups = overview.data?.groups ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="الطلاب"
        subtitle={`${shown.length} طالب${students.data && shown.length !== students.data.length ? ` من ${students.data.length}` : ""}`}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setEditing("new")}>
              إضافة طالب
            </button>
            <button className="btn" onClick={() => setImporting(true)}>
              استيراد من Excel…
            </button>
            <button className="btn" onClick={downloadTemplate}>
              تنزيل القالب
            </button>
            <button className="btn" onClick={exportList}>
              تصدير القائمة
            </button>
          </>
        }
      />
      {note && <Notice kind={note.kind}>{note.text}</Notice>}

      <div className="filters">
        <input className="input grow" type="search" placeholder="بحث بالاسم أو الرقم الجامعي أو الرمز…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="بحث" autoFocus />
        <select className="input" value={activeCourseId} onChange={(e) => (setCourseId(e.target.value), setGroupId(""))} aria-label="الدورة">
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label ?? `${c.year}-${c.number}`}
            </option>
          ))}
        </select>
        <select className="input" value={shift} onChange={(e) => setShift(e.target.value)} aria-label="الدوام">
          <option value="">كل الدوامات</option>
          <option value="MORNING">صباحي</option>
          <option value="EVENING">مسائي</option>
        </select>
        <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="المجموعة">
          <option value="">كل المجموعات</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <label className="row check">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          المعطّلون أيضًا
        </label>
      </div>

      {students.isError ? (
        <Notice kind="err">{errorText(students.error)}</Notice>
      ) : (
        <DataTable rows={shown} columns={columns} onOpen={(s) => setViewing(s.id)} getRowId={(s) => s.id} empty={students.isLoading ? "جارٍ التحميل…" : "لا يوجد طلاب"} />
      )}

      <StudentDialog
        student={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setEditing(null);
          setNote({ kind: "ok", text: msg });
        }}
      />
      <StudentRecordDialog
        studentId={viewing}
        onClose={() => setViewing(null)}
        onEdit={(s) => {
          setViewing(null);
          setEditing(s);
        }}
      />
      <ImportDialog open={importing} courses={courses.data ?? []} defaultCourseId={activeCourseId} onClose={() => setImporting(false)} onDone={(msg) => setNote({ kind: "ok", text: msg })} />
    </div>
  );
}

// Search across name, number, code (Arabic-aware, see @eva/core/text/arabic).
function matches(q: string, s: StudentRow) {
  return matchesSearch(q, s.nameAr, s.nameEn, s.universityNumber, s.code, s.email);
}

function templateCtx(ctx: Awaited<ReturnType<typeof importContext>>) {
  return {
    courseLabel: ctx.course?.label ?? "الدورة",
    studyTypeName: ctx.studyType?.name ?? "—",
    groups: ctx.groups.map((g) => ({ shift: g.shift, number: g.number, name: g.name })),
  };
}

function StudentDialog({
  student,
  groups,
  onClose,
  onSaved,
}: {
  student: StudentRow | "new" | null;
  groups: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const s = student && student !== "new" ? student : null;
  const [form, setForm] = useState({ universityNumber: "", nameAr: "", nameEn: "", email: "", groupId: "" });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = student === "new" ? "new" : s?.id ?? null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setForm({
      universityNumber: s?.universityNumber ?? "",
      nameAr: s?.nameAr ?? "",
      nameEn: s?.nameEn ?? "",
      email: s?.email ?? "",
      groupId: s?.groupId ?? "",
    });
  }
  const save = useMutation({
    mutationFn: () => saveStudent(r, { id: s?.id, ...form, groupId: form.groupId || null }),
    onSuccess: () => onSaved(s ? "حُفظت التعديلات." : "أُضيف الطالب."),
  });
  const fieldErr = (f: string) => (save.error instanceof ValidationError && save.error.field === f ? save.error.message : undefined);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Dialog open={student !== null} title={s ? "تعديل طالب" : "إضافة طالب"} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="الرقم الجامعي *" error={fieldErr("universityNumber")}>
          <input className="input" value={form.universityNumber} onChange={set("universityNumber")} required />
        </Field>
        <Field label="الاسم الكامل (عربي) *" error={fieldErr("nameAr")}>
          <input className="input" value={form.nameAr} onChange={set("nameAr")} required />
        </Field>
        <Field label="الاسم بالإنكليزية">
          <input className="input ltr-input" value={form.nameEn} onChange={set("nameEn")} />
        </Field>
        <Field label="البريد الإلكتروني" error={fieldErr("email")}>
          <input className="input ltr-input" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="المجموعة" hint="المجموعة تحدد الدورة والدوام" error={fieldErr("groupId")}>
          <select className="input" value={form.groupId} onChange={set("groupId")}>
            <option value="">— بدون مجموعة —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        {save.error && !(save.error instanceof ValidationError && save.error.field) && <Notice kind="err">{errorText(save.error)}</Notice>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>
            {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function StudentRecordDialog({ studentId, onClose, onEdit }: { studentId: string | null; onClose: () => void; onEdit: (s: StudentRow) => void }) {
  const student = useQuery({
    queryKey: ["student", studentId],
    queryFn: async () => (await listStudents(r, { includeInactive: true })).find((s) => s.id === studentId) ?? null,
    enabled: !!studentId,
  });
  const record = useQuery({ queryKey: ["studentRecord", studentId], queryFn: () => studentRecord(r, studentId!), enabled: !!studentId });
  const toggle = useMutation({ mutationFn: (active: boolean) => setStudentActive(r, studentId!, active) });
  const s = student.data;
  const rec = record.data;
  return (
    <Dialog open={!!studentId} title={s?.nameAr ?? "الطالب"} onClose={onClose} wide>
      {s && (
        <div className="stack">
          <p className="muted">
            <span className="tabular">{s.universityNumber}</span> · <span className="ltr">{s.code ?? "—"}</span> · {s.groupName ?? "بدون مجموعة"} · {SHIFT_AR[s.shift ?? ""] ?? "—"}
            {!s.active && " · معطّل"}
          </p>
          {rec && (
            <div className="grid-stats">
              <div className="card stat"><b className="tabular">{rec.days}</b><span className="muted">أيام مقيّمة</span></div>
              <div className="card stat"><b className="tabular">{rec.present + rec.late}</b><span className="muted">حضور ({rec.late} متأخر)</span></div>
              <div className="card stat"><b className="tabular">{rec.absent}</b><span className="muted">غياب</span></div>
              <div className="card stat"><b className="tabular">{fmt2(rec.average)}</b><span className="muted">معدل الدرجة</span></div>
            </div>
          )}
          {rec && rec.evaluations.length === 0 && <Empty>لا توجد تقييمات معتمدة بعد.</Empty>}
          {rec && rec.evaluations.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="list">
                <thead>
                  <tr><th>التاريخ</th><th>الحضور</th><th>الدرجة</th><th>المستشفى</th><th>المقيّم</th></tr>
                </thead>
                <tbody>
                  {rec.evaluations.map((e) => (
                    <tr key={e.id}>
                      <td className="tabular">{e.dateISO}</td>
                      <td>{ATTENDANCE_AR[e.attendance]}</td>
                      <td className="tabular">{e.attendance === "absent" ? "—" : fmt2(e.total)}</td>
                      <td>{e.hospitalName ?? "—"}</td>
                      <td>{e.evaluatorName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary" onClick={() => onEdit(s)}>
              تعديل البيانات
            </button>
            <button className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate(!s.active)}>
              {s.active ? "تعطيل الطالب" : "إعادة تفعيل"}
            </button>
          </div>
          {toggle.error && <Notice kind="err">{errorText(toggle.error)}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

type Preview = Awaited<ReturnType<typeof previewImport>> & { fileName: string; rows: Array<StudentRowInput & { row: number }> };

function ImportDialog({
  open,
  courses,
  defaultCourseId,
  onClose,
  onDone,
}: {
  open: boolean;
  courses: Array<{ id: string; label: string | null; year: number; number: number }>;
  defaultCourseId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [courseId, setCourseId] = useState(defaultCourseId);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeSamples, setRemoveSamples] = useState(true);
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const run = useMutation({
    mutationFn: () => importStudents(r, preview!.rows, { courseId: preview!.ctx.course?.id, removeSamples: removeSamples && preview!.ctx.sampleCount > 0, deactivateMissing }),
    onSuccess: (res) => {
      setResult(res);
      onDone(`اكتمل الاستيراد: ${res.created} جديد، ${res.updated} محدَّث${res.samplesRemoved ? `، حُذف ${res.samplesRemoved} تجريبي` : ""}${res.deactivated ? `، عُطّل ${res.deactivated}` : ""}.`);
    },
  });

  function reset() {
    setPreview(null);
    setError(null);
    setResult(null);
    run.reset();
  }

  async function readFile(file: File) {
    reset();
    try {
      const read = await readStudentTemplate(await loadExcel(), await file.arrayBuffer());
      if ("error" in read) return setError(read.error);
      const p = await previewImport(r, read.rows, courseId || undefined);
      setPreview({ ...p, fileName: file.name, rows: read.rows });
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <Dialog open={open} title="استيراد الطلاب من Excel" onClose={() => (reset(), onClose())} wide>
      <div className="stack">
        <p className="muted">
          اختر ملف القالب بعد تعبئته. يُفحص كل صف قبل أي حفظ، ثم يُطبَّق الملف كاملًا دفعة واحدة (أو لا شيء إن حدث خطأ). تُؤخذ نسخة احتياطية يومية تلقائيًا.
        </p>
        <label className="row check">
          الدورة التي يُستورد إليها الطلاب:
          <select className="input" value={courseId} onChange={(e) => (setCourseId(e.target.value), reset())} aria-label="دورة الاستيراد">
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label ?? `${c.year}-${c.number}`}
              </option>
            ))}
          </select>
        </label>
        <input
          type="file"
          className="input"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />
        {error && <Notice kind="err">{error}</Notice>}
        {preview && !result && (
          <>
            <p>
              <b>{preview.fileName}</b>: {preview.rows.length} صف — صالح: <b className="ok">{preview.valid.length}</b>
              {preview.issues.length > 0 && <> · فيه أخطاء: <b className="err">{preview.issues.length}</b> (لن يُستورد)</>}
            </p>
            <div className="row">
              {preview.ctx.groups.map((g) => (
                <span key={g.id} className="badge">
                  {SHIFT_AR[g.shift]} {g.number}: {preview.valid.filter((v) => v.shift === g.shift && v.groupNumber === g.number).length}
                </span>
              ))}
            </div>
            {preview.issues.length > 0 && (
              <ul className="issues">
                {preview.issues.slice(0, 200).map((i) => (
                  <li key={i.row}>الصف {i.row}: {i.message}</li>
                ))}
              </ul>
            )}
            {preview.ctx.sampleCount > 0 && (
              <label className="row check">
                <input type="checkbox" checked={removeSamples} onChange={(e) => setRemoveSamples(e.target.checked)} />
                حذف الطلاب التجريبيين ({preview.ctx.sampleCount}) مع درجاتهم
              </label>
            )}
            <label className="row check">
              <input type="checkbox" checked={deactivateMissing} onChange={(e) => setDeactivateMissing(e.target.checked)} />
              تعطيل طلاب الدورة غير الموجودين في الملف
            </label>
            {run.error && <Notice kind="err">{errorText(run.error)}</Notice>}
            <div className="row">
              <button className="btn btn-primary" disabled={preview.valid.length === 0 || run.isPending} onClick={() => run.mutate()}>
                {run.isPending ? "جارٍ الاستيراد…" : `استيراد ${preview.valid.length} طالب`}
              </button>
            </div>
          </>
        )}
        {result && (
          <Notice kind="ok">
            تم: {result.created} طالب جديد، {result.updated} محدَّث
            {result.samplesRemoved ? `، حُذف ${result.samplesRemoved} طالب تجريبي` : ""}
            {result.deactivated ? `، عُطّل ${result.deactivated}` : ""}
            {result.issues.length ? `. لم يُستورد ${result.issues.length} صف بسبب أخطاء.` : "."}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
