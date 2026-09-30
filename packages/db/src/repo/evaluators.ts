// Evaluators (accounts with role EVALUATOR), what they cover (a whole
// hospital, or one group in it), their phone activity, and the Excel import.
import { and, eq, sql } from "drizzle-orm";
import { compareArabic, normalizeArabic } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";

export interface EvaluatorAssignmentRow {
  assignmentId: string;
  hospitalId: string;
  hospitalName: string;
  /** null = every group placed at the hospital. */
  groupId: string | null;
  groupName: string | null;
  courseId: string | null;
}

export interface EvaluatorRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  hospitals: EvaluatorAssignmentRow[];
  /** From the phone (sync inbox): last day received, days applied, conflicts waiting. */
  lastReceivedAt: string | null;
  daysApplied: number;
  openConflicts: number;
}

export async function listEvaluators(r: Repo, includeInactive = true): Promise<EvaluatorRow[]> {
  const accounts = await r.db
    .select()
    .from(t.accounts)
    .where(and(eq(t.accounts.role, "EVALUATOR"), includeInactive ? undefined : eq(t.accounts.active, true)));
  const assignments = await r.db
    .select({ a: t.evaluatorAssignments, hospitalName: t.hospitals.name, groupName: t.groups.name })
    .from(t.evaluatorAssignments)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.evaluatorAssignments.hospitalId))
    .leftJoin(t.groups, eq(t.groups.id, t.evaluatorAssignments.groupId))
    .where(eq(t.evaluatorAssignments.active, true));
  const activity = await r.db
    .select({
      evaluatorId: t.syncInbox.evaluatorId,
      last: sql<string | null>`max(${t.syncInbox.receivedAt})`,
      applied: sql<number>`sum(case when ${t.syncInbox.status} = 'applied' then 1 else 0 end)`,
      conflicts: sql<number>`sum(case when ${t.syncInbox.status} = 'conflict' then 1 else 0 end)`,
    })
    .from(t.syncInbox)
    .groupBy(t.syncInbox.evaluatorId);
  const byEvaluator = new Map(activity.map((a) => [a.evaluatorId, a]));
  return accounts
    .map((acc) => {
      const act = byEvaluator.get(acc.id);
      return {
        id: acc.id,
        name: acc.name,
        email: acc.email,
        active: acc.active,
        hospitals: assignments
          .filter((x) => x.a.accountId === acc.id)
          .map((x) => ({
            assignmentId: x.a.id,
            hospitalId: x.a.hospitalId,
            hospitalName: x.hospitalName,
            groupId: x.a.groupId,
            groupName: x.groupName,
            courseId: x.a.courseId,
          }))
          .sort((a, b) => compareArabic(a.hospitalName, b.hospitalName) || compareArabic(a.groupName ?? "", b.groupName ?? "")),
        lastReceivedAt: act?.last ?? null,
        daysApplied: Number(act?.applied ?? 0),
        openConflicts: Number(act?.conflicts ?? 0),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || compareArabic(a.name, b.name));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanName = (s: string) => s.replace(/\s+/g, " ").trim();
const cleanEmail = (s: string) => s.trim().toLowerCase();

/**
 * The name given to an evaluator added with the email only. It is replaced
 * by the name on their Google account when they first sign in on the phone
 * (sync.ts recordPhoneSignIns).
 */
export const autoName = (email: string) => email.split("@")[0];

/** The name is optional: left empty, it comes from the Google account at first sign-in. */
export async function saveEvaluator(r: Repo, input: { id?: string; name?: string; email: string }): Promise<string> {
  const email = cleanEmail(input.email);
  if (!EMAIL.test(email)) throw new ValidationError("البريد الإلكتروني غير صالح", "email");
  const name = cleanName(input.name ?? "") || autoName(email);
  const [clash] = await r.db.select({ id: t.accounts.id }).from(t.accounts).where(eq(t.accounts.email, email));
  if (clash && clash.id !== input.id) throw new ValidationError("هذا البريد مستخدم لحساب آخر", "email");
  const plan = new Plan(r);
  const id = input.id ?? newId();
  if (input.id) plan.add(r.db.update(t.accounts).set({ name, email, updatedAt: nowISO() }).where(eq(t.accounts.id, id)));
  else plan.add(r.db.insert(t.accounts).values({ id, name, email, role: "EVALUATOR", active: true }));
  plan.audit("Evaluator", id, input.id ? "update" : "create", undefined, { name, email });
  await plan.commit();
  return id;
}

export async function setEvaluatorActive(r: Repo, id: string, active: boolean) {
  const plan = new Plan(r);
  plan.add(r.db.update(t.accounts).set({ active, updatedAt: nowISO() }).where(eq(t.accounts.id, id)));
  plan.audit("Evaluator", id, active ? "reactivate" : "deactivate");
  await plan.commit();
}

/** Replaces the evaluator's hospital-wide cover for a course (group-level assignments are kept). */
export async function setEvaluatorHospitals(r: Repo, accountId: string, courseId: string, hospitalIds: string[]) {
  const current = await r.db
    .select()
    .from(t.evaluatorAssignments)
    .where(and(eq(t.evaluatorAssignments.accountId, accountId), eq(t.evaluatorAssignments.courseId, courseId), eq(t.evaluatorAssignments.active, true)));
  const wide = current.filter((a) => a.groupId === null);
  const want = new Set(hospitalIds);
  const plan = new Plan(r);
  for (const a of wide.filter((a) => !want.has(a.hospitalId))) {
    plan.add(r.db.update(t.evaluatorAssignments).set({ active: false, updatedAt: nowISO() }).where(eq(t.evaluatorAssignments.id, a.id)));
  }
  const have = new Set(wide.map((a) => a.hospitalId));
  for (const hospitalId of hospitalIds.filter((h) => !have.has(h))) {
    plan.add(r.db.insert(t.evaluatorAssignments).values({ id: newId(), accountId, hospitalId, courseId, groupId: null }));
    // a whole-hospital cover includes that hospital's group-level ones
    for (const g of current.filter((a) => a.groupId !== null && a.hospitalId === hospitalId)) {
      plan.add(r.db.update(t.evaluatorAssignments).set({ active: false, updatedAt: nowISO() }).where(eq(t.evaluatorAssignments.id, g.id)));
    }
  }
  plan.audit("EvaluatorAssignment", accountId, "update", [...have], hospitalIds);
  await plan.commit();
}

// ---- single assignments ----------------------------------------------------

interface CourseScope {
  hospitals: Map<string, string>; // id -> name
  groups: Map<string, string>;
}

async function courseScope(r: Repo, courseId: string): Promise<CourseScope> {
  const hs = await r.db
    .select({ id: t.hospitals.id, name: t.hospitals.name })
    .from(t.courseHospitals)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.courseHospitals.hospitalId))
    .where(eq(t.courseHospitals.courseId, courseId));
  // Older data may not list the course's hospitals: then every active hospital counts.
  const hospitals = hs.length
    ? hs
    : await r.db.select({ id: t.hospitals.id, name: t.hospitals.name }).from(t.hospitals).where(eq(t.hospitals.active, true));
  const gs = await r.db
    .select({ id: t.groups.id, name: t.groups.name })
    .from(t.groups)
    .where(and(eq(t.groups.courseId, courseId), eq(t.groups.active, true)));
  return { hospitals: new Map(hospitals.map((h) => [h.id, h.name])), groups: new Map(gs.map((g) => [g.id, g.name])) };
}

