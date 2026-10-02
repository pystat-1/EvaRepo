"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  findAccountByEmail,
  hashPassword,
  signSession,
  signEvaluatorSession,
  createEvaluatorSession,
  revokeSession,
  verifySession,
  verifyPassword,
  deviceLabelFromUserAgent,
  SESSION_COOKIE,
  EVALUATOR_SESSION_TTL_DAYS,
} from "../auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
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

  const store = await cookies();

  // EVALUATOR_APP_PLAN.md §3/E2: evaluators get a server-side session
  // (revocable, deactivation-aware, 14-day sliding) instead of the plain
  // stateless JWT admins/students still use — see auth.ts's getSession().
  if (account.role === "EVALUATOR") {
    const hdrs = await headers();
    const { id: sessionId } = await createEvaluatorSession(
      account.id,
      deviceLabelFromUserAgent(hdrs.get("user-agent"))
    );
    const token = signEvaluatorSession({
      sub: account.id,
      email: account.email,
      name: account.name,
      role: account.role,
      sid: sessionId,
    });
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * EVALUATOR_SESSION_TTL_DAYS,
    });
  } else {
    const token = signSession({
      sub: account.id,
      email: account.email,
      name: account.name,
      role: account.role,
      studentId: account.studentId ?? undefined,
    });
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }

  if (account.role === "ADMIN") redirect("/dashboard");
  if (account.role === "EVALUATOR") redirect("/attendance");
  if (account.role === "STUDENT") redirect("/me");
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const session = token ? verifySession(token) : null;
  if (session?.sid) {
    await revokeSession(session.sub, session.sid).catch(() => {});
  }
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

// Exposed for the seed script's follow-up "change password" flow (kept here
// so password hashing rules live in one place).
export async function hashPasswordForSeed(plain: string): Promise<string> {
  return hashPassword(plain);
}
