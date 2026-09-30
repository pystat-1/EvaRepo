import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { allDrafts, allResults, getBundle, getKv, getSession, outbox, setSession, type Session, type StoredResult } from "./lib/store";
import { AuthError, OfflineError, logout, syncNow, type SyncReport } from "./lib/sync";
import type { Draft } from "./lib/day";
import { dayEntries } from "./lib/views";
import { Login, markSignedOut } from "./screens/Login";
import { Home } from "./screens/Home";
import { DayScreen } from "./screens/DayScreen";
import { Schedule } from "./screens/Schedule";
import { Records } from "./screens/Records";
import { Students } from "./screens/Students";

export type SyncState = { kind: "idle" | "syncing" | "offline" | "error"; message?: string; last?: SyncReport };
type Tab = "today" | "schedule" | "records" | "students";
const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "today", label: "اليوم", icon: "M4 5h16v15H4zM4 9h16M9 3v4M15 3v4" },
  { key: "schedule", label: "جدولي", icon: "M4 4h16v16H4zM4 9h16M4 14h16M9 9v11M15 9v11" },
  { key: "records", label: "السجلات", icon: "M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3" },
  { key: "students", label: "طلابي", icon: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 1 0 0-6M18 20c0-2.4-1-4.3-2.5-5.3" },
];

export function App() {
  const [session, setSess] = useState<Session | null | undefined>(undefined);
  const [bundle, setBundle] = useState<EvaluatorBundle | null>(null);
  const [open, setOpen] = useState<{ groupId: string; dateISO: string } | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  const [tick, setTick] = useState(0); // bumps after sync so screens re-read local data
  const [local, setLocal] = useState<{ drafts: Draft[]; results: StoredResult[]; unsent: number; lastSync: string | null }>({
    drafts: [],
    results: [],
    unsent: 0,
    lastSync: null,
  });
  const running = useRef(false);

  useEffect(() => {
    getSession().then(async (s) => {
      setSess(s);
      if (s) setBundle(await getBundle(s.evaluator.id));
    });
  }, []);

  // What this phone holds: drafts, validated days and their outcomes.
  useEffect(() => {
    if (!session) return;
    const id = session.evaluator.id;
    Promise.all([allDrafts(id), allResults(id), outbox(id), getKv<string>(id, "lastSync")]).then(([drafts, results, o, lastSync]) =>
      setLocal({ drafts, results, unsent: o.length, lastSync })
    );
  }, [session, tick, open]);

  const entries = useMemo(() => (bundle ? dayEntries(bundle, local.drafts, local.results) : []), [bundle, local]);

  const runSync = useCallback(async () => {
    if (!session || running.current) return;
    running.current = true;
    setSync((x) => ({ ...x, kind: "syncing" }));
    try {
      const report = await syncNow(session);
      setBundle(await getBundle(session.evaluator.id));
      setSync({ kind: "idle", last: report });
    } catch (e) {
      if (e instanceof AuthError) {
        await setSession(null);
        setSess(null);
      } else if (e instanceof OfflineError) setSync((x) => ({ ...x, kind: "offline" }));
      else setSync((x) => ({ ...x, kind: "error", message: e instanceof Error ? e.message : String(e) }));
    } finally {
      running.current = false;
      setTick((t) => t + 1);
    }
  }, [session]);

  // Sync on open, when the connection returns, and every minute while visible.
  useEffect(() => {
    if (!session) return;
    const kick = () => void runSync();
    const first = setTimeout(kick, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && kick(), 60_000);
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [session, runSync]);

  if (session === undefined) return <div className="screen center muted">…</div>;
  if (!session)
    return (
      <Login
        onDone={async (s) => {
          await setSession(s);
          setSess(s);
          setBundle(await getBundle(s.evaluator.id));
        }}
      />
    );

  const signOut = async () => {
    if (!window.confirm("تسجيل الخروج؟ تبقى مسوداتك والأيام غير المرسلة محفوظة على هذا الهاتف وتُرسل عند الدخول مجددًا.")) return;
    await logout(session.token);
    markSignedOut(true);
    await setSession(null);
    setSess(null);
  };

  if (open && bundle)
    return (
      <DayScreen
        session={session}
        bundle={bundle}
        groupId={open.groupId}
        dateISO={open.dateISO}
        entries={entries}
        onBack={() => setOpen(null)}
        onValidated={() => {
          setOpen(null);
          void runSync();
        }}
      />
    );

  return (
    <div className="screen with-nav">
      <header className="top">
        <div>
          <b>{bundle?.evaluator.name ?? session.evaluator.name}</b>
          <div className="muted small">{bundle?.course.label ?? "—"}</div>
        </div>
        <div className="row">
          <button className={`chip ${sync.kind}`} onClick={runSync} aria-label="مزامنة الآن">
            {sync.kind === "syncing" ? "جارٍ المزامنة…" : sync.kind === "offline" ? "دون اتصال" : sync.kind === "error" ? "خطأ في المزامنة" : "متزامن"}
            {local.unsent > 0 && ` · ${local.unsent} بانتظار الإرسال`}
          </button>
          <button className="btn ghost" onClick={signOut}>
            خروج
          </button>
        </div>
      </header>
      {sync.kind === "error" && <p className="note err">{sync.message}</p>}
      {!bundle ? (
        <p className="note warn">لم يُنزَّل جدولك بعد — افتح التطبيق وأنت متصل بالإنترنت.</p>
      ) : tab === "today" ? (
        <Home bundle={bundle} drafts={local.drafts} results={local.results} onOpen={setOpen} />
      ) : tab === "schedule" ? (
        <Schedule bundle={bundle} entries={entries} drafts={local.drafts} lastSync={local.lastSync} onOpen={setOpen} />
      ) : tab === "records" ? (
        <Records bundle={bundle} entries={entries} onOpen={setOpen} />
      ) : (
        <Students bundle={bundle} entries={entries} />
      )}
      <nav className="tabbar" aria-label="أقسام التطبيق">
        {TABS.map((t) => (
          <button key={t.key} aria-current={tab === t.key ? "page" : undefined} onClick={() => (setTab(t.key), window.scrollTo(0, 0))}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
