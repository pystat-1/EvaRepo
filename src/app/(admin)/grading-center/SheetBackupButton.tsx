"use client";

import { useEffect, useState, useTransition } from "react";
import { syncAllToSheetAction, sheetsStatusAction } from "@/lib/actions/sheetSync";
import type { SyncResult } from "@/lib/models/sheetSync";

// Admin control for the Google Sheets grades backup. Shows whether the
// integration is configured, runs a full "Sync all", and reports the result.
// When unconfigured it stays quiet with a short hint rather than an error.
export default function SheetBackupButton() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    sheetsStatusAction()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  if (configured === null) return null; // still checking
  if (!configured) {
    return (
      <span className="text-xs text-slate-400" title="أضف بيانات حساب خدمة Google في متغيّرات البيئة لتفعيل النسخ الاحتياطي">
        النسخ إلى Google Sheets غير مُفعّل
      </span>
    );
  }

  function sync() {
    startTransition(async () => {
      setResult(await syncAllToSheetAction());
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={sync} disabled={pending} className="btn btn-secondary text-xs whitespace-nowrap">
        {pending ? "جارِ المزامنة..." : "مزامنة كل الدرجات إلى Google Sheets"}
      </button>
      {result && (
        <span className={`text-xs ${result.ok ? "text-green-700" : "text-red-600"}`}>
          {result.ok ? `✓ تمّت مزامنة ${result.rows} صف` : `تعذّرت المزامنة${result.error ? `: ${result.error}` : ""}`}
        </span>
      )}
    </div>
  );
}
