import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { attendanceCalendar, attendanceDays, setAttendanceDays } from "@eva/db/repo/courses";
import { Notice, SHIFT_AR } from "./ui";
import { errorText, r } from "../lib/repo";

const DAYS: Array<[string, string]> = [
  ["SAT", "السبت"],
  ["SUN", "الأحد"],
  ["MON", "الاثنين"],
  ["TUE", "الثلاثاء"],
  ["WED", "الأربعاء"],
  ["THU", "الخميس"],
  ["FRI", "الجمعة"],
];
const DAY_AR = Object.fromEntries(DAYS);
const short = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

function DayPicker({ value, onChange, disabled }: { value: string[]; onChange: (days: string[]) => void; disabled?: boolean }) {
  return (
    <div className="daypicker" role="group">
      {DAYS.map(([code, label]) => {
        const on = value.includes(code);
        return (
          <button
            key={code}
            className={`daybtn ${on ? "on" : ""}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((d) => d !== code) : [...value, code])}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// أيام الحضور: which weekdays the groups attend — for the whole course, or a
// different set for one hospital. They fill the schedule's dates (here and on
// the evaluators' phones) but never block grading on another day.
export function AttendanceDaysCard({ courseId }: { courseId: string }) {
  const days = useQuery({ queryKey: ["attendanceDays", courseId], queryFn: () => attendanceDays(r, courseId) });
  const save = useMutation({ mutationFn: (v: { days: string[]; hospitalId?: string }) => setAttendanceDays(r, courseId, v.days, v.hospitalId) });
  const [perHospital, setPerHospital] = useState(false);
  const d = days.data;
  if (!d) return null;
  const anyOwn = d.hospitals.some((h) => h.own);
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>أيام الحضور</h2>
        <label className="row check">
          <input type="checkbox" checked={perHospital || anyOwn} onChange={(e) => setPerHospital(e.target.checked)} disabled={anyOwn} /> أيام مختلفة لكل مستشفى
        </label>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        تحدد تواريخ الجدول هنا وعلى هواتف المقيّمين تلقائيًا. للتوضيح فقط: يمكن تقييم أي مجموعة في أي يوم، ويُسجَّل اليوم الفعلي. يمكن تغييرها في أي وقت.
      </p>
      {save.error && <Notice kind="err">{errorText(save.error)}</Notice>}
      <div className="row">
        <b style={{ minWidth: 150 }}>كل المستشفيات</b>
        <DayPicker value={d.course} onChange={(v) => v.length && save.mutate({ days: v })} disabled={save.isPending} />
      </div>
      {(perHospital || anyOwn) &&
        d.hospitals.map((h) => (
          <div key={h.hospitalId} className="row">
            <span style={{ minWidth: 150 }}>{h.hospitalName}</span>
            <DayPicker value={h.days} onChange={(v) => v.length && save.mutate({ days: v, hospitalId: h.hospitalId })} disabled={save.isPending} />
            {h.own && (
              <button className="btn btn-sm btn-ghost" onClick={() => save.mutate({ days: d.course, hospitalId: h.hospitalId })}>
                مثل الدورة
              </button>
            )}
          </div>
        ))}
    </div>
  );
}

// The schedule read by hospital: week → attendance days with dates → groups.
export function CalendarByHospital({ courseId }: { courseId: string }) {
  const cal = useQuery({ queryKey: ["attendanceCalendar", courseId], queryFn: () => attendanceCalendar(r, courseId) });
  const [open, setOpen] = useState<string | null>(null);
  const list = cal.data ?? [];
  const shown = open ?? list[0]?.hospitalId ?? null;
  if (!list.length) return null;
  const h = list.find((x) => x.hospitalId === shown) ?? list[0];
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>الجدول حسب المستشفى</h2>
        <div className="seg" role="tablist">
          {list.map((x) => (
            <button key={x.hospitalId} role="tab" aria-selected={x.hospitalId === h.hospitalId} className={x.hospitalId === h.hospitalId ? "on" : ""} onClick={() => setOpen(x.hospitalId)}>
              {x.hospitalName.replace(/^مستشفى /, "")}
            </button>
          ))}
        </div>
      </div>
      <div className="cal">
        {h.weeks.map((w) => (
          <div key={w.index} className="cal-week">
            <div className="cal-week-title">الأسبوع {w.index + 1}</div>
            <div className="cal-days">
              {w.days.map((d) => (
                <div key={d.dateISO} className="cal-day">
                  <div className="cal-date">
                    <b>{DAY_AR[d.weekday]}</b> <span className="tabular">{short(d.dateISO)}</span>
                  </div>
                  {d.groups.map((g) => (
                    <div key={g.id} className="cal-group">
                      {g.name}
                      {g.shift ? <small> · {SHIFT_AR[g.shift]}</small> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
