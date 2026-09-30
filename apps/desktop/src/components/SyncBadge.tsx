import { useEffect, useState } from "react";
import { useSyncState } from "../lib/autoSync";

// Sidebar line showing the automatic sync at a glance; click opens المزامنة.
export function SyncBadge({ onOpen }: { onOpen: () => void }) {
  const s = useSyncState();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000); // keep "منذ" fresh
    return () => clearInterval(t);
  }, []);
  const text =
    s.kind === "off"
      ? "المزامنة غير مُعدّة"
      : s.kind === "syncing"
        ? "جارٍ المزامنة…"
        : s.kind === "offline"
          ? "دون اتصال — ستُزامَن تلقائيًا"
          : s.kind === "error"
            ? "تعذّرت المزامنة — ستُعاد"
            : s.lastAt
              ? `متزامن ${ago(s.lastAt)}`
              : "المزامنة تلقائية";
  return (
    <button className={`sync-badge sync-${s.kind}`} onClick={onOpen} title={s.message ?? "المزامنة مع هواتف المقيّمين تعمل تلقائيًا"}>
      <span className="sync-dot" aria-hidden="true" />
      {text}
    </button>
  );
}

function ago(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "الآن";
  if (min < 60) return `منذ ${min} د`;
  return `منذ ${Math.floor(min / 60)} س`;
}
