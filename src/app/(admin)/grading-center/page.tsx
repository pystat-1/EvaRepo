import { listGradingCenter, getGradingCenterDashboard, GradingCenterFilters } from "@/lib/models/gradingCenter";
import { listHospitals } from "@/lib/models/hospitals";
import { listCourses } from "@/lib/models/courses";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listGroups } from "@/lib/models/groups";
import { listEvaluators } from "@/lib/models/evaluators";
import AutoRefresh from "@/components/AutoRefresh";
import Pager from "@/components/Pager";

const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
const ATTENDANCE_BADGE: Record<string, string> = {
  present: "badge-green",
  late: "badge-amber",
  absent: "badge-red",
};

const BAR_HUE = "#1a5276"; // the app's own --brand — one hue for a plain magnitude comparison, no legend needed
const SEQ_RGB = "26,82,118"; // --brand as r,g,b, for the heatmap's sequential ramp

function pct(x: number): string {
  return `${Math.round(x * 100)}٪`;
}

export default async function GradingCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const filters: GradingCenterFilters = {
    hospitalId: one(sp.hospitalId),
    courseId: one(sp.courseId),
    studyTypeId: one(sp.studyTypeId),
    groupId: one(sp.groupId),
    evaluatorId: one(sp.evaluatorId),
    dateFrom: one(sp.from),
    dateTo: one(sp.to),
  };

  const [{ rows, maxTotal, total, pageSize }, dash, hospitals, courses, studyTypes, groups, evaluators] =
    await Promise.all([
      listGradingCenter(filters, { page }),
      getGradingCenterDashboard(filters),
      listHospitals(true),
      listCourses(true),
      listStudyTypes(true),
      listGroups(true),
      listEvaluators(true),
    ]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">مركز التقييم</h1>
          <p className="text-slate-500 mt-1">
            كل الدرجات من كل المقيّمين عبر كل المستشفيات في مكان واحد — بتفاصيل كل معيار، وليس
            المجموع النهائي فقط.
          </p>
        </div>
        <AutoRefresh intervalSeconds={20} />
      </div>

      <form method="get" className="card grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium mb-1">الدورة</label>
          <select name="courseId" defaultValue={filters.courseId ?? ""} className="input">
            <option value="">الكل</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label ?? `${c.year}-${c.number}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">نوع الدراسة</label>
          <select name="studyTypeId" defaultValue={filters.studyTypeId ?? ""} className="input">
            <option value="">الكل</option>
            {studyTypes.map((st) => (
              <option key={st.id} value={st.id}>
                {st.nameAr ?? st.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">المجموعة</label>
          <select name="groupId" defaultValue={filters.groupId ?? ""} className="input">
            <option value="">الكل</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">المستشفى</label>
          <select name="hospitalId" defaultValue={filters.hospitalId ?? ""} className="input">
            <option value="">الكل</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">المقيّم</label>
          <select name="evaluatorId" defaultValue={filters.evaluatorId ?? ""} className="input">
            <option value="">الكل</option>
            {evaluators.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">من تاريخ</label>
          <input type="date" name="from" defaultValue={filters.dateFrom ?? ""} className="input" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">إلى تاريخ</label>
          <input type="date" name="to" defaultValue={filters.dateTo ?? ""} className="input" />
        </div>
        <div className="col-span-2 sm:col-span-4 lg:col-span-7 flex items-center gap-2">
          <button type="submit" className="btn btn-primary">
            تصفية
          </button>
          {activeFilterCount > 0 && (
            <a href="/grading-center" className="btn btn-secondary">
              مسح التصفية
            </a>
          )}
        </div>
      </form>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="عدد التقييمات" value={dash.summary.evaluationCount} />
        <SummaryCard label="عدد الطلاب" value={dash.summary.studentCount} />
        <SummaryCard
          label="نسبة الحضور"
          value={pct(dash.summary.attendanceRate)}
          sub={`${dash.summary.lateCount} تأخر · ${dash.summary.absentCount} غياب`}
        />
        <SummaryCard label="متوسط الدرجة" value={`${dash.summary.averageTotal.toFixed(1)} / ${maxTotal}`} />
        <SummaryCard label="عدد المقيّمين" value={dash.summary.evaluatorCount} />
        <SummaryCard label="عدد المستشفيات" value={dash.summary.hospitalCount} />
        <SummaryCard
          label="بحاجة متابعة"
          value={dash.summary.flaggedStudentCount}
          tone={dash.summary.flaggedStudentCount > 0 ? "danger" : undefined}
        />
      </div>

      {dash.summary.evaluationCount > 0 && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="font-semibold mb-1">اتجاه المعدل عبر فترات الدوران</h2>
              <p className="text-xs text-slate-500 mb-3">
                متوسط الدرجة الكلية لكل فترة دوران (بترتيبها الزمني ضمن كل مجموعة)، وليس بحسب التاريخ
                التقويمي — فترات مختلف المجموعات تبدأ في تواريخ مختلفة.
              </p>
              <TrendChart trend={dash.trend} maxTotal={maxTotal} />
            </div>

            <div className="card">
              <h2 className="font-semibold mb-1">مقارنة المستشفيات</h2>
              <p className="text-xs text-slate-500 mb-3">متوسط الدرجة الكلية لكل مستشفى.</p>
              <HospitalBarChart rows={dash.byHospital} maxTotal={maxTotal} />
            </div>
          </div>

          {dash.heatmap.length > 0 && dash.maxBlockSeq > 0 && (
            <div className="card">
              <h2 className="font-semibold mb-1">خريطة الحضور — كل مجموعة عبر فترات دورانها</h2>
              <p className="text-xs text-slate-500 mb-3">
                درجة اللون تعني نسبة الحضور (حاضر أو متأخر) في تلك الفترة لتلك المجموعة.
              </p>
              <AttendanceHeatmap rows={dash.heatmap} maxBlockSeq={dash.maxBlockSeq} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-semibold">بحاجة إلى متابعة</h2>
                {dash.summary.flaggedStudentCount > 0 && (
                  <span className="badge badge-red">{dash.summary.flaggedStudentCount} طالب</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mb-3">
                من محرّك التنبيهات نفسه المستخدم في صفحة /flags — درجة منخفضة، غياب متكرر، أو اتجاه
                تنازلي في الأداء.
              </p>
              {dash.flagged.length === 0 ? (
                <p className="text-center text-slate-400 py-6">لا يوجد طلاب بحاجة متابعة ضمن هذه التصفية</p>
              ) : (
                <div className="flex flex-col divide-y divide-slate-100">
                  {dash.flagged.slice(0, 12).map((f) => (
                    <div key={f.studentId} className="py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a href={`/grading-center/student/${f.studentId}`} className="font-medium hover:underline">
                          {f.name}
                        </a>
                        <div className="text-xs text-slate-400">{f.groupName ?? "—"} — {f.universityNumber}</div>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end shrink-0">
                        {f.flags.map((fl, i) => (
                          <span
                            key={i}
                            title={fl.msg}
                            className={`badge ${fl.severity === "danger" ? "badge-red" : "badge-amber"}`}
                          >
                            {fl.ruleId === "low_score" ? "درجة منخفضة" : fl.ruleId === "attendance" ? "غياب متكرر" : "اتجاه تنازلي"}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {dash.flagged.length > 12 && (
                    <div className="pt-2 text-xs text-slate-400">و{dash.flagged.length - 12} طالبًا آخرين — راجع /flags</div>
                  )}
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="font-semibold mb-1">الأعلى والأدنى معدلاً</h2>
              <p className="text-xs text-slate-500 mb-3">ضمن هذه التصفية — {dash.summary.studentCount} طالب.</p>
              <div className="grid grid-cols-2 gap-4">
                <PerformerList title="الأعلى معدلاً" tone="good" rows={dash.topStudents} maxTotal={maxTotal} />
                <PerformerList title="الأدنى معدلاً" tone="bad" rows={dash.bottomStudents} maxTotal={maxTotal} />
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الطالب</th>
              <th>الرمز</th>
              <th>الدورة</th>
              <th>نوع الدراسة</th>
              <th>المجموعة</th>
              <th>المستشفى</th>
              <th>المقيّم</th>
              <th>الحضور</th>
              <th>الدرجة</th>
              <th>تفاصيل المعايير</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.dateISO}</td>
                <td>
                  <a href={`/grading-center/student/${r.studentId}`} className="hover:underline">
                    {r.studentName}
                  </a>
                  <div className="text-xs text-slate-400">{r.universityNumber}</div>
                </td>
                <td className="font-mono text-xs">{r.studentCode ?? "—"}</td>
                <td>{r.courseLabel ?? "—"}</td>
                <td>{r.studyTypeName ?? "—"}</td>
                <td>{r.groupName ?? "—"}</td>
                <td>{r.hospitalName ?? "—"}</td>
                <td>{r.evaluatorName}</td>
                <td>
                  <span className={`badge ${ATTENDANCE_BADGE[r.attendance]}`}>
                    {ATTENDANCE_LABEL[r.attendance]}
                  </span>
                </td>
                <td className="font-semibold whitespace-nowrap">
                  {r.total} / {maxTotal}
                </td>
                <td className="min-w-[220px]">
                  <div className="flex flex-wrap gap-1">
                    {r.scores.map((s) => (
                      <span
                        key={s.sectionId}
                        title={s.labelAr}
                        className="badge badge-gray whitespace-nowrap"
                      >
                        {s.labelAr}: {s.score}/{s.maxScore}
                      </span>
                    ))}
                  </div>
                  {(r.notes || r.feedback) && (
                    <div className="text-xs text-slate-400 mt-1 max-w-[260px] truncate" title={[r.notes, r.feedback].filter(Boolean).join(" — ")}>
                      {[r.notes, r.feedback].filter(Boolean).join(" — ")}
                    </div>
                  )}
                </td>
                <td>
                  {r.locked ? (
                    <span className="badge badge-gray">مقفل</span>
                  ) : (
                    <span className="badge badge-green">مفتوح</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center text-slate-400 py-8">
                  لا توجد تقييمات مطابقة لهذه التصفية
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} pageSize={pageSize} total={total} searchParams={sp} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "danger";
}) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone === "danger" ? "text-red-600" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ---- charts: plain server-rendered SVG, no client JS ----

const CHART_W = 320;
const CHART_H = 150;
const PAD = { l: 30, r: 14, t: 16, b: 30 };

function TrendChart({ trend, maxTotal }: { trend: { blockSeq: number; label: string; averageTotal: number; count: number }[]; maxTotal: number }) {
  const points = trend.filter((t) => t.count > 0);
  if (points.length === 0) {
    return <p className="text-center text-slate-400 py-8 text-sm">لا يوجد جدول دوران مرتبط بعد</p>;
  }
  const plotW = CHART_W - PAD.l - PAD.r;
  const plotH = CHART_H - PAD.t - PAD.b;
  const xFor = (i: number) => PAD.l + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const yFor = (v: number) => PAD.t + plotH - (v / maxTotal) * plotH;
  const coords = points.map((p, i) => [xFor(i), yFor(p.averageTotal)] as const);
  const path = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
  const area = `M ${coords[0][0].toFixed(1)},${CHART_H - PAD.b} L ${path} L ${coords[coords.length - 1][0].toFixed(1)},${CHART_H - PAD.b} Z`;

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto">
      <line x1={PAD.l} y1={CHART_H - PAD.b} x2={CHART_W - PAD.r} y2={CHART_H - PAD.b} stroke="#e2e8f0" strokeWidth={1} />
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={CHART_H - PAD.b} stroke="#e2e8f0" strokeWidth={1} />
      <text x={PAD.l - 4} y={PAD.t + 4} fontSize={9} textAnchor="end" fill="#94a3b8">{maxTotal}</text>
      <text x={PAD.l - 4} y={CHART_H - PAD.b + 3} fontSize={9} textAnchor="end" fill="#94a3b8">0</text>
      <path d={area} fill={BAR_HUE} opacity={0.08} />
      <path d={`M ${path}`} fill="none" stroke={BAR_HUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={4} fill={BAR_HUE} stroke="white" strokeWidth={2} />
      ))}
      {points.map((p, i) => (
        <text key={i} x={xFor(i)} y={CHART_H - 6} fontSize={9.5} textAnchor="middle" fill="#64748b">
          {p.label} — {p.averageTotal.toFixed(1)}
        </text>
      ))}
    </svg>
  );
}

function HospitalBarChart({ rows, maxTotal }: { rows: { hospitalId: string; name: string; averageTotal: number; count: number }[]; maxTotal: number }) {
  if (rows.length === 0) {
    return <p className="text-center text-slate-400 py-8 text-sm">لا توجد بيانات بعد</p>;
  }
  const plotH = CHART_H - PAD.t - PAD.b;
  const slot = (CHART_W - 16) / rows.length;
  const barW = Math.min(48, slot * 0.55);

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto">
      <line x1={8} y1={CHART_H - PAD.b} x2={CHART_W - 8} y2={CHART_H - PAD.b} stroke="#e2e8f0" strokeWidth={1} />
      {rows.map((h, i) => {
        const frac = maxTotal > 0 ? h.averageTotal / maxTotal : 0;
        const barH = frac * plotH;
        const x = 8 + i * slot + (slot - barW) / 2;
        const y = PAD.t + (plotH - barH);
        return (
          <g key={h.hospitalId}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill={BAR_HUE} />
            <text x={x + barW / 2} y={y - 5} fontSize={10.5} fontWeight={700} textAnchor="middle" fill="#1c1b18">
              {h.averageTotal.toFixed(1)}
            </text>
            <text x={x + barW / 2} y={CHART_H - 6} fontSize={9} textAnchor="middle" fill="#64748b">
              {h.name.length > 14 ? h.name.slice(0, 13) + "…" : h.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AttendanceHeatmap({ rows, maxBlockSeq }: { rows: { groupId: string; name: string; cells: { blockSeq: number; count: number; attendanceRate: number }[] }[]; maxBlockSeq: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
        <span>أقل</span>
        <span
          className="w-24 h-2 rounded"
          style={{ background: `linear-gradient(90deg, rgba(${SEQ_RGB},0.1), rgba(${SEQ_RGB},0.95))` }}
        />
        <span>أكثر</span>
      </div>
      {rows.map((row) => (
        <div key={row.groupId} className="grid items-center gap-2" style={{ gridTemplateColumns: `150px repeat(${maxBlockSeq}, 1fr)` }}>
          <div className="text-xs text-slate-600 text-end truncate">{row.name}</div>
          {row.cells.map((cell) => (
            <div
              key={cell.blockSeq}
              title={`${row.name} — الفترة ${cell.blockSeq} — حضور ${pct(cell.attendanceRate)}`}
              className="aspect-square rounded flex items-center justify-center text-[9px] font-mono font-bold"
              style={{
                background: cell.count > 0 ? `rgba(${SEQ_RGB},${(0.12 + cell.attendanceRate * 0.82).toFixed(2)})` : "#f1f5f9",
                color: "#113a54",
              }}
            >
              {cell.count > 0 ? Math.round(cell.attendanceRate * 100) : "—"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PerformerList({
  title,
  tone,
  rows,
  maxTotal,
}: {
  title: string;
  tone: "good" | "bad";
  rows: { studentId: string; name: string; groupName: string | null; averageTotal: number }[];
  maxTotal: number;
}) {
  return (
    <div>
      <div className={`text-xs font-bold mb-1 ${tone === "good" ? "text-green-700" : "text-red-700"}`}>{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">لا توجد بيانات كافية</p>
      ) : (
        <div className="flex flex-col divide-y divide-slate-100">
          {rows.map((r, i) => (
            <div key={r.studentId} className="py-1.5 flex items-center gap-2 text-sm">
              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <a href={`/grading-center/student/${r.studentId}`} className="flex-1 min-w-0 truncate hover:underline">
                {r.name}
                <span className="text-slate-400 text-xs"> — {r.groupName ?? "—"}</span>
              </a>
              <span className={`font-mono font-bold text-xs ${tone === "good" ? "text-green-700" : "text-red-700"}`}>
                {r.averageTotal.toFixed(1)}/{maxTotal}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
