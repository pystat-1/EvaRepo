import { useEffect, useRef, type ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Notice({ kind, children }: { kind: "ok" | "warn" | "err"; children: ReactNode }) {
  return (
    <p className={`note note-${kind}`} role={kind === "err" ? "alert" : "status"}>
      {children}
    </p>
  );
}

/** Modal dialog on the native <dialog> element (focus trap, Esc to close). */
export function Dialog({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog ${wide ? "dialog-wide" : ""}`} onClose={onClose} aria-label={title}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="btn btn-ghost" onClick={onClose} aria-label="إغلاق">
          ✕
        </button>
      </div>
      {open && children}
    </dialog>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty muted">{children}</div>;
}

export const SHIFT_AR: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };
export const ATTENDANCE_AR: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
export const fmt2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : (Math.round(n * 100) / 100).toFixed(2));
