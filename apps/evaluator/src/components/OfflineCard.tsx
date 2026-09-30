import { useEffect, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

// The browser offers installation once; keep the offer for the button.
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPrompt;
  installListeners.forEach((l) => l());
});

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-IQ-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Baghdad" }) : "—";

// The whole course (schedule, students, criteria, previous days) is on the
// phone: it works with no internet, and anything graded offline is sent by
// itself once online.
export function OfflineCard({ bundle, lastSync }: { bundle: EvaluatorBundle; lastSync: string | null }) {
  const [canInstall, setCanInstall] = useState(!!installPrompt);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  useEffect(() => {
    const l = () => setCanInstall(!!installPrompt);
    installListeners.add(l);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => undefined);
    return () => void installListeners.delete(l);
  }, []);
  const students = bundle.groups.reduce((a, g) => a + g.students.length, 0);
  return (
    <div className="card offline">
      <b>✓ الدورة كاملة محفوظة على هذا الهاتف</b>
      <p className="muted small">
        {bundle.groups.length} مجموعة · {students} طالب · {bundle.history?.length ?? 0} يوم سابق · آخر تحديث: {when(lastSync)}. يعمل التطبيق دون إنترنت، وما تعتمده يُرسل تلقائيًا عند عودة الاتصال.
        {persisted === false && " (قد يمسح المتصفح البيانات عند امتلاء الذاكرة — ثبّت التطبيق لحمايتها.)"}
      </p>
      {canInstall && !standalone && (
        <button
          className="btn primary"
          onClick={async () => {
            await installPrompt?.prompt();
            installPrompt = null;
            setCanInstall(false);
          }}
        >
          تثبيت التطبيق على الهاتف
        </button>
      )}
    </div>
  );
}
