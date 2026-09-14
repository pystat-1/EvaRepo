import { listGradingCenter, GradingCenterFilters } from "@/lib/models/gradingCenter";
import { listHospitals } from "@/lib/models/hospitals";
import { listCourses } from "@/lib/models/courses";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listGroups } from "@/lib/models/groups";
import { listEvaluators } from "@/lib/models/evaluators";
import AutoRefresh from "@/components/AutoRefresh";

const ATTENDANCE_LABEL: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
const ATTENDANCE_BADGE: Record<string, string> = {
  present: "badge-green",
  late: "badge-gray",
  absent: "badge-gray",
};

export default async function GradingCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

  const filters: GradingCenterFilters = {
    hospitalId: one(sp.hospitalId),
    courseId: one(sp.courseId),
    studyTypeId: one(sp.studyTypeId),
    groupId: one(sp.groupId),
    evaluatorId: one(sp.evaluatorId),
    dateFrom: one(sp.from),
    dateTo: one(sp.to),
  };

  const [{ rows, maxTotal, summary }, hospitals, courses, studyTypes, groups, evaluators] = await Promise.all([
    listGradingCenter(filters),
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <SummaryCard label="عدد التقييمات" value={summary.evaluationCount} />
        <SummaryCard label="عدد الطلاب" value={summary.studentCount} />
        <SummaryCard label="عدد المقيّمين" value={summary.evaluatorCount} />
        <SummaryCard label="عدد المستشفيات" value={summary.hospitalCount} />
        <SummaryCard
          label="متوسط الدرجة"
          value={`${summary.averageTotal.toFixed(1)} / ${maxTotal}`}
        />
      </div>

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
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
