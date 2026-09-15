"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { loginAction, LoginState } from "@/lib/actions/auth";

const initialState: LoginState = {};

const GOOGLE_ERROR_LABEL: Record<string, string> = {
  invalid_state: "انتهت صلاحية طلب الدخول — حاول مرة أخرى",
  not_configured: "تسجيل الدخول عبر Google غير مُفعّل حاليًا",
  token_exchange_failed: "تعذّر إكمال تسجيل الدخول عبر Google",
  userinfo_failed: "تعذّر جلب بيانات حساب Google",
  email_not_verified: "بريد حساب Google غير موثّق",
  no_matching_account: "لا يوجد حساب مرتبط بهذا البريد — تواصل مع المدير لإنشاء حساب أولًا",
  account_linked_elsewhere: "هذا البريد مرتبط بحساب Google آخر بالفعل",
  account_inactive: "هذا الحساب معطّل",
};

function GoogleErrorBanner() {
  const searchParams = useSearchParams();
  const googleError = searchParams.get("google_error");
  if (!googleError) return null;
  return (
    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
      {GOOGLE_ERROR_LABEL[googleError] ?? "تعذّر تسجيل الدخول عبر Google"}
    </p>
  );
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm card">
        <h1 className="text-xl font-bold text-center mb-1" style={{ color: "var(--brand)" }}>
          Eva — لوحة المدير
        </h1>
        <p className="text-sm text-slate-500 text-center mb-6">
          قاعدة بيانات الطلاب والمجموعات والمستشفيات
        </p>

        <Suspense fallback={null}>
          <GoogleErrorBanner />
        </Suspense>

        <a
          href="/api/auth/google"
          className="btn btn-secondary w-full mb-4 flex items-center justify-center gap-2"
        >
          الدخول باستخدام Google
        </a>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 border-t border-slate-200" />
          <span className="text-xs text-slate-400">أو</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
            <input name="email" type="email" required className="input" autoComplete="email" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">كلمة المرور</label>
            <input
              name="password"
              type="password"
              required
              className="input"
              autoComplete="current-password"
            />
          </div>
          {state.error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending} className="btn btn-primary w-full">
            {pending ? "جارٍ الدخول..." : "تسجيل الدخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
