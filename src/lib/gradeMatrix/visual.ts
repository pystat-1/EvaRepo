// How a day looks in the grid: label, short state tag and colors. Every
// state carries text (a tag or the cell's own label), so color is never
// the only signal.
import { fmtScore, heatBg, isLow } from "./build";
import type { DayState, MatrixDay } from "./types";

export interface CellVisual {
  main: string;
  tag: string; // short state word, "" when the number says it all
  bg: string;
  fg: string;
  tagFg: string;
  border: string; // "transparent" = none
  dashed: boolean;
  interactive: boolean; // future days have nothing to open
}

const RED = "var(--red-700)";
const AMBER = "var(--amber-700)";
const MUTED = "var(--ink-muted)";

export const STATE_LABEL: Record<DayState, string> = {
  ok: "محفوظ ومعتمد",
  late: "محفوظ ومعتمد · حضر متأخرًا",
  absent: "غائب",
  disputed: "تعارض بين مقيّمَين · بانتظار قرار الإدارة",
  awaiting: "حفظه المقيّم ولم يعتمده بعد",
  pending: "لم يُسجَّل بعد · ضمن مهلة الأيام السبعة",
  missing: "ناقص · انتهت مهلة الأيام السبعة",
  future: "لم يحن موعده",
  holiday: "عطلة رسمية",
};

export function cellVisual(day: MatrixDay, maxTotal: number): CellVisual {
  const base: CellVisual = {
    main: "",
    tag: "",
    bg: "var(--surface-raised)",
    fg: "var(--ink)",
    tagFg: MUTED,
    border: "transparent",
    dashed: false,
    interactive: true,
  };
  switch (day.state) {
    case "holiday":
      return { ...base, main: "عطلة", bg: "#eceee9", fg: MUTED };
    case "future":
      return { ...base, bg: "#fbfbf9", fg: MUTED, interactive: false };
    case "pending":
      return { ...base, main: "…", tag: "ضمن المهلة", fg: MUTED, border: "var(--border-strong)", dashed: true };
    case "missing":
      return { ...base, main: "—", tag: "ناقص", fg: RED, tagFg: RED, border: RED };
    case "awaiting":
      return { ...base, main: "…", tag: "غير معتمد", fg: AMBER, tagFg: AMBER, border: AMBER, dashed: true };
    case "absent":
      return { ...base, main: "غ", tag: "غائب", bg: "var(--red-100)", fg: RED, tagFg: RED, border: "#e3b9b4" };
  }
  const total = day.total ?? 0;
  const pct = maxTotal > 0 ? (total / maxTotal) * 100 : null;
  const low = isLow(day, maxTotal);
  const v: CellVisual = { ...base, main: fmtScore(total), bg: heatBg(pct), fg: low ? RED : "var(--ink)" };
  if (low) {
    v.tag = "دون 60٪";
    v.tagFg = RED;
  }
  if (day.state === "late") {
    v.tag = "متأخر";
    v.tagFg = AMBER;
  }
  if (day.state === "disputed") {
    v.tag = "تعارض";
    v.tagFg = AMBER;
    v.bg = "var(--amber-100)";
    v.border = "#d9b46a";
  }
  return v;
}

// One criterion's score on a day, for the criteria rows and columns.
export function criterionVisual(
  day: MatrixDay,
  ci: number,
  max: number
): { text: string; bg: string; fg: string; interactive: boolean } {
  switch (day.state) {
    case "holiday":
      return { text: "", bg: "#eceee9", fg: MUTED, interactive: true };
    case "future":
      return { text: "", bg: "#fbfbf9", fg: MUTED, interactive: false };
    case "pending":
    case "awaiting":
      return { text: "…", bg: "var(--surface-raised)", fg: MUTED, interactive: true };
    case "missing":
      return { text: "—", bg: "var(--surface-raised)", fg: RED, interactive: true };
  }
  const val = day.scores?.[ci] ?? null;
  if (day.state === "absent" && val === null) return { text: "غ", bg: "var(--red-100)", fg: RED, interactive: true };
  const pct = val === null || max <= 0 ? null : (val / max) * 100;
  return {
    text: fmtScore(val),
    bg: day.state === "absent" ? "var(--red-100)" : day.state === "disputed" ? "var(--amber-100)" : heatBg(pct),
    fg: pct !== null && pct < 60 ? RED : "var(--ink)",
    interactive: true,
  };
}
