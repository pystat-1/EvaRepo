
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  startTransition,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  FILTERS,
  dayMatches,
  currentColumn,
  dateLayout,
  derivePeriods,
  fmtScore,
  fullDate,
  rangeLabel,
  type FilterId,
  type StudentSort,
} from "@eva/core/gradeMatrix/build";
import type { GradeMatrixData, ProgramId } from "@eva/core/gradeMatrix/types";
import { CombinedView, type Order, type Scope } from "./CombinedView";
import { RotationView } from "./RotationView";
import { HeatmapView } from "./HeatmapView";
import { DayPopover } from "./DayPopover";
import { DaySheet } from "./DaySheet";
import { StudentFile } from "./StudentFile";
import { EmptyState } from "./parts";
import { visibleStudents, type Mode } from "./common";
import styles from "./gradeMatrix.module.css";
import "./gm.css";

export type ViewId = "combined" | "rotation" | "heatmap";

const STEP = 60;
const FIRST = 12; // about a screenful: drawn at once, the rest of the step right after

const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: "combined", label: "التصميم المدمج", hint: "الدورة كاملة أو فترة أو ملخص، مع التصفية والبحث" },
  { id: "rotation", label: "الشبكة الدورانية", hint: "المستشفى ← أسبوع الدوران ← اليوم، مع معدل كل مستشفى" },
  { id: "heatmap", label: "الخريطة الحرارية", hint: "نظرة شاملة بالألوان، وبطاقة معايير لكل طالب" },
];

const TONE: Record<string, string> = {
  ink: "var(--ink)",
  brand: "var(--brand-dark)",
  red: "var(--red-700)",
  amber: "var(--amber-700)",
  muted: "var(--ink-muted)",
};

interface Pop {
  g: number;
  s: number;
  d: number;
  anchor: HTMLElement;
}

