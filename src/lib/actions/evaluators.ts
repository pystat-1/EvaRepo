"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import {
  createEvaluator,
  toggleEvaluatorActive,
  addAssignment,
  toggleAssignmentActive,
} from "../models/evaluators";

export async function createEvaluatorAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  await createEvaluator(session.sub, {
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    hospitalId: String(formData.get("hospitalId") ?? "").trim(),
    groupId: String(formData.get("groupId") ?? "") || null,
  });
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

export async function toggleEvaluatorActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const accountId = String(formData.get("accountId") ?? "");
  const active = formData.get("active") === "1";
  await toggleEvaluatorActive(session.sub, accountId, active);
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

export async function addAssignmentAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const accountId = String(formData.get("accountId") ?? "");
  const hospitalId = String(formData.get("hospitalId") ?? "").trim();
  const groupId = String(formData.get("groupId") ?? "") || null;
  await addAssignment(session.sub, accountId, hospitalId, groupId);
  revalidatePath("/evaluators");
  revalidatePath("/master");
}

export async function toggleAssignmentActiveAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  const assignmentId = String(formData.get("assignmentId") ?? "");
  const active = formData.get("active") === "1";
  await toggleAssignmentActive(session.sub, assignmentId, active);
  revalidatePath("/evaluators");
  revalidatePath("/master");
}
