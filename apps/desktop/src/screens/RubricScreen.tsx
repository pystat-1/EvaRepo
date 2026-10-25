import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { rubricCenter, saveRubric } from "@eva/db/repo/rubric";
import {
  draftChanged,
  draftProblems,
  draftTotal,
  draftWarnings,
  itemsSum,
  type DraftItem,
  type DraftProblem,
  type DraftSection,
  type ItemKind,
} from "@eva/core/grading/rubricDraft";
import { Empty, Notice, PageHeader } from "../components/ui";
import { confirmAction } from "../components/confirm";
import { errorText, r } from "../lib/repo";

// «مركز المعايير»: the criteria evaluators grade with, their items (بنود),
// each one's maximum and the day's total. Edited as a draft and saved at
// once (packages/db/src/repo/rubric.ts); the phones get the new criteria on
// the next sync, a few seconds after saving. Saved rows are only turned
// off, never deleted: recorded grades point to them. Each set sent to the
// phones is kept as a version, so days graded before a change are still
// checked and shown against the criteria they were graded with.

type Item = DraftItem & { key: string };
type Section = Omit<DraftSection, "items"> & { key: string; items: Item[] };

let seq = 0;
const key = () => `k${++seq}`;
const fromSaved = (sections: DraftSection[]): Section[] =>
  sections.map((s) => ({ ...s, key: s.id ?? key(), items: s.items.map((i) => ({ ...i, key: i.id ?? key() })) }));

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
/** "٢٫٥" / "2,5" -> 2.5; NaN while it is not a number (the problems list says so). */
function parseMax(text: string): number {
  const t = text
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d >= "۰" ? 0x6f0 : 0x660)) % 10))
    .replace(/[٫,،]/g, ".")
    .replace(/\s+/g, "");
  return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
}

// A maximum box that keeps what is typed ("2." is not a number yet).
function MaxInput({ value, onChange, label, disabled }: { value: number; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  // A value set from outside (undo) replaces the text; one typed here keeps it.
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    if (Number.isFinite(value) && parseMax(text) !== value) setText(String(value));
  }
  return (
    <input
      className="input tabular"
      style={{ width: 76 }}
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseMax(e.target.value));
      }}
    />
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "؟");