/** Why this cover can't be added (null = fine). */
function coverProblem(existing: Array<{ hospitalId: string; groupId: string | null }>, hospitalId: string, groupId: string | null): string | null {
  const same = existing.filter((a) => a.hospitalId === hospitalId);
  if (same.some((a) => a.groupId === null)) return "يغطي هذا المستشفى كاملًا مسبقًا";
  if (groupId && same.some((a) => a.groupId === groupId)) return "مخصّص لهذه المجموعة مسبقًا";
  return null;
}

/** Adds one cover: a whole hospital (groupId null) or one group at it. */
export async function addAssignment(r: Repo, input: { accountId: string; courseId: string; hospitalId: string; groupId?: string | null }) {
  const groupId = input.groupId || null;
  const scope = await courseScope(r, input.courseId);
  if (!scope.hospitals.has(input.hospitalId)) throw new ValidationError("المستشفى ليس ضمن هذه الدورة", "hospitalId");
  if (groupId && !scope.groups.has(groupId)) throw new ValidationError("المجموعة ليست ضمن هذه الدورة", "groupId");
  const current = await r.db
    .select()
    .from(t.evaluatorAssignments)
    .where(and(eq(t.evaluatorAssignments.accountId, input.accountId), eq(t.evaluatorAssignments.courseId, input.courseId), eq(t.evaluatorAssignments.active, true)));
  const problem = coverProblem(current, input.hospitalId, groupId);
  if (problem) throw new ValidationError(problem, "hospitalId");
  const plan = new Plan(r);
  const id = newId();
  plan.add(r.db.insert(t.evaluatorAssignments).values({ id, accountId: input.accountId, hospitalId: input.hospitalId, courseId: input.courseId, groupId }));
  if (!groupId) {
    for (const g of current.filter((a) => a.hospitalId === input.hospitalId)) {
      plan.add(r.db.update(t.evaluatorAssignments).set({ active: false, updatedAt: nowISO() }).where(eq(t.evaluatorAssignments.id, g.id)));
    }
  }
  plan.audit("EvaluatorAssignment", id, "create", undefined, {
    name: `${scope.hospitals.get(input.hospitalId)}${groupId ? " · " + scope.groups.get(groupId) : ""}`,
  });
  await plan.commit();
  return id;
}

