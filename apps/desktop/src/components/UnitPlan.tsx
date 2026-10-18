import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { listUnits, saveUnit, setGroupDayUnit, setStudentUnit, setUnitActive, unitPlan } from "@eva/db/repo/units";
import type { CourseGroup } from "@eva/db/repo/courses";
import { Notice, SHIFT_AR } from "./ui";
import { errorText, r } from "../lib/repo";
import { dayLabel } from "./Holidays";

// Up to this many days the grid shows them all; more are shown a week at a time.
const ALL_DAYS_UP_TO = 12;
// Students drawn at a time (a real group fits; «عرض المزيد» adds more).
const PAGE = 60;
const weekOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // the Sunday it belongs to
  return d.toISOString().slice(0, 10);
};

// Distinct, light fills so each unit reads at a glance in the grid.
const UNIT_COLORS = ["#f6e5e3", "#dcece9", "#e8e2f3", "#f4ecd6", "#e2f0e7", "#e3ecf6"];

// توزيع الأقسام: one group's students × its attendance days; each cell is the
// unit (صالة الولادة، العناية…) the student is in that day. A day's header
// sets the whole group at once. Evaluators see the unit beside each name.
export function UnitPlanCard({ groups }: { groups: CourseGroup[] }) {
  const [picked, setPicked] = useState("");
  const [week, setWeek] = useState("");
  const [shown, setShown] = useState(PAGE);
  // The one cell being edited (a <select> per cell is too heavy for big groups).
  const [editing, setEditing] = useState<string | null>(null);
  const groupId = (groups.some((g) => g.id === picked) && picked) || groups[0]?.id || "";
  const units = useQuery({ queryKey: ["units"], queryFn: () => listUnits(r, true) });
  const plan = useQuery({ queryKey: ["unitPlan", groupId], queryFn: () => unitPlan(r, groupId), enabled: !!groupId });
  const setOne = useMutation({ mutationFn: (v: { studentId: string; dateISO: string; unitId: string | null }) => setStudentUnit(r, v.studentId, v.dateISO, v.unitId) });
  const setDay = useMutation({ mutationFn: (v: { dateISO: string; unitId: string | null }) => setGroupDayUnit(r, groupId, v.dateISO, v.unitId) });

  const all = units.data ?? [];
  const active = all.filter((u) => u.active);
  const colorOf = (unitId: string | undefined) => {
    const i = all.findIndex((u) => u.id === unitId);
    return i < 0 ? undefined : UNIT_COLORS[i % UNIT_COLORS.length];
  };
  const p = plan.data;
  const error = setOne.error ?? setDay.error;
  const weeks = [...new Set((p?.dates ?? []).map(weekOf))];
  const paged = (p?.dates.length ?? 0) > ALL_DAYS_UP_TO;
  const shownWeek = weeks.includes(week) ? week : weeks.find((w) => w >= weekOf(new Date().toISOString().slice(0, 10))) ?? weeks[0];
  const dates = paged ? (p?.dates ?? []).filter((d) => weekOf(d) === shownWeek) : p?.dates ?? [];
  const nameOf = new Map(all.map((u) => [u.id, u.name]));

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>توزيع الأقسام</h2>
        <div className="row">
          {paged && (
            <select className="input" value={shownWeek} onChange={(e) => setWeek(e.target.value)} aria-label="الأسبوع">
              {weeks.map((w, i) => (
                <option key={w} value={w}>
                  أسبوع {i + 1} ({w.slice(8)}/{w.slice(5, 7)})
                </option>
              ))}
            </select>
          )}
          {groups.length > 1 && (
            <select className="input" value={groupId} onChange={(e) => (setPicked(e.target.value), setShown(PAGE))} aria-label="المجموعة">
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({SHIFT_AR[g.shift ?? ""] ?? ""})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        القسم الذي يتدرّب فيه كل طالب في كل يوم حضور. اختر من رأس العمود لتعيين القسم نفسه للمجموعة كلها في ذلك اليوم. يظهر القسم بجانب اسم الطالب على هاتف المقيّم.
      </p>
      <UnitsList units={all} colorOf={colorOf} />
      {error && <Notice kind="err">{errorText(error)}</Notice>}
      {p && p.dates.length === 0 && <p className="muted">لا أيام حضور لهذه المجموعة في الجدول.</p>}
      {p && p.dates.length > 0 && p.students.length === 0 && <p className="muted">لا طلاب في هذه المجموعة بعد.</p>}
      {p && p.dates.length > 0 && p.students.length > 0 && (
        <div className="table-wrap">
          <table className="list schedule unit-plan">
            <thead>
              <tr>
                <th>الطالب</th>
                {dates.map((d) => (
                  <th key={d} className="tabular">
                    {dayLabel(d).replace(/\/\d{4}$/, "")}
                    <select
                      className="cell-select unit-all"
                      value=""
                      aria-label={`قسم المجموعة كلها يوم ${d}`}
                      onChange={(e) => e.target.value && setDay.mutate({ dateISO: d, unitId: e.target.value === "-" ? null : e.target.value })}
                    >
                      <option value="">للكل…</option>
                      {active.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                      <option value="-">مسح اليوم</option>
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.students.slice(0, shown).map((s, i) => (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="muted tabular">{i + 1}.</span> {s.nameAr}
                  </th>
                  {dates.map((d) => {
                    const unitId = p.cells[s.id]?.[d];
                    const key = `${s.id}:${d}`;
                    const hidden = unitId && !active.some((u) => u.id === unitId);
                    return (
                      <td key={d} style={{ background: colorOf(unitId) }}>
                        {editing === key ? (
                          <select
                            className="cell-select"
                            value={unitId ?? ""}
                            aria-label={`${s.nameAr} — ${d}`}
                            autoFocus
                            onBlur={() => setEditing(null)}
                            onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                            onChange={(e) => (setOne.mutate({ studentId: s.id, dateISO: d, unitId: e.target.value || null }), setEditing(null))}
                          >
                            <option value="">—</option>
                            {active.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                            {hidden && <option value={unitId}>{nameOf.get(unitId)}</option>}
                          </select>
                        ) : (
                          <button className="unit-cell" data-unit={unitId ?? ""} aria-label={`${s.nameAr} — ${d}: ${unitId ? nameOf.get(unitId) : "بلا قسم"}`} onClick={() => setEditing(key)}>
                            {unitId ? nameOf.get(unitId) : "—"}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p && p.dates.length > 0 && p.students.length > shown && (
        <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setShown(shown + PAGE)}>
          عرض المزيد ({p.students.length - shown} طالب)
        </button>
      )}
    </div>
  );
}

// The standard list of units: add one, or hide one no longer used.
function UnitsList({ units, colorOf }: { units: Array<{ id: string; name: string; active: boolean }>; colorOf: (id: string) => string | undefined }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const add = useMutation({ mutationFn: () => saveUnit(r, { name }), onSuccess: () => (setName(""), setAdding(false)) });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => setUnitActive(r, v.id, v.active) });
  return (
    <div className="row">
      <span className="muted">الأقسام:</span>
      {units.map((u) => (
        <span key={u.id} className="badge unit-badge" style={{ background: u.active ? colorOf(u.id) : undefined, opacity: u.active ? 1 : 0.6 }}>
          {u.name}
          <button
            className="unit-toggle"
            onClick={() => toggle.mutate({ id: u.id, active: !u.active })}
            title={u.active ? "إخفاء من الخيارات" : "إظهار في الخيارات"}
            aria-label={u.active ? `إخفاء ${u.name}` : `إظهار ${u.name}`}
          >
            {u.active ? "×" : "↺"}
          </button>
        </span>
      ))}
      {adding ? (
        <form className="row" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم القسم" aria-label="اسم القسم" autoFocus required />
          <button className="btn btn-sm btn-primary" type="submit" disabled={add.isPending}>
            إضافة
          </button>
          <button className="btn btn-sm" type="button" onClick={() => (setAdding(false), add.reset())}>
            إلغاء
          </button>
          {add.error && <span className="field-error">{errorText(add.error)}</span>}
        </form>
      ) : (
        <button className="btn btn-sm" onClick={() => setAdding(true)}>
          إضافة قسم
        </button>
      )}
    </div>
  );
}
