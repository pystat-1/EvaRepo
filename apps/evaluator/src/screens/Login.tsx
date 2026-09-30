import { useState } from "react";
import { login } from "../lib/sync";
import type { Session } from "../lib/store";

export function Login({ onDone }: { onDone: (s: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="screen center">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onDone(await login(email.trim(), password.trim()));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand-lg">Eva</div>
        <p className="muted">تطبيق المقيّم — يعمل دون اتصال بعد تسجيل الدخول</p>
        <label className="field">
          البريد الإلكتروني
          <input className="input ltr" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          كلمة المرور
          <input className="input ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="note err" role="alert">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? "…" : "تسجيل الدخول"}
        </button>
        <p className="muted small">كلمة المرور يعطيك إياها مدير النظام.</p>
      </form>
    </div>
  );
}
