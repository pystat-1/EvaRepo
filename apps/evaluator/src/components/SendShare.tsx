import { useEffect, useState } from "react";
import type { Colleague, EvaluatorBundle } from "@eva/core/sync/contract";
import { allAssignments, queueShares, type Assignment } from "../lib/store";
import { buildShare, shareRecords } from "../lib/share";
import type { Draft } from "../lib/day";

// «إرسال لزميل»: this day's work so far (attendance, daily notes, marks,
// notes, hosted students and the day's assignments) goes to a colleague of
// the same group, who merges it into their own day under «الزملاء» and
// validates once. Queued on the phone, sent at the next sync.
export function SendShare({
  evaluatorId,
  bundle,
  draft,
  colleagues,
  onCancel,
  onQueued,
}: {
  evaluatorId: string;
  bundle: EvaluatorBundle;
  draft: Draft;
  colleagues: Colleague[];
  onCancel: () => void;
  onQueued: (count: number) => void;
}) {
  const mates = colleagues.filter((c) => c.groupIds.includes(draft.groupId));
  const [to, setTo] = useState<Set<string>>(() => new Set(mates.length === 1 ? [mates[0].id] : []));
  const [message, setMessage] = useState("");
  const [dayAssignments, setDayAssignments] = useState<Assignment[]>([]);
  const [withAssignments, setWithAssignments] = useState(true);
  const [busy, setBusy] = useState(false);
  const records = shareRecords(bundle, draft);

  useEffect(() => {
    allAssignments(evaluatorId).then((all) => setDayAssignments(all.filter((a) => a.groupId === draft.groupId && a.dateISO === draft.dateISO)));
  }, [evaluatorId, draft.groupId, draft.dateISO]);

  const sendable = records.length > 0 || (withAssignments && dayAssignments.length > 0);
  async function send() {
    setBusy(true);
    const now = new Date();
    const assignments = withAssignments ? dayAssignments.map(({ groupId: _g, createdAt: _c, from: _f, ...a }) => a) : [];
    const shares = [...to].map((toId) => buildShare(bundle, draft, { id: crypto.randomUUID(), toId, message, assignments, now }));
    await queueShares(evaluatorId, shares);
    onQueued(shares.length);
  }

  return (
    <div className="card stack">
      <div className="row between">
        <b>إرسال عمل اليوم لزميل</b>
        <button className="btn ghost tiny" onClick={onCancel}>
          إلغاء
        </button>
      </div>
      <p className="muted small">
        يصل للزميل في تبويب «الزملاء» فيدمجه في تقييمه لهذا اليوم ويعتمده مرة واحدة. لا يصل شيء للمدير من هذا الإرسال.
      </p>
      {mates.length === 0 ? (
        <p className="note warn">لا يوجد زميل آخر يقيّم هذه المجموعة — أو لم تُزامن بعد. زامن وأنت متصل ثم حاول مجددًا.</p>
      ) : (
        <div className="stack tight" role="group" aria-label="الزملاء">
          {mates.map((c) => (
            <label key={c.id} className="row check">
              <input
                type="checkbox"
                checked={to.has(c.id)}
                onChange={(e) => {
                  const next = new Set(to);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setTo(next);
                }}
              />
              {c.name}
            </label>
          ))}
        </div>
      )}
      <label className="field">
        رسالة (اختياري)
        <textarea className="input" rows={2} maxLength={500} value={message} placeholder="مثلًا: أكملت مناقشة الحالة للجميع" onChange={(e) => setMessage(e.target.value)} />
      </label>
      {dayAssignments.length > 0 && (
        <label className="row check">
          <input type="checkbox" checked={withAssignments} onChange={(e) => setWithAssignments(e.target.checked)} />
          مع واجبات هذا اليوم ({dayAssignments.length})
        </label>
      )}
      <p className="small">
        يُرسل: {records.length} طالب فيه حضور أو درجات أو ملاحظة{draft.scoring === "modified" ? " · بالدرجات المعدّلة" : ""}.
      </p>
      <button className="btn primary big" disabled={busy || to.size === 0 || !sendable} onClick={send}>
        إرسال{to.size > 1 ? ` إلى ${to.size} زملاء` : ""}
      </button>
    </div>
  );
}
