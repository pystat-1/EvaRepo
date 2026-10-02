"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  exportCourseStudentsAction,
  finishStudentImportAction,
  importStudentBatchAction,
} from "@/lib/actions/studentImport";
import type { ImportContext } from "@/lib/models/studentImport";
import { buildStudentTemplate, readStudentTemplate } from "@eva/core/students/excelTemplate";
import {
  groupKey,
  validateRows,
  type RowIssue,
  type StudentRow,
  type StudentRowInput,
} from "@/lib/studentImport/rows";

const BATCH = 40;
const SHIFT_AR = { MORNING: "صباحي", EVENING: "مسائي" } as const;

type Parsed = {
  fileName: string;
  rows: Array<StudentRowInput & { row: number }>;
  valid: StudentRow[];
  issues: RowIssue[];
};

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "preview"; parsed: Parsed }
  | { kind: "importing"; parsed: Parsed; done: number }
  | { kind: "done"; created: number; updated: number; issues: RowIssue[]; samplesRemoved: number; deactivated: number }
  | { kind: "error"; message: string };

async function loadExcel() {
  const mod = await import("exceljs");
  return (mod as unknown as { default?: typeof mod }).default ?? mod;
}

function download(buffer: Uint8Array, name: string) {
  const blob = new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Template building/reading is shared with the desktop app
// (@eva/core/students/excelTemplate).
const templateContext = (ctx: ImportContext) => ({
  courseLabel: ctx.course?.label ?? "الدورة",
  studyTypeName: ctx.studyType?.name ?? "—",
  groups: ctx.groups.map((g) => ({ shift: g.shift, number: g.number, name: g.name })),
});

export function ExcelStudentImport({ ctx }: { ctx: ImportContext }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [removeSamples, setRemoveSamples] = useState(ctx.sampleCount > 0);
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const groupKeys = new Set(ctx.groups.map((g) => groupKey(g.shift, g.number)));

  if (!ctx.course) {
    return (
      <div className="card">
        <h2 className="font-semibold mb-1">استيراد الطلاب من Excel</h2>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          لا توجد دورة منشورة بعد — أنشئ الدورة ومجموعاتها أولًا من «إعداد الدورة».
        </p>
      </div>
    );
  }
  const courseId = ctx.course.id;

  async function downloadTemplate(withStudents: boolean) {
    setBusy(withStudents ? "list" : "template");
    try {
      const data = withStudents ? await exportCourseStudentsAction(courseId) : [];
      const buf = await buildStudentTemplate(await loadExcel(), templateContext(ctx), data);
      download(buf, withStudents ? "قائمة-الطلاب.xlsx" : "قالب-الطلاب.xlsx");
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "تعذّر إنشاء الملف" });
    } finally {
      setBusy(null);
    }
  }

  async function readFile(file: File) {
    setPhase({ kind: "reading" });
    try {
      const read = await readStudentTemplate(await loadExcel(), await file.arrayBuffer());
      if ("error" in read) throw new Error(read.error);
      const rows = read.rows;
      const { valid, issues } = validateRows(rows, groupKeys);
      setPhase({ kind: "preview", parsed: { fileName: file.name, rows, valid, issues } });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : "تعذّرت قراءة الملف" });
    }
  }

  async function runImport(parsed: Parsed) {
    // Only rows that passed the check are sent; the server checks them again.
    const badRows = new Set(parsed.issues.map((i) => i.row));
    const toSend = parsed.rows.filter((r) => !badRows.has(r.row));
    let created = 0,
      updated = 0;
    const issues: RowIssue[] = [...parsed.issues];
    setPhase({ kind: "importing", parsed, done: 0 });
    // Remove the sample students first, so the real students' codes start
    // at 0001 instead of continuing after the samples'.
    let samplesRemoved = 0;
    if (removeSamples) {
      const pre = await finishStudentImportAction(courseId, {
        removeSamples: true,
        deactivateMissing: false,
        universityNumbers: parsed.valid.map((v) => v.universityNumber),
      });
      if (pre.error) {
        setPhase({ kind: "error", message: pre.error });
        return;
      }
      samplesRemoved = pre.samplesRemoved;
    }
    for (let i = 0; i < toSend.length; i += BATCH) {
      const res = await importStudentBatchAction(courseId, toSend.slice(i, i + BATCH));
      if (res.error) {
        setPhase({ kind: "error", message: `توقف الاستيراد بعد ${i} طالب: ${res.error}` });
        return;
      }
      created += res.created;
      updated += res.updated;
      issues.push(...res.issues);
      setPhase({ kind: "importing", parsed, done: Math.min(i + BATCH, toSend.length) });
    }
    const fin = await finishStudentImportAction(courseId, {
      removeSamples: false,
      deactivateMissing,
      universityNumbers: parsed.valid.map((v) => v.universityNumber),
    });
    if (fin.error) {
      setPhase({ kind: "error", message: fin.error });
      return;
    }
    setPhase({ kind: "done", created, updated, issues, samplesRemoved, deactivated: fin.deactivated });
    router.refresh();
  }

  const counts = (valid: StudentRow[]) =>
    ctx.groups.map((g) => ({
      g,
      n: valid.filter((v) => v.shift === g.shift && v.groupNumber === g.number).length,
    }));

  return (
    <div className="card flex flex-col gap-4">
      <div>
        <h2 className="font-semibold">قاعدة بيانات الطلاب — استيراد من Excel</h2>
        <p className="text-sm mt-1" style={{ color: "var(--ink-muted)" }}>
          الدورة: {ctx.course.label} · نوع الدراسة: {ctx.studyType?.name ?? "—"} · الطلاب الحاليون: {ctx.studentCount}
          {ctx.sampleCount > 0 ? ` (منهم ${ctx.sampleCount} طالب تجريبي)` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => downloadTemplate(false)} disabled={!!busy}>
          {busy === "template" ? "جارٍ التحضير…" : "تنزيل قالب Excel فارغ"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => downloadTemplate(true)} disabled={!!busy}>
          {busy === "list" ? "جارٍ التحضير…" : "تنزيل قائمة الطلاب الحالية"}
        </button>
      </div>

      <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
        المجموعات:{" "}
        {ctx.groups.map((g) => `${SHIFT_AR[g.shift]} ${g.number} (${g.studentCount})`).join(" · ") || "لا توجد مجموعات"}
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        ملف الطلاب (.xlsx)
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="input"
          disabled={phase.kind === "importing" || phase.kind === "reading"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {phase.kind === "reading" && <p className="text-sm">جارٍ قراءة الملف…</p>}

      {phase.kind === "error" && (
        <p role="alert" className="text-sm rounded-md px-3 py-2" style={{ color: "var(--red-700)", background: "var(--red-100)" }}>
          {phase.message}
        </p>
      )}

      {(phase.kind === "preview" || phase.kind === "importing") && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <b>{phase.parsed.fileName}</b>: {phase.parsed.rows.length} صف — صالح للاستيراد:{" "}
            <b style={{ color: "var(--green-700)" }}>{phase.parsed.valid.length}</b>
            {phase.parsed.issues.length > 0 && (
              <>
                {" "}
                · فيه أخطاء: <b style={{ color: "var(--red-700)" }}>{phase.parsed.issues.length}</b> (لن يُستورد)
              </>
            )}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {counts(phase.parsed.valid).map(({ g, n }) => (
              <span key={g.id} className="badge badge-gray">
                {SHIFT_AR[g.shift]} {g.number}: {n}
              </span>
            ))}
          </div>
          {phase.parsed.issues.length > 0 && (
            <ul className="text-xs max-h-40 overflow-auto rounded-md px-3 py-2" style={{ background: "var(--red-100)", color: "var(--red-700)" }}>
              {phase.parsed.issues.slice(0, 100).map((i) => (
                <li key={i.row}>
                  الصف {i.row}: {i.message}
                </li>
              ))}
            </ul>
          )}
          {ctx.sampleCount > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={removeSamples} onChange={(e) => setRemoveSamples(e.target.checked)} />
              حذف الطلاب التجريبيين ({ctx.sampleCount}) مع درجاتهم بعد الاستيراد
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deactivateMissing} onChange={(e) => setDeactivateMissing(e.target.checked)} />
            تعطيل طلاب الدورة غير الموجودين في هذا الملف (يصبح الملف هو قائمة الدورة)
          </label>
          {phase.kind === "importing" ? (
            <div className="flex flex-col gap-1" aria-live="polite">
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--paper-100)" }}>
                <div
                  className="h-full"
                  style={{ width: `${Math.round((phase.done / Math.max(1, phase.parsed.valid.length)) * 100)}%`, background: "var(--brand)" }}
                />
              </div>
              <span className="text-xs">
                جارٍ الاستيراد… {phase.done}/{phase.parsed.valid.length}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary self-start"
              disabled={phase.parsed.valid.length === 0}
              onClick={() => runImport(phase.parsed)}
            >
              استيراد {phase.parsed.valid.length} طالب
            </button>
          )}
        </div>
      )}

      {phase.kind === "done" && (
        <div className="text-sm rounded-md px-3 py-2" role="status" style={{ color: "var(--green-700)", background: "var(--green-100)" }}>
          تم الاستيراد: {phase.created} طالب جديد، {phase.updated} محدَّث
          {phase.samplesRemoved ? `، حُذف ${phase.samplesRemoved} طالب تجريبي` : ""}
          {phase.deactivated ? `، عُطّل ${phase.deactivated} طالب غير موجود في الملف` : ""}.
          {phase.issues.length > 0 && ` لم يُستورد ${phase.issues.length} صف بسبب أخطاء.`}
        </div>
      )}
    </div>
  );
}