// Eva Desktop's port of the website's Grading Center (src/components/
// gradeMatrix): the same views and rules, fed by the local database. The
// course comes from the screen above; nothing here navigates.
export function GradeMatrix({ data, busy = false }: { data: GradeMatrixData; busy?: boolean }) {
  const [view, setView] = useState<ViewId>("combined");
  const [programId, setProgramId] = useState<ProgramId | null>(data.programs[0]?.id ?? null);
  const [mode, setMode] = useState<Mode>("totals");
  const [filter, setFilter] = useState<FilterId>("all");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  // Where «→ رجوع» goes: the scopes (and day) the admin came through.
  const [trail, setTrail] = useState<{ scope: Scope; dayCol: number | null }[]>([]);
  const [order, setOrder] = useState<Order>("date");
  const [show, setShow] = useState<number | null>(null); // criterion in the cells; null = the day's total
  const [sortBy, setSortBy] = useState<StudentSort>("list");
  const [dayCol, setDayCol] = useState<number | null>(null); // day sheet column; null = today's
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pop, setPop] = useState<Pop | null>(null);
  // «ملف الطالب»: the student whose file is open, and the name that opened it.
  const [file, setFile] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  // A big course draws its students in steps (search and filters see everyone).
  const [limit, setLimit] = useState(FIRST);
  useEffect(() => {
    if (limit !== FIRST) return;
    const id = setTimeout(() => startTransition(() => setLimit(STEP)), 0);
    return () => clearTimeout(id);
  }, [limit]);
  const gridRef = useRef<HTMLDivElement>(null);

  const program = data.programs.find((p) => p.id === programId) ?? null;
  const hospitalBy = useMemo(() => new Map(data.hospitals.map((h) => [h.id, h])), [data.hospitals]);
  const hospitalOrder = useMemo(() => data.hospitals.map((h) => h.id), [data.hospitals]);
  const periods = useMemo(() => (program ? derivePeriods(program.groups) : []), [program]);
  const todayCol = useMemo(
    () => (program ? currentColumn(program, dateLayout(program, data.holidays), data.todayISO) : 0),
    [program, data.holidays, data.todayISO]
  );

  // Another course (or a fresh load without this program): start over.
  useEffect(() => {
    if (!data.programs.some((p) => p.id === programId)) setProgramId(data.programs[0]?.id ?? null);
  }, [data, programId]);

  const allDays = useMemo(
    () => (program ? program.groups.flatMap((g) => g.students.flatMap((s) => s.days)) : []),
    [program]
  );
  const counts = useMemo(() => {
    const out = {} as Record<FilterId, number>;
    for (const f of FILTERS) out[f.id] = f.id === "all" ? 0 : allDays.filter((d) => dayMatches(f.id, d, data.maxTotal)).length;
    return out;
  }, [allDays, data.maxTotal]);
  const studentCount = program ? program.groups.reduce((n, g) => n + g.students.length, 0) : 0;
  const matching = useMemo(
    () => (program ? program.groups.reduce((n, g) => n + visibleStudents(g.students, query, filter, data.maxTotal).length, 0) : 0),
    [program, query, filter, data.maxTotal]
  );
  const due = allDays.filter((d) => d.state !== "holiday" && d.state !== "future").length;
  const done = allDays.filter((d) => d.state === "ok" || d.state === "late" || d.state === "absent" || d.state === "disputed").length;
  const unplaced = program
    ? program.groups.flatMap((g) => g.students.flatMap((s) => s.unplaced.map((d) => ({ s, d }))))
    : [];
  const hasSchedule = !!program && program.groups.some((g) => g.dates.length > 0);

  const popRef = useRef<Pop | null>(null);
  useEffect(() => {
    popRef.current = pop;
  }, [pop]);
  const closePop = useCallback((restoreFocus: boolean) => {
    const anchor = popRef.current?.anchor;
    setPop(null);
    if (restoreFocus && anchor?.isConnected) anchor.focus();
  }, []);

  const fileRef = useRef(file);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);
  const closeFile = useCallback(() => {
    const anchor = fileRef.current?.anchor;
    setPop(null);
    setFile(null);
    if (anchor?.isConnected) anchor.focus();
  }, []);
  const fileTarget = (() => {
    if (!file || !program) return null;
    for (let g = 0; g < program.groups.length; g++) {
      const s = program.groups[g].students.findIndex((x) => x.id === file.id);
      if (s >= 0) return { g, s, group: program.groups[g], student: program.groups[g].students[s] };
    }
    return null;
  })();

  function goScope(next: Scope, day: number | null = dayCol) {
    if (next === scope && day === dayCol) return;
    setTrail((t) => [...t, { scope, dayCol }]);
    setScope(next);
    setDayCol(day);
  }
  function goBack() {
    const prev = trail[trail.length - 1];
    setTrail((t) => t.slice(0, -1));
    setScope(prev ? prev.scope : "all");
    setDayCol(prev ? prev.dayCol : null);
  }

  function reset(next: () => void) {
    setPop(null);
    setLimit(FIRST);
    next();
  }

  function onGridClick(e: MouseEvent<HTMLDivElement>) {
    const name = (e.target as Element).closest<HTMLElement>("[data-student]");
    if (name && gridRef.current?.contains(name)) {
      setPop(null);
      setFile({ id: name.dataset.student ?? "", anchor: name });
      return;
    }
    const el = (e.target as Element).closest<HTMLElement>("[data-cell]");
    if (!el || !gridRef.current?.contains(el)) return;
    const [g, s, d] = (el.dataset.cell ?? "").split(":").map(Number);
    if ([g, s, d].some((n) => isNaN(n))) return;
    setPop((cur) => (cur && cur.anchor === el ? null : { g, s, d, anchor: el }));
  }

  // Arrow keys move between cells (right = previous column in RTL).
  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    if (el.dataset.r === undefined || isNaN(r) || isNaN(c)) return;
    const move: Record<string, [number, number]> = {
      ArrowRight: [0, -1],
      ArrowLeft: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const delta = move[e.key];
    if (!delta) return;
    const root = gridRef.current;
    if (!root) return;
    for (let k = 1; k <= 64; k++) {
      const target = root.querySelector<HTMLElement>(`[data-r="${r + delta[0] * k}"][data-c="${c + delta[1] * k}"]`);
      if (target) {
        e.preventDefault();
        target.focus();
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
      if (delta[0] !== 0 && k >= 3) break; // vertical: only skip a couple of rows
    }
  }

  const popTarget =
    pop && program
      ? (() => {
          const group = program.groups[pop.g];
          const student = group?.students[pop.s];
          return group && student && student.days[pop.d] ? { group, student } : null;
        })()
      : null;

  const viewProps = program
    ? { data, program, hospitalBy, hospitalOrder, mode, filter, query, limit }
    : null;

  return (
    <div className="gm flex flex-col gap-4" aria-busy={busy}>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className={styles.tabs} role="tablist" aria-label="طريقة العرض">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              className={styles.tab}
              aria-selected={view === v.id}
              title={v.hint}
              onClick={() => reset(() => setView(v.id))}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {data.programs.length === 0 ? (
        <EmptyState title="لا توجد مجموعات في هذه الدورة بعد">
          أضف المجموعات وجدول الدوران من شاشة «الدورات».
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className={styles.seg} role="tablist" aria-label="البرنامج">
              {data.programs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={p.id === programId}
                  onClick={() =>
                    reset(() => {
                      setProgramId(p.id);
                      setFilter("all");
                      setScope("all");
                      setTrail([]);
                      setDayCol(null);
                      setExpanded({});
                    })
                  }
                >
                  {p.label}
                  <span className="tnum" style={{ opacity: 0.8, fontWeight: 600 }}>
                    {" "}
                    · {p.groups.reduce((n, g) => n + g.students.length, 0)} طالب
                  </span>
                </button>
              ))}
            </div>
            <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
              البرامج منفصلة ولا تُعرض معًا.
            </span>
          </div>

          {program && (
            <p className="text-sm tnum">
              <span className="font-bold">{program.label}</span> · {program.groups.length} مجموعات · {studentCount} طالبًا ·
              مُقيَّم {done} من {due} يومًا مستحقًا حتى اليوم
              {due > 0 && ` (${Math.round((done / due) * 100)}٪)`}
            </p>
          )}

          {program && !hasSchedule ? (
            <EmptyState title="لا يوجد جدول دوران لهذا البرنامج بعد">
              حدّد المستشفيات والأسابيع وأيام الحضور من شاشة «الدورات»،
              وستظهر الدرجات هنا تلقائيًا.
            </EmptyState>
          ) : (
            program &&
            viewProps && (
              <>
                <div className="flex items-center gap-3 flex-wrap">
                  {view === "combined" && scope !== "all" && (
                    <button
                      type="button"
                      className="btn"
                      style={{ fontWeight: 700 }}
                      onClick={() => reset(goBack)}
                      title="العودة إلى العرض السابق"
                    >
                      → رجوع
                    </button>
                  )}
                  {view === "combined" && (
                    <div className={styles.seg} role="group" aria-label="النطاق">
                      <button type="button" aria-pressed={scope === "all"} onClick={() => reset(() => goScope("all"))}>
                        الدورة كاملة
                      </button>
                      {periods.map((p) => (
                        <button
                          key={p.index}
                          type="button"
                          aria-pressed={scope === `p${p.index}`}
                          onClick={() => reset(() => goScope(`p${p.index}`))}
                        >
                          الفترة {p.index + 1} · {rangeLabel(p.start, p.end)}
                        </button>
                      ))}
                      <button type="button" aria-pressed={scope === "day"} onClick={() => reset(() => goScope("day"))}>
                        كشف اليوم
                      </button>
                    </div>
                  )}
                  {view === "combined" && (
                    <div className={styles.seg} role="group" aria-label="ملخص الطالب">
                      <button
                        type="button"
                        aria-pressed={scope === "sum"}
                        title="صفحة بأسماء الطلاب وملخص كل منهم: المعدل في كل مستشفى وكل معيار، النسبة، الغياب والاتجاه"
                        onClick={() => reset(() => goScope("sum"))}
                      >
                        ملخص الطالب
                      </button>
                    </div>
                  )}
                  {view === "combined" && scope === "all" && (
                    <div className={styles.seg} role="group" aria-label="ترتيب الأعمدة">
                      <button type="button" aria-pressed={order === "hosp"} onClick={() => reset(() => setOrder("hosp"))}>
                        حسب المستشفى
                      </button>
                      <button type="button" aria-pressed={order === "date"} onClick={() => reset(() => setOrder("date"))}>
                        حسب التاريخ
                      </button>
                    </div>
                  )}
                  {view === "combined" && scope !== "sum" && scope !== "day" && (
                    <>
                      {mode === "totals" && (
                        <label className="flex items-center gap-2 text-sm font-semibold">
                          في الخلايا
                          <select
                            className="input"
                            style={{ width: "auto" }}
                            value={show === null ? "" : String(show)}
                            onChange={(e) => reset(() => setShow(e.target.value === "" ? null : Number(e.target.value)))}
                          >
                            <option value="">مجموع اليوم (من {data.maxTotal})</option>
                            {data.criteria.map((c, ci) => (
                              <option key={c.id} value={ci}>
                                {c.label} (من {c.max})
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        الترتيب
                        <select
                          className="input"
                          style={{ width: "auto" }}
                          value={sortBy}
                          onChange={(e) => reset(() => setSortBy(e.target.value as StudentSort))}
                        >
                          <option value="list">حسب القائمة</option>
                          <option value="weakest">الأضعف أولًا</option>
                          <option value="absences">الأكثر غيابًا</option>
                        </select>
                      </label>
                    </>
                  )}
                  {!(view === "combined" && (scope === "sum" || scope === "day")) && (
                    <div className={styles.seg} role="group" aria-label="التفاصيل">
                      <button
                        type="button"
                        aria-pressed={mode === "totals"}
                        onClick={() =>
                          reset(() => {
                            setMode("totals");
                            setExpanded({});
                          })
                        }
                      >
                        مجموع اليوم
                      </button>
                      <button
                        type="button"
                        aria-pressed={mode === "criteria"}
                        onClick={() =>
                          reset(() => {
                            setMode("criteria");
                            setExpanded({});
                          })
                        }
                      >
                        جميع المعايير
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="search"
                    className="input"
                    style={{ width: 240 }}
                    placeholder="بحث بالاسم أو الرقم الجامعي"
                    aria-label="بحث عن طالب"
                    value={query}
                    onChange={(e) => reset(() => setQuery(e.target.value))}
                  />
                  {FILTERS.filter((f) => f.id === "all" || f.id === "attention" || counts[f.id] > 0).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={styles.chip}
                      aria-pressed={filter === f.id}
                      style={filter === f.id ? undefined : { color: TONE[f.tone] }}
                      onClick={() => reset(() => setFilter(f.id))}
                    >
                      {f.label}
                      <span className={styles.chipCount}>{f.id === "all" ? studentCount : counts[f.id]}</span>
                    </button>
                  ))}
                </div>

                {mode === "criteria" && view === "rotation" && <CriteriaKey data={data} />}

                {unplaced.length > 0 && (
                  <details className="card text-sm" style={{ padding: "10px 14px", borderColor: "var(--amber-700)" }}>
                    <summary className="cursor-pointer font-semibold" style={{ color: "var(--amber-700)" }}>
                      {unplaced.length} تقييمًا معتمدًا في أيام خارج جدول الدوران — محفوظة، لكنها لا تظهر في الشبكة
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1 tnum">
                      {unplaced.map(({ s, d }) => (
                        <li key={`${s.id}${d.dateISO}`}>
                          {s.name} · {fullDate(d.dateISO)} · {d.state === "absent" ? "غائب" : `${fmtScore(d.total)} من ${data.maxTotal}`}
                          {d.evaluatorName && ` · ${d.evaluatorName}`}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div ref={gridRef} onClick={onGridClick} onKeyDown={onGridKey} >
                  {view === "combined" && scope === "day" && (
                    <DaySheet {...viewProps} column={dayCol ?? todayCol} onColumn={(c) => reset(() => setDayCol(c))} />
                  )}
                  {view === "combined" && scope !== "day" && (
                    <CombinedView
                      {...viewProps}
                      periods={periods}
                      scope={scope}
                      order={order}
                      expanded={expanded}
                      onToggle={(id, open) => {
                        setPop(null);
                        setExpanded((e) => ({ ...e, [id]: open }));
                      }}
                      show={mode === "totals" ? show : null}
                      sort={sortBy}
                      onOpenDay={(c) =>
                        reset(() => goScope("day", c))
                      }
                    />
                  )}
                  {view === "rotation" && <RotationView {...viewProps} />}
                  {view === "heatmap" && <HeatmapView {...viewProps} />}
                </div>
                {matching > limit && limit !== FIRST && !(view === "combined" && scope === "day") && (
                  <div className="flex items-center gap-3 flex-wrap text-sm">
                    <span>
                      يُعرض أول {limit} طالب من {matching}. ابحث أو صفِّ لتضييق القائمة، أو
                    </span>
                    <button type="button" className="btn" onClick={() => setLimit((n) => n + STEP)}>
                      عرض المزيد
                    </button>
                    <button type="button" className="btn" onClick={() => setLimit(Infinity)}>
                      عرض الكل
                    </button>
                  </div>
                )}
              </>
            )
          )}
        </>
      )}

      {file && program && fileTarget && (
        <StudentFile
          data={data}
          group={fileTarget.group}
          groupIndex={fileTarget.g}
          student={fileTarget.student}
          studentIndex={fileTarget.s}
          hospitalBy={hospitalBy}
          popoverOpen={!!pop}
          onOpenDay={(d, anchor) =>
            setPop((cur) => (cur && cur.anchor === anchor ? null : { g: fileTarget.g, s: fileTarget.s, d, anchor }))
          }
          onClose={closeFile}
        />
      )}
      {pop && program && popTarget && (
        <DayPopover
          data={data}
          program={program}
          group={popTarget.group}
          student={popTarget.student}
          dayIndex={pop.d}
          anchor={pop.anchor}
          hospitalBy={hospitalBy}
          onClose={closePop}
        />
      )}
    </div>
  );
}

// The rotation grid's criteria mode labels its narrow columns م1…م5.
function CriteriaKey({ data }: { data: GradeMatrixData }) {
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs">
      <span className="font-bold">المعايير</span>
      {data.criteria.map((c, i) => (
        <span key={c.id}>
          م{i + 1} = {c.label} ({c.max})
        </span>
      ))}
    </div>
  );
}
