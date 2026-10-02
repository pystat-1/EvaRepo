# Grading Center grade views: implementation brief for Claude Code

This brief is self-contained. It describes, for a fresh Claude Code session, how to build the Grading Center's three grade views in the Eva app:

1. **التصميم المدمج** (Combined)
2. **الشبكة الدورانية** (Rotation grid)
3. **الخريطة الحرارية** (Heatmap)

It also gives the full **visual profile** they share.

A working reference implementation already exists in the **web admin** (Next.js) on `main`, commit `b5a2d0e`, PR pystat-1/EvaRepo#1. The screenshots in this folder were taken from it with sample data. Use them as the visual target.

| # | Screenshot | Shows |
|---|---|---|
| 01 | `01-combined-by-hospital.png` | Combined, whole course, columns by hospital, day totals |
| 02 | `02-combined-all-criteria.png` | Combined, "all criteria": each student opens into criterion rows |
| 03 | `03-combined-by-date.png` | Combined, columns by calendar date |
| 04 | `04-combined-period.png` | Combined, one rotation period (wide cells with evaluator name) |
| 05 | `05-combined-summary.png` | Combined, course summary (hospital and criterion averages) |
| 06 | `06-day-popover.png` | Day popover |
| 07 | `07-filter-absent-evening.png` | Evening program, "غياب" filter: matching cells ringed |
| 08 | `08-rotation-grid.png` | Rotation grid, day totals |
| 09 | `09-rotation-all-criteria.png` | Rotation grid, one narrow column per criterion |
| 10 | `10-heatmap.png` | Heatmap, compact calendar cells |
| 11 | `11-heatmap-cards.png` | Heatmap, "all criteria" student cards |
| 12–13 | `12-phone-grid.png`, `13-phone-popover.png` | Phone width (390px): grid and bottom-sheet popover |

---

## 0. Before you start

1. **Find out the target from the user's prompt.**
   - **Web admin** (`src/`, Next.js 16, Prisma/Postgres): the views already exist. Your job is changes on top of them. Read §12a.
   - **Desktop admin app** (`apps/desktop`, Tauri + React + SQLite through `@eva/db`): port the views. Read §12b.
   - Anything else: §1–§11 are target-independent. Implement them on that stack.
2. Web only: `AGENTS.md` says this Next.js version differs from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing code.
3. Read `docs/GRADING_CENTER_PLAN.md`, especially the addendum and "Implementation status". Also read `docs/MEMORY.md` for the standing decisions.
4. Work on the branch the session tells you to use. Commit and push only there. Open a PR only if asked.

## 1. Goal and non-goals

**Goal.** For one course at a time, show every student's daily grades across the rotation:

- **Rows:** program → group → student.
- **Columns:** hospital → week → day, or calendar date.
- **Cells:** each cell is a day total, colored by percentage and labeled with its state. Clicking a cell opens a popover with the day's per-criterion details.
- **Display modes:** day totals, or every criterion.

The page offers three views of the same data (§7–§9).

**Non-goals (read-only views).**

- No editing.
- No dispute approval.
- No export.
- No live updates.
- No schema changes.

Those are later steps (G-6, G-8, G-9 in `GRADING_CENTER_PLAN.md`).

## 2. Domain rules (must hold)

- **Programs are separate.** Morning (`MORNING`) and evening (`EVENING`) are separate programs. They never appear in the same grid, list, count or filter. A group with no shift goes to a third program, "بدون وردية". The program comes from `groups.shift`.
- **Validated grades only.** Show grades only from validated evaluations (`pendingValidation = false`).
  - A saved but unvalidated day is **awaiting** (غير معتمد).
  - Awaiting days show no numbers. The popover says the grades appear after اعتماد.
- **One evaluation per (student, date).** Absent students may have only an `attendance_records` row (status `absent`) and no evaluation.
- **Scheduled days.**
  - A group's meeting days are every date in each active rotation block's `[startDate, endDate]` whose weekday is in the block's `daysOfWeek`.
  - Fall back to the term/course default days when `daysOfWeek` is null.
  - If two blocks overlap on a date, the earlier-starting block wins.
- **7-day window (Baghdad time).** A past scheduled day with nothing saved is:
  - **pending** (ضمن المهلة) up to 7 days after the date;
  - **missing** (ناقص) after that.
- **Holidays.** Dates in `course_holidays` are **holiday** days. They are excluded from averages and from "scheduled" counts.
- **Disputes.** A disputed day stays visible, flagged **تعارض**, and is **left out of averages** until the admin picks one evaluation.
  - Web: an open `evaluation_conflicts` row.
  - Desktop: `evaluations.status = 'DISPUTED'`.
- **Averages are provisional.** Label them «مبدئية» everywhere. The final grade formula is still an open decision (`FINAL_PLAN.md` §12).
- **Average rule.** The mean of day totals over **validated, non-disputed, attended (present or late)** days. Absences are counted in their own column, not averaged in.
  - This matches `packages/db/src/repo/grading.ts`.
  - The web reference's `counts()` in `src/lib/gradeMatrix/build.ts` currently also averages in absent days that have an evaluation row. Align it to this rule if you touch it, and update its test.
