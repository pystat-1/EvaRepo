// Signed automatic updates from GitHub Releases (tauri-plugin-updater).
// The app checks shortly after start and every 6 hours; the admin chooses
// when to install. Installing always takes a backup first, then downloads
// the update (its signature is checked against the key built into the
// app), installs it and restarts.
import { useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { error as logError, info } from "@tauri-apps/plugin-log";
import { takeBackup } from "@eva/db/startup";
import { backups } from "./db";

export interface UpdateState {
  checking: boolean;
  available: { version: string; notes: string | null; date: string | null } | null;
  installing: null | { phase: "backup" | "download" | "install"; percent: number | null };
  checkedAt: string | null;
  error: string | null;
}

let state: UpdateState = { checking: false, available: null, installing: null, checkedAt: null, error: null };
let pending: Update | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  );
}

export async function checkForUpdate(): Promise<void> {
  if (state.checking || state.installing) return;
  set({ checking: true, error: null });
  try {
    const u = await check({ timeout: 30_000 });
    pending = u;
    set({ available: u ? { version: u.version, notes: u.body ?? null, date: u.date ?? null } : null, checkedAt: new Date().toISOString() });
    if (u) void info(`update available: ${u.version}`);
  } catch (e) {
    // Offline or no release published yet: not the admin's problem, retry later.
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    set({ checking: false });
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) return;
  try {
    set({ installing: { phase: "backup", percent: null }, error: null });
    await takeBackup(backups, "before-update");
    let total = 0;
    let done = 0;
    set({ installing: { phase: "download", percent: 0 } });
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        done += ev.data.chunkLength;
        set({ installing: { phase: "download", percent: total ? Math.round((done / total) * 100) : null } });
      } else if (ev.event === "Finished") set({ installing: { phase: "install", percent: null } });
    });
    void info(`update installed: ${pending.version}`);
    await relaunch();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logError(`update failed: ${msg}`);
    set({ installing: null, error: `تعذّر التحديث: ${msg}. بياناتك كما هي، وأُخذت نسخة احتياطية.` });
  }
}

let started = false;
export function startUpdateChecks() {
  if (started) return;
  started = true;
  setTimeout(() => void checkForUpdate(), 20_000);
  setInterval(() => void checkForUpdate(), 6 * 3600_000);
}
