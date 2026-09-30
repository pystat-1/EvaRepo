import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listEvaluators, saveEvaluator, setEvaluatorActive, setEvaluatorHospitals, type EvaluatorRow } from "@eva/db/repo/evaluators";
import { listHospitals } from "@eva/db/repo/courses";
import { currentCourse } from "@eva/db/repo/students";
import { recentAudit } from "@eva/db/repo/grading";
import { ValidationError } from "@eva/db/repo/common";
import { setEvaluatorPasswordHash } from "@eva/db/repo/sync";
import { generatePassword, hashPassword } from "@eva/core/sync/password";
import { Dialog, Field, Notice, PageHeader } from "../components/ui";
import { errorText, r } from "../lib/repo";

export function EvaluatorsScreen() {
  const list = useQuery({ queryKey: ["evaluators"], queryFn: () => listEvaluators(r) });
  const course = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const [editing, setEditing] = useState<EvaluatorRow | "new" | null>(null);
  const [passwordFor, setPasswordFor] = useState<EvaluatorRow | null>(null);
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => setEvaluatorActive(r, v.id, v.active) });
  const rows = list.data ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="المقيّمون"
        subtitle={`كل مقيّم يغطي مستشفى أو أكثر في ${course.data?.label ?? "الدورة الحالية"}، ويرى مجموعاتها حسب الجدول. تسجيل دخول الهاتف يُضاف مع المزامنة (المرحلة 4).`}
        actions={<button className="btn btn-primary" onClick={() => setEditing("new")}>إضافة مقيّم</button>}
      />
      {toggle.error && <Notice kind="err">{errorText(toggle.error)}</Notice>}
      <div className="card">
        <table className="list">
          <thead>
            <tr><th>الاسم</th><th>البريد</th><th>المستشفيات</th><th>الهاتف</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={e.active ? undefined : "dim"}>
                <td>{e.name}</td>
                <td className="ltr">{e.email}</td>
                <td>
                  <div className="row">
                    {e.hospitals.filter((h) => !course.data || h.courseId === course.data.id).map((h) => (
                      <span key={h.assignmentId} className="badge">{h.hospitalName}</span>
                    ))}
                  </div>
                </td>
                <td>{e.hasPhonePassword ? <span className="badge badge-ok">لديه كلمة مرور</span> : <span className="badge">بلا كلمة مرور</span>}</td>
                <td>{e.active ? <span className="badge badge-ok">فعّال</span> : <span className="badge">معطّل</span>}</td>
                <td>
                  <div className="row">
                    <button className="btn" onClick={() => setEditing(e)}>تعديل</button>
                    <button className="btn" onClick={() => setPasswordFor(e)}>{e.hasPhonePassword ? "كلمة مرور جديدة" : "إنشاء كلمة مرور الهاتف"}</button>
                    <button className="btn" onClick={() => toggle.mutate({ id: e.id, active: !e.active })}>{e.active ? "تعطيل" : "تفعيل"}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EvaluatorDialog evaluator={editing} courseId={course.data?.id ?? null} onClose={() => setEditing(null)} />
      <PhonePasswordDialog evaluator={passwordFor} onClose={() => setPasswordFor(null)} />
    </div>
  );
}

function EvaluatorDialog({ evaluator, courseId, onClose }: { evaluator: EvaluatorRow | "new" | null; courseId: string | null; onClose: () => void }) {
  const e = evaluator && evaluator !== "new" ? evaluator : null;
  const hospitals = useQuery({ queryKey: ["hospitals"], queryFn: () => listHospitals(r) });
  const [form, setForm] = useState({ name: "", email: "", hospitalIds: [] as string[] });
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = evaluator === "new" ? "new" : e?.id ?? null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setForm({ name: e?.name ?? "", email: e?.email ?? "", hospitalIds: e?.hospitals.filter((h) => h.courseId === courseId).map((h) => h.hospitalId) ?? [] });
  }
  const save = useMutation({
    mutationFn: async () => {
      const id = await saveEvaluator(r, { id: e?.id, name: form.name, email: form.email });
      if (courseId) await setEvaluatorHospitals(r, id, courseId, form.hospitalIds);
    },
    onSuccess: onClose,
  });
  const err = (k: string) => (save.error instanceof ValidationError && save.error.field === k ? save.error.message : undefined);
  return (
    <Dialog open={evaluator !== null} title={e ? "تعديل مقيّم" : "إضافة مقيّم"} onClose={onClose}>
      <form className="stack" onSubmit={(ev) => (ev.preventDefault(), save.mutate())}>
        <Field label="الاسم *" error={err("name")}><input className="input" value={form.name} onChange={(x) => setForm({ ...form, name: x.target.value })} required /></Field>
        <Field label="البريد الإلكتروني *" error={err("email")}><input className="input ltr-input" value={form.email} onChange={(x) => setForm({ ...form, email: x.target.value })} required /></Field>
        <Field label="المستشفيات في الدورة الحالية">
          <div className="row">
            {(hospitals.data ?? []).map((h) => (
              <label key={h.id} className="row check">
                <input
                  type="checkbox"
                  checked={form.hospitalIds.includes(h.id)}
                  onChange={(x) => setForm({ ...form, hospitalIds: x.target.checked ? [...form.hospitalIds, h.id] : form.hospitalIds.filter((i) => i !== h.id) })}
                />
                {h.name}
              </label>
            ))}
          </div>
        </Field>
        {save.error && !(save.error instanceof ValidationError && save.error.field) && <Notice kind="err">{errorText(save.error)}</Notice>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>حفظ</button>
          <button className="btn" type="button" onClick={onClose}>إلغاء</button>
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
    onClose();
  };
  return (
    <Dialog open={!!evaluator} title={`كلمة مرور الهاتف — ${evaluator?.name ?? ""}`} onClose={close}>
      {evaluator && (
        <div className="stack">
          {!current ? (
            <>
              <p className="muted">تُنشأ كلمة مرور قوية جديدة.{evaluator.hasPhonePassword ? " تتوقف كلمة المرور السابقة عند المزامنة التالية." : ""}</p>
              <button className="btn btn-primary" disabled={make.isPending} onClick={() => make.mutate(evaluator.id)}>
                إنشاء كلمة المرور
              </button>
            </>
          ) : (
            <>
              <p>أعطِ المقيّم هذه البيانات (تظهر مرة واحدة فقط):</p>
              <div className="card">
                <div>
                  البريد: <span className="ltr">{evaluator.email}</span>
                </div>
                <div>
                  كلمة المرور: <b className="ltr" style={{ fontSize: 18 }}>{current}</b>
                </div>
              </div>
              <div className="row">
                <button className="btn" onClick={() => navigator.clipboard.writeText(evaluator.email + " / " + current)}>
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
