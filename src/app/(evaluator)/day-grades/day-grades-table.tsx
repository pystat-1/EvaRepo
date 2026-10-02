"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  markAttendanceAction,
  saveGradeRowAction,
  setDailyNoteAction,
  validateDayAction,
} from "@/lib/actions/attendance";
import type { DayGradeRow } from "@/lib/models/attendance";
import type { RubricSection } from "@/lib/models/rubric";
import type { Attendance } from "@/lib/models/evaluations";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

interface RowState {
  attendance: Attendance | null;
  dailyNote: boolean | null;
  values: Record<string, string>; // itemId or sectionId (no items) -> typed text
  total: number | null;
  evaluated: boolean;
  save: SaveState;
  error?: string;
}

// One column per item; a section without items is one column of its own.
interface Column {
  id: string;
  kind: "check" | "number";
  max: number;
  label: string;
  sectionLabel: string;
  sectionIndex: number;
  isItem: boolean;
  first: boolean; // first column of its section (draws the section divider)
}

const SECTION_COLORS = ["#0e5c6b", "#1f6b4f", "#6b4a9c", "#8a5c10", "#9c2f2f", "#3d5654"];
const SAVE_DELAY_MS = 700;

function buildColumns(sections: RubricSection[]): Column[] {
  const cols: Column[] = [];
  sections.forEach((s, si) => {
    if (s.items.length === 0) {
      cols.push({ id: s.id, kind: "number", max: s.maxScore, label: s.labelAr, sectionLabel: s.labelAr, sectionIndex: si, isItem: false, first: true });
      return;
    }
    s.items.forEach((item, ii) =>
      cols.push({
        id: item.id,
        kind: item.kind,
        max: item.maxScore,
        label: item.labelAr,
        sectionLabel: s.labelAr,
        sectionIndex: si,
        isItem: true,
        first: ii === 0,
      })
    );
  });
  return cols;
}

function toNumber(raw: string | undefined, max: number): number {
  const n = Number(raw);
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 100) / 100, max);
}

function initialRow(row: DayGradeRow, columns: Column[]): RowState {
  const values: Record<string, string> = {};
  for (const c of columns) {
    const v = c.isItem ? row.itemScores[c.id] : row.scores[c.id];
    values[c.id] = v === undefined ? (c.kind === "check" ? "0" : "") : String(v);
  }
  return {
    attendance: row.attendance,
    dailyNote: row.dailyNote,
    values,
    total: row.total,
    evaluated: row.evaluated,
    save: "idle",
  };
}

