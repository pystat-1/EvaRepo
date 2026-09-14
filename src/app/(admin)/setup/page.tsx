import { listCourses } from "@/lib/models/courses";
import { listStudyTypes } from "@/lib/models/studyTypes";
import { listHospitals } from "@/lib/models/hospitals";
import { listGroups } from "@/lib/models/groups";
import { listStudents } from "@/lib/models/students";
import { listAllRotationBlocks } from "@/lib/models/rotationBlocks";
import { createCourseAction } from "@/lib/actions/courses";
import { createStudyTypeAction } from "@/lib/actions/studyTypes";
import { createHospitalAction } from "@/lib/actions/hospitals";
import { createGroupAction } from "@/lib/actions/groups";
import { createStudentAction } from "@/lib/actions/students";
import { createRotationBlockAction } from "@/lib/actions/rotationBlocks";

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

// A small, distinct qualitative palette — stable per hospital via a hash of
// its id, so the same hospital always gets the same color across renders.
const PALETTE = [
  "#2563eb", "#16a34a", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#dc2626", "#4b5563",
];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export default async function SetupPage() {
  const [courses, studyTypes, hospitals, groups, students, blocks] = await Promise.all([
    listCourses(true),
    listStudyTypes(true),
    listHospitals(true),
    listGroups(true),
    listStudents(true),
    listAllRotationBlocks(false),
  ]);

  const activeGroups = groups.filter((g) => g.active);
  const todayISO = new Date().toISOString().slice(0, 10);

  // Timeline window: span of all scheduled blocks, padded a couple of days
  // each side; falls back to a 14-day window from today when nothing is
  // scheduled yet so the empty state still has something to point at.
  let windowStart = todayISO;
  let windowEnd = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  if (blocks.length > 0) {
    windowStart = blocks.reduce((min, b) => (b.startDate < min ? b.startDate : min), blocks[0].startDate);
    windowEnd = blocks.reduce((max, b) => (b.endDate > max ? b.endDate : max), blocks[0].endDate);
  }
  const totalDays = Math.max(1, daysBetween(windowStart, windowEnd) + 1);
  const todayOffsetPct =
    todayISO >= windowStart && todayISO <= windowEnd ? (daysBetween(windowStart, todayISO) / totalDays) * 100 : null;

  const blocksByGroup = new Map<string, typeof blocks>();
  for (const b of blocks) {
    if (!blocksByGroup.has(b.groupId)) blocksByGroup.set(b.groupId, []);
    blocksByGroup.get(b.groupId)!.push(b);
  }
  const usedHospitalIds = Array.from(new Set(blocks.map((b) => b.hospitalId)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">لوحة الإعداد</h1>
        <p className="text-slate-500 mt-1">
          نقطة البداية لإعداد فصل دراسي جديد: الدورة، أنواع الدراسة، المستشفيات، المجموعات،
          الطلاب، وجدول الدوران — كل عنصر هنا هو الأساس الذي تُبنى عليه بقية الوظائف (التقييم
          والإحصائيات).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <SetupCard title="الدورات" count={courses.filter((c) => c.active).length} href="/courses">
          <form action={createCourseAction} className="flex flex-col gap-2">
            <input name="year" type="number" required min={2000} placeholder="السنة" className="input" />
            <select name="number" required className="input">
              <option value="1">دورة ١</option>
              <option value="2">دورة ٢</option>
            </select>
            <input name="label" placeholder="تسمية (اختياري)" className="input" />
            <button type="submit" className="btn btn-primary">
              إضافة دورة
            </button>
          </form>
        </SetupCard>

        <SetupCard title="أنواع الدراسة" count={studyTypes.filter((s) => s.active).length} href="/study-types">
          <form action={createStudyTypeAction} className="flex flex-col gap-2">
            <input name="name" required placeholder="الاسم (إنجليزي)" className="input" />
            <input name="nameAr" placeholder="الاسم (عربي)" className="input" />
            <input name="code" required maxLength={4} placeholder="الرمز (N)" className="input uppercase" />
            <button type="submit" className="btn btn-primary">
              إضافة نوع
            </button>
          </form>
        </SetupCard>

        <SetupCard title="المستشفيات" count={hospitals.filter((h) => h.active).length} href="/hospitals">
          <form action={createHospitalAction} className="flex flex-col gap-2">
            <input name="name" required placeholder="الاسم" className="input" />
            <input name="nameAr" placeholder="الاسم (عربي)" className="input" />
            <button type="submit" className="btn btn-primary">
              إضافة مستشفى
            </button>
          </form>
        </SetupCard>

        <SetupCard title="المجموعات" count={activeGroups.length} href="/groups">
          <form action={createGroupAction} className="flex flex-col gap-2">
            <input name="name" required placeholder="اسم المجموعة" className="input" />
            <select name="courseId" className="input">
              <option value="">الدورة — بدون —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? `${c.year}-${c.number}`}
                </option>
              ))}
            </select>
            <select name="shift" className="input">
              <option value="">الوردية — بدون —</option>
              <option value="MORNING">صباحي</option>
              <option value="EVENING">مسائي</option>
            </select>
            <select name="studyTypeId" className="input">
              <option value="">نوع الدراسة — بدون —</option>
              {studyTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.nameAr ?? st.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary">
              إضافة مجموعة
            </button>
          </form>
        </SetupCard>

        <SetupCard title="الطلاب" count={students.filter((s) => s.active).length} href="/students">
          <form action={createStudentAction} className="flex flex-col gap-2">
            <input name="universityNumber" required placeholder="الرقم الجامعي" className="input" />
            <input name="nameAr" required placeholder="الاسم (عربي)" className="input" />
            <select name="courseId" className="input">
              <option value="">الدورة — بدون —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? `${c.year}-${c.number}`}
                </option>
              ))}
            </select>
            <select name="studyTypeId" className="input">
              <option value="">نوع الدراسة — بدون —</option>
              {studyTypes.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.nameAr ?? st.name}
                </option>
              ))}
            </select>
            <select name="groupId" className="input">
              <option value="">المجموعة — بدون —</option>
              {activeGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary">
              إضافة طالب
            </button>
          </form>
        </SetupCard>
      </div>

      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div>
            <h2 className="font-semibold">جدول الدوران — نظرة عامة</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              كل صف مجموعة، وكل شريط ملوّن فترة في مستشفى معيّن. الاتجاه من اليسار (الأقدم) إلى
              اليمين (الأحدث).
            </p>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600 select-none">+ إضافة فترة دوران</summary>
            <form action={createRotationBlockAction} className="flex flex-wrap items-end gap-2 mt-2">
              <select name="groupId" required className="input">
                <option value="">المجموعة</option>
                {activeGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select name="hospitalId" required className="input">
                <option value="">المستشفى</option>
                {hospitals.filter((h) => h.active).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <input name="startDate" type="date" required className="input" />
              <input name="endDate" type="date" required className="input" />
              <input name="daysOfWeek" placeholder="أيام (SUN,TUE)" className="input" />
              <button type="submit" className="btn btn-secondary">
                إضافة
              </button>
            </form>
          </details>
        </div>

        {usedHospitalIds.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4 text-xs">
            {usedHospitalIds.map((hid) => {
              const h = hospitals.find((x) => x.id === hid);
              return (
                <span key={hid} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: colorFor(hid) }}
                  />
                  {h?.name ?? hid}
                </span>
              );
            })}
          </div>
        )}

        {activeGroups.length === 0 ? (
          <p className="text-center text-slate-400 py-6">لا توجد مجموعات فعّالة بعد</p>
        ) : blocks.length === 0 ? (
          <p className="text-center text-slate-400 py-6">لا يوجد جدول دوران مُعدّ بعد</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3" dir="ltr">
              <div className="w-40 shrink-0" />
              <div className="flex-1 flex justify-between text-xs text-slate-400">
                <span>{windowStart}</span>
                <span>{windowEnd}</span>
              </div>
            </div>
            {activeGroups
              .filter((g) => blocksByGroup.has(g.id))
              .map((g) => (
                <div key={g.id} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 text-sm">
                    <div className="font-medium truncate">{g.name}</div>
                    <div className="text-xs text-slate-400 truncate">
                      {[g.shift ? SHIFT_LABEL[g.shift] : null, g.studyTypeName].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex-1 relative h-8 bg-slate-50 rounded-md border border-slate-200" dir="ltr">
                    {todayOffsetPct !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-400"
                        style={{ left: `${todayOffsetPct}%` }}
                        title={`اليوم: ${todayISO}`}
                      />
                    )}
                    {blocksByGroup.get(g.id)!.map((b) => {
                      const left = (daysBetween(windowStart, b.startDate) / totalDays) * 100;
                      const width = Math.max(
                        2,
                        ((daysBetween(b.startDate, b.endDate) + 1) / totalDays) * 100
                      );
                      return (
                        <div
                          key={b.id}
                          className="absolute top-0.5 bottom-0.5 rounded-sm flex items-center px-1.5 overflow-hidden"
                          style={{ left: `${left}%`, width: `${width}%`, background: colorFor(b.hospitalId) }}
                          title={`${b.hospitalName} — ${b.startDate} إلى ${b.endDate}${b.daysOfWeek ? ` (${b.daysOfWeek})` : ""}`}
                        >
                          <span className="text-[10px] text-white truncate">{b.hospitalName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SetupCard({
  title,
  count,
  href,
  children,
}: {
  title: string;
  count: number;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        <a href={href} className="text-xs text-slate-500 hover:underline">
          عرض الكل ({count})
        </a>
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-slate-600 select-none">+ إضافة سريعة</summary>
        <div className="mt-3">{children}</div>
      </details>
    </div>
  );
}
