"use client";

import { RecoverableError } from "@/components/RecoverableError";

export default function EvaluatorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RecoverableError error={error} reset={reset} />;
}