export function RubricScreen() {
  const saved = useQuery({ queryKey: ["rubricCenter"], queryFn: () => rubricCenter(r) });
  const [draft, setDraft] = useState<Section[] | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const base = useMemo(() => (saved.data ? fromSaved(saved.data.sections) : null), [saved.data]);
  const d = draft ?? base;

  const save = useMutation({
    // The fresh criteria are read before the draft is dropped, so the screen never shows the old ones.
    mutationFn: async (sections: Section[]) => {
      const res = await saveRubric(r, sections);
      await saved.refetch();
      return res;
    },
    onSuccess: (res) => {
      setDraft(null);
      setDone(res.changed === 0 ? "لا تغييرات للحفظ." : `حُفظت المعايير (${res.changed} تغيير). تصل إلى هواتف المقيّمين في المزامنة التالية خلال ثوانٍ.`);
    },
  });

  if (saved.isLoading || !d || !base) return <Empty>جارٍ التحميل…</Empty>;
  if (saved.error) return <Notice kind="err">{errorText(saved.error)}</Notice>;

  const data = saved.data!;
  const problems = draftProblems(d);
  const dirty = draftChanged(base, d);
  const total = draftTotal(d);
  const savedTotal = draftTotal(base);
  const problemsAt = (si: number, ii?: number) => problems.filter((p) => p.section === si && p.item === ii);

  const edit = (next: Section[]) => {
    setDone(null);
    save.reset();
    setDraft(next);
  };
  const setSection = (si: number, patch: Partial<Section>) => edit(d.map((s, k) => (k === si ? { ...s, ...patch } : s)));
  const setItem = (si: number, ii: number, patch: Partial<Item>) =>
    setSection(si, { items: d[si].items.map((i, k) => (k === ii ? { ...i, ...patch } : i)) });

  async function onSave() {
    const warnings = draftWarnings(data, d!);
    const lines = [
      ...warnings.map((w) => `• ${w}`),
      warnings.length ? "" : null,
      "تصل المعايير الجديدة إلى هواتف المقيّمين في المزامنة التالية خلال ثوانٍ.",
      "الأيام التي اعتُمدت بالمعايير الحالية تُقبل حتى لو وصلت بعد الحفظ، وتُحفظ بالمعايير التي قُيّمت بها. أما يومٌ لم يُعتمد بعد فيُكمَل بالمعايير الجديدة.",
    ].filter((x): x is string => x !== null);
    if (await confirmAction(lines.join("\n"), "حفظ المعايير")) save.mutate(d!);
  }

  return (
    <div className="stack">
      <PageHeader
        title="مركز المعايير"
        subtitle="المعايير التي يقيّم بها المقيّمون، وبنود كل معيار ودرجته القصوى. مجموع اليوم هو مجموع الدرجات القصوى للمعايير الفعّالة."
        actions={
          <>
            <button className="btn" onClick={() => edit([...d, { key: key(), labelAr: "", labelEn: null, maxScore: 1, active: true, items: [] }])}>
              إضافة معيار
            </button>
            <button className="btn" disabled={!dirty || save.isPending} onClick={() => edit(base)}>
              تراجع عن التغييرات
            </button>
            <button className="btn btn-primary" disabled={!dirty || problems.length > 0 || save.isPending} onClick={onSave}>
              {save.isPending ? "جارٍ الحفظ…" : "حفظ"}
            </button>
          </>
        }
      />

      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span>
          مجموع اليوم: <b className="tabular" style={{ fontSize: 20 }}>{fmt(total)}</b>
          {total !== savedTotal && <span className="muted tabular"> (المحفوظ {fmt(savedTotal)})</span>}
          <span className="muted"> · {d.filter((s) => s.active).length} معايير فعّالة</span>
        </span>
        {dirty ? <span className="badge badge-warn">تغييرات غير محفوظة</span> : <span className="badge">محفوظ</span>}
      </div>

      {done && <Notice kind="ok">{done}</Notice>}
      {save.error && <Notice kind="err">{errorText(save.error)}</Notice>}
      {problems.some((p) => p.section === undefined) && <Notice kind="err">{problems.find((p) => p.section === undefined)!.message}</Notice>}

      {d.map((s, si) => (
        <SectionCard
          key={s.key}
          s={s}
          si={si}
          count={(s.id && data.gradesBySection[s.id]) || 0}
          itemCounts={data.gradesByItem}
          problems={problemsAt}
          last={si === d.length - 1}
          onSection={(patch) => setSection(si, patch)}
          onItem={(ii, patch) => setItem(si, ii, patch)}
          onMove={(to) => edit(move(d, si, to))}
          onRemove={() => edit(d.filter((_, k) => k !== si))}
          onItems={(items) => setSection(si, { items })}
        />
      ))}
    </div>
  );
}

function Problems({ list }: { list: DraftProblem[] }) {
  if (list.length === 0) return null;
  return (
    <span className="field-error" role="alert">
      {list.map((p) => p.message).join(" · ")}
    </span>
  );
}

