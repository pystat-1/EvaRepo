import { listGroups } from "@/lib/models/groups";
import { listHospitals } from "@/lib/models/hospitals";
import { listCourses } from "@/lib/models/courses";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listRotationBlocksForGroup } from "@/lib/models/rotationBlocks";
import { createGroupAction, toggleGroupActiveAction, importGroupsAction } from "@/lib/actions/groups";
import {
  createRotationBlockAction,
  toggleRotationBlockActiveAction,
  importRotationBlocksAction,
} from "@/lib/actions/rotationBlocks";
import { WEEKDAYS } from "@/lib/weekdays";
import ImportCsvForm from "@/components/ImportCsvForm";

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

export default async function GroupsPage() {
  const [groups, hospitals, courses, studyTypes] = await Promise.all([
    listGroups(true),
    listHospitals(),
    listCourses(),
    listStudyTypes(),
  ]);
  const rotationsByGroup = await Promise.all(groups.map((g) => listRotationBlocksForGroup(g.id)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">المجموعات</h1>
        <p className="text-slate-500 mt-1">
          كل مجموعة تابعة لدورة ونوع دراسة ووردية، وتدور على عدة مستشفيات حسب جدول
          الدوران أدناه — بدلاً من ارتباط ثابت بمستشفى واحد.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة مجموعة</h2>
        <form action={createGroupAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">اسم المجموعة</label>
            <input name="name" required className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الدورة</label>
            <select name="courseId" className="input">
              <option value="">— بدون —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? `${c.year}-${c.number}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الوردية</label>
            <select name="shift" className="input">
              <option value="">— بدون —</option>
              <option value="MORNING">صباحي</option>
              <option value="EVENING">مسائي</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">نوع الدراسة</label>
            <select name="studyTypeId" className="input">
              <option value="">— بدون —</option>
              {studyTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.nameAr ?? st.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الدفعة (اختياري)</label>
            <input name="cycleLabel" className="input" placeholder="مثال: الدفعة ١" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn btn-primary w-full">
              إضافة
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ImportCsvForm
          action={importGroupsAction}
          columnsHint="الأعمدة المتوقعة: name, shift, course, studyType, cycleLabel — يتم الدمج حسب اسم
          المجموعة. shift بقيمة MORNING أو EVENING، وcourse بصيغة &quot;السنة-رقم الدورة&quot; مثل 2026-1."
        />
        <ImportCsvForm
          action={importRotationBlocksAction}
          columnsHint="جدول الدوران — الأعمدة المتوقعة: group, hospital, startDate, endDate, daysOfWeek
          (اختياري، مثل SUN,TUE). إعادة استيراد نفس الصف (نفس المجموعة والمستشفى والتواريخ) لا تُنشئ
          فترة مكررة."
        />
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((g, i) => (
          <div key={g.id} className="card">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-semibold">{g.name}</div>
                <div className="text-sm text-slate-500">
                  {[g.courseLabel, g.shift ? SHIFT_LABEL[g.shift] : null, g.studyTypeName, g.cycleLabel]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </div>
                <div className="text-sm mt-1">
                  الآن في:{" "}
                  <span className="font-medium">{g.currentHospitalName ?? "لا يوجد جدول لليوم"}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{g.studentCount} طالب</span>
                <span className={`badge ${g.active ? "badge-green" : "badge-gray"}`}>
                  {g.active ? "فعّالة" : "معطّلة"}
                </span>
                <form action={toggleGroupActiveAction}>
                  <input type="hidden" name="id" value={g.id} />
                  <input type="hidden" name="active" value={g.active ? "0" : "1"} />
                  <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                    {g.active ? "تعطيل" : "تفعيل"}
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-3">
              <h3 className="text-sm font-semibold mb-2">جدول الدوران على المستشفيات</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>المستشفى</th>
                    <th>من</th>
                    <th>إلى</th>
                    <th>أيام الأسبوع</th>
                    <th>الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rotationsByGroup[i].map((rb) => (
                    <tr key={rb.id}>
                      <td>{rb.hospitalName}</td>
                      <td>{rb.startDate}</td>
                      <td>{rb.endDate}</td>
                      <td>
                        {rb.daysOfWeek
                          ? rb.daysOfWeek
                              .split(",")
                              .map((c) => WEEKDAYS.find((d) => d.code === c.trim())?.labelAr ?? c)
                              .join("، ")
                          : "كل الأيام"}
                      </td>
                      <td>
                        <span className={`badge ${rb.active ? "badge-green" : "badge-gray"}`}>
                          {rb.active ? "فعّالة" : "معطّلة"}
                        </span>
                      </td>
                      <td>
                        <form action={toggleRotationBlockActiveAction}>
                          <input type="hidden" name="id" value={rb.id} />
                          <input type="hidden" name="active" value={rb.active ? "0" : "1"} />
                          <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                            {rb.active ? "تعطيل" : "تفعيل"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {rotationsByGroup[i].length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-slate-400 py-4">
                        لا يوجد جدول دوران بعد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <form
              action={createRotationBlockAction}
              className="flex flex-wrap items-end gap-3 mt-3"
            >
              <input type="hidden" name="groupId" value={g.id} />
              <div className="flex-1 min-w-[160px]">
                <label className="block text-sm font-medium mb-1">المستشفى</label>
                <select name="hospitalId" required className="input">
                  <option value="">— اختر —</option>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">من تاريخ</label>
                <input name="startDate" type="date" required className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
                <input name="endDate" type="date" required className="input" />
              </div>
              <div className="flex-1 min-w-[260px]">
                <label className="block text-sm font-medium mb-1">
                  أيام الحضور الأسبوعية (اختياري — بدون تحديد = كل أيام الفترة)
                </label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((d) => (
                    <label key={d.code} className="flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
                      <input type="checkbox" name="daysOfWeek" value={d.code} />
                      {d.labelAr}
                    </label>
                  ))}
                </div>
              </div>
              <button type="submit" className="btn btn-secondary">
                إضافة فترة دوران
              </button>
            </form>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="card text-center text-slate-400 py-6">لا توجد مجموعات بعد</div>
        )}
      </div>
    </div>
  );
}
