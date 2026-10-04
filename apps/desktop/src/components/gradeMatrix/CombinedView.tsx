
import { Fragment, useMemo, type ReactNode } from "react";
import {
  averageOf,
  counts,
  dateLayout,
  dayBoard,
  dayMatches,
  dayMonth,
  fmtPct,
  fmtScore,
  fullDate,
  heatBg,
  programHospitals,
  rangeLabel,
  rotationLayout,
  rotationOrder,
  studentStats,
  type Layout,
  type Period,
} from "@eva/core/gradeMatrix/build";
import type { MatrixDay } from "@eva/core/gradeMatrix/types";
import {
  AvgBar,
  BandCellView,
  BandRow,
  CritCell,
  DayCell,
  Dot,
  EmptyState,
  HeadGrid,
  NameCell,
  NumCell,
  SparkCell,
  cellId,
  type HeadItem,
} from "./parts";
import { STUDENT_COL, capRows, dayAria, gridCols, groupTag, groupTitle, shortHospital, visibleStudents, lazyStats, type ViewProps } from "./common";
import styles from "./gradeMatrix.module.css";

export type Scope = "all" | "sum" | "day" | `p${number}`;
export type Order = "hosp" | "date";

export function CombinedView(
  p: ViewProps & {
    periods: Period[];
    scope: Scope;
    order: Order;
    expanded: Record<string, boolean>;
    onToggle: (studentId: string, open: boolean) => void;
    onOpenDay: (column: number) => void;
  }
) {
  const { data, program, hospitalBy, hospitalOrder, mode, filter, query, periods } = p;
  const { maxTotal, criteria, holidays } = data;
  const per = p.scope.startsWith("p") ? Number(p.scope.slice(1)) : -1;
  const period = per >= 0 ? periods[per] ?? null : null;
  const scope: Scope = per >= 0 && !period ? "all" : p.scope;
  const isSum = scope === "sum";
  const isAll = scope === "all";
  const byHosp = isAll && p.order === "hosp";
  // Whole course in calendar order: each day says where every group is.
  const byDate = isAll && !byHosp;

  const hospitals = useMemo(() => programHospitals(program, hospitalOrder), [program, hospitalOrder]);
  // Worked out only for the students actually drawn (a big course draws in steps).
  const stats = useMemo(() => lazyStats(program, criteria.length, maxTotal), [program, criteria.length, maxTotal]);

  const layout: Layout | null = useMemo(() => {
    if (isSum) return null;
    if (period) return dateLayout(program, holidays, period);
    return byHosp ? rotationLayout(program, hospitalOrder, { avgColumns: false }) : dateLayout(program, holidays);
  }, [isSum, period, byHosp, program, hospitalOrder, holidays]);

  // Per day column: which group is at each hospital (calendar order only).
  const occupancy = useMemo(
    () =>
      layout && byDate
        ? layout.columns.map((_, c) =>
            dayBoard(program, layout, c, hospitalOrder).map((panel) => ({
              hospitalId: panel.hospitalId,
              groups: panel.groups.map((b) => program.groups[b.groupIndex].name),
            }))
          )
        : null,
    [layout, byDate, program, hospitalOrder]
  );

  const H = hospitals.length;
  const C = criteria.length;
  const nCols = layout ? layout.columns.length : 0;
  const dayW = period ? 156 : 64;
  const sumWidths = isAll
    ? [...hospitals.map(() => 66), 128, 62, 54]
    : period
      ? [96, 84, 86]
      : [...hospitals.map(() => 96), ...criteria.map(() => 88), 80, 64, 56, 128];
  const sumN = sumWidths.length;
  const cols = gridCols([STUDENT_COL, ...Array(nCols).fill(dayW), ...sumWidths]);

  // ---- header ----------------------------------------------------------
  const head: HeadItem[] = [];
  let headRows = 2;
  if (layout) {
    headRows = layout.heads.length;
    head.push({ key: "student", row: 1, rowSpan: headRows, colSpan: 1, label: "الطالب", sticky: true, start: true });
    layout.heads.forEach((row, ri) => {
      row.forEach((h, i) => {
        const hosp = h.hospitalId ? hospitalBy.get(h.hospitalId) : undefined;
        const occ = ri === headRows - 1 ? occupancy?.[i] : undefined;
        head.push({
          key: `h${ri}:${i}`,
          row: ri + 1,
          colSpan: h.span,
          label: occ ? (
            <DayHead label={h.label} occ={occ} hospitalBy={hospitalBy} onOpen={() => p.onOpenDay(i)} />
          ) : ri === 0 && byHosp ? (
            hosp?.name ?? "—"
          ) : (
            h.label
          ),
          dot: ri === 0 && byHosp ? hosp?.color : undefined,
          sub: h.sub,
          holiday: h.holiday,
          style: ri === headRows - 1 ? { fontSize: 11, fontWeight: 600, color: "var(--ink-muted)" } : undefined,
        });
      });
      if (ri === 0) {
        head.push({
          key: "sumTitle",
          row: 1,
          colSpan: sumN,
          label: isAll ? "ملخص الطالب" : "ملخص الفترة",
          summary: true,
        });
      }
      if (ri === 1) {
        const span = headRows - 1;
        const labels: { label: string; sub?: string; dot?: string }[] = isAll
          ? [
              ...hospitals.map((h) => ({
                label: shortHospital(hospitalBy.get(h)?.name ?? "—"),
                sub: `من ${maxTotal}`,
                dot: hospitalBy.get(h)?.color,
              })),
              { label: "الاتجاه", sub: "مجموع اليوم" },
              { label: "النسبة", sub: "مبدئية" },
              { label: "غياب", sub: "أيام" },
            ]
          : [
              { label: "معدل الفترة", sub: `من ${maxTotal}` },
              { label: "الحضور", sub: "أيام" },
              { label: "نسبة الدورة", sub: "مبدئية" },
            ];
        labels.forEach((l, i) =>
          head.push({ key: `sum${i}`, row: 2, rowSpan: span, colSpan: 1, summary: true, ...l })
        );
      }
    });
  } else {
    head.push({ key: "student", row: 1, rowSpan: 2, colSpan: 1, label: "الطالب", sticky: true, start: true });
    head.push({ key: "t1", row: 1, colSpan: H, label: "معدل اليوم في كل مستشفى" });
    head.push({ key: "t2", row: 1, colSpan: C, label: "معدل كل معيار عبر الدورة" });
    head.push({ key: "t3", row: 1, colSpan: 4, label: "الدورة", summary: true });
    hospitals.forEach((h) =>
      head.push({
        key: `sh${h}`,
        row: 2,
        colSpan: 1,
        label: shortHospital(hospitalBy.get(h)?.name ?? "—"),
        sub: `من ${maxTotal}`,
        dot: hospitalBy.get(h)?.color,
      })
    );
    criteria.forEach((c) => head.push({ key: `sc${c.id}`, row: 2, colSpan: 1, label: c.label, sub: `من ${c.max}` }));
    head.push({ key: "savg", row: 2, colSpan: 1, label: "المعدل", sub: `من ${maxTotal}`, summary: true });
    head.push({ key: "spct", row: 2, colSpan: 1, label: "النسبة", sub: "مبدئية", summary: true });
    head.push({ key: "sabs", row: 2, colSpan: 1, label: "غياب", sub: "أيام", summary: true });
    head.push({ key: "strend", row: 2, colSpan: 1, label: "الاتجاه", sub: "مجموع اليوم", summary: true });
  }

  // ---- body ------------------------------------------------------------
  // The days of a student inside the current scope (a period, or all).
  const scopeDaysOf = (groupId: string, days: MatrixDay[]) =>
    layout ? (layout.slots[groupId].filter((i) => i !== null) as number[]).map((i) => days[i]) : days;
  const isOpen = (studentId: string) => !isSum && (p.expanded[studentId] ?? mode === "criteria");
  const visibleByGroup = capRows(
    program.groups.map((g) => visibleStudents(g.students, query, filter, maxTotal, (s) => scopeDaysOf(g.id, s.days))),
    p.limit
  );
  const shown = visibleByGroup.reduce((n, rows) => n + rows.length, 0);
  // Arrow-key row numbers: each student row, then its criteria rows if open.
  const navStart = new Map<string, number>();
  let nextNav = 0;
  for (const rows of visibleByGroup) {
    for (const { student } of rows) {
      navStart.set(student.id, nextNav);
      nextNav += 1 + (layout && isOpen(student.id) ? C : 0);
    }
  }

  const groupBlocks = program.groups.map((g, gi) => {
    const slots = layout?.slots[g.id] ?? [];
    const scopeDays = (days: MatrixDay[]) => scopeDaysOf(g.id, days);
    const rows = visibleByGroup[gi];
    if (rows.length === 0) return null;

    const order = rotationOrder(g);
    let band: ReactNode;
    if (!layout) {
      const seq = Array.from(order.keys()).map((h) => shortHospital(hospitalBy.get(h)?.name ?? "—"));
      band = (
        <BandCellView span={nCols + sumN} start>
          {seq.length ? `ترتيب الدوران: ${seq.join(" ← ")}` : "لا يوجد جدول دوران لهذه المجموعة"}
        </BandCellView>
      );
    } else {
      band = (
        <>
          {layout.bands[g.id].map((b, i) => {
            const h = b.hospitalId ? hospitalBy.get(b.hospitalId) : undefined;
            let text = "";
            if (byHosp) text = b.from ? `الدوران ${b.order} · ${rangeLabel(b.from, b.to!)}` : "لا دوران هنا";
            else if (h && b.from)
              text = period
                ? `${h.name} · الدوران ${b.order} · ${rangeLabel(b.from, b.to!)}`
                : `${shortHospital(h.name)} · ${rangeLabel(b.from, b.to!)}`;
            return (
              <BandCellView key={i} span={b.span} dot={h?.color} start={!!period}>
                {text}
              </BandCellView>
            );
          })}
          <BandCellView span={sumN} />
        </>
      );
    }

    return (
      <div key={g.id}>
        <BandRow cols={cols} name={`المجموعة ${g.name}`}>
          {band}
        </BandRow>
        {rows.map(({ student, index: si }) => {
          const st = stats.get(student.id)!;
          const open = isOpen(student.id);
          const r = navStart.get(student.id)!;
          const dayFor = (c: number) => {
            const i = slots[c];
            return i === null || i === undefined ? null : { day: student.days[i], i };
          };
          const inScope = scopeDays(student.days);
          return (
            <Fragment key={student.id}>
              <div className={styles.row} style={{ gridTemplateColumns: cols }}>
                <NameCell
                  student={student}
                  toggle={
                    isSum
                      ? undefined
                      : {
                          expanded: open,
                          onToggle: () => p.onToggle(student.id, !open),
                          label: `${open ? "إخفاء" : "عرض"} معايير ${student.name}`,
                        }
                  }
                />
                {layout &&
                  layout.columns.map((col, c) => {
                    const x = dayFor(c);
                    const sub = x
                      ? period
                        ? x.day.evaluatorName ?? dayMonth(x.day.dateISO)
                        : byHosp || (col.kind === "day" && !col.dateISO)
                          ? dayMonth(x.day.dateISO)
                          : undefined
                      : undefined;
                    return (
                      <DayCell
                        key={col.key}
                        day={x?.day ?? null}
                        maxTotal={maxTotal}
                        id={x ? cellId(gi, si, x.i) : ""}
                        aria={x ? dayAria(student, x.day, hospitalBy, maxTotal) : ""}
                        hit={!!x && dayMatches(filter, x.day, maxTotal)}
                        sub={sub}
                        size={period ? "lg" : "md"}
                        nav={{ r, c }}
                        stripe={byDate && x ? hospitalBy.get(x.day.hospitalId)?.color : undefined}
                      />
                    );
                  })}
                {isAll && (
                  <>
                    {hospitals.map((h) => {
                      const a = st.hospAvg[h] ?? null;
                      return (
                        <NumCell key={h} text={fmtScore(a)} bg={heatBg(a === null ? null : (a / maxTotal) * 100)} />
                      );
                    })}
                    <SparkCell days={student.days} maxTotal={maxTotal} label={`اتجاه مجموع اليوم لـ ${student.name}`} />
                    <NumCell text={fmtPct(st.pct)} weight={800} />
                    <NumCell text={String(st.absences)} weight={600} fg={st.absences ? "var(--red-700)" : undefined} />
                  </>
                )}
                {period && <PeriodSummary days={inScope} maxTotal={maxTotal} coursePct={st.pct} />}
                {isSum && (
                  <>
                    {hospitals.map((h) => {
                      const a = st.hospAvg[h] ?? null;
                      return (
                        <NumCell key={h} text={fmtScore(a)} bg={heatBg(a === null ? null : (a / maxTotal) * 100)} />
                      );
                    })}
                    {criteria.map((c, ci) => {
                      const a = st.critAvg[ci];
                      return <NumCell key={c.id} text={fmtScore(a)} bg={heatBg(a === null ? null : (a / c.max) * 100)} />;
                    })}
                    <NumCell text={fmtScore(st.avg)} weight={800} />
                    <NumCell text={fmtPct(st.pct)} weight={800} />
                    <NumCell text={String(st.absences)} weight={600} fg={st.absences ? "var(--red-700)" : undefined} />
                    <SparkCell days={student.days} maxTotal={maxTotal} label={`اتجاه مجموع اليوم لـ ${student.name}`} />
                  </>
                )}
              </div>
              {open &&
                layout &&
                criteria.map((crit, ci) => {
                  const cr = r + 1 + ci;
                  const vals = inScope
                    .filter(counts)
                    .map((d) => d.scores?.[ci])
                    .filter((v): v is number => typeof v === "number");
                  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                  return (
                    <div key={crit.id} className={styles.critRow} style={{ gridTemplateColumns: cols }}>
                      <div className={`${styles.critLabel} ${styles.stickyStart}`}>
                        <span style={{ fontWeight: 600 }}>{crit.label}</span>
                        <span style={{ color: "var(--ink-muted)", fontSize: 11 }}>من {crit.max}</span>
                      </div>
                      {layout.columns.map((col, c) => {
                        const x = dayFor(c);
                        const val = x?.day.scores?.[ci];
                        return (
                          <CritCell
                            key={col.key}
                            day={x?.day ?? null}
                            ci={ci}
                            max={crit.max}
                            id={x ? cellId(gi, si, x.i) : ""}
                            aria={
                              x
                                ? `${student.name}، ${crit.label}، ${fullDate(x.day.dateISO)}، ${
                                    val === null || val === undefined ? "لا درجة" : `${fmtScore(val)} من ${crit.max}`
                                  }`
                                : ""
                            }
                            hit={!!x && dayMatches(filter, x.day, maxTotal)}
                            nav={{ r: cr, c }}
                          />
                        );
                      })}
                      <AvgBar value={avg} max={crit.max} span={sumN} />
                    </div>
                  );
                })}
            </Fragment>
          );
        })}
      </div>
    );
  });

  return (
    <div className={styles.scroller} role="region" aria-label="مصفوفة الدرجات" tabIndex={0}>
      <div className={styles.table}>
        <HeadGrid cols={cols} rows={headRows} items={head} />
        {groupBlocks}
      </div>
      {shown === 0 && (
        <div className="p-4">
          <EmptyState title="لا يوجد طلاب يطابقون البحث أو التصفية" />
        </div>
      )}
    </div>
  );
}

