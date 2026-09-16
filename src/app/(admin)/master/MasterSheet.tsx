"use client";

import { useMemo, useState } from "react";
import type { Hospital } from "@/lib/models/hospitals";
import type { EvaluatorWithAssignments } from "@/lib/models/evaluators";
import type { StudentWithRelations } from "@/lib/models/students";
import type { Course } from "@/lib/models/courses";
import type { GroupWithRelations } from "@/lib/models/groups";
import type { StudyType } from "@/lib/models/studyTypes";
import { createHospitalAction, toggleHospitalActiveAction } from "@/lib/actions/hospitals";
import {
  createEvaluatorAction,
  toggleEvaluatorActiveAction,
  toggleAssignmentActiveAction,
} from "@/lib/actions/evaluators";
import { createStudentAction, toggleStudentActiveAction } from "@/lib/actions/students";
import { createCourseAction, toggleCourseActiveAction } from "@/lib/actions/courses";
import { createGroupAction, toggleGroupActiveAction } from "@/lib/actions/groups";
import { createStudyTypeAction, toggleStudyTypeActiveAction } from "@/lib/actions/studyTypes";

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

// Fixed, validated categorical hues (see dataviz palette) — one per entity
// section, used only as light tints + accent lines so contrast never
// depends on the raw hue (text always stays dark ink on a near-white tint).
const SECTIONS = {
  hospitals: { icon: "🏥", accent: "#2a78d6", tint: "#eaf2fc", title: "المستشفيات", href: "/hospitals" },
  evaluators: { icon: "🩺", accent: "#4a3aa7", tint: "#eeecfa", title: "المقيّمون", href: "/evaluators" },
  students: { icon: "🎓", accent: "#1baf7a", tint: "#e7f8f1", title: "الطلاب", href: "/students" },
  courses: { icon: "📚", accent: "#eb6834", tint: "#fdeee7", title: "الدورات", href: "/courses" },
  groups: { icon: "👥", accent: "#e87ba4", tint: "#fceef3", title: "المجموعات", href: "/groups" },
  studyTypes: { icon: "🧪", accent: "#c98500", tint: "#fdf3e0", title: "أنواع الدراسة", href: "/study-types" },
} as const;

type SectionKey = keyof typeof SECTIONS;

function matches(row: unknown, q: string): boolean {
  if (!q) return true;
  return JSON.stringify(row).toLowerCase().includes(q);
}

function StatusBadge({ active, onLabel = "فعّال", offLabel = "معطّل" }: { active: boolean; onLabel?: string; offLabel?: string }) {
  return <span className={`badge ${active ? "badge-green" : "badge-gray"}`}>{active ? onLabel : offLabel}</span>;
}

function ToggleButton({
  action,
  hiddenFields,
  active,
}: {
  action: (formData: FormData) => void;
  hiddenFields: Record<string, string>;
  active: boolean;
}) {
  return (
    <form action={action}>
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button type="submit" className="text-xs px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 whitespace-nowrap">
        {active ? "تعطيل" : "تفعيل"}
      </button>
    </form>
  );
}

