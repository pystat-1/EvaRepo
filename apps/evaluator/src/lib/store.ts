// Everything on the phone lives in IndexedDB. The session is global; the
// bundle, drafts, outbox and results live in one database PER EVALUATOR,
// so two evaluators sharing a phone never see or send each other's work.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DaySubmission, EvaluatorBundle, SubmissionResult } from "@eva/core/sync/contract";
import type { Draft } from "./day";

export interface Session {
  token: string;
  evaluator: { id: string; name: string };
}

interface GlobalDB extends DBSchema {
  kv: { key: string; value: unknown };
}

export interface StoredResult extends SubmissionResult {
  groupId: string;
  dateISO: string;
  status: "sent" | "decided"; // sent = waiting for the desktop's decision
}

interface AccountDB extends DBSchema {
  kv: { key: string; value: unknown }; // "bundle", "lastSync"
  drafts: { key: string; value: Draft };
  outbox: { key: string; value: DaySubmission }; // validated, not yet accepted by the relay
  results: { key: string; value: StoredResult }; // by clientId
}

const globalDb = openDB<GlobalDB>("eva-evaluator", 1, { upgrade: (db) => void db.createObjectStore("kv") });

export async function getSession(): Promise<Session | null> {
  return ((await (await globalDb).get("kv", "session")) as Session | undefined) ?? null;
}
export async function setSession(s: Session | null) {
  const db = await globalDb;
  if (s) await db.put("kv", s, "session");
  else await db.delete("kv", "session");
}

const accounts = new Map<string, Promise<IDBPDatabase<AccountDB>>>();
export function accountDb(evaluatorId: string) {
  let p = accounts.get(evaluatorId);
  if (!p) {
    p = openDB<AccountDB>(`eva-evaluator-${evaluatorId}`, 1, {
      upgrade(db) {
        db.createObjectStore("kv");
        db.createObjectStore("drafts");
        db.createObjectStore("outbox");
        db.createObjectStore("results");
      },
    });
    accounts.set(evaluatorId, p);
  }
  return p;
}

export async function getBundle(id: string) {
  return ((await (await accountDb(id)).get("kv", "bundle")) as EvaluatorBundle | undefined) ?? null;
}
export async function putBundle(id: string, b: EvaluatorBundle) {
  await (await accountDb(id)).put("kv", b, "bundle");
}
export async function getDraft(id: string, key: string) {
  return (await (await accountDb(id)).get("drafts", key)) ?? null;
}
export async function putDraft(id: string, d: Draft) {
  await (await accountDb(id)).put("drafts", d, d.key);
}
export async function allDrafts(id: string) {
  return (await accountDb(id)).getAll("drafts");
}

/** Validation: the draft is closed and its package queued, in one transaction. */
export async function queueValidatedDay(id: string, draft: Draft, sub: DaySubmission) {
  const db = await accountDb(id);
  const tx = db.transaction(["drafts", "outbox"], "readwrite");
  await tx.objectStore("drafts").put({ ...draft, status: "validated", clientId: sub.clientId, updatedAt: new Date().toISOString() }, draft.key);
  await tx.objectStore("outbox").put(sub, sub.clientId);
  await tx.done;
}

export async function outbox(id: string) {
  return (await accountDb(id)).getAll("outbox");
}
export async function markSent(id: string, subs: DaySubmission[]) {
  const db = await accountDb(id);
  const tx = db.transaction(["outbox", "results"], "readwrite");
  for (const s of subs) {
    await tx.objectStore("outbox").delete(s.clientId);
    const prev = await tx.objectStore("results").get(s.clientId);
    if (!prev) await tx.objectStore("results").put({ clientId: s.clientId, outcome: "applied", message: "أُرسل — بانتظار المدير", groupId: s.groupId, dateISO: s.dateISO, status: "sent" }, s.clientId);
  }
  await tx.done;
}
export async function saveDecisions(id: string, decided: SubmissionResult[]) {
  const db = await accountDb(id);
  const tx = db.transaction("results", "readwrite");
  for (const r of decided) {
    const prev = await tx.store.get(r.clientId);
    if (prev) await tx.store.put({ ...prev, outcome: r.outcome, message: r.message, status: "decided" }, r.clientId);
  }
  await tx.done;
}
export async function allResults(id: string) {
  return (await accountDb(id)).getAll("results");
}
export async function getKv<T>(id: string, key: string) {
  return ((await (await accountDb(id)).get("kv", key)) as T | undefined) ?? null;
}
export async function setKv(id: string, key: string, value: unknown) {
  await (await accountDb(id)).put("kv", value, key);
}
