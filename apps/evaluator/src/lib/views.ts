// Read-only views built from the bundle (the desktop's schedule and
// validated history) plus what this phone holds (drafts and days validated
// here). Everything works offline. Pure functions: easy to test.
import type { EvaluatorBundle, HistoryRecord } from "@eva/core/sync/contract";
import { addDaysISO } from "@eva/core/date";
import type { StoredResult } from "./store";
import { rowTotal, type Draft, type DraftRow } from "./day";

export type EntryState = "applied" | "sent" | "pending" | "conflict" | "rejected";

/** One validated group-day, from the desktop or still on its way from this phone. */
export interface DayEntry {
  groupId: string;
  dateISO: string;
  hospitalName: string;
  evaluatorName: string;
  mine: boolean;
  state: EntryState;
  records: Map<string, HistoryRecord>; // by studentId
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAY_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const weekdayAr = (dateISO: string) => WEEKDAY_AR[new Date(`${dateISO}T00:00:00Z`).getUTCDay()];

export const ATTENDANCE_AR = { present: "حاضر", late: "متأخر", absent: "غائب" } as const;
export const ATTENDANCE_MARK = { present: "✓", late: "م", absent: "✗" } as const;
export const SHIFT_AR = { MORNING: "صباحي", EVENING: "مسائي" } as const;

/** A draft row in the desktop's shape (section totals, items). */
export function draftRecord(bundle: EvaluatorBundle, studentId: string, r: DraftRow): HistoryRecord {
  const absent = r.attendance === "absent";
  const sections: Record<string, number> = {};
  for (const s of bundle.rubric) {
    const ids = s.items.length ? s.items.map((i) => i.id) : [s.id];
    sections[s.id] = absent ? 0 : Math.min(s.maxScore, Math.round(ids.reduce((a, id) => a + (r.scores[id] ?? 0), 0) * 100) / 100);
  }
  return {
    studentId,
    attendance: r.attendance ?? "present",
    dailyNote: absent ? null : r.dailyNote,
    total: rowTotal(bundle, r),
    sections,
    items: absent ? {} : { ...r.scores },
    ...(r.notes ? { notes: r.notes } : {}),
  };
}

function hospitalOf(bundle: EvaluatorBundle, hospitalId: string | null, groupId: string, dateISO: string) {
  if (hospitalId) return bundle.hospitals.find((h) => h.id === hospitalId)?.name ?? "";
  const stint = bundle.stints.find((s) => s.groupId === groupId && s.startDate <= dateISO && dateISO <= s.endDate);
  return stint?.hospitalName ?? "";
}

/**
 * Every validated day: the desktop's history (authoritative) plus days
 * validated on this phone that the desktop has not applied yet.
 */
export function dayEntries(bundle: EvaluatorBundle, drafts: Draft[], results: StoredResult[]): DayEntry[] {
  const me = bundle.evaluator.id;
  const out: DayEntry[] = (bundle.history ?? []).map((d) => ({
    groupId: d.groupId,
    dateISO: d.dateISO,
    hospitalName: hospitalOf(bundle, d.hospitalId, d.groupId, d.dateISO),
    evaluatorName: d.evaluatorName,
    mine: d.evaluatorId === me,
    state: "applied",
    records: new Map(d.records.map((x) => [x.studentId, x])),
  }));
  const onDesktop = new Set(out.filter((e) => e.mine).map((e) => `${e.groupId}:${e.dateISO}`));
  for (const d of drafts) {
    if (d.status !== "validated" || onDesktop.has(d.key)) continue;
    const res = results.find((x) => x.clientId === d.clientId);
    const state: EntryState = !res ? "pending" : res.status === "sent" ? "sent" : res.outcome === "applied" ? "sent" : res.outcome;
    out.push({
      groupId: d.groupId,
      dateISO: d.dateISO,
      hospitalName: hospitalOf(bundle, null, d.groupId, d.dateISO),
      evaluatorName: bundle.evaluator.name,
      mine: true,
      state,
      records: new Map(Object.entries(d.rows).map(([sid, r]) => [sid, draftRecord(bundle, sid, r)])),
    });
  }
  return out.sort((a, b) => b.dateISO.localeCompare(a.dateISO) || a.groupId.localeCompare(b.groupId));
}

export const STATE_AR: Record<EntryState, string> = {
  applied: "وصل للمدير ✓",
  sent: "أُرسل · بانتظار المدير",
  pending: "بانتظار الإرسال",
  conflict: "تعارض — بانتظار قرار المدير",
  rejected: "رُفض",
};

// ---- the schedule ---------------------------------------------------------

export type DayMark = "done" | "colleague" | "draft" | "missed" | "today" | "future" | "holiday";

export interface ScheduleDay {
  dateISO: string;
  weekday: string;
  mark: DayMark;
  /** A holiday's label, or "تعويض …" on the day a holiday moved to. */
  note?: string;
}

export interface ScheduleStint {
  groupId: string;
  groupName: string;
  shift: "MORNING" | "EVENING" | null;
  hospitalName: string;
  startDate: string;
  endDate: string;
  studentCount: number;
  when: "past" | "current" | "future";
  weeks: ScheduleDay[][];
}

/** Meeting days of a rotation block (its weekdays between start and end). */
export function stintDates(s: { startDate: string; endDate: string; daysOfWeek: string | null }): string[] {
  const days = new Set((s.daysOfWeek ?? "SUN,MON,TUE,WED,THU").split(",").map((d) => d.trim().toUpperCase()));
  const out: string[] = [];
  for (let d = s.startDate; d <= s.endDate; d = addDaysISO(d, 1)) {
    if (days.has(WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()])) out.push(d);
  }
  return out;
}