- **Never hide data.** Validated evaluations on dates the schedule doesn't list are reported in a collapsible notice, «N تقييمًا معتمدًا في أيام خارج جدول الدوران».
- **Today.** "Today" is the Baghdad calendar date (`todayISO()` from `@eva/core/date`), never UTC.
- **Weeks.** Iraq's working week is Sunday–Thursday. Key each week by its **Saturday**: `key = date − ((weekday + 1) mod 7)` days, with weekday 0 = Sunday. Every meeting day of one working week then shares a key.

## 3. Data contract

Build this once on the server or data layer and hand it to the UI as plain JSON. The reference is `src/lib/gradeMatrix/types.ts`.

```ts
type DayState = "ok" | "late" | "absent" | "disputed" | "awaiting" | "pending" | "missing" | "future" | "holiday";

interface MatrixDay {
  dateISO: string; hospitalId: string; state: DayState;
  attendance: "present" | "late" | "absent" | null;
  total: number | null;                 // only for validated evaluations
  scores: (number | null)[] | null;     // aligned to criteria
  evaluatorName: string | null; notes: string | null; feedback: string | null;
  dailyNote: boolean | null; locked: boolean; savedAt: string | null; holidayLabel: string | null;
}
interface MatrixStudent { id; name; uni; code: string | null; days: MatrixDay[] /* aligned to group.dates */; unplaced: MatrixDay[] }
interface MatrixGroup { id; name; stints: { hospitalId; start; end }[]; dates: { dateISO; hospitalId }[]; students: MatrixStudent[] }
interface MatrixProgram { id: "MORNING" | "EVENING" | "NONE"; label: string; groups: MatrixGroup[] }
interface GradeMatrixData {
  courseId: string | null; courseLabel: string; todayISO: string; windowDays: 7;
  criteria: { id; label; max }[]; maxTotal: number;
  hospitals: { id; name; color }[];     // ordered by first visit date in the course, then name
  programs: MatrixProgram[];            // MORNING, EVENING, NONE (only those with groups)
  holidays: Record<string, string>;     // dateISO → label
}
```

**Loader steps.** The reference is `src/lib/models/gradeMatrix.ts`. All reads, in parallel where possible:

1. Read the course's active groups, active rotation blocks (with hospital names), active rubric sections and term settings.
2. Read the active students of those groups (`id, nameAr, universityNumber, code, groupId`).
3. Read evaluations for those students. Select only the columns used: `studentId, dateISO, hospitalId, attendance, total, dailyNoteSubmitted, locked, notes, feedback, pendingValidation, updatedAt`, evaluator name, and scores (`rubricSectionId, score`).
   - Never select the `EvaluationScore` snapshot columns. Some databases lack them.
4. Read these as optional, falling back to empty on error (an older database may lack the table):
   - attendance records;
   - validated group work days (`groupId|dateISO`);
   - course holidays;
   - open conflicts.
5. Assign hospital colors by first-visit order (§5.3).
6. Sort students with `Intl.Collator("ar", { numeric: true, sensitivity: "base" })`, then by university number. Sort groups by the same collator.

**Day state.** Implement `resolveDayState`, checking in this order:

1. The evaluation exists:
   - `pendingValidation` → `awaiting`;
   - else disputed → `disputed`;
   - else attendance `absent` → `absent`, `late` → `late`, otherwise `ok`.
2. No evaluation, attendance record `absent` → `absent` if the group's work day for that date is validated, else `awaiting`.
3. No evaluation, any other attendance record → `awaiting`.
4. The date is a holiday → `holiday`.
5. The date is after today → `future`.
6. More than 7 days have passed since the date → `missing`, else `pending`.

Day 7 is still `pending`; day 8 is `missing`.

**Per-student statistics:**

- `avg`, and `pct = avg / maxTotal × 100`.
- `absences`: count of `absent` days.
- `hospAvg[hospitalId]` and `critAvg[i]`, using the same day set as `avg`.
- `due`: days that are not holiday and not future.
- `scheduled`: days that are not holiday.

## 4. Pure algorithms

Write these as framework-free functions with unit tests (reference: `src/lib/gradeMatrix/build.ts` and `build.test.ts`).

- **`meetingDates(start, end, days)`**
  - Every date in the inclusive range whose weekday code (`SUN…SAT`) is in the comma list.
  - A null or empty list means every day.
  - Guard the loop to at most 366 days. Return nothing when `end < start`.
