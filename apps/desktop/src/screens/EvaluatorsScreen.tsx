import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  addAssignment,
  assignmentChoices,
  coverage,
  importEvaluators,
  listEvaluators,
  previewEvaluatorImport,
  removeAssignment,
  saveEvaluator,
  setEvaluatorActive,
  setEvaluatorHospitals,
  type EvaluatorImportPreview,
  type EvaluatorImportRow,
  type EvaluatorRow,
} from "@eva/db/repo/evaluators";
import { currentCourse } from "@eva/db/repo/students";
import { recentAudit } from "@eva/db/repo/grading";
import { ValidationError } from "@eva/db/repo/common";
import { setEvaluatorPasswordHash, setEvaluatorPasswordHashes } from "@eva/db/repo/sync";
import { generatePassword, hashPassword } from "@eva/core/sync/password";
import { matchesSearch } from "@eva/core/text/arabic";
import { Dialog, Empty, Field, Notice, PageHeader } from "../components/ui";
import { confirmAction } from "../components/confirm";
import { errorText, r } from "../lib/repo";
import { saveFile } from "../lib/files";
import { relayConfig } from "../lib/relay";
import { buildEvaluatorTemplate, buildLoginsSheet, readEvaluatorTemplate } from "../lib/evaluatorExcel";

type Filter = "all" | "active" | "inactive" | "nophone" | "nocover";
const FILTERS: Array<[Filter, string]> = [
  ["all", "الكل"],
  ["active", "الفعّالون"],
  ["nophone", "بلا كلمة مرور هاتف"],
  ["nocover", "بلا تخصيص"],
  ["inactive", "المعطّلون"],
];
const XLSX = { name: "Excel", extensions: ["xlsx"] };
type Choices = { hospitals: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string }> };

const coverLabel = (h: EvaluatorRow["hospitals"][number]) => h.hospitalName + " · " + (h.groupName ?? "كل المجموعات");
const when = (iso: string) =>
  new Date(iso).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" });

