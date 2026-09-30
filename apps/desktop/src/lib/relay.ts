// Eva Desktop <-> relay. Publishing sends evaluator logins (password
// hashes only) and their bundles; pulling applies validated days in relay
// order, one transaction each (packages/db/src/repo/sync.ts), then reports
// the outcomes back so phones can show them.
import { sha256Hex } from "@eva/core/sync/password";
import type { DaySubmission } from "@eva/core/sync/contract";
import { applyDaySubmission, buildPublication, getSetting, markReported, setSetting, unreportedResults } from "@eva/db/repo/sync";
import { r } from "./repo";

export interface RelayConfig {
  url: string;
  key: string;
}

export async function relayConfig(): Promise<RelayConfig | null> {
  const [url, key] = await Promise.all([getSetting(r, "relay.url"), getSetting(r, "relay.key")]);
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

export async function saveRelayConfig(c: RelayConfig) {
  const url = c.url.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(url)) throw new Error("عنوان الخادم يجب أن يبدأ بـ https://");
  if (c.key.trim().length < 20) throw new Error("مفتاح المدير قصير جدًا");
  await setSetting(r, "relay.url", url);
  await setSetting(r, "relay.key", c.key.trim());
}

async function call(c: RelayConfig, path: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${c.url}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      throw new Error(msg ?? `الخادم ردّ بخطأ ${res.status}`);
    }
    return res.json();
  } catch (e) {
    if (e instanceof DOMException || e instanceof TypeError) throw new Error("تعذّر الاتصال بالخادم — تحقق من الإنترنت");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function relayStatus(c: RelayConfig) {
  return (await call(c, "/admin/status")) as { evaluators: number; bundles: number; submissions: number; lastSeq: number };
}

/** Publishes when anything changed since the last publish (or when forced). */
export async function publish(c: RelayConfig, force = false): Promise<{ published: boolean; evaluators: number; bundles: number }> {
  const pub = await buildPublication(r);
  const fingerprint = await sha256Hex(JSON.stringify({ e: pub.evaluators, b: pub.bundles.map((b) => b.version) }));
  if (!force && fingerprint === (await getSetting(r, "relay.published"))) {
    return { published: false, evaluators: pub.evaluators.length, bundles: pub.bundles.length };
  }
  await call(c, "/admin/publish", { method: "PUT", body: JSON.stringify(pub) });
  await setSetting(r, "relay.published", fingerprint);
  await setSetting(r, "relay.publishedAt", new Date().toISOString());
  return { published: true, evaluators: pub.evaluators.length, bundles: pub.bundles.length };
}

/** Pulls every new validated day, applies it, reports outcomes. */
export async function pull(c: RelayConfig): Promise<{ applied: number; conflicts: number; rejected: number }> {
  const counts = { applied: 0, conflicts: 0, rejected: 0 };
  let cursor = Number((await getSetting(r, "relay.cursor")) ?? 0);
  for (;;) {
    const { submissions } = (await call(c, `/admin/submissions?after=${cursor}&limit=100`)) as {
      submissions: Array<{ seq: number; receivedAt: string; submission: DaySubmission }>;
    };
    if (submissions.length === 0) break;
    for (const s of submissions) {
      const res = await applyDaySubmission(r, s);
      counts[res.outcome === "applied" ? "applied" : res.outcome === "conflict" ? "conflicts" : "rejected"]++;
      cursor = s.seq;
      await setSetting(r, "relay.cursor", String(cursor)); // progress survives a crash mid-pull
    }
  }
  const results = await unreportedResults(r);
  if (results.length) {
    await call(c, "/admin/results", { method: "POST", body: JSON.stringify({ results }) });
    await markReported(r, results.map((x) => x.clientId));
  }
  await setSetting(r, "relay.pulledAt", new Date().toISOString());
  return counts;
}
