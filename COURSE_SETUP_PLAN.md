# Big Goal 1: Unified Course Setup Wizard, Rotation Matrix and Announced Schedule

> **Status:** PLAN, waiting for approval (the matrix design choice in §5 is needed before building)
> **Date:** 2026-09-27
> **Replaces:** the scattered admin tabs `/setup`, `/master`, `/courses`, `/study-types`, `/hospitals`, `/evaluators`, `/groups` for setup work. Those pages stay as "manage" views but are no longer the way to set up a course.

---

## 1. The problem today

Setting up a course means jumping between 7+ tabs (Courses, Study types, Hospitals, Evaluators, Groups, Setup, Master sheet), and none of them depends on the others:

- A **course** has no dates, no weeks and no attendance days. It is just `year + number`.
- **Hospitals** and **study types** are global. Nothing records which ones take part in a given course.
- **Evaluator assignments** are not tied to a course. An assignment made for one course silently applies to every course.
- **Rotation blocks** are entered one at a time as free date ranges. Nothing prevents gaps, overlaps, two groups flooding one hospital, or a hospital with no evaluator.
- There is **no "published" moment**. Evaluators see rotation blocks the instant they are typed, even half-finished ones.

## 2. The target

One tab, **"إعداد الدورة" (Course Setup)**, with a guided stepper. Each step feeds the next:

```
 1 Year → 2 Course → 3 Study types → 4 Hospitals → 5 Evaluators ↔ Hospital match
        → 6 Groups (+ students) → 7 Weeks & attendance days → 8 Rotation
        ─────────────────────────────────────────────────────────────────
        ▶ THE MATRIX  (complete, navigable, single source of truth)
        ▶ PUBLISH → announced schedule per group → evaluator app imports it
```

**The matrix becomes the ground base.** Evaluator scope, the grading-day check, the announced schedule, offline bundles, statistics and exports all read from it. Nothing else defines "who is where, when".

## 3. Implementation approach (decision)

Build it **inside the current Eva v3 code**, not the planned full rebuild. The data engine, grading enforcement, offline sync and audit log already work and are wired to `RotationBlock` + `EvaluatorAssignment`. The wizard **writes those same tables** (plus a few new columns), so grading, `/my`, `/schedule` and offline import keep working with no rewrite. This also answers open question #1 in `PHASE_1_PLAN.md` for now: we evolve v3 step by step rather than starting over.

## 4. The eight steps in detail

Every step saves as you go (a draft is never lost), shows ✔ / ⚠ status in the stepper, and can be revisited. Later steps are locked until the steps they depend on are valid.

| # | Step | What the admin does | Saved to | Validation |
|---|------|--------------------|----------|------------|
| 1 | **Year** | Pick an existing academic year or type a new one (e.g. 2026) | `Course.year` | 4-digit year |
| 2 | **Course** | Pick course 1 or 2 of that year (or open an existing draft); optional label | `Course` (status `DRAFT`) | Unique `(year, number)`; resumes the existing draft if one exists |
| 3 | **Study types** | Tick which study types take part (e.g. Nursing `N`, Midwifery `M`); add a new one inline | `CourseStudyType` (new) | At least 1 |
| 4 | **Hospitals** | Tick participating hospitals; add inline; optional **capacity** (max groups at once) | `CourseHospital` (new, with `capacity`) | At least 1 |
| 5 | **Evaluators ↔ Hospitals** | A two-column matcher: hospitals on one side, evaluators on the other. Create an evaluator inline. Each evaluator gets one or more hospitals for **this course** | `EvaluatorAssignment` + new `courseId` | Every hospital has at least 1 evaluator (warning, not a block) |
| 6 | **Groups** | Generate groups quickly ("create 8 groups A–H, morning, Nursing") or one at a time; set shift and study type; **attach students** via CSV import or pick from unassigned | `Group` (`courseId` required), `Student.groupId` | Unique names in the course; every student in exactly one group |
| 7 | **Weeks & attendance days** | Course **start date**, **number of weeks**, and **attendance weekdays** per shift or study type (e.g. SUN+TUE), plus **holidays / excluded dates** | `Course.startDate`, `Course.weekCount`, `CourseAttendancePattern` (new), `CourseHoliday` (new) | Start date, weeks ≥ 1, at least 1 weekday per pattern |
| 8 | **Rotation** | **Auto-generate** a fair rotation (each group visits each hospital once, round-robin / Latin square, respecting capacity), then adjust by hand in the matrix | `RotationBlock` (+ `courseId`, `weekIndex`) | See §6 conflict checks |

