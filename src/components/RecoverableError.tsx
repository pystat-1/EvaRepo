"use client";

import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// A response cut off mid-stream (React error #412 "Connection closed", or a
// dropped fetch) is almost always transient: on the Workers Free plan
// Cloudflare may stop a request that goes over its CPU allowance, and the
// very next request usually succeeds. So instead of showing the raw
// minified error, retry by itself: first a cheap in-app refresh, then a
// full reload, and only then ask the user. Attempts are counted per page in
// sessionStorage so a genuinely broken page can't loop.
const CONNECTION_ERROR = /#412|Connection closed|Failed to fetch|Load failed|NetworkError|network error/i;
const RETRY_WINDOW_MS = 30_000;
const MAX_AUTO_RETRIES = 2;

function retryKey(): string {
  return `eva-retry:${window.location.pathname}`;
}

function readAttempts(): number {
  try {
    const raw = sessionStorage.getItem(retryKey());
    if (!raw) return 0;
    const { n, at } = JSON.parse(raw) as { n: number; at: number };
    return Date.now() - at < RETRY_WINDOW_MS ? n : 0;
  } catch {
    return 0;
  }
}

function writeAttempts(n: number) {
  try {
    sessionStorage.setItem(retryKey(), JSON.stringify({ n, at: Date.now() }));
  } catch {
    // storage unavailable (private mode): the retry still happens once
  }
}

export function isConnectionError(error: Error): boolean {
  return CONNECTION_ERROR.test(error?.message ?? "");
}

export function RecoverableError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const connection = isConnectionError(error);
  // Decided once when the error appears: retry automatically, or (after
  // MAX_AUTO_RETRIES recent attempts on this page) show the message.
  const [gaveUp] = useState(
    () => !connection || typeof window === "undefined" || readAttempts() >= MAX_AUTO_RETRIES
  );

  useEffect(() => {
    if (gaveUp) return;
    const attempts = readAttempts();
    writeAttempts(attempts + 1);
    const timer = setTimeout(() => {
      if (attempts === 0) {
        startTransition(() => {
          router.refresh();
          reset();
        });
      } else {
        window.location.reload();
      }
    }, 300 + attempts * 700);
    return () => clearTimeout(timer);
  }, [gaveUp, reset, router]);

  function retryNow() {
    writeAttempts(0);
    window.location.reload();
  }

  if (connection && !gaveUp) {
    return (
      <div className="card" role="status" aria-live="polite">
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          انقطع الاتصال أثناء تحميل الصفحة — جارٍ إعادة المحاولة…
        </p>
      </div>
    );
  }

  return (
    <div className="card border-red-200 bg-red-50" role="alert">
      <h2 className="font-bold text-red-700 mb-2">{connection ? "تعذّر تحميل الصفحة" : "حدث خطأ"}</h2>
      <p className="text-sm text-red-700 mb-4">
        {connection ? "انقطع الاتصال بالخادم أكثر من مرة. تحقق من الاتصال ثم أعد المحاولة." : error.message}
      </p>
      <button onClick={connection ? retryNow : () => reset()} className="btn btn-secondary">
        إعادة المحاولة
      </button>
    </div>
  );
}
