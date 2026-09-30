import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { courseOverview, createCourse, listCourses, listHospitals, saveHospital, setBlockHospital } from "@eva/db/repo/courses";
import { currentCourse } from "@eva/db/repo/students";
import { ValidationError } from "@eva/db/repo/common";
import * as schema from "@eva/db/schema";
import { Dialog, Empty, Field, Notice, PageHeader, SHIFT_AR } from "../components/ui";
import { errorText, r } from "../lib/repo";

// A few distinct, readable fills for hospitals in the schedule grid.
const HOSPITAL_COLORS = ["#dcece9", "#f4ecd6", "#e8e2f3", "#e2f0e7", "#f6e5e3", "#e3ecf6"];

export function CoursesScreen() {
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => listCourses(r) });
  const current = useQuery({ queryKey: ["currentCourse"], queryFn: () => currentCourse(r) });
  const [picked, setPicked] = useState("");
  const courseId = picked || current.data?.id || courses.data?.[0]?.id || "";
  const overview = useQuery({ queryKey: ["courseOverview", courseId], queryFn: () => courseOverview(r, courseId), enabled: !!courseId });
  const allHospitals = useQuery({ queryKey: ["hospitals"], queryFn: () => listHospitals(r) });
  const move = useMutation({ mutationFn: (v: { blockId: string; hospitalId: string }) => setBlockHospital(r, v.blockId, v.hospitalId) });
  const [creating, setCreating] = useState(false);
  const [addingHospital, setAddingHospital] = useState(false);

  const o = overview.data;
  const colorOf = (hid: string) => HOSPITAL_COLORS[Math.max(0, (o?.hospitals ?? allHospitals.data ?? []).findIndex((h) => h.id === hid)) % HOSPITAL_COLORS.length];

  return (
    <div className="stack">
      <PageHeader
        title="الدورات والجدول"
        subtitle="جدول الدوران: كل خانة هي أسبوع مجموعة في مستشفى — غيّرها من القائمة."
        actions={
          <>
            <select className="input" value={courseId} onChange={(e) => setPicked(e.target.value)} aria-label="الدورة">
              {(courses.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? `${c.year}-${c.number}`}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              دورة جديدة…
            </button>
          </>
        }
      />
      {!courseId && <Empty>لا توجد دورات بعد — أنشئ دورة جديدة.</Empty>}
      {move.error && <Notice kind="err">{errorText(move.error)}</Notice>}

      {o && (
        <>
          <p className="muted">
            تبدأ <span className="tabular">{o.course.startDate ?? "—"}</span> · {o.course.weekCount ?? o.weeks.length} أسابيع · {o.groups.length} مجموعات ·{" "}
            {o.groups.reduce((s, g) => s + g.studentCount, 0)} طالب · إصدار الجدول {o.course.scheduleVersion}
          </p>
          <div className="table-wrap">
            <table className="list schedule">
              <thead>
                <tr>
                  <th>المجموعة</th>
                  {o.weeks.map((w) => (
                    <th key={w.index} className="tabular">
                      أسبوع {w.index + 1}
                      <small>{w.start.slice(5)}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.groups.map((g) => (
                  <tr key={g.id}>
                    <th scope="row">
                      {g.name}
                      <small>
                        {SHIFT_AR[g.shift ?? ""] ?? ""} · {g.studentCount} طالب
                      </small>
                    </th>
                    {o.weeks.map((w) => {
                      const cell = o.cells[g.id]?.[w.index];
                      return (
                        <td key={w.index} style={{ background: cell ? colorOf(cell.hospitalId) : undefined }}>
                          {cell ? (
                            <select
                              className="cell-select"
                              value={cell.hospitalId}
                              aria-label={`${g.name} أسبوع ${w.index + 1}`}
                              onChange={(e) => move.mutate({ blockId: cell.blockId, hospitalId: e.target.value })}
                            >
                              {(o.hospitals.length ? o.hospitals : allHospitals.data ?? []).map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.name.replace(/^مستشفى /, "")}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>المستشفيات</h2>
          <button className="btn" onClick={() => setAddingHospital(true)}>
            إضافة مستشفى
          </button>
        </div>
        <div className="row">
          {(allHospitals.data ?? []).map((h) => (
            <span key={h.id} className="badge" style={{ background: colorOf(h.id) }}>
              {h.name}
            </span>
          ))}
        </div>
      </div>

      <NewCourseDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), setPicked(id))} />
      <HospitalDialog open={addingHospital} onClose={() => setAddingHospital(false)} />
    </div>
  );
}

function nextSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function NewCourseDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const hospitals = useQuery({ queryKey: ["hospitals"], queryFn: () => listHospitals(r) });
  const studyTypes = useQuery({ queryKey: ["studyTypes"], queryFn: () => r.db.select().from(schema.studyTypes).where(eq(schema.studyTypes.active, true)) });
  const year = new Date().getFullYear();
  const [f, setF] = useState({ year, number: 2, label: "", startDate: nextSunday(), weekCount: 6, weeksPerHospital: 2, morning: 3, evening: 3, studyTypeId: "", hospitalIds: [] as string[], days: "SUN,MON,TUE,WED,THU" });
  const create = useMutation({
    mutationFn: () =>
      createCourse(r, {
        year: Number(f.year), number: Number(f.number), label: f.label || `دورة ${f.year}-${f.number}`, startDate: f.startDate,
        weekCount: Number(f.weekCount), weeksPerHospital: Number(f.weeksPerHospital), daysOfWeek: f.days,
        groupsPerShift: { MORNING: Number(f.morning), EVENING: Number(f.evening) },
        hospitalIds: f.hospitalIds.length ? f.hospitalIds : (hospitals.data ?? []).map((h) => h.id),
        studyTypeId: f.studyTypeId || studyTypes.data?.find((s) => s.code === "N")?.id || studyTypes.data?.[0]?.id || "",
      }),
    onSuccess: onCreated,
  });
  const err = (k: string) => (create.error instanceof ValidationError && create.error.field === k ? create.error.message : undefined);
  const num = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const chosen = f.hospitalIds.length ? f.hospitalIds : (hospitals.data ?? []).map((h) => h.id);

  return (
    <Dialog open={open} title="دورة جديدة" onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <div className="form-grid">
          <Field label="السنة"><input className="input" type="number" value={f.year} onChange={num("year")} /></Field>
          <Field label="رقم الدورة" error={err("number")}><input className="input" type="number" min={1} max={4} value={f.number} onChange={num("number")} /></Field>
          <Field label="الاسم"><input className="input" placeholder={`دورة ${f.year}-${f.number}`} value={f.label} onChange={num("label")} /></Field>
          <Field label="تاريخ البداية (يوم أحد)" error={err("startDate")}><input className="input" type="date" value={f.startDate} onChange={num("startDate")} /></Field>
          <Field label="عدد الأسابيع" error={err("weekCount")}><input className="input" type="number" min={1} max={52} value={f.weekCount} onChange={num("weekCount")} /></Field>
          <Field label="أسابيع في كل مستشفى"><input className="input" type="number" min={1} value={f.weeksPerHospital} onChange={num("weeksPerHospital")} /></Field>
          <Field label="مجموعات صباحية"><input className="input" type="number" min={0} max={20} value={f.morning} onChange={num("morning")} /></Field>
          <Field label="مجموعات مسائية" error={err("groupsPerShift")}><input className="input" type="number" min={0} max={20} value={f.evening} onChange={num("evening")} /></Field>
          <Field label="نوع الدراسة">
            <select className="input" value={f.studyTypeId} onChange={num("studyTypeId")}>
              {(studyTypes.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.nameAr ?? s.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="المستشفيات" error={err("hospitalIds")}>
          <div className="row">
            {(hospitals.data ?? []).map((h) => (
              <label key={h.id} className="row check">
                <input
                  type="checkbox"
                  checked={chosen.includes(h.id)}
                  onChange={(e) => setF({ ...f, hospitalIds: e.target.checked ? [...chosen, h.id] : chosen.filter((x) => x !== h.id) })}
                />
                {h.name}
              </label>
            ))}
          </div>
        </Field>
        <p className="muted">تُنشأ المجموعات («المجموعة الصباحية 1»…) وجدول دوران عادل: تزور كل مجموعة كل مستشفى، ولا تتزاحم مجموعات الدوام نفسه في مستشفى واحد.</p>
        {create.error && !(create.error instanceof ValidationError && create.error.field) && <Notice kind="err">{errorText(create.error)}</Notice>}
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>{create.isPending ? "جارٍ الإنشاء…" : "إنشاء الدورة والجدول"}</button>
          <button className="btn" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}

function HospitalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const save = useMutation({ mutationFn: () => saveHospital(r, { name }), onSuccess: () => (setName(""), onClose()) });
  return (
    <Dialog open={open} title="إضافة مستشفى" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <Field label="اسم المستشفى" error={save.error ? errorText(save.error) : undefined}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>حفظ</button>
          <button className="btn" type="button" onClick={onClose}>إلغاء</button>
        </div>
      </form>
    </Dialog>
  );
}