After step 8 the **Matrix** opens full screen. The **Publish** button is enabled only when no blocking conflicts remain.

## 5. The Matrix: 10 design options (please pick one, or a combination)

All options show the same data: **group × week → hospital (+ evaluator)**. They differ in what they put first.

### D1. Group × Week grid (classic rotation chart)
Rows are groups, columns are weeks (with dates), and each cell is the hospital, colored per hospital with the evaluator's initials. Click a cell to change the hospital.
```
          W1 5–9 Oct   W2 12–16    W3 19–23    W4 …
Group A   [Yarmouk·AH] [Medical·SK] [Kindi·MR]
Group B   [Medical·SK] [Kindi·MR]   [Yarmouk·AH]
```
✔ The most familiar for coordinators and maps 1:1 to the announced schedule. ✖ Hospital overload is hard to see.

### D2. Hospital × Week grid (capacity view)
Rows are hospitals, columns are weeks, and each cell lists the groups there plus a load meter (`2/3`).
✔ Shows over-capacity and idle hospitals at once. ✖ Hard to follow one group's path.

### D3. Pivot grid: one matrix, three lenses ⭐
The same grid with a toggle **[By group | By hospital | By evaluator]** that swaps the row axis. Weeks are always the columns. Filters: study type, shift.
✔ Answers every question from one screen. ✖ Slightly more to learn.

### D4. Calendar (month) view
A real calendar. Each attendance day shows chips like "A @ Yarmouk". Holidays are greyed out.
✔ Shows the actual days, including holidays. ✖ Crowded with many groups; poor for editing.