- **`weekKey(date)`:** the Saturday key from §2.
- **`groupDates(blocks, fallbackDays)`:** sort blocks by start, enumerate their dates, keep the first block per date, and return the result sorted.
- **`rotationLayout(program, hospitalOrder, { avgColumns })`**, for the **hospital → week-at-hospital → day** order.
  - For each group:
    1. Split its date indexes by hospital.
    2. Within each hospital, split them into week runs by `weekKey`.
  - For each hospital, take the maximum weeks over groups, and per week rank the maximum days.
  - Columns, per hospital:
    - one day column per (week rank, day rank);
    - optionally, one average column.
  - `slots[groupId][col]` holds the group's date index, or `null` where the group has no meeting.
  - Header rows:
    - row 0: hospital (span = its days, plus 1 for the average column);
    - row 1: «الأسبوع n» (and «المعدل» for the average column);
    - row 2: «اليوم n» (and «من 15»).
  - Bands: per group per hospital, `{ order: the group's visit number of that hospital, from, to }`. `from` is null when the group never goes there; show «لا دوران هنا».
- **`dateLayout(program, holidays, range?)`**, for **course week → day** order.
  - Week numbers are ranks over *all* of the program's week keys. They stay course week numbers even when `range` limits the columns to one period.
  - Per week, take the maximum day count over groups.
  - Day column headers:
    - If every group meeting in that slot meets on the same date, the label is «الأحد 16/8» and the header is flagged as a holiday when that date is one.
    - Otherwise the label is «اليوم n».
  - Row-0 sub-label is the week's date range.
  - Bands come from `hospitalRuns`.
- **`hospitalRuns(group, slots)`:** consecutive columns where the group stays at one hospital become one band segment. Empty slots join the run they sit in, and leading empty slots join the first run.
- **`derivePeriods(groups)`**
  - Collect the distinct `(start, end)` block ranges across all groups.
  - They are periods only when there are 2–8 of them and they don't overlap (each start is after the previous end).
  - Otherwise return none, and hide the period tabs.
- **`dayPosition(program, group, i)`:** course week number, week number within this hospital stay, and day number within the week. Used by the popover.
- **`sparkline(days, maxTotal, 120, 34, pad = 4)`**, drawn right to left: the first day sits at the right edge.
  - `x = width − pad − i × step`, with `step = (width − 2·pad) / (n − 1)`.
  - `y = height − pad − total / maxTotal × (height − 2·pad)`.
  - Plot only days that count toward the average.
  - Return the points, the last point, and the y of the 60% line.
- **Filters** (`FilterId`):
  - `all` highlights nothing.
  - `attention` = disputed, missing, absent, or low.
  - `low` = a validated ok or late day with `total / max < 0.6`.
  - Any other filter id matches days with that state.
  - Row filtering: with any filter other than `all`, keep students who have at least one matching day in the current scope's days.
- **Search, `normalizeArabic`.** Apply in this order:
  1. NFKC.
  2. Strip diacritics (`ً-ٰٟ`) and tatweel.
  3. Fold `أإآٱ` → `ا`, `ى` and `ئ` → `ي`, `ؤ` → `و`, `ة` → `ه`.
  4. Turn Arabic-Indic digits into Latin digits.
  5. Collapse spaces and lowercase.

  Then match the normalized query against name, university number and code.

## 5. Visual profile (shared by all three views)

The style is the app's "clinical ledger" look: calm paper surfaces, one teal brand, ink text, color always paired with a word.

**Hard rules:**

- RTL throughout (`dir="rtl"`, `lang="ar"`).
- No emoji. Icons are inline SVG.
- Every state carries text, never color alone.
- Numbers use tabular figures.

### 5.1 Tokens

These already exist in `src/app/globals.css`, and the same values are in `apps/desktop/src/styles.css`.

| Token | Value | Use |
|---|---|---|
| `--brand` | `#0e5c6b` | sparkline, bars, active tab underline |
| `--brand-dark` | `#06333d` | pressed chips and segments, filter ring, focus ring, big totals |
| `--brand-tint` | `#eef5f3` | group band rows, row hover on the name cell |
| `--brand-tint-strong` | `#dcece9` | expanded toggle |
| `--ink` / `--ink-muted` | `#0b1a1f` / `#3d5654` | text / secondary text |
| `--surface` / `--surface-raised` | `#f6f7f4` / `#ffffff` | page / grid and cards |
| `--paper-100` | `#eef0ec` | hover backgrounds |
| `--border` / `--border-strong` | `#dde1da` / `#c7cdc4` | lines / control borders |
| inner grid line | `#eceee9` | between cells |
| summary columns | `#f8f9f6` | summary headers and cells |
| `--red-700` / `--red-100` | `#9c2f2f` / `#f6e5e3` | low, missing, absent |
| `--amber-700` / `--amber-100` | `#8a5c10` / `#f6ecd6` | late, disputed, awaiting |
| radius | 5px (`sm`), 8px (`md`), 10px popover, 14px sheet top | |
| shadows | card `0 1px 2px rgba(11,26,31,.05)`; popover `0 8px 24px -12px rgba(11,26,31,.28)` | |

### 5.2 Typography

