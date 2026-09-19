"use client";

import { useMemo, useState } from "react";
import type { Hospital } from "@/lib/models/hospitals";
import type { StudyType } from "@/lib/models/studyTypes";
import type { StudentWithRelations } from "@/lib/models/students";
import type { GroupWithRelations } from "@/lib/models/groups";
import type { EvaluatorWithAssignments } from "@/lib/models/evaluators";
import type { RotationBlockWithGroup } from "@/lib/models/rotationBlocks";
import type { TermSettings } from "@/lib/models/termSettings";
import { WEEKDAYS } from "@/lib/weekdays";

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };
const YN = (b: boolean) => (b ? "فعّال" : "معطّل");

export interface WorkbookData {
  term: TermSettings;
  hospitals: Hospital[];
  studyTypes: StudyType[];
  students: StudentWithRelations[];
  groups: GroupWithRelations[];
  evaluators: EvaluatorWithAssignments[];
  blocks: RotationBlockWithGroup[];
}

interface Sheet {
  key: string;
  label: string;
  icon: string;
  accent: string;
  columns: string[];
  rows: string[][];
  href?: string;
}

function weekdaysAr(codes: string | null): string {
  if (!codes) return "—";
  return codes
    .split(",")
    .filter(Boolean)
    .map((c) => WEEKDAYS.find((w) => w.code === c)?.labelAr ?? c)
    .join("، ");
}

function buildSheets(d: WorkbookData): Sheet[] {
  const term: Sheet = {
    key: "term",
    label: "الفصل الدراسي",
    icon: "🗓️",
    accent: "#0891b2",
    columns: ["العنصر", "القيمة"],
    rows: [
      ["عدد الأسابيع", d.term.weeksCount != null ? String(d.term.weeksCount) : "— غير محدّد —"],
      ["أيام في الأسبوع", d.term.daysPerWeek != null ? String(d.term.daysPerWeek) : "— غير محدّد —"],
      ["أيام الحضور", weekdaysAr(d.term.weekdays)],
      ["تاريخ البداية", d.term.startDate ?? "—"],
      ["عدد المستشفيات", String(d.hospitals.filter((h) => h.active).length)],
      ["عدد أنواع الدراسة", String(d.studyTypes.filter((s) => s.active).length)],
      ["عدد الطلاب", String(d.students.filter((s) => s.active).length)],
      ["عدد المجموعات", String(d.groups.filter((g) => g.active).length)],
      ["عدد المشرفين", String(d.evaluators.filter((e) => e.active).length)],
      ["فترات الدوران", String(d.blocks.length)],
    ],
  };

  const hospitals: Sheet = {
    key: "hospitals",
    label: "المستشفيات",
    icon: "🏥",
    accent: "#2a78d6",
    href: "/hospitals",
    columns: ["الاسم", "الاسم (عربي)", "العنوان", "الحالة"],
    rows: d.hospitals.map((h) => [h.name, h.nameAr ?? "—", h.address ?? "—", YN(h.active)]),
  };

  const studyTypes: Sheet = {
    key: "studyTypes",
    label: "أنواع الدراسة",
    icon: "🧪",
    accent: "#c98500",
    href: "/study-types",
    columns: ["الاسم", "الاسم (عربي)", "الرمز", "عدد الطلاب", "الحالة"],
    rows: d.studyTypes.map((st) => {
      const count = d.students.filter((s) => s.active && s.studyTypeName === st.name).length;
      return [st.name, st.nameAr ?? "—", st.code ?? "—", String(count), YN(st.active)];
    }),
  };

  const students: Sheet = {
    key: "students",
    label: "الطلاب",
    icon: "🎓",
    accent: "#1baf7a",
    href: "/students",
    columns: ["الرقم الجامعي", "الاسم", "نوع الدراسة", "المجموعة", "الدورة", "الحالة"],
    rows: d.students.map((s) => [
      s.universityNumber,
      s.nameAr,
      s.studyTypeName ?? "—",
      s.groupName ?? "—",
      s.courseLabel ?? "—",
      YN(s.active),
    ]),
  };

  const groups: Sheet = {
    key: "groups",
    label: "المجموعات",
    icon: "👥",
    accent: "#e87ba4",
    href: "/groups",
    columns: ["الاسم", "نوع الدراسة", "الوردية", "عدد الطلاب", "المستشفى الحالي", "الحالة"],
    rows: d.groups.map((g) => [
      g.name,
      g.studyTypeName ?? "—",
      g.shift ? SHIFT_LABEL[g.shift] : "—",
      String(g.studentCount),
      g.currentHospitalName ?? "—",
      YN(g.active),
    ]),
  };

  // Supervisors sheet is one row per active assignment (a supervisor with
  // several hospitals/groups appears once per pairing), plus a row for any
  // supervisor with no assignment yet — so every supervisor is visible.
  const supRows: string[][] = [];
  for (const e of d.evaluators) {
    const active = e.assignments.filter((a) => a.active);
    if (active.length === 0) {
      supRows.push([e.name, e.email, "— بدون تكليف —", "—", YN(e.active)]);
    } else {
      for (const a of active) {
        supRows.push([e.name, e.email, a.hospitalName, a.groupName ?? "كل المجموعات", YN(e.active)]);
      }
    }
  }
  const supervisors: Sheet = {
    key: "supervisors",
    label: "المشرفون",
    icon: "🩺",
    accent: "#4a3aa7",
    href: "/evaluators",
    columns: ["المشرف", "البريد", "المستشفى", "المجموعة", "الحالة"],
    rows: supRows,
  };

  const rotation: Sheet = {
    key: "rotation",
    label: "جدول الدوران",
    icon: "🔄",
    accent: "#dc2626",
    columns: ["المجموعة", "المستشفى", "من", "إلى", "أيام الحضور"],
    rows: d.blocks
      .slice()
      .sort((a, b) => (a.groupName + a.startDate).localeCompare(b.groupName + b.startDate))
      .map((b) => [b.groupName, b.hospitalName, b.startDate, b.endDate, weekdaysAr(b.daysOfWeek)]),
  };

  return [term, hospitals, studyTypes, students, groups, supervisors, rotation];
}