function PeriodSummary({ days, maxTotal, coursePct }: { days: MatrixDay[]; maxTotal: number; coursePct: number | null }) {
  const avg = averageOf(days);
  const decided = days.filter((d) => d.state === "ok" || d.state === "late" || d.state === "disputed" || d.state === "absent");
  const attended = decided.filter((d) => d.state !== "absent").length;
  return (
    <>
      <NumCell text={fmtScore(avg)} weight={800} bg={heatBg(avg === null ? null : (avg / maxTotal) * 100)} />
      <NumCell text={decided.length ? `${attended} من ${decided.length}` : "—"} weight={600} />
      <NumCell text={fmtPct(coursePct)} />
    </>
  );
}

// A calendar-order day header: the date, then one line per hospital with
// the group there that day. Opens the day board for that day.
function DayHead({
  label,
  occ,
  hospitalBy,
  onOpen,
}: {
  label: string;
  occ: { hospitalId: string; groups: string[] }[];
  hospitalBy: Map<string, { name: string; color: string }>;
  onOpen: () => void;
}) {
  const where = occ
    .map((o) => `${hospitalBy.get(o.hospitalId)?.name ?? "—"}: ${o.groups.length ? o.groups.map(groupTitle).join("، ") : "لا مجموعة"}`)
    .join(" · ");
  return (
    <button
      type="button"
      className={styles.dayHead}
      onClick={onOpen}
      title={`${where}
اضغط لعرض اليوم في كل المستشفيات`}
      aria-label={`${label}. ${where}. عرض اليوم في كل المستشفيات`}
    >
      <span>{label}</span>
      <span className={styles.occ} aria-hidden>
        {occ.map((o) => (
          <span key={o.hospitalId}>
            <Dot color={hospitalBy.get(o.hospitalId)?.color ?? "var(--ink-muted)"} />
            {o.groups.length ? o.groups.map(groupTag).join("، ") : "—"}
          </span>
        ))}
      </span>
    </button>
  );
}
