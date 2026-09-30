// The start-up self-check (docs/DESKTOP_APP_PLAN.md §7): plain rules over
// facts gathered by lib/health.ts, so they are tested without the app.
// Every problem says in Arabic what is wrong and what to do next.

export type Level = "ok" | "warn" | "err";

export interface Check {
  id: "database" | "disk" | "backup" | "sync" | "decisions" | "update";
  level: Level;
  title: string;
  detail: string;
  /** Where the fix is: a tab of the app. */
  go?: "system" | "sync";
}

export interface Facts {
  now: Date;
  integrity: string; // "ok" or SQLite's message
  freeDiskBytes: number | null;
  lastBackupAt: Date | null;
  sync: { configured: boolean; kind: "off" | "idle" | "syncing" | "offline" | "error"; lastAt: string | null; message: string | null };
  openDecisions: number;
  update: { version: string } | null;
}

const MB = 1024 * 1024;
const HOUR = 3600_000;

const hoursAgo = (now: Date, d: Date) => (now.getTime() - d.getTime()) / HOUR;
const ago = (h: number) => (h < 1 ? "قبل أقل من ساعة" : h < 48 ? `قبل ${Math.round(h)} ساعة` : `قبل ${Math.round(h / 24)} يوم`);

export function selfCheck(f: Facts): Check[] {
  const out: Check[] = [];

  out.push(
    f.integrity === "ok"
      ? { id: "database", level: "ok", title: "قاعدة البيانات سليمة", detail: "اجتاز الملف فحص السلامة عند التشغيل." }
      : { id: "database", level: "err", title: "قاعدة البيانات تحتاج انتباهًا", detail: `نتيجة الفحص: ${f.integrity}. استعد آخر نسخة احتياطية سليمة من شاشة النظام.`, go: "system" }
  );

  if (f.freeDiskBytes !== null) {
    const free = f.freeDiskBytes / MB;
    const text = free >= 1024 ? `${(free / 1024).toFixed(1)} GB` : `${Math.round(free)} MB`;
    out.push(
      free < 200
        ? { id: "disk", level: "err", title: "المساحة على القرص شبه ممتلئة", detail: `المتاح ${text} فقط — قد يتعذّر الحفظ وأخذ النسخ الاحتياطية. أفرغ مساحة على القرص.` }
        : free < 1024
          ? { id: "disk", level: "warn", title: "المساحة على القرص قليلة", detail: `المتاح ${text}. يُفضَّل إفراغ بعض المساحة.` }
          : { id: "disk", level: "ok", title: "مساحة القرص كافية", detail: `المتاح ${text}.` }
    );
  }

  if (!f.lastBackupAt) {
    out.push({ id: "backup", level: "err", title: "لا توجد نسخة احتياطية", detail: "خذ نسخة احتياطية الآن من شاشة النظام.", go: "system" });
  } else {
    const h = hoursAgo(f.now, f.lastBackupAt);
    out.push(
      h > 24 * 7
        ? { id: "backup", level: "err", title: "آخر نسخة احتياطية قديمة", detail: `أُخذت ${ago(h)}. خذ نسخة الآن.`, go: "system" }
        : h > 30
          ? { id: "backup", level: "warn", title: "النسخة الاحتياطية اليومية متأخرة", detail: `آخر نسخة ${ago(h)}. تُؤخذ تلقائيًا عند التشغيل كل يوم.`, go: "system" }
          : { id: "backup", level: "ok", title: "النسخ الاحتياطية منتظمة", detail: `آخر نسخة ${ago(h)}.` }
    );
  }

  const s = f.sync;
  if (!s.configured) {
    out.push({ id: "sync", level: "warn", title: "المزامنة مع الهواتف غير مُعدّة", detail: "أدخل مفتاح المدير مرة واحدة في شاشة المزامنة لتصل الجداول إلى المقيّمين.", go: "sync" });
  } else if (s.kind === "error") {
    out.push({ id: "sync", level: "err", title: "تتعذّر المزامنة", detail: `${s.message ?? "خطأ غير معروف"} — تُعاد المحاولة تلقائيًا كل دقيقة.`, go: "sync" });
  } else if (s.kind === "offline") {
    out.push({ id: "sync", level: "warn", title: "لا يوجد اتصال بالإنترنت", detail: "يعمل التطبيق كالمعتاد؛ تُكمل المزامنة تلقائيًا عند عودة الاتصال.", go: "sync" });
  } else if (s.lastAt && hoursAgo(f.now, new Date(s.lastAt)) > 1) {
    out.push({ id: "sync", level: "warn", title: "لم تنجح المزامنة منذ مدة", detail: `آخر مزامنة ${ago(hoursAgo(f.now, new Date(s.lastAt)))}.`, go: "sync" });
  } else {
    out.push({ id: "sync", level: "ok", title: "المزامنة تعمل تلقائيًا", detail: s.lastAt ? "آخر مزامنة قبل دقائق." : "تبدأ خلال ثوانٍ." });
  }

  if (f.openDecisions > 0)
    out.push({ id: "decisions", level: "warn", title: `${f.openDecisions} يوم بانتظار قرارك`, detail: "تعارض أو يوم مرفوض من هاتف مقيّم — راجعه في شاشة المزامنة.", go: "sync" });

  if (f.update) out.push({ id: "update", level: "warn", title: `يتوفر إصدار جديد (${f.update.version})`, detail: "ثبّته من شاشة النظام؛ تُؤخذ نسخة احتياطية قبل التحديث.", go: "system" });

  return out;
}

export const worst = (checks: Check[]): Level => (checks.some((c) => c.level === "err") ? "err" : checks.some((c) => c.level === "warn") ? "warn" : "ok");