function SectionShell({
  sectionKey,
  count,
  children,
  addForm,
}: {
  sectionKey: SectionKey;
  count: number;
  children: React.ReactNode;
  addForm?: React.ReactNode;
}) {
  const s = SECTIONS[sectionKey];
  return (
    <section id={sectionKey} className="rounded-xl border border-slate-200 overflow-hidden scroll-mt-24 bg-white">
      <div
        className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 border-b"
        style={{ background: s.tint, borderColor: s.accent + "33" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
            style={{ background: "white", boxShadow: `inset 0 0 0 2px ${s.accent}55` }}
          >
            {s.icon}
          </span>
          <div>
            <h2 className="font-bold text-sm" style={{ color: s.accent }}>
              {s.title}
            </h2>
            <span className="text-xs text-slate-500">{count} سجل</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {addForm && (
            <details className="relative text-xs">
              <summary
                className="cursor-pointer select-none px-2.5 py-1.5 rounded-md font-semibold text-white"
                style={{ background: s.accent }}
              >
                + إضافة
              </summary>
              <div className="absolute z-10 end-0 mt-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg w-[min(90vw,560px)]">
                {addForm}
              </div>
            </details>
          )}
          <a href={s.href} className="text-xs font-medium hover:underline" style={{ color: s.accent }}>
            الصفحة الكاملة ←
          </a>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">{children}</div>
    </section>
  );
}

export default function MasterSheet({
  hospitals,
  evaluators,
  students,
  courses,
  groups,
  studyTypes,
}: {
  hospitals: Hospital[];
  evaluators: EvaluatorWithAssignments[];
  students: StudentWithRelations[];
  courses: Course[];
  groups: GroupWithRelations[];
  studyTypes: StudyType[];
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const fHospitals = useMemo(() => hospitals.filter((r) => matches(r, q)), [hospitals, q]);
  const fEvaluators = useMemo(() => evaluators.filter((r) => matches(r, q)), [evaluators, q]);
  const fStudents = useMemo(() => students.filter((r) => matches(r, q)), [students, q]);
  const fCourses = useMemo(() => courses.filter((r) => matches(r, q)), [courses, q]);
  const fGroups = useMemo(() => groups.filter((r) => matches(r, q)), [groups, q]);
  const fStudyTypes = useMemo(() => studyTypes.filter((r) => matches(r, q)), [studyTypes, q]);

  const stats: { key: SectionKey; count: number; activeCount: number }[] = [
    { key: "hospitals", count: hospitals.length, activeCount: hospitals.filter((h) => h.active).length },
    { key: "evaluators", count: evaluators.length, activeCount: evaluators.filter((e) => e.active).length },
    { key: "students", count: students.length, activeCount: students.filter((s) => s.active).length },
    { key: "courses", count: courses.length, activeCount: courses.filter((c) => c.active).length },
    { key: "groups", count: groups.length, activeCount: groups.filter((g) => g.active).length },
    { key: "studyTypes", count: studyTypes.length, activeCount: studyTypes.filter((s) => s.active).length },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">الجدول الشامل</h1>
        <p className="text-slate-500 mt-1">
          كل بيانات الإعداد — المستشفيات، المقيّمون، الطلاب، الدورات، المجموعات، وأنواع
          الدراسة — في نافذة واحدة منظّمة كورقة عمل بدل التنقّل بين تبويبات منفصلة. استخدم
          البحث أدناه للتصفية الفورية عبر كل الأقسام معًا.
        </p>
      </div>

      {/* Stat tiles: quick counts per section, colored to match its table below */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(({ key, count, activeCount }) => {
          const s = SECTIONS[key];
          return (
            <a
              key={key}
              href={`#${key}`}
              className="rounded-xl border border-slate-200 p-3 flex flex-col gap-1 hover:shadow-md transition-shadow"
              style={{ background: s.tint }}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: s.accent }}>
                <span>{s.icon}</span>
                {s.title}
              </span>
              <span className="text-2xl font-bold text-slate-800">{count}</span>
              <span className="text-[11px] text-slate-500">{activeCount} فعّال</span>
            </a>
          );
        })}
      </div>

      {/* Sticky search + jump bar */}
      <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur py-2 -my-2 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="input flex-1 min-w-[220px]"
          placeholder="بحث فوري في كل الأقسام — اسم، بريد، رقم جامعي، رمز..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SECTIONS) as SectionKey[]).map((key) => {
            const s = SECTIONS[key];
            return (
              <a
                key={key}
                href={`#${key}`}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-full border"
                style={{ color: s.accent, borderColor: s.accent + "55", background: s.tint }}
              >
                {s.icon} {s.title}
              </a>
            );
          })}
        </div>
      </div>

      <SectionShell
        sectionKey="hospitals"
        count={fHospitals.length}
        addForm={
          <form action={createHospitalAction} className="flex flex-col gap-2">
            <input name="name" required placeholder="الاسم" className="input" />
            <input name="nameAr" placeholder="الاسم (عربي)" className="input" />
            <input name="address" placeholder="العنوان" className="input" />
            <button type="submit" className="btn btn-primary">إضافة مستشفى</button>
          </form>
        }
      >
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
            {fHospitals.map((h, i) => (
              <tr key={h.id} style={{ background: i % 2 ? SECTIONS.hospitals.tint + "80" : "transparent" }}>
                <td className="font-medium">{h.name}</td>
                <td>{h.nameAr ?? "—"}</td>
                <td>{h.address ?? "—"}</td>
                <td><StatusBadge active={h.active} /></td>
                <td>
                  <ToggleButton action={toggleHospitalActiveAction} hiddenFields={{ id: h.id }} active={h.active} />
                </td>
              </tr>
            ))}
            {fHospitals.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد نتائج</td></tr>
            )}
          </tbody>
        </table>
      </SectionShell>

      <SectionShell
        sectionKey="evaluators"
        count={fEvaluators.reduce((n, e) => n + Math.max(1, e.assignments.length), 0)}
        addForm={
          <form action={createEvaluatorAction} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input name="name" required placeholder="الاسم" className="input" />
            <input name="email" type="email" required placeholder="البريد الإلكتروني" className="input" />
            <input name="password" required minLength={8} placeholder="كلمة المرور المبدئية" className="input" />
            <select name="hospitalId" required className="input">
              <option value="">— المستشفى —</option>
              {hospitals.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <select name="groupId" className="input sm:col-span-2">
              <option value="">— كل مجموعات المستشفى —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary sm:col-span-2">إضافة مقيّم</button>
          </form>
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد الإلكتروني</th>
              <th>المستشفى</th>
              <th>المجموعة</th>
              <th>حالة الحساب</th>
              <th>حالة التخصيص</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fEvaluators.flatMap((ev, i) => {
              const rows = ev.assignments.length > 0 ? ev.assignments : [null];
              return rows.map((a, j) => (
                <tr key={a ? a.id : ev.id} style={{ background: i % 2 ? SECTIONS.evaluators.tint + "80" : "transparent" }}>
                  {j === 0 && (
                    <>
                      <td className="font-medium" rowSpan={rows.length}>{ev.name}</td>
                      <td rowSpan={rows.length}>{ev.email}</td>
                    </>
                  )}
                  <td>{a?.hospitalName ?? "—"}</td>
                  <td>{a?.groupName ?? (a ? "كل المجموعات" : "—")}</td>
                  {j === 0 && (
                    <td rowSpan={rows.length}>
                      <div className="flex items-center gap-2">
                        <StatusBadge active={ev.active} />
                        <ToggleButton action={toggleEvaluatorActiveAction} hiddenFields={{ accountId: ev.id }} active={ev.active} />
                      </div>
                    </td>
                  )}
                  <td>{a && <StatusBadge active={a.active} onLabel="فعّالة" offLabel="معطّلة" />}</td>
                  <td>
                    {a && (
                      <ToggleButton action={toggleAssignmentActiveAction} hiddenFields={{ assignmentId: a.id }} active={a.active} />
                    )}
                  </td>
                </tr>
              ));
            })}
            {fEvaluators.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد نتائج</td></tr>
            )}
          </tbody>
        </table>
      </SectionShell>

      <SectionShell
        sectionKey="students"
        count={fStudents.length}
        addForm={
          <form action={createStudentAction} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input name="universityNumber" required placeholder="الرقم الجامعي" className="input" />
            <input name="nameAr" required placeholder="الاسم (عربي)" className="input" />
            <input name="nameEn" placeholder="الاسم (إنجليزي)" className="input" />
            <input name="email" type="email" placeholder="البريد الإلكتروني" className="input" />
            <select name="courseId" className="input">
              <option value="">— الدورة —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.label ?? `${c.year}-${c.number}`}</option>
              ))}
            </select>
            <select name="shift" className="input">
              <option value="">— الوردية —</option>
              <option value="MORNING">صباحي</option>
              <option value="EVENING">مسائي</option>
            </select>
            <select name="studyTypeId" className="input">
              <option value="">— نوع الدراسة —</option>
              {studyTypes.map((st) => (
                <option key={st.id} value={st.id}>{st.nameAr ?? st.name}</option>
              ))}
            </select>
            <select name="groupId" className="input">
              <option value="">— المجموعة —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary sm:col-span-2">إضافة طالب</button>
          </form>
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>الرمز</th>
              <th>الرقم الجامعي</th>
              <th>الاسم</th>
              <th>الدورة</th>
              <th>الوردية</th>
              <th>نوع الدراسة</th>
              <th>المجموعة</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fStudents.map((s, i) => (
              <tr key={s.id} style={{ background: i % 2 ? SECTIONS.students.tint + "80" : "transparent" }}>
                <td>{s.code ?? "—"}</td>
                <td>{s.universityNumber}</td>
                <td className="font-medium">{s.nameAr}{s.nameEn ? ` (${s.nameEn})` : ""}</td>
                <td>{s.courseLabel ?? "—"}</td>
                <td>{s.shift ? SHIFT_LABEL[s.shift] : "—"}</td>
                <td>{s.studyTypeName ?? "—"}</td>
                <td>{s.groupName ?? "—"}</td>
                <td><StatusBadge active={s.active} /></td>
                <td>
                  <ToggleButton action={toggleStudentActiveAction} hiddenFields={{ id: s.id }} active={s.active} />
                </td>
              </tr>
            ))}
            {fStudents.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-6">لا توجد نتائج</td></tr>
            )}
          </tbody>
        </table>
      </SectionShell>

      <SectionShell
        sectionKey="courses"
        count={fCourses.length}
        addForm={
          <form action={createCourseAction} className="flex flex-wrap gap-2 items-end">
            <input name="year" type="number" required min={2000} placeholder="السنة" className="input" />
            <select name="number" required className="input">
              <option value="1">دورة ١</option>
              <option value="2">دورة ٢</option>
            </select>
            <input name="label" placeholder="تسمية (اختياري)" className="input" />
            <button type="submit" className="btn btn-primary">إضافة</button>
          </form>
        }
      >
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
            {fCourses.map((c, i) => (
              <tr key={c.id} style={{ background: i % 2 ? SECTIONS.courses.tint + "80" : "transparent" }}>
                <td className="font-medium">{c.year}</td>
                <td>{c.number}</td>
                <td>{c.label ?? "—"}</td>
                <td><StatusBadge active={c.active} onLabel="فعّالة" offLabel="معطّلة" /></td>
                <td>
                  <ToggleButton action={toggleCourseActiveAction} hiddenFields={{ id: c.id }} active={c.active} />
                </td>
              </tr>
            ))}
            {fCourses.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد نتائج</td></tr>
            )}
          </tbody>
        </table>
      </SectionShell>

      <SectionShell
        sectionKey="groups"
        count={fGroups.length}
        addForm={
          <form action={createGroupAction} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input name="name" required placeholder="اسم المجموعة" className="input" />
            <select name="courseId" className="input">
              <option value="">— الدورة —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.label ?? `${c.year}-${c.number}`}</option>
              ))}
            </select>
            <select name="shift" className="input">
              <option value="">— الوردية —</option>
              <option value="MORNING">صباحي</option>
              <option value="EVENING">مسائي</option>
            </select>
            <select name="studyTypeId" className="input">
              <option value="">— نوع الدراسة —</option>
              {studyTypes.map((st) => (
                <option key={st.id} value={st.id}>{st.nameAr ?? st.name}</option>
              ))}
            </select>
            <input name="cycleLabel" placeholder="الدفعة (اختياري)" className="input" />
            <button type="submit" className="btn btn-primary sm:col-span-2">إضافة مجموعة</button>
          </form>
        }
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الدورة</th>
              <th>الوردية</th>
              <th>نوع الدراسة</th>
              <th>الطلاب</th>
              <th>المستشفى الحالي</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {fGroups.map((g, i) => (
              <tr key={g.id} style={{ background: i % 2 ? SECTIONS.groups.tint + "80" : "transparent" }}>
                <td className="font-medium">{g.name}</td>
                <td>{g.courseLabel ?? "—"}</td>
                <td>{g.shift ? SHIFT_LABEL[g.shift] : "—"}</td>
                <td>{g.studyTypeName ?? "—"}</td>
                <td>{g.studentCount}</td>
                <td>{g.currentHospitalName ?? "—"}</td>
                <td><StatusBadge active={g.active} onLabel="فعّالة" offLabel="معطّلة" /></td>
                <td>
                  <ToggleButton action={toggleGroupActiveAction} hiddenFields={{ id: g.id }} active={g.active} />
                </td>
              </tr>
            ))}
            {fGroups.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-6">لا توجد نتائج</td></tr>
            )}
          </tbody>
        </table>
      </SectionShell>

      <SectionShell
        sectionKey="studyTypes"
        count={fStudyTypes.length}
        addForm={
          <form action={createStudyTypeAction} className="flex flex-wrap gap-2 items-end">
            <input name="name" required placeholder="الاسم (إنجليزي)" className="input" />
            <input name="nameAr" placeholder="الاسم (عربي)" className="input" />
            <input name="code" required maxLength={4} placeholder="الرمز" className="input uppercase" />
            <button type="submit" className="btn btn-primary">إضافة</button>
          </form>
        }
      >
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
            {fStudyTypes.map((st, i) => (
              <tr key={st.id} style={{ background: i % 2 ? SECTIONS.studyTypes.tint + "80" : "transparent" }}>
                <td className="font-medium">{st.name}</td>
                <td>{st.nameAr ?? "—"}</td>
                <td>{st.code ?? "—"}</td>
                <td><StatusBadge active={st.active} /></td>
                <td>
                  <ToggleButton action={toggleStudyTypeActiveAction} hiddenFields={{ id: st.id }} active={st.active} />
                </td>
              </tr>
            ))}
            {fStudyTypes.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد نتائج</td></tr>
            )}
          </tbody>
        </table>
      </SectionShell>
    </div>
  );
}
