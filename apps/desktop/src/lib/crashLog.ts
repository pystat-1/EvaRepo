// Every error the UI didn't handle goes to the app's log file (via the
// Rust log plugin), so a problem can be reported with its details instead
// of "it stopped working".
import { error as logError, info } from "@tauri-apps/plugin-log";

export function installCrashLogging() {
  window.addEventListener("error", (e) => {
    void logError(`window.error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack ?? ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    void logError(`unhandledrejection: ${r instanceof Error ? `${r.message}\n${r.stack}` : String(r)}`);
  });
  void info("Eva UI started");
}

export function logScreenCrash(screen: string, err: unknown, componentStack?: string | null) {
  const e = err instanceof Error ? err : new Error(String(err));
  void logError(`screen "${screen}" crashed: ${e.message}\n${e.stack ?? ""}\n${componentStack ?? ""}`);
}
