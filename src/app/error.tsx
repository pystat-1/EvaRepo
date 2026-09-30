"use client";

import { RecoverableError } from "@/components/RecoverableError";

// Catches errors from the section layouts (admin / evaluator / student) and
// top-level pages like /login, which their own error.tsx files can't.
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-lg p-6">
      <RecoverableError error={error} reset={reset} />
    </div>
  );
}
