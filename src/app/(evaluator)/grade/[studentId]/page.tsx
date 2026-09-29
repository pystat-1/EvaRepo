"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { gradeStudentAction } from "@/lib/actions/grading";
import { queueOutboxEntry } from "@/lib/offline/db";
import { loadOfflineGradeData, GradeViewData, GradeViewResult } from "@/lib/offline/gradeData";
import type { Attendance } from "@/lib/models/evaluations";

type LoadStatus = "loading" | "ready" | "error";
type SaveStatus = "idle" | "saving" | "saved-online" | "saved-offline" | "error";

// Phase 4c: this used to be a Server Component that fetched everything
// (session, student, rubric, existing evaluation) with Prisma at render
// time — which simply fails to render at all with no network. It's now a
// Client Component: try /api/grade/[studentId] first, and only fall back to
// the Phase 4b IndexedDB cache on an actual fetch failure (not just
// `navigator.onLine`, which can be wrong — e.g. wifi with no upstream), per
// the plan. Same for saving: try the real server action first, and only
// queue to the local outbox if that also fails to reach the network.
export default function GradeStudentPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const router = useRouter();

  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [source, setSource] = useState<"online" | "offline">("online");
  const [data, setData] = useState<GradeViewResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (!offline) {
        try {
          const res = await fetch(`/api/grade/${studentId}`, { cache: "no-store" });
          if (res.status === 401) {
            router.replace("/login");
            return;
          }
          const body = await res.json();
          if (res.status === 404) {
            if (!cancelled) {
              setData({ ok: false, reason: "not_found" });
              setSource("online");
              setLoadStatus("ready");
            }
            return;
          }
          if (!cancelled) {
            setData(body as GradeViewResult);
            setSource("online");
            setLoadStatus("ready");
          }
          return;
        } catch {
          // Real network failure (thrown by fetch itself, not an HTTP error
          // status) — fall through to the offline cache below.
        }
      }

      try {
        const offlineData = await loadOfflineGradeData(studentId);
        if (!cancelled) {
          setData(offlineData);
          setSource("offline");
          setLoadStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setLoadError("تعذّر تحميل بيانات هذا الطالب دون اتصال — يرجى استيراد الجدول أولًا عند توفر الاتصال.");
          setLoadStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [studentId, router]);

  if (loadStatus === "loading") {
    return <p className="text-sm text-slate-500">جارِ التحميل...</p>;
  }

  if (loadStatus === "error") {
    return (
      <div className="card border-amber-200 bg-amber-50">
        <p className="text-sm text-amber-800">{loadError}</p>
      </div>
    );
  }

  if (!data || !data.ok) {
    const reason = data?.reason;
    if (reason === "not_found") {
      return (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">هذا الطالب غير موجود.</p>
        </div>
      );
    }
    if (reason === "not_scheduled") {
      return (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">اليوم ليس يوم حضور مجدول لمجموعة هذا الطالب حسب جدول الدوران.</p>
        </div>
      );
    }
    if (reason === "not_covered") {
      return (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">
            مجموعة هذا الطالب اليوم في &quot;{data?.hospitalName}&quot; وأنت غير مخصص لهذا المستشفى/هذه المجموعة هناك.
          </p>
        </div>
      );
    }
    return (
      <div className="card border-red-200 bg-red-50">
        <p className="text-sm text-red-700">هذا الطالب خارج نطاقك المخصص.</p>
      </div>
    );
  }

  return <GradeForm studentId={studentId} data={data} source={source} />;
}

const ATTENDANCE_OPTIONS: Array<{ value: Attendance; label: string; color: string }> = [
  { value: "present", label: "حاضر", color: "var(--green-700)" },
  { value: "late", label: "متأخر", color: "var(--amber-700)" },
  { value: "absent", label: "غائب", color: "var(--red-700)" },
];

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function clampNumber(raw: string, max: number): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100) / 100, max);
}

type Section = GradeViewData["sections"][number];

function initialDailyNote(data: GradeViewData): boolean | null {
  const { existing, record } = data;
  if (existing) {
    if (existing.dailyNote !== undefined) return existing.dailyNote;
    return existing.dailyNoteSubmitted ? true : null;
  }
  return record?.dailyNote ?? null;
}

