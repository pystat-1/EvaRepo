
import { useMemo } from "react";
import {
  dayMatches,
  dayMonth,
  fmtPct,
  fmtScore,
  fullDate,
  heatBg,
  rangeLabel,
  rotationLayout,
  studentStats,
} from "@eva/core/gradeMatrix/build";
import { BandCellView, BandRow, CritCell, DayCell, EmptyState, HeadGrid, NameCell, NumCell, cellId, type HeadItem } from "./parts";
import { STUDENT_COL, capRows, dayAria, gridCols, groupTitle, visibleStudents, lazyStats, type ViewProps } from "./common";
import styles from "./gradeMatrix.module.css";

const CRIT_W = 34;
const DAY_TOTAL_W = 48;

// Design 1 · الشبكة الدورانية: hospital → week at that hospital → day,
// with each hospital's average after its days. In "all criteria" mode every
// day opens into one narrow column per criterion plus the day's total.
export function RotationView(p: ViewProps) {
  const { data, program, hospitalBy, hospitalOrder, mode, filter, query } = p;
  const { maxTotal, criteria } = data;
  const crit = mode === "criteria";
  const C = criteria.length;

  const layout = useMemo(
    () => rotationLayout(program, hospitalOrder, { avgColumns: true, avgLabel: "المعدل", avgSub: `من ${maxTotal}` }),
    [program, hospitalOrder, maxTotal]
  );
  // Worked out only for the students actually drawn (a big course draws in steps).
  const stats = useMemo(() => lazyStats(program, C, maxTotal), [program, C, maxTotal]);

  const dayW = crit ? C * CRIT_W + DAY_TOTAL_W : 66;
  const widths = [STUDENT_COL, ...layout.columns.map((c) => (c.kind === "day" ? dayW : 70)), 64, 56];
  const cols = gridCols(widths);
  const inner = `repeat(${C}, ${CRIT_W}px) ${DAY_TOTAL_W}px`;

  const rows = crit ? 4 : 3;
  const head: HeadItem[] = [
    { key: "student", row: 1, rowSpan: rows, colSpan: 1, label: "الطالب", sticky: true, start: true },
  ];
  layout.heads[0].forEach((h, i) => {
    const hosp = h.hospitalId ? hospitalBy.get(h.hospitalId) : undefined;
    head.push({ key: `a${i}`, row: 1, colSpan: h.span, label: hosp?.name ?? "—", dot: hosp?.color, style: { fontSize: 13.5, fontWeight: 800 } });
  });
  head.push({ key: "course", row: 1, colSpan: 2, label: "الدورة", summary: true });
  layout.heads[1].forEach((h, i) =>
    head.push({ key: `b${i}`, row: 2, colSpan: h.span, label: h.label, summary: h.avg })
  );
  head.push({ key: "pct", row: 2, rowSpan: rows - 1, colSpan: 1, label: "النسبة", sub: "مبدئية", summary: true });
  head.push({ key: "abs", row: 2, rowSpan: rows - 1, colSpan: 1, label: "غياب", sub: "أيام", summary: true });
  layout.heads[2].forEach((h, i) =>
    head.push({
      key: `c${i}`,
      row: 3,
      colSpan: h.span,
      label: h.label,
      summary: h.avg,
      style: { fontSize: 11.5, fontWeight: 600, color: "var(--ink-muted)" },
    })
  );
  if (crit) {
    layout.columns.forEach((col) =>
      head.push({
        key: `d${col.key}`,
        row: 4,
        colSpan: 1,
        summary: col.kind !== "day",
        style: { padding: 0 },
        label:
          col.kind === "day" ? (
            <span style={{ display: "grid", gridTemplateColumns: inner, width: dayW }}>
              {criteria.map((c, ci) => (
                <span key={c.id} title={`${c.label} (من ${c.max})`} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink-muted)" }}>
                  م{ci + 1}
                </span>
              ))}
              <span style={{ fontSize: 10.5, fontWeight: 800 }}>مجموع</span>
            </span>
          ) : (
            ""
          ),
      })
    );
  }

  const visibleByGroup = capRows(program.groups.map((g) => visibleStudents(g.students, query, filter, maxTotal)), p.limit);
  const shown = visibleByGroup.reduce((n, rows) => n + rows.length, 0);
  const navBase: number[] = [];
  for (let gi = 0, n = 0; gi < visibleByGroup.length; n += visibleByGroup[gi].length, gi++) navBase.push(n);

  const blocks = program.groups.map((g, gi) => {
    const visible = visibleByGroup[gi];
    if (visible.length === 0) return null;
    const slots = layout.slots[g.id];
    return (
      <div key={g.id}>
        <BandRow cols={cols} name={groupTitle(g.name)}>
          {layout.bands[g.id].map((b, i) => (
            <BandCellView key={i} span={b.span} dot={b.hospitalId ? hospitalBy.get(b.hospitalId)?.color : null}>
              {b.from ? `الدوران ${b.order} · ${rangeLabel(b.from, b.to!)}` : "لا دوران هنا"}
            </BandCellView>
          ))}
          <BandCellView span={2} />
        </BandRow>
        {visible.map(({ student, index: si }, k) => {
          const st = stats.get(student.id)!;
          const r = navBase[gi] + k;
          return (
            <div key={student.id} className={styles.row} style={{ gridTemplateColumns: cols }}>
              <NameCell student={student} />
              {layout.columns.map((col, c) => {
                if (col.kind === "hospAvg") {
                  const a = st.hospAvg[col.hospitalId] ?? null;
                  return <NumCell key={col.key} text={fmtScore(a)} bg={heatBg(a === null ? null : (a / maxTotal) * 100)} />;
                }
                const i = slots[c];
                const day = i === null ? null : student.days[i];
                const id = day ? cellId(gi, si, i!) : "";
                const aria = day ? dayAria(student, day, hospitalBy, maxTotal) : "";
                const hit = !!day && dayMatches(filter, day, maxTotal);
                if (!crit) {
                  return (
                    <DayCell
                      key={col.key}
                      day={day}
                      maxTotal={maxTotal}
                      id={id}
                      aria={aria}
                      hit={hit}
                      sub={day ? dayMonth(day.dateISO) : undefined}
                      nav={{ r, c }}
                    />
                  );
                }
                return (
                  <div key={col.key} style={{ display: "grid", gridTemplateColumns: inner }}>
                    {criteria.map((cr, ci) => {
                      const val = day?.scores?.[ci];
                      return (
                        <CritCell
                          key={cr.id}
                          day={day}
                          ci={ci}
                          max={cr.max}
                          id={id}
                          hit={hit}
                          height={52}
                          aria={
                            day
                              ? `${student.name}، ${cr.label}، ${fullDate(day.dateISO)}، ${
                                  val === null || val === undefined ? "لا درجة" : `${fmtScore(val)} من ${cr.max}`
                                }`
                              : ""
                          }
                          nav={{ r, c: c * (C + 1) + ci }}
                        />
                      );
                    })}
                    <DayCell day={day} maxTotal={maxTotal} id={id} aria={aria} hit={hit} size="sm" nav={{ r, c: c * (C + 1) + C }} />
                  </div>
                );
              })}
              <NumCell text={fmtPct(st.pct)} weight={800} />
              <NumCell text={String(st.absences)} weight={600} fg={st.absences ? "var(--red-700)" : undefined} />
            </div>
          );
        })}
      </div>
    );
  });

  return (
    <div className={styles.scroller} role="region" aria-label="الشبكة الدورانية" tabIndex={0}>
      <div className={styles.table}>
        <HeadGrid cols={cols} rows={rows} items={head} />
        {blocks}
      </div>
      {shown === 0 && (
        <div className="p-4">
          <EmptyState title="لا يوجد طلاب يطابقون البحث أو التصفية" />
        </div>
      )}
    </div>
  );
}