export default function MasterWorkbook({ data }: { data: WorkbookData }) {
  const sheets = useMemo(() => buildSheets(data), [data]);
  const [activeKey, setActiveKey] = useState(sheets[0].key);
  const [query, setQuery] = useState("");
  const sheet = sheets.find((s) => s.key === activeKey) ?? sheets[0];

  const q = query.trim().toLowerCase();
  const rows = q
    ? sheet.rows.filter((r) => r.some((c) => c.toLowerCase().includes(q)))
    : sheet.rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">الجدول الشامل</h1>
          <p className="text-slate-500 mt-1 text-sm">
            كل بيانات الإعداد في مصنّف واحد — تنقّل بين الأوراق أسفل الجدول كما في Excel.
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث في هذه الورقة…"
          className="input w-64"
        />
      </div>

      {/* Sheet surface */}
      <div
        className="rounded-lg border overflow-hidden shadow-sm"
        style={{ borderColor: "var(--border, #e2e8f0)", background: "#fff" }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 border-b text-sm font-semibold"
          style={{ borderColor: "var(--border, #e2e8f0)", color: sheet.accent }}
        >
          <span>{sheet.icon}</span>
          <span>{sheet.label}</span>
          <span className="text-slate-400 font-normal">
            ({rows.length}
            {q && rows.length !== sheet.rows.length ? ` من ${sheet.rows.length}` : ""} صف)
          </span>
          {sheet.href && (
            <a href={sheet.href} className="mr-auto text-xs text-slate-500 hover:underline font-normal">
              تحرير →
            </a>
          )}
        </div>

        <div className="overflow-auto max-h-[62vh]">
          <table className="w-full border-collapse text-sm" dir="rtl">
            <thead className="sticky top-0 z-10">
              <tr style={{ background: "#f8fafc" }}>
                <th className="border border-slate-200 px-2 py-1.5 text-slate-400 font-medium w-12 text-center">
                  #
                </th>
                {sheet.columns.map((c) => (
                  <th
                    key={c}
                    className="border border-slate-200 px-3 py-1.5 text-right font-semibold whitespace-nowrap"
                    style={{ background: "#f8fafc" }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={sheet.columns.length + 1}
                    className="border border-slate-200 px-3 py-8 text-center text-slate-400"
                  >
                    {q ? "لا نتائج مطابقة" : "لا توجد بيانات في هذه الورقة بعد"}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={i} className="hover:bg-blue-50/40" style={{ background: i % 2 ? "#fbfcfe" : "#fff" }}>
                    <td className="border border-slate-200 px-2 py-1.5 text-center text-slate-400 tabular-nums">
                      {i + 1}
                    </td>
                    {r.map((cell, j) => (
                      <td key={j} className="border border-slate-200 px-3 py-1.5 whitespace-nowrap">
                        {cell === "فعّال" ? (
                          <span className="badge badge-green">فعّال</span>
                        ) : cell === "معطّل" ? (
                          <span className="badge badge-gray">معطّل</span>
                        ) : (
                          cell
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Excel-style sheet tabs */}
        <div
          className="flex items-stretch gap-0.5 px-2 pt-1 border-t overflow-x-auto"
          style={{ borderColor: "var(--border, #e2e8f0)", background: "#f1f5f9" }}
        >
          {sheets.map((s) => {
            const isActive = s.key === activeKey;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  setActiveKey(s.key);
                  setQuery("");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm whitespace-nowrap rounded-t-md border border-b-0 transition"
                style={{
                  background: isActive ? "#fff" : "transparent",
                  borderColor: isActive ? "var(--border, #e2e8f0)" : "transparent",
                  color: isActive ? s.accent : "#475569",
                  fontWeight: isActive ? 600 : 400,
                  marginBottom: isActive ? "-1px" : 0,
                }}
              >
                <span>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