export async function removeAssignment(r: Repo, assignmentId: string) {
  const plan = new Plan(r);
  plan.add(r.db.update(t.evaluatorAssignments).set({ active: false, updatedAt: nowISO() }).where(eq(t.evaluatorAssignments.id, assignmentId)));
  plan.audit("EvaluatorAssignment", assignmentId, "deactivate");
  await plan.commit();
}

/** The course's hospitals with how many active evaluators cover each (whole or a group). */
export async function coverage(r: Repo, courseId: string) {
  const scope = await courseScope(r, courseId);
  const rows = await r.db
    .select({ hospitalId: t.evaluatorAssignments.hospitalId, accountId: t.evaluatorAssignments.accountId })
    .from(t.evaluatorAssignments)
    .innerJoin(t.accounts, eq(t.accounts.id, t.evaluatorAssignments.accountId))
    .where(and(eq(t.evaluatorAssignments.courseId, courseId), eq(t.evaluatorAssignments.active, true), eq(t.accounts.active, true)));
  return [...scope.hospitals].map(([id, name]) => ({
    hospitalId: id,
    hospitalName: name,
    evaluators: new Set(rows.filter((x) => x.hospitalId === id).map((x) => x.accountId)).size,
  })).sort((a, b) => compareArabic(a.hospitalName, b.hospitalName));
}

/** Hospitals and groups an assignment can point at, for the pickers. */
export async function assignmentChoices(r: Repo, courseId: string) {
  const scope = await courseScope(r, courseId);
  const byName = (a: { name: string }, b: { name: string }) => compareArabic(a.name, b.name);
  return {
    hospitals: [...scope.hospitals].map(([id, name]) => ({ id, name })).sort(byName),
    groups: [...scope.groups].map(([id, name]) => ({ id, name })).sort(byName),
  };
}

// ---- Excel import ----------------------------------------------------------
// One row per cover: name, email, hospital, group (empty = the whole
// hospital). Rows are merged by email: an existing evaluator gets the new
// covers, a new email creates the evaluator. All or nothing.

export interface EvaluatorImportRow {
  row: number;
  name: string;
  email: string;
  hospital: string;
  group: string;
}

export type ImportLineAction = "new" | "assign" | "exists" | "error";

export interface EvaluatorImportLine {
  row: number;
  name: string;
  email: string;
  cover: string;
  action: ImportLineAction;
  message: string;
}

export interface EvaluatorImportPreview {
  lines: EvaluatorImportLine[];
  newEvaluators: number;
  newCovers: number;
  errors: number;
}

interface Resolved extends EvaluatorImportPreview {
  plan: Plan;
}

