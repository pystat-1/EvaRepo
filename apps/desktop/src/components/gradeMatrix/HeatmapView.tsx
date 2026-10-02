
import { useMemo, type ReactNode } from "react";
import {
  dateLayout,
  dayMatches,
  dayMonth,
  fmtPct,
  fmtScore,
  fullDate,
  rangeLabel,
  rotationOrder,
  studentStats,
} from "@eva/core/gradeMatrix/build";
import { cellVisual, criterionVisual } from "@eva/core/gradeMatrix/visual";
import type { MatrixGroup, MatrixStudent } from "@eva/core/gradeMatrix/types";
import {
  BandCellView,
  BandRow,
  DayCell,
  Dot,
  EmptyState,
  HeadGrid,
  NameCell,
  NumCell,
  SparkCell,
  StudentIds,
  cellId,
  type HeadItem,
} from "./parts";
import { STUDENT_COL, capRows, dayAria, gridCols, shortHospital, visibleStudents, lazyStats, type StatsLookup, type ViewProps } from "./common";
import styles from "./gradeMatrix.module.css";

// Design 5 · الخريطة الحرارية: the whole course at a glance in calendar
// order, one compact colored cell per day; "all criteria" turns every
// student into a card with a criterion × day mini heatmap.
export function HeatmapView(p: ViewProps) {
  const { data, program, hospitalBy, mode, filter, query } = p;
  const { maxTotal, criteria, holidays } = data;

  const layout = useMemo(() => dateLayout(program, holidays), [program, holidays]);
  // Worked out only for the students actually drawn (a big course draws in steps).
  const stats = useMemo(() => lazyStats(program, criteria.length, maxTotal), [program, criteria.length, maxTotal]);

  if (mode === "criteria") return <HeatCards {...p} stats={stats} />;

  const cols = gridCols([STUDENT_COL, ...layout.columns.map(() => 48), 128, 62]);
  const head: HeadItem[] = [{ key: "student", row: 1, rowSpan: 2, colSpan: 1, label: "الطالب", sticky: true, start: true }];
  layout.heads[0].forEach((h, i) => head.push({ key: `w${i}`, row: 1, colSpan: h.span, label: h.label, sub: h.sub }));
  head.push({ key: "trend", row: 1, rowSpan: 2, colSpan: 1, label: "الاتجاه", sub: "مجموع اليوم", summary: true });
  head.push({ key: "pct", row: 1, rowSpan: 2, colSpan: 1, label: "النسبة", sub: "مبدئية", summary: true });
  layout.heads[1].forEach((h, i) => {
    const col = layout.columns[i];
    head.push({
      key: `d${i}`,
      row: 2,
      colSpan: 1,
      // The date alone fits a compact column; each cell's label names the weekday.
      label: col.kind === "day" && col.dateISO ? dayMonth(col.dateISO) : h.label,
      holiday: h.holiday,
      style: { fontSize: 11, fontWeight: 600, color: "var(--ink-muted)" },
    });
  });

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
        <BandRow cols={cols} name={`المجموعة ${g.name}`}>
          {layout.bands[g.id].map((b, i) => {
            const h = b.hospitalId ? hospitalBy.get(b.hospitalId) : undefined;
            return (
              <BandCellView key={i} span={b.span} dot={h?.color}>
                {h ? shortHospital(h.name) : ""}
              </BandCellView>
            );
          })}
          <BandCellView span={2} />
        </BandRow>
        {visible.map(({ student, index: si }, k) => {
          const st = stats.get(student.id)!;
          const r = navBase[gi] + k;
          return (
            <div key={student.id} className={styles.row} style={{ gridTemplateColumns: cols }}>
              <NameCell student={student} />
              {layout.columns.map((col, c) => {
                const i = slots[c];
                const day = i === null ? null : student.days[i];
                return (
                  <DayCell
                    key={col.key}
                    day={day}
                    maxTotal={maxTotal}
                    id={day ? cellId(gi, si, i!) : ""}
                    aria={day ? dayAria(student, day, hospitalBy, maxTotal) : ""}
                    hit={!!day && dayMatches(filter, day, maxTotal)}
                    size="sm"
                    nav={{ r, c }}
                  />
                );
              })}
              <SparkCell days={student.days} maxTotal={maxTotal} label={`اتجاه مجموع اليوم لـ ${student.name}`} />
              <NumCell text={fmtPct(st.pct)} weight={800} />
            </div>
          );
        })}
      </div>
    );
  });

  return (
    <div className={styles.scroller} role="region" aria-label="الخريطة الحرارية" tabIndex={0}>
      <div className={styles.table}>
        <HeadGrid cols={cols} rows={2} items={head} />
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

function HeatCards(p: ViewProps & { stats: StatsLookup }) {
  const { program, filter, query, data } = p;
  const capped = capRows(program.groups.map((g) => visibleStudents(g.students, query, filter, data.maxTotal)), p.limit);
  const groups = program.groups.map((g, gi) => ({ g, gi, visible: capped[gi] })).filter((x) => x.visible.length > 0);
  if (groups.length === 0) return <EmptyState title="لا يوجد طلاب يطابقون البحث أو التصفية" />;
  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ g, gi, visible }) => {
        const seq = Array.from(rotationOrder(g).keys()).map((h) => shortHospital(p.hospitalBy.get(h)?.name ?? "—"));
        return (
          <section key={g.id} aria-label={`المجموعة ${g.name}`} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h3 className="text-base font-bold">المجموعة {g.name}</h3>
              {seq.length > 0 && (
                <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  ترتيب الدوران: {seq.join(" ← ")}
                </span>
              )}
            </div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 460px), 1fr))" }}>
              {visible.map(({ student, index: si }) => (
                <StudentCard key={student.id} {...p} group={g} gi={gi} student={student} si={si} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StudentCard({
  data,
  hospitalBy,
  filter,
  stats,
  group,
  gi,
  student,
  si,
}: ViewProps & {
  stats: StatsLookup;
  group: MatrixGroup;
  gi: number;
  student: MatrixStudent;
  si: number;
}) {
  const { criteria, maxTotal } = data;
  const st = stats.get(student.id)!;
  const n = student.days.length;
  const cols = `132px repeat(${n}, 34px) 46px`;
  const stints = group.stints;
  return (
    <article className={styles.card} aria-label={student.name}>
      <header className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="font-bold truncate">{student.name}</p>
          <p>
            <StudentIds student={student} />
          </p>
        </div>
        <div className="text-end shrink-0">
          <p className="tnum font-bold text-lg" style={{ color: "var(--brand-dark)" }}>
            {fmtScore(st.avg)} <span className="text-xs font-semibold" style={{ color: "var(--ink-muted)" }}>من {maxTotal}</span>
          </p>
          <p className="tnum text-xs" style={{ color: "var(--ink-muted)" }}>
            {fmtPct(st.pct)} · غياب {st.absences}
          </p>
        </div>
      </header>
      {stints.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs">
          {stints.map((s, i) => {
            const h = hospitalBy.get(s.hospitalId);
            return (
              <span key={i} className="inline-flex items-center gap-1.5">
                <Dot color={h?.color ?? "#999"} />
                {shortHospital(h?.name ?? "—")} · {rangeLabel(s.start, s.end)}
              </span>
            );
          })}
        </div>
      )}
      {n === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          لا توجد أيام مجدولة لهذه المجموعة.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <div className={styles.mini} style={{ gridTemplateColumns: cols }}>
            <span />
            {student.days.map((d) => (
              <span
                key={d.dateISO}
                className="tnum text-center"
                style={{
                  fontSize: 10,
                  color: "var(--ink-muted)",
                  borderTop: `3px solid ${hospitalBy.get(d.hospitalId)?.color ?? "transparent"}`,
                  paddingTop: 2,
                }}
              >
                {dayMonth(d.dateISO)}
              </span>
            ))}
            <span className="text-center" style={{ fontSize: 10, fontWeight: 700 }}>
              المعدل
            </span>
            {criteria.map((c, ci) => (
              <MiniRow key={c.id} label={`${c.label} (${c.max})`} avg={fmtScore(st.critAvg[ci])}>
                {student.days.map((d, di) => {
                  const v = criterionVisual(d, ci, c.max);
                  const val = d.scores?.[ci];
                  return v.interactive ? (
                    <button
                      key={d.dateISO}
                      type="button"
                      className={styles.miniCell}
                      data-cell={cellId(gi, si, di)}
                      aria-haspopup="dialog"
                      aria-label={`${student.name}، ${c.label}، ${fullDate(d.dateISO)}، ${
                        val === null || val === undefined ? "لا درجة" : `${fmtScore(val)} من ${c.max}`
                      }`}
                      style={{
                        background: v.bg,
                        color: v.fg,
                        boxShadow: dayMatches(filter, d, maxTotal) ? "inset 0 0 0 2px var(--brand-dark)" : undefined,
                      }}
                    >
                      {v.text}
                    </button>
                  ) : (
                    <span key={d.dateISO} className={styles.miniCell} style={{ background: v.bg, cursor: "default" }} aria-hidden />
                  );
                })}
              </MiniRow>
            ))}
            <MiniRow label={`المجموع (${maxTotal})`} avg={fmtScore(st.avg)} bold>
              {student.days.map((d, di) => {
                const v = cellVisual(d, maxTotal);
                const text = d.state === "disputed" ? "تعارض" : d.state === "awaiting" ? "انتظار" : v.main;
                return v.interactive ? (
                  <button
                    key={d.dateISO}
                    type="button"
                    className={styles.miniCell}
                    data-cell={cellId(gi, si, di)}
                    aria-haspopup="dialog"
                    aria-label={dayAria(student, d, hospitalBy, maxTotal)}
                    style={{
                      background: v.bg,
                      color: v.fg,
                      fontSize: text.length > 4 ? 9 : 11.5,
                      boxShadow: dayMatches(filter, d, maxTotal)
                        ? "inset 0 0 0 2px var(--brand-dark)"
                        : v.border !== "transparent"
                          ? `inset 0 0 0 1.5px ${v.border}`
                          : undefined,
                    }}
                  >
                    {text}
                  </button>
                ) : (
                  <span key={d.dateISO} className={styles.miniCell} style={{ background: v.bg, cursor: "default" }} aria-hidden />
                );
              })}
            </MiniRow>
          </div>
        </div>
      )}
    </article>
  );
}

function MiniRow({
  label,
  avg,
  bold,
  children,
}: {
  label: string;
  avg: string;
  bold?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span
        className="truncate"
        title={label}
        style={{ fontSize: 11.5, fontWeight: bold ? 800 : 600, alignSelf: "center", paddingInlineEnd: 4 }}
      >
        {label}
      </span>
      {children}
      <span className="tnum text-center" style={{ fontSize: 12, fontWeight: 800, alignSelf: "center" }}>
        {avg}
      </span>
    </>
  );
}
