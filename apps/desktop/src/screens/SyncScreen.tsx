import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { applyConflictAnyway, inbox } from "@eva/db/repo/sync";
import { listEvaluators } from "@eva/db/repo/evaluators";
import type { DaySubmission } from "@eva/core/sync/contract";
import { Field, Notice, PageHeader } from "../components/ui";
import { confirmAction } from "../components/confirm";
import { errorText, r } from "../lib/repo";
import { DEFAULT_RELAY_URL, relayConfig, relayStatus, saveRelayConfig } from "../lib/relay";
import { syncNow, useSyncState } from "../lib/autoSync";

const STATUS_AR = { applied: "اعتُمد", conflict: "تعارض", rejected: "مرفوض" } as const;
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }) : "—";

// المزامنة: set up once (the server key), then everything is automatic
// (lib/autoSync.ts). This screen shows that it works, the link evaluators
// open on their phones, and the days that need the admin's decision.
export function SyncScreen() {
  const config = useQuery({ queryKey: ["relayConfig"], queryFn: relayConfig });
  const box = useQuery({ queryKey: ["inbox"], queryFn: () => inbox(r) });
  const evaluators = useQuery({ queryKey: ["evaluators"], queryFn: () => listEvaluators(r) });
  const sync = useSyncState();
  const [form, setForm] = useState({ url: DEFAULT_RELAY_URL, key: "" });
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      await relayStatus({ url: form.url.trim().replace(/\/+$/, ""), key: form.key.trim() }); // refuse a wrong key before saving it
      await saveRelayConfig(form);
    },
    onSuccess: () => {
      setEditing(false);
      setForm({ url: DEFAULT_RELAY_URL, key: "" });
      void syncNow();
    },
  });
  const decide = useMutation({ mutationFn: (clientId: string) => applyConflictAnyway(r, clientId) });

  const nameOf = (id: string) => evaluators.data?.find((e) => e.id === id)?.name ?? "—";
  const rows = box.data ?? [];
  const open = rows.filter((x) => x.status !== "applied");
  const setUp = !!config.data && !editing;
  const link = config.data?.url ?? DEFAULT_RELAY_URL;

  return (
    <div className="stack">
      <PageHeader
        title="المزامنة مع هواتف المقيّمين"
        subtitle="تعمل تلقائيًا: كل تغيير يصل إلى الهواتف خلال ثوانٍ، وتصل الأيام المعتمدة على الهواتف كل دقيقة، دون ضغط أي زر."
      />
      {decide.error && <Notice kind="err">{errorText(decide.error)}</Notice>}

      {setUp ? (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 style={{ margin: 0 }}>الحالة</h2>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {sync.kind === "syncing"
                  ? "جارٍ المزامنة…"
                  : sync.kind === "offline"
                    ? "لا يوجد اتصال بالإنترنت — ستُكمل تلقائيًا عند عودته."
                    : sync.kind === "error"
                      ? `تعذّرت آخر محاولة: ${sync.message} — ستُعاد تلقائيًا.`
                      : `متزامن — آخر مزامنة: ${fmtTime(sync.lastAt)}`}
              </p>
            </div>
            <div className="row">
              <button className="btn" disabled={sync.kind === "syncing"} onClick={() => void syncNow()} title="المزامنة تلقائية؛ هذا للتأكد فقط">
                مزامنة الآن
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                تغيير الخادم
              </button>
            </div>
          </div>
          {sync.googleSignIn === false && (
            <Notice kind="warn">الدخول بحساب Google غير مفعَّل على الخادم بعد، فلا يستطيع المقيّمون الدخول من الهاتف.</Notice>
          )}
        </div>
      ) : (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>إعداد لمرة واحدة</h2>
          <p className="muted" style={{ margin: 0 }}>
            أدخل مفتاح المدير (من ملف بيانات الدخول). يُحفظ على هذا الحاسوب فقط، ثم تعمل المزامنة تلقائيًا دائمًا.
          </p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="مفتاح المدير">
              <input className="input ltr-input" type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required />
            </Field>
            <details>
              <summary className="muted">عنوان الخادم</summary>
              <input className="input ltr-input" aria-label="عنوان الخادم" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
            </details>
            {save.error && <Notice kind="err">{errorText(save.error)}</Notice>}
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={save.isPending}>
                {save.isPending ? "جارٍ التحقق…" : "حفظ وبدء المزامنة"}
              </button>
              {config.data && (
                <button className="btn" type="button" onClick={() => setEditing(false)}>
                  إلغاء
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>رابط تطبيق المقيّم</h2>
        <p className="muted" style={{ margin: 0 }}>
          أرسل هذا الرابط للمقيّمين. يفتحه المقيّم على هاتفه ويدخل بحساب Google الخاص بالبريد المسجَّل له في شاشة المقيّمين — دون كلمة مرور. يمكنه إضافته إلى الشاشة
          الرئيسية ليعمل كتطبيق، حتى دون إنترنت.
        </p>
        <div className="row">
          <b className="ltr mono">{link}</b>
          <button
            className="btn btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "نُسخ ✓" : "نسخ الرابط"}
          </button>
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>تحتاج إلى قرارك ({open.length})</h2>
        {open.length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            لا توجد تعارضات أو أيام مرفوضة.
          </p>
        )}
        {open.map((x) => {
          const sub = JSON.parse(x.payload) as DaySubmission;
          return (
            <div key={x.clientId} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div>
                <b>{STATUS_AR[x.status]}</b> · {nameOf(x.evaluatorId)} · <span className="tabular">{x.dateISO}</span> · {sub.records.length} طالب
                <div className="muted">{x.message}</div>
              </div>
              {x.status === "conflict" && (
                <button
                  className="btn"
                  disabled={decide.isPending}
                  onClick={async () =>
                    (await confirmAction("اعتماد نسخة هذا المقيّم واستبدال التقييمات الموجودة لنفس اليوم؟", "اعتماد هذه النسخة")) && decide.mutate(x.clientId)
                  }
                >
                  اعتماد هذه النسخة
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>آخر الأيام المستلمة</h2>
        {rows.length === 0 ? (
          <p className="muted">لم يصل أي يوم من الهواتف بعد.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المقيّم</th>
                <th>الطلاب</th>
                <th>النتيجة</th>
                <th>وقت الاستلام</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((x) => (
                <tr key={x.clientId}>
                  <td className="tabular">{x.dateISO}</td>
                  <td>{nameOf(x.evaluatorId)}</td>
                  <td className="tabular">{(JSON.parse(x.payload) as DaySubmission).records.length}</td>
                  <td>{STATUS_AR[x.status]}</td>
                  <td className="tabular">{fmtTime(x.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
