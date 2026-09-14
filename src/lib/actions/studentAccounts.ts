"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "../auth";
import { createStudentAccount } from "../models/studentAccounts";

export async function createStudentAccountAction(formData: FormData) {
  const session = await requireRole("ADMIN");
  await createStudentAccount(session.sub, {
    studentId: String(formData.get("studentId") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  revalidatePath("/student-accounts");
}
