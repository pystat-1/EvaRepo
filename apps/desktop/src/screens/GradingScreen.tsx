import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { courseOverview, listCourses, listHospitals } from "@eva/db/repo/courses";
import { countEvaluations, groupGradeSheet, listEvaluations, rubric, type EvaluationRow, type EvaluationFilter } from "@eva/db/repo/grading";
import { listEvaluators } from "@eva/db/repo/evaluators";
import { currentCourse } from "@eva/db/repo/students";
import { DataTable } from "../components/DataTable";
import { ATTENDANCE_AR, Empty, Notice, PageHeader, fmt2 } from "../components/ui";
import { errorText, r } from "../lib/repo";
import { loadExcel, saveFile } from "../lib/files";
import { SubCriteriaHost, showSubCriteria } from "../components/SubCriteria";

const PAGE = 1500; // grades shown when the screen opens (newest first)

export function GradingScreen() {
  const [view, setView] = useState<"list" | "sheet">("list");
  const [f, setF] = useState({ courseId: "", groupId: "", hospitalId: "", evaluatorId: "", from: "", to: "", search: "" });
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => listCourses(r) });
  const current = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const courseId = f.courseId || current.data?.id || "";
  const overview = useQuery({ queryKey: ["courseOverview", courseId], queryFn: () => courseOverview(r, courseId), enabled: !!courseId });
  const hospitals = useQuery({ queryKey: ["hospitals"], queryFn: () => listHospitals(r) });
  const evaluators = useQuery({ queryKey: ["evaluators"], queryFn: () => listEvaluators(r) });
  const sections = useQuery({ queryKey: ["rubric"], queryFn: () => rubric(r) });
  // A full course holds tens of thousands of grades: the newest ones open
  // instantly; search, "show all" and the Excel export read everything.
  const [showAll, setShowAll] = useState(false);
  const search = useDeferredValue(f.search.trim());
  const filter: EvaluationFilter = {
    courseId: courseId || undefined, groupId: f.groupId || undefined, hospitalId: f.hospitalId || undefined,
    evaluatorId: f.evaluatorId || undefined, from: f.from || undefined, to: f.to || undefined, search: search || undefined,
  };
  const limit = showAll || search ? undefined : PAGE;
  const rows = useQuery({ queryKey: ["evaluations", filter, limit], queryFn: () => listEvaluations(r, filter, limit), placeholderData: (prev) => prev });
  const total = useQuery({ queryKey: ["evaluationCount", { ...filter, search: undefined }], queryFn: () => countEvaluations(r, { ...filter, search: undefined }) });
  const shown = rows.data ?? [];
  const partial = !search && !showAll && total.data !== undefined && total.data > shown.length;

  const columns = useMemo<ColumnDef<EvaluationRow, unknown>[]>(
    () => [
      { accessorKey: "dateISO", header: "التاريخ", size: 110, cell: (c) => <span className="tabular">{c.getValue() as string}</span> },
      { accessorKey: "studentName", header: "الطالب" },
      { accessorKey: "groupName", header: "المجموعة", size: 170 },
      { accessorKey: "hospitalName", header: "المستشفى", size: 150 },
      { accessorKey: "attendance", header: "الحضور", size: 80, cell: (c) => ATTENDANCE_AR[c.getValue() as string] },
      ...(sections.data ?? []).map(
        (s): ColumnDef<EvaluationRow, unknown> => ({
          id: s.id,
          header: `${s.labelAr} /${s.maxScore}`,
          size: 90,
          accessorFn: (e) => e.sections[s.id],
          cell: (c) => {
            const e = c.row.original;
            if (e.attendance === "absent") return <span className="tabular">—</span>;
            const value = c.getValue() as number;
            if (s.items.length < 2) return <span className="tabular">{fmt2(value)}</span>;
            // Criteria with sub-criteria: click for the breakdown.
            return (
              <button
                className="subcrit-cell tabular"
                title="عرض البنود الفرعية"
                onClick={(ev) => {
                  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                  showSubCriteria({
                    x: box.left + box.width / 2,
                    y: box.bottom,
                    title: s.labelAr,
                    student: `${e.studentName} · ${e.dateISO}`,
                    max: s.maxScore,
                    score: value ?? 0,
                    items: s.items.map((i) => ({ label: i.labelAr, labelEn: i.labelEn, max: i.maxScore, score: e.items ? (e.items[i.id] ?? 0) : null })),
                  });
                }}
              >
                {fmt2(value)}
              </button>
            );
          },
        })
      ),
      { accessorKey: "total", header: "المجموع", size: 80, cell: (c) => <b className="tabular">{c.row.original.attendance === "absent" ? "—" : fmt2(c.getValue() as number)}</b> },
      { accessorKey: "evaluatorName", header: "المقيّم", size: 140 },
    ],
    [sections.data]
  );

  async function exportExcel() {
    setNote(null);
    try {
      const Excel = await loadExcel();
      const wb = new Excel.Workbook();
      const ws = wb.addWorksheet("الدرجات", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
      const secs = sections.data ?? [];
      ws.addRow(["التاريخ", "الرقم الجامعي", "الطالب", "المجموعة", "المستشفى", "الحضور", ...secs.map((s) => s.labelAr), "المجموع", "المقيّم", "ملاحظات"]);
      ws.getRow(1).font = { bold: true };
      for (const e of partial ? await listEvaluations(r, filter) : shown) {
        const absent = e.attendance === "absent";
        ws.addRow([e.dateISO, e.universityNumber, e.studentName, e.groupName ?? "", e.hospitalName ?? "", ATTENDANCE_AR[e.attendance],
          ...secs.map((s) => (absent ? "" : e.sections[s.id] ?? "")), absent ? "" : e.total, e.evaluatorName ?? "", e.notes ?? ""]);
      }
      ws.columns.forEach((c) => (c.width = 16));
      const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
      if (await saveFile("الدرجات.xlsx", bytes, { name: "Excel", extensions: ["xlsx"] })) setNote({ kind: "ok", text: `حُفظ ${ws.rowCount - 1} تقييم.` });
    } catch (e) {
      setNote({ kind: "err", text: errorText(e) });
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const groups = overview.data?.groups ?? [];

  return (
    <div className="stack">
      <SubCriteriaHost />
      <PageHeader
        title="مركز الدرجات"
        subtitle="الدرجات المعتمدة فقط (بعد اعتماد المقيّم لليوم)."
        actions={
          <>
            <div className="seg" role="tablist">
              <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>
                قائمة التقييمات
              </button>
              <button role="tab" aria-selected={view === "sheet"} className={view === "sheet" ? "on" : ""} onClick={() => setView("sheet")}>
                كشف المجموعة
              </button>
            </div>
            {view === "list" && (
              <button className="btn" onClick={exportExcel} disabled={!shown.length}>
                تصدير Excel
              </button>
            )}
          </>
        }
      />
      {note && <Notice kind={note.kind}>{note.text}</Notice>}
      <div className="filters">
        <select className="input" value={courseId} onChange={(e) => setF({ ...f, courseId: e.target.value, groupId: "" })} aria-label="الدورة">
          {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label ?? `${c.year}-${c.number}`}</option>)}
        </select>
        <select className="input" value={f.groupId} onChange={set("groupId")} aria-label="المجموعة">
          <option value="">{view === "sheet" ? "اختر مجموعة…" : "كل المجموعات"}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {view === "list" && (
          <>
            <select className="input" value={f.hospitalId} onChange={set("hospitalId")} aria-label="المستشفى">
              <option value="">كل المستشفيات</option>
              {(hospitals.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <select className="input" value={f.evaluatorId} onChange={set("evaluatorId")} aria-label="المقيّم">
              <option value="">كل المقيّمين</option>
              {(evaluators.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <label className="row check">من <input className="input" type="date" value={f.from} onChange={set("from")} /></label>
            <label className="row check">إلى <input className="input" type="date" value={f.to} onChange={set("to")} /></label>
            <input className="input grow" type="search" placeholder="بحث عن طالب…" value={f.search} onChange={set("search")} aria-label="بحث" />
          </>
        )}
      </div>
      {rows.isError && <Notice kind="err">{errorText(rows.error)}</Notice>}
      {view === "list" && partial && (
        <p className="muted" style={{ margin: 0 }}>
          يُعرض أحدث {shown.length.toLocaleString("en")} تقييم من {total.data!.toLocaleString("en")}. ضيّق التصفية أو ابحث عن طالب، أو{" "}
          <button className="btn btn-sm" onClick={() => setShowAll(true)}>
            اعرض الكل
          </button>{" "}
          (التصدير يشمل الكل دائمًا).
        </p>
      )}
      {view === "list" ? (
        <DataTable rows={shown} columns={columns} getRowId={(e) => e.id} empty={rows.isLoading ? "جارٍ التحميل…" : "لا توجد درجات معتمدة لهذا الاختيار"} />
      ) : f.groupId ? (
        <GroupSheet groupId={f.groupId} />
      ) : (
        <Empty>اختر مجموعة لعرض كشف درجاتها (الطلاب × الأيام).</Empty>
      )}
    </div>
  );
}

function GroupSheet({ groupId }: { groupId: string }) {
  const sheet = useQuery({ queryKey: ["gradeSheet", groupId], queryFn: () => groupGradeSheet(r, groupId) });
  const s = sheet.data;
  if (!s) return <p className="muted">جارٍ التحميل…</p>;
  if (s.dates.length === 0) return <Empty>لا توجد درجات معتمدة لهذه المجموعة بعد.</Empty>;
  return (
    <div className="table-wrap" style={{ maxHeight: "calc(100vh - 250px)" }}>
      <table className="list sheet">
        <thead>
          <tr>
            <th className="sticky-col">الطالب</th>
            {s.dates.map((d) => <th key={d} className="tabular">{d.slice(5)}</th>)}
            <th>المعدل</th>
          </tr>
        </thead>
        <tbody>
          {s.students.map((st) => (
            <tr key={st.id}>
              <th scope="row" className="sticky-col">{st.name}</th>
              {s.dates.map((d) => {
                const c = st.cells[d];
                return (
                  <td key={d} className={`tabular ${c?.attendance === "absent" ? "absent" : ""}`}>
                    {!c ? "" : c.attendance === "absent" ? "غ" : fmt2(c.total)}
                  </td>
                );
              })}
              <td className="tabular"><b>{fmt2(st.average)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