type Block = EvaluatorBundle["stints"][number];

/** Back-to-back blocks of one group at one hospital (e.g. two one-week blocks) become one. */
export function mergeBlocks(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.groupId.localeCompare(b.groupId) || a.hospitalId.localeCompare(b.hospitalId) || a.startDate.localeCompare(b.startDate));
  const out: Block[] = [];
  for (const b of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.groupId === b.groupId && prev.hospitalId === b.hospitalId && prev.daysOfWeek === b.daysOfWeek && b.startDate <= addDaysISO(prev.endDate, 3)) {
      if (b.endDate > prev.endDate) out[out.length - 1] = { ...prev, endDate: b.endDate };
    } else out.push(b);
  }
  return out;
}

/** The whole course for this evaluator: hospital → group blocks → weeks → days, each day marked. */
export function schedule(bundle: EvaluatorBundle, entries: DayEntry[], drafts: Draft[], today: string) {
  const done = new Map<string, DayEntry>();
  for (const e of entries) {
    const k = `${e.groupId}:${e.dateISO}`;
    if (!done.has(k) || e.mine) done.set(k, e);
  }
  const drafted = new Set(drafts.filter((d) => d.status === "draft").map((d) => d.key));
  const groups = new Map(bundle.groups.map((g) => [g.id, g]));
  const holidays = new Map((bundle.holidays ?? []).map((h) => [h.dateISO, h]));
  const stints: ScheduleStint[] = mergeBlocks(bundle.stints)
    .filter((s) => groups.has(s.groupId))
    .map((s): ScheduleStint => {
      const g = groups.get(s.groupId)!;
      const weeks: ScheduleDay[][] = [];
      const markOf = (d: string): DayMark => {
        const k = `${s.groupId}:${d}`;
        const e = done.get(k);
        return e ? (e.mine ? "done" : "colleague") : drafted.has(k) ? "draft" : d === today ? "today" : d < today ? "missed" : "future";
      };
      for (const d of stintDates(s)) {
        const week = Math.floor((Date.parse(d) - Date.parse(s.startDate)) / (7 * 86400_000));
        const h = holidays.get(d);
        // A holiday stays in its place; its make-up day joins the same week.
        const mark = h && !done.has(`${s.groupId}:${d}`) ? "holiday" : markOf(d);
        (weeks[week] ??= []).push({ dateISO: d, weekday: weekdayAr(d), mark, ...(h ? { note: h.label ?? "عطلة" } : {}) });
        if (h?.movedTo) weeks[week].push({ dateISO: h.movedTo, weekday: weekdayAr(h.movedTo), mark: markOf(h.movedTo), note: `تعويض ${d.slice(8)}/${d.slice(5, 7)}` });
      }
      for (const w of weeks) w?.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      return {
        groupId: s.groupId,
        groupName: g.name,
        shift: g.shift,
        hospitalName: s.hospitalName,
        startDate: s.startDate,
        endDate: s.endDate,
        studentCount: g.students.length,
        when: s.endDate < today ? "past" : s.startDate > today ? "future" : "current",
        weeks: weeks.filter(Boolean),
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.groupName.localeCompare(b.groupName, "ar", { numeric: true }));
  const hospitals = [...new Set(stints.map((s) => s.hospitalName))];
  return hospitals.map((h) => ({ hospitalName: h, stints: stints.filter((s) => s.hospitalName === h) }));
}

// ---- students ---------------------------------------------------------------

export interface StudentSummary {
  id: string;
  name: string;
  universityNumber: string;
  groupId: string;
  groupName: string;
  days: Array<{ dateISO: string; record: HistoryRecord; evaluatorName: string }>;
  present: number;
  late: number;
  absent: number;
  notes: number; // daily notes handed in
  average: number | null; // over days attended
}

export function studentSummaries(bundle: EvaluatorBundle, entries: DayEntry[]): StudentSummary[] {
  return bundle.groups.flatMap((g) =>
    g.students.map((s) => {
      const days = entries
        .filter((e) => e.groupId === g.id && e.records.has(s.id))
        .map((e) => ({ dateISO: e.dateISO, record: e.records.get(s.id)!, evaluatorName: e.evaluatorName }))
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      const attended = days.filter((d) => d.record.attendance !== "absent");
      return {
        id: s.id,
        name: s.name,
        universityNumber: s.universityNumber,
        groupId: g.id,
        groupName: g.name,
        days,
        present: days.filter((d) => d.record.attendance === "present").length,
        late: days.filter((d) => d.record.attendance === "late").length,
        absent: days.filter((d) => d.record.attendance === "absent").length,
        notes: days.filter((d) => d.record.dailyNote === true).length,
        average: attended.length ? Math.round((attended.reduce((a, d) => a + d.record.total, 0) / attended.length) * 100) / 100 : null,
      };
    })
  );
}
