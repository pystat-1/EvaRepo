"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { formatTimeBaghdad, todayISO } from "@/lib/date";
import { addDays, dayMonth, dayPosition, fmtScore, fullDate } from "@/lib/gradeMatrix/build";
import { STATE_LABEL } from "@/lib/gradeMatrix/visual";
import type { GradeMatrixData, MatrixGroup, MatrixHospital, MatrixProgram, MatrixStudent } from "@/lib/gradeMatrix/types";
import { Dot, StudentIds } from "./parts";
import styles from "./gradeMatrix.module.css";

const ATTENDANCE: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };
const GAP = 6;
const MARGIN = 12;

function savedAt(iso: string | null): string {
  if (!iso) return "";
  return `${dayMonth(todayISO(new Date(iso)))} · ${formatTimeBaghdad(iso)}`;
}

// The day popover: everything about one student's day, anchored to the
// cell that opened it (a bottom sheet on narrow screens). Esc, the close
// button or a click outside closes it and focus returns to the cell.
export function DayPopover({
  data,
  program,
  group,
  student,
  dayIndex,
  anchor,
  hospitalBy,
  onClose,
}: {
  data: GradeMatrixData;
  program: MatrixProgram;
  group: MatrixGroup;
  student: MatrixStudent;
  dayIndex: number;
  anchor: HTMLElement;
  hospitalBy: Map<string, MatrixHospital>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Positioned straight on the element (measured after layout) so moving it
  // on scroll/resize never re-renders the popover.
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sheet = vw < 640;
    el.classList.toggle(styles.popoverSheet, sheet);
    if (sheet) {
      el.style.left = "";
      el.style.top = "";
    } else {
      el.style.maxHeight = "";
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // RTL: line the popover's right edge up with the cell's right edge.
      const left = Math.max(MARGIN, Math.min(vw - w - MARGIN, a.right - w));
      // Below the cell if it fits, else above; if neither fits, the roomier
      // side with the popover scrolling inside — never covering the cell.
      const roomBelow = vh - a.bottom - GAP - MARGIN;
      const roomAbove = a.top - GAP - MARGIN;
      const useBelow = h <= roomBelow || (h > roomAbove && roomBelow >= roomAbove);
      const room = Math.max(160, useBelow ? roomBelow : roomAbove);
      if (h > room) el.style.maxHeight = `${room}px`;
      const shown = Math.min(h, room);
      const top = useBelow ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - shown);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }
    el.style.visibility = "visible";
  }, [anchor]);

  useLayoutEffect(() => {
    place();
  }, [place, dayIndex, student.id]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, [dayIndex, student.id]);

  useEffect(() => {
    let frame = 0;
    const onMove = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t)) return;
      if (t.closest("[data-cell]")) return; // another cell: the grid opens it instead
      onClose(false);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [place, onClose]);

  const day = student.days[dayIndex];
  const hospital = hospitalBy.get(day.hospitalId);
  const where = dayPosition(program, group, dayIndex);
  const { criteria, maxTotal } = data;
  const graded = day.total !== null;
  const titleId = `pop-${student.id}-${day.dateISO}`;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      dir="rtl"
      className={styles.popover}
      style={{ visibility: "hidden", left: 0, top: 0 }}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="min-w-0">
          <h2 id={titleId} className="font-bold text-base truncate">
            {student.name}
          </h2>
          <p className="text-xs">
            <StudentIds student={student} />
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="badge badge-gray">{program.label}</span>
            <span className="badge badge-gray">المجموعة {group.name}</span>
          </div>
        </div>
        <button ref={closeRef} type="button" className={styles.popoverClose} aria-label="إغلاق" onClick={() => onClose(true)}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="p-4 flex flex-col gap-3 text-sm">
        <div>
          <p className="font-bold">{fullDate(day.dateISO)}</p>
          <p className="flex items-center gap-1.5 mt-0.5">
            {hospital && <Dot color={hospital.color} />}
            {hospital?.name ?? "—"}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            الأسبوع {where.courseWeek} من الدورة · الأسبوع {where.hospitalWeek} في المستشفى · اليوم {where.dayInWeek}
          </p>
        </div>

        <dl className="grid gap-x-3 gap-y-1" style={{ gridTemplateColumns: "auto 1fr" }}>
          <dt style={{ color: "var(--ink-muted)" }}>الحالة</dt>
          <dd className="font-semibold">{day.state === "holiday" && day.holidayLabel ? day.holidayLabel : STATE_LABEL[day.state]}</dd>
          {day.evaluatorName && (
            <>
              <dt style={{ color: "var(--ink-muted)" }}>المقيّم</dt>
              <dd>{day.evaluatorName}</dd>
            </>
          )}
          {day.attendance && (
            <>
              <dt style={{ color: "var(--ink-muted)" }}>الحضور</dt>
              <dd>{ATTENDANCE[day.attendance]}</dd>
            </>
          )}
          {day.dailyNote !== null && graded && (
            <>
              <dt style={{ color: "var(--ink-muted)" }}>الملاحظة اليومية</dt>
              <dd>{day.dailyNote ? "سُلِّمت" : "لم تُسلَّم"}</dd>
            </>
          )}
        </dl>

        {day.state === "pending" && (
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            تنتهي مهلة التسجيل في {fullDate(addDays(day.dateISO, data.windowDays))}.
          </p>
        )}
        {day.state === "missing" && (
          <p className="text-xs" style={{ color: "var(--red-700)" }}>
            انتهت المهلة في {fullDate(addDays(day.dateISO, data.windowDays))} دون تسجيل تقييم.
          </p>
        )}
        {day.state === "awaiting" && (
          <p className="text-xs">
            تظهر الدرجات هنا بعد أن يعتمد المقيّم يوم المجموعة.{" "}
            <a href="/validations" className="underline font-semibold" style={{ color: "var(--brand)" }}>
              صفحة الاعتماد
            </a>
          </p>
        )}
        {day.state === "disputed" && (
          <p className="text-xs" style={{ color: "var(--amber-700)" }}>
            قيّم مقيّمان هذا الطالب في اليوم نفسه. لا يدخل هذا اليوم في المعدل حتى تعتمد الإدارة أحد التقييمين.
          </p>
        )}

        {graded && day.scores && (
          <div className="flex flex-col gap-2">
            {criteria.map((c, ci) => {
              const v = day.scores![ci];
              const p = v === null || c.max <= 0 ? 0 : Math.max(0, Math.min(100, (v / c.max) * 100));
              return (
                <div key={c.id}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span>{c.label}</span>
                    <span className="tnum font-bold">
                      {fmtScore(v)} <span style={{ color: "var(--ink-muted)", fontWeight: 500 }}>من {c.max}</span>
                    </span>
                  </div>
                  <div className={styles.bar} aria-hidden>
                    <div className={styles.barFill} style={{ width: `${p}%`, background: p < 60 ? "var(--red-700)" : "var(--brand)" }} />
                  </div>
                </div>
              );
            })}
            <div
              className="flex items-baseline justify-between mt-1 pt-2"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <span className="font-bold">المجموع</span>
              <span className="tnum">
                <span className="text-xl font-extrabold" style={{ color: "var(--brand-dark)" }}>
                  {fmtScore(day.total)}
                </span>{" "}
                <span style={{ color: "var(--ink-muted)" }}>
                  من {maxTotal} · {maxTotal > 0 ? Math.round(((day.total ?? 0) / maxTotal) * 100) : 0}٪
                </span>
              </span>
            </div>
          </div>
        )}

        {(day.notes || day.feedback) && (
          <div className="flex flex-col gap-1.5 text-xs">
            {day.notes && (
              <p>
                <span className="font-bold">ملاحظات: </span>
                {day.notes}
              </p>
            )}
            {day.feedback && (
              <p>
                <span className="font-bold">التغذية الراجعة: </span>
                {day.feedback}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-xs pt-2" style={{ borderTop: "1px solid var(--border)", color: "var(--ink-muted)" }}>
          <span>
            {day.locked ? "مقفل" : day.savedAt ? "غير مقفل" : ""}
            {day.savedAt && ` · آخر حفظ ${savedAt(day.savedAt)}`}
          </span>
          <a href={`/grading-center/student/${student.id}`} className="font-semibold underline" style={{ color: "var(--brand)" }}>
            صفحة الطالب
          </a>
        </div>
      </div>
    </div>
  );
}
