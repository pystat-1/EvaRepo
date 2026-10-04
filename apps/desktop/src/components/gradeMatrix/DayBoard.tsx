import { useMemo } from "react";
import {
  averageOf,
  dateLayout,
  dayBoard,
  dayMatches,
  dayMonth,
  fmtScore,
  fullDate,
  rangeLabel,
  weekdayAr,
  type BoardGroup,
  type DayColumn,
} from "@eva/core/gradeMatrix/build";
import type { MatrixDay } from "@eva/core/gradeMatrix/types";
import { DayCell, Dot, EmptyState, NameCell, cellId } from "./parts";
import { dayAria, groupTitle, visibleStudents, type ViewProps } from "./common";
import styles from "./gradeMatrix.module.css";

// One attendance day across every hospital: a panel per hospital with the
// group that is there that day, each student's grade, and the day's
// average. Columns are the calendar-order day columns of the combined view,
// so "day 5" here is the fifth day column there.
export function DayBoard(p: ViewProps & { column: number; onColumn: (column: number) => void }) {
  const { data, program, hospitalBy, hospitalOrder } = p;
  const { maxTotal, holidays } = data;
  const layout = useMemo(() => dateLayout(program, holidays), [program, holidays]);
  // A date layout holds day columns only.
  const columns = layout.columns as DayColumn[];
  const n = columns.length;
  const column = Math.min(Math.max(p.column, 0), Math.max(n - 1, 0));
  const panels = useMemo(
    () => (n ? dayBoard(program, layout, column, hospitalOrder) : []),
    [n, program, layout, column, hospitalOrder]
  );
  if (!n) return <EmptyState title="لا توجد أيام حضور في جدول الدوران" />;

  const dayLabel = (c: number) => {
    const col = columns[c];
    const date = col.dateISO;
    const when = date ? `${weekdayAr(date)} ${dayMonth(date)}` : `الأسبوع ${col.week + 1} · ${layout.heads[1][c].label}`;
    return `اليوم ${c + 1} · ${when}`;
  };
  const col = columns[column];
  const dates = Array.from(new Set(panels.flatMap((x) => x.groups.map((b) => b.dateISO)))).sort();
  const holiday = dates.length > 0 && dates.every((d) => d in holidays) ? holidays[dates[0]] : null;

  return (
    <div className="flex flex-col gap-3" role="region" aria-label="لوحة اليوم">
      <div className={styles.boardBar}>
        <div className={styles.boardPick}>
          <button
            type="button"
            className={styles.boardStep}
            aria-label="اليوم السابق"
            disabled={column === 0}
            onClick={() => p.onColumn(column - 1)}
          >
            →
          </button>
          <select
            className="input"
            style={{ width: "auto", minWidth: 200 }}
            aria-label="اختر يوم الحضور"
            value={column}
            onChange={(e) => p.onColumn(Number(e.target.value))}
          >
            {columns.map((c, i) => (
              <option key={c.key} value={i}>
                {dayLabel(i)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.boardStep}
            aria-label="اليوم التالي"
            disabled={column === n - 1}
            onClick={() => p.onColumn(column + 1)}
          >
            ←
          </button>
        </div>
        <span className="text-sm tnum" style={{ color: "var(--ink-muted)" }} aria-live="polite">
          الأسبوع {col.week + 1} · يوم {column + 1} من {n}
          {dates.length > 0 && ` · ${dates.length === 1 ? fullDate(dates[0]) : rangeLabel(dates[0], dates[dates.length - 1])}`}
        </span>
      </div>

      {holiday && (
        <p className="card text-sm" style={{ padding: "8px 12px", color: "var(--ink-muted)" }}>
          عطلة رسمية: {holiday}
        </p>
      )}

      <div className={styles.board}>
        {panels.map((panel, pi) => {
          const hosp = hospitalBy.get(panel.hospitalId);
          return (
            <section
              key={panel.hospitalId}
              className={styles.panel}
              style={{ borderTopColor: hosp?.color }}
              aria-label={hosp?.name ?? "مستشفى"}
            >
              <div className={styles.panelHead}>
                <span className={`${styles.panelTitle} inline-flex items-center gap-2`}>
                  <Dot color={hosp?.color ?? "var(--ink-muted)"} />
                  {hosp?.name ?? "—"}
                </span>
                <span className={styles.panelSub}>
                  {panel.groups.length
                    ? panel.groups.map((b) => groupTitle(program.groups[b.groupIndex].name)).join("، ")
                    : "لا مجموعة"}
                </span>
              </div>
              {panel.groups.length === 0 ? (
                <div className={styles.panelEmpty}>لا توجد مجموعة في هذا المستشفى في هذا اليوم.</div>
              ) : (
                <>
                  {panel.groups.map((b, k) => (
                    <PanelGroup
                      key={b.groupIndex}
                      view={p}
                      b={b}
                      // Arrow-key rows continue across the groups of one panel.
                      firstRow={panel.groups
                        .slice(0, k)
                        .reduce((sum, x) => sum + program.groups[x.groupIndex].students.length, 0)}
                      panelIndex={pi}
                      showHeader={panel.groups.length > 1 || !col.dateISO}
                    />
                  ))}
                  <PanelFoot days={panelDays(p, panel.groups)} maxTotal={maxTotal} />
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PanelGroup({
  view,
  b,
  firstRow,
  panelIndex,
  showHeader,
}: {
  view: ViewProps;
  b: BoardGroup;
  firstRow: number;
  panelIndex: number;
  showHeader: boolean;
}) {
  const { program, hospitalBy, filter, query, data } = view;
  const { maxTotal } = data;
  const g = program.groups[b.groupIndex];
  const rows = visibleStudents(g.students, query, filter, maxTotal, (s) => [s.days[b.dateIndex]]);
  return (
    <>
      {showHeader && (
        <div className={styles.panelGroup}>
          {groupTitle(g.name)} · {fullDate(b.dateISO)}
        </div>
      )}
      {rows.length === 0 ? (
        <div className={styles.panelEmpty}>
          {g.students.length ? "لا يوجد طلاب يطابقون البحث أو التصفية" : "لا يوجد طلاب في هذه المجموعة"}
        </div>
      ) : (
        rows.map(({ student, index: si }) => {
          const day = student.days[b.dateIndex];
          return (
            <div key={student.id} className={styles.panelRow}>
              <NameCell student={student} />
              <DayCell
                day={day}
                maxTotal={maxTotal}
                id={cellId(b.groupIndex, si, b.dateIndex)}
                aria={dayAria(student, day, hospitalBy, maxTotal)}
                hit={dayMatches(filter, day, maxTotal)}
                nav={{ r: firstRow + si, c: panelIndex }}
              />
            </div>
          );
        })
      )}
    </>
  );
}

function panelDays(p: ViewProps, groups: BoardGroup[]): MatrixDay[] {
  return groups.flatMap((b) => p.program.groups[b.groupIndex].students.map((s) => s.days[b.dateIndex]));
}

function PanelFoot({ days, maxTotal }: { days: MatrixDay[]; maxTotal: number }) {
  const avg = averageOf(days);
  const decided = days.filter((d) => d.state === "ok" || d.state === "late" || d.state === "absent" || d.state === "disputed");
  const absent = days.filter((d) => d.state === "absent").length;
  const evaluators = Array.from(new Set(days.map((d) => d.evaluatorName).filter((e): e is string => !!e)));
  return (
    <div className={styles.panelFoot}>
      <span>
        المعدل <b>{fmtScore(avg)}</b> من {maxTotal}
        {avg !== null && " · مبدئي"}
      </span>
      <span>
        مُقيَّم <b>{decided.length}</b> من {days.length} · غياب <b>{absent}</b>
      </span>
      {evaluators.length > 0 && <span style={{ flexBasis: "100%" }}>المقيّم: {evaluators.join("، ")}</span>}
    </div>
  );
}
