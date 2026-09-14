import { listGroups } from "@/lib/models/groups";
import { listHospitals } from "@/lib/models/hospitals";
import { createGroupAction, toggleGroupActiveAction } from "@/lib/actions/groups";

export default async function GroupsPage() {
  const [groups, hospitals] = await Promise.all([listGroups(true), listHospitals()]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">المجموعات</h1>
        <p className="text-slate-500 mt-1">
          كل مجموعة طلابية تدور على مستشفى واحد في كل دورة.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة مجموعة</h2>
        <form action={createGroupAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium mb-1">اسم المجموعة</label>
            <input name="name" required className="input" />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium mb-1">الدورة</label>
            <input name="cycleLabel" className="input" placeholder="مثال: الدورة ١" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm font-medium mb-1">المستشفى</label>
            <select name="hospitalId" className="input">
              <option value="">— بدون —</option>
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
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
              <th>الدورة</th>
              <th>المستشفى</th>
              <th>عدد الطلاب</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td>{g.cycleLabel ?? "—"}</td>
                <td>{g.hospitalName ?? "—"}</td>
                <td>{g.studentCount}</td>
                <td>
                  <span className={`badge ${g.active ? "badge-green" : "badge-gray"}`}>
                    {g.active ? "فعّالة" : "معطّلة"}
                  </span>
                </td>
                <td>
                  <form action={toggleGroupActiveAction}>
                    <input type="hidden" name="id" value={g.id} />
                    <input type="hidden" name="active" value={g.active ? "0" : "1"} />
                    <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                      {g.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-slate-400 py-6">
                  لا توجد مجموعات بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
