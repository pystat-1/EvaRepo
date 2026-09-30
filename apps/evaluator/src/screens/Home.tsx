import { useEffect, useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { addDaysISO, todayISO } from "@eva/core/date";
import { allDrafts, allResults, outbox, type Session, type StoredResult } from "../lib/store";
import { draftKey, groupsForDate, overdueDrafts, type Draft } from "../lib/day";
import type { SyncState } from "../App";

const SHIFT = { MORNING: "صباحي", EVENING: "مسائي" } as const;

export function Home({
  session,
  bundle,
  sync,
  tick,
  onSync,
  onOpen,
  onSignOut,
}: {
  session: Session;
  bundle: EvaluatorBundle | null;
  sync: SyncState;
  tick: number;
  onSync: () => void;
  onOpen: (x: { groupId: string; dateISO: string }) => void;
  onSignOut: () => void;
}) {
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [results, setResults] = useState<StoredResult[]>([]);
  const [unsent, setUnsent] = useState(0);

  useEffect(() => {
    const id = session.evaluator.id;
    Promise.all([allDrafts(id), allResults(id), outbox(id)]).then(([d, r, o]) => {
      setDrafts(d);
      setResults(r);
      setUnsent(o.length);
    });
  }, [session, tick]);

  const byKey = new Map(drafts.map((d) => [d.key, d]));
  const resultOf = (d?: Draft) => (d?.clientId ? results.find((r) => r.clientId === d.clientId) : undefined);
  const overdue = overdueDrafts(drafts, today);
  const groups = bundle ? groupsForDate(bundle, date) : [];
  const scheduled = groups.filter((g) => g.scheduled);
  const others = groups.filter((g) => !g.scheduled);
  const problems = results.filter((r) => r.status === "decided" && r.outcome !== "applied");

  return (
    <div className="screen">
      <header className="top">
        <div>
          <b>{session.evaluator.name}</b>
          <div className="muted small">{bundle?.course.label ?? "—"}</div>
        </div>
        <div className="row">
          <button className={`chip ${sync.kind}`} onClick={onSync} aria-label="مزامنة الآن">
            {sync.kind === "syncing" ? "جارٍ المزامنة…" : sync.kind === "offline" ? "دون اتصال" : sync.kind === "error" ? "خطأ في المزامنة" : "متزامن"}
            {unsent > 0 && ` · ${unsent} بانتظار الإرسال`}
          </button>
          <button className="btn ghost" onClick={onSignOut}>خروج</button>
        </div>
      </header>

      {sync.kind === "error" && <p className="note err">{sync.message}</p>}
      {!bundle && <p className="note warn">لم يُنزَّل جدولك بعد — افتح التطبيق وأنت متصل بالإنترنت.</p>}
      {overdue.length > 0 && (
        <div className="note err" role="status">
          <b>أيام لم تُعتمد بعد ({overdue.length}):</b>
          {overdue.map((d) => {
            const g = bundle?.groups.find((x) => x.id === d.groupId);
            return (
              <button key={d.key} className="link" onClick={() => onOpen({ groupId: d.groupId, dateISO: d.dateISO })}>
                {g?.name ?? "مجموعة"} · {d.dateISO}
              </button>
            );
          })}
        </div>
      )}
      {problems.map((r) => (
        <p key={r.clientId} className="note warn">
          {r.dateISO}: {r.message}
        </p>
      ))}

      <div className="row date-row">
        <button className="btn" onClick={() => setDate(addDaysISO(date, -1))} aria-label="اليوم السابق">‹</button>
        <input className="input" type="date" value={date} max={today} min={addDaysISO(today, -7)} onChange={(e) => setDate(e.target.value || today)} />
        <button className="btn" onClick={() => setDate(addDaysISO(date, 1))} disabled={date >= today} aria-label="اليوم التالي">›</button>
        {date !== today && <button className="btn" onClick={() => setDate(today)}>اليوم</button>}
      </div>

      <h2>{date === today ? "مجموعات اليوم" : `مجموعات ${date}`}</h2>
      {bundle && scheduled.length === 0 && <p className="muted">لا توجد مجموعة مجدولة لك في هذا اليوم.</p>}
      {scheduled.map((g) => (
        <GroupCard key={g.id} g={g} draft={byKey.get(draftKey(g.id, date))} result={resultOf(byKey.get(draftKey(g.id, date)))} onOpen={() => onOpen({ groupId: g.id, dateISO: date })} />
      ))}

      {others.length > 0 && (
        <details className="others">
          <summary>مجموعة أخرى (إذا تغيّر الموعد بسبب عطلة)</summary>
          {others.map((g) => (
            <GroupCard key={g.id} g={g} draft={byKey.get(draftKey(g.id, date))} result={resultOf(byKey.get(draftKey(g.id, date)))} onOpen={() => onOpen({ groupId: g.id, dateISO: date })} />
          ))}
        </details>
      )}
    </div>
  );
}

function GroupCard({
  g,
  draft,
  result,
  onOpen,
}: {
  g: ReturnType<typeof groupsForDate>[number];
  draft?: Draft;
  result?: StoredResult;
  onOpen: () => void;
}) {
  const graded = draft ? Object.values(draft.rows).filter((r) => r.attendance).length : 0;
  const [status, cls] = cardStatus(draft, result, graded, g.studentCount);
  return (
    <button className="card group" onClick={onOpen}>
      <div>
        <b>{g.name}</b>
        <div className="muted small">
          {g.shift ? SHIFT[g.shift] : ""} · {g.hospitalName} · {g.studentCount} طالب{g.scheduled ? "" : " · خارج الجدول"}
        </div>
      </div>
      <span className={`status ${cls}`}>{status}</span>
    </button>
  );
}

function cardStatus(draft: Draft | undefined, result: StoredResult | undefined, graded: number, total: number): [string, string] {
  if (!draft) return ["لم يبدأ", ""];
  if (draft.status === "draft") return [`مسودة · ${graded}/${total}`, "warn"];
  if (!result) return ["معتمد · بانتظار الإرسال", "warn"];
  if (result.status === "sent") return ["أُرسل · بانتظار المدير", ""];
  if (result.outcome === "applied") return ["وصل للمدير ✓", "ok"];
  return [result.outcome === "conflict" ? "تعارض — بانتظار قرار المدير" : "رُفض", "err"];
}
