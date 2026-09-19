"use client";

import { useState, useTransition } from "react";
import type { Course } from "@/lib/models/courses";
import type { StudyType } from "@/lib/models/studyTypes";
import type { Hospital } from "@/lib/models/hospitals";
import type { GroupWithRelations } from "@/lib/models/groups";
import type { StudentWithRelations } from "@/lib/models/students";
import type { EvaluatorWithAssignments } from "@/lib/models/evaluators";
import type { RotationBlockWithGroup } from "@/lib/models/rotationBlocks";
import type { TermSettings } from "@/lib/models/termSettings";
import { saveWeeksAction, saveDaysAction } from "@/lib/actions/termSettings";
import { createHospitalAction } from "@/lib/actions/hospitals";
import { createStudyTypeAction } from "@/lib/actions/studyTypes";
import { createCourseAction } from "@/lib/actions/courses";
import { createStudentAction } from "@/lib/actions/students";
import { createGroupAction } from "@/lib/actions/groups";
import { createEvaluatorAction } from "@/lib/actions/evaluators";
import { createRotationBlockAction } from "@/lib/actions/rotationBlocks";
import { generateScheduleAction, clearAutoScheduleAction } from "@/lib/actions/scheduleEngine";
import type { GenerateResult } from "@/lib/models/scheduleEngine";
import { WEEKDAYS } from "@/lib/weekdays";

const SHIFT_LABEL: Record<string, string> = { MORNING: "صباحي", EVENING: "مسائي" };

// Stable per-hospital color (hash of id) so a hospital keeps its hue across
// the rotation timeline renders. Same palette as the old setup overview.
const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#dc2626", "#4b5563"];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export interface SetupData {
  term: TermSettings;
  courses: Course[];
  studyTypes: StudyType[];
  hospitals: Hospital[];
  groups: GroupWithRelations[];
  students: StudentWithRelations[];
  evaluators: EvaluatorWithAssignments[];
  blocks: RotationBlockWithGroup[];
}

interface StepDef {
  key: string;
  label: string;
  done: (d: SetupData) => boolean;
}

// The seven-step course-setup flow, in the order the user walks it. Steps
// are free-navigation: `done` drives the progress indicator but never gates
// access, so an admin can jump back to edit any earlier step.
const STEPS: StepDef[] = [
  { key: "weeks", label: "عدد الأسابيع", done: (d) => d.term.weeksCount != null },
  { key: "days", label: "أيام الأسبوع", done: (d) => d.term.daysPerWeek != null },
  { key: "hospitals", label: "المستشفيات", done: (d) => d.hospitals.some((h) => h.active) },
  {
    key: "students",
    label: "الطلاب وأنواع الدراسة",
    done: (d) => d.studyTypes.some((s) => s.active) && d.students.some((s) => s.active),
  },
  { key: "groups", label: "مجموعات الطلاب", done: (d) => d.groups.some((g) => g.active) },
  {
    key: "supervisors",
    label: "المشرفون لكل مستشفى",
    done: (d) => d.evaluators.some((e) => e.assignments.some((a) => a.active)),
  },
  { key: "rotation", label: "جدول الدوران", done: (d) => d.blocks.length > 0 },
];

