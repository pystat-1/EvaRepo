import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { QueryClientProvider } from "@tanstack/react-query";
import { startup, takeBackup, type StartupResult } from "@eva/db/startup";
import { backups, exec, openDatabase, type DbInfo } from "./lib/db";
import { logScreenCrash } from "./lib/crashLog";
import { SystemScreen } from "./screens/SystemScreen";
import { RecoveryScreen } from "./screens/RecoveryScreen";
import { StudentsScreen } from "./screens/StudentsScreen";
import { CoursesScreen } from "./screens/CoursesScreen";
import { GradingScreen } from "./screens/GradingScreen";
import { StatisticsScreen } from "./screens/StatisticsScreen";
import { AuditScreen, EvaluatorsScreen } from "./screens/EvaluatorsScreen";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { queryClient } from "./lib/repo";
import { ConfirmHost } from "./components/confirm";
import { SyncScreen, useAutoSync } from "./screens/SyncScreen";

// The admin app's screens. Ctrl+1..7 jumps to them; Ctrl+K opens the
// command palette.
const TABS = [
  { key: "students", label: "الطلاب" },
  { key: "courses", label: "الدورات والجدول" },
  { key: "grading", label: "مركز الدرجات" },
  { key: "statistics", label: "الإحصائيات" },
  { key: "evaluators", label: "المقيّمون" },
  { key: "sync", label: "المزامنة" },
  { key: "audit", label: "سجل التغييرات" },
  { key: "system", label: "النظام" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Boot =
  | { stage: "starting" }
  | { stage: "ready"; info: DbInfo; result: Extract<StartupResult, { ok: true }> }
  | { stage: "problem"; info: DbInfo | null; result: Exclude<StartupResult, { ok: true }> | { ok: false; reason: "open-failed"; detail: string } };

export function App() {
  const [boot, setBoot] = useState<Boot>({ stage: "starting" });
  const [tab, setTab] = useState<TabKey>("students");
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (e.ctrlKey && n >= 1 && n <= TABS.length) {
        e.preventDefault();
        setTab(TABS[n - 1].key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    return (
      <>
        <RecoveryScreen problem={boot.result} info={boot.info} onRetry={retry} />
        <ConfirmHost />
      </>
    );
  }

  return <Ready boot={boot} tab={tab} setTab={setTab} openStudent={openStudent} setOpenStudent={setOpenStudent} />;
}

// The running app (after the database opened safely).
function Ready({
  boot,
  tab,
  setTab,
  openStudent,
  setOpenStudent,
}: {
  boot: Extract<Boot, { stage: "ready" }>;
  tab: TabKey;
  setTab: (t: TabKey) => void;
  openStudent: string | null;
  setOpenStudent: (id: string | null) => void;
}) {
  useAutoSync();
  const paletteActions: PaletteAction[] = [
    ...TABS.map((t, i) => ({ id: `tab-${t.key}`, label: t.label, hint: `Ctrl+${i + 1}`, run: () => setTab(t.key) })),
    {
      id: "backup",
      label: "نسخة احتياطية الآن",
      run: () => void takeBackup(backups, "manual").then(() => queryClient.invalidateQueries()),
    },
  ];

  return (
    <QueryClientProvider client={queryClient}>
      <div className="shell">
        <nav className="sidebar" aria-label="أقسام التطبيق">
          <div className="brand">
            Eva <small>إدارة بيانات التدريب السريري</small>
          </div>
          {TABS.map((t, i) => (
            <button key={t.key} className="nav-item" aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)} title={`Ctrl+${i + 1}`}>
              {t.label}
            </button>
          ))}
          <div className="sidebar-foot muted-light">Ctrl+K للبحث والأوامر</div>
        </nav>
        <main className="main">
          {/* Each screen has its own boundary: a bug in one screen shows a
              recovery panel there and never takes down the whole app. */}
          <ErrorBoundary key={tab} FallbackComponent={ScreenCrash} onError={(err, info) => logScreenCrash(tab, err, info.componentStack)}>
            {tab === "students" && <StudentsScreen openStudentId={openStudent} onOpened={() => setOpenStudent(null)} />}
            {tab === "courses" && <CoursesScreen />}
            {tab === "grading" && <GradingScreen />}
            {tab === "statistics" && <StatisticsScreen />}
            {tab === "evaluators" && <EvaluatorsScreen />}
            {tab === "sync" && <SyncScreen />}
            {tab === "audit" && <AuditScreen />}
            {tab === "system" && <SystemScreen info={boot.info} startup={boot.result} />}
          </ErrorBoundary>
        </main>
      </div>
      <ConfirmHost />
      <CommandPalette
        actions={paletteActions}
        onOpenStudent={(id) => {
          setTab("students");
          setOpenStudent(id);
        }}
      />
    </QueryClientProvider>
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
