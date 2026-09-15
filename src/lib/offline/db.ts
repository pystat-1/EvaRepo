import { openDB, DBSchema, IDBPDatabase } from "idb";
import type { EvaluatorStint } from "@/lib/models/evaluators";
import type { StudentBasic } from "@/lib/models/students";
import type { RubricSection } from "@/lib/models/rubric";
import type { EvaluationWithScores } from "@/lib/models/evaluations";

const DB_NAME = "eva-offline";
const DB_VERSION = 1;

// Browser-only cache for Phase 4b ("import once"): the evaluator's schedule,
// each stint's roster, the active rubric, and today's already-saved
// evaluations, all populated in one shot by the "استيراد الجدول للعمل دون
// اتصال" action so Phase 4c's offline grading UI has something to read from.
interface EvaOfflineDB extends DBSchema {
  meta: { key: string; value: { importedAt: string; dateISO: string } };
  schedule: { key: string; value: EvaluatorStint[] };
  rosters: { key: string; value: StudentBasic[] }; // key = groupId
  rubricSections: { key: string; value: RubricSection[] };
  evaluations: { key: string; value: EvaluationWithScores }; // key = `${studentId}:${dateISO}`
}

const SINGLETON_KEY = "current";
const LAST_IMPORT_KEY = "lastImport";

let dbPromise: Promise<IDBPDatabase<EvaOfflineDB>> | null = null;

function getDb(): Promise<IDBPDatabase<EvaOfflineDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB غير متاح في هذا المتصفح"));
  }
  if (!dbPromise) {
    dbPromise = openDB<EvaOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("schedule");
        db.createObjectStore("rosters");
        db.createObjectStore("rubricSections");
        db.createObjectStore("evaluations");
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
