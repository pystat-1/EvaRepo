"use client";

import type { CSSProperties, ReactNode } from "react";
import { fmtScore, sparkline } from "@/lib/gradeMatrix/build";
import { cellVisual, criterionVisual } from "@/lib/gradeMatrix/visual";
import type { MatrixDay, MatrixStudent } from "@/lib/gradeMatrix/types";
import styles from "./gradeMatrix.module.css";

// Cells open the day popover through one delegated click handler on the
// grid (see GradeMatrix): each clickable cell carries data-cell="g:s:d",
// the group, student and day indexes inside the current program.
export const cellId = (g: number, s: number, d: number) => `${g}:${s}:${d}`;

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Dot({ color }: { color: string }) {
  return <span aria-hidden className={styles.dot} style={{ background: color }} />;
}

export interface HeadItem {
  key: string;
  row: number;
  rowSpan?: number;
  colSpan: number;
  label: ReactNode;
  sub?: string;
  dot?: string;
  sticky?: boolean;
  summary?: boolean;
  holiday?: boolean;
  start?: boolean; // align to the start instead of centering
  style?: CSSProperties;
}

export function HeadGrid({ cols, rows, items }: { cols: string; rows: number; items: HeadItem[] }) {
  return (
    <div
      className={styles.head}
      style={{ gridTemplateColumns: cols, gridTemplateRows: `repeat(${rows}, auto)` }}
    >
      {items.map((it) => (
        <div
          key={it.key}
          className={cx(
            styles.hcell,
            it.sticky && styles.stickyStart,
            it.summary && styles.hcellSummary,
            it.holiday && styles.hcellHoliday
          )}
          style={{
            gridRow: `${it.row} / span ${it.rowSpan ?? 1}`,
            gridColumn: `span ${it.colSpan}`,
            justifyContent: it.start ? "flex-start" : undefined,
            ...it.style,
          }}
        >
          {it.dot && <Dot color={it.dot} />}
          <span>
            {it.label}
            {it.sub && <span className={styles.hcellSub}>{it.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function BandRow({
  cols,
  name,
  children,
}: {
  cols: string;
  name: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.band} style={{ gridTemplateColumns: cols }}>
      <div className={cx(styles.bandCell, styles.bandName, styles.stickyStart)}>{name}</div>
      {children}
    </div>
  );
}

export function BandCellView({
  span,
  dot,
  children,
  start,
}: {
  span: number;
  dot?: string | null;
  children?: ReactNode;
  start?: boolean;
}) {
  return (
    <div
      className={styles.bandCell}
      style={{ gridColumn: `span ${span}`, justifyContent: start ? "flex-start" : "center" }}
    >
      {dot && <Dot color={dot} />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </div>
  );
}

export function NameCell({
  student,
  toggle,
}: {
  student: MatrixStudent;
  toggle?: { expanded: boolean; onToggle: () => void; label: string };
}) {
  return (
    <div className={cx(styles.nameCell, styles.stickyStart)}>
      {toggle && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={toggle.expanded}
          aria-label={toggle.label}
          onClick={toggle.onToggle}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <div className={styles.nameText}>
        <span className={styles.name} title={student.name}>
          {student.name}
        </span>
        <StudentIds student={student} />
      </div>
    </div>
  );
}

// University number and student code are Latin strings: isolate each so
// RTL text around them can't reorder their parts.
export function StudentIds({ student }: { student: MatrixStudent }) {
  return (
    <span className={styles.meta}>
      <bdi dir="ltr">{student.uni}</bdi>
      {student.code && (
        <>
          {" · "}
          <bdi dir="ltr">{student.code}</bdi>
        </>
      )}
    </span>
  );
}

// A day cell. `null` day = the group has no meeting in this column.
export function DayCell({
  day,
  maxTotal,
  id,
  aria,
  hit,
  sub,
  size = "md",
  nav,
  stripe,
}: {
  day: MatrixDay | null;
  maxTotal: number;
  id: string;
  aria: string;
  hit?: boolean;
  sub?: string;
  size?: "sm" | "md" | "lg";
  nav?: { r: number; c: number };
  stripe?: string; // hospital color along the bottom edge (calendar order)
}) {
  const minH = size === "lg" ? 62 : size === "sm" ? 44 : 52;
  if (!day) return <div className={styles.cellEmpty} style={{ minHeight: minH }} aria-hidden />;
  const v = cellVisual(day, maxTotal);
  let fontSize = size === "lg" ? 18 : size === "sm" ? 13.5 : 15;
  // Compact cells have no room for a tag, so states that would otherwise
  // differ only by color say their word in place of the number.
  if (size === "sm" && (day.state === "disputed" || day.state === "awaiting")) {
    v.main = day.state === "disputed" ? "تعارض" : "انتظار";
    fontSize = 10.5;
  }
  const ring = hit ? "inset 0 0 0 3px var(--brand-dark)" : v.border !== "transparent" && !v.dashed ? `inset 0 0 0 1.5px ${v.border}` : undefined;
  const style: CSSProperties = {
    background: v.bg,
    color: v.fg,
    minHeight: minH,
    boxShadow: ring,
    outline: v.dashed && !hit ? `1.5px dashed ${v.border}` : undefined,
    outlineOffset: v.dashed && !hit ? -4 : undefined,
    borderBottom: stripe ? `3px solid ${stripe}` : undefined,
  };
  const showTag = size !== "sm" && v.tag;
  const body = (
    <>
      <span className={styles.cellMain} style={{ fontSize }}>
        {v.main}
      </span>
      {showTag ? (
        <span className={styles.cellTag} style={{ color: v.tagFg }}>
          {v.tag}
        </span>
      ) : sub ? (
        <span className={styles.cellSub}>{sub}</span>
      ) : null}
    </>
  );
  if (!v.interactive) {
    return (
      <div className={cx(styles.cell, styles.cellStatic)} style={style} aria-label={aria} role="img">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={styles.cell}
      style={style}
      data-cell={id}
      data-r={nav?.r}
      data-c={nav?.c}
      aria-label={aria}
      aria-haspopup="dialog"
    >
      {body}
    </button>
  );
}

export function CritCell({
  day,
  ci,
  max,
  id,
  aria,
  hit,
  nav,
  height = 30,
}: {
  day: MatrixDay | null;
  ci: number;
  max: number;
  id: string;
  aria: string;
  hit?: boolean;
  nav?: { r: number; c: number };
  height?: number;
}) {
  if (!day) return <div className={styles.cellEmpty} style={{ minHeight: height }} aria-hidden />;
  const v = criterionVisual(day, ci, max);
  const style: CSSProperties = {
    background: v.bg,
    color: v.fg,
    minHeight: height,
    boxShadow: hit ? "inset 0 0 0 2px var(--brand-dark)" : undefined,
  };
  if (!v.interactive) return <div className={cx(styles.cell, styles.cellStatic)} style={style} aria-hidden />;
  return (
    <button
      type="button"
      className={styles.cell}
      style={style}
      data-cell={id}
      data-r={nav?.r}
      data-c={nav?.c}
      aria-label={aria}
      aria-haspopup="dialog"
    >
      <span style={{ fontWeight: 700, fontSize: 12.5 }}>{v.text}</span>
    </button>
  );
}

export function NumCell({
  text,
  bg,
  weight = 700,
  fg,
  title,
}: {
  text: string;
  bg?: string;
  weight?: number;
  fg?: string;
  title?: string;
}) {
  return (
    <div className={styles.num} style={{ background: bg, fontWeight: weight, color: fg }} title={title}>
      {text}
    </div>
  );
}

export function SparkCell({ days, maxTotal, label }: { days: MatrixDay[]; maxTotal: number; label: string }) {
  const s = sparkline(days, maxTotal, 120, 34);
  return (
    <div className={styles.num}>
      <svg width="120" height="34" viewBox="0 0 120 34" role="img" aria-label={`${label}، آخر قيمة ${fmtScore(s.lastTotal)}`}>
        <line x1="2" y1={s.passY} x2="118" y2={s.passY} stroke="#c7cdc4" strokeWidth="1" strokeDasharray="3 3" />
        {s.points && (
          <polyline
            points={s.points}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {s.last && (
          <circle cx={s.last.x} cy={s.last.y} r="3.5" fill="var(--brand-dark)" stroke="#fff" strokeWidth="1.5" />
        )}
      </svg>
    </div>
  );
}

export function AvgBar({ value, max, span }: { value: number | null; max: number; span: number }) {
  const p = value === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={styles.num}
      style={{ gridColumn: `span ${span}`, justifyContent: "flex-start", gap: 8, padding: "0 10px", fontSize: 12 }}
    >
      <span style={{ whiteSpace: "nowrap" }}>
        المعدل {fmtScore(value)} من {max}
        {value !== null && ` · ${Math.round(p)}٪`}
      </span>
      <div className={styles.bar} style={{ flex: 1, minWidth: 30 }} aria-hidden>
        <div
          className={styles.barFill}
          style={{ width: `${p}%`, background: p < 60 ? "var(--red-700)" : "var(--brand)" }}
        />
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card text-center py-10" role="status">
      <p className="font-bold">{title}</p>
      {children && <div className="text-sm mt-2" style={{ color: "var(--ink-muted)" }}>{children}</div>}
    </div>
  );
}
