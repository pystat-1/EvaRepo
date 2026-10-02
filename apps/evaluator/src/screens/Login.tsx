import { useEffect, useRef, useState } from "react";
import { loginWithGoogle, signInConfig } from "../lib/sync";
import type { Session } from "../lib/store";

// Minimal slice of Google Identity Services (https://accounts.google.com/gsi/client).
interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup"; auto_select?: boolean; use_fedcm_for_prompt?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  prompt(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

function loadGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("google")));
    s.onerror = () => reject(new Error("google"));
    document.head.appendChild(s);
  });
}

const SIGNED_OUT = "eva.signedOut";
const signedOutOnPurpose = () => {
  try {
    return localStorage.getItem(SIGNED_OUT) === "1";
  } catch {
    return false;
  }
};
export function markSignedOut(on: boolean) {
  try {
    if (on) localStorage.setItem(SIGNED_OUT, "1");
    else localStorage.removeItem(SIGNED_OUT);
  } catch {
    /* private mode: auto sign-in simply stays on */
  }
}

// Sign in once with the Google account of the email the admin registered.
// After that the app stays signed in and syncs by itself.
export function Login({ onDone }: { onDone: (s: Session) => void }) {
  const button = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "offline" | "off">("loading");
  const [error, setError] = useState<string | null>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const clientId = await signInConfig();
        if (cancelled) return;
        if (!clientId) return setState("off");
        const g = await loadGoogle();
        if (cancelled || !button.current) return;
        // After a deliberate sign-out, don't sign straight back in.
        const auto = !signedOutOnPurpose();
        g.initialize({
          client_id: clientId,
          auto_select: auto,
          use_fedcm_for_prompt: true,
          callback: async ({ credential }) => {
            setState("busy");
            setError(null);
            try {
              const s = await loginWithGoogle(credential);
              markSignedOut(false);
              done.current(s);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setState("ready");
            }
          },
        });
        g.renderButton(button.current, { theme: "filled_blue", size: "large", shape: "pill", text: "signin_with", locale: "ar", width: 280 });
        if (auto) g.prompt(); // one tap for an account already signed in on this phone
        setState("ready");
      } catch {
        if (!cancelled) setState("offline");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen center">
      <div className="card login">
        <div className="brand-lg">Eva</div>
        <p className="muted">تطبيق المقيّم — ادخل مرة واحدة بحساب Google، ثم يعمل ويُزامِن تلقائيًا حتى دون إنترنت.</p>
        <div ref={button} className="google-btn" hidden={state !== "ready" && state !== "busy"} />
        {state === "loading" && <p className="muted">…</p>}
        {state === "busy" && <p className="muted">جارٍ الدخول…</p>}
        {state === "offline" && (
          <p className="note err" role="alert">
            لا يوجد اتصال بالإنترنت. الدخول أول مرة يحتاج إلى إنترنت.
            <button className="btn" onClick={() => location.reload()}>
              إعادة المحاولة
            </button>
          </p>
        )}
        {state === "off" && <p className="note err">الدخول بحساب Google غير مفعَّل بعد — تواصل مع المدير.</p>}
        {error && (
          <p className="note err" role="alert">
            {error}
          </p>
        )}
        <p className="muted small">استخدم حساب Google للبريد الذي سجّله لك المدير.</p>
      </div>
    </div>
  );
}
