"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { gradeStudentAction } from "@/lib/actions/grading";
import { queueOutboxEntry } from "@/lib/offline/db";
import { loadOfflineGradeData, GradeViewResult } from "@/lib/offline/gradeData";
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

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data || !data.ok) return;
    const formData = new FormData(e.currentTarget);
    setSaveStatus("saving");
    setSaveError(null);

    const canTryOnline = source === "online" && (typeof navigator === "undefined" || navigator.onLine !== false);
    if (canTryOnline) {
      try {
        formData.set("studentId", studentId);
        formData.set("dateISO", data.dateISO);
        await gradeStudentAction(formData);
        setSaveStatus("saved-online");
        return;
      } catch (err) {
        // A dropped connection surfaces here as a fetch TypeError (Server
        // Actions are invoked over fetch) — that's the "actually offline"
        // signal we queue locally on. Any other thrown error is a real
        // validation/authorization failure and should be shown, not hidden
        // behind a silent local save.
        const isNetworkFailure = err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
        if (!isNetworkFailure) {
          setSaveStatus("error");
          setSaveError(err instanceof Error ? err.message : "حدث خطأ غير متوقع أثناء الحفظ");
          return;
        }
      }
    }

    const sections = data.sections;
    const attendance = String(formData.get("attendance") ?? "present") as Attendance;
    const notes = String(formData.get("notes") ?? "").trim();
    const feedback = String(formData.get("feedback") ?? "").trim();
    const scores: Record<string, number> = {};
    for (const s of sections) {
      const raw = formData.get(`score_${s.id}`);
      scores[s.id] = raw === null || raw === "" ? 0 : Number(raw);
    }

    try {
      await queueOutboxEntry({
        studentId,
        dateISO: data.dateISO,
        attendance,
        notes: notes || undefined,
        feedback: feedback || undefined,
        scores,
        queuedAt: new Date().toISOString(),
      });
      setSaveStatus("saved-offline");
    } catch {
      setSaveStatus("error");
      setSaveError("تعذّر الحفظ محليًا أيضًا — تأكد من أن المتصفح يدعم التخزين المحلي (وضع التصفح الخاص قد يمنعه).");
    }
  }

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

  const { student, dateISO, hospitalName, sections, maxTotal, existing } = data;

  return (
    <div className="flex flex-col gap-4">
      {source === "offline" && (
        <div className="card border-amber-200 bg-amber-50 py-2">
          <p className="text-xs text-amber-800">
            أنت غير متصل بالإنترنت — يتم العرض من آخر بيانات مستوردة، وسيُحفظ التقييم محليًا حتى يعود الاتصال.
          </p>
        </div>
      )}
      <div>
        <h1 className="text-lg font-bold">
          {student.nameAr}
          {student.nameEn ? ` (${student.nameEn})` : ""}
        </h1>
        <p className="text-xs text-slate-500">
          {student.universityNumber} — تقييم يوم {dateISO} في {hospitalName}
          {existing ? " (تعديل تقييم محفوظ مسبقًا)" : ""}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="card">
          <label className="block text-sm font-medium mb-2">الحضور</label>
          <div className="flex gap-4 text-sm">
            {[
              { value: "present", label: "حاضر" },
              { value: "late", label: "متأخر" },
              { value: "absent", label: "غائب" },
            ].map((opt) => (
              <label key={opt.value} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="attendance"
                  value={opt.value}
                  defaultChecked={(existing?.attendance ?? "present") === opt.value}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="card flex flex-col gap-3">
          <div className="font-semibold text-sm">الدرجات (المجموع من {maxTotal})</div>
          {sections.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <label className="text-sm flex-1">
                {s.labelAr} <span className="text-slate-400">(من {s.maxScore})</span>
              </label>
              <input
                type="number"
                name={`score_${s.id}`}
                min={0}
                max={s.maxScore}
                step="0.5"
                required
                defaultValue={existing?.scores[s.id] ?? ""}
                className="input w-24"
              />
            </div>
          ))}
        </div>

        <div className="card flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" rows={2} className="input" defaultValue={existing?.notes ?? ""} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">التغذية الراجعة للطالب</label>
            <textarea name="feedback" rows={2} className="input" defaultValue={existing?.feedback ?? ""} />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={saveStatus === "saving"}>
          {saveStatus === "saving" ? "جارِ الحفظ..." : "حفظ التقييم"}
        </button>
        {saveStatus === "saved-online" && <p className="text-xs text-green-700">تم حفظ التقييم بنجاح.</p>}
        {saveStatus === "saved-offline" && (
          <p className="text-xs text-amber-700">محفوظ محليًا — سيُزامن عند الاتصال.</p>
        )}
        {saveStatus === "error" && <p className="text-xs text-red-700">{saveError}</p>}
      </form>
    </div>
  );
}
