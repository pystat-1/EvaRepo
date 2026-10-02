import { useState } from "react";
import { parseBackupName } from "@eva/db/backup";
import { Dialog, Field, Notice } from "./ui";
import { confirmAction } from "./confirm";
import { saveFile } from "../lib/files";
import { cloudRound, downloadFromCloud, enableCloud, recoveryCode, useCloudState } from "../lib/cloud/cloudBackup";
import { KEEP_LOCAL, REMOTE_SUFFIX } from "../lib/cloud/plan";

const when = (d: Date) => d.toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" });
const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// النسخ على الإنترنت: encrypted copies of every backup in Cloudflare R2
// (through the Eva relay). This computer keeps only the newest few.
export function CloudBackupCard({ onRestore, busy }: { onRestore: (localName: string) => void; busy: boolean }) {
  const cloud = useCloudState();
  const [setup, setSetup] = useState(false);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(remote: string) {
    const b = parseBackupName(remote.slice(0, -REMOTE_SUFFIX.length));
    if (!(await confirmAction(`تنزيل النسخة المأخوذة في ${b ? when(b.takenAt) : remote} من الإنترنت واستعادتها؟\nستُؤخذ نسخة من البيانات الحالية أولًا.`, "تنزيل واستعادة"))) return;
    setWorking(remote);
    setError(null);
    try {
      onRestore(await downloadFromCloud(remote));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  async function showCode() {
    if (!(await confirmAction("عرض رمز الاسترداد؟ من يملكه ومفتاح المدير يستطيع قراءة النسخ.", "عرض الرمز"))) return;
    setShownCode(await recoveryCode());
  }

  const files = all ? cloud.files : cloud.files.slice(0, 8);
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>النسخ على الإنترنت</h2>
        {cloud.enabled && (
          <div className="row">
            <button className="btn" onClick={() => void cloudRound()} disabled={cloud.busy}>
              {cloud.busy ? "جارٍ الرفع…" : "رفع الآن"}
            </button>
            <button className="btn btn-ghost" onClick={() => void showCode()}>
              عرض رمز الاسترداد
            </button>
          </div>
        )}
      </div>

      {!cloud.relayReady ? (
        <p className="muted" style={{ margin: 0 }}>
          تستخدم النسخ على الإنترنت خادم المزامنة نفسه: أدخل مفتاح المدير في شاشة المزامنة أولًا.
        </p>
      ) : !cloud.enabled ? (
        <>
          <p className="muted" style={{ margin: 0 }}>
            كل نسخة احتياطية تُشفَّر على هذا الحاسوب ثم تُرفع إلى تخزين Cloudflare الخاص بك، ولا يقرؤها أحد دون رمز الاسترداد. يبقى على هذا الحاسوب آخر {KEEP_LOCAL} نسخ فقط، ويُحتفظ على
            الإنترنت بآخر 30 نسخة ونسخة من كل شهر لمدة سنة.
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setSetup(true)}>
              تفعيل النسخ على الإنترنت
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {cloud.lastUploadAt ? `آخر رفع: ${when(new Date(cloud.lastUploadAt))}` : "لم تُرفع أي نسخة بعد"} · {cloud.files.length} نسخة على الإنترنت · يبقى على هذا الحاسوب آخر {KEEP_LOCAL} نسخ.
            تُرفع كل نسخة جديدة تلقائيًا.
          </p>
          {cloud.error && <Notice kind="warn">{cloud.error}</Notice>}
          {cloud.files.length > 0 && (
            <table className="list">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الحجم (مضغوطة ومشفّرة)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const b = parseBackupName(f.name.slice(0, -REMOTE_SUFFIX.length));
                  return (
                    <tr key={f.name}>
                      <td className="tabular">{b ? when(b.takenAt) : f.name}</td>
                      <td className="tabular">{mb(f.size)}</td>
                      <td>
                        <button className="btn" onClick={() => void restore(f.name)} disabled={busy || !!working}>
                          {working === f.name ? "جارٍ التنزيل…" : "استعادة"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {cloud.files.length > 8 && !all && (
            <div>
              <button className="btn btn-sm" onClick={() => setAll(true)}>
                عرض كل النسخ ({cloud.files.length})
              </button>
            </div>
          )}
        </>
      )}
      {error && <Notice kind="err">{error}</Notice>}
      <SetupDialog open={setup} onClose={() => setSetup(false)} />
      <Dialog open={!!shownCode} title="رمز الاسترداد" onClose={() => setShownCode(null)}>
        <div className="stack">
          <p className="recovery-code ltr">{shownCode}</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => setShownCode(null)}>
              تم
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setCode(null);
    setTyped("");
    setSaved(false);
    setError(null);
    onClose();
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const c = await enableCloud(mode === "existing" ? typed : undefined);
      if (mode === "existing") close();
      else setCode(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} title="تفعيل النسخ على الإنترنت" onClose={code && !saved ? () => undefined : close}>
      {!code ? (
        <div className="stack">
          <div className="seg" role="tablist">
            <button role="tab" aria-selected={mode === "new"} className={mode === "new" ? "on" : ""} onClick={() => setMode("new")}>
              أول مرة
            </button>
            <button role="tab" aria-selected={mode === "existing"} className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>
              لديّ رمز استرداد
            </button>
          </div>
          {mode === "new" ? (
            <p className="muted" style={{ margin: 0 }}>
              يُنشأ رمز استرداد عشوائي يُشفَّر به كل ما يُرفع. احتفظ به خارج هذا الحاسوب (مطبوعًا أو في مكان آمن): تحتاجه لاستعادة البيانات على حاسوب جديد.
            </p>
          ) : (
            <Field label="رمز الاسترداد" hint="من حاسوب سابق أو من الورقة التي حفظته فيها.">
              <input className="input ltr-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="XXXX-XXXX-…" autoFocus />
            </Field>
          )}
          {error && <Notice kind="err">{error}</Notice>}
          <div className="row">
            <button className="btn btn-primary" onClick={() => void start()} disabled={busy || (mode === "existing" && !typed.trim())}>
              {busy ? "جارٍ التحقق…" : mode === "new" ? "إنشاء الرمز والبدء" : "التحقق والبدء"}
            </button>
            <button className="btn" onClick={close}>
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p style={{ margin: 0 }}>رمز الاسترداد (يظهر الآن مرة واحدة):</p>
          <p className="recovery-code ltr">{code}</p>
          <div className="row">
            <button className="btn" onClick={() => void navigator.clipboard.writeText(code)}>
              نسخ
            </button>
            <button
              className="btn"
              onClick={() =>
                void saveFile("رمز استرداد نسخ Eva.txt", new TextEncoder().encode(`رمز استرداد نسخ Eva الاحتياطية على الإنترنت:\r\n${code}\r\n`), {
                  name: "نص",
                  extensions: ["txt"],
                })
              }
            >
              حفظ كملف…
            </button>
          </div>
          <Notice kind="warn">دون هذا الرمز لا يمكن فتح النسخ على الإنترنت، ولا نستطيع استرجاعه لك.</Notice>
          <label className="row check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> حفظتُ الرمز في مكان آمن خارج هذا الحاسوب
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={!saved} onClick={close}>
              تم
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
