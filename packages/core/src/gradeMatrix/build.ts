// Pure builders for the Grading Center matrix (the website and Eva Desktop). No database and no React:
// the server loader uses the scheduling helpers, the client views use the
// layouts, statistics and filters. Everything here is unit-tested in
// build.test.ts.
import { isDateInScheduledDays } from "../weekdays";
import type { Attendance, DayState, MatrixDay, MatrixGroup, MatrixProgram, MatrixStint } from "./types";

// Evaluators have 7 days (Baghdad time) to save a day before it counts as
// missing — EVALUATOR_APP_PLAN.md rulebook.
export const SUBMIT_WINDOW_DAYS = 7;

// Categorical hues for hospitals, checked for contrast on the app surface
// (#f6f7f4). Color never stands alone: every use sits next to the name.
export const HOSPITAL_PALETTE = ["#3b6fb6", "#b9770e", "#a93e6c", "#5f8a2c", "#7a5cb8", "#c25a2e"];

// A grade below this share of the maximum is flagged as low.
export const LOW_SHARE = 0.6;

const DAY_MS = 86_400_000;

function toUTC(dateISO: string): number {
  return Date.parse(`${dateISO}T00:00:00Z`);
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / DAY_MS);
}

export function addDays(dateISO: string, n: number): string {
  return fromUTC(toUTC(dateISO) + n * DAY_MS);
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

// Every date in [start, end] whose weekday is in the pattern (null/empty
// pattern = every day, matching the rest of the scheduler).
export function meetingDates(startISO: string, endISO: string, days: string | null): string[] {
  const start = toUTC(startISO);
  const end = toUTC(endISO);
  if (isNaN(start) || isNaN(end) || end < start) return [];
  const out: string[] = [];
  // Guard against a pathological range blowing up.
  for (let t = start, i = 0; t <= end && i < 366; t += DAY_MS, i++) {
    const iso = fromUTC(t);
    if (isDateInScheduledDays(iso, days)) out.push(iso);
  }
  return out;
}

// Iraq's working week runs Sunday–Thursday with a Friday/Saturday weekend,
// so weeks are keyed by their Saturday: every meeting day of one working
// week lands on the same key whatever the pattern.
export function weekKey(dateISO: string): string {
  const t = toUTC(dateISO);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday … 6 = Saturday
  return fromUTC(t - ((dow + 1) % 7) * DAY_MS);
}

// One chronological list of meeting dates for a group, from its blocks.
// A date covered by two overlapping blocks keeps the earlier block.
export function groupDates(
  blocks: { hospitalId: string; startDate: string; endDate: string; daysOfWeek: string | null }[],
  fallbackDays: string | null
): { dateISO: string; hospitalId: string }[] {
  const sorted = blocks.slice().sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const seen = new Map<string, string>();
  for (const b of sorted) {
    for (const d of meetingDates(b.startDate, b.endDate, b.daysOfWeek ?? fallbackDays)) {
      if (!seen.has(d)) seen.set(d, b.hospitalId);
    }
  }
  return Array.from(seen.entries())
    .map(([dateISO, hospitalId]) => ({ dateISO, hospitalId }))
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
}

export interface DayStateInput {
  dateISO: string;
  todayISO: string;
  holiday: boolean;
  evaluation: { pendingValidation: boolean; attendance: string } | null;
  attendanceStatus: string | null; // AttendanceRecord, when there's no evaluation
  workDayValidated: boolean;
  disputed: boolean;
  windowDays?: number;
}

export function resolveDayState(i: DayStateInput): DayState {
  const windowDays = i.windowDays ?? SUBMIT_WINDOW_DAYS;
  if (i.evaluation) {
    if (i.evaluation.pendingValidation) return "awaiting";
    if (i.disputed) return "disputed";
    if (i.evaluation.attendance === "absent") return "absent";
    if (i.evaluation.attendance === "late") return "late";
    return "ok";
  }
  // Absent students get an attendance mark but no evaluation row.
  if (i.attendanceStatus === "absent") return i.workDayValidated ? "absent" : "awaiting";
  if (i.attendanceStatus) return "awaiting";
  if (i.holiday) return "holiday";
  if (i.dateISO > i.todayISO) return "future";
  return daysBetween(i.dateISO, i.todayISO) > windowDays ? "missing" : "pending";
}

export function asAttendance(v: string | null | undefined): Attendance | null {
  return v === "present" || v === "late" || v === "absent" ? v : null;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// Days that count toward averages: validated, graded, and not disputed
// (a disputed day counts once the admin has picked one evaluation).
export function counts(day: MatrixDay): boolean {
  return day.total !== null && (day.state === "ok" || day.state === "late" || day.state === "absent");
}

export interface StudentStats {
  avg: number | null;
  pct: number | null;
  absences: number;
  graded: number; // days with a validated outcome (grade or absence)
  due: number; // scheduled days that have already happened
  scheduled: number; // all non-holiday days
  hospAvg: Record<string, number | null>;
  critAvg: (number | null)[];
}

export function studentStats(days: MatrixDay[], criteriaCount: number, maxTotal: number): StudentStats {
  const counted = days.filter(counts);
  const avg = mean(counted.map((d) => d.total as number));
  const hospitals = Array.from(new Set(days.map((d) => d.hospitalId)));
  const hospAvg: Record<string, number | null> = {};
  for (const h of hospitals) hospAvg[h] = mean(counted.filter((d) => d.hospitalId === h).map((d) => d.total as number));
  const critAvg: (number | null)[] = [];
  for (let ci = 0; ci < criteriaCount; ci++) {
    critAvg.push(
      mean(counted.map((d) => d.scores?.[ci]).filter((v): v is number => typeof v === "number"))
    );
  }
  return {
    avg,
    pct: avg === null || maxTotal <= 0 ? null : (avg / maxTotal) * 100,
    absences: days.filter((d) => d.state === "absent").length,
    graded: days.filter((d) => d.state === "ok" || d.state === "late" || d.state === "absent" || d.state === "disputed")
      .length,
    due: days.filter((d) => d.state !== "holiday" && d.state !== "future").length,
    scheduled: days.filter((d) => d.state !== "holiday").length,
    hospAvg,
    critAvg,
  };
}

export function averageOf(days: MatrixDay[]): number | null {
  return mean(days.filter(counts).map((d) => d.total as number));
}

// ---------------------------------------------------------------------------
// Filters and search
// ---------------------------------------------------------------------------

export type FilterId = "all" | "attention" | "disputed" | "missing" | "pending" | "awaiting" | "absent" | "low" | "late";

export const FILTERS: { id: FilterId; label: string; tone: "ink" | "brand" | "red" | "amber" | "muted" }[] = [
  { id: "all", label: "الكل", tone: "ink" },
  { id: "attention", label: "يحتاج انتباه", tone: "brand" },
  { id: "disputed", label: "تعارض", tone: "amber" },
  { id: "missing", label: "ناقص", tone: "red" },
  { id: "absent", label: "غياب", tone: "red" },
  { id: "low", label: "دون 60٪", tone: "red" },
  { id: "late", label: "تأخر", tone: "amber" },
  { id: "awaiting", label: "بانتظار الاعتماد", tone: "muted" },
  { id: "pending", label: "ضمن المهلة", tone: "muted" },
];

export function isLow(day: MatrixDay, maxTotal: number): boolean {
  return (
    day.total !== null && (day.state === "ok" || day.state === "late") && maxTotal > 0 && day.total / maxTotal < LOW_SHARE
  );
}

// Whether a day is one the active filter points at ("all" points at none).
export function dayMatches(filter: FilterId, day: MatrixDay, maxTotal: number): boolean {
  switch (filter) {
    case "all":
      return false;
    case "attention":
      return day.state === "disputed" || day.state === "missing" || day.state === "absent" || isLow(day, maxTotal);
    case "low":
      return isLow(day, maxTotal);
    default:
      return day.state === filter;
  }
}

// Arabic-insensitive matching: hamza/alef forms, taa marbuta, alef maqsura,
// diacritics, tatweel and Arabic-Indic digits all fold together.
export function normalizeArabic(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function matchesSearch(q: string, fields: (string | null)[]): boolean {
  const n = normalizeArabic(q);
  if (!n) return true;
  return fields.some((f) => f !== null && normalizeArabic(f).includes(n));
}

// ---------------------------------------------------------------------------
// Dates and labels
// ---------------------------------------------------------------------------

const WEEKDAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function weekdayAr(dateISO: string): string {
  return WEEKDAY_AR[new Date(toUTC(dateISO)).getUTCDay()];
}

export function dayMonth(dateISO: string): string {
  const [, m, d] = dateISO.split("-");
  return `${Number(d)}/${Number(m)}`;
}

export function fullDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${weekdayAr(dateISO)} ${Number(d)}/${Number(m)}/${y}`;
}

export function rangeLabel(from: string, to: string): string {
  return from === to ? dayMonth(from) : `${dayMonth(from)} – ${dayMonth(to)}`;
}

export function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return String(Math.round(n * 10) / 10);
}

export function fmtPct(p: number | null | undefined): string {
  return p === null || p === undefined || isNaN(p) ? "—" : `${Math.round(p)}٪`;
}

// The teal sequential ramp for scores, lightest = lowest. Below 60% the
// cell stays near-white and the text turns red (never color alone).
export function heatBg(pct: number | null): string {
  if (pct === null) return "var(--surface-raised)";
  if (pct >= 90) return "#9ccbc3";
  if (pct >= 80) return "#bfdcd6";
  if (pct >= 70) return "#dcece9";
  if (pct >= 60) return "#eef5f3";
  return "#f7f8f6";
}

export const HEAT_STEPS: { label: string; bg: string }[] = [
  { label: "دون 60٪", bg: "#f7f8f6" },
  { label: "60–69٪", bg: "#eef5f3" },
  { label: "70–79٪", bg: "#dcece9" },
  { label: "80–89٪", bg: "#bfdcd6" },
  { label: "90٪ فأكثر", bg: "#9ccbc3" },
];

// ---------------------------------------------------------------------------
// Sparkline (right-to-left: the first day sits on the right)
// ---------------------------------------------------------------------------

export interface Spark {
  points: string;
  last: { x: number; y: number } | null;
  passY: number;
  lastTotal: number | null;
}

export function sparkline(days: MatrixDay[], maxTotal: number, width = 120, height = 34, pad = 4): Spark {
  const n = days.length;
  const step = n > 1 ? (width - 2 * pad) / (n - 1) : 0;
  const yOf = (v: number) => height - pad - (maxTotal > 0 ? v / maxTotal : 0) * (height - 2 * pad);
  const pts: string[] = [];
  let last: { x: number; y: number } | null = null;
  let lastTotal: number | null = null;
  days.forEach((d, i) => {
    if (!counts(d)) return;
    const x = n > 1 ? width - pad - i * step : width / 2;
    const y = yOf(d.total as number);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    last = { x, y };
    lastTotal = d.total;
  });
  return { points: pts.join(" "), last, passY: yOf(maxTotal * LOW_SHARE), lastTotal };
}

// ---------------------------------------------------------------------------
// Column layouts
// ---------------------------------------------------------------------------

export interface DayColumn {
  kind: "day";
  key: string;
  hospitalId: string | null; // rotation layout: the hospital the column belongs to
  week: number; // 0-based: hospital week (rotation) or course week (date)
  day: number; // 0-based day within that week
  dateISO: string | null; // set when every group meeting in this slot meets on the same date
}

export interface AvgColumn {
  kind: "hospAvg";
  key: string;
  hospitalId: string;
}

export type LayoutColumn = DayColumn | AvgColumn;

export interface HeadCell {
  label: string;
  span: number;
  hospitalId?: string | null;
  sub?: string;
  holiday?: boolean;
  avg?: boolean;
}

export interface BandCell {
  span: number;
  hospitalId: string | null;
  from: string | null;
  to: string | null;
  order: number | null; // rotation number of this hospital for the group
}

export interface Layout {
  columns: LayoutColumn[];
  heads: HeadCell[][];
  // groupId → per column, the index into group.dates (null = no meeting).
  slots: Record<string, (number | null)[]>;
  bands: Record<string, BandCell[]>;
}

// Hospitals of a program, in the order its groups first reach them.
export function programHospitals(program: MatrixProgram, globalOrder: string[]): string[] {
  const used = new Set<string>();
  for (const g of program.groups) for (const d of g.dates) used.add(d.hospitalId);
  return globalOrder.filter((h) => used.has(h));
}

// Rotation number (1-based) of each hospital in a group's own sequence.
export function rotationOrder(group: MatrixGroup): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of group.dates) if (!out.has(d.hospitalId)) out.set(d.hospitalId, out.size + 1);
  return out;
}

function weeksOf(indices: number[], group: MatrixGroup): number[][] {
  const weeks: number[][] = [];
  let current = "";
  for (const i of indices) {
    const k = weekKey(group.dates[i].dateISO);
    if (k !== current) {
      weeks.push([]);
      current = k;
    }
    weeks[weeks.length - 1].push(i);
  }
  return weeks;
}

// Hospital → week in that hospital → day. Each group's dates land in the
// slots of the hospital it was at; a hospital gets as many weeks (and each
// week as many days) as the longest stay any group had there.
export function rotationLayout(
  program: MatrixProgram,
  hospitalOrder: string[],
  opts: { avgColumns: boolean; avgLabel?: string; avgSub?: string }
): Layout {
  const hospitals = programHospitals(program, hospitalOrder);
  const perGroup = new Map<string, Map<string, number[][]>>();
  const maxDays = new Map<string, number[]>();
  for (const g of program.groups) {
    const byHospital = new Map<string, number[]>();
    g.dates.forEach((d, i) => {
      if (!byHospital.has(d.hospitalId)) byHospital.set(d.hospitalId, []);
      byHospital.get(d.hospitalId)!.push(i);
    });
    const weeksByHospital = new Map<string, number[][]>();
    for (const [h, idx] of byHospital) {
      const weeks = weeksOf(idx, g);
      weeksByHospital.set(h, weeks);
      const m = maxDays.get(h) ?? [];
      weeks.forEach((w, wi) => (m[wi] = Math.max(m[wi] ?? 0, w.length)));
      maxDays.set(h, m);
    }
    perGroup.set(g.id, weeksByHospital);
  }

  const columns: LayoutColumn[] = [];
  const row0: HeadCell[] = [];
  const row1: HeadCell[] = [];
  const row2: HeadCell[] = [];
  const spanOf = new Map<string, number>();
  for (const h of hospitals) {
    const weeks = maxDays.get(h) ?? [];
    let span = 0;
    weeks.forEach((n, wi) => {
      row1.push({ label: `الأسبوع ${wi + 1}`, span: n, hospitalId: h });
      for (let di = 0; di < n; di++) {
        columns.push({ kind: "day", key: `${h}:${wi}:${di}`, hospitalId: h, week: wi, day: di, dateISO: null });
        row2.push({ label: `اليوم ${di + 1}`, span: 1, hospitalId: h });
        span++;
      }
    });
    if (opts.avgColumns) {
      columns.push({ kind: "hospAvg", key: `${h}:avg`, hospitalId: h });
      row1.push({ label: opts.avgLabel ?? "المعدل", span: 1, hospitalId: h, avg: true });
      row2.push({ label: opts.avgSub ?? "", span: 1, hospitalId: h, avg: true });
      span++;
    }
    row0.push({ label: "", span, hospitalId: h });
    spanOf.set(h, span);
  }

  const slots: Record<string, (number | null)[]> = {};
  const bands: Record<string, BandCell[]> = {};
  for (const g of program.groups) {
    const weeksByHospital = perGroup.get(g.id)!;
    slots[g.id] = columns.map((c) =>
      c.kind === "day" ? weeksByHospital.get(c.hospitalId!)?.[c.week]?.[c.day] ?? null : null
    );
    const order = rotationOrder(g);
    bands[g.id] = hospitals.map((h) => {
      const weeks = weeksByHospital.get(h);
      const flat = weeks ? weeks.flat() : [];
      return {
        span: spanOf.get(h)!,
        hospitalId: h,
        from: flat.length ? g.dates[flat[0]].dateISO : null,
        to: flat.length ? g.dates[flat[flat.length - 1]].dateISO : null,
        order: order.get(h) ?? null,
      };
    });
  }
  return { columns, heads: [row0, row1, row2], slots, bands };
}

// Course week → day, in calendar order. `range` limits the columns to one
// period; week numbers stay the course's own.
export function dateLayout(
  program: MatrixProgram,
  holidays: Record<string, string>,
  range?: { start: string; end: string }
): Layout {
  const inRange = (d: string) => !range || (d >= range.start && d <= range.end);
  const allWeeks = Array.from(new Set(program.groups.flatMap((g) => g.dates.map((d) => weekKey(d.dateISO))))).sort();
  const weekNo = new Map(allWeeks.map((k, i) => [k, i]));

  const perGroup = new Map<string, Map<string, number[]>>();
  const maxDays = new Map<string, number>();
  for (const g of program.groups) {
    const byWeek = new Map<string, number[]>();
    g.dates.forEach((d, i) => {
      if (!inRange(d.dateISO)) return;
      const k = weekKey(d.dateISO);
      if (!byWeek.has(k)) byWeek.set(k, []);
      byWeek.get(k)!.push(i);
    });
    for (const [k, idx] of byWeek) maxDays.set(k, Math.max(maxDays.get(k) ?? 0, idx.length));
    perGroup.set(g.id, byWeek);
  }
  const weeks = Array.from(maxDays.keys()).sort();

  const columns: LayoutColumn[] = [];
  const row0: HeadCell[] = [];
  const row1: HeadCell[] = [];
  for (const k of weeks) {
    const n = maxDays.get(k)!;
    const w = weekNo.get(k)!;
    const datesInWeek: string[] = [];
    for (let di = 0; di < n; di++) {
      const dates = new Set<string>();
      for (const g of program.groups) {
        const i = perGroup.get(g.id)!.get(k)?.[di];
        if (i !== undefined) dates.add(g.dates[i].dateISO);
      }
      const shared = dates.size === 1 ? Array.from(dates)[0] : null;
      columns.push({ kind: "day", key: `${k}:${di}`, hospitalId: null, week: w, day: di, dateISO: shared });
      row1.push({
        label: shared ? `${weekdayAr(shared)} ${dayMonth(shared)}` : `اليوم ${di + 1}`,
        span: 1,
        holiday: shared ? shared in holidays : false,
      });
      dates.forEach((d) => datesInWeek.push(d));
    }
    datesInWeek.sort();
    row0.push({
      label: `الأسبوع ${w + 1}`,
      span: n,
      sub: datesInWeek.length ? rangeLabel(datesInWeek[0], datesInWeek[datesInWeek.length - 1]) : undefined,
    });
  }

  const slots: Record<string, (number | null)[]> = {};
  const bands: Record<string, BandCell[]> = {};
  for (const g of program.groups) {
    const byWeek = perGroup.get(g.id)!;
    const s = columns.map((c) => (c.kind === "day" ? byWeek.get(allWeeks[c.week])?.[c.day] ?? null : null));
    slots[g.id] = s;
    bands[g.id] = hospitalRuns(g, s);
  }
  return { columns, heads: [row0, row1], slots, bands };
}

// Consecutive columns where a group stays at one hospital become one band
// segment; columns with no meeting join the run they sit in.
export function hospitalRuns(group: MatrixGroup, slots: (number | null)[]): BandCell[] {
  const order = rotationOrder(group);
  const runs: BandCell[] = [];
  for (const idx of slots) {
    const h = idx === null ? null : group.dates[idx].hospitalId;
    const date = idx === null ? null : group.dates[idx].dateISO;
    const last = runs[runs.length - 1];
    if (last && (h === null || last.hospitalId === h || last.hospitalId === null)) {
      last.span++;
      if (h !== null) {
        if (last.hospitalId === null) last.order = order.get(h) ?? null;
        last.hospitalId = h;
        last.from = last.from ?? date;
        last.to = date;
      }
    } else {
      runs.push({ span: 1, hospitalId: h, from: date, to: date, order: h === null ? null : order.get(h) ?? null });
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export interface Period {
  index: number;
  start: string;
  end: string;
}

// The course's rotation periods: when every group's blocks share the same
// non-overlapping date ranges (the usual "everyone moves hospital at once"
// schedule), each range is a period. Anything irregular → no period tabs.
export function derivePeriods(groups: { stints: MatrixStint[] }[]): Period[] {
  const unique = new Map<string, { start: string; end: string }>();
  for (const g of groups) for (const s of g.stints) unique.set(`${s.start}|${s.end}`, { start: s.start, end: s.end });
  const ranges = Array.from(unique.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
  if (ranges.length < 2 || ranges.length > 8) return [];
  for (let i = 1; i < ranges.length; i++) if (ranges[i].start <= ranges[i - 1].end) return [];
  return ranges.map((r, index) => ({ index, ...r }));
}

// Where a meeting day sits: week of the course, week at the hospital, and
// day of that week.
export function dayPosition(
  program: MatrixProgram,
  group: MatrixGroup,
  dateIndex: number
): { courseWeek: number; hospitalWeek: number; dayInWeek: number } {
  const target = group.dates[dateIndex];
  const allWeeks = Array.from(new Set(program.groups.flatMap((g) => g.dates.map((d) => weekKey(d.dateISO))))).sort();
  const wk = weekKey(target.dateISO);
  const atHospital = group.dates.filter((d) => d.hospitalId === target.hospitalId);
  const hospWeeks = Array.from(new Set(atHospital.map((d) => weekKey(d.dateISO)))).sort();
  const sameWeek = group.dates.filter((d) => weekKey(d.dateISO) === wk);
  return {
    courseWeek: allWeeks.indexOf(wk) + 1,
    hospitalWeek: hospWeeks.indexOf(wk) + 1,
    dayInWeek: sameWeek.findIndex((d) => d.dateISO === target.dateISO) + 1,
  };
}

// ---------------------------------------------------------------------------
// Day board: one attendance day across every hospital
// ---------------------------------------------------------------------------

export interface BoardGroup {
  groupIndex: number; // index into program.groups
  dateIndex: number; // index into group.dates (and each student's days)
  dateISO: string;
}

export interface BoardPanel {
  hospitalId: string;
  groups: BoardGroup[]; // usually one; empty when no group is there that day
}

// Which group is at which hospital in one column of a date layout. Every
// hospital of the program gets a panel, in hospital order, so the board
// keeps the same shape from day to day.
export function dayBoard(
  program: MatrixProgram,
  layout: Layout,
  column: number,
  hospitalOrder: string[]
): BoardPanel[] {
  const panels = programHospitals(program, hospitalOrder).map((h) => ({ hospitalId: h, groups: [] as BoardGroup[] }));
  const byId = new Map(panels.map((p) => [p.hospitalId, p]));
  program.groups.forEach((g, groupIndex) => {
    const dateIndex = layout.slots[g.id]?.[column];
    if (dateIndex === null || dateIndex === undefined) return;
    const d = g.dates[dateIndex];
    byId.get(d.hospitalId)?.groups.push({ groupIndex, dateIndex, dateISO: d.dateISO });
  });
  return panels;
}

// The column a day board opens on: the latest day that has started by
// today, else the first one.
export function currentColumn(program: MatrixProgram, layout: Layout, todayISO: string): number {
  let best = 0;
  layout.columns.forEach((_, c) => {
    const first = program.groups
      .flatMap((g) => {
        const i = layout.slots[g.id]?.[c];
        return i === null || i === undefined ? [] : [g.dates[i].dateISO];
      })
      .sort()[0];
    if (first && first <= todayISO) best = c;
  });
  return best;
}

// The day as it shows when the grid displays one criterion instead of the
// day's total: that criterion's score stands in for the total. Days with
// no validated grade are returned unchanged.
export function criterionDay(day: MatrixDay, ci: number): MatrixDay {
  if (day.total === null) return day;
  const v = day.scores?.[ci];
  return { ...day, total: typeof v === "number" ? v : null };
}

export type StudentSort = "list" | "weakest" | "absences";

// Order rows by the course average (weakest first, ungraded last) or by
// absences (most first). "list" keeps the order they came in.
export function sortByStats<T>(rows: T[], stat: (row: T) => StudentStats, by: StudentSort): T[] {
  if (by === "list") return rows;
  const out = rows.slice();
  if (by === "weakest") out.sort((a, b) => (stat(a).avg ?? Infinity) - (stat(b).avg ?? Infinity));
  else out.sort((a, b) => stat(b).absences - stat(a).absences);
  return out;
}
