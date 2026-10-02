"use client";

import "./globals.css";
import { RecoverableError } from "@/components/RecoverableError";

// Last resort, when the root layout itself fails. It replaces the whole
// document, so it renders its own <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body style={{ background: "var(--surface)" }}>
        <div className="mx-auto w-full max-w-lg p-6">
          <RecoverableError error={error} reset={reset} />
        </div>
      </body>
    </html>
  );
}
