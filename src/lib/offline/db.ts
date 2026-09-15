import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { EvaluatorStint } from "@/lib/models/evaluators";
import type { StudentBasic } from "@/lib/models/students";
import type { RubricSection } from "@/lib/models/rubric";
import type { EvaluationWithScores, Attendance } from "@/lib/models/evaluations";

const DB_NAME = "eva-offline";
const DB_VERSION = 2;

// A grade submission made while offline — the same shape gradeStudentAction
// takes, queued locally instead of reaching the server. Phase 4c writes/
// reads this store; Phase 4d (`src/lib/offline/sync.ts`) replays it through
// gradeStudentAction and, on a non-network failure (scope/schedule/rubric
// changed server-side while offline), sets `error` instead of resubmitting
// blindly or dropping the entry.
export interface OutboxEntry {
  studentId: string;
  dateISO: string;
  attendance: Attendance;
  notes?: string;
  feedback?: string;
  scores: Record<string, number>;
  queuedAt: string;
  error?: string;
}

// Browser-only cache for Phase 4b ("import once"): the evaluator's schedule,
// each stint's roster, the active rubric, and today's already-saved
// evaluations, all populated in one shot by the "استيراد الجدول للعمل دون
// اتصال" action so Phase 4c's offline grading UI has something to read from.
// `outbox` (added in v2) is Phase 4c's local queue of not-yet-synced saves.
interface EvaOfflineDB extends DBSchema {
  meta: { key: string; value: { importedAt: string; dateISO: string } };
  schedule: { key: string; value: EvaluatorStint[] };
  rosters: { key: string; value: StudentBasic[] }; // key = groupId
  rubricSections: { key: string; value: RubricSection[] };
  evaluations: { key: string; value: EvaluationWithScores }; // key = `${studentId}:${dateISO}`
  outbox: { key: string; value: OutboxEntry }; // key = `${studentId}:${dateISO}`
}

const SINGLETON_KEY = "current";
const LAST_IMPORT_KEY = "lastImport";

function outboxKey(studentId: string, dateISO: string): string {
  return `${studentId}:${dateISO}`;
}

let dbPromise: Promise<IDBPDatabase<EvaOfflineDB>> | null = null;

function getDb(): Promise<IDBPDatabase<EvaOfflineDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB غير متاح في هذا المتصفح"));
  }
  if (!dbPromise) {
    dbPromise = openDB<EvaOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Guarded so a v1 -> v2 upgrade on an evaluator's existing browser
        // (already holding an imported bundle) only adds the new store
        // instead of erroring on stores that already exist.
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("schedule")) db.createObjectStore("schedule");
        if (!db.objectStoreNames.contains("rosters")) db.createObjectStore("rosters");
        if (!db.objectStoreNames.contains("rubricSections")) db.createObjectStore("rubricSections");
        if (!db.objectStoreNames.contains("evaluations")) db.createObjectStore("evaluations");
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox");
      },
    });
  }
  return dbPromise;
}

export interface OfflineBundle {
  dateISO: string;
  schedule: EvaluatorStint[];
  rosters: Record<string, StudentBasic[]>;
  rubricSections: RubricSection[];
  evaluations: Record<string, EvaluationWithScores>;
}

export interface LastImportMeta {
  importedAt: string;
  dateISO: string;
}

export async function saveOfflineBundle(bundle: OfflineBundle): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["meta", "schedule", "rosters", "rubricSections", "evaluations"], "readwrite");
  const meta: LastImportMeta = { importedAt: new Date().toISOString(), dateISO: bundle.dateISO };
  await Promise.all([
    tx.objectStore("schedule").put(bundle.schedule, SINGLETON_KEY),
    tx.objectStore("rubricSections").put(bundle.rubricSections, SINGLETON_KEY),
    tx.objectStore("meta").put(meta, LAST_IMPORT_KEY),
    ...Object.entries(bundle.rosters).map(([groupId, roster]) =>
      tx.objectStore("rosters").put(roster, groupId)
    ),
    ...Object.entries(bundle.evaluations).map(([key, evaluation]) =>
      tx.objectStore("evaluations").put(evaluation, key)
    ),
    tx.done,
  ]);
}

export async function getLastImportMeta(): Promise<LastImportMeta | undefined> {
  const db = await getDb();
  return db.get("meta", LAST_IMPORT_KEY);
}

export async function getOfflineSchedule(): Promise<EvaluatorStint[] | undefined> {
  const db = await getDb();
  return db.get("schedule", SINGLETON_KEY);
}

export async function getOfflineRoster(groupId: string): Promise<StudentBasic[] | undefined> {
  const db = await getDb();
  return db.get("rosters", groupId);
}

export async function getOfflineRubricSections(): Promise<RubricSection[] | undefined> {
  const db = await getDb();
  return db.get("rubricSections", SINGLETON_KEY);
}

export async function getOfflineEvaluation(
  studentId: string,
  dateISO: string
): Promise<EvaluationWithScores | undefined> {
  const db = await getDb();
  return db.get("evaluations", `${studentId}:${dateISO}`);
}

// Rosters are keyed by groupId (see saveOfflineBundle), and StudentBasic
// doesn't carry its own groupId — so finding a student offline means
// scanning the cached rosters, same as the server would join through
// Student.groupId. Also doubles as the offline "is this evaluator even
// scoped to this student" check: a student who isn't in any cached roster
// was never in an offline-bundle-imported stint.
export async function findOfflineStudent(
  studentId: string
): Promise<{ groupId: string; student: StudentBasic } | undefined> {
  const db = await getDb();
  const groupIds = await db.getAllKeys("rosters");
  for (const groupId of groupIds) {
    const roster = await db.get("rosters", groupId);
    const student = roster?.find((s) => s.id === studentId);
    if (student) return { groupId: String(groupId), student };
  }
  return undefined;
}

export async function queueOutboxEntry(entry: OutboxEntry): Promise<void> {
  const db = await getDb();
  // A resubmission (e.g. the evaluator reopens and re-saves the same
  // student/date) clears any previous sync error — it's a fresh attempt.
  await db.put("outbox", { ...entry, error: undefined }, outboxKey(entry.studentId, entry.dateISO));
}

export async function getOutboxEntry(
  studentId: string,
  dateISO: string
): Promise<OutboxEntry | undefined> {
  const db = await getDb();
  return db.get("outbox", outboxKey(studentId, dateISO));
}

export async function listOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await getDb();
  return db.getAll("outbox");
}

export async function removeOutboxEntry(studentId: string, dateISO: string): Promise<void> {
  const db = await getDb();
  await db.delete("outbox", outboxKey(studentId, dateISO));
}

export async function setOutboxEntryError(studentId: string, dateISO: string, error: string): Promise<void> {
  const db = await getDb();
  const key = outboxKey(studentId, dateISO);
  const entry = await db.get("outbox", key);
  if (!entry) return;
  await db.put("outbox", { ...entry, error }, key);
}
