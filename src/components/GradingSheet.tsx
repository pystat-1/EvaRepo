import type {
  GradingSheetData,
  SheetGroup,
  SheetColumn,
  SheetCell,
  SheetCriterion,
} from "@/lib/models/gradingSheet";

// Read-only gradebook matrix: study type → group → student rows, with
// hospital → week → day columns, each day cell listing the full per-criterion
// grades for that student on that day. Mirrors the paper grading sheet.

const ATTENDANCE: Record<string, { label: string; short: string; cls: string }> = {
  present: { label: "حاضر", short: "ح", cls: "badge-green" },
  late: { label: "متأخر", short: "ت", cls: "badge-amber" },
  absent: { label: "غائب", short: "غ", cls: "badge-red" },
};

// Group a flat column list into hospital → week spans so the header can carry
// the right colSpans across its three tiers (hospital / week / day).
function headerSpans(columns: SheetColumn[]) {
  const hospitals: { name: string; span: number; weeks: { label: string; span: number }[] }[] = [];
  for (const col of columns) {
    let h = hospitals[hospitals.length - 1];
    if (!h || h.name !== col.hospitalName) {
      h = { name: col.hospitalName, span: 0, weeks: [] };
      hospitals.push(h);
    }
    h.span += 1;
    let w = h.weeks[h.weeks.length - 1];
    const weekLabel = `الأسبوع ${col.weekIndex}`;
    if (!w || w.label !== weekLabel) {
      w = { label: weekLabel, span: 0 };
      h.weeks.push(w);
    }
    w.span += 1;
  }
  return hospitals;
}

function CellBody({ cell, criteria }: { cell: SheetCell | null; criteria: SheetCriterion[] }) {
  if (!cell) return <span className="text-slate-300">—</span>;
  const att = ATTENDANCE[cell.attendance];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-1">
        <span className={`badge ${att.cls} !px-1.5 !py-0 text-[10px]`}>{att.label}</span>
        <span className="flex items-center gap-1">
          <span
            title={cell.dailyNoteSubmitted ? "سلّم الملاحظة اليومية" : "لم يسلّم الملاحظة اليومية"}
            className={cell.dailyNoteSubmitted ? "text-[10px]" : "text-[10px] opacity-30 grayscale"}
          >
            📝
          </span>
          <span className="font-bold text-[11px] tabular-nums">{cell.total}</span>
        </span>
      </div>
      {cell.attendance !== "absent" && (
        <div className="flex flex-col gap-0.5">
          {criteria.map((c, i) => (
            <div key={c.id} className="flex items-center justify-between gap-1 text-[10px] leading-tight">
              <span className="text-slate-500 truncate" title={c.labelAr}>
                {c.labelAr}
              </span>
              <span className="tabular-nums text-slate-700 shrink-0">
                {cell.scores[i] ?? "—"}
                <span className="text-slate-300">/{c.maxScore}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupTable({ group, criteria }: { group: SheetGroup; criteria: SheetCriterion[] }) {
  const hospitals = headerSpans(group.columns);
  const hasColumns = group.columns.length > 0;

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border, #e2e8f0)" }}>
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2 border-b text-sm"
        style={{ borderColor: "var(--border, #e2e8f0)", background: "#f8fafc" }}
      >
        <span className="font-semibold">{group.name}</span>
        {group.courseLabel && <span className="badge badge-gray">{group.courseLabel}</span>}
        {group.shiftLabel && <span className="badge badge-gray">{group.shiftLabel}</span>}
        <span className="text-xs text-slate-400 mr-auto">{group.students.length} طالب</span>
      </div>

      {!hasColumns ? (
        <p className="text-center text-slate-400 py-5 text-sm">لا يوجد جدول دوران لهذه المجموعة بعد</p>
      ) : (
        <div className="overflow-auto max-h-[70vh]">
          <table className="border-collapse text-xs" dir="rtl">
            <thead className="sticky top-0 z-20">
              {/* Tier 1 — hospital */}
              <tr>
                <th
                  rowSpan={3}
                  className="sticky right-0 z-30 border border-slate-200 px-2 py-1.5 text-right font-semibold min-w-[150px]"
                  style={{ background: "#eef2f7" }}
                >
                  الطالب
                </th>
                {hospitals.map((h, i) => (
                  <th
                    key={i}
                    colSpan={h.span}
                    className="border border-slate-200 px-2 py-1 text-center font-bold"
                    style={{ background: "#e8eef6" }}
                  >
                    {h.name}
                  </th>
                ))}
              </tr>
              {/* Tier 2 — week */}
              <tr>
                {hospitals.flatMap((h, hi) =>
                  h.weeks.map((w, wi) => (
                    <th
                      key={`${hi}-${wi}`}
                      colSpan={w.span}
                      className="border border-slate-200 px-2 py-1 text-center font-semibold"
                      style={{ background: "#f1f5f9" }}
                    >
                      {w.label}
                    </th>
                  ))
                )}
              </tr>
              {/* Tier 3 — day */}
              <tr>
                {group.columns.map((col) => (
                  <th
                    key={col.key}
                    className="border border-slate-200 px-2 py-1 text-center font-medium min-w-[132px] whitespace-nowrap"
                    style={{ background: "#f8fafc" }}
                  >
                    <div>اليوم {col.dayIndex}</div>
                    <div className="text-[9px] text-slate-400 tabular-nums">{col.dateISO}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.students.length === 0 ? (
                <tr>
                  <td colSpan={group.columns.length + 1} className="border border-slate-200 px-3 py-6 text-center text-slate-400">
                    لا يوجد طلاب في هذه المجموعة
                  </td>
                </tr>
              ) : (
                group.students.map((s, ri) => (
                  <tr key={s.id} style={{ background: ri % 2 ? "#fbfcfe" : "#fff" }}>
                    <td
                      className="sticky right-0 z-10 border border-slate-200 px-2 py-1.5 align-top"
                      style={{ background: ri % 2 ? "#fbfcfe" : "#fff" }}
                    >
                      <div className="font-medium leading-tight">{s.name}</div>
                      <div className="text-[10px] text-slate-400 tabular-nums">{s.universityNumber}</div>
                    </td>
                    {s.cells.map((cell, ci) => (
                      <td key={ci} className="border border-slate-200 px-1.5 py-1 align-top">
                        <CellBody cell={cell} criteria={criteria} />
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GradingSheet({ data }: { data: GradingSheetData }) {
  const { studyTypes, criteria, maxTotal } = data;

  if (studyTypes.length === 0) {
    return (
      <div className="card text-center text-slate-400 py-10">
        لا توجد بيانات مطابقة — تأكّد من إعداد المجموعات وأنواع الدراسة وجدول الدوران.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>الدرجة الكلّية من {maxTotal} · المعايير:</span>
        {criteria.map((c) => (
          <span key={c.id} className="badge badge-gray">
            {c.labelAr} /{c.maxScore}
          </span>
        ))}
        <span className="mr-auto flex items-center gap-2">
          <span title="الملاحظة اليومية">📝 = سلّم الملاحظة اليومية</span>
          {Object.values(ATTENDANCE).map((a) => (
            <span key={a.label} className={`badge ${a.cls} !py-0`}>
              {a.label}
            </span>
          ))}
        </span>
      </div>

      {studyTypes.map((st) => (
        <section key={st.name} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧪</span>
            <h2 className="text-lg font-bold">{st.name}</h2>
            <span className="text-xs text-slate-400">({st.groups.length} مجموعة)</span>
          </div>
          <div className="flex flex-col gap-4">
            {st.groups.map((g) => (
              <GroupTable key={g.id} group={g} criteria={criteria} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
