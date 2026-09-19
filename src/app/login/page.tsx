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
    <p
      className="text-sm rounded-md px-3 py-2 mb-4"
      style={{ color: "var(--red-700)", background: "var(--red-100)" }}
    >
      {GOOGLE_ERROR_LABEL[googleError] ?? "تعذّر تسجيل الدخول عبر Google"}
    </p>
  );
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <div className="flex flex-1 items-center justify-center p-6" style={{ background: "var(--surface)" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-7">
          <span
            className="font-display font-extrabold text-3xl tracking-tight"
            style={{ color: "var(--brand-dark)" }}
          >
            Eva
          </span>
          <div className="h-px w-10 my-3" style={{ background: "var(--border-strong)" }} />
          <p className="text-sm text-center" style={{ color: "var(--ink-muted)" }}>
            سجلّ التقييم اليومي للممارسة السريرية
          </p>
        </div>

        <div className="card">
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
            <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>أو</span>
            <div className="flex-1 border-t" style={{ borderColor: "var(--border)" }} />
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
              <p
                className="text-sm rounded-md px-3 py-2"
                style={{ color: "var(--red-700)", background: "var(--red-100)" }}
              >
                {state.error}
              </p>
            )}
            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? "جارٍ الدخول..." : "تسجيل الدخول"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
