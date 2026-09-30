import { useState } from "react";
import { worst, type Check } from "../lib/selfCheck";

// A slim banner over every screen when the self-check finds something
// (hidden when all is well). Each item jumps to the screen that fixes it.
export function HealthBanner({ checks, onGo }: { checks: Check[]; onGo: (tab: "system" | "sync") => void }) {
  const [hidden, setHidden] = useState<string>("");
  const problems = checks.filter((c) => c.level !== "ok");
  const key = problems.map((c) => `${c.id}:${c.level}`).join("|");
  if (problems.length === 0 || hidden === key) return null;
  const level = worst(problems);
  return (
    <div className={`health-banner health-${level}`} role="status">
      <ul>
        {problems.map((c) => (
          <li key={c.id}>
            <b>{c.title}</b> — {c.detail}
            {c.go && (
              <button className="btn btn-sm" onClick={() => onGo(c.go!)}>
                {c.go === "sync" ? "المزامنة" : "النظام"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <button className="btn btn-ghost btn-sm" aria-label="إخفاء" onClick={() => setHidden(key)}>
        ✕
      </button>
    </div>
  );
}
