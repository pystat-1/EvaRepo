"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Periodically re-fetches the current server component tree so an
// admin watching this page sees new evaluations land without a manual
// reload — "updates automatically as evaluators complete the evaluation."
export default function AutoRefresh({ intervalSeconds = 20 }: { intervalSeconds?: number }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => router.refresh(), intervalSeconds * 1000);
    return () => clearInterval(id);
  }, [enabled, intervalSeconds, router]);

  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500 select-none">
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      تحديث تلقائي كل {intervalSeconds} ثانية
    </label>
  );
}
