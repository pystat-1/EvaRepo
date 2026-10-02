import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { courseStatistics } from "@eva/db/repo/grading";
import { listCourses } from "@eva/db/repo/courses";
import { currentCourse } from "@eva/db/repo/students";
import { Empty, PageHeader, SHIFT_AR, fmt2 } from "../components/ui";
import { r } from "../lib/repo";

function Bar({ value, max, danger }: { value: number | null; max: number; danger?: boolean }) {
  if (value === null) return <span className="muted">—</span>;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="bar" role="img" aria-label={`${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%`, background: danger ? "var(--red-700)" : "var(--brand)" }} />
    </span>
  );
}

export function StatisticsScreen() {
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => listCourses(r) });
  const current = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const [picked, setPicked] = useState("");
  const courseId = picked || current.data?.id || "";
  const stats = useQuery({ queryKey: ["stats", courseId], queryFn: () => courseStatistics(r, courseId), enabled: !!courseId });
  const s = stats.data;
  const all = s?.groups ?? [];
  const totalEvals = all.reduce((a, g) => a + g.evaluations, 0);

  return (
    <div className="stack">
      <PageHeader
        title="الإحصائيات"
        subtitle="من الدرجات المعتمدة فقط. «متدنٍّ» = معدل أقل من 60٪ من الدرجة الكاملة."
        actions={
          <select className="input" value={courseId} onChange={(e) => setPicked(e.target.value)} aria-label="الدورة">
            {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label ?? `${c.year}-${c.number}`}</option>)}
          </select>
        }
      />
      {s && (
        <div className="grid-stats">
          <div className="card stat"><b className="tabular">{all.reduce((a, g) => a + g.students, 0)}</b><span className="muted">طالب</span></div>
          <div className="card stat"><b className="tabular">{totalEvals}</b><span className="muted">تقييم معتمد</span></div>
          <div className="card stat"><b className="tabular">{all.reduce((a, g) => a + g.lowScoreStudents, 0)}</b><span className="muted">طالب بمعدل متدنٍّ</span></div>
          <div className="card stat"><b className="tabular">/{s.maxTotal}</b><span className="muted">الدرجة الكاملة لليوم</span></div>
        </div>
      )}
      {s && totalEvals === 0 && <Empty>لا توجد درجات معتمدة في هذه الدورة بعد — ستظهر الإحصائيات بعد اعتماد أول يوم.</Empty>}
      {s && (
        <div className="card">
          <table className="list">
            <thead>
              <tr><th>المجموعة</th><th>الدوام</th><th>الطلاب</th><th>التقييمات</th><th>معدل الدرجة</th><th></th><th>نسبة الحضور</th><th></th><th>متدنٍّ</th></tr>
            </thead>
            <tbody>
              {all.map((g) => (
                <tr key={g.groupId}>
                  <td>{g.groupName}</td>
                  <td>{SHIFT_AR[g.shift ?? ""] ?? "—"}</td>
                  <td className="tabular">{g.students}</td>
                  <td className="tabular">{g.evaluations}</td>
                  <td className="tabular">{fmt2(g.average)}</td>
                  <td style={{ width: 140 }}><Bar value={g.average} max={s.maxTotal} danger={g.average !== null && g.average < s.maxTotal * 0.6} /></td>
                  <td className="tabular">{g.attendanceRate === null ? "—" : `${Math.round(g.attendanceRate * 100)}٪`}</td>
                  <td style={{ width: 140 }}><Bar value={g.attendanceRate} max={1} danger={g.attendanceRate !== null && g.attendanceRate < 0.8} /></td>
                  <td className="tabular">{g.lowScoreStudents || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