export function DayGradesTable({
  groupId,
  dateISO,
  isToday,
  validated,
  sections,
  maxTotal,
  rows,
}: {
  groupId: string;
  dateISO: string;
  isToday: boolean;
  validated: boolean;
  sections: RubricSection[];
  maxTotal: number;
  rows: DayGradeRow[];
}) {
  const router = useRouter();
  const columns = buildColumns(sections);
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, initialRow(r, columns)]))
  );
  // Latest rows for the save timers and validation, which run outside render.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const [banner, setBanner] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [validating, startValidate] = useTransition();
  const readOnly = validated;
  const dateArg = isToday ? undefined : dateISO;

  const patch = (id: string, p: Partial<RowState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  // Warn before leaving with a change not saved yet.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const busy = Object.values(stateRef.current).some((r) => r.save === "pending" || r.save === "saving");
      if (busy) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  function saveScoresNow(id: string): Promise<void> {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    const row = stateRef.current[id];
    const attendance: Attendance = row.attendance ?? "present"; // grading someone means they're here
    const scores: Record<string, number> = {};
    const itemScores: Record<string, number> = {};
    for (const c of columns) {
      const v = toNumber(row.values[c.id], c.max);
      if (c.isItem) itemScores[c.id] = v;
      else scores[c.id] = v;
    }
    patch(id, { save: "saving", attendance });
    const p = (async () => {
      const res = await saveGradeRowAction({
        studentId: id,
        dateISO: dateArg,
        attendance,
        dailyNote: row.dailyNote,
        scores,
        itemScores,
      });
      // A newer edit may have been queued while this one was in flight.
      if (timers.current.has(id)) return;
      if (res.error) patch(id, { save: "error", error: res.error });
      else patch(id, { save: "saved", error: undefined, total: res.total ?? null, evaluated: true });
    })();
    inflight.current.set(id, p);
    p.finally(() => inflight.current.get(id) === p && inflight.current.delete(id));
    return p;
  }

  function scheduleSave(id: string) {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        void saveScoresNow(id);
      }, SAVE_DELAY_MS)
    );
    patch(id, { save: "pending" });
  }

  function setValue(id: string, colId: string, v: string) {
    if (readOnly) return;
    setState((s) => ({ ...s, [id]: { ...s[id], values: { ...s[id].values, [colId]: v } } }));
    scheduleSave(id);
  }

  async function setAttendance(id: string, value: string) {
    if (readOnly || !value) return;
    const status = value as Attendance;
    const before = stateRef.current[id];
    patch(id, { attendance: status, save: "saving", dailyNote: status === "absent" ? null : before.dailyNote });
    const res = await markAttendanceAction(id, status, dateArg);
    if (res.error) {
      patch(id, { attendance: before.attendance, dailyNote: before.dailyNote, save: "error", error: res.error });
      return;
    }
    if (status === "absent") {
      const zero = Object.fromEntries(columns.map((c) => [c.id, c.kind === "check" ? "0" : ""]));
      patch(id, { save: "saved", values: zero, total: 0, evaluated: true, error: undefined });
    } else if (before.attendance === "absent") {
      // Undoing an absence removes its zero grade; the row is ungraded again.
      patch(id, { save: "saved", total: null, evaluated: false, error: undefined });
    } else {
      patch(id, { save: "saved", error: undefined });
    }
  }

  async function setDailyNote(id: string, value: string) {
    if (readOnly) return;
    const next = value === "1" ? true : value === "0" ? false : null;
    const before = stateRef.current[id];
    patch(id, { dailyNote: next, attendance: before.attendance ?? "present", save: "saving" });
    const res = await setDailyNoteAction(id, next, dateArg);
    if (res.error) patch(id, { dailyNote: before.dailyNote, attendance: before.attendance, save: "error", error: res.error });
    else patch(id, { save: "saved", error: undefined });
  }

  async function flushAll() {
    for (const id of Array.from(timers.current.keys())) void saveScoresNow(id);
    await Promise.all(Array.from(inflight.current.values()));
  }

  function validate() {
    startValidate(async () => {
      setBanner(null);
      await flushAll();
      const failed = Object.values(stateRef.current).some((r) => r.save === "error");
      if (failed) {
        setConfirming(false);
        setBanner({ kind: "error", text: "بعض الصفوف لم تُحفظ (مؤشر ⚠) — صحّحها قبل الاعتماد." });
        return;
      }
      const res = await validateDayAction(groupId, dateISO);
      setConfirming(false);
      if (res.ok) {
        setBanner({ kind: "info", text: `تم اعتماد ${res.count} تقييم وإرسالها للإدارة.` });
        router.refresh();
        return;
      }
      const parts: string[] = [];
      if (res.error) parts.push(res.error);
      if (res.missingAttendance?.length) parts.push(`بلا حضور مسجّل: ${res.missingAttendance.join("، ")}`);
      if (res.missingGrades?.length) parts.push(`بلا درجات: ${res.missingGrades.join("، ")}`);
      setBanner({ kind: "error", text: `لا يمكن الاعتماد بعد — ${parts.join(" · ")}` });
    });
  }

  const list = Object.values(state);
  const marked = list.filter((r) => r.attendance !== null).length;
  const absent = list.filter((r) => r.attendance === "absent").length;
  const graded = list.filter((r) => r.evaluated && r.attendance !== "absent").length;
  const busy = list.some((r) => r.save === "pending" || r.save === "saving");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--ink-muted)" }}>
        <span>
          الحضور مسجّل: <b className="tabular-nums" style={{ color: "var(--ink)" }}>{marked}/{rows.length}</b>
        </span>
        <span>
          مُقيَّم: <b className="tabular-nums" style={{ color: "var(--ink)" }}>{graded}/{rows.length - absent}</b>
        </span>
        <span aria-live="polite">
          {readOnly ? "معتمد — للعرض فقط" : busy ? "جارٍ الحفظ…" : "كل التغييرات محفوظة تلقائيًا"}
        </span>
      </div>

      <div className="grade-grid" role="region" aria-label="جدول درجات اليوم" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th className="sticky-name" scope="col">
                الطالب
              </th>
              <th scope="col">الحضور</th>
              <th scope="col">الديلي نوت</th>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={c.first ? "section-start" : undefined}
                  style={{ borderTopColor: SECTION_COLORS[c.sectionIndex % SECTION_COLORS.length] }}
                  title={`${c.sectionLabel} — ${c.label} (من ${c.max})`}
                >
                  <span className="grid-section" style={{ color: SECTION_COLORS[c.sectionIndex % SECTION_COLORS.length] }}>
                    {c.sectionLabel}
                  </span>
                  <span className="grid-item">
                    {c.isItem ? c.label : "الدرجة"} <span className="grid-max">/{c.max}</span>
                  </span>
                </th>
              ))}
              <th scope="col">
                المجموع <span className="grid-max">/{maxTotal}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const r = state[row.id];
              const isAbsent = r.attendance === "absent";
              const locked = readOnly || row.locked;
              const live = isAbsent
                ? 0
                : columns.reduce((t, c) => t + toNumber(r.values[c.id], c.max), 0);
              return (
                <tr key={row.id} className={isAbsent ? "absent" : undefined}>
                  <th scope="row" className="sticky-name">
                    <Link href={`/grade/${row.id}`} className="grid-name" title={`${row.nameAr} — ${row.universityNumber}`}>
                      <span className="grid-index">{i + 1}</span>
                      <span className="grid-name-text">{row.nameAr}</span>
                    </Link>
                  </th>
                  <td>
                    <select
                      aria-label={`حضور ${row.nameAr}`}
                      className="grid-select"
                      value={r.attendance ?? ""}
                      disabled={locked}
                      onChange={(e) => setAttendance(row.id, e.target.value)}
                    >
                      <option value="" disabled>
                        —
                      </option>
                      <option value="present">✓ حاضر</option>
                      <option value="late">م متأخر</option>
                      <option value="absent">✗ غائب</option>
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`الديلي نوت ${row.nameAr}`}
                      className="grid-select"
                      value={r.dailyNote === true ? "1" : r.dailyNote === false ? "0" : ""}
                      disabled={locked || isAbsent}
                      onChange={(e) => setDailyNote(row.id, e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="1">سلّم</option>
                      <option value="0">لم يسلّم</option>
                    </select>
                  </td>
                  {columns.map((c) => (
                    <td key={c.id} className={c.first ? "section-start" : undefined}>
                      {c.kind === "check" ? (
                        <input
                          type="checkbox"
                          aria-label={`${c.label} — ${row.nameAr}`}
                          className="grid-check"
                          checked={!isAbsent && Number(r.values[c.id]) === c.max}
                          disabled={locked || isAbsent}
                          onChange={(e) => setValue(row.id, c.id, e.target.checked ? String(c.max) : "0")}
                        />
                      ) : (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={c.max}
                          step="0.01"
                          aria-label={`${c.label} — ${row.nameAr}`}
                          className="grid-number"
                          value={isAbsent ? "" : r.values[c.id]}
                          placeholder="0"
                          disabled={locked || isAbsent}
                          aria-invalid={Number(r.values[c.id]) > c.max || Number(r.values[c.id]) < 0}
                          onChange={(e) => setValue(row.id, c.id, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="grid-total">
                    <span className="tabular-nums">
                      {r.attendance === null && !r.evaluated ? "—" : live.toFixed(2)}
                    </span>
                    <SaveMark state={r.save} error={r.error} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {banner && (
        <p
          role={banner.kind === "error" ? "alert" : "status"}
          className="text-sm rounded-md px-3 py-2"
          style={
            banner.kind === "error"
              ? { color: "var(--red-700)", background: "var(--red-100)" }
              : { color: "var(--green-700)", background: "var(--green-100)" }
          }
        >
          {banner.text}
        </p>
      )}

      {!readOnly && (
        <div className="card flex flex-col gap-2">
          {!confirming ? (
            <>
              <button type="button" className="btn btn-primary w-full" onClick={() => setConfirming(true)} disabled={validating}>
                اعتماد الدرجات وإرسالها للإدارة
              </button>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                الدرجات تُحفظ تلقائيًا ويمكن تعديلها حتى الاعتماد. بعد الاعتماد يُغلق اليوم وتصل الدرجات إلى مركز الدرجات.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">
                تأكيد اعتماد درجات {rows.length} طالب ليوم {dateISO}؟ لن يمكن التعديل بعدها إلا بإعادة فتح من الإدارة.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary flex-1" onClick={validate} disabled={validating}>
                  {validating ? "جارٍ الاعتماد…" : "نعم، اعتماد"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={validating}>
                  إلغاء
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SaveMark({ state, error }: { state: SaveState; error?: string }) {
  if (state === "pending" || state === "saving")
    return (
      <span className="grid-save" aria-label="جارٍ الحفظ" title="جارٍ الحفظ" style={{ color: "var(--ink-muted)" }}>
        …
      </span>
    );
  if (state === "saved")
    return (
      <span className="grid-save" aria-label="محفوظ" title="محفوظ" style={{ color: "var(--green-700)" }}>
        ✓
      </span>
    );
  if (state === "error")
    return (
      <span className="grid-save" role="img" aria-label={error ?? "لم يُحفظ"} title={error ?? "لم يُحفظ"} style={{ color: "var(--red-700)" }}>
        ⚠
      </span>
    );
  return null;
}
