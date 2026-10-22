import { useEffect, useState } from "react";
import type { EvaluatorBundle, InboxShare, ShareStatus } from "@eva/core/sync/contract";
import type { ScoringMode } from "@eva/core/grading/scoring";
import { formatTimeBaghdad, todayISO } from "@eva/core/date";
import { decideShare, getDraft, putAssignments, putDraft, type ShareBox } from "../lib/store";
import { assignmentsOf, compareShare, hasGrades, mergeShare, type MergeState } from "../lib/share";
import { draftKey, maxTotal, type Draft } from "../lib/day";
import { ATTENDANCE_AR, weekdayAr, type DayEntry } from "../lib/views";

const STATUS_AR: Record<ShareStatus, string> = { new: "جديد", merged: "دُمج ✓", dismissed: "تُجوهل" };
const SENT_AR: Record<ShareStatus, string> = { new: "وصل — لم يُدمج بعد", merged: "دمجه ✓", dismissed: "تجاهله" };
const STATE_AR: Record<MergeState, string> = { new: "جديد", same: "مطابق", fills: "يكمل الناقص", differs: "مختلف", unknown: "ليس في المجموعة" };
const MODE_AR: Record<ScoringMode, string> = { standard: "الدرجات العادية", modified: "الدرجات المعدّلة (كويز)" };

// "10-21 09:40 ص": day and Baghdad time of a share.
const when = (iso: string) => `${todayISO(new Date(iso)).slice(5)} ${formatTimeBaghdad(iso)}`;
const groupNameOf = (bundle: EvaluatorBundle, id: string) => bundle.groups.find((g) => g.id === id)?.name ?? "مجموعة غير موجودة في جدولك";