- **Fonts.** Body: Vazirmatn. Headings and group names: Noto Kufi Arabic (`--font-display`).
- **Sizes:**
  - grid text 13px; header cells 12px/700 with a 10.5px muted sub-line;
  - day number 15px/800 (13.5px compact, 18px wide);
  - state tag 10px/700; date or evaluator sub-line 10px muted.
- **RTL text.** Write units as words, «من 15». Never write `/15`: bidi renders it as «15/».
  - Wrap Latin IDs in `<bdi dir="ltr">`, e.g. `2201348 · 26-1-M-0001`. Otherwise the code's parts reorder.

### 5.3 Color scales

- **Score heat (sequential teal), by percentage of max:**

  | Percentage | Background |
  |---|---|
  | below 60 | `#f7f8f6` (text turns `--red-700`, tag «دون 60٪») |
  | 60–69 | `#eef5f3` |
  | 70–79 | `#dcece9` |
  | 80–89 | `#bfdcd6` |
  | 90 and above | `#9ccbc3` |

  Ink text stays readable on every step. The same ramp colors criterion cells, by criterion percentage.
- **Hospitals (categorical).** Use `#3b6fb6 #b9770e #a93e6c #5f8a2c #7a5cb8 #c25a2e` in first-visit order, cycling after 6. These were checked for contrast on `#f6f7f4`.
  - Always show the color as a 9px dot **next to the hospital name**.
  - In heatmap cards, show it as a 3px top stripe over the date labels.

### 5.4 Cell states

Every view uses one mapping (reference: `src/lib/gradeMatrix/visual.ts`).

| State | Main text | Tag | Background | Text | Border |
|---|---|---|---|---|---|
| ok | total | — (or «دون 60٪» when low) | heat ramp | ink (red when low) | none |
| late | total | «متأخر» (amber) | heat ramp | ink | none |
| disputed | total (compact cells: «تعارض» at 10.5px) | «تعارض» (amber) | `--amber-100` | ink | 1.5px `#d9b46a` |
| absent | «غ» | «غائب» (red) | `--red-100` | red | 1.5px `#e3b9b4` |
| awaiting | «…» (compact: «انتظار») | «غير معتمد» (amber) | white | amber | 1.5px **dashed** amber |
| pending | «…» | «ضمن المهلة» | white | muted | 1.5px dashed `--border-strong` |
| missing | «—» | «ناقص» (red) | white | red | 1.5px red |
| holiday | «عطلة» | — | `#eceee9` | muted | none |
| future | (empty, or date sub-line) | — | `#fbfbf9` | muted | none, **not clickable** |
| no meeting (empty slot) | — | — | diagonal hatch `repeating-linear-gradient(-45deg,#f6f7f4 0 4px,#eef0ec 4px 8px)` | — | `aria-hidden` |

- **Filter hit.** A cell matching the active filter gets `inset 0 0 0 3px var(--brand-dark)`, or 2px on criterion cells.
- **Interaction.** Hover is `filter: brightness(.94)`. `:focus-visible` is a 2px `--brand-dark` outline at offset −3px.
- **Compact cells.** Cells under 52px tall never show a tag. States that would otherwise differ only by color say their word in place of the number.

### 5.5 Grid anatomy

Screenshots 01 and 08 show this.

- **Scroll region.** One container scrolls both ways: `overflow: auto`, `max-height: calc(100vh − 150px)`, 1px `--border`, radius 8px, card shadow.
  - It is `role="region"` with an `aria-label` and `tabIndex=0`.
- **Header.** One CSS grid, `position: sticky; top: 0`, with a soft bottom shadow.
  - Every header cell carries an explicit `grid-row` and a `grid-column: span n`.
  - The student cell spans all header rows.
  - Summary labels start at row 2 and span the remaining rows.
  - Emit cells **in row order**. Auto-placement then fills each row correctly.
- **Body.** Each row is its own `display: grid` with the **same** `grid-template-columns` as the header, so columns line up exactly.
- **Student column.** Sticky at the inline start (`position: sticky; inset-inline-start: 0`, which is the right edge in RTL).
  - Width `var(--student-col)`: 236px, or 156px at ≤640px.
  - It holds the name (13.5px/700, ellipsis) and IDs (11px, muted, LTR-isolated).
  - In the Combined view it also holds a 26px expand toggle with a chevron that rotates 180° when open.
- **Group band row.** `--brand-tint` background.
  - Sticky cell: «المجموعة {name}» at 13px/800 in the display font.
  - The other cells describe the rotation for that group, each with a hospital dot.
- **Summary columns** sit at the inline end, on `#f8f9f6`.
- **Row hover** tints the name cell.

### 5.6 Controls

- **View tabs** (underline tabs, 40px high): «التصميم المدمج», «الشبكة الدورانية», «الخريطة الحرارية».
  - Active: `--brand-dark` text with a 3px `--brand` underline.
  - The course `<select>` sits at the other end of the same row.
- **Program segmented control.** One segment per program, «{label} · {n} طالب», plus the muted note «البرامج منفصلة ولا تُعرض معًا.»
  - Segments are 34px high and 13px/700. Pressed: `--brand-dark` background, white text.