export default function SetupWizard({ data }: { data: SetupData }) {
  const [active, setActive] = useState(0);
  const doneCount = STEPS.filter((s) => s.done(data)).length;
  const step = STEPS[active];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">إعداد الدورة</h1>
        <p className="text-slate-500 mt-1">
          مرّ بالخطوات بالترتيب لإعداد فصل دراسي كامل. يمكنك التنقّل بين الخطوات بحرية والعودة
          لأي خطوة لتعديلها. بعد اكتمال الإعداد، اطّلع على{" "}
          <a href="/master" className="text-blue-600 hover:underline">
            الجدول الشامل
          </a>{" "}
          لعرض كل البيانات في مكان واحد.
        </p>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${(doneCount / STEPS.length) * 100}%`, background: "var(--brand-dark, #16a34a)" }}
          />
        </div>
        <span className="text-sm text-slate-500 whitespace-nowrap">
          {doneCount} / {STEPS.length} مكتملة
        </span>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => {
          const done = s.done(data);
          const isActive = i === active;
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setActive(i)}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition"
                style={{
                  borderColor: isActive ? "#2563eb" : "var(--border, #e2e8f0)",
                  background: isActive ? "#eff6ff" : done ? "#f0fdf4" : "var(--surface-raised, #fff)",
                }}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: done ? "#16a34a" : isActive ? "#2563eb" : "#94a3b8" }}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={isActive ? "font-semibold" : ""}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Active step panel */}
      <div className="card">
        <StepPanel stepKey={step.key} data={data} />
      </div>

      {/* Prev / next */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={active === 0}
          onClick={() => setActive((a) => Math.max(0, a - 1))}
        >
          ← السابق
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={active === STEPS.length - 1}
          onClick={() => setActive((a) => Math.min(STEPS.length - 1, a + 1))}
        >
          التالي →
        </button>
      </div>
    </div>
  );
}

function StepPanel({ stepKey, data }: { stepKey: string; data: SetupData }) {
  switch (stepKey) {
    case "weeks":
      return <WeeksStep data={data} />;
    case "days":
      return <DaysStep data={data} />;
    case "hospitals":
      return <HospitalsStep data={data} />;
    case "students":
      return <StudentsStep data={data} />;
    case "groups":
      return <GroupsStep data={data} />;
    case "supervisors":
      return <SupervisorsStep data={data} />;
    case "rotation":
      return <RotationStep data={data} />;
    default:
      return null;
  }
}

function StepHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-semibold text-lg">{title}</h2>
      <p className="text-sm text-slate-500 mt-0.5">{hint}</p>
    </div>
  );
}

function WeeksStep({ data }: { data: SetupData }) {
  return (
    <div>
      <StepHeader title="عدد الأسابيع" hint="حدّد عدد أسابيع الفصل الدراسي وتاريخ بدايته (اختياري)." />
      <form action={saveWeeksAction} className="flex flex-wrap items-end gap-3 max-w-xl">
        <label className="flex flex-col gap-1 text-sm">
          <span>عدد الأسابيع</span>
          <input
            name="weeksCount"
            type="number"
            min={1}
            max={52}
            required
            defaultValue={data.term.weeksCount ?? ""}
            className="input w-32"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>تاريخ البداية (اختياري)</span>
          <input name="startDate" type="date" defaultValue={data.term.startDate ?? ""} className="input" />
        </label>
        <button type="submit" className="btn btn-primary">
          حفظ
        </button>
      </form>
      {data.term.weeksCount != null && (
        <p className="mt-3 text-sm text-green-700">
          ✓ محفوظ: {data.term.weeksCount} أسبوعاً{data.term.startDate ? ` — يبدأ ${data.term.startDate}` : ""}
        </p>
      )}
    </div>
  );
}

function DaysStep({ data }: { data: SetupData }) {
  const selected = (data.term.weekdays ?? "").split(",").filter(Boolean);
  return (
    <div>
      <StepHeader
        title="أيام الأسبوع"
        hint="اختر أيام الحضور الأسبوعية. عدد الأيام يُحتسب تلقائياً من اختيارك."
      />
      <form action={saveDaysAction} className="flex flex-col gap-3 max-w-xl">
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <label
              key={d.code}
              className="flex items-center gap-1.5 text-sm bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 cursor-pointer"
            >
              <input type="checkbox" name="weekdays" value={d.code} defaultChecked={selected.includes(d.code)} />
              {d.labelAr}
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-primary self-start">
          حفظ
        </button>
      </form>
      {data.term.daysPerWeek != null && (
        <p className="mt-3 text-sm text-green-700">
          ✓ محفوظ: {data.term.daysPerWeek} أيام في الأسبوع
          {data.term.weekdays
            ? ` (${data.term.weekdays
                .split(",")
                .map((c) => WEEKDAYS.find((w) => w.code === c)?.labelAr ?? c)
                .join("، ")})`
            : ""}
        </p>
      )}
    </div>
  );
}

function HospitalsStep({ data }: { data: SetupData }) {
  const active = data.hospitals.filter((h) => h.active);
  return (
    <div>
      <StepHeader title="المستشفيات" hint="أضف المستشفيات التي يتوزّع عليها الطلاب أثناء الدوران." />
      <form action={createHospitalAction} className="flex flex-wrap items-end gap-2 mb-4">
        <input name="name" required placeholder="اسم المستشفى" className="input" />
        <input name="nameAr" placeholder="الاسم (عربي)" className="input" />
        <button type="submit" className="btn btn-primary">
          إضافة مستشفى
        </button>
      </form>
      <MiniList
        items={active.map((h) => ({ id: h.id, primary: h.name, secondary: h.nameAr ?? "" }))}
        empty="لا توجد مستشفيات بعد"
        href="/hospitals"
      />
    </div>
  );
}

function StudentsStep({ data }: { data: SetupData }) {
  const activeStudyTypes = data.studyTypes.filter((s) => s.active);
  const activeGroups = data.groups.filter((g) => g.active);
  const byType = new Map<string, StudentWithRelations[]>();
  for (const s of data.students.filter((x) => x.active)) {
    const key = s.studyTypeName ?? "— بدون نوع —";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(s);
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <StepHeader
          title="أنواع الدراسة"
          hint="عرّف أنواع الدراسة (مثل: تمريض) قبل إضافة الطلاب — كل طالب يُصنّف حسب نوعه."
        />
        <form action={createStudyTypeAction} className="flex flex-wrap items-end gap-2">
          <input name="name" required placeholder="الاسم (إنجليزي)" className="input" />
          <input name="nameAr" placeholder="الاسم (عربي)" className="input" />
          <input name="code" required maxLength={4} placeholder="الرمز (N)" className="input uppercase w-24" />
          <button type="submit" className="btn btn-secondary">
            إضافة نوع
          </button>
        </form>
        <div className="flex flex-wrap gap-2 mt-2">
          {activeStudyTypes.map((st) => (
            <span key={st.id} className="badge badge-gray">
              {st.nameAr ?? st.name} {st.code ? `(${st.code})` : ""}
            </span>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 pt-5">
        <StepHeader title="الطلاب" hint="أضف الطلاب وصنّف كلاً منهم حسب نوع الدراسة." />
        {data.courses.length === 0 && (
          <form action={createCourseAction} className="flex flex-wrap items-end gap-2 mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <span className="w-full text-sm text-amber-800">لا توجد دورة بعد — أضف واحدة أولاً:</span>
            <input name="year" type="number" required min={2000} placeholder="السنة" className="input w-28" />
            <select name="number" required className="input">
              <option value="1">دورة ١</option>
              <option value="2">دورة ٢</option>
            </select>
            <input name="label" placeholder="تسمية (اختياري)" className="input" />
            <button type="submit" className="btn btn-secondary">
              إضافة دورة
            </button>
          </form>
        )}
        <form action={createStudentAction} className="flex flex-wrap items-end gap-2 mb-4">
          <input name="universityNumber" required placeholder="الرقم الجامعي" className="input w-36" />
          <input name="nameAr" required placeholder="الاسم (عربي)" className="input" />
          <select name="studyTypeId" required className="input">
            <option value="">نوع الدراسة</option>
            {activeStudyTypes.map((st) => (
              <option key={st.id} value={st.id}>
                {st.nameAr ?? st.name}
              </option>
            ))}
          </select>
          <select name="courseId" className="input">
            <option value="">الدورة — بدون —</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label ?? `${c.year}-${c.number}`}
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

        {byType.size === 0 ? (
          <p className="text-center text-slate-400 py-4">لا يوجد طلاب بعد</p>
        ) : (
          <div className="flex flex-col gap-4">
            {Array.from(byType.entries()).map(([type, list]) => (
              <div key={type}>
                <h3 className="text-sm font-semibold text-slate-600 mb-1">
                  {type} <span className="text-slate-400 font-normal">({list.length})</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((s) => (
                    <span key={s.id} className="badge badge-gray" title={s.universityNumber}>
                      {s.nameAr}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <a href="/students" className="text-xs text-slate-500 hover:underline">
              إدارة كل الطلاب →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupsStep({ data }: { data: SetupData }) {
  const activeStudyTypes = data.studyTypes.filter((s) => s.active);
  const activeGroups = data.groups.filter((g) => g.active);
  return (
    <div>
      <StepHeader title="مجموعات الطلاب" hint="أنشئ المجموعات التي يتوزّع عليها الطلاب أثناء الدوران." />
      <form action={createGroupAction} className="flex flex-wrap items-end gap-2 mb-4">
        <input name="name" required placeholder="اسم المجموعة" className="input" />
        <select name="courseId" className="input">
          <option value="">الدورة — بدون —</option>
          {data.courses.map((c) => (
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
          {activeStudyTypes.map((st) => (
            <option key={st.id} value={st.id}>
              {st.nameAr ?? st.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">
          إضافة مجموعة
        </button>
      </form>
      <MiniList
        items={activeGroups.map((g) => ({
          id: g.id,
          primary: g.name,
          secondary: [g.shift ? SHIFT_LABEL[g.shift] : null, g.studyTypeName, `${g.studentCount} طالب`]
            .filter(Boolean)
            .join(" · "),
        }))}
        empty="لا توجد مجموعات بعد"
        href="/groups"
      />
    </div>
  );
}

function SupervisorsStep({ data }: { data: SetupData }) {
  const activeHospitals = data.hospitals.filter((h) => h.active);
  const activeGroups = data.groups.filter((g) => g.active);
  return (
    <div>
      <StepHeader
        title="المشرفون لكل مستشفى"
        hint="أنشئ حساب مشرف (مقيّم) واربطه بمستشفى — ويمكن تخصيصه لمجموعة معيّنة. كلمة المرور مبدئية يغيّرها المشرف لاحقاً."
      />
      <form action={createEvaluatorAction} className="flex flex-wrap items-end gap-2 mb-4">
        <input name="name" required placeholder="اسم المشرف" className="input" />
        <input name="email" type="email" required placeholder="البريد الإلكتروني" className="input" />
        <input name="password" type="text" required placeholder="كلمة مرور مبدئية" className="input" />
        <select name="hospitalId" required className="input">
          <option value="">المستشفى</option>
          {activeHospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <select name="groupId" className="input">
          <option value="">كل المجموعات</option>
          {activeGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">
          إضافة مشرف
        </button>
      </form>
      {data.evaluators.length === 0 ? (
        <p className="text-center text-slate-400 py-4">لا يوجد مشرفون بعد</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.evaluators.map((e) => (
            <div key={e.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2">
              <div className="text-sm">
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-slate-400">{e.email}</div>
              </div>
              <div className="flex flex-wrap gap-1 justify-end">
                {e.assignments.filter((a) => a.active).length === 0 ? (
                  <span className="text-xs text-slate-400">— بدون تكليف —</span>
                ) : (
                  e.assignments
                    .filter((a) => a.active)
                    .map((a) => (
                      <span key={a.id} className="badge badge-gray">
                        {a.hospitalName}
                        {a.groupName ? ` · ${a.groupName}` : ""}
                      </span>
                    ))
                )}
              </div>
            </div>
          ))}
          <a href="/evaluators" className="text-xs text-slate-500 hover:underline">
            إدارة المشرفين والتكاليف →
          </a>
        </div>
      )}
    </div>
  );
}

function RotationStep({ data }: { data: SetupData }) {
  const activeGroups = data.groups.filter((g) => g.active);
  const activeHospitals = data.hospitals.filter((h) => h.active);
  const defaultDays = (data.term.weekdays ?? "").split(",").filter(Boolean);
  const blocks = data.blocks;

  // Read the clock once (lazy state init) rather than during render, so the
  // "today" marker and empty-state window stay stable across re-renders.
  const [now] = useState(() => Date.now());
  const todayISO = new Date(now).toISOString().slice(0, 10);
  let windowStart = todayISO;
  let windowEnd = new Date(now + 14 * 86400000).toISOString().slice(0, 10);
  if (blocks.length > 0) {
    windowStart = blocks.reduce((min, b) => (b.startDate < min ? b.startDate : min), blocks[0].startDate);
    windowEnd = blocks.reduce((max, b) => (b.endDate > max ? b.endDate : max), blocks[0].endDate);
  }
  const totalDays = Math.max(1, daysBetween(windowStart, windowEnd) + 1);
  const todayOffsetPct =
    todayISO >= windowStart && todayISO <= windowEnd ? (daysBetween(windowStart, todayISO) / totalDays) * 100 : null;

  const blocksByGroup = new Map<string, RotationBlockWithGroup[]>();
  for (const b of blocks) {
    if (!blocksByGroup.has(b.groupId)) blocksByGroup.set(b.groupId, []);
    blocksByGroup.get(b.groupId)!.push(b);
  }
  const usedHospitalIds = Array.from(new Set(blocks.map((b) => b.hospitalId)));

  return (
    <div>
      <StepHeader
        title="جدول الدوران"
        hint="ولّد الجدول كاملاً تلقائياً من الإعدادات السابقة، أو أضف فترات يدوياً. أيام الحضور معبّأة مسبقاً من إعداد أيام الأسبوع."
      />

      <AutoGeneratePanel />

      <div className="text-xs font-semibold text-slate-500 mt-5 mb-2">أو أضف فترة يدوياً:</div>
      <form action={createRotationBlockAction} className="flex flex-wrap items-end gap-2 mb-5">
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
          {activeHospitals.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <input name="startDate" type="date" required className="input" />
        <input name="endDate" type="date" required className="input" />
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => (
            <label
              key={d.code}
              className="flex items-center gap-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1"
            >
              <input type="checkbox" name="daysOfWeek" value={d.code} defaultChecked={defaultDays.includes(d.code)} />
              {d.labelAr}
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-primary">
          إضافة فترة
        </button>
      </form>

      {usedHospitalIds.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4 text-xs">
          {usedHospitalIds.map((hid) => {
            const h = data.hospitals.find((x) => x.id === hid);
            return (
              <span key={hid} className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: colorFor(hid) }} />
                {h?.name ?? hid}
              </span>
            );
          })}
        </div>
      )}

      {activeGroups.length === 0 ? (
        <p className="text-center text-slate-400 py-6">أضف مجموعات أولاً قبل جدولة الدوران</p>
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
                    const width = Math.max(2, ((daysBetween(b.startDate, b.endDate) + 1) / totalDays) * 100);
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
  );
}

function AutoGeneratePanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);

  function run() {
    setCleared(null);
    startTransition(async () => {
      setResult(await generateScheduleAction());
    });
  }
  function clear() {
    setResult(null);
    startTransition(async () => {
      const r = await clearAutoScheduleAction();
      setCleared(r.cleared);
    });
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3" style={{ borderColor: "#2563eb", background: "#eff6ff" }}>
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold text-sm" style={{ color: "#1d4ed8" }}>
            المحرّك التلقائي لجدول الدوران
          </div>
          <p className="text-xs text-slate-600 mt-0.5 max-w-md">
            يوزّع كل المجموعات على المستشفيات أسبوعاً بأسبوع حسب عدد الأسابيع وأيام الحضور
            وتاريخ البداية. يستبدل الجدول المولّد سابقاً فقط ولا يمسّ الفترات المضافة يدوياً.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={run} disabled={pending} className="btn btn-primary whitespace-nowrap">
            {pending ? "جارِ التوليد..." : "توليد الجدول تلقائياً"}
          </button>
          <button type="button" onClick={clear} disabled={pending} className="btn btn-secondary whitespace-nowrap text-xs">
            مسح المولّد
          </button>
        </div>
      </div>

      {cleared !== null && (
        <p className="text-xs text-slate-600">تم مسح {cleared} فترة مولّدة تلقائياً.</p>
      )}

      {result && result.errors.length > 0 && (
        <div className="rounded-md bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 flex flex-col gap-1">
          <span className="font-semibold">تعذّر التوليد — أكمل ما يلي:</span>
          <ul className="list-disc pr-4 flex flex-col gap-0.5">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {result && result.ok && (
        <div className="rounded-md bg-green-50 border border-green-200 p-2.5 text-xs text-green-800 flex flex-col gap-1.5">
          <span className="font-semibold">
            ✓ تم توليد {result.created} فترة دوران
            {result.clearedAuto > 0 ? ` (واستبدال ${result.clearedAuto} فترة سابقة)` : ""}.
          </span>
          {result.warnings.map((w, i) => (
            <span key={i} className="text-amber-700">
              ⚠ {w}
            </span>
          ))}
          <details>
            <summary className="cursor-pointer text-slate-600 select-none">عرض توزيع المجموعات</summary>
            <div className="flex flex-col gap-1.5 mt-2">
              {result.summary.map((row) => (
                <div key={row.groupName} className="text-slate-700">
                  <span className="font-medium">{row.groupName}:</span>{" "}
                  {row.segments.map((s) => s.hospitalName).join(" ← ")}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function MiniList({
  items,
  empty,
  href,
}: {
  items: { id: string; primary: string; secondary: string }[];
  empty: string;
  href: string;
}) {
  if (items.length === 0) return <p className="text-center text-slate-400 py-4">{empty}</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((it) => (
        <div key={it.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 text-sm">
          <span className="font-medium">{it.primary}</span>
          <span className="text-xs text-slate-400">{it.secondary}</span>
        </div>
      ))}
      <a href={href} className="text-xs text-slate-500 hover:underline mt-1">
        إدارة الكل →
      </a>
    </div>
  );
}
