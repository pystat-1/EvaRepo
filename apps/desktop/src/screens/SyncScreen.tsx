import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { applyConflictAnyway, getSetting, inbox } from "@eva/db/repo/sync";
import { listEvaluators } from "@eva/db/repo/evaluators";
import type { DaySubmission } from "@eva/core/sync/contract";
import { Field, Notice, PageHeader } from "../components/ui";
import { confirmAction } from "../components/confirm";

import { errorText, queryClient, r } from "../lib/repo";
import { publish, pull, relayConfig, relayStatus, saveRelayConfig } from "../lib/relay";

const STATUS_AR = { applied: "اعتُمد", conflict: "تعارض", rejected: "مرفوض" } as const;
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad" }) : "—";

// المزامنة: publish each evaluator's schedule/roster to the relay and pull
// the days they validated on their phones. Runs by itself every 5 minutes
// while the app is open; the buttons are for "right now".
export function SyncScreen() {
  const config = useQuery({ queryKey: ["relayConfig"], queryFn: relayConfig });
  const times = useQuery({
    queryKey: ["relayTimes"],
    queryFn: async () => ({ publishedAt: await getSetting(r, "relay.publishedAt"), pulledAt: await getSetting(r, "relay.pulledAt") }),
  });
  const box = useQuery({ queryKey: ["inbox"], queryFn: () => inbox(r) });
  const evaluators = useQuery({ queryKey: ["evaluators"], queryFn: () => listEvaluators(r) });
  const [form, setForm] = useState({ url: "", key: "" });
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const save = useMutation({ mutationFn: () => saveRelayConfig(form), onSuccess: () => (setEditing(false), setNote({ kind: "ok", text: "حُفظت إعدادات الخادم." })) });
  const test = useMutation({ mutationFn: async () => relayStatus(config.data!), onSuccess: (s) => setNote({ kind: "ok", text: `الاتصال سليم: ${s.evaluators} مقيّم، ${s.bundles} جدول منشور، ${s.submissions} يوم مستلم.` }) });
  const syncNow = useMutation({
    mutationFn: async () => {
      const p = await publish(config.data!, true);
      const g = await pull(config.data!);
      return { p, g };
    },
    onSuccess: ({ p, g }) =>
      setNote({ kind: "ok", text: `نُشر جدول ${p.bundles} مقيّم. سُحب: ${g.applied} يوم معتمد${g.conflicts ? `، ${g.conflicts} تعارض` : ""}${g.rejected ? `، ${g.rejected} مرفوض` : ""}.` }),
  });
  const decide = useMutation({ mutationFn: (clientId: string) => applyConflictAnyway(r, clientId) });

  const failed = [save, test, syncNow, decide].find((m) => m.error)?.error;

  const nameOf = (id: string) => evaluators.data?.find((e) => e.id === id)?.name ?? "—";
  const rows = box.data ?? [];
  const open = rows.filter((x) => x.status !== "applied");
  const noPassword = (evaluators.data ?? []).filter((e) => e.active && e.hospitals.length && !e.hasPhonePassword);

  return (
    <div className="stack">
      <PageHeader
        title="المزامنة مع هواتف المقيّمين"
        subtitle="ينشر التطبيق لكل مقيّم مجموعاته وطلابه وجدوله، ويسحب الأيام التي اعتمدها على هاتفه. تعمل تلقائيًا كل 5 دقائق أثناء فتح التطبيق."
        actions={
          config.data && (
            <button className="btn btn-primary" disabled={syncNow.isPending} onClick={() => (setNote(null), syncNow.mutate())}>
              {syncNow.isPending ? "جارٍ المزامنة…" : "مزامنة الآن"}
            </button>
          )
        }
      />
      {failed ? <Notice kind="err">{errorText(failed)}</Notice> : note && <Notice kind={note.kind}>{note.text}</Notice>}
      {noPassword.length > 0 && <Notice kind="warn">مقيّمون بلا كلمة مرور للهاتف: {noPassword.map((e) => e.name).join("، ")} — أنشئها من شاشة المقيّمين.</Notice>}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>الخادم</h2>
        {config.data && !editing ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              <span className="ltr">{config.data.url}</span> · آخر نشر: {fmtTime(times.data?.publishedAt ?? null)} · آخر سحب: {fmtTime(times.data?.pulledAt ?? null)}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              رابط تطبيق المقيّم للهاتف: <span className="ltr">{config.data.url}</span>
            </p>
            <div className="row">
              <button className="btn" onClick={() => test.mutate()} disabled={test.isPending}>اختبار الاتصال</button>
              <button className="btn" onClick={() => (setForm({ url: config.data!.url, key: "" }), setEditing(true))}>تغيير الإعدادات</button>
            </div>
          </>
        ) : (
          <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
            <Field label="عنوان الخادم" hint="مثل https://eva-relay.example.workers.dev">
              <input className="input ltr-input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
            </Field>
            <Field label="مفتاح المدير" hint="يُعطى مرة واحدة عند إعداد الخادم، ويُحفظ على هذا الحاسوب فقط">
              <input className="input ltr-input" type="password" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required />
            </Field>
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={save.isPending}>حفظ</button>
              {config.data && <button className="btn" type="button" onClick={() => setEditing(false)}>إلغاء</button>}
            </div>
          </form>
        )}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>تحتاج إلى قرارك ({open.length})</h2>
        {open.length === 0 && <p className="muted" style={{ margin: 0 }}>لا توجد تعارضات أو أيام مرفوضة.</p>}
        {open.map((x) => {
          const sub = JSON.parse(x.payload) as DaySubmission;
          return (
            <div key={x.clientId} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div>
                <b>{STATUS_AR[x.status]}</b> · {nameOf(x.evaluatorId)} · <span className="tabular">{x.dateISO}</span> · {sub.records.length} طالب
                <div className="muted">{x.message}</div>
              </div>
              {x.status === "conflict" && (
                <button className="btn" disabled={decide.isPending} onClick={async () => (await confirmAction("اعتماد نسخة هذا المقيّم واستبدال التقييمات الموجودة لنفس اليوم؟", "اعتماد هذه النسخة")) && decide.mutate(x.clientId)}>
                  اعتماد هذه النسخة
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>آخر الأيام المستلمة</h2>
        <table className="list">
          <thead><tr><th>التاريخ</th><th>المقيّم</th><th>الطلاب</th><th>النتيجة</th><th>وقت الاستلام</th></tr></thead>
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
      </div>
    </div>
  );
}

/** Background sync every 5 minutes while the app is open and configured. */
export function useAutoSync() {
  useEffect(() => {
    let stopped = false;
    const run = async () => {
      const c = await relayConfig().catch(() => null);
      if (!c || stopped || !navigator.onLine) return;
      try {
        await publish(c);
        await pull(c);
        await queryClient.invalidateQueries();
      } catch {
        /* offline or server down: try again next round */
      }
    };
    const first = setTimeout(run, 5_000);
    const timer = setInterval(run, 5 * 60_000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
}
