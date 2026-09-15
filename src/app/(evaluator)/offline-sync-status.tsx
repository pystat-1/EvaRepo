"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listOutboxEntries } from "@/lib/offline/db";
import { replayOutbox } from "@/lib/offline/sync";
import type { OutboxEntry } from "@/lib/offline/db";

// Phase 4d: a small, always-mounted status strip for the evaluator app shell
// showing what's still queued locally (Phase 4c's outbox) and driving the
// sync — automatically on the `online` event and on mount (covers reopening
// the app while already back online with leftovers from last session), plus
// a manual button since Background Sync API isn't wired up (see sync.ts).
export function OfflineSyncStatus() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listOutboxEntries());
    } catch {
      // IndexedDB unavailable (e.g. private browsing) — nothing queued we
      // can show; Phase 4c's own save path already surfaces this to the user.
    }
  }, []);

  const sync = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    setSyncing(true);
    try {
      await replayOutbox();
    } catch {
      // Best-effort — a failed sync pass just leaves the outbox as-is for
      // the next trigger.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entries.length === 0) return null;

  const errored = entries.filter((e) => e.error);
  const pending = entries.length - errored.length;

  return (
    <div className="card border-amber-200 bg-amber-50 py-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-amber-800">
          {pending > 0 && `${pending} تقييم بانتظار المزامنة`}
          {pending > 0 && errored.length > 0 && " — "}
          {errored.length > 0 && `${errored.length} يحتاج مراجعة يدوية`}
          {syncing && " — جارِ المزامنة..."}
        </p>
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="btn btn-secondary text-xs px-2 py-1 whitespace-nowrap"
        >
          {syncing ? "..." : "زامن الآن"}
        </button>
      </div>
      {errored.length > 0 && (
        <ul className="flex flex-col gap-1">
          {errored.map((e) => (
            <li key={`${e.studentId}:${e.dateISO}`} className="text-xs">
              <Link href={`/grade/${e.studentId}`} className="text-amber-900 underline">
                {e.error}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
