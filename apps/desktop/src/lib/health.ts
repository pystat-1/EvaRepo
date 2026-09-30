// Gathers the facts for the self-check (lib/selfCheck.ts) from the app:
// the start-up integrity result, disk space (Rust), the newest backup, the
// automatic sync, decisions waiting in the inbox and a pending update.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseBackupName } from "@eva/db/backup";
import { inbox } from "@eva/db/repo/sync";
import { backups } from "./db";
import { r } from "./repo";
import { relayConfig } from "./relay";
import { useSyncState } from "./autoSync";
import { useUpdateState } from "./updater";
import { selfCheck, type Check } from "./selfCheck";

export interface SystemInfo {
  version: string;
  data_dir: string;
  log_dir: string;
  db_bytes: number;
  wal_bytes: number;
  free_disk_bytes: number | null;
  os: string;
}

export const systemInfo = () => invoke<SystemInfo>("system_info");
export const logTail = (lines = 400) => invoke<string>("log_tail", { lines });
export const openFolder = (which: "logs" | "backups" | "data") => invoke<void>("open_folder", { which });

export async function newestBackup(): Promise<Date | null> {
  const dates = (await backups.entries()).map((b) => parseBackupName(b.name)?.takenAt).filter((d): d is Date => !!d);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

/** The self-check, refreshed every 5 minutes and whenever sync or update state changes. */
export function useHealth(integrity: string): { checks: Check[]; info: SystemInfo | null } {
  const sync = useSyncState();
  const update = useUpdateState();
  const [checks, setChecks] = useState<Check[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [sys, last, box, config] = await Promise.all([
        systemInfo().catch(() => null),
        newestBackup().catch(() => null),
        inbox(r).catch(() => []),
        relayConfig().catch(() => null),
      ]);
      if (!alive) return;
      setInfo(sys);
      setChecks(
        selfCheck({
          now: new Date(),
          integrity,
          freeDiskBytes: sys?.free_disk_bytes ?? null,
          lastBackupAt: last,
          sync: { configured: !!config, kind: sync.kind, lastAt: sync.lastAt, message: sync.message },
          openDecisions: box.filter((x) => x.status !== "applied").length,
          update: update.available ? { version: update.available.version } : null,
        })
      );
    })();
    return () => {
      alive = false;
    };
  }, [integrity, sync.kind, sync.lastAt, sync.message, update.available, tick]);
  return { checks, info };
}
