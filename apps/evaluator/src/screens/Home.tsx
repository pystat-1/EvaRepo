import { useState } from "react";
import type { EvaluatorBundle } from "@eva/core/sync/contract";
import { addDaysISO, todayISO } from "@eva/core/date";
import type { StoredResult } from "../lib/store";
import { draftKey, groupsForDate, holidayOn, overdueDrafts, type Draft } from "../lib/day";

const SHIFT = { MORNING: "صباحي", EVENING: "مسائي" } as const;

export function Home({
  bundle,
  drafts,
  results,
  onOpen,
}: {
  bundle: EvaluatorBundle;
  drafts: Draft[];
  results: StoredResult[];
  onOpen: (x: { groupId: string; dateISO: string }) => void;
}) {
  const today = todayISO();
  const [date, setDate] = useState(today);

  const byKey = new Map(drafts.map((d) => [d.key, d]));
  const resultOf = (d?: Draft) => (d?.clientId ? results.find((r) => r.clientId === d.clientId) : undefined);
  const overdue = overdueDrafts(drafts, today);
  const groups = groupsForDate(bundle, date);
  const scheduled = groups.filter((g) => g.scheduled);
  const others = groups.filter((g) => !g.scheduled);
  const problems = results.filter((r) => r.status === "decided" && r.outcome !== "applied");
  const holiday = holidayOn(bundle, date);
  const makeupFor = (bundle.holidays ?? []).find((h) => h.movedTo === date) ?? null;

  return (
    <>
      {overdue.length > 0 && (
        <div className="note err" role="status">
          <b>أيام لم تُعتمد بعد ({overdue.length}):</b>
          {overdue.map((d) => {
            const g = bundle.groups.find((x) => x.id === d.groupId);
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
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
        <button className="btn" onClick={() => setDate(addDaysISO(date, 1))} aria-label="اليوم التالي">›</button>
        {date !== today && <button className="btn" onClick={() => setDate(today)}>اليوم</button>}
      </div>

      <h2>{date === today ? "مجموعات اليوم" : `مجموعات ${date}`}</h2>
      {holiday && (
        <div className="note warn" role="status">
          <b>عطلة{holiday.label ? `: ${holiday.label}` : ""}</b>
          {holiday.movedTo ? (
            <>
              {" "}— نُقل دوام هذا اليوم إلى{" "}
              <button className="link" onClick={() => setDate(holiday.movedTo!)}>{holiday.movedTo}</button>
            </>
          ) : (
            " — لا دوام في هذا اليوم"
          )}
        </div>
      )}
      {makeupFor && (
        <p className="note" role="status">
          يوم تعويض عن عطلة {makeupFor.dateISO}{makeupFor.label ? ` (${makeupFor.label})` : ""}
        </p>
      )}
      {scheduled.length === 0 && <p className="muted">لا توجد مجموعة مجدولة لك في هذا اليوم.</p>}
      {scheduled.map((g) => (
        <GroupCard key={g.id} g={g} draft={byKey.get(draftKey(g.id, date))} result={resultOf(byKey.get(draftKey(g.id, date)))} onOpen={() => onOpen({ groupId: g.id, dateISO: date })} />
      ))}

      {others.length > 0 && (
        <details className="others">
          <summary>مجموعات أخرى — يمكن تقييم أي مجموعة في أي يوم ({others.length})</summary>
          {others.map((g) => (
            <GroupCard key={g.id} g={g} draft={byKey.get(draftKey(g.id, date))} result={resultOf(byKey.get(draftKey(g.id, date)))} onOpen={() => onOpen({ groupId: g.id, dateISO: date })} />
          ))}
        </details>
      )}
    </>
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
