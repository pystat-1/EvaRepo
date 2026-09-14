"use client";

import { useActionState } from "react";
import { importStudentsAction, ImportActionState } from "@/lib/actions/students";

const initialState: ImportActionState = {};

export default function ImportStudentsForm() {
  const [state, formAction, pending] = useActionState(importStudentsAction, initialState);

  return (
    <div className="card">
      <h2 className="font-semibold mb-1">استيراد من ملف CSV</h2>
      <p className="text-xs text-slate-500 mb-3">
        الأعمدة المتوقعة: universityNumber, nameAr, nameEn, email, studyType, group — يتم
        الدمج حسب الرقم الجامعي (لا يتم إنشاء طالب مكرر عند إعادة الاستيراد).
      </p>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="file" name="file" accept=".csv,text/csv" required className="input" />
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "جارٍ الاستيراد..." : "استيراد"}
        </button>
        <a href="/api/students/export" className="btn btn-secondary">
          تصدير القائمة الحالية (CSV)
        </a>
      </form>
      {state.error && (
        <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {state.error}
        </p>
      )}
      {state.result && (
        <div className="text-sm mt-3 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          <p>
            تم إنشاء <strong>{state.result.created}</strong> وتحديث{" "}
            <strong>{state.result.updated}</strong> من السجلات.
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-2 text-red-600 list-disc pr-5">
              {state.result.errors.map((e) => (
                <li key={e.row}>
                  السطر {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