async function resolveImport(r: Repo, rows: EvaluatorImportRow[], courseId: string): Promise<Resolved> {
  const scope = await courseScope(r, courseId);
  const hospitalByName = new Map([...scope.hospitals].map(([id, name]) => [normalizeArabic(name), id]));
  const groupByName = new Map([...scope.groups].map(([id, name]) => [normalizeArabic(name), id]));
  const accounts = await r.db.select().from(t.accounts);
  const byEmail = new Map(accounts.map((a) => [a.email.toLowerCase(), a]));
  const covers = await r.db
    .select()
    .from(t.evaluatorAssignments)
    .where(and(eq(t.evaluatorAssignments.courseId, courseId), eq(t.evaluatorAssignments.active, true)));
  const coversOf = new Map<string, Array<{ hospitalId: string; groupId: string | null }>>();
  for (const c of covers) coversOf.set(c.accountId, [...(coversOf.get(c.accountId) ?? []), c]);

  const plan = new Plan(r);
  const created = new Map<string, string>(); // email -> new id (a file can list one evaluator on several rows)
  const lines: EvaluatorImportLine[] = [];
  let newEvaluators = 0;
  let newCovers = 0;

  for (const row of rows) {
    const name = cleanName(row.name);
    const email = cleanEmail(row.email);
    const hospitalName = cleanName(row.hospital);
    const groupName = cleanName(row.group);
    const cover = hospitalName + (groupName ? " · " + groupName : "");
    const line = (action: ImportLineAction, message: string) => lines.push({ row: row.row, name, email, cover, action, message });

    if (!EMAIL.test(email)) { line("error", "البريد الإلكتروني غير صالح"); continue; }
    const hospitalId = hospitalByName.get(normalizeArabic(hospitalName));
    if (!hospitalId) { line("error", hospitalName ? `مستشفى غير موجود في الدورة: ${hospitalName}` : "المستشفى مطلوب"); continue; }
    const groupId = groupName ? groupByName.get(normalizeArabic(groupName)) : null;
    if (groupId === undefined) { line("error", `مجموعة غير موجودة في الدورة: ${groupName}`); continue; }

    const account = byEmail.get(email);
    if (account && account.role !== "EVALUATOR") { line("error", "هذا البريد لحساب غير مقيّم"); continue; }
    let accountId = account?.id ?? created.get(email);
    let isNew = false;
    if (!accountId) {
      accountId = newId();
      created.set(email, accountId);
      plan.add(r.db.insert(t.accounts).values({ id: accountId, name: name || autoName(email), email, role: "EVALUATOR", active: true }));
      newEvaluators++;
      isNew = true;
    }
    const mine = coversOf.get(accountId) ?? [];
    const problem = coverProblem(mine, hospitalId, groupId);
    if (problem) { line("exists", problem); continue; }
    plan.add(r.db.insert(t.evaluatorAssignments).values({ id: newId(), accountId, hospitalId, courseId, groupId }));
    coversOf.set(accountId, [...mine, { hospitalId, groupId }]);
    newCovers++;
    line(isNew ? "new" : "assign", isNew ? "مقيّم جديد" : "تخصيص جديد");
  }
  const errors = lines.filter((l) => l.action === "error").length;
  plan.audit("Evaluator", courseId, "import", undefined, { created: newEvaluators, updated: newCovers });
  return { lines, newEvaluators, newCovers, errors, plan };
}

export async function previewEvaluatorImport(r: Repo, rows: EvaluatorImportRow[], courseId: string): Promise<EvaluatorImportPreview> {
  const { lines, newEvaluators, newCovers, errors } = await resolveImport(r, rows, courseId);
  return { lines, newEvaluators, newCovers, errors };
}

/** Applies the whole file in one transaction; refuses if any row has an error. */
export async function importEvaluators(r: Repo, rows: EvaluatorImportRow[], courseId: string): Promise<EvaluatorImportPreview> {
  const res = await resolveImport(r, rows, courseId);
  if (res.errors) throw new ValidationError(`في الملف ${res.errors} صف فيه خطأ — صحّحها ثم أعد الاستيراد`);
  if (res.newEvaluators + res.newCovers > 0) await res.plan.commit();
  return { lines: res.lines, newEvaluators: res.newEvaluators, newCovers: res.newCovers, errors: 0 };
}
