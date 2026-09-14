import { listStudentsWithoutAccounts } from "@/lib/models/studentAccounts";
import { createStudentAccountAction } from "@/lib/actions/studentAccounts";

export default async function StudentAccountsPage() {
  const pending = await listStudentsWithoutAccounts();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">حسابات الطلاب</h1>
        <p className="text-slate-500 mt-1">
          إنشاء حساب دخول لطالب حتى يتمكن من رؤية تقييماته وتقدمه بنفسه.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إنشاء حساب لطالب</h2>
        <form action={createStudentAccountAction} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">الطالب</label>
            <select name="studentId" required className="input">
              <option value="">— اختر طالبًا —</option>
              {pending.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameAr} ({s.universityNumber})
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
            <input name="email" type="email" required className="input" />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-sm font-medium mb-1">كلمة المرور المبدئية</label>
            <input name="password" type="text" required minLength={8} className="input" />
          </div>
          <button type="submit" className="btn btn-primary">
            إنشاء حساب
          </button>
        </form>
        {pending.length === 0 && (
          <p className="text-sm text-slate-400 mt-3">كل الطلاب النشطين لديهم حسابات بالفعل.</p>
        )}
      </div>
    </div>
  );
}
