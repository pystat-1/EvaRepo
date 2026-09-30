import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { startup, type StartupResult } from "@eva/db/startup";
import { backups, exec, openDatabase, type DbInfo } from "./lib/db";
import { logScreenCrash } from "./lib/crashLog";
import { SystemScreen } from "./screens/SystemScreen";
import { RecoveryScreen } from "./screens/RecoveryScreen";

// Tabs of the admin app. Phase 3 of docs/DESKTOP_APP_PLAN.md fills in the
// ones marked `soon`; النظام (system) is the first working screen.
const TABS = [
  { key: "students", label: "الطلاب", soon: true },
  { key: "courses", label: "الدورات والجدول", soon: true },
  { key: "grading", label: "مركز الدرجات", soon: true },
  { key: "statistics", label: "الإحصائيات", soon: true },
  { key: "evaluators", label: "المقيّمون", soon: true },
  { key: "system", label: "النظام", soon: false },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Boot =
  | { stage: "starting" }
  | { stage: "ready"; info: DbInfo; result: Extract<StartupResult, { ok: true }> }
  | { stage: "problem"; info: DbInfo | null; result: Exclude<StartupResult, { ok: true }> | { ok: false; reason: "open-failed"; detail: string } };

export function App() {
  const [boot, setBoot] = useState<Boot>({ stage: "starting" });
  const [tab, setTab] = useState<TabKey>("system");

  // Bumped to run the start-up sequence again (after a restore, or retry).
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setBoot({ stage: "starting" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    (async (): Promise<Boot> => {
      let info: DbInfo | null = null;
      try {
        info = await openDatabase();
        const result = await startup(exec, backups);
        return result.ok ? { stage: "ready", info, result } : { stage: "problem", info, result };
      } catch (e) {
        return { stage: "problem", info, result: { ok: false, reason: "open-failed", detail: e instanceof Error ? e.message : String(e) } };
      }
    })().then((next) => alive && setBoot(next));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (boot.stage === "starting") {
    return (
      <div className="main" role="status">
        <p className="muted">جارٍ فتح قاعدة البيانات والتحقق منها…</p>
      </div>
    );
  }
  if (boot.stage === "problem") {
    return <RecoveryScreen problem={boot.result} info={boot.info} onRetry={retry} />;
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="أقسام التطبيق">
        <div className="brand">
          Eva <small>إدارة بيانات التدريب السريري</small>
        </div>
        {TABS.map((t) => (
          <button
            key={t.key}
            className="nav-item"
            aria-current={tab === t.key ? "page" : undefined}
            aria-disabled={t.soon}
            disabled={t.soon}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.soon && <span className="soon">قريبًا</span>}
          </button>
        ))}
      </nav>
      <main className="main">
        {/* Each screen has its own boundary: a bug in one screen shows a
            recovery panel there and never takes down the whole app. */}
        <ErrorBoundary
          key={tab}
          FallbackComponent={ScreenCrash}
          onError={(err, info) => logScreenCrash(tab, err, info.componentStack)}
        >
          {tab === "system" && <SystemScreen info={boot.info} startup={boot.result} />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function ScreenCrash({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="card stack" role="alert">
      <h2>تعذّر عرض هذه الشاشة</h2>
      <p className="muted">
        حدث خطأ غير متوقع وسُجّل في ملف السجل. بياناتك محفوظة في قاعدة البيانات ولم تتأثر.
      </p>
      <code>{error instanceof Error ? error.message : String(error)}</code>
      <div className="row">
        <button className="btn btn-primary" onClick={resetErrorBoundary}>
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}
