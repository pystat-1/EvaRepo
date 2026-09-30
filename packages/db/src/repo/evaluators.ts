// Evaluators (accounts with role EVALUATOR) and which hospitals they cover.
// Their phone login (password) arrives with the sync relay in phase 4.
import { and, eq } from "drizzle-orm";
import { compareArabic } from "@eva/core/text/arabic";
import * as t from "../schema";
import { Plan, ValidationError, newId, nowISO, type Repo } from "./common";

export interface EvaluatorRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  hospitals: Array<{ assignmentId: string; hospitalId: string; hospitalName: string; courseId: string | null }>;
}

export async function listEvaluators(r: Repo, includeInactive = true): Promise<EvaluatorRow[]> {
  const accounts = await r.db
    .select()
    .from(t.accounts)
    .where(and(eq(t.accounts.role, "EVALUATOR"), includeInactive ? undefined : eq(t.accounts.active, true)));
  const assignments = await r.db
    .select({ a: t.evaluatorAssignments, hospitalName: t.hospitals.name })
    .from(t.evaluatorAssignments)
    .innerJoin(t.hospitals, eq(t.hospitals.id, t.evaluatorAssignments.hospitalId))
    .where(eq(t.evaluatorAssignments.active, true));
  return accounts
    .map((acc) => ({
      id: acc.id,
      name: acc.name,
      email: acc.email,
      active: acc.active,
      hospitals: assignments
        .filter((x) => x.a.accountId === acc.id)
        .map((x) => ({ assignmentId: x.a.id, hospitalId: x.a.hospitalId, hospitalName: x.hospitalName, courseId: x.a.courseId })),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || compareArabic(a.name, b.name));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveEvaluator(r: Repo, input: { id?: string; name: string; email: string }): Promise<string> {
  const name = input.name.replace(/\s+/g, " ").trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new ValidationError("الاسم مطلوب", "name");
  if (!EMAIL.test(email)) throw new ValidationError("البريد الإلكتروني غير صالح", "email");
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

/** Replaces the evaluator's hospitals for a course (hospital-wide cover). */
export async function setEvaluatorHospitals(r: Repo, accountId: string, courseId: string, hospitalIds: string[]) {
  const current = await r.db
    .select()
    .from(t.evaluatorAssignments)
    .where(and(eq(t.evaluatorAssignments.accountId, accountId), eq(t.evaluatorAssignments.courseId, courseId), eq(t.evaluatorAssignments.active, true)));
  const want = new Set(hospitalIds);
  const plan = new Plan(r);
  for (const a of current.filter((a) => !want.has(a.hospitalId))) {
    plan.add(r.db.update(t.evaluatorAssignments).set({ active: false, updatedAt: nowISO() }).where(eq(t.evaluatorAssignments.id, a.id)));
  }
  const have = new Set(current.map((a) => a.hospitalId));
  for (const hospitalId of hospitalIds.filter((h) => !have.has(h))) {
    plan.add(r.db.insert(t.evaluatorAssignments).values({ id: newId(), accountId, hospitalId, courseId, groupId: null }));
  }
  plan.audit("EvaluatorAssignment", accountId, "update", [...have], hospitalIds);
  await plan.commit();
}
