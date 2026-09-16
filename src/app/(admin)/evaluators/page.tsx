import { Suspense } from "react";
import { listEvaluatorsPage } from "@/lib/models/evaluators";
import { listHospitals } from "@/lib/models/hospitals";
import { listGroups } from "@/lib/models/groups";
import {
  createEvaluatorAction,
  toggleEvaluatorActiveAction,
  addAssignmentAction,
  toggleAssignmentActiveAction,
  importEvaluatorsAction,
} from "@/lib/actions/evaluators";
import DebouncedSearch from "@/components/DebouncedSearch";
import Pager from "@/components/Pager";
import ImportCsvForm from "@/components/ImportCsvForm";

export default async function EvaluatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const page = typeof sp.page === "string" ? Number(sp.page) || 1 : 1;

  const [{ rows: evaluators, total, pageSize }, hospitals, groups] = await Promise.all([
    listEvaluatorsPage({ search: q, page, includeInactive: true }),
    listHospitals(),
    listGroups(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">المقيّمون في المستشفيات</h1>
        <p className="text-slate-500 mt-1">
          كل مقيّم مرتبط بمستشفى (وقد يكون بمجموعة محددة) — لا يمكن لأي مقيّم رؤية بيانات
          مستشفى آخر لم يُخصَّص له.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة مقيّم جديد</h2>
        <form action={createEvaluatorAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">الاسم</label>
            <input name="name" required className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
            <input name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">كلمة المرور المبدئية</label>
            <input name="password" type="text" required minLength={8} className="input" />
          </div>
          <div>
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
            <label className="block text-sm font-medium mb-1">المجموعة (اختياري)</label>
            <select name="groupId" className="input">
              <option value="">— كل مجموعات المستشفى —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn btn-primary w-full">
              إضافة مقيّم
            </button>
          </div>
        </form>
      </div>

      <ImportCsvForm
        action={importEvaluatorsAction}
        columnsHint="الأعمدة المتوقعة: name, email, password, hospital, group — يتم الدمج حسب البريد الإلكتروني:
        مقيّم موجود يحصل على تخصيص جديد (مستشفى/مجموعة)، وبريد جديد ينشئ حسابًا (password إلزامية
        لحساب جديد فقط، ٨ أحرف على الأقل). group اختياري — فارغ يعني كل مجموعات المستشفى."
      />

      <div className="w-full sm:w-72">
        <Suspense fallback={<input className="input" placeholder="بحث..." disabled />}>
          <DebouncedSearch placeholder="بحث بالاسم أو البريد الإلكتروني..." />
        </Suspense>
      </div>

      <div className="flex flex-col gap-4">
        {evaluators.map((ev) => (
          <div key={ev.id} className="card">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-semibold">{ev.name}</div>
                <div className="text-sm text-slate-500">{ev.email}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`badge ${ev.active ? "badge-green" : "badge-gray"}`}>
                  {ev.active ? "فعّال" : "معطّل"}
                </span>
                <form action={toggleEvaluatorActiveAction}>
                  <input type="hidden" name="accountId" value={ev.id} />
                  <input type="hidden" name="active" value={ev.active ? "0" : "1"} />
                  <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                    {ev.active ? "تعطيل الحساب" : "تفعيل الحساب"}
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-3">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>المستشفى</th>
                    <th>المجموعة</th>
                    <th>الحالة</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ev.assignments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.hospitalName}</td>
                      <td>{a.groupName ?? "كل المجموعات"}</td>
                      <td>
                        <span className={`badge ${a.active ? "badge-green" : "badge-gray"}`}>
                          {a.active ? "فعّالة" : "معطّلة"}
                        </span>
                      </td>
                      <td>
                        <form action={toggleAssignmentActiveAction}>
                          <input type="hidden" name="assignmentId" value={a.id} />
                          <input type="hidden" name="active" value={a.active ? "0" : "1"} />
                          <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                            {a.active ? "تعطيل" : "تفعيل"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={addAssignmentAction} className="flex flex-wrap items-end gap-3 mt-3">
              <input type="hidden" name="accountId" value={ev.id} />
              <div className="flex-1 min-w-[160px]">
                <label className="block text-sm font-medium mb-1">إضافة تخصيص لمستشفى آخر</label>
                <select name="hospitalId" required className="input">
                  <option value="">— اختر مستشفى —</option>
                  {hospitals.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-sm font-medium mb-1">المجموعة (اختياري)</label>
                <select name="groupId" className="input">
                  <option value="">— كل مجموعات المستشفى —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="btn btn-secondary">
                إضافة تخصيص
              </button>
            </form>
          </div>
        ))}
        {evaluators.length === 0 && (
          <div className="card text-center text-slate-400 py-6">لا يوجد مقيّمون بعد</div>
        )}
      </div>

      <Pager page={page} pageSize={pageSize} total={total} searchParams={sp} />
    </div>
  );
}
