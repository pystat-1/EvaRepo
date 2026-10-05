"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { dayMonth, fmtPct, fmtScore, rangeLabel, rotationOrder, studentStats, weekdayAr } from "@/lib/gradeMatrix/build";
import { criterionVisual } from "@/lib/gradeMatrix/visual";
import type { GradeMatrixData, MatrixDay, MatrixGroup, MatrixHospital, MatrixStudent } from "@/lib/gradeMatrix/types";
import { DayCell, Dot, StudentIds, cellId } from "./parts";
import { dayAria, groupTitle } from "./common";
import styles from "./gradeMatrix.module.css";

const ATTENDANCE: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };

// One stretch of the group's schedule at one hospital, in date order.
interface Stint {
  hospitalId: string;
  order: number;
  days: { day: MatrixDay; index: number }[];
}

function stintsOf(group: MatrixGroup, student: MatrixStudent): Stint[] {
  const order = rotationOrder(group);
  const out: Stint[] = [];
  student.days.forEach((day, index) => {
    const last = out[out.length - 1];
    if (last && last.hospitalId === day.hospitalId) last.days.push({ day, index });
    else out.push({ hospitalId: day.hospitalId, order: order.get(day.hospitalId) ?? out.length + 1, days: [{ day, index }] });
  });
  return out;
}

