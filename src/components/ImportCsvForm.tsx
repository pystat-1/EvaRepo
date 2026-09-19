"use client";

import { useActionState, useState } from "react";
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
  // Dismissing a preview is purely local — nothing was written yet, so
  // there's nothing to undo server-side. Keyed to the preview's own raw
  // text so a fresh upload always shows its own preview even if the
  // previous one was dismissed.
  const [dismissedRaw, setDismissedRaw] = useState<string | null>(null);

  const showingPreview = !!state.preview && state.preview.raw !== dismissedRaw;

  return (
    <div className="card">
      <h2 className="font-semibold mb-1">استيراد من ملف CSV</h2>
      <p className="text-xs mb-3" style={{ color: "var(--ink-muted)" }}>{columnsHint}</p>

      {!showingPreview && (
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="phase" value="preview" />
          <input type="file" name="file" accept=".csv,text/csv" required className="input" />
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? "جارٍ التحقق..." : "معاينة الاستيراد"}
          </button>
          {exportHref && (
            <a href={exportHref} className="btn btn-secondary">
              {exportLabel}
            </a>
          )}
        </form>
      )}

      {state.error && (
        <p
          className="text-sm mt-3 rounded-md px-3 py-2"
          style={{ color: "var(--red-700)", background: "var(--red-100)" }}
        >
          {state.error}
        </p>
      )}

      {showingPreview && state.preview && (
        <div
          className="text-sm mt-1 rounded-md px-3 py-3"
          style={{ background: "var(--brand-tint, #eef5f3)", border: "1px solid var(--border-strong, #c7cdc4)" }}
        >
          <p className="font-semibold mb-1">معاينة — لم يتم حفظ أي شيء بعد</p>
          <p>
            سيتم إنشاء <strong>{state.preview.created}</strong> وتحديث{" "}
            <strong>{state.preview.updated}</strong> من السجلات
            {state.preview.errors.length > 0 && (
              <>
                {" "}
                — <strong style={{ color: "var(--red-700)" }}>{state.preview.errors.length}</strong> سطر به خطأ لن يُستورد
              </>
            )}
            .
          </p>
          {state.preview.errors.length > 0 && (
            <ul className="mt-2 list-disc pr-5" style={{ color: "var(--red-700)" }}>
              {state.preview.errors.map((e) => (
                <li key={e.row}>
                  السطر {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <form action={formAction} className="flex items-center gap-2 mt-3">
            <input type="hidden" name="phase" value="confirm" />
            <input type="hidden" name="raw" value={state.preview.raw} />
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? "جارٍ الاستيراد..." : "تأكيد الاستيراد"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDismissedRaw(state.preview!.raw)}
            >
              إلغاء
            </button>
          </form>
        </div>
      )}

      {state.result && (
        <div
          className="text-sm mt-3 rounded-md px-3 py-2"
          style={{ background: "var(--paper-100, #eef0ec)", border: "1px solid var(--border, #dde1da)" }}
        >
          <p>
            تم إنشاء <strong>{state.result.created}</strong> وتحديث{" "}
            <strong>{state.result.updated}</strong> من السجلات.
          </p>
          {state.result.errors.length > 0 && (
            <ul className="mt-2 list-disc pr-5" style={{ color: "var(--red-700)" }}>
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
