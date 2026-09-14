"use client";

import { useActionState } from "react";
import { loginAction, LoginState } from "@/lib/actions/auth";

const initialState: LoginState = {};

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
