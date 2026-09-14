import { listStudents } from "@/lib/models/students";
import { listGroups } from "@/lib/models/groups";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listCourses } from "@/lib/models/courses";
import { createStudentAction, toggleStudentActiveAction } from "@/lib/actions/students";
import ImportStudentsForm from "@/components/ImportStudentsForm";

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

export default async function StudentsPage() {
  const [students, groups, studyTypes, courses] = await Promise.all([
    listStudents(true),
    listGroups(),
    listStudyTypes(),
    listCourses(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الطلاب</h1>
        <p className="text-slate-500 mt-1">
          الرقم الجامعي هو المعرّف الثابت لكل طالب — وليس الاسم — تجنبًا لمشكلة
          &quot;الطالب الشبح&quot; الناتجة عن اختلاف بسيط في كتابة الاسم. رمز الطالب
          (السنة-الدورة-النوع-التسلسل) يُولَّد تلقائيًا عند اختيار الدورة ونوع الدراسة.
        </p>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-3">إضافة طالب</h2>
        <form action={createStudentAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">الرقم الجامعي</label>
            <input name="universityNumber" required className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الاسم (عربي)</label>
            <input name="nameAr" required className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الاسم (إنجليزي)</label>
            <input name="nameEn" className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">البريد الإلكتروني</label>
            <input name="email" type="email" className="input" />
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
            <label className="block text-sm font-medium mb-1">المجموعة</label>
            <select name="groupId" className="input">
              <option value="">— بدون —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-3">
            <button type="submit" className="btn btn-primary">
              إضافة
            </button>
          </div>
        </form>
      </div>

      <ImportStudentsForm />

      <div className="card p-0 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>الرمز</th>
              <th>الرقم الجامعي</th>
              <th>الاسم</th>
              <th>البريد الإلكتروني</th>
              <th>الدورة</th>
              <th>الوردية</th>
              <th>نوع الدراسة</th>
              <th>المجموعة</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.code ?? "—"}</td>
                <td>{s.universityNumber}</td>
                <td>
                  {s.nameAr}
                  {s.nameEn ? ` (${s.nameEn})` : ""}
                </td>
                <td>{s.email ?? "—"}</td>
                <td>{s.courseLabel ?? "—"}</td>
                <td>{s.shift ? SHIFT_LABEL[s.shift] : "—"}</td>
                <td>{s.studyTypeName ?? "—"}</td>
                <td>{s.groupName ?? "—"}</td>
                <td>
                  <span className={`badge ${s.active ? "badge-green" : "badge-gray"}`}>
                    {s.active ? "فعّال" : "معطّل"}
                  </span>
                </td>
                <td>
                  <form action={toggleStudentActiveAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                    <button type="submit" className="btn btn-secondary text-xs px-2 py-1">
                      {s.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-slate-400 py-6">
                  لا يوجد طلاب بعد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
