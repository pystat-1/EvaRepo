import { listCourses } from "@/lib/models/courses";
import { createCourseAction, toggleCourseActiveAction } from "@/lib/actions/courses";

export default async function CoursesPage() {
  const courses = await listCourses(true);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الدورات</h1>
        <p className="text-slate-500 mt-1">
          كل سنة تحتوي دورتين (١ و٢) — الطلاب والمجموعات ترتبط بدورة محددة، وتُستخدم في
          توليد رمز الطالب.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة دورة</h2>
        <form action={createCourseAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium mb-1">السنة</label>
            <input name="year" type="number" required min={2000} className="input" placeholder="2026" />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium mb-1">رقم الدورة</label>
            <select name="number" required className="input">
              <option value="1">١</option>
              <option value="2">٢</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">تسمية (اختياري)</label>
            <input name="label" className="input" placeholder="مثال: خريف ٢٠٢٦" />
          </div>
          <button type="submit" className="btn btn-primary">
            إضافة
          </button>
        </form>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>السنة</th>
              <th>الدورة</th>
              <th>التسمية</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.id}>
                <td>{c.year}</td>
                <td>{c.number}</td>
                <td>{c.label ?? "—"}</td>
                <td>
                  <span className={`badge ${c.active ? "badge-green" : "badge-gray"}`}>
                    {c.active ? "فعّالة" : "معطّلة"}
                  </span>
                </td>
                <td>
                  <form action={toggleCourseActiveAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                    <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                      {c.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {courses.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  لا توجد دورات بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
