import { useEffect, useSyncExternalStore } from "react";
import { fmt2 } from "./ui";

// The small window with a criterion's sub-criteria (e.g. المظهر: الشارة،
// المعطف، الزي، الحجاب) for one student's grade. Opened from a score cell;
// closes on a click elsewhere or Escape.
export interface SubCriteriaView {
  x: number;
  y: number;
  title: string;
  student: string;
  max: number;
  score: number;
  items: Array<{ label: string; labelEn: string | null; max: number; score: number | null }>;
}

let current: SubCriteriaView | null = null;
const listeners = new Set<() => void>();
const set = (v: SubCriteriaView | null) => {
  current = v;
  listeners.forEach((l) => l());
};
export const showSubCriteria = (v: SubCriteriaView) => set(v);

export function SubCriteriaHost() {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current
  );
  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && set(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [v]);
  if (!v) return null;
  const width = 280;
  const left = Math.min(Math.max(8, v.x - width / 2), window.innerWidth - width - 8);
  const top = Math.min(v.y + 8, window.innerHeight - 60 - v.items.length * 34);
  return (
    <div className="subcrit-backdrop" onMouseDown={() => set(null)}>
      <div className="subcrit" role="dialog" aria-label={v.title} style={{ left, top, width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="subcrit-head">
          <b>{v.title}</b>
          <span className="tabular">
            {fmt2(v.score)}/{v.max}
          </span>
        </div>
        <div className="muted small">{v.student}</div>
        <table>
          <tbody>
            {v.items.map((i) => (
              <tr key={i.label} className={i.score !== null && i.score >= i.max ? "full" : undefined}>
                <td>
                  {i.label}
                  {i.labelEn && <small className="muted"> · {i.labelEn}</small>}
                </td>
                <td className="tabular">{i.score === null ? "—" : `${fmt2(i.score)}/${i.max}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {v.items.every((i) => i.score === null) && <p className="muted small">سُجّلت هذه الدرجة على مستوى البند فقط (من الموقع القديم).</p>}
      </div>
    </div>
  );
}