function GradeForm({
  studentId,
  data,
  source,
}: {
  studentId: string;
  data: GradeViewData;
  source: "online" | "offline";
}) {
  const { student, dateISO, hospitalName, sections, maxTotal, existing, record } = data;

  const [attendance, setAttendance] = useState<Attendance>(existing?.attendance ?? record?.attendance ?? "present");
  const [dailyNote, setDailyNote] = useState<boolean | null>(() => initialDailyNote(data));
  // Number fields are kept as the typed text so "3." or "" stay editable;
  // check items are stored as "0" or their max.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const section of sections) {
      if (section.items.length > 0) {
        for (const item of section.items) {
          const v = existing?.itemScores?.[item.id];
          init[item.id] = v === undefined ? (item.kind === "check" ? "0" : "") : String(v);
        }
      } else {
        const v = existing?.scores[section.id];
        init[section.id] = v === undefined ? "" : String(v);
      }
    }
    return init;
  });
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [feedback, setFeedback] = useState(existing?.feedback ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const absent = attendance === "absent";
  const backHref = data.groupId ? `/attendance?group=${data.groupId}` : "/attendance";

  function sectionTotal(section: Section): number {
    if (absent) return 0;
    if (section.items.length === 0) return clampNumber(values[section.id] ?? "", section.maxScore);
    const sum = section.items.reduce((t, item) => t + clampNumber(values[item.id] ?? "", item.maxScore), 0);
    return Math.min(sum, section.maxScore);
  }
  const total = sections.reduce((t, s) => t + sectionTotal(s), 0);

  function setValue(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }));
    setSaveStatus("idle");
  }

  function collect() {
    const scores: Record<string, number> = {};
    const itemScores: Record<string, number> = {};
    for (const section of sections) {
      if (section.items.length > 0) {
        for (const item of section.items) {
          itemScores[item.id] = absent ? 0 : clampNumber(values[item.id] ?? "", item.maxScore);
        }
      } else {
        scores[section.id] = absent ? 0 : clampNumber(values[section.id] ?? "", section.maxScore);
      }
    }
    return { scores, itemScores };
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaveStatus("saving");
    setSaveError(null);
    const { scores, itemScores } = collect();
    const note = absent ? null : dailyNote;

    const canTryOnline = source === "online" && (typeof navigator === "undefined" || navigator.onLine !== false);
    if (canTryOnline) {
      const formData = new FormData();
      formData.set("studentId", studentId);
      formData.set("dateISO", dateISO);
      formData.set("attendance", attendance);
      formData.set("notes", notes);
      formData.set("feedback", feedback);
      formData.set("dailyNote", note === null ? "" : note ? "1" : "0");
      if (note === true) formData.set("dailyNoteSubmitted", "1");
      for (const [id, v] of Object.entries(scores)) formData.set(`score_${id}`, String(v));
      for (const [id, v] of Object.entries(itemScores)) formData.set(`item_${id}`, String(v));
      try {
        await gradeStudentAction(formData);
        setSaveStatus("saved-online");
        return;
      } catch (err) {
        // A dropped connection surfaces here as a fetch TypeError (Server
        // Actions are invoked over fetch) — that's the "actually offline"
        // signal we queue locally on. Any other thrown error is a real
        // validation/authorization failure and should be shown, not hidden
        // behind a silent local save.
        const isNetworkFailure =
          err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
        if (!isNetworkFailure) {
          setSaveStatus("error");
          setSaveError(err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الحفظ");
          return;
        }
      }
    }

    try {
      await queueOutboxEntry({
        studentId,
        dateISO,
        attendance,
        notes: notes.trim() || undefined,
        feedback: feedback.trim() || undefined,
        dailyNoteSubmitted: note === true,
        dailyNote: note,
        scores,
        itemScores,
        queuedAt: new Date().toISOString(),
      });
      setSaveStatus("saved-offline");
    } catch {
      setSaveStatus("error");
      setSaveError("تعذّر الحفظ محليًا أيضًا — تأكد من أن المتصفح يدعم التخزين المحلي (وضع التصفح الخاص قد يمنعه).");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {source === "offline" && (
        <div className="card border-amber-200 bg-amber-50 py-2">
          <p className="text-xs text-amber-800">
            أنت غير متصل بالإنترنت — يتم العرض من آخر بيانات مستوردة، وسيُحفظ التقييم محليًا حتى يعود الاتصال.
          </p>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">
            {student.nameAr}
            {student.nameEn ? ` (${student.nameEn})` : ""}
          </h1>
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {student.universityNumber} — تقييم يوم {dateISO} في {hospitalName}
            {existing ? " (تعديل تقييم محفوظ مسبقًا)" : ""}
          </p>
        </div>
        <Link href={backHref} className="btn btn-secondary text-xs px-2.5 py-1 shrink-0">
          القائمة
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="card">
          <div className="text-sm font-medium mb-2">الحضور</div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="الحضور">
            {ATTENDANCE_OPTIONS.map((opt) => {
              const on = attendance === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setAttendance(opt.value);
                    setSaveStatus("idle");
                  }}
                  className="rounded-lg border py-2.5 text-sm font-semibold"
                  style={
                    on
                      ? { background: opt.color, borderColor: opt.color, color: "#fff" }
                      : { borderColor: "var(--border-strong)", color: "var(--ink)" }
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {absent && (
            <p className="text-xs mt-2" style={{ color: "var(--red-700)" }}>
              الطالب غائب — تُحفظ جميع الدرجات صفرًا.
            </p>
          )}
        </div>

        {sections.map((section, idx) => (
          <fieldset
            key={section.id}
            className="card flex flex-col gap-3"
            disabled={absent}
            style={absent ? { opacity: 0.55 } : undefined}
          >
            <legend className="sr-only">{section.labelAr}</legend>
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-sm">{section.labelAr}</div>
              <div className="text-sm tabular-nums">
                <span className="font-bold" style={{ color: "var(--brand)" }}>
                  {fmt(sectionTotal(section))}
                </span>
                <span style={{ color: "var(--ink-muted)" }}> / {fmt(section.maxScore)}</span>
              </div>
            </div>

            {idx === 0 && (
              <DailyNoteToggle
                value={absent ? null : dailyNote}
                onChange={(v) => {
                  setDailyNote(v);
                  setSaveStatus("idle");
                }}
              />
            )}

            {section.items.length === 0 ? (
              <NumberField
                id={section.id}
                label={section.labelAr}
                max={section.maxScore}
                value={values[section.id] ?? ""}
                onChange={(v) => setValue(section.id, v)}
              />
            ) : (
              <div
                className={
                  section.items.every((i) => i.kind === "check") ? "grid grid-cols-2 gap-2" : "flex flex-col gap-3"
                }
              >
                {section.items.map((item) =>
                  item.kind === "check" ? (
                    <label
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 cursor-pointer select-none"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="w-5 h-5"
                          checked={Number(values[item.id]) === item.maxScore}
                          onChange={(e) => setValue(item.id, e.target.checked ? String(item.maxScore) : "0")}
                        />
                        {item.labelAr}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>
                        {item.maxScore}
                      </span>
                    </label>
                  ) : (
                    <NumberField
                      key={item.id}
                      id={item.id}
                      label={item.labelAr}
                      max={item.maxScore}
                      value={values[item.id] ?? ""}
                      onChange={(v) => setValue(item.id, v)}
                    />
                  )
                )}
              </div>
            )}
          </fieldset>
        ))}

        <div className="card flex items-center justify-between">
          <span className="font-semibold">المجموع الكلي</span>
          <span className="text-xl tabular-nums">
            <span className="font-bold" style={{ color: "var(--brand-dark)" }}>
              {fmt(total)}
            </span>
            <span className="text-base" style={{ color: "var(--ink-muted)" }}>
              {" "}
              / {fmt(maxTotal)}
            </span>
          </span>
        </div>

        <div className="card flex flex-col gap-3">
          <div>
            <label htmlFor="notes" className="block text-sm font-medium mb-1">
              ملاحظات
            </label>
            <textarea id="notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label htmlFor="feedback" className="block text-sm font-medium mb-1">
              التغذية الراجعة للطالب
            </label>
            <textarea
              id="feedback"
              rows={2}
              className="input"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={saveStatus === "saving"}>
          {saveStatus === "saving" ? "جارِ الحفظ..." : "حفظ التقييم"}
        </button>
        {saveStatus === "saved-online" && (
          <p className="text-sm" style={{ color: "var(--green-700)" }}>
            تم حفظ التقييم بنجاح.{" "}
            <Link href={backHref} className="underline font-semibold">
              العودة إلى قائمة الحضور والتقييم
            </Link>
          </p>
        )}
        {saveStatus === "saved-offline" && <p className="text-xs text-amber-700">محفوظ محليًا — سيُزامن عند الاتصال.</p>}
        {saveStatus === "error" && <p className="text-xs text-red-700">{saveError}</p>}
      </form>
    </div>
  );
}

function NumberField({
  id,
  label,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  max: number;
  value: string;
  onChange: (v: string) => void;
}) {
  const n = Number(value);
  const invalid = value.trim() !== "" && (!Number.isFinite(n) || n < 0 || n > max);
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={`f_${id}`} className="text-sm flex-1">
        {label} <span style={{ color: "var(--ink-muted)" }}>(من {max})</span>
      </label>
      <input
        id={`f_${id}`}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step="0.01"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className="input w-24 text-center tabular-nums"
        style={invalid ? { borderColor: "var(--red-700)" } : undefined}
      />
    </div>
  );
}

function DailyNoteToggle({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  const pill = (on: boolean, color: string) =>
    on ? { background: color, borderColor: color, color: "#fff" } : { borderColor: color, color, background: "#fff" };
  return (
    <div
      className="flex items-center justify-between flex-wrap gap-2 rounded-lg px-3 py-2.5"
      style={{ background: "var(--brand-tint)" }}
    >
      <div>
        <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
          تسليم الملاحظة اليومية
        </div>
        <div
          className="text-sm font-bold"
          style={{
            color: value === true ? "var(--green-700)" : value === false ? "var(--red-700)" : "var(--ink-muted)",
          }}
        >
          {value === true ? "سلّم" : value === false ? "لم يسلّم" : "لم يُسجَّل بعد"}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(value === true ? null : true)}
          aria-pressed={value === true}
          className="rounded-full border px-3.5 py-1.5 text-sm font-semibold"
          style={pill(value === true, "var(--green-700)")}
        >
          سلّم
        </button>
        <button
          type="button"
          onClick={() => onChange(value === false ? null : false)}
          aria-pressed={value === false}
          className="rounded-full border px-3.5 py-1.5 text-sm font-semibold"
          style={pill(value === false, "var(--red-700)")}
        >
          لم يسلّم
        </button>
      </div>
    </div>
  );
}
