import { listStudyTypes } from "@/lib/models/studyTypes";
import { createStudyTypeAction, toggleStudyTypeActiveAction } from "@/lib/actions/studyTypes";

export default async function StudyTypesPage() {
  const studyTypes = await listStudyTypes(true);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">أنواع الدراسة</h1>
        <p className="text-slate-500 mt-1">
          قائمة مرجعية يمكن للمدير إضافة نوع دراسة جديد إليها دون الحاجة لتعديل الكود.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة نوع دراسة</h2>
        <form action={createStudyTypeAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">الاسم (إنجليزي)</label>
            <input name="name" required className="input" placeholder="Nursing" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">الاسم (عربي)</label>
            <input name="nameAr" className="input" placeholder="تمريض" />
          </div>
          <div className="flex-1 min-w-[100px]">
            <label className="block text-sm font-medium mb-1">الرمز</label>
            <input name="code" required maxLength={4} className="input uppercase" placeholder="N" />
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
              <th>الاسم</th>
              <th>بالعربية</th>
              <th>الرمز</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {studyTypes.map((st) => (
              <tr key={st.id}>
                <td>{st.name}</td>
                <td>{st.nameAr ?? "—"}</td>
                <td>{st.code ?? "—"}</td>
                <td>
                  <span className={`badge ${st.active ? "badge-green" : "badge-gray"}`}>
                    {st.active ? "فعّال" : "معطّل"}
                  </span>
                </td>
                <td>
                  <form action={toggleStudyTypeActiveAction}>
                    <input type="hidden" name="id" value={st.id} />
                    <input type="hidden" name="active" value={st.active ? "0" : "1"} />
                    <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                      {st.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {studyTypes.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  لا توجد أنواع دراسة بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