- **Status line:** «{program} · {g} مجموعات · {s} طالبًا · مُقيَّم {done} من {due} يومًا مستحقًا حتى اليوم ({p}٪)».
- **Filter chips.**
  - Pills, 34px high, 1px `--border-strong`, each with a count.
  - Always show «الكل» and «يحتاج انتباه». Show the others only when their count is above zero.
  - Tone colors: red for missing, absent and low; amber for disputed and late; muted for awaiting and pending.
  - Pressed: `--brand-dark` fill.
  - The 240px search field sits before the chips, placeholder «بحث بالاسم أو الرقم الجامعي».
- **Legend line** (12px):
  - heat steps as 18×12 swatches;
  - state tags (ناقص, غائب, تعارض, غير معتمد, ضمن المهلة, عطلة, لا دوام للمجموعة);
  - hospital dots with names;
  - in rotation criteria mode, «م1 = …» criterion names;
  - the hint «اضغط أي خلية لعرض تفاصيل اليوم · الأسهم للتنقل بين الخلايا».
- **Width.** The grid is full-bleed: `width: 100vw; margin-inline: calc(50% − 50vw)`, with 16px or 32px gutters.

### 5.7 Sparkline and bars

- **Sparkline:** 120×34 SVG.
  - Dashed 60% line: `#c7cdc4`, dash 3 3.
  - Trend line: 2px `--brand`, round joins and caps.
  - Last point: circle r 3.5, `--brand-dark`, 1.5px white stroke.
  - `role="img"` with an aria-label naming the last value.
- **Average bar:** 6px track `#eceee9`, radius 3. Fill is `--brand`, or `--red-700` below 60%.

### 5.8 Day popover

Screenshots 06 and 13 show this.

- **Box:** 380px wide (`max-width: calc(100vw − 24px)`), max-height `min(640px, 100vh − 24px)`, scrolls inside. White, 1px `--border-strong`, radius 10, popover shadow.
- **Position.**
  - Its right edge lines up with the cell's right edge, clamped 12px from the viewport.
  - It goes **below** the cell if it fits, else **above**. If neither fits, it takes the roomier side, caps its height to that room, and scrolls. It never covers the cell.
  - It repositions on scroll (capture) and resize, through rAF.
- **Phones (<640px):** a bottom sheet: full width, radius 14 14 0 0, max-height 80vh.
- **Content, top to bottom:**
  1. Header: name (16px bold), LTR IDs, badges «{program}» and «المجموعة {g}», close button (36px).
  2. Full date, «الثلاثاء 18/8/2026».
  3. Hospital dot and name.
  4. «الأسبوع a من الدورة · الأسبوع b في المستشفى · اليوم c».
  5. Definition list:
     - الحالة: state label from the table below;
     - المقيّم;
     - الحضور;
     - الملاحظة اليومية: سُلِّمت / لم تُسلَّم.
  6. State note:
     - pending: «تنتهي مهلة التسجيل في {date+7}»;
     - missing: «انتهت المهلة في …» (red);
     - awaiting: «تظهر الدرجات هنا بعد أن يعتمد المقيّم يوم المجموعة.», with a link to the validation page;
     - disputed: explanation (amber).
  7. For graded days: one line per criterion, label plus «{score} من {max}», then a 6px bar. Then «المجموع» at 20px/800 `--brand-dark`, plus «من 15 · 80٪».
  8. Notes and feedback.
  9. Footer: «مقفل / غير مقفل · آخر حفظ 16/8 · 10:43 ص» (Baghdad time), and a link «صفحة الطالب».
- **State labels:**

  | State | Label |
  |---|---|
  | ok | «محفوظ ومعتمد» |
  | late | «… · حضر متأخرًا» |
  | absent | «غائب» |
  | disputed | «تعارض بين مقيّمَين · بانتظار قرار الإدارة» |
  | awaiting | «حفظه المقيّم ولم يعتمده بعد» |
  | pending | «لم يُسجَّل بعد · ضمن مهلة الأيام السبعة» |
  | missing | «ناقص · انتهت مهلة الأيام السبعة» |
  | holiday | the holiday label |

### 5.9 Motion

The only animation is the 150ms chevron rotation. Respect `prefers-reduced-motion`.

## 6. Page layout (top to bottom)

1. Title «مركز التقييم», a one-line description, and the old-mode toggle (web: «مصفوفة الدرجات · ورقة الدرجات · جدول · شجري»).
2. View tabs, with the course select at the other end.
3. Program segments and the separation note.
4. Status line.
5. View options:
   - Combined: scope segments; order segments when the scope is "whole course"; mode segments «مجموع اليوم / جميع المعايير» except in the summary scope.
   - The other two views: mode segments only.
6. Search and filter chips.
7. Legend.
8. Unplaced notice, only if there is anything to report.
9. The grid.

**Empty states:**

