import { listHospitals } from "@/lib/models/hospitals";
import { createHospitalAction, toggleHospitalActiveAction } from "@/lib/actions/hospitals";

export default async function HospitalsPage() {
  const hospitals = await listHospitals(true);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">المستشفيات</h1>
        <p className="text-slate-500 mt-1">
          كل مجموعة (وكل مقيّم لاحقًا في المرحلة الثانية) تُربط بمستشفى من هذه القائمة.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة مستشفى</h2>
        <form action={createHospitalAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">الاسم</label>
            <input name="name" required className="input" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">الاسم بالعربية</label>
            <input name="nameAr" className="input" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">العنوان</label>
            <input name="address" className="input" />
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
              <th>العنوان</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hospitals.map((h) => (
              <tr key={h.id}>
                <td>{h.name}</td>
                <td>{h.nameAr ?? "—"}</td>
                <td>{h.address ?? "—"}</td>
                <td>
                  <span className={`badge ${h.active ? "badge-green" : "badge-gray"}`}>
                    {h.active ? "فعّال" : "معطّل"}
                  </span>
                </td>
                <td>
                  <form action={toggleHospitalActiveAction}>
                    <input type="hidden" name="id" value={h.id} />
                    <input type="hidden" name="active" value={h.active ? "0" : "1"} />
                    <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                      {h.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {hospitals.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  لا توجد مستشفيات بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
