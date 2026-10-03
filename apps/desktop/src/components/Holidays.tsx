import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { holidayImpact, listHolidays, removeHoliday, saveHoliday } from "@eva/db/repo/courses";
import { ValidationError } from "@eva/db/repo/common";
import type { Holiday } from "@eva/core/schedule/holidays";
import { Dialog, Field, Notice } from "./ui";
import { errorText, r } from "../lib/repo";

const WEEKDAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const dayLabel = (iso: string) => `${WEEKDAY_AR[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// العطل: course-wide days off. Each can move to another date, and the
// groups that met that day meet there instead (same hospital) — in the
// calendar here, the Grading Center and on the evaluators' phones.
export function HolidaysCard({ courseId, onOpen }: { courseId: string; onOpen: (dateISO: string | "") => void }) {
  const list = useQuery({ queryKey: ["holidays", courseId], queryFn: () => listHolidays(r, courseId) });
  const holidays = list.data ?? [];
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>العطل</h2>
        <button className="btn" onClick={() => onOpen("")}>
          إضافة عطلة…
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        انقر أي يوم في «الجدول حسب المستشفى» لجعله عطلة ونقل دوامه إلى تاريخ آخر. يتحدّث الجدول هنا وعلى هواتف المقيّمين تلقائيًا.
      </p>
      {holidays.length > 0 && (
        <ul className="holiday-list">
          {holidays.map((h) => (
            <li key={h.dateISO}>
              <button className="holiday-item" onClick={() => onOpen(h.dateISO)}>
                <b className="tabular">{dayLabel(h.dateISO)}</b>
                {h.label && <span> · {h.label}</span>}
                <span className="muted"> — {h.movedTo ? <>نُقل إلى <b className="tabular">{dayLabel(h.movedTo)}</b></> : "بلا تعويض"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Declare, move or cancel the holiday on one date. `dateISO` "" = pick the date here. */
export function HolidayDialog({ courseId, dateISO, onClose }: { courseId: string; dateISO: string | null; onClose: () => void }) {
  const list = useQuery({ queryKey: ["holidays", courseId], queryFn: () => listHolidays(r, courseId), enabled: dateISO !== null });
  const ready = dateISO !== null && !!list.data;
  return (
    <Dialog open={dateISO !== null} title="عطلة ونقل الدوام" onClose={onClose}>
      {ready && (
        <HolidayForm
          key={dateISO}
          courseId={courseId}
          initialDate={dateISO}
          existing={list.data!.find((h) => h.dateISO === dateISO) ?? null}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function HolidayForm({ courseId, initialDate, existing, onClose }: { courseId: string; initialDate: string; existing: Holiday | null; onClose: () => void }) {
  const [date, setDate] = useState(initialDate);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [move, setMove] = useState(existing ? !!existing.movedTo : true);
  const [movedTo, setMovedTo] = useState(existing?.movedTo ?? "");
  const impact = useQuery({ queryKey: ["holidayImpact", courseId, date], queryFn: () => holidayImpact(r, courseId, date), enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) });
  const save = useMutation({ mutationFn: () => saveHoliday(r, courseId, { dateISO: date, label, movedTo: move ? movedTo : null }), onSuccess: onClose });
  const remove = useMutation({ mutationFn: () => removeHoliday(r, courseId, date), onSuccess: onClose });
  const err = (k: string) => (save.error instanceof ValidationError && save.error.field === k ? save.error.message : undefined);
  const i = impact.data;
  const byHospital = new Map<string, string[]>();
  for (const g of i?.groups ?? []) byHospital.set(g.hospitalName, [...(byHospital.get(g.hospitalName) ?? []), g.name]);

  return (
    <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
      {initialDate ? (
        <p style={{ margin: 0 }}>
          <b className="tabular">{dayLabel(date)}</b>
          {existing && <span className="badge" style={{ marginInlineStart: 8 }}>عطلة</span>}
        </p>
      ) : (
        <Field label="تاريخ العطلة" error={err("dateISO")}>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required autoFocus />
        </Field>
      )}
      {initialDate && err("dateISO") && <Notice kind="err">{err("dateISO")}</Notice>}

      {i && (
        <div className="holiday-impact">
          {i.groups.length === 0 ? (
            <span className="muted">لا دوام مجدول في هذا اليوم.</span>
          ) : (
            <>
              <span className="muted">دوام هذا اليوم ({i.groups.length} مجموعة):</span>
              {[...byHospital].map(([hospital, names]) => (
                <div key={hospital} className="cal-group">
                  <b>{hospital.replace(/^مستشفى /, "")}</b>: {names.join("، ")}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <Field label="سبب العطلة (اختياري)">
        <input className="input" value={label} placeholder="عطلة رسمية" onChange={(e) => setLabel(e.target.value)} />
      </Field>

      <div className="stack" role="radiogroup" aria-label="الدوام">
        <label className="row check">
          <input type="radio" name="move" checked={move} onChange={() => setMove(true)} /> نقل دوام هذا اليوم إلى تاريخ آخر
        </label>
        {move && (
          <Field label="التاريخ الجديد" error={err("movedTo")} hint="كل مجموعة تداوم فيه في المستشفى نفسه.">
            <input className="input" type="date" value={movedTo} onChange={(e) => setMovedTo(e.target.value)} required={move} />
          </Field>
        )}
        <label className="row check">
          <input type="radio" name="move" checked={!move} onChange={() => setMove(false)} /> عطلة بلا تعويض
        </label>
      </div>

      {!!i?.gradedGroups && (
        <Notice kind="warn">
          قُيِّمت {i.gradedGroups} مجموعة في هذا اليوم: تبقى درجاتها مسجّلة في يومها الفعلي ولا تُنقل.
        </Notice>
      )}
      {save.error && !(save.error instanceof ValidationError && save.error.field) && <Notice kind="err">{errorText(save.error)}</Notice>}
      {remove.error && <Notice kind="err">{errorText(remove.error)}</Notice>}

      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={save.isPending || !date}>
          {save.isPending ? "جارٍ الحفظ…" : move ? "حفظ ونقل الدوام" : "حفظ العطلة"}
        </button>
        {existing && (
          <button className="btn" type="button" onClick={() => remove.mutate()} disabled={remove.isPending}>
            إلغاء العطلة
          </button>
        )}
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          إغلاق
        </button>
      </div>
    </form>
  );
}
