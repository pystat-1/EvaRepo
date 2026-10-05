import { useMemo, useState } from "react";
import {
  averageOf,
  counts,
  dateLayout,
  dayBoard,
  dayMatches,
  dayMonth,
  fmtScore,
  fullDate,
  rangeLabel,
  weekdayAr,
  type DayColumn,
} from "@eva/core/gradeMatrix/build";
import { criterionVisual } from "@eva/core/gradeMatrix/visual";
import type { MatrixDay, MatrixStudent } from "@eva/core/gradeMatrix/types";
import { DayCell, Dot, EmptyState, StudentIds, cellId } from "./parts";
import { dayAria, groupTitle, visibleStudents, type ViewProps } from "./common";
import styles from "./gradeMatrix.module.css";

type SortKey = "name" | "total" | `c${number}`;

const ATTENDANCE: Record<string, string> = { present: "حاضر", late: "متأخر", absent: "غائب" };

// «كشف اليوم»: one attendance day, every student with all criteria, grouped
// by hospital and then by the group there that day. Columns are the
// calendar-order day columns of the course matrix, so its day headers open
// the same day here.
export function DaySheet(p: ViewProps & { column: number; onColumn: (column: number) => void }) {
  const { data, program, hospitalBy, hospitalOrder, filter, query } = p;
  const { maxTotal, holidays, criteria } = data;
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 1 | -1 }>({ key: null, dir: -1 });
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
    return `${when} · اليوم ${c + 1}`;
  };
  const col = columns[column];
  const dates = Array.from(new Set(panels.flatMap((x) => x.groups.map((b) => b.dateISO)))).sort();
  const holiday = dates.length > 0 && dates.every((d) => d in holidays) ? holidays[dates[0]] : null;
  const span = criteria.length + 5;

  const value = (key: SortKey, s: MatrixStudent, day: MatrixDay): string | number | null => {
    if (key === "name") return s.name;
    if (!counts(day)) return null;
    if (key === "total") return day.total;
    return day.scores?.[Number(key.slice(1))] ?? null;
  };
  const sorted = <T extends { student: MatrixStudent; day: MatrixDay }>(rows: T[]): T[] => {
    const key = sort.key;
    if (!key) return rows;
    return rows.slice().sort((a, b) => {
      const va = value(key, a.student, a.day);
      const vb = value(key, b.student, b.day);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(String(vb), "ar") : va - (vb as number);
      return cmp * sort.dir;
    });
  };
  const sortHead = (key: SortKey, label: string, sub?: string) => (
    <th key={key} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={styles.sortBtn}
        onClick={() => setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
        {sub && <span className={styles.hcellSub}>{sub}</span>}
      </button>
    </th>
  );

  let nav = 0;
  return (
    <div className="flex flex-col gap-3" role="region" aria-label="كشف اليوم">
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

      <div className={styles.scroller} tabIndex={0}>
        <table className={styles.sheet}>
          <thead>
            <tr>
              {sortHead("name", "الطالب")}
              {criteria.map((c, ci) => sortHead(`c${ci}`, c.label, `من ${c.max}`))}
              {sortHead("total", "المجموع", `من ${maxTotal}`)}
              <th>الحضور</th>
              <th>المقيّم</th>
              <th className={styles.sheetStart}>ملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {panels.map((panel) => {
              const hosp = hospitalBy.get(panel.hospitalId);
              if (panel.groups.length === 0) {
                return (
                  <tr key={panel.hospitalId} className={styles.sheetGroup}>
                    <td colSpan={span}>
                      <span className="inline-flex items-center gap-2">
                        <Dot color={hosp?.color ?? "var(--ink-muted)"} />
                        {hosp?.name ?? "—"}
                        <span className={styles.sheetGroupMeta}>لا توجد مجموعة في هذا المستشفى في هذا اليوم</span>
                      </span>
                    </td>
                  </tr>
                );
              }
              return panel.groups.map((b) => {
                const g = program.groups[b.groupIndex];
                const all = g.students.map((student, index) => ({ student, index, day: student.days[b.dateIndex] }));
                const days = all.map((x) => x.day);
                const visible = new Set(
                  visibleStudents(g.students, query, filter, maxTotal, (s) => [s.days[b.dateIndex]]).map((x) => x.student.id)
                );
                const rows = sorted(all.filter((x) => visible.has(x.student.id)));
                if (rows.length === 0 && (query || filter !== "all")) return null;
                const decided = days.filter((d) => d.state === "ok" || d.state === "late" || d.state === "absent" || d.state === "disputed").length;
                const evaluators = Array.from(new Set(days.map((d) => d.evaluatorName).filter((e): e is string => !!e)));
                const avgCrit = (ci: number) => {
                  const vals = days.filter(counts).map((d) => d.scores?.[ci]).filter((v): v is number => typeof v === "number");
                  return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
                };
                return [
                  <tr key={`${b.groupIndex}h`} className={styles.sheetGroup}>
                    <td colSpan={span} style={{ boxShadow: `inset -4px 0 0 ${hosp?.color ?? "transparent"}` }}>
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <Dot color={hosp?.color ?? "var(--ink-muted)"} />
                        {hosp?.name ?? "—"} · {groupTitle(g.name)}
                        {!col.dateISO && <span className={styles.sheetGroupMeta}>{fullDate(b.dateISO)}</span>}
                        <span className={styles.sheetGroupMeta}>
                          مُقيَّم {decided} من {days.length}
                          {evaluators.length > 0 && ` · المقيّم: ${evaluators.join("، ")}`}
                        </span>
                      </span>
                    </td>
                  </tr>,
                  ...rows.map(({ student, index, day }) => {
                    const r = nav++;
                    return (
                      <tr key={student.id}>
                        <td className={styles.sheetStart}>
                          <div className={styles.nameText}>
                            <span className={styles.name} title={student.name}>
                              {student.name}
                            </span>
                            <StudentIds student={student} />
                          </div>
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
                            id={cellId(b.groupIndex, index, b.dateIndex)}
                            aria={dayAria(student, day, hospitalBy, maxTotal)}
                            hit={dayMatches(filter, day, maxTotal)}
                            size="sm"
                            nav={{ r, c: 0 }}
                          />
                        </td>
                        <td style={{ color: day.attendance === "absent" ? "var(--red-700)" : day.attendance === "late" ? "var(--amber-700)" : undefined, fontWeight: 700 }}>
                          {(day.attendance && ATTENDANCE[day.attendance]) || "—"}
                        </td>
                        <td className={styles.sheetMuted}>{day.evaluatorName ?? "—"}</td>
                        <td className={`${styles.sheetStart} ${styles.sheetNote}`} title={day.notes ?? day.feedback ?? ""}>
                          {day.notes ?? day.feedback ?? ""}
                        </td>
                      </tr>
                    );
                  }),
                  <tr key={`${b.groupIndex}a`} className={styles.sheetAvg}>
                    <td className={styles.sheetStart}>معدل {groupTitle(g.name)}</td>
                    {criteria.map((c, ci) => (
                      <td key={c.id}>{fmtScore(avgCrit(ci))}</td>
                    ))}
                    <td>{fmtScore(averageOf(days))}</td>
                    <td colSpan={3} className={styles.sheetStart}>
                      غياب {days.filter((d) => d.state === "absent").length} · ناقص {days.filter((d) => d.state === "missing").length}
                    </td>
                  </tr>,
                ];
              });
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        اضغط عنوان أي عمود للترتيب · اضغط المجموع لعرض تفاصيل اليوم
      </p>
    </div>
  );
}
