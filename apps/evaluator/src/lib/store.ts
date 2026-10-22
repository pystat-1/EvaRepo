// Everything on the phone lives in IndexedDB. The session is global; the
// bundle, drafts, outbox and results live in one database PER EVALUATOR,
// so two evaluators sharing a phone never see or send each other's work.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Colleague, DayShare, DaySubmission, EvaluatorBundle, InboxShare, SentShare, SharedAssignment, ShareStatus, SubmissionResult } from "@eva/core/sync/contract";
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

/** An assignment (واجب) recorded on this phone, or merged from a colleague's share. */
export interface Assignment extends SharedAssignment {
  groupId: string;
  createdAt: string;
  /** Who sent it, when it came from a colleague. */
  from?: string;
}

/** «الزملاء» as last fetched from the relay, plus what this phone decided since. */
export interface ShareBox {
  inbox: InboxShare[];
  sent: SentShare[];
  colleagues: Colleague[];
  /** Shares queued on this phone, not yet accepted by the relay. */
  outbox: DayShare[];
  /** Merges and dismissals not yet reported to the relay (they show at once). */
  decisions: Record<string, ShareStatus>;
  /** Shares the relay refused, with why. */
  refused: Record<string, string>;
}

interface AccountDB extends DBSchema {
  kv: { key: string; value: unknown }; // "bundle", "lastSync", "shares", "shareDecisions", "shareRefused"
  drafts: { key: string; value: Draft };
  outbox: { key: string; value: DaySubmission }; // validated, not yet accepted by the relay
  results: { key: string; value: StoredResult }; // by clientId
  assignments: { key: string; value: Assignment }; // by id
  shareOutbox: { key: string; value: DayShare }; // by id
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
    p = openDB<AccountDB>(`eva-evaluator-${evaluatorId}`, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore("kv");
          db.createObjectStore("drafts");
          db.createObjectStore("outbox");
          db.createObjectStore("results");
        }
        // 2: assignments (الواجبات) and shares with colleagues (الزملاء).
        if (oldVersion < 2) {
          db.createObjectStore("assignments");
          db.createObjectStore("shareOutbox");
        }
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

// ---- الواجبات -----------------------------------------------------------------

export async function allAssignments(id: string) {
  return (await accountDb(id)).getAll("assignments");
}
/** Adds or replaces assignments (the same id twice is one assignment). */
export async function putAssignments(id: string, list: Assignment[]) {
  const db = await accountDb(id);
  const tx = db.transaction("assignments", "readwrite");
  for (const a of list) await tx.store.put(a, a.id);
  await tx.done;
}
export async function deleteAssignment(id: string, assignmentId: string) {
  await (await accountDb(id)).delete("assignments", assignmentId);
}

// ---- الزملاء ---------------------------------------------------------------------

export async function getShareBox(id: string): Promise<ShareBox> {
  const db = await accountDb(id);
  const fetched = ((await db.get("kv", "shares")) as Pick<ShareBox, "inbox" | "sent" | "colleagues"> | undefined) ?? { inbox: [], sent: [], colleagues: [] };
  return {
    ...fetched,
    outbox: await db.getAll("shareOutbox"),
    decisions: ((await db.get("kv", "shareDecisions")) as Record<string, ShareStatus> | undefined) ?? {},
    refused: ((await db.get("kv", "shareRefused")) as Record<string, string> | undefined) ?? {},
  };
}
export async function putFetchedShares(id: string, fetched: Pick<ShareBox, "inbox" | "sent" | "colleagues">) {
  await (await accountDb(id)).put("kv", fetched, "shares");
}
export async function queueShares(id: string, shares: DayShare[]) {
  const db = await accountDb(id);
  const tx = db.transaction("shareOutbox", "readwrite");
  for (const s of shares) await tx.store.put(s, s.id);
  await tx.done;
}
/** The relay took (or refused) these shares: they leave the outbox. */
export async function sharesSent(id: string, ids: string[], refused: Array<{ id: string; message: string }>) {
  const db = await accountDb(id);
  const tx = db.transaction(["shareOutbox", "kv"], "readwrite");
  for (const x of [...ids, ...refused.map((r) => r.id)]) await tx.objectStore("shareOutbox").delete(x);
  if (refused.length) {
    const prev = ((await tx.objectStore("kv").get("shareRefused")) as Record<string, string> | undefined) ?? {};
    await tx.objectStore("kv").put({ ...prev, ...Object.fromEntries(refused.map((r) => [r.id, r.message])) }, "shareRefused");
  }
  await tx.done;
}
export async function decideShare(id: string, shareId: string, status: ShareStatus) {
  const db = await accountDb(id);
  const prev = ((await db.get("kv", "shareDecisions")) as Record<string, ShareStatus> | undefined) ?? {};
  await db.put("kv", { ...prev, [shareId]: status }, "shareDecisions");
}
/** Decisions the relay has recorded are no longer pending. */
export async function decisionsReported(id: string, ids: string[]) {
  const db = await accountDb(id);
  const prev = ((await db.get("kv", "shareDecisions")) as Record<string, ShareStatus> | undefined) ?? {};
  for (const x of ids) delete prev[x];
  await db.put("kv", prev, "shareDecisions");
}