function SectionCard({
  s,
  si,
  count,
  itemCounts,
  problems,
  last,
  onSection,
  onItem,
  onMove,
  onRemove,
  onItems,
}: {
  s: Section;
  si: number;
  count: number;
  itemCounts: Record<string, number>;
  problems: (si: number, ii?: number) => DraftProblem[];
  last: boolean;
  onSection: (patch: Partial<Section>) => void;
  onItem: (ii: number, patch: Partial<Item>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onItems: (items: Item[]) => void;
}) {
  const active = s.items.filter((i) => i.active);
  const sum = itemsSum(s);
  const off = !s.active;
  return (
    <section className="card stack" style={{ gap: 10, opacity: off ? 0.65 : 1 }} aria-label={s.labelAr || "معيار جديد"}>
      <div className="row">
        <span className="badge tabular">{si + 1}</span>
        <input className="input" style={{ flex: "2 1 200px" }} aria-label="اسم المعيار" placeholder="اسم المعيار" value={s.labelAr} onChange={(e) => onSection({ labelAr: e.target.value })} />
        <input className="input" style={{ flex: "1 1 140px" }} dir="ltr" aria-label="الاسم بالإنجليزية" placeholder="English name" value={s.labelEn ?? ""} onChange={(e) => onSection({ labelEn: e.target.value || null })} />
        <span className="muted">من</span>
        <MaxInput value={s.maxScore} label="الدرجة القصوى للمعيار" onChange={(n) => onSection({ maxScore: n })} />
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={s.active} onChange={(e) => onSection({ active: e.target.checked })} />
          فعّال
        </label>
        <button className="btn btn-ghost btn-sm" aria-label="تحريك للأعلى" disabled={si === 0} onClick={() => onMove(si - 1)}>↑</button>
        <button className="btn btn-ghost btn-sm" aria-label="تحريك للأسفل" disabled={last} onClick={() => onMove(si + 1)}>↓</button>
        {!s.id && <button className="btn btn-ghost btn-sm" onClick={onRemove}>إزالة</button>}
        {count > 0 && <span className="badge tabular" title="درجات مسجّلة على هذا المعيار">{count} درجة مسجّلة</span>}
        {off && <span className="badge badge-warn">معطّل</span>}
      </div>
      <Problems list={problems(si)} />

      {s.items.length > 0 ? (
        <table className="list">
          <thead>
            <tr>
              <th>البند</th>
              <th>بالإنجليزية</th>
              <th>النوع</th>
              <th>الدرجة القصوى</th>
              <th>فعّال</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i, ii) => {
              const n = (i.id && itemCounts[i.id]) || 0;
              const ps = problems(si, ii);
              return (
                <tr key={i.key} style={{ opacity: i.active ? 1 : 0.6 }}>
                  <td>
                    <input className="input" style={{ minWidth: 180 }} aria-label="اسم البند" placeholder="اسم البند" value={i.labelAr} onChange={(e) => onItem(ii, { labelAr: e.target.value })} />
                    <Problems list={ps} />
                  </td>
                  <td>
                    <input className="input" dir="ltr" style={{ minWidth: 130 }} aria-label="اسم البند بالإنجليزية" value={i.labelEn ?? ""} onChange={(e) => onItem(ii, { labelEn: e.target.value || null })} />
                  </td>
                  <td>
                    <select className="input" aria-label="نوع البند" value={i.kind} onChange={(e) => onItem(ii, { kind: e.target.value as ItemKind })}>
                      <option value="number">درجة (رقم)</option>
                      <option value="check">اختيار (✓ كل الدرجة أو صفر)</option>
                    </select>
                  </td>
                  <td>
                    <MaxInput value={i.maxScore} label="الدرجة القصوى للبند" onChange={(v) => onItem(ii, { maxScore: v })} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label="البند فعّال" checked={i.active} onChange={(e) => onItem(ii, { active: e.target.checked })} />
                  </td>
                  <td>
                    <span className="row" style={{ gap: 2, flexWrap: "nowrap" }}>
                      <button className="btn btn-ghost btn-sm" aria-label="تحريك البند للأعلى" disabled={ii === 0} onClick={() => onItems(move(s.items, ii, ii - 1))}>↑</button>
                      <button className="btn btn-ghost btn-sm" aria-label="تحريك البند للأسفل" disabled={ii === s.items.length - 1} onClick={() => onItems(move(s.items, ii, ii + 1))}>↓</button>
                      {!i.id && <button className="btn btn-ghost btn-sm" onClick={() => onItems(s.items.filter((_, k) => k !== ii))}>إزالة</button>}
                      {n > 0 && <span className="muted tabular" title="درجات مسجّلة على هذا البند">{n}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted" style={{ margin: 0 }}>بلا بنود: يُعطى هذا المعيار درجة واحدة مباشرة من {fmt(s.maxScore)}.</p>
      )}

      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn btn-sm" onClick={() => onItems([...s.items, { key: key(), labelAr: "", labelEn: null, maxScore: 0.25, kind: "check", active: true }])}>
          إضافة بند
        </button>
        {active.length > 0 && (
          <span className="tabular" style={{ color: sum === Math.round(s.maxScore * 100) / 100 ? "var(--green-700)" : "var(--red-700)", fontWeight: 600 }}>
            مجموع البنود {fmt(sum)} من {fmt(s.maxScore)}
          </span>
        )}
      </div>
    </section>
  );
}