- No groups in the course: «لا توجد مجموعات في هذه الدورة بعد», with a link to course setup.
- No rotation schedule in the program: «لا يوجد جدول دوران لهذا البرنامج بعد».
- Filters hide everyone: «لا يوجد طلاب يطابقون البحث أو التصفية».

**State resets:**

- Changing program resets the filter, the scope and the expansions.
- Changing view, filter, search, scope, order or mode closes the popover.

**URL.** Sync `view` and `program` to the URL without a reload (web: `window.history.replaceState`). Changing the course reloads data (web: `router.push(?courseId=…)`).

## 7. View 1: التصميم المدمج (Combined)

Screenshots 01–05 and 07 show this.

- **Scope segments:** «الدورة كاملة», one per period «الفترة n · 16/8 – 27/8» (only when `derivePeriods` finds some), and «ملخص الدورة».
- **Whole course + «حسب المستشفى»:**
  - Columns: `rotationLayout` without average columns, day cells 64px wide. Header row 0 shows hospital names with dots.
  - Each cell shows a date sub-line (`16/8`) when there's no tag.
  - Band: «الدوران {k} · {from} – {to}» per hospital.
- **Whole course + «حسب التاريخ»:**
  - Columns: `dateLayout`, 64px. Row 0 is «الأسبوع n» with a date-range sub-line; row 1 is «الأحد 16/8».
  - Band: hospital runs «{short name} · {range}».
- **Whole-course summary columns:**
  - one per hospital (66px), header «{short} / من 15» with dot, value = hospital average on the heat ramp;
  - «الاتجاه / مجموع اليوم», a 128px sparkline;
  - «النسبة / مبدئية», 62px;
  - «غياب / أيام», 54px, red when above 0.

  The header group label is «ملخص الطالب».
- **Period scope:**
  - Columns: `dateLayout` limited to the period's range, wide 156px cells. The sub-line is the evaluator's name.
  - Band: «{hospital} · الدوران {k} · {range}».
  - Summary («ملخص الفترة»):
    - «معدل الفترة / من 15» (96px, heat);
    - «الحضور / أيام» as «{attended} من {decided}» (84px), where decided = ok, late, disputed or absent;
    - «نسبة الدورة / مبدئية» (86px).
- **Summary scope** (no day columns):
  - «معدل اليوم في كل مستشفى»: one 96px column per hospital.
  - «معدل كل معيار عبر الدورة»: one 88px column per criterion, header «{label} / من {max}», heat by criterion percentage.
  - «الدورة»:
    - «المعدل» (80px);
    - «النسبة» (64px);
    - «غياب» (56px);
    - «الاتجاه» (128px).
  - Band: «ترتيب الدوران: A ← B ← C».
- **«جميع المعايير» mode.**
  - Each student row gains criterion rows underneath. Each criterion row has:
    - a sticky label: «{criterion}» plus muted «من {max}»;
    - one criterion cell per column (30px high, heat by criterion percentage);
    - a span over the summary columns: «المعدل {avg} من {max} · {p}٪» plus an average bar.
  - Per-student chevrons override the mode. Switching mode resets the overrides.
  - Criterion rows **never** add columns.

## 8. View 2: الشبكة الدورانية (Rotation grid)

Screenshots 08 and 09 show this.

- **Columns:** `rotationLayout` with average columns.
  - Per hospital, day cells are 66px wide, followed by a 70px «المعدل / من 15» column holding the hospital average on the heat ramp.
  - Then «الدورة»: «النسبة / مبدئية» (64px) and «غياب / أيام» (56px).
  - Header rows: hospital (13.5px/800 with dot), week, «اليوم n». Day cells show a date sub-line.
- **Band:** «الدوران {k} · {range}», or «لا دوران هنا».
- **«جميع المعايير» mode.**
  - Each day column becomes `C × 34px + 48px` wide.
  - It holds an inner grid of C criterion cells (52px high) and one compact total cell (48px).
  - A fourth header row labels them «م1…مC» and «مجموع». Put the full criterion name in `title`, and add the legend «م1 = الملاحظة اليومية (5) …».
- **No filter-scope subtleties:** filters use all the student's days.

## 9. View 3: الخريطة الحرارية (Heatmap)

Screenshots 10 and 11 show this.

- **Totals mode.**
  - Columns: `dateLayout` with compact 48px cells, 44px high. Each cell shows only the number, or a state word.
  - Header: row 0 «الأسبوع n» with range; row 1 the bare date «16/8» (holiday dates grey).
  - Band: hospital runs with dot and short name.
  - Summary: «الاتجاه» sparkline (128px) and «النسبة» (62px).
