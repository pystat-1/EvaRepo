import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { count } from "drizzle-orm";
import { parseBackupName } from "@eva/db/backup";
import { takeBackup, type StartupResult } from "@eva/db/startup";
import * as schema from "@eva/db/schema";
import { backups, orm, type BackupEntry, type DbInfo } from "../lib/db";

const REASON_AR: Record<string, string> = {
  daily: "يومية",
  manual: "يدوية",
  "before-migrate": "قبل الترقية",
  "before-import": "قبل الاستيراد",
  "before-restore": "قبل الاستعادة",
  "before-update": "قبل التحديث",
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
export function SystemScreen({ info, startup }: { info: DbInfo; startup: Extract<StartupResult, { ok: true }> }) {
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
  }, [version]);

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

  const backupNow = () => run("backup", async () => `أُخذت نسخة احتياطية: ${formatBackupTime(await takeBackup(backups, "manual"))}`);

  const restore = (name: string) =>
    run("restore", async () => {
      if (!window.confirm(`استعادة النسخة المأخوذة في ${formatBackupTime(name)}؟\nستُؤخذ نسخة من البيانات الحالية أولًا، ثم يُعاد تشغيل التطبيق.`))
        return;
      await takeBackup(backups, "before-restore");
      await backups.restore(name);
      await relaunch();
    });

  const importFile = () =>
    run("import", async () => {
      const path = await open({ multiple: false, filters: [{ name: "قاعدة بيانات Eva", extensions: ["db"] }] });
      if (typeof path !== "string") return;
      if (!window.confirm("استبدال بيانات التطبيق الحالية بهذا الملف؟\nستُؤخذ نسخة احتياطية من البيانات الحالية أولًا.")) return;
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
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>النسخ الاحتياطية ({list.length})</h2>
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
          تُؤخذ نسخة تلقائيًا كل يوم وقبل أي ترقية أو استيراد أو استعادة. يُحتفظ بآخر 30 نسخة وبنسخة من كل شهر لمدة سنة. المجلد:{" "}
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
