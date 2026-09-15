"use client";

import { useEffect, useState } from "react";
import { saveOfflineBundle, getLastImportMeta, OfflineBundle, LastImportMeta } from "@/lib/offline/db";

type Status = "idle" | "loading" | "done" | "error";

// Phase 4b's explicit "import once" action: fetches the schedule/roster/
// rubric/evaluations bundle in one request and writes it into IndexedDB, so
// Phase 4c's offline grading UI has a local copy to read from. Deliberately
// a manual button, not automatic background caching — the evaluator decides
// when to load fresh data before going offline.
export function ImportOfflineButton() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<LastImportMeta | null>(null);

  useEffect(() => {
    getLastImportMeta()
      .then((meta) => setLastImport(meta ?? null))
      .catch(() => {
        // IndexedDB unavailable (older browser, private mode) — the button
        // still works for the "just imported" confirmation this session.
      });
  }, []);

  async function handleImport() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/schedule/offline-bundle");
      if (!res.ok) throw new Error("تعذّر جلب البيانات من الخادم");
      const bundle: OfflineBundle = await res.json();
      await saveOfflineBundle(bundle);
      setLastImport({ importedAt: new Date().toISOString(), dateISO: bundle.dateISO });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الاستيراد");
    }
  }

  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-medium text-sm">العمل دون اتصال</div>
          <p className="text-xs text-slate-500 mt-0.5">
            {lastImport
              ? `آخر استيراد: ${new Date(lastImport.importedAt).toLocaleString("ar")} (بيانات يوم ${lastImport.dateISO})`
              : "لم يتم استيراد أي بيانات للعمل دون اتصال بعد."}
          </p>
        </div>
        <button
          type="button"
          onClick={handleImport}
          disabled={status === "loading"}
          className="btn btn-secondary text-sm whitespace-nowrap"
        >
          {status === "loading" ? "جارِ الاستيراد..." : "استيراد الجدول للعمل دون اتصال"}
        </button>
      </div>
      {status === "done" && <p className="text-xs text-green-700">تم الاستيراد بنجاح.</p>}
      {status === "error" && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