// الزملاء: work that colleagues of the same group sent this evaluator
// («إرسال لزميل» in a day), to compare with their own day and merge into
// it before validating once — so the manager gets one grade per student
// and day, not a conflict. Below: what this evaluator sent and whether the
// colleague merged it.
export function Colleagues({
  evaluatorId,
  bundle,
  box,
  entries,
  onOpenDay,
  onChanged,
}: {
  evaluatorId: string;
  bundle: EvaluatorBundle;
  box: ShareBox;
  entries: DayEntry[];
  onOpenDay: (x: { groupId: string; dateISO: string }) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<InboxShare | null>(null);
  const statusOf = (s: InboxShare) => box.decisions[s.id] ?? s.status;
  const inbox = [...box.inbox].sort((a, b) => Number(statusOf(a) !== "new") - Number(statusOf(b) !== "new") || b.receivedAt.localeCompare(a.receivedAt));
  const fresh = inbox.filter((s) => statusOf(s) === "new").length;

  if (open)
    return (
      <ShareMerge
        evaluatorId={evaluatorId}
        bundle={bundle}
        share={open}
        status={statusOf(open)}
        entries={entries}
        onBack={() => setOpen(null)}
        onMerged={() => {
          setOpen(null);
          onChanged();
          onOpenDay({ groupId: open.groupId, dateISO: open.dateISO });
        }}
        onDismissed={() => {
          setOpen(null);
          onChanged();
        }}
      />
    );

  return (
    <>
      <h2>الزملاء</h2>
      <p className="muted small">
        حين يقيّم أكثر من مقيّم المجموعة نفسها: يرسل أحدكم عمله من اليوم («⇄ إرسال لزميل») فيصل هنا، وتدمجه في تقييمك لذلك اليوم ثم تعتمده مرة واحدة.
      </p>
      <h3>الواردة{fresh ? ` (${fresh} جديد)` : ""}</h3>
      {inbox.length === 0 && <p className="muted">لا شيء وارد بعد.</p>}
      {inbox.map((s) => {
        const st = statusOf(s);
        return (
          <button key={s.id} className={`card share ${st !== "new" ? "dim" : ""}`} onClick={() => setOpen(s)}>
            <div className="grow min0">
              <b>{s.fromName}</b>
              <div className="small">
                {groupNameOf(bundle, s.groupId)} · {weekdayAr(s.dateISO)} {s.dateISO}
              </div>
              <div className="muted small">
                {s.records.length} طالب{s.assignments?.length ? ` · ${s.assignments.length} واجب` : ""}
                {s.scoring === "modified" ? " · بالدرجات المعدّلة" : ""} · {when(s.receivedAt)}
              </div>
              {s.message && <div className="share-msg">«{s.message}»</div>}
            </div>
            <span className={`status ${st === "new" ? "warn" : st === "merged" ? "ok" : ""}`}>{STATUS_AR[st]}</span>
          </button>
        );
      })}

      <h3>المرسلة</h3>
      {box.outbox.length + box.sent.length + Object.keys(box.refused).length === 0 && <p className="muted">لم ترسل شيئًا بعد.</p>}
      {box.outbox.map((s) => (
        <div key={s.id} className="card share">
          <div className="grow min0">
            <b>إلى {box.colleagues.find((c) => c.id === s.toId)?.name ?? "زميل"}</b>
            <div className="small">
              {groupNameOf(bundle, s.groupId)} · {weekdayAr(s.dateISO)} {s.dateISO}
            </div>
          </div>
          <span className="status">بانتظار الإرسال</span>
        </div>
      ))}
      {box.sent.map((s) => (
        <div key={s.id} className="card share">
          <div className="grow min0">
            <b>إلى {s.toName}</b>
            <div className="small">
              {groupNameOf(bundle, s.groupId)} · {weekdayAr(s.dateISO)} {s.dateISO}
            </div>
            <div className="muted small">أُرسل {when(s.sentAt)}</div>
          </div>
          <span className={`status ${s.status === "merged" ? "ok" : ""}`}>{SENT_AR[s.status]}</span>
        </div>
      ))}
      {Object.entries(box.refused).map(([id, why]) => (
        <p key={id} className="note err">
          لم يُقبل إرسال: {why}
        </p>
      ))}
    </>
  );
}

// One share against my own day: student by student (new, same, fills,
// differs), then merged into my draft — only filling what I left empty, or
// replacing my values where we differ — and the day opens to check and
// validate. Nothing reaches the manager until I validate.
function ShareMerge({
  evaluatorId,
  bundle,
  share,
  status,
  entries,
  onBack,
  onMerged,
  onDismissed,
}: {
  evaluatorId: string;
  bundle: EvaluatorBundle;
  share: InboxShare;
  status: ShareStatus;
  entries: DayEntry[];
  onBack: () => void;
  onMerged: () => void;
  onDismissed: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [replace, setReplace] = useState(false);
  const [pick, setPick] = useState<Set<string> | null>(null);
  const [scoring, setScoring] = useState<ScoringMode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getDraft(evaluatorId, draftKey(share.groupId, share.dateISO)).then(setDraft);
  }, [evaluatorId, share.groupId, share.dateISO]);
  if (draft === undefined) return <div className="center muted pad">…</div>;

  const inMyBundle = bundle.groups.some((g) => g.id === share.groupId);
  const lines = inMyBundle ? compareShare(bundle, share, draft) : [];
  const chosen = pick ?? new Set(lines.filter((l) => l.state !== "unknown" && l.state !== "same").map((l) => l.studentId));
  const theirMode: ScoringMode = share.scoring ?? "standard";
  const myMode: ScoringMode = draft?.scoring ?? "standard";
  const modesDiffer = theirMode !== myMode && hasGrades(draft);
  const target: ScoringMode = scoring ?? (modesDiffer ? (theirMode === "modified" ? "modified" : myMode) : hasGrades(draft) ? myMode : theirMode);
  const validated = draft?.status === "validated" || entries.some((e) => e.mine && e.groupId === share.groupId && e.dateISO === share.dateISO && e.state === "applied");
  const blocked = !inMyBundle ? "هذه المجموعة ليست في جدولك." : validated ? "اعتمدت هذا اليوم — لا يمكن الدمج فيه. اطلب من المدير إن لزم تعديل." : null;

  async function merge() {
    setBusy(true);
    const now = new Date();
    await putDraft(evaluatorId, mergeShare(bundle, draft ?? null, share, { pick: chosen, replace, scoring: target, now }));
    if (share.assignments?.length) await putAssignments(evaluatorId, assignmentsOf(share, now));
    await decideShare(evaluatorId, share.id, "merged");
    onMerged();
  }

  return (
    <div className="stack">
      <div className="day-head">
        <button className="btn ghost back" onClick={onBack} aria-label="رجوع">
          ‹
        </button>
        <div className="grow min0">
          <b className="ellipsis">من {share.fromName}</b>
          <div className="muted small ellipsis">
            {groupNameOf(bundle, share.groupId)} · {weekdayAr(share.dateISO)} {share.dateISO}
          </div>
        </div>
        <span className={`status ${status === "new" ? "warn" : status === "merged" ? "ok" : ""}`}>{STATUS_AR[status]}</span>
      </div>
      {share.message && <p className="note">«{share.message}»</p>}
      {blocked && <p className="note warn">{blocked}</p>}

      {lines.length > 0 && (
        <div className="grid-wrap" role="region" aria-label="المقارنة" tabIndex={0}>
          <table className="grid cgrid review">
            <thead>
              <tr>
                <th>دمج</th>
                <th className="sticky-name">الطالب</th>
                <th>الحالة</th>
                <th>حضور الزميل</th>
                <th>
                  عند الزميل<small>/{maxTotal(bundle)}</small>
                </th>
                <th>
                  عندي<small>/{maxTotal(bundle)}</small>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.studentId} className={l.state === "differs" ? "missing" : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`دمج ${l.name}`}
                      disabled={l.state === "unknown" || !!blocked}
                      checked={chosen.has(l.studentId)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(l.studentId);
                        else next.delete(l.studentId);
                        setPick(next);
                      }}
                    />
                  </td>
                  <th className="sticky-name" scope="row">
                    {l.name}
                    {l.guest && <span className="guest-tag">مستضاف</span>}
                  </th>
                  <td className={`merge-${l.state}`}>{STATE_AR[l.state]}</td>
                  <td>{l.theirs.attendance ? ATTENDANCE_AR[l.theirs.attendance] : "—"}</td>
                  <td>{l.theirTotal === null ? "—" : l.theirTotal}</td>
                  <td>{l.myTotal === null ? "—" : l.myTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {share.assignments?.length ? <p className="small">ومعه {share.assignments.length} واجب يُضاف إلى «الواجبات».</p> : null}

      {!blocked && (
        <div className="card stack tight">
          <div className="field-label">عند الاختلاف</div>
          <div className="choice2">
            <button className={`choice ${!replace ? "on" : ""}`} onClick={() => setReplace(false)}>
              أكمل الناقص فقط
            </button>
            <button className={`choice ${replace ? "on" : ""}`} onClick={() => setReplace(true)}>
              قيم الزميل تحلّ محل قيمي
            </button>
          </div>
          {modesDiffer && (
            <>
              <div className="field-label">
                الزميل قيّم بـ{MODE_AR[theirMode]} وأنت بـ{MODE_AR[myMode]} — يُعتمد اليوم بـ:
              </div>
              <div className="choice2">
                {(["modified", "standard"] as const).map((m) => (
                  <button key={m} className={`choice ${target === m ? "on" : ""}`} onClick={() => setScoring(m)}>
                    {MODE_AR[m]}
                  </button>
                ))}
              </div>
              <p className="muted small">
                {target === "modified" ? "درجات المناقشة الأعلى من 2.5 تُخفض إلى 2.5." : "درجات الاختبار القصير تُحذف."}
              </p>
            </>
          )}
          <button className="btn primary big" disabled={busy || (chosen.size === 0 && !share.assignments?.length)} onClick={merge}>
            دمج {chosen.size} طالب في تقييمي لهذا اليوم
          </button>
          <p className="muted small">يبقى اليوم مسودة: راجعه ثم اعتمده كالمعتاد.</p>
        </div>
      )}
      {status === "new" && (
        <button
          className="btn"
          onClick={async () => {
            await decideShare(evaluatorId, share.id, "dismissed");
            onDismissed();
          }}
        >
          تجاهل هذا الإرسال
        </button>
      )}
    </div>
  );
}