- **«جميع المعايير» mode (student cards).**
  - Sections per group: «المجموعة {g}» plus «ترتيب الدوران: …».
  - Cards sit in a responsive grid, `repeat(auto-fill, minmax(min(100%, 460px), 1fr))`, gap 12px.
  - Each card:
    - Header: name, IDs, average at 18px/800 `--brand-dark` plus «من 15», and «{pct} · غياب {n}».
    - Stint chips: dot, short name, range.
    - A mini-heatmap grid, horizontally scrollable, `132px repeat(n, 34px) 46px`:
      - first row: dates with a 3px hospital-color top stripe;
      - one row per criterion, «{label} ({max})», ending with its average;
      - a final «المجموع (15)» row.
    - Mini cells are 28px high, radius 3, 11.5px/700, and open the popover.

## 10. Interaction and accessibility

- **Delegated click.**
  - Every clickable cell is a `<button type="button" aria-haspopup="dialog">` with `data-cell="g:s:d"` (group, student and day indexes in the current program).
  - One click handler on the grid wrapper opens the popover. Clicking the same cell again closes it.
- **Aria-label on every cell:** «{student}، {hospital}، {full date}، {tag}، المجموع {n} من 15». Criterion cells name the criterion and «{score} من {max}».
- **Arrow keys.** Cells carry `data-r` (visible row index, including criterion rows) and `data-c` (column index).
  - RTL: ← moves to the next column, → to the previous; ↑/↓ change rows.
  - Skip gaps by searching up to 64 steps sideways, or 3 rows vertically.
  - Call `scrollIntoView({ block: "nearest", inline: "nearest" })`.
- **Popover keyboard and focus.**
  - Enter opens.
  - Esc closes and **returns focus to the cell**.
  - Clicking outside closes, unless the click lands on another cell, which opens that one.
  - On open, focus goes to the close button.
  - It is `role="dialog"` with `aria-modal="false"` and `aria-labelledby` pointing at the student-name heading.
- **Tab semantics.** Tabs use `role="tab"` and `aria-selected`. Segments and chips use `aria-pressed`. The expand toggle uses `aria-expanded` and an aria-label «عرض/إخفاء معايير {name}».
- **Phones.** No horizontal page overflow at 390px; only the grid scrolls sideways.

## 11. Tests and acceptance

**Unit tests** for the pure module (19 exist in `src/lib/gradeMatrix/build.test.ts`; port or extend them). Cover:

- Meeting dates by pattern, and an empty result for a reversed range.
- `weekKey`: Sunday 2026-08-16 → 2026-08-15; Thursday → the same; Saturday → itself; Friday 2026-08-21 → 2026-08-15; 2026-08-22 → itself.
- Overlapping blocks: the earlier block wins.
- Every `resolveDayState` branch, including the day-7 pending versus day-8 missing boundary.
- `studentStats`: excludes disputed, awaiting, holiday and future days (and absent days, per §2). Covers `due` and `scheduled`.
- Filters: `low`, `attention`, `all` highlights nothing.
- Sparkline RTL coordinates: `"116.0,4.0 4.0,30.0"` for totals 15 then 0 over 3 days.
- Arabic search folding (احمد↔أحمد, فاطمه↔فاطمة, ٢٢٠١↔2201).
- Rotation layout with 3 groups × 3 hospitals × 2 weeks × 2 days:
  - 15 columns with averages;
  - group 1's first date lands under hospital B, week 1, day 1;
  - band orders [3, 1, 2].
- Date layout:
  - shared-date labels and the holiday flag;
  - period limits keep course week numbers («الأسبوع 3»);
  - groups on different weekdays get «اليوم n» labels.
- `hospitalRuns` absorbs empty columns.
- `derivePeriods`: aligned ranges give 3 periods; one range gives none; overlapping ranges give none.
- `dayPosition` → `{ courseWeek: 4, hospitalWeek: 2, dayInWeek: 2 }` for 2026-09-08 in the fixture.

**Visual QA.** Render all three views with sample data in a real browser at 1440×980 and 390×844. Use the pre-installed Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; don't run `playwright install`. Compare with this folder's screenshots. Check:

- the header and body columns line up;
- the sticky name column and sticky header both work while scrolling;
- the popover never covers its cell, and is a bottom sheet on phones;
- Esc returns focus to the cell; arrows move between cells; URL params update;
- no console errors; no page-level horizontal overflow on phones.

**Repo checks before pushing:**

- web: `npx next typegen && npx tsc --noEmit -p . && npx vitest run`, ESLint on the changed files, then `next build`;
- desktop: `npx vitest run` and `npm run build -w @eva/desktop`.

## 12. Implementation map

### 12a. Web admin (already implemented: the reference)

