import { useState } from "react";

export interface DownloadItem {
  label: string;
  run: () => Promise<void>;
  disabled?: boolean;
}

// "تنزيل" button with a short list of files; the file is made on the phone
// (works offline) and saved by the browser.
export function DownloadMenu({ items, label = "تنزيل" }: { items: DownloadItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="dl">
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⬇ {label}
      </button>
      {open && (
        <>
          <div className="dl-backdrop" onClick={() => setOpen(false)} />
          <div className="dl-menu" role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                className="dl-item"
                disabled={it.disabled || !!busy}
                onClick={async () => {
                  setBusy(it.label);
                  setError(null);
                  try {
                    await it.run();
                    setOpen(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === it.label ? "جارٍ التحضير…" : it.label}
              </button>
            ))}
            {error && <p className="note err">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