// «ملف الطالب»: a side panel with one student's whole course — the summary,
// then every scheduled day with all criteria, grouped by rotation. A day's
// total opens the same day popover as the grid.
export function StudentFile({
  data,
  group,
  groupIndex,
  student,
  studentIndex,
  hospitalBy,
  popoverOpen,
  onOpenDay,
  onClose,
}: {
  data: GradeMatrixData;
  group: MatrixGroup;
  groupIndex: number;
  student: MatrixStudent;
  studentIndex: number;
  hospitalBy: Map<string, MatrixHospital>;
  popoverOpen: boolean;
  onOpenDay: (dayIndex: number, anchor: HTMLElement) => void;
  onClose: () => void;
}) {
  const { criteria, maxTotal } = data;
  const closeRef = useRef<HTMLButtonElement>(null);
  const st = studentStats(student.days, criteria.length, maxTotal);
  const stints = stintsOf(group, student);
  const span = criteria.length + 5;

  useEffect(() => {
    closeRef.current?.focus();
  }, [student.id]);

  // Esc closes the file, unless a day popover is open on top of it.
  const popoverRef = useRef(popoverOpen);
  useEffect(() => {
    popoverRef.current = popoverOpen;
  }, [popoverOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !popoverRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const el = (e.target as Element).closest<HTMLElement>("[data-cell]");
    if (!el) return;
    const d = Number((el.dataset.cell ?? "").split(":")[2]);
    if (!isNaN(d)) onOpenDay(d, el);
  }

  const route = Array.from(rotationOrder(group).keys())
    .map((h) => hospitalBy.get(h)?.name ?? "—")
    .join(" ← ");

  return (
    <>
      <div className={styles.fileScrim} onClick={onClose} aria-hidden />
      <aside className={styles.file} role="dialog" aria-modal="true" aria-label={`ملف الطالب ${student.name}`} dir="rtl">
        <header className={styles.fileHead}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className={styles.fileTitle}>{student.name}</h2>
              <p className={styles.fileMeta}>
                <StudentIds student={student} /> · {groupTitle(group.name)}
                {route && ` · ${route}`}
              </p>
            </div>
            <button ref={closeRef} type="button" className={styles.popoverClose} onClick={onClose} aria-label="إغلاق ملف الطالب">
              ×
            </button>
          </div>
          <div className={styles.fileStats}>
            <Stat label={`المعدل من ${maxTotal}`} value={fmtScore(st.avg)} sub="مبدئي" />
            <Stat label="النسبة" value={fmtPct(st.pct)} low={st.pct !== null && st.pct < 60} />
            <Stat label="أيام مُقيَّمة" value={`${st.graded} من ${st.due}`} />
            <Stat label="غياب" value={String(st.absences)} low={st.absences > 0} />
            {Object.entries(st.hospAvg).map(([h, a]) => (
              <Stat
                key={h}
                label={hospitalBy.get(h)?.name ?? "—"}
                value={fmtScore(a)}
                color={hospitalBy.get(h)?.color}
              />
            ))}
          </div>
          <p className={styles.fileCrit}>
            {criteria.map((c, ci) => (
              <span key={c.id}>
                {c.label}: <b>{fmtScore(st.critAvg[ci])}</b> من {c.max}
              </span>
            ))}
          </p>
        </header>

        <div className={styles.fileBody} onClick={onClick}>
          <table className={styles.sheet} style={{ minWidth: 0 }}>
            <thead>
              <tr>
                <th className={styles.sheetStart}>اليوم</th>
                {criteria.map((c) => (
                  <th key={c.id}>
                    {c.label}
                    <span className={styles.hcellSub}>من {c.max}</span>
                  </th>
                ))}
                <th>
                  المجموع<span className={styles.hcellSub}>من {maxTotal}</span>
                </th>
                <th>الحضور</th>
                <th>المقيّم</th>
                <th className={styles.sheetStart}>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {stints.map((s, k) => {
                const h = hospitalBy.get(s.hospitalId);
                const first = s.days[0].day.dateISO;
                const last = s.days[s.days.length - 1].day.dateISO;
                return [
                  <tr key={`h${k}`} className={styles.sheetGroup}>
                    <td colSpan={span} style={{ boxShadow: `inset -4px 0 0 ${h?.color ?? "transparent"}` }}>
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <Dot color={h?.color ?? "var(--ink-muted)"} />
                        {h?.name ?? "—"} · الدوران {s.order}
                        <span className={styles.sheetGroupMeta}>{rangeLabel(first, last)}</span>
                      </span>
                    </td>
                  </tr>,
                  ...s.days.map(({ day, index }) => (
                    <tr key={day.dateISO}>
                      <td className={`${styles.sheetStart} ${styles.sheetMuted}`}>
                        <b style={{ color: "var(--ink)" }}>{weekdayAr(day.dateISO)}</b> {dayMonth(day.dateISO)}
                      </td>
                      {criteria.map((c, ci) => {
                        const v = criterionVisual(day, ci, c.max);
                        return (
                          <td key={c.id} className={styles.sheetNum} style={{ color: v.fg }}>
                            {v.text || "—"}
                          </td>
                        );
                      })}
                      <td className={styles.sheetTotal}>
                        <DayCell
                          day={day}
                          maxTotal={maxTotal}
                          id={cellId(groupIndex, studentIndex, index)}
                          aria={dayAria(student, day, hospitalBy, maxTotal)}
                          size="sm"
                        />
                      </td>
                      <td
                        style={{
                          fontWeight: 700,
                          color: day.attendance === "absent" ? "var(--red-700)" : day.attendance === "late" ? "var(--amber-700)" : undefined,
                        }}
                      >
                        {(day.attendance && ATTENDANCE[day.attendance]) || "—"}
                      </td>
                      <td className={styles.sheetMuted}>{day.evaluatorName ?? "—"}</td>
                      <td className={`${styles.sheetStart} ${styles.sheetNote}`} title={day.notes ?? day.feedback ?? ""}>
                        {day.notes ?? day.feedback ?? day.holidayLabel ?? ""}
                      </td>
                    </tr>
                  )),
                ];
              })}
              {student.unplaced.length > 0 && (
                <tr className={styles.sheetAvg}>
                  <td colSpan={span} className={styles.sheetStart}>
                    {student.unplaced.length} تقييمًا معتمدًا في أيام خارج جدول الدوران:{" "}
                    {student.unplaced.map((d) => `${dayMonth(d.dateISO)} (${d.state === "absent" ? "غائب" : fmtScore(d.total)})`).join("، ")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}

function Stat({ label, value, sub, low, color }: { label: string; value: string; sub?: string; low?: boolean; color?: string }) {
  return (
    <div className={styles.fileStat} style={color ? { borderTopColor: color } : undefined}>
      <b style={low ? { color: "var(--red-700)" } : undefined}>{value}</b>
      <span>
        {color && <Dot color={color} />} {label}
        {sub && ` · ${sub}`}
      </span>
    </div>
  );
}
