// Online backups (Cloudflare R2 through the Eva relay). Each backup the app
// takes is encrypted here and uploaded; online, the usual policy keeps the
// last 30 plus one a month for a year; this computer keeps only the newest
// 3 (lib/cloud/plan.ts). Runs 30 s after start, every 10 minutes and after
// a manual backup. The recovery code is the only way to read the files.
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { error as logError, info } from "@tauri-apps/plugin-log";
import { getSetting, setSetting } from "@eva/db/repo/sync";
import { backups } from "../db";
import { r } from "../repo";
import { cloudDelete, cloudGet, cloudList, cloudPut, relayConfig, type CloudFile, type RelayConfig } from "../relay";
import { codeToKey, decryptBackup, encryptBackup, newRecoveryCode } from "./crypto";
import { REMOTE_SUFFIX, planCloud } from "./plan";

const CODE = "backup.cloudCode";
const LAST = "backup.cloudLastUpload";

export interface CloudState {
  /** null = not known yet; false = not turned on (or sync not set up). */
  enabled: boolean | null;
  relayReady: boolean;
  busy: boolean;
  files: CloudFile[];
  lastUploadAt: string | null;
  error: string | null;
}

let state: CloudState = { enabled: null, relayReady: false, busy: false, files: [], lastUploadAt: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export function useCloudState(): CloudState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  );
}

const readLocal = async (name: string) => new Uint8Array(await invoke<ArrayBuffer>("backup_read", { name }));

async function ready(): Promise<{ c: RelayConfig; key: Uint8Array } | null> {
  const [c, code] = await Promise.all([relayConfig(), getSetting(r, CODE)]);
  set({ relayReady: !!c, enabled: !!(c && code) });
  if (!c || !code) return null;
  const key = await codeToKey(code);
  return key ? { c, key } : null;
}

let running: Promise<void> | null = null;

/** Upload what is missing, thin online copies, keep the newest 3 here. */
export function cloudRound(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      const ok = await ready();
      if (!ok) return;
      if (!navigator.onLine) return set({ error: "لا يوجد اتصال — تُرفع النسخ عند عودته." });
      set({ busy: true, error: null });
      const local = () => backups.list();
      const first = planCloud(await local(), (await cloudList(ok.c)).map((f) => f.name), new Date());
      for (const name of first.upload) {
        await cloudPut(ok.c, name + REMOTE_SUFFIX, await encryptBackup(await readLocal(name), ok.key));
        await setSetting(r, LAST, new Date().toISOString());
        void info(`backup uploaded: ${name}`);
      }
      // Ask again: only what is really online now may be removed here.
      const files = await cloudList(ok.c);
      const second = planCloud(await local(), files.map((f) => f.name), new Date());
      for (const name of second.deleteRemote) await cloudDelete(ok.c, name);
      if (second.deleteLocal.length) await backups.remove(second.deleteLocal);
      set({ files: files.filter((f) => !second.deleteRemote.includes(f.name)), lastUploadAt: await getSetting(r, LAST) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void logError(`online backup: ${msg}`);
      set({ error: msg });
    } finally {
      set({ busy: false });
      running = null;
    }
  })();
  return running;
}

/**
 * Turns online backups on. With no code: a new key (only allowed when
 * nothing is online yet), returned once for the admin to keep. With a code
 * (a new computer, or after reinstalling): checked against the newest
 * online backup before it is saved.
 */
export async function enableCloud(existingCode?: string): Promise<string> {
  const c = await relayConfig();
  if (!c) throw new Error("أعدّ المزامنة أولًا (شاشة المزامنة): النسخ على الإنترنت تستخدم الخادم نفسه.");
  const files = await cloudList(c);
  let code: string;
  if (existingCode) {
    const key = await codeToKey(existingCode);
    if (!key) throw new Error("رمز الاسترداد غير صحيح — تحقق من الأحرف.");
    if (files.length) await decryptBackup(await cloudGet(c, files[0].name), key); // throws if it does not match
    code = existingCode.trim().toUpperCase();
  } else {
    if (files.length) throw new Error("توجد نسخ على الإنترنت مشفّرة برمز سابق — أدخل رمز الاسترداد ذلك.");
    code = await newRecoveryCode();
  }
  await setSetting(r, CODE, code);
  set({ enabled: true, error: null });
  void cloudRound();
  return code;
}

export const recoveryCode = () => getSetting(r, CODE);

/** Downloads, decrypts and saves an online backup into the backups folder; returns its local name. */
export async function downloadFromCloud(remoteName: string): Promise<string> {
  const ok = await ready();
  if (!ok) throw new Error("النسخ على الإنترنت غير مفعّلة على هذا الحاسوب.");
  const plain = await decryptBackup(await cloudGet(ok.c, remoteName), ok.key);
  const name = remoteName.slice(0, -REMOTE_SUFFIX.length);
  await invoke("backup_write", plain, { headers: { "x-backup-name": name } });
  return name;
}

let started = false;
export function startCloudBackups() {
  if (started) return;
  started = true;
  void ready().then(async () => set({ lastUploadAt: await getSetting(r, LAST) }));
  setTimeout(() => void cloudRound(), 30_000);
  setInterval(() => void cloudRound(), 10 * 60_000);
  window.addEventListener("online", () => void cloudRound());
}