### D5. Swimlane timeline (Gantt, drag to edit)
One lane per group, with colored hospital bars. Drag to move and stretch to resize (an upgrade of today's `/setup` timeline).
✔ Intuitive for multi-week stints. ✖ Drag-and-drop is weak on phones and fiddly for precise edits.

### D6. Compact code matrix (Latin square, print-first)
Tiny cells with hospital codes (`H1`, `H2`…) and a legend. Fits 20 groups × 16 weeks on one A4 landscape page.
✔ Best for printing and announcing. ✖ Codes need the legend to read.

### D7. Evaluator × Week roster
Rows are evaluators, and cells show which hospital and groups they cover each week.
✔ Makes evaluator workload and gaps obvious. ✖ Secondary view, not a primary editor.

### D8. Nested tree / accordion
Study type → Shift → Group → expands into that group's week list.
✔ Easy on mobile and for deep navigation. ✖ No at-a-glance overview.

### D9. Week board (kanban)
One column per week, with group cards stacked under hospital lanes. Drag a card to another hospital.
✔ Very visual for balancing one week. ✖ Loses the long-range picture.

### D10. Split pane: matrix + inspector + conflict list ⭐
The main grid (D1 or D3) on the left. On the right, an **inspector** for the selected cell (hospital, evaluator, dates, days, students, notes) and a live **conflicts panel** ("W3: Yarmouk has 4 groups, capacity 3"; "W5: Group C has no hospital"). Clicking a conflict jumps to its cell.
✔ Best for getting a correct matrix before publishing. ✖ Needs a wide screen (collapses to a drawer on phones).

### Recommendation
**D3 + D10 as the working screen, D6 as the print/announce output, and D1 as the per-group announced schedule.**
The coordinator builds and checks in the pivot grid with the inspector and conflict list, publishes, and then prints the compact matrix for everyone plus a clean per-group schedule. I can build clickable mockups of the top 3–4 options before any code if you want to see them first.

## 6. Conflict checks (run live and before publishing)

| Check | Severity |
|-------|----------|
| A group has no hospital in some week | ⚠ warning (could be an intentional break) |
| A group is in two hospitals in the same week | ⛔ block |
| A hospital is over its capacity in a week | ⛔ block (or ⚠ if no capacity is set) |
| A hospital has groups in a week but no evaluator | ⛔ block |
| An evaluator covers two hospitals on the same weekday | ⚠ warning |
| A group visits the same hospital twice (when "each once" rotation is chosen) | ⚠ warning |
| A group has no students | ⚠ warning |
| An attendance day falls on a holiday | ℹ info (automatically skipped) |

## 7. Publishing and the announced schedule

- **Course status:** `DRAFT → PUBLISHED → ARCHIVED`.
  - **DRAFT:** only admins see it, and evaluators cannot grade against it.
  - **PUBLISHED:** evaluators see it and grading is allowed.
  - **ARCHIVED:** read only.
- **Changes after publishing** are allowed but tracked. Each publish creates a numbered **schedule version** in the audit log (`Schedule v3 published by X`). Changes to past weeks that already have grades are blocked.
- **Announced schedule page** (`/announce/[courseId]`, printable, plus PDF/Excel export):
  - **Per group:** week number, date range, the actual attendance dates (holidays removed), hospital, evaluator.
  - **Whole course:** the compact D6 matrix.
- **Evaluator app link:**
  - `/schedule` shows only **published** blocks where the evaluator is assigned for that course.
  - "Import group" loads the group roster, the rubric and the actual attendance dates into the offline bundle, as it does today.
  - The grading-day check uses the same matrix: the course is published, the date is inside the week, it is an attendance weekday, and it is not a holiday.

## 8. Data model changes (additive migration, no data loss)

```prisma
enum CourseStatus { DRAFT PUBLISHED ARCHIVED }

model Course {            // + new fields
  status          CourseStatus @default(DRAFT)   // existing rows → PUBLISHED
  startDate       String?      // "YYYY-MM-DD", a week-1 day
  weekCount       Int?
  setupStep       Int          @default(1)      // wizard resume point
  scheduleVersion Int          @default(0)
}
model CourseStudyType { courseId, studyTypeId  @@unique([courseId, studyTypeId]) }
model CourseHospital  { courseId, hospitalId, capacity Int?  @@unique([courseId, hospitalId]) }
model CourseAttendancePattern { courseId, shift Shift?, studyTypeId String?, daysOfWeek String }
model CourseHoliday   { courseId, dateISO String, label String?  @@unique([courseId, dateISO]) }

model EvaluatorAssignment { + courseId String? }  // null = legacy/global
model RotationBlock       { + courseId String?, + weekIndex Int? }  // one block per group-week from the wizard
```

- **Existing data:** current courses are marked `PUBLISHED`. Existing blocks and assignments keep `courseId = null` and continue to work exactly as now. The wizard only makes new data stricter.
- Every wizard write goes through the existing `recordAudit`, and multi-row writes (auto-generate rotation, publish) run in a single `prisma.$transaction`.

## 9. Build order (each step shippable and tested)

| Step | Deliverable |
|------|-------------|
| **S1** | Migration (§8) + model functions + unit tests for the rotation generator, conflict checker and attendance-date expander (weeks × weekdays − holidays) |
| **S2** | `/course-setup` shell: course picker, stepper with resume, steps 1–4 |
| **S3** | Step 5 evaluator ↔ hospital matcher; step 6 groups + bulk generate + student attach |
| **S4** | Step 7 calendar (weeks, weekdays per pattern, holidays) |
| **S5** | Step 8 auto-rotation + **the Matrix** in the chosen design + conflicts panel |
| **S6** | Publish / versioning; announced schedule page + print/PDF/Excel |
| **S7** | Evaluator link: `/schedule`, `/my`, offline bundle and grading checks read published course data + holidays |
| **S8** | Navigation cleanup: one "إعداد الدورة" entry; old tabs grouped under "إدارة البيانات"; `/setup` and `/master` redirect to the wizard |
| **S9** | End-to-end smoke test: set up a course in the wizard → publish → evaluator imports → grades → the grade appears in the Grading Center |

## 10. Questions for you

1. **Matrix design:** which option(s) from §5? (Recommended: D3 + D10, print D6, per group D1.)
2. **Rotation length:** is one cell always **one week**, or do groups stay at one hospital for multi-week stints (e.g. 2 weeks)? *Proposed: stint length is set in step 8; the default is 1 week.*
3. **Attendance days:** are they the same for all groups, or different per shift or study type? *Proposed: per shift + study type, with one default.*
4. **Evaluators:** is one evaluator per hospital enough, or can a hospital have several evaluators each covering specific groups?
5. **Students:** should attaching students to groups be part of step 6 (proposed), or a separate step after groups?
6. **Mockups:** do you want clickable mockups of the recommended designs before I build S5?
