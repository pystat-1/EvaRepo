import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { todayISO } from "@eva/core/date";
import type { Draft } from "../lib/day";
import { SHIFT_AR, schedule, type DayEntry, type DayMark } from "../lib/views";
import { scheduleExcel } from "../lib/exports";
import { DownloadMenu } from "../components/DownloadMenu";
import { OfflineCard } from "../components/OfflineCard";

const MARK: Record<DayMark, { text: string; cls: string }> = {
  done: { text: "قيّمته ✓", cls: "ok" },
  colleague: { text: "قيّمه زميل", cls: "ok" },
  draft: { text: "مسودة", cls: "warn" },
  missed: { text: "لم يُقيَّم", cls: "err" },
  today: { text: "اليوم", cls: "today" },
  future: { text: "قادم", cls: "" },
};
const WHEN = { past: "منتهية", current: "حالية", future: "قادمة" } as const;

// جدولي: the whole course for this evaluator — every group block at their
// hospitals, week by week, each day marked. Tapping a past or current day
// opens it for grading (or to view what was graded). All offline.
export function Schedule({
  bundle,
  entries,
  drafts,
  lastSync,
  onOpen,
}: {
  bundle: EvaluatorBundle;
  entries: DayEntry[];
  drafts: Draft[];
  lastSync: string | null;
  onOpen: (x: { groupId: string; dateISO: string }) => void;
}) {
  const today = todayISO();
  const hospitals = schedule(bundle, entries, drafts, today);
  return (
    <>
      <OfflineCard bundle={bundle} lastSync={lastSync} />
      <div className="row between">
        <h2>جدولي</h2>
        <DownloadMenu items={[{ label: "الجدول الكامل — Excel", run: () => scheduleExcel(bundle, hospitals) }]} />
      </div>
      {hospitals.length === 0 && <p className="muted">لا يوجد جدول دوران مخصّص لك بعد — تواصل مع المدير.</p>}
      {hospitals.map((h) => (
        <section key={h.hospitalName} className="stack">
          <h3>🏥 {h.hospitalName}</h3>
          {h.stints.map((s) => (
            <details key={`${s.groupId}:${s.startDate}`} className="card stint" open={s.when === "current"}>
              <summary>
                <div className="grow">
                  <b>{s.groupName}</b>
                  <div className="muted small">
                    {s.shift ? `${SHIFT_AR[s.shift]} · ` : ""}
                    {s.startDate} ← {s.endDate} · {s.studentCount} طالب
                  </div>
                </div>
                <span className={`status ${s.when === "current" ? "ok" : ""}`}>{WHEN[s.when]}</span>
              </summary>
              {s.weeks.map((w, i) => (
                <div key={i} className="week">
                  <div className="muted small">الأسبوع {i + 1}</div>
                  <div className="days">
                    {w.map((d) => {
                      const m = MARK[d.mark];
                      const can = d.mark !== "future";
                      return (
                        <button
                          key={d.dateISO}
                          className={`dayc ${m.cls}`}
                          disabled={!can}
                          onClick={() => onOpen({ groupId: s.groupId, dateISO: d.dateISO })}
                          aria-label={`${s.groupName} ${d.weekday} ${d.dateISO}: ${m.text}`}
                        >
                          <span>
                            {d.weekday} {d.dateISO.slice(8)}/{d.dateISO.slice(5, 7)}
                          </span>
                          <small>{m.text}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </details>
          ))}
        </section>
      ))}
    </>
  );
}
