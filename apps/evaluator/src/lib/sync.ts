// Talking to the relay (same origin: the relay also serves this app).
// Every call has a timeout; a dropped connection is "offline", never an
// error the evaluator has to deal with. 401 means "log in again" — the
// drafts and the outbox are kept.
import type { EvaluatorBundle, SubmissionResult } from "@eva/core/sync/contract";
import { getBundle, markSent, outbox, putBundle, saveDecisions, setKv, type Session } from "./store";

export class AuthError extends Error {}
export class OfflineError extends Error {}

async function call(path: string, init: RequestInit & { token?: string } = {}, timeoutMs = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.body) headers.set("content-type", "application/json");
  try {
    const res = await fetch(path, { ...init, headers, signal: ctrl.signal, cache: "no-store" });
    if (res.status === 401) throw new AuthError((await res.json().catch(() => ({}))).error ?? "سجّل الدخول");
    return res;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new OfflineError("لا يوجد اتصال");
  } finally {
    clearTimeout(timer);
  }
}

async function errorOf(res: Response) {
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `خطأ ${res.status}`;
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }).catch(() => {
    throw new OfflineError("لا يوجد اتصال — تسجيل الدخول أول مرة يحتاج إلى إنترنت");
  });
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()) as Session;
}

export async function logout(token: string) {
  await call("/api/logout", { method: "POST", token }).catch(() => undefined);
}

export interface SyncReport {
  sent: number;
  decided: number;
  bundleUpdated: boolean;
  at: string;
}

/** Send validated days, fetch decisions, refresh the bundle. Safe to run any time. */
export async function syncNow(s: Session): Promise<SyncReport> {
  const id = s.evaluator.id;
  let sent = 0;
  const pending = await outbox(id);
  for (let i = 0; i < pending.length; i += 20) {
    const chunk = pending.slice(i, i + 20);
    const res = await call("/api/submissions", { method: "POST", token: s.token, body: JSON.stringify({ submissions: chunk }) });
    if (!res.ok) throw new Error(await errorOf(res));
    const { accepted } = (await res.json()) as { accepted: string[] };
    const ok = chunk.filter((x) => accepted.includes(x.clientId));
    await markSent(id, ok);
    sent += ok.length;
  }

  const rr = await call("/api/results", { token: s.token });
  const { results } = rr.ok ? ((await rr.json()) as { results: SubmissionResult[] }) : { results: [] };
  await saveDecisions(id, results);

  const current = await getBundle(id);
  const br = await call("/api/bundle", { token: s.token, headers: current ? { "if-none-match": current.version } : {} });
  let bundleUpdated = false;
  if (br.status === 200) {
    await putBundle(id, (await br.json()) as EvaluatorBundle);
    bundleUpdated = true;
  } else if (br.status !== 304 && br.status !== 404) {
    throw new Error(await errorOf(br));
  }
  const at = new Date().toISOString();
  await setKv(id, "lastSync", at);
  return { sent, decided: results.length, bundleUpdated, at };
}
