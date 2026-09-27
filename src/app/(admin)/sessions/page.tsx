import { listActiveEvaluatorSessions } from "@/lib/auth";
import { revokeSessionAction } from "@/lib/actions/sessions";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} د`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} س`;
  return `قبل ${Math.round(hours / 24)} يوم`;
}

export default async function SessionsPage() {
  const sessions = await listActiveEvaluatorSessions();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">جلسات المقيّمين</h1>
        <p className="text-slate-500 mt-1">
          كل جهاز مسجّل دخول حاليًا. إلغاء الجلسة يقطع الوصول فورًا — لا داعي لانتظار انتهاء الصلاحية.
        </p>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>المقيّم</th>
              <th>الجهاز</th>
              <th>آخر نشاط</th>
              <th>منذ الدخول</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="font-medium">{s.accountName}</div>
                  <div className="text-xs text-slate-400">{s.accountEmail}</div>
                </td>
                <td>{s.deviceLabel ?? "—"}</td>
                <td>{timeAgo(s.lastSeenAt)}</td>
                <td>{timeAgo(s.createdAt)}</td>
                <td>
                  <form action={revokeSessionAction}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <button type="submit" className="btn btn-secondary text-xs">
                      إلغاء الجلسة
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-slate-400 py-6">
                  لا توجد جلسات نشطة حاليًا
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
