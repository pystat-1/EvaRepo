import { listAuditLog } from "@/lib/audit";

const ACTION_LABELS: Record<string, string> = {
  create: "إنشاء",
  update: "تعديل",
  deactivate: "تعطيل",
  reactivate: "تفعيل",
  delete: "حذف",
};

const ENTITY_LABELS: Record<string, string> = {
  Student: "طالب",
  Group: "مجموعة",
  Hospital: "مستشفى",
  StudyType: "نوع دراسة",
  Evaluator: "مقيّم",
  EvaluatorAssignment: "تخصيص مقيّم",
  Evaluation: "تقييم",
  RubricSection: "بند تقييم",
  StudentAccount: "حساب طالب",
};

export default async function AuditLogPage() {
  const entries = await listAuditLog(300);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">سجل التغييرات</h1>
        <p className="text-slate-500 mt-1">
          كل تعديل على السجلات يُسجَّل هنا تلقائيًا — من قام به، ومتى، وما الذي تغيّر.
        </p>
      </div>
      <div className="card p-0 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>بواسطة</th>
              <th>الإجراء</th>
              <th>النوع</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString("ar-IQ")}</td>
                <td>{e.actorName ?? "—"}</td>
                <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                <td>{ENTITY_LABELS[e.entityType] ?? e.entityType}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-slate-400 py-6">
                  لا توجد تغييرات مسجّلة بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
