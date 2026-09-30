import { useSyncExternalStore } from "react";

// In-app confirmation dialog (replaces window.confirm, which in Tauri is
// routed through the dialog plugin and needs extra permissions). Call
// `await confirmAction("…")` anywhere; <ConfirmHost /> renders it.
type Pending = { message: string; confirmLabel: string; resolve: (ok: boolean) => void } | null;

let pending: Pending = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirmAction(message: string, confirmLabel = "متابعة"): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { message, confirmLabel, resolve };
    emit();
  });
}

function answer(ok: boolean) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(ok);
}

export function ConfirmHost() {
  const current = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending
  );
  if (!current) return null;
  return (
    <div className="palette-backdrop" onMouseDown={() => answer(false)}>
      <div
        className="dialog confirm-box"
        role="alertdialog"
        aria-modal="true"
        aria-label="تأكيد"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && answer(false)}
      >
        <p style={{ whiteSpace: "pre-line", marginTop: 0 }}>{current.message}</p>
        <div className="row">
          <button className="btn btn-primary" autoFocus onClick={() => answer(true)}>
            {current.confirmLabel}
          </button>
          <button className="btn" onClick={() => answer(false)}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
