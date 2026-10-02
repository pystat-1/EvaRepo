"use client";

import { useEffect, useState } from "react";

// A small, dismissible "install app" chip shown app-wide (admin, evaluator,
// student) once the browser signals the PWA is installable. Tapping it fires
// the native install prompt. Hidden when already installed (standalone) or
// after the user installs/dismisses. On iOS Safari — which has no
// beforeinstallprompt — it shows a one-line "Add to Home Screen" hint.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already installed → never show.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    try {
      if (localStorage.getItem("eva-install-dismissed") === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      /* private mode */
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    if (isIos) setShowIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem("eva-install-dismissed", "1");
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    dismiss();
  }

  if (dismissed) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <div
      className="fixed bottom-3 inset-x-0 z-50 flex justify-center px-4 pointer-events-none"
      role="dialog"
      aria-label="تثبيت التطبيق"
    >
      <div
        className="pointer-events-auto flex items-center gap-3 rounded-full border shadow-lg px-4 py-2 text-sm"
        style={{ background: "var(--surface-raised, #fff)", borderColor: "var(--border, #e2e8f0)" }}
      >
        {deferred ? (
          <>
            <span>ثبّت تطبيق Eva على جهازك</span>
            <button type="button" onClick={install} className="btn btn-primary text-xs px-3 py-1">
              تثبيت
            </button>
          </>
        ) : (
          <span className="text-slate-600">
            للتثبيت على iPhone: شارك ← «إضافة إلى الشاشة الرئيسية»
          </span>
        )}
        <button type="button" onClick={dismiss} aria-label="إغلاق" className="text-slate-400 px-1">
          ✕
        </button>
      </div>
    </div>
  );
}
