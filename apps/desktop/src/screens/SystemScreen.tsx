import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { count } from "drizzle-orm";
import { parseBackupName } from "@eva/db/backup";
import { takeBackup, type StartupResult } from "@eva/db/startup";
import * as schema from "@eva/db/schema";
import { backups, orm, type BackupEntry, type DbInfo } from "../lib/db";
import { confirmAction } from "../components/confirm";
import type { Check } from "../lib/selfCheck";
import { logTail, openFolder, type SystemInfo } from "../lib/health";
import { checkForUpdate, installUpdate, useUpdateState } from "../lib/updater";
import { useSyncState } from "../lib/autoSync";
import { saveFile } from "../lib/files";
import { CloudBackupCard } from "../components/CloudBackupCard";
import { cloudRound, useCloudState } from "../lib/cloud/cloudBackup";


const REASON_AR: Record<string, string> = {
  daily: "يومية",
  manual: "يدوية",
  "before-migrate": "قبل الترقية",
  "before-import": "قبل الاستيراد",
  "before-restore": "قبل الاستعادة",
  "before-update": "قبل التحديث",
  "before-delete": "قبل حذف دورة",
};

export function formatBackupTime(name: string): string {
  const b = parseBackupName(name);
  return b
    ? b.takenAt.toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" })
    : name;
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// النظام: database health, counts, backups, restore and import. The
// safety net screen: every destructive action here takes a backup first.
export function SystemScreen({
  info,
  startup,
  checks,
  system,
}: {
  info: DbInfo;
  startup: Extract<StartupResult, { ok: true }>;
  checks: Check[];
  system: SystemInfo | null;
}) {
  const update = useUpdateState();
  const sync = useSyncState();
  const cloud = useCloudState();
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [list, setList] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    const tables = {
      students: schema.students,
      groups: schema.groups,
      courses: schema.courses,
      hospitals: schema.hospitals,
      evaluations: schema.evaluations,
    };
    Promise.all([
      Promise.all(Object.entries(tables).map(async ([k, t]) => [k, (await orm.select({ n: count() }).from(t))[0].n] as const)),
      backups.entries(),
    ]).then(([counts, entries]) => {
      if (!alive) return;
      setStats(Object.fromEntries(counts));
      setList(entries.sort((a, b) => b.name.localeCompare(a.name)));
    });
    return () => {
      alive = false;
    };
  }, [version, cloud.files.length, cloud.lastUploadAt, cloud.busy]); // also after an online-backup round prunes this computer

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setNote(null);
    try {
      const text = await fn();
      if (text) setNote({ kind: "ok", text });
      refresh();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  // A plain-text report to send when something goes wrong: facts, checks and the log's end.
  const report = () =>
    run("report", async () => {
      const lines = [
        `Eva ${system?.version ?? "?"} · ${system?.os ?? ""} · ${new Date().toISOString()}`,
        `Data: ${system?.data_dir ?? info.path} · DB ${kb(system?.db_bytes ?? 0)} + WAL ${kb(system?.wal_bytes ?? 0)} · free disk ${system?.free_disk_bytes ? kb(system.free_disk_bytes) : "?"}`,
        `Schema: ${startup.schemaVersion} · backups: ${list.length} · counts: ${JSON.stringify(stats)}`,
        `Sync: ${sync.kind} · last ${sync.lastAt ?? "-"} · ${sync.message ?? ""}`,
        `Update: ${update.available?.version ?? "none"} · checked ${update.checkedAt ?? "-"} · ${update.error ?? ""}`,
        "",
        "Self-check:",
        ...checks.map((c) => `  [${c.level}] ${c.title} — ${c.detail}`),
        "",
        "Log (latest lines):",
        await logTail(400).catch((e) => String(e)),
      ];
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const ok = await saveFile(`تقرير Eva ${stamp}.txt`, new TextEncoder().encode(lines.join("\r\n")), { name: "نص", extensions: ["txt"] });
      return ok ? "حُفظ التقرير. أرسله للدعم الفني مع وصف ما حدث." : undefined;
    });

  const backupNow = () =>
    run("backup", async () => {
      const name = await takeBackup(backups, "manual");
      void cloudRound(); // goes online right away when online backups are on
      return `أُخذت نسخة احتياطية: ${formatBackupTime(name)}`;
    });

  const restore = (name: string) =>
    run("restore", async () => {
      if (!(await confirmAction(`استعادة النسخة المأخوذة في ${formatBackupTime(name)}؟\nستُؤخذ نسخة من البيانات الحالية أولًا، ثم يُعاد تشغيل التطبيق.`, "استعادة")))
        return;
      await takeBackup(backups, "before-restore");
      await backups.restore(name);
      await relaunch();
    });

  const importFile = () =>
    run("import", async () => {
      const path = await open({ multiple: false, filters: [{ name: "قاعدة بيانات Eva", extensions: ["db"] }] });
      if (typeof path !== "string") return;
      if (!(await confirmAction("استبدال بيانات التطبيق الحالية بهذا الملف؟\nستُؤخذ نسخة احتياطية من البيانات الحالية أولًا.", "استيراد"))) return;
      await takeBackup(backups, "before-import");
      await backups.importFile(path);
      await relaunch();
    });

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div>
        <h1>النظام</h1>
        <p className="muted">حالة قاعدة البيانات والنسخ الاحتياطية. جميع البيانات محفوظة على هذا الحاسوب.</p>
      </div>

      <p className="note note-ok">
        قاعدة البيانات سليمة · الإصدار <span className="ltr">{startup.schemaVersion}</span>
        {startup.migrated.length > 0 && ` · رُقّيت الآن (${startup.migrated.length})`}
        {startup.backupsTaken.length > 0 && ` · أُخذت نسخة احتياطية عند الفتح`}
        {startup.backupsDeleted > 0 && ` · حُذفت ${startup.backupsDeleted} نسخة قديمة`}
      </p>

      <div className="grid-stats">
        {(
          [
            ["students", "الطلاب"],
            ["groups", "المجموعات"],
            ["courses", "الدورات"],
            ["hospitals", "المستشفيات"],
            ["evaluations", "التقييمات"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="card stat">
            <b className="tabular">{stats ? stats[k] : "…"}</b>
            <span className="muted">{label}</span>
          </div>
        ))}
      </div>

      {note && <p className={`note ${note.kind === "ok" ? "note-ok" : "note-err"}`}>{note.text}</p>}

      <div className="card stack">
        <h2 style={{ margin: 0 }}>الفحص الذاتي</h2>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.id} className={`check-${c.level}`}>
              <span className="check-dot" aria-hidden="true" />
              <div>
                <b>{c.title}</b>
                <div className="muted">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>الإصدار والتحديثات</h2>
          <span className="muted">
            الإصدار الحالي <b className="ltr">{system?.version ?? "…"}</b>
          </span>
        </div>
        {update.installing ? (
          <p className="note note-ok" style={{ margin: 0 }}>
            {update.installing.phase === "backup"
              ? "جارٍ أخذ نسخة احتياطية قبل التحديث…"
              : update.installing.phase === "download"
                ? `جارٍ تنزيل التحديث${update.installing.percent !== null ? ` (${update.installing.percent}%)` : "…"}`
                : "جارٍ التثبيت — سيُعاد تشغيل التطبيق."}
          </p>
        ) : update.available ? (
          <div className="stack">
            <p style={{ margin: 0 }}>
              يتوفر الإصدار <b className="ltr">{update.available.version}</b>
              {update.available.notes ? ` — ${update.available.notes}` : ""}
            </p>
            <div className="row">
              <button className="btn btn-primary" onClick={() => void installUpdate()}>
                تثبيت التحديث الآن
              </button>
              <span className="muted">تُؤخذ نسخة احتياطية أولًا، ثم يُعاد تشغيل التطبيق خلال دقيقة.</span>
            </div>
          </div>
        ) : (
          <div className="row">
            <span className="muted">
              {update.checking ? "جارٍ البحث عن تحديث…" : update.checkedAt ? "لديك أحدث إصدار." : "يبحث التطبيق عن التحديثات تلقائيًا."}
            </span>
            <button className="btn" onClick={() => void checkForUpdate()} disabled={update.checking}>
              البحث عن تحديث
            </button>
          </div>
        )}
        {update.error && !update.installing && <p className="muted small" style={{ margin: 0 }}>{update.error}</p>}
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>الدعم الفني</h2>
        <p className="muted" style={{ margin: 0 }}>
          عند حدوث مشكلة: احفظ تقريرًا تشخيصيًا (لا يحتوي على بيانات الطلاب) وأرسله مع وصف ما حدث.
        </p>
        <div className="row">
          <button className="btn btn-primary" onClick={report} disabled={!!busy}>
            حفظ تقرير تشخيصي…
          </button>
          <button className="btn" onClick={() => void openFolder("logs")}>
            فتح مجلد السجلات
          </button>
          <button className="btn" onClick={() => void openFolder("backups")}>
            فتح مجلد النسخ الاحتياطية
          </button>
          <button className="btn" onClick={() => void openFolder("data")}>
            فتح مجلد البيانات
          </button>
        </div>
      </div>

      <CloudBackupCard onRestore={restore} busy={!!busy} />

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>النسخ على هذا الحاسوب ({list.length})</h2>
          <div className="row">
            <button className="btn btn-primary" onClick={backupNow} disabled={!!busy}>
              {busy === "backup" ? "جارٍ النسخ…" : "نسخة احتياطية الآن"}
            </button>
            <button className="btn" onClick={importFile} disabled={!!busy}>
              استيراد قاعدة بيانات من ملف…
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          تُؤخذ نسخة تلقائيًا كل يوم وقبل أي ترقية أو استيراد أو استعادة.{" "}
          {cloud.enabled
            ? "تُرفع كل نسخة إلى الإنترنت ويبقى على هذا الحاسوب آخر 3 فقط."
            : "يُحتفظ على هذا الحاسوب بآخر 30 نسخة وبنسخة من كل شهر لمدة سنة — فعّل النسخ على الإنترنت لتبقى البيانات آمنة خارجه."}{" "}
          المجلد:{" "}
          <span className="ltr">{info.backups_dir}</span>
        </p>
        <table className="list">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>النوع</th>
              <th>الحجم</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name}>
                <td className="tabular">{formatBackupTime(b.name)}</td>
                <td>{REASON_AR[parseBackupName(b.name)?.reason ?? ""] ?? "—"}</td>
                <td className="tabular">{kb(b.size)}</td>
                <td>
                  <button className="btn" onClick={() => restore(b.name)} disabled={!!busy}>
                    استعادة
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">
        ملف قاعدة البيانات: <span className="ltr">{info.path}</span>
      </p>
    </div>
  );
}
