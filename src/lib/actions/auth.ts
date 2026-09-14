"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  findAccountByEmail,
  hashPassword,
  signSession,
  verifyPassword,
  SESSION_COOKIE,
} from "../auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    return await loginActionInner(formData);
  } catch (err) {
    // next/navigation's redirect() works by throwing; let that through.
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
    ) {
      throw err;
    }
    // TEMP debug shim — surfaces the real error instead of Next's opaque
    // production digest, to diagnose the deploy-only 500. Revert once done.
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { error: `DEBUG: ${message}` };
  }
}

async function loginActionInner(formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "الرجاء إدخال البريد الإلكتروني وكلمة المرور" };
  }

  const account = await findAccountByEmail(email);
  if (!account || !account.active || !account.passwordHash) {
    return { error: "بيانات الدخول غير صحيحة" };
  }

  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) {
    return { error: "بيانات الدخول غير صحيحة" };
  }

  const token = signSession({
    sub: account.id,
    email: account.email,
    name: account.name,
    role: account.role,
    studentId: account.studentId ?? undefined,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });

  if (account.role === "ADMIN") redirect("/dashboard");
  if (account.role === "EVALUATOR") redirect("/my");
  if (account.role === "STUDENT") redirect("/me");
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

// Exposed for the seed script's follow-up "change password" flow (kept here
// so password hashing rules live in one place).
export async function hashPasswordForSeed(plain: string): Promise<string> {
  return hashPassword(plain);
}
