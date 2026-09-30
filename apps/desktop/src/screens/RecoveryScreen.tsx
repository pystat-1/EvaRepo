import { useEffect, useState } from "react";
import { parseBackupName } from "@eva/db/backup";
import { backups, type BackupEntry, type DbInfo } from "../lib/db";
import { formatBackupTime } from "./SystemScreen";

const REASON_TEXT: Record<string, string> = {
  damaged: "ملف قاعدة البيانات تالف. لم يُعدَّل شيء فيه.",
  "too-new": "ملف قاعدة البيانات أُنشئ بإصدار أحدث من Eva. حدّث التطبيق ثم أعد فتحه.",
  "migration-failed": "تعذّرت ترقية قاعدة البيانات إلى هذا الإصدار. أُخذت نسخة احتياطية قبل المحاولة.",
  "open-failed": "تعذّر فتح قاعدة البيانات.",
};

// Shown instead of the app when the database can't be used safely. The
// usual way out is restoring the newest backup.
export function RecoveryScreen({
  problem,
  info,
  onRetry,
}: {
  problem: { reason: string; detail: string };
  info: DbInfo | null;
  onRetry: () => void;
}) {
  const [list, setList] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    backups
      .entries()
      .then((e) => setList(e.sort((a, b) => b.name.localeCompare(a.name))))
      .catch(() => setList([]));
  }, []);

  async function restore(name: string) {
    if (!window.confirm(`استعادة النسخة ${formatBackupTime(name)}؟ سيحلّ محلّ الملف الحالي.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      await backups.restore(name);
      onRetry();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="main stack" style={{ maxWidth: 760 }}>
      <h1>تعذّر فتح بيانات Eva بأمان</h1>
      <p className="note note-err">{REASON_TEXT[problem.reason] ?? problem.reason}</p>
      <code>{problem.detail}</code>
      {info && (
        <p className="muted">
          الملف: <span className="ltr">{info.path}</span>
        </p>
      )}
      {msg && <p className="note note-err">{msg}</p>}
      <div className="card">
        <h2>النسخ الاحتياطية المتوفرة</h2>
        {list === null && <p className="muted">جارٍ القراءة…</p>}
        {list?.length === 0 && <p className="muted">لا توجد نسخ احتياطية.</p>}
        {list && list.length > 0 && (
          <table className="list">
            <tbody>
              {list.slice(0, 15).map((b) => (
                <tr key={b.name}>
                  <td className="tabular">{formatBackupTime(b.name)}</td>
                  <td>{parseBackupName(b.name)?.reason}</td>
                  <td>
                    <button className="btn" disabled={busy} onClick={() => restore(b.name)}>
                      استعادة هذه النسخة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="row">
        <button className="btn" onClick={onRetry} disabled={busy}>
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}
