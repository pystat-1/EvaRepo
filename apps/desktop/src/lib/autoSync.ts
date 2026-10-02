// Automatic sync with the phones. Once the server is set up (المزامنة, one
// time), the app keeps itself in step with no button to press:
//   - a few seconds after start,
//   - a few seconds after any change (a new evaluator, a schedule edit…),
//   - every minute (to pick up days validated on phones),
//   - when the internet comes back.
// Each round publishes what changed, pulls new days, reports decisions back
// and refreshes who has signed in on a phone. One round at a time.
import { useSyncExternalStore } from "react";
import { recordPhoneSignIns } from "@eva/db/repo/sync";
import { queryClient, r } from "./repo";
import { publish, pull, relayConfig, relayStatus } from "./relay";

export interface SyncState {
  kind: "off" | "idle" | "syncing" | "offline" | "error";
  lastAt: string | null;
  message: string | null;
  googleSignIn: boolean | null;
}

let state: SyncState = { kind: "idle", lastAt: null, message: null, googleSignIn: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state
  );
}

let running: Promise<void> | null = null;
let again = false;

/** One sync round; if one is running, another follows it. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await round();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

let lastPhones: string | null = null;

async function round() {
  const c = await relayConfig().catch(() => null);
  if (!c) return set({ kind: "off", message: null });
  if (!navigator.onLine) return set({ kind: "offline" });
  set({ kind: "syncing" });
  try {
    const p = await publish(c);
    const g = await pull(c);
    const s = await relayStatus(c);
    const phones = JSON.stringify(s.phones ?? []);
    const phonesChanged = phones !== lastPhones;
    lastPhones = phones;
    // A name taken from a Google account goes straight back out to the phones.
    if (phonesChanged && (await recordPhoneSignIns(r, s.phones ?? [])) > 0) await publish(c);
    set({ kind: "idle", lastAt: new Date().toISOString(), message: null, googleSignIn: s.googleSignIn ?? null });
    if (p.published || g.applied || g.conflicts || g.rejected || phonesChanged) await queryClient.invalidateQueries();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    set({ kind: /الاتصال|الإنترنت/.test(msg) ? "offline" : "error", message: msg });
  }
}

let started = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

/** Starts the background sync once for the app's lifetime. */
export function startAutoSync() {
  if (started) return;
  started = true;
  setTimeout(() => void syncNow(), 3_000);
  setInterval(() => void syncNow(), 60_000);
  window.addEventListener("online", () => void syncNow());
  // Any saved change goes out shortly after (several quick edits = one round).
  queryClient.getMutationCache().subscribe((ev) => {
    if (ev.type !== "updated" || ev.mutation.state.status !== "success") return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), 4_000);
  });
}
