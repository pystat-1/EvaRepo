import { useCallback, useEffect, useRef, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { getBundle, getSession, setSession, type Session } from "./lib/store";
import { AuthError, OfflineError, logout, syncNow, type SyncReport } from "./lib/sync";
import { Login, markSignedOut } from "./screens/Login";
import { Home } from "./screens/Home";
import { DayScreen } from "./screens/DayScreen";

export type SyncState = { kind: "idle" | "syncing" | "offline" | "error"; message?: string; last?: SyncReport };

export function App() {
  const [session, setSess] = useState<Session | null | undefined>(undefined);
  const [bundle, setBundle] = useState<EvaluatorBundle | null>(null);
  const [open, setOpen] = useState<{ groupId: string; dateISO: string } | null>(null);
  const [sync, setSync] = useState<SyncState>({ kind: "idle" });
  const [tick, setTick] = useState(0); // bumps after sync so screens re-read local data
  const running = useRef(false);

  useEffect(() => {
    getSession().then(async (s) => {
      setSess(s);
      if (s) setBundle(await getBundle(s.evaluator.id));
    });
  }, []);

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
        onBack={() => setOpen(null)}
        onValidated={() => {
          setOpen(null);
          void runSync();
        }}
      />
    );

  return <Home session={session} bundle={bundle} sync={sync} tick={tick} onSync={runSync} onOpen={setOpen} onSignOut={signOut} />;
}
