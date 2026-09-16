"use client";

import { useActionState } from "react";
import type { ImportActionState } from "@/lib/importHelpers";

const initialState: ImportActionState = {};

export default function ImportCsvForm({
  action,
  columnsHint,
  exportHref,
  exportLabel = "تصدير القائمة الحالية (CSV)",
}: {
  action: (prev: ImportActionState, formData: FormData) => Promise<ImportActionState>;
  columnsHint: string;
  exportHref?: string;
  exportLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="card">
      <h2 className="font-semibold mb-1">استيراد من ملف CSV</h2>
      <p className="text-xs text-slate-500 mb-3">{columnsHint}</p>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="file" name="file" accept=".csv,text/csv" required className="input" />
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "جارٍ الاستيراد..." : "استيراد"}
        </button>
        {exportHref && (
          <a href={exportHref} className="btn btn-secondary">
            {exportLabel}
          </a>
        )}
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