export function EvaluatorsScreen() {
  const course = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const courseId = course.data?.id ?? null;
  const list = useQuery({ queryKey: ["evaluators"], queryFn: () => listEvaluators(r) });
  const cover = useQuery({ queryKey: ["coverage", courseId], queryFn: () => coverage(r, courseId!), enabled: !!courseId });
  const choices = useQuery({ queryKey: ["assignmentChoices", courseId], queryFn: () => assignmentChoices(r, courseId!), enabled: !!courseId });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<EvaluatorRow | "new" | null>(null);
  const [passwordFor, setPasswordFor] = useState<EvaluatorRow | null>(null);
  const [bulk, setBulk] = useState(false);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Only this course's covers count on this screen.
  const rows = useMemo(
    () => (list.data ?? []).map((e) => ({ ...e, hospitals: e.hospitals.filter((h) => !courseId || h.courseId === courseId) })),
    [list.data, courseId]
  );
  const shown = rows.filter(
    (e) =>
      matchesSearch(q, e.name, e.email, ...e.hospitals.map(coverLabel)) &&
      (filter === "all" ||
        (filter === "active" && e.active) ||
        (filter === "inactive" && !e.active) ||
        (filter === "nophone" && e.active && !e.hasPhonePassword) ||
        (filter === "nocover" && e.active && e.hospitals.length === 0))
  );
  const active = rows.filter((e) => e.active);
  const assigned = active.filter((e) => e.hospitals.length > 0);
  const needPassword = assigned.filter((e) => !e.hasPhonePassword);
  const uncovered = (cover.data ?? []).filter((c) => c.evaluators === 0);

  async function downloadTemplate(withData: boolean) {
    setNote(null);
    try {
      const data = withData
        ? active.flatMap((e) => e.hospitals.map((h) => ({ name: e.name, email: e.email, hospital: h.hospitalName, group: h.groupName ?? "" })))
        : [];
      const bytes = await buildEvaluatorTemplate(choices.data ?? { hospitals: [], groups: [] }, data);
      if (await saveFile(withData ? "المقيّمون.xlsx" : "قالب المقيّمين.xlsx", bytes, XLSX)) setNote({ kind: "ok", text: "حُفظ الملف." });
    } catch (e) {
      setNote({ kind: "err", text: errorText(e) });
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="المقيّمون"
        subtitle={`كل مقيّم يغطي مستشفى كاملًا أو مجموعة فيه ضمن ${course.data?.label ?? "الدورة الحالية"}، ويرى على هاتفه مجموعاته حسب الجدول.`}
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setEditing("new")}>إضافة مقيّم</button>
            <button className="btn" onClick={() => setImporting(true)} disabled={!courseId}>استيراد من Excel</button>
            <button className="btn" onClick={() => void downloadTemplate(false)} disabled={!courseId}>تنزيل القالب</button>
            <button className="btn" onClick={() => void downloadTemplate(true)} disabled={!courseId || active.length === 0}>تصدير إلى Excel</button>
          </>
        }
      />
      {note && <Notice kind={note.kind}>{note.text}</Notice>}

      <div className="ev-summary">
        <div className="card ev-stat">
          <div className="ev-stat-title">التغطية في المستشفيات</div>
          <div className="row">
            {(cover.data ?? []).map((c) => (
              <span key={c.hospitalId} className={`badge ${c.evaluators ? "badge-ok" : "badge-warn"}`}>
                {c.hospitalName}: {c.evaluators ? `${c.evaluators} مقيّم` : "بلا مقيّم"}
              </span>
            ))}
          </div>
          {uncovered.length > 0 && <p className="muted small">المستشفى بلا مقيّم لا تصل مجموعاته إلى أي هاتف.</p>}
        </div>
        <div className="card ev-stat">
          <div className="ev-stat-title">جاهزية الهاتف</div>
          <div>
            <b className="tabular">{assigned.filter((e) => e.hasPhonePassword).length}</b> من <b className="tabular">{assigned.length}</b> مقيّم مخصّص لديهم كلمة مرور الهاتف
            {active.length > assigned.length && <span className="muted small"> · {active.length - assigned.length} بلا تخصيص في هذه الدورة</span>}
          </div>
          {needPassword.length > 0 ? (
            <div>
              <button className="btn btn-primary" onClick={() => setBulk(true)}>
                إنشاء كلمات المرور لـ {needPassword.length} مقيّم
              </button>
            </div>
          ) : (
            <span className="muted small">كل المقيّمين المخصّصين جاهزون. تصل التغييرات إلى الهواتف مع المزامنة.</span>
          )}
        </div>
      </div>

      <div className="row">
        <input
          className="input ev-search"
          type="search"
          placeholder="بحث بالاسم أو البريد أو المستشفى…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="بحث"
        />
        <div className="seg" role="tablist" aria-label="تصفية">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`seg-btn ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted">{shown.length} مقيّم</span>
      </div>

      {list.isSuccess && shown.length === 0 && (
        <Empty>{rows.length ? "لا نتائج مطابقة." : "لا يوجد مقيّمون بعد. أضف مقيّمًا أو استورد ملف Excel."}</Empty>
      )}
      <div className="ev-grid">
        {shown.map((e) => (
          <EvaluatorCard key={e.id} e={e} courseId={courseId} choices={choices.data} onEdit={() => setEditing(e)} onPassword={() => setPasswordFor(e)} />
        ))}
      </div>

      <EvaluatorDialog evaluator={editing} courseId={courseId} hospitals={choices.data?.hospitals ?? []} onClose={() => setEditing(null)} />
      <PhonePasswordDialog evaluator={passwordFor} onClose={() => setPasswordFor(null)} />
      <BulkPasswordsDialog open={bulk} evaluators={needPassword} onClose={() => setBulk(false)} />
      {courseId && <ImportDialog open={importing} courseId={courseId} onClose={() => setImporting(false)} onDone={(text) => setNote({ kind: "ok", text })} />}
    </div>
  );
}

function EvaluatorCard({
  e,
  courseId,
  choices,
  onEdit,
  onPassword,
}: {
  e: EvaluatorRow;
  courseId: string | null;
  choices: Choices | undefined;
  onEdit: () => void;
  onPassword: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState({ hospitalId: "", groupId: "" });
  const toggle = useMutation({ mutationFn: () => setEvaluatorActive(r, e.id, !e.active) });
  const add = useMutation({
    mutationFn: () => addAssignment(r, { accountId: e.id, courseId: courseId!, hospitalId: pick.hospitalId, groupId: pick.groupId || null }),
    onSuccess: () => {
      setAdding(false);
      setPick({ hospitalId: "", groupId: "" });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => removeAssignment(r, id) });
  const error = toggle.error ?? add.error ?? remove.error;

  async function onRemove(h: EvaluatorRow["hospitals"][number]) {
    if (await confirmAction(`إزالة تخصيص ${e.name} من ${coverLabel(h)}؟`, "إزالة")) remove.mutate(h.assignmentId);
  }
  async function onToggle() {
    if (!e.active || (await confirmAction(`تعطيل ${e.name}؟ يُسجَّل خروجه من الهاتف عند المزامنة التالية.`, "تعطيل"))) toggle.mutate();
  }

  return (
    <div className={`card ev-card ${e.active ? "" : "dim"}`}>
      <div className="ev-head">
        <div className="ev-id">
          <div className="ev-name">{e.name}</div>
          <div className="ltr muted ev-email" title={e.email}>
            {e.email}
          </div>
        </div>
        <div className="row ev-badges">
          {e.active ? <span className="badge badge-ok">فعّال</span> : <span className="badge">معطّل</span>}
          {e.hasPhonePassword ? <span className="badge badge-ok">الهاتف جاهز</span> : <span className="badge badge-warn">بلا كلمة مرور</span>}
          {e.openConflicts > 0 && <span className="badge badge-err">{e.openConflicts} تعارض</span>}
        </div>
      </div>

      <div className="ev-covers">
        {e.hospitals.length === 0 && <span className="muted">لا يغطي أي مستشفى — لن يرى مجموعات على هاتفه.</span>}
        {e.hospitals.map((h) => (
          <span key={h.assignmentId} className="chip-tag">
            {h.hospitalName}
            <span className="muted"> · {h.groupName ?? "كل المجموعات"}</span>
            <button className="chip-x" aria-label={`إزالة ${coverLabel(h)}`} title="إزالة التخصيص" disabled={remove.isPending} onClick={() => void onRemove(h)}>
              ✕
            </button>
          </span>
        ))}
        {courseId && !adding && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            + تخصيص
          </button>
        )}
      </div>
      {adding && (
        <form
          className="ev-add"
          onSubmit={(x) => {
            x.preventDefault();
            add.mutate();
          }}
        >
          <select className="input" value={pick.hospitalId} onChange={(x) => setPick({ ...pick, hospitalId: x.target.value })} required aria-label="المستشفى">
            <option value="">— المستشفى —</option>
            {(choices?.hospitals ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <select className="input" value={pick.groupId} onChange={(x) => setPick({ ...pick, groupId: x.target.value })} aria-label="المجموعة">
            <option value="">كل المجموعات</option>
            {(choices?.groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" type="submit" disabled={add.isPending}>
            إضافة
          </button>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => {
              setAdding(false);
              add.reset();
            }}
          >
            إلغاء
          </button>
        </form>
      )}
      {error && <Notice kind="err">{errorText(error)}</Notice>}

      <div className="ev-foot">
        <span className="muted small">
          {e.lastReceivedAt ? `آخر إرسال من الهاتف: ${when(e.lastReceivedAt)} · ${e.daysApplied} يوم معتمد` : "لم يرسل من الهاتف بعد"}
        </span>
        <div className="row">
          <button className="btn btn-sm" onClick={onEdit}>
            تعديل
          </button>
          <button className="btn btn-sm" onClick={onPassword}>
            {e.hasPhonePassword ? "كلمة مرور جديدة" : "كلمة مرور الهاتف"}
          </button>
          <button className="btn btn-sm" disabled={toggle.isPending} onClick={() => void onToggle()}>
            {e.active ? "تعطيل" : "تفعيل"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Add: name, email and whole-hospital covers. Edit: name and email (covers
// are managed on the card, including single groups).
function EvaluatorDialog({
  evaluator,
  courseId,
  hospitals,
  onClose,
}: {
  evaluator: EvaluatorRow | "new" | null;
  courseId: string | null;
  hospitals: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const e = evaluator && evaluator !== "new" ? evaluator : null;
  const [form, setForm] = useState({ name: "", email: "", hospitalIds: [] as string[] });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = evaluator === "new" ? "new" : e?.id ?? null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setForm({ name: e?.name ?? "", email: e?.email ?? "", hospitalIds: [] });
  }
  const save = useMutation({
    mutationFn: async () => {
      const id = await saveEvaluator(r, { id: e?.id, name: form.name, email: form.email });
      if (!e && courseId && form.hospitalIds.length) await setEvaluatorHospitals(r, id, courseId, form.hospitalIds);
    },
    onSuccess: () => close(),
  });
  function close() {
    save.reset();
    onClose();
  }
  const err = (k: string) => (save.error instanceof ValidationError && save.error.field === k ? save.error.message : undefined);
  return (
    <Dialog open={evaluator !== null} title={e ? "تعديل مقيّم" : "إضافة مقيّم"} onClose={close}>
      <form
        className="stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          save.mutate();
        }}
      >
        <Field label="الاسم *" error={err("name")}>
          <input className="input" value={form.name} onChange={(x) => setForm({ ...form, name: x.target.value })} required />
        </Field>
        <Field label="البريد الإلكتروني *" error={err("email")} hint="يسجّل به المقيّم الدخول على الهاتف.">
          <input className="input ltr-input" type="email" value={form.email} onChange={(x) => setForm({ ...form, email: x.target.value })} required />
        </Field>
        {!e && courseId && (
          <Field label="يغطي المستشفيات (كل مجموعاتها)" hint="لتخصيص مجموعة واحدة فقط استخدم «+ تخصيص» في بطاقة المقيّم بعد الحفظ.">
            <div className="row">
              {hospitals.map((h) => (
                <label key={h.id} className="row check">
                  <input
                    type="checkbox"
                    checked={form.hospitalIds.includes(h.id)}
                    onChange={(x) =>
                      setForm({ ...form, hospitalIds: x.target.checked ? [...form.hospitalIds, h.id] : form.hospitalIds.filter((i) => i !== h.id) })
                    }
                  />
                  {h.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        {save.error && !(save.error instanceof ValidationError && save.error.field) && <Notice kind="err">{errorText(save.error)}</Notice>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>
            حفظ
          </button>
          <button className="btn" type="button" onClick={close}>
            إلغاء
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Generates a strong password, stores only its hash, and shows it ONCE so
// the admin can hand it to the evaluator. It reaches the phones' server at
// the next sync (المزامنة); the evaluator's old phone sessions end then.
function PhonePasswordDialog({ evaluator, onClose }: { evaluator: EvaluatorRow | null; onClose: () => void }) {
  const [shown, setShown] = useState<{ id: string; password: string } | null>(null);
  const make = useMutation({
    mutationFn: async (id: string) => {
      const password = generatePassword();
      await setEvaluatorPasswordHash(r, id, await hashPassword(password));
      return { id, password };
    },
    onSuccess: setShown,
  });
  const current = shown && evaluator && shown.id === evaluator.id ? shown.password : null;
  const close = () => {
    setShown(null);
    make.reset();
    onClose();
  };
  return (
    <Dialog open={!!evaluator} title={`كلمة مرور الهاتف — ${evaluator?.name ?? ""}`} onClose={close}>
      {evaluator && (
        <div className="stack">
          {!current ? (
            <>
              <p className="muted">تُنشأ كلمة مرور قوية جديدة.{evaluator.hasPhonePassword ? " تتوقف كلمة المرور السابقة عند المزامنة التالية." : ""}</p>
              <div className="row">
                <button className="btn btn-primary" disabled={make.isPending} onClick={() => make.mutate(evaluator.id)}>
                  إنشاء كلمة المرور
                </button>
              </div>
            </>
          ) : (
            <>
              <p>أعطِ المقيّم هذه البيانات (تظهر مرة واحدة فقط):</p>
              <div className="card">
                <div>
                  البريد: <span className="ltr">{evaluator.email}</span>
                </div>
                <div>
                  كلمة المرور: <b className="ltr mono" style={{ fontSize: 18 }}>{current}</b>
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => void navigator.clipboard.writeText(evaluator.email + " / " + current)}>
                  نسخ
                </button>
                <button className="btn btn-primary" onClick={close}>
                  تم
                </button>
              </div>
              <p className="muted">تصل إلى هاتفه بعد المزامنة (شاشة المزامنة ← مزامنة الآن).</p>
            </>
          )}
          {make.error && <Notice kind="err">{errorText(make.error)}</Notice>}
        </div>
      )}
    </Dialog>
  );
}

type Login = { name: string; email: string; password: string; covers: string };

// Passwords for everyone who covers something and has none yet, in one go;
// shown once, with an Excel sheet to print or send.
function BulkPasswordsDialog({ open, evaluators, onClose }: { open: boolean; evaluators: EvaluatorRow[]; onClose: () => void }) {
  const [logins, setLogins] = useState<Login[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const make = useMutation({
    mutationFn: async () => {
      const made = await Promise.all(
        evaluators.map(async (e) => {
          const password = generatePassword();
          return { e, password, passwordHash: await hashPassword(password) };
        })
      );
      await setEvaluatorPasswordHashes(r, made.map((m) => ({ accountId: m.e.id, passwordHash: m.passwordHash })));
      return made.map((m) => ({ name: m.e.name, email: m.e.email, password: m.password, covers: m.e.hospitals.map(coverLabel).join("، ") }));
    },
    onSuccess: setLogins,
  });
  const close = () => {
    setLogins(null);
    setSaved(null);
    make.reset();
    onClose();
  };
  async function saveSheet(list: Login[]) {
    const relay = await relayConfig();
    const bytes = await buildLoginsSheet(relay?.url ?? null, list);
    if (await saveFile("دخول المقيّمين.xlsx", bytes, XLSX)) setSaved("حُفظ الملف. احفظه في مكان آمن أو احذفه بعد التسليم.");
  }
  return (
    <Dialog open={open} title="كلمات مرور الهاتف" onClose={close} wide>
      <div className="stack">
        {!logins ? (
          <>
            <p>ستُنشأ كلمة مرور جديدة لكل من:</p>
            <div className="row">
              {evaluators.map((e) => (
                <span key={e.id} className="badge">
                  {e.name}
                </span>
              ))}
            </div>
            <p className="muted">تظهر كلمات المرور مرة واحدة فقط، ويمكن حفظها كملف Excel لتسليمها.</p>
            <div className="row">
              <button className="btn btn-primary" disabled={make.isPending || evaluators.length === 0} onClick={() => make.mutate()}>
                {make.isPending ? "جارٍ الإنشاء…" : `إنشاء ${evaluators.length} كلمة مرور`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="table-wrap">
              <table className="list">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>البريد</th>
                    <th>كلمة المرور</th>
                    <th>يغطي</th>
                  </tr>
                </thead>
                <tbody>
                  {logins.map((l) => (
                    <tr key={l.email}>
                      <td>{l.name}</td>
                      <td className="ltr">{l.email}</td>
                      <td>
                        <b className="ltr mono">{l.password}</b>
                      </td>
                      <td className="small-cell">{l.covers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {saved && <Notice kind="ok">{saved}</Notice>}
            <div className="row">
              <button className="btn btn-primary" onClick={() => void saveSheet(logins)}>
                حفظ كملف Excel
              </button>
              <button className="btn" onClick={() => void navigator.clipboard.writeText(logins.map((l) => `${l.name}: ${l.email} / ${l.password}`).join("\n"))}>
                نسخ الكل
              </button>
              <button className="btn" onClick={close}>
                تم
              </button>
            </div>
            <p className="muted">تصل إلى الهواتف بعد المزامنة (شاشة المزامنة ← مزامنة الآن).</p>
          </>
        )}
        {make.error && <Notice kind="err">{errorText(make.error)}</Notice>}
      </div>
    </Dialog>
  );
}

const ACTION_TEXT = { new: "مقيّم جديد", assign: "تخصيص جديد", exists: "موجود", error: "خطأ" } as const;

function ImportDialog({ open, courseId, onClose, onDone }: { open: boolean; courseId: string; onClose: () => void; onDone: (text: string) => void }) {
  const [file, setFile] = useState<{ name: string; rows: EvaluatorImportRow[] } | null>(null);
  const [preview, setPreview] = useState<EvaluatorImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => importEvaluators(r, file!.rows, courseId),
    onSuccess: (res) => {
      onDone(`اكتمل استيراد المقيّمين: ${res.newEvaluators} مقيّم جديد، ${res.newCovers} تخصيص جديد.`);
      close();
    },
  });
  function reset() {
    setFile(null);
    setPreview(null);
    setError(null);
    run.reset();
  }
  function close() {
    reset();
    onClose();
  }
  async function read(f: File) {
    reset();
    try {
      const res = await readEvaluatorTemplate(await f.arrayBuffer());
      if ("error" in res) return setError(res.error);
      setFile({ name: f.name, rows: res.rows });
      setPreview(await previewEvaluatorImport(r, res.rows, courseId));
    } catch (e) {
      setError(errorText(e));
    }
  }
  const changes = preview ? preview.newEvaluators + preview.newCovers : 0;
  return (
    <Dialog open={open} title="استيراد المقيّمين من Excel" onClose={close} wide>
      <div className="stack">
        <p className="muted">
          صف لكل تخصيص (مستشفى، ومجموعة اختيارية). تُدمج الصفوف حسب البريد: المقيّم الموجود يحصل على التخصيصات الجديدة، والبريد الجديد ينشئ مقيّمًا. يُطبَّق الملف كاملًا دفعة
          واحدة، ولا يُحذف شيء.
        </p>
        <input
          type="file"
          className="input"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="ملف المقيّمين"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = "";
          }}
        />
        {error && <Notice kind="err">{error}</Notice>}
        {file && preview && (
          <>
            <p>
              <b>{file.name}</b>: {file.rows.length} صف — مقيّم جديد: <b>{preview.newEvaluators}</b> · تخصيص جديد: <b>{preview.newCovers}</b>
              {preview.errors > 0 && (
                <>
                  {" "}
                  · أخطاء: <b className="err">{preview.errors}</b>
                </>
              )}
            </p>
            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="list">
                <thead>
                  <tr>
                    <th>الصف</th>
                    <th>الاسم</th>
                    <th>البريد</th>
                    <th>التخصيص</th>
                    <th>النتيجة</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.row}>
                      <td className="tabular">{l.row}</td>
                      <td>{l.name}</td>
                      <td className="ltr">{l.email}</td>
                      <td>{l.cover}</td>
                      <td>
                        <span className={`badge ${l.action === "error" ? "badge-err" : l.action === "exists" ? "" : "badge-ok"}`}>{ACTION_TEXT[l.action]}</span>{" "}
                        {(l.action === "error" || l.action === "exists") && <span className="muted small">{l.message}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.errors > 0 && <Notice kind="warn">صحّح الصفوف التي فيها خطأ في الملف ثم اختره من جديد. لا يُستورد شيء حتى يخلو الملف من الأخطاء.</Notice>}
            {run.error && <Notice kind="err">{errorText(run.error)}</Notice>}
            <div className="row">
              <button className="btn btn-primary" disabled={preview.errors > 0 || changes === 0 || run.isPending} onClick={() => run.mutate()}>
                {changes === 0 ? "لا تغييرات" : run.isPending ? "جارٍ الاستيراد…" : `استيراد (${changes} تغيير)`}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

const ENTITY_AR: Record<string, string> = {
  Student: "طالب", Evaluator: "مقيّم", EvaluatorAssignment: "تكليف مقيّم", Course: "دورة", RotationBlock: "جدول الدوران",
  Hospital: "مستشفى", Evaluation: "تقييم", Group: "مجموعة",
};
const ACTION_AR: Record<string, string> = { create: "إضافة", update: "تعديل", deactivate: "تعطيل", reactivate: "تفعيل", delete: "حذف", import: "استيراد" };

export function AuditScreen() {
  const log = useQuery({ queryKey: ["audit"], queryFn: () => recentAudit(r, 500) });
  return (
    <div className="stack">
      <PageHeader title="سجل التغييرات" subtitle="آخر 500 تغيير على البيانات، يُسجَّل تلقائيًا مع كل حفظ." />
      <div className="card table-wrap" style={{ maxHeight: "calc(100vh - 200px)" }}>
        <table className="list">
          <thead><tr><th>الوقت</th><th>النوع</th><th>العملية</th><th>التفاصيل</th></tr></thead>
          <tbody>
            {(log.data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="tabular">{new Date(a.createdAt).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" })}</td>
                <td>{ENTITY_AR[a.entityType] ?? a.entityType}</td>
                <td>{ACTION_AR[a.action] ?? a.action}</td>
                <td className="muted small-cell">{summarize(a.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function summarize(json: string | null): string {
  if (!json) return "";
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    if (Array.isArray(v)) return `${v.length} عنصر`;
    return ["nameAr", "name", "label", "created", "updated"]
      .filter((k) => v[k] !== undefined)
      .map((k) => `${k === "created" ? "جديد" : k === "updated" ? "محدَّث" : ""} ${String(v[k])}`.trim())
      .join(" · ");
  } catch {
    return "";
  }
}
