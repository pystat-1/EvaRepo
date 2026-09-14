import { listRubricSections, getMaxTotal } from "@/lib/models/rubric";
import { createRubricSectionAction, toggleRubricSectionActiveAction } from "@/lib/actions/rubric";

export default async function RubricPage() {
  const sections = await listRubricSections(true);
  const maxTotal = await getMaxTotal();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">معيار التقييم (Rubric)</h1>
        <p className="text-slate-500 mt-1">
          المجموع الحالي: {maxTotal} — التعديل هنا بيانات، وليس تعديلًا في الكود، حسب الخطة.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة بند تقييم</h2>
        <form action={createRubricSectionAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">الاسم (إنجليزي)</label>
            <input name="label" required className="input" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">الاسم (عربي)</label>
            <input name="labelAr" required className="input" />
          </div>
          <div className="w-28">
            <label className="block text-sm font-medium mb-1">أقصى درجة</label>
            <input name="maxScore" type="number" step="0.5" min="0.5" required className="input" />
          </div>
          <div className="w-28">
            <label className="block text-sm font-medium mb-1">الترتيب</label>
            <input name="sortOrder" type="number" defaultValue={99} className="input" />
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
              <th>الترتيب</th>
              <th>الاسم</th>
              <th>أقصى درجة</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <tr key={s.id}>
                <td>{s.sortOrder}</td>
                <td>{s.labelAr}</td>
                <td>{s.maxScore}</td>
                <td>
                  <span className={`badge ${s.active ? "badge-green" : "badge-gray"}`}>
                    {s.active ? "فعّال" : "معطّل"}
                  </span>
                </td>
                <td>
                  <form action={toggleRubricSectionActiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                    <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                      {s.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