| File | Role |
|---|---|
| `src/lib/gradeMatrix/types.ts` | data contract (§3) |
| `src/lib/gradeMatrix/build.ts` + `build.test.ts` | pure algorithms (§4) and their tests |
| `src/lib/gradeMatrix/visual.ts` | cell-state visuals (§5.4) |
| `src/lib/models/gradeMatrix.ts` | Prisma loader `getGradeMatrix(courseId, courseLabel)` |
| `src/components/gradeMatrix/GradeMatrix.tsx` | root client component: tabs, programs, options, chips, legend, delegated click and keys, URL sync, popover host |
| `src/components/gradeMatrix/CombinedView.tsx`, `RotationView.tsx`, `HeatmapView.tsx` | the three views |
| `src/components/gradeMatrix/DayPopover.tsx` | popover (§5.8) |
| `src/components/gradeMatrix/parts.tsx`, `common.ts`, `gradeMatrix.module.css` | shared cells, header grid, bands, sparkline, styles |
| `src/app/(admin)/grading-center/page.tsx` | default `matrix` mode; old modes at `?mode=sheet|table|tree`, each filter form with a hidden `mode` input |

### 12b. Desktop admin app (port)

- **Data.** Add `gradeMatrix(r: Repo, courseId: string): Promise<GradeMatrixData>` to `packages/db/src/repo/grading.ts`, using Drizzle on the SQLite schema in `packages/db/src/schema.ts`. Tables:
  - `courses`, `groups` (`shift`), `rotation_blocks` (`daysOfWeek`, `courseId`, `active`), `hospitals`, `students` (`code`);
  - `evaluations` (`pendingValidation`, `status`), `evaluation_scores`;
  - `attendance_records`, `group_work_days` (`validatedAt`), `course_holidays`, `rubric_sections`.

  Details:
  - Fall back to `course_attendance_patterns` when `daysOfWeek` is null, as `attendanceDays()` and `attendanceCalendar()` in `repo/courses.ts` already do. `DAY_ORDER`, `DEFAULT_DAYS` (`"SUN,MON,TUE,WED,THU"`) and `normDays` are module-private there (lines 195–197); export them rather than copying them.
  - Disputes: `evaluations.status = 'DISPUTED'`. The desktop has no conflicts table.
  - Sort with `compareArabic`. Search with `normalizeArabic` / `matchesSearch` from `@eva/core/text/arabic`, which already exist. Check that they fold the same letters as §4, and extend them there if not; don't add a second normalizer.
  - Put the pure module in `packages/core/src/grading/` (`@eva/core/grading/...`) so web and desktop can share it. Copy `build.ts`, `visual.ts` and `types.ts`, then import from there.
  - Add tests next to the existing `packages/db/src/repo/grading.test.ts`, using `testSeed.ts`.
- **UI.** In `apps/desktop/src/screens/GradingScreen.tsx`, add the three views as new values of its `view` state, next to `list` and `sheet`.
  - Make the Combined view the default.
  - Load data with TanStack Query (`useQuery({ queryKey: ["gradeMatrix", courseId], queryFn: () => gradeMatrix(r, courseId) })`).
  - Default the course to `currentCourse(r)`, as the screen already does.
  - No Next.js APIs. Keep view and program in component state; there is no URL to sync.
  - No Tailwind. Port `gradeMatrix.module.css` into `apps/desktop/src/styles.css` (the tokens are already identical) and replace the Tailwind utility classes with small CSS classes.
  - Link «صفحة الطالب» to the desktop's student view: `App` already has `openStudent`/`setOpenStudent`.
  - Link the awaiting note to wherever validations live in the desktop (or drop it).
- **Performance.** A course can hold tens of thousands of evaluations. Fetch per course, keep the rendering non-virtualized for now, and memoize the layouts and statistics.

## 13. Pitfalls already hit (avoid them)

- **Bidi.**
  - Write «من 15», never «/15» or «x / y».
  - Isolate Latin IDs with `<bdi dir="ltr">`.
  - Ranges «16/8 – 27/8» read correctly in RTL as written (start first).
- **React compiler lint rules** (`react-hooks/immutability`, `react-hooks/set-state-in-effect`).
  - Don't increment counters inside `.map` callbacks during render. Precompute row indexes in a plain loop first.
  - Don't `setState` in a layout effect to position the popover. Write `left`, `top` and `maxHeight` straight onto the element through a ref.
  - Don't use comma expressions in handlers.
- **Grid alignment.** Put the header in one grid with explicit `grid-row` values and body rows as separate grids with identical templates. Use `var(--student-col)` in the template so the phone width changes in CSS only.
- **Production database.** Some deployed databases lack newer columns and tables. Select explicit columns, and wrap reads of later-migration tables in a fallback.
- **Browser tests.** In dev, the Next.js dev-tools badge (`nextjs-portal`) intercepts taps. Remove it in tests (`document.querySelector("nextjs-portal")?.remove()`).
- **CI context.**
  - The `e2e` job is red on `main` because `apps/desktop/e2e/flow.ts` expects `.scard` straight after opening a group. Since commit 399d996 the student card opens only after tapping a name: click `button.name-btn` first.
  - Cloudflare "Workers Builds" fails instantly on non-`main` branches. Neither failure comes from these views.

## 14. Out of scope (next steps)

These are tracked in `GRADING_CENTER_PLAN.md` build order G-6…G-10:

- dispute approval and other journaled admin actions;
- the review queue;
- Excel and print export from these views;
- live updates;
- virtualization for very large courses.
