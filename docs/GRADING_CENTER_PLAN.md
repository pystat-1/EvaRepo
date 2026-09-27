# Big Goal 3: Grading Center (rebuilt from scratch) · PLAN

> **Status:** PLAN, waiting for approval. Not implemented.
> **Date:** 2026-09-28
> **Priority:** the most important function in the system. It is the live, authoritative record of every grade collected during the course.
> **Depends on:** Goal 1 (published course matrix: stints, week index, attendance days, holidays, rubric version) and Goal 2 E1–E5 (submission journal, conflicts, locks, late items, Baghdad dates).
> **Replaces:** the current `/grading-center` code (`gradingCenter.ts`, `gradingTree.ts`, `GradingTree.tsx`, the two pages). It is not reused; the URL `/grading-center` is kept.
> **Structure:** Part A workflow → Part B the grid → Part C the popover → Part D data engine → Part E tool choices (researched) → Part F implementation instructions → Part G attack → Part H build order.

---

# Part A: What the Grading Center is for (optimized workflow)

The admin uses it in **five moments** of a course. The whole design is built around making each one fast.

| Moment | The admin wants to… | What the Grading Center gives |
|---|---|---|
| **1. Monitor** (daily, during the course) | See grades arriving and spot problems early | A live grid that fills itself every ~15 s, and a one-line status: evaluated / scheduled, missing, overdue, disputed, late |
| **2. Inspect** | Understand one day for one student | Click a cell → **popover** with every criterion, attendance, evaluator, notes, feedback and sync times |
| **3. Decide** | Resolve disputes, accept late saves, correct errors | A **Review Queue** (one list of everything waiting on the admin). Each item jumps to its cell, and each decision is one confirmed action. |
| **4. Report** | Share and print results | Excel identical to the screen (3-level merged headers), a detail sheet, and print per group |
| **5. Close** | Finish the course with nothing missing | **Close-course check**: 0 missing, 0 disputed, 0 pending late → lock the course → a frozen final export is stored |

---

# Part B: The grid (your image, made complete)

## B.1 Layout: "Rotation view" (default, matches your image)

```
┌────────────────────┬─────────────────────────────────────────────┬──────────────────────────┬─────────┐
│                    │                مستشفى اليرموك               │     مستشفى الكندي   ▸    │         │
│                    ├──────────────────────┬──────────────────────┤  (collapsed: summary)    │ الإجمالي │
│                    │       الأسبوع 1       │       الأسبوع 2       │                          │         │
│                    ├──────────┬───────────┼──────────┬───────────┤                          │         │
│ الطالب              │  اليوم 1  │  اليوم 2   │  اليوم 1  │  اليوم 2   │  المعدل   الحضور         │  %  غ   │
├────────────────────┴──────────┴───────────┴──────────┴───────────┴──────────────────────────┴─────────┤
│ ▾ مجموعة A · صباحي      05/10       07/10       12/10       14/10        19/10 → 30/10               │  ← group band: this group's real dates
├────────────────────┬──────────┬───────────┬──────────┬───────────┬──────────────────────────┬─────────┤
│ علي حسن كاظم        │  13.5    │   14      │  غ 0     │  12.5 ●   │  12.4/15   3/4           │ 82.7  1 │
│ 2201347 · 26-1-M-07│          │           │          │           │                          │         │
│ زينب فاضل           │  14.5    │  ⚠ 2      │  —  3د   │           │  …                       │         │
├────────────────────┴──────────┴───────────┴──────────┴───────────┴──────────────────────────┴─────────┤
│ ▾ مجموعة B · صباحي      19/10       21/10       26/10       28/10        05/10 → 14/10               │
│ …                                                                                                    │
```

- **Columns:** **Hospital → Week of the stint (1, 2, …) → Attendance day (1, 2, …)**, exactly as in your image. Each hospital ends with **summary columns** (average daily total, attendance count). A **course total** block comes last (overall %, absences, days evaluated / scheduled).
- **Rows:** students, **grouped into bands by group**. Each band header shows **that group's actual dates** for every column, because groups visit the same hospital in different weeks. Every student in a band shares the same dates, so the header is exact.
- **Why relative weeks:** columns mean "week 1 / day 2 **of the stint at this hospital**". The whole course (all groups, all hospitals) then fits in **one grid** with no empty diagonal. The real date is in the band header, on hover, and in the popover.
- **Collapsible hospitals:** click a hospital header to collapse it into its summary columns. This keeps wide courses navigable.
- **Sticky:** the student column is pinned at the inline-start (right side in RTL) and all header rows are pinned at the top.

## B.2 Second layout: "Calendar view" (toggle)

Columns are **course weeks → real dates**. A cell shows the hospital's short code and the total. It answers "what happened on 12/10 across all groups" and is useful for monitoring and for checking the matrix.

## B.3 Cell states (each has an icon + text, never color alone)

| State | Shows | Meaning |
|---|---|---|
| Evaluated | `13.5` (sequential tint by %, number always visible; below the pass line → emphasized) | Normal |
| Absent | `غ 0` | Attendance = absent |
| Late arrival | `12.5 ●` | Attendance = late |
| Missing, window open | `— 3د` (3 days left) | Scheduled, past, no evaluation yet |
| Overdue | `! متأخر` | 7-day window closed, still missing |
| Disputed | `⚠ 2` | Two evaluators' grades are waiting for the admin's decision |
| Late save waiting | `⏱` | Arrived after 7 days; admin accept or reject |
| Admin-corrected | `13 ✎` | Changed by an admin (reason stored) |
| Locked | small lock icon | Locked by the admin |
| Future | empty | Scheduled, not yet happened |
| Holiday | hatched `عطلة` | Removed from attendance by the calendar |
| Not scheduled | grey `·` | For example, the student joined after that stint |

## B.4 Top bar and status line

- **Filters** (kept in the URL, so they can be shared and survive reloads):
  - course · shift (صباحي / مسائي) · group(s) · hospital(s) · evaluator · date range
  - status chips: missing / overdue / disputed / late / corrected / locked
  - student search (name, university number, code)
- **Status line:** one compact sentence, not a dashboard of big numbers. For example: "مُقيَّم 1,284 من 1,520 يوماً مجدولاً · 12 ناقص · 3 متجاوز المهلة · 2 تعارض · 5 متأخر بانتظار القرار · آخر تحديث قبل 12 ث" (1,284 of 1,520 scheduled days evaluated · 12 missing · 3 overdue · 2 disputes · 5 late awaiting decision · updated 12 s ago). Each part is a link that applies the matching filter.
- **Buttons:** layout toggle (Rotation / Calendar) · density toggle · **Review Queue** (with a count) · **Export** menu · **Close course**.

## B.5 Student sheet

Clicking a student's name opens a side **sheet** with:
- the student's full timeline (every day, every hospital)
- per-hospital averages
- attendance totals
- at-risk flags
- journal history
- the final-grade line (see Part D.6)

---

# Part C: The popover (click a cell)

Built on the **shadcn/ui Popover (Base UI)**, the component in your snippet. It opens **on click or Enter**, never on hover, and closes on Esc, returning focus to the cell.

```
┌──────────────────────────────────────────────┐
│ علي حسن كاظم · 2201347                        │
│ الأحد 12/10/2026 · مستشفى اليرموك             │
│ مجموعة A · الأسبوع 2 · اليوم 1                 │
├──────────────────────────────────────────────┤
│ الحضور: حاضر                                  │
│ الملاحظة اليومية            4    / 5  ████▌   │
│ المناقشة والتغذية الراجعة   5.5  / 7  ██████▎ │
│ الموقف والتواصل             1    / 1  ██████  │
│ الانتظام                    1    / 1  ██████  │
│ المظهر                      0.5  / 1  ███     │
│ ─────────────────────────────────────────── │
│ المجموع                   12   / 15   80%     │
├──────────────────────────────────────────────┤
│ المقيّم: د. سرى الموسوي                        │
│ حُفظ على الهاتف 12/10 10:42 · وصل 12/10 13:05  │
│ ملاحظات: …        تغذية راجعة: …               │
├──────────────────────────────────────────────┤
│ [ السجل ]  [ تصحيح… ]  [ قفل ]                 │
└──────────────────────────────────────────────┘
```

Buttons: السجل = history · تصحيح = correct · قفل = lock.

- **Disputed cell:** the popover shows **both grades side by side** (evaluator, every criterion, total, times) with **[اعتماد تقييم د. سرى]** and **[اعتماد تقييم د. علي]** (approve Dr. Sura's / Dr. Ali's evaluation).
- **Missing cell:** shows who is assigned, the days left in the window, and whether reminders were sent.
- **Late cell:** shows the late submission with **[قبول]** (accept) and **[رفض]** (reject).
- **Instant opening:** criteria scores are **already in the grid data**. Notes, feedback and history load on open, and are prefetched when the pointer rests on the cell.
- **Actions never happen inside the popover.** Approve, accept, correct, lock and unlock open a **Dialog** that shows a clear summary, asks for a **reason** where required, and has a single confirm button. This prevents an accidental click-outside from half-completing an action.
- **Performance:** one **controlled** popover is anchored to the active cell (Base UI positioner anchor). The grid does not create thousands of popover instances.

---

# Part D: Data engine (accuracy and zero data loss)

## D.1 Principles

1. **The Grading Center writes nothing by itself.** Every admin decision (approve, accept late, correct, lock, unlock) goes through the **same journaled write path** as evaluator saves (`EvaluationSubmission`, with `source: "admin"`), in one transaction with the audit log.
2. **Nothing is ever hidden.** Every evaluation appears exactly once: either in a grid cell or in the **"Unplaced" tray** (for example, a date that no longer matches the matrix). The grid proves this with a live counter (placed + unplaced = total).
3. **Nothing is ever deleted.** Enforced **in the database**, not only in code (D.5).
4. **Numbers are exact.** Scores and totals are stored as `NUMERIC(5,2)`, never float. Totals are always computed on the server.
5. **One builder, many outputs.** The screen, Excel, print and close-course snapshot are all produced by the same pure `buildGradeGrid()` function, so they can never disagree.

## D.2 Schema additions (on top of Goals 1 and 2)

```prisma
model Evaluation {                          // additions
  version     Int      @default(1)          // optimistic concurrency token, +1 on every change
  changeSeq   BigInt                        // global monotonic change counter (see D.4)
  score fields and total → Decimal @db.Decimal(5,2)
  groupId, hospitalId, courseId, weekIndex, dayIndex   // snapshot at save time (placement key)
  correctedById String?  correctedReason String?
}
model EvaluationScore { score Decimal @db.Decimal(5,2) }

model CourseGradePolicy {                   // how the final grade is computed (versioned)
  id         String @id @default(cuid())
  courseId   String
  version    Int
  formula    Json                           // e.g. { type: "mean_daily_percent", passMark: 60, hospitalWeights: {...} }
  createdById String
  createdAt  DateTime @default(now())
  @@unique([courseId, version])
}

model CourseSnapshot {                      // frozen output at course close
  id          String   @id @default(cuid())
  courseId    String
  createdById String
  createdAt   DateTime @default(now())
  dataSeq     BigInt                        // changeSeq the snapshot reflects
  checksum    String                        // SHA-256 of the canonical JSON
  r2Key       String                        // xlsx + JSON stored in Cloudflare R2
}

model IntegrityRun {                        // nightly self-check results
  id         String   @id @default(cuid())
  ranAt      DateTime @default(now())
  ok         Boolean
  findings   Json                           // mismatched totals, orphan rows, etc.
}

model BackupRun {                           // heartbeat written by the backup job
  id        String   @id @default(cuid())
  ranAt     DateTime @default(now())
  ok        Boolean
  sizeBytes BigInt?
  r2Key     String?
  note      String?
}
```

**Placement key:** the evaluation stores its own `groupId`, `hospitalId`, `weekIndex` and `dayIndex` **at save time**. A student who later moves group, or a matrix edited after grading, never "moves" or hides an existing grade.

## D.3 API (admin only, JSON, versioned)

| Method + path | Purpose |
|---|---|
| `GET  /api/gc/v1/grid?courseId&shift&groups&hospitals&from&to&status` | Column model + group bands (real dates) + students + packed cells (total, attendance, state, criteria scores, version) + `unplaced[]` + counts + `dataSeq` |
| `GET  /api/gc/v1/changes?courseId&since=` | Cells changed since a cursor (for live updates) |
| `GET  /api/gc/v1/evaluations/:id` | Notes, feedback, journal history, times (popover and history) |
| `GET  /api/gc/v1/review-queue?courseId` | Disputes, late saves, overdue items, unplaced items |
| `POST /api/gc/v1/actions` | `approve_conflict` · `accept_late` · `reject_late` · `correct` · `lock` · `unlock` (scope: cell / group-day / group-week / stint / course), each with `expectedVersion`(s) and `reason` |
| `GET  /api/gc/v1/export.xlsx?…` · `GET /api/gc/v1/print?…` | Outputs from the same builder |
| `POST /api/gc/v1/close-course` | Runs the checks, locks the course, stores the snapshot |
| `GET  /api/gc/v1/integrity` | Last integrity run + last backup + live counters |

Every POST requires an admin session, a JSON body and a matching `Origin` header. Every action is audited. **Exports are audited too** (who exported what and when), because they contain personal data.

## D.4 Live updates without losing a change

- Every evaluation write sets `changeSeq = nextval('evaluation_change_seq')` inside its transaction.
- The client (TanStack Query) polls `/changes?since=<cursor − overlap>` every **15 s while the tab is visible** and merges cells **by `version`**: a higher version wins, and an equal version is ignored.
- **Safety net:** a full grid refetch when the window regains focus and every 5 minutes. A banner appears if a full refetch finds a cell the incremental path missed; it should never happen, and it is logged.
- A small server endpoint answers only changed cells, so polling stays light on the free Neon compute.

## D.5 Zero-data-loss guarantees (layers)

| Layer | Guarantee |
|---|---|
| **Database role** | The app connects with a restricted Postgres role that has **no `DELETE`** on `evaluations`, `evaluation_scores` or `evaluation_submissions`, and **no `UPDATE`** on `evaluation_submissions`. Migrations run with the owner role. |
| **Triggers** | `evaluation_submissions` is append-only (a trigger raises an error on UPDATE or DELETE). `CHECK` constraints enforce score ≥ 0, a valid attendance value and a valid state. |
| **Transactions** | Journal + evaluation + scores + audit commit together or not at all. |
| **Optimistic concurrency** | Every admin action carries `expectedVersion`. A mismatch returns **409 "changed since you opened it"** and a refresh, so there are no lost updates between two admins. |
| **Nightly integrity check** | Recomputes every total from its scores. Checks that every applied submission maps to an evaluation, that there are no orphans, and that placed + unplaced = total. Results go into `IntegrityRun` and turn red on the Integrity panel if anything is off. |
| **Backups** | **Nightly `pg_dump` from GitHub Actions → encrypted → Cloudflare R2**. Retention: 30 daily + 12 monthly. The job writes a `BackupRun` heartbeat; the panel turns red after 36 h without a successful run. |
| **Restore drill** | Monthly: restore the latest dump into a temporary Neon branch and run the integrity check on it. |
| **Course close** | A frozen xlsx + JSON snapshot with a SHA-256 checksum, stored in R2 and recorded in `CourseSnapshot`. |

Why these backups: Neon's free plan only keeps a **6-hour** restore window, and the earlier snapshot routine failed with a quota error (see `PROJECT_GOALS.md`). `pg_dump` to R2 is free, off-platform and well documented by Neon.

## D.6 Final grade

- The final grade is computed by a **versioned `CourseGradePolicy`**, never hard-coded.
- **Proposed default** (to be confirmed by you): final % = mean of daily totals ÷ rubric max × 100, where absent days count as 0; pass mark 60 %.
- Until you confirm the formula, the final column is labeled **"مؤقت" (provisional)**.
- Changing the policy creates a new version, and old exports keep the version they used.

---

# Part E: Tool choices (researched, all free)

| Need | Choice | Why (and alternatives rejected) |
|---|---|---|
| Grid engine | **TanStack Table v8** (MIT, headless) | Nested column groups (hospital → week → day) and column pinning are built in. All features are free, with no community/enterprise split. Headless means full control of RTL, Tailwind and our multi-state cells. **AG Grid Community** (MIT) also has column groups and RTL, but its styling and cell renderers fight a custom design, and several of its advanced features are Enterprise-only. |
| Virtualization | **TanStack Virtual** (MIT), **rows only** | Supports RTL (`isRtl` + `dir="rtl"`); RTL programmatic scrolling was fixed upstream, so pin a version that includes that fix. Column virtualization combined with multi-level header groups is a known pain point, so columns are kept manageable by **collapsible hospitals** instead. |
| Popover / Dialog / Sheet | **shadcn/ui on Base UI** (your snippet's `render` prop API) | Base UI handles focus (moves into the popup, returns on close), collision-aware positioning, and optional hover delay (not used). MIT, copied into the repo. |
| Data fetching | **TanStack Query v5** (MIT) | `refetchInterval`, pause when hidden, refetch on focus, structural sharing (only changed cells re-render). |
| Excel | **exceljs** (already installed, MIT) | Merged multi-level headers, frozen panes, right-to-left sheet view (already used in `/api/my/export`). |
| Print | CSS print stylesheet (A3 landscape, one group per page) | No library needed |
| Numbers | Postgres `NUMERIC(5,2)` + Prisma `Decimal` | Exact decimals; float is for measurements, not grades |
| Backups | GitHub Actions cron + `pg_dump` + **Cloudflare R2** (10 GB free, free egress) | Neon's own documented pattern; off-platform |
| Tests | **Vitest** + **fast-check** (property tests, both MIT) + Playwright (already in devDeps) | Property tests prove "every evaluation appears exactly once" for random matrices |
| Icons / font | Phosphor · IBM Plex Sans Arabic (self-hosted) | Same as the evaluator app |

**Accessibility pattern:** WAI-ARIA **data grid**. `role="grid"`, row and column headers, and a roving tabindex (one focusable cell). Arrow keys move between cells (mirrored in RTL), Home/End go to the row start or end, and Ctrl+Home/End go to the grid corners. **Enter opens the popover**, Esc closes it and returns to the cell, and Tab leaves the grid.

---

# Part F: Implementation instructions (for whoever builds it)

1. **Read first.** Per `AGENTS.md`, read the Next.js 16 guides in `node_modules/next/dist/docs/` (route handlers, caching) before writing code. Then read `docs/MEMORY.md` and this file.
2. **Folder layout:**
   ```
   src/features/grading-center/
     model/buildGradeGrid.ts      ← pure: (matrix, students, evaluations, policy) → grid; no I/O
     model/buildGradeGrid.test.ts ← unit + fast-check property tests
     model/cellState.ts           ← one function decides a cell's state (used by UI, Excel, print)
     server/queries.ts            ← Prisma reads (2–3 queries, no N+1)
     server/actions.ts            ← journaled admin actions with expectedVersion
     api/…/route.ts               ← thin handlers: auth → validate (zod) → call server/*
     ui/GradeGrid.tsx             ← TanStack Table + Virtual, roving focus, sticky
     ui/CellPopover.tsx           ← single controlled Base UI popover
     ui/ActionDialog.tsx · ui/StudentSheet.tsx · ui/ReviewQueue.tsx · ui/StatusLine.tsx
     export/buildWorkbook.ts      ← exceljs from buildGradeGrid output
   ```
3. **Rules:**
   - Components never call Prisma.
   - Every number is displayed through `formatScore()` (one decimal, tabular numerals).
   - Every date goes through the Baghdad date helpers; never `new Date(dateISO)` math in UTC.
   - Every mutation goes through `server/actions.ts`.
   - Every cell state comes from `cellState.ts`.
4. **Write tests first** for `buildGradeGrid` and `cellState`. Invariants to prove:
   - every evaluation is placed exactly once or listed as unplaced
   - totals equal the sum of scores
   - group bands show the dates from the matrix
   - holidays never produce a "missing" state
   - disputed cells are excluded from averages
5. **UI setup:** `npx shadcn@latest init` (choose Base UI, Tailwind v4), then add `popover dialog sheet button tooltip`. Keep `<html dir="rtl">`. Use logical CSS properties (`inset-inline-start`, `ps-*`/`pe-*`), never left/right.
6. **Performance budget:** 500 students × 40 day-columns must render its first view in under 1.5 s and scroll at 60 fps on a mid-range laptop. The grid payload must be under 300 KB gzipped.
7. **Definition of done for each step:** type-check, lint, unit tests and Playwright pass, **the integrity check passes on seeded data**, and `docs/MEMORY.md` is updated.

---

# Part G: Attack on the plan (errors and vulnerabilities, with fixes)

| # | Sev | Attack: "what if…" | Fix (built into the plan) |
|---|---|---|---|
| G1 | 🔴 | The matrix is edited after grades exist, so evaluations no longer match any column and **vanish from the grid** | Placement uses the evaluation's own saved keys (D.2). Any mismatch goes to the **Unplaced tray**, and the counter proves placed + unplaced = total. Goal 1 blocks edits to already-graded weeks. |
| G2 | 🔴 | **Incremental updates miss a change.** Sequence numbers are handed out before commit, so a slower transaction can commit a lower number after the client has already read past it. | Overlap cursor + merge by `version` + full refetch on focus and every 5 min + a logged alarm if the safety net ever catches something (D.4) |
| G3 | 🔴 | **Two admins decide the same dispute** at the same time, or act on stale data | `expectedVersion` on every action → 409 + refresh (D.5) |
| G4 | 🔴 | A bug or bad query **deletes or rewrites history** | The DB role has no DELETE; the append-only trigger; nightly integrity check; backups + restore drill (D.5) |
| G5 | 🟠 | A student **moves group** mid-course, so the row shows the wrong dates or loses old cells | Cells are placed by the evaluation's snapshot. The row appears in the current group's band with a "انتقل" (moved) marker, and cells from the old group show their own real dates in the popover. |
| G6 | 🟠 | A group visits the same hospital **twice**, or stints have different lengths | The column model is computed from the matrix as the **max weeks per visit**, and repeat visits get "زيارة 2" (visit 2) columns. Cells that don't exist for a group show "not scheduled". Covered by property tests. |
| G7 | 🟠 | **Holidays and make-up days** break the "day 1 / day 2" alignment | Holiday = hatched cell, never "missing". A make-up date from the matrix gets an extra "يوم إضافي" (extra day) column in that week. |
| G8 | 🟠 | **Float rounding** (e.g., 0.1 + 0.2) makes totals or averages differ between screen and Excel | NUMERIC storage, server totals, one `formatScore()`, and one builder for every output (D.1) |
| G9 | 🟠 | An **admin correction silently overrides** an evaluator | Correction is journaled with a mandatory reason, shows the ✎ marker, the evaluator is informed in their app, and the history shows before and after |
| G10 | 🟠 | An **accidental click-outside** on a popover half-completes an action | No actions inside the popover; Dialog with confirmation and reason (Part C) |
| G11 | 🟠 | **Hover-opening popovers** flicker in a dense grid and open by accident | Click or Enter only; hover only prefetches |
| G12 | 🟠 | **Thousands of popover instances** make the page slow | One controlled popover anchored to the active cell |
| G13 | 🟠 | **Very wide courses** (8 hospitals × 4 weeks × 3 days = 96 columns) are unusable, and column virtualization with header groups is fragile | Collapsible hospitals (summary columns); rows-only virtualization; performance budget tested in CI |
| G14 | 🟠 | **RTL bugs**: sticky column on the wrong side, broken scroll-to-cell | Logical CSS properties; TanStack Virtual `isRtl` pinned to a version with the RTL scroll fix; Playwright RTL test for scroll-to-cell from the Review Queue |
| G15 | 🟠 | A **rubric version changes** mid-course, so totals are out of different maxima | Each cell shows its own version's criteria; averages are computed on **%**; the popover shows the version |
| G16 | 🟠 | **Backups fail silently** (this already happened with the Neon snapshot routine) | `BackupRun` heartbeat + red panel after 36 h + GitHub Actions failure email + monthly restore drill |
| G17 | 🟡 | The **Excel differs from the screen** | Same `buildGradeGrid()`; the export footer shows `dataSeq`, generation time and counts |
| G18 | 🟡 | **Personal data leaks** through exports | Admin-only; exports audited; the file shows the exporter's name and time |
| G19 | 🟡 | **CSRF** on admin actions | JSON-only + Origin check + SameSite=Lax |
| G20 | 🟡 | **Timezone drift** puts a grade on the wrong day | Dates are Baghdad `YYYY-MM-DD` strings end to end; no UTC `Date` arithmetic |
| G21 | 🟡 | **Color-only meaning**, keyboard traps, or unreadable cells | Icons + text per state; WAI-ARIA grid; every cell has a screen-reader label such as "علي حسن، اليرموك، الأسبوع 2 اليوم 1، 12/10، 12 من 15" (Ali Hassan, Yarmouk, week 2 day 1, 12/10, 12 of 15) |
| G22 | 🟡 | **Long-open tab** grows memory or re-renders everything every poll | Cells kept in a Map by key; merge only changed cells; structural sharing |
| G23 | 🟡 | **Inactive students** disappear although they have grades | Students with any evaluation are always shown (marked "غير فعّال", inactive) |
| G24 | 🟡 | The **final grade formula is undefined**, so the wrong grades get published | Versioned policy; the final column stays "provisional" until you confirm the formula (question 1) |
| G25 | 🟡 | The **course is closed with open items** | Close-course check blocks on missing, disputed or late items, or requires an explicit admin override with a reason |

---

# Part H: Build order

| Step | Deliverable | Verification |
|---|---|---|
| **G-1** | Schema additions (D.2), NUMERIC migration of scores and totals (a data-preserving cast verified by a before/after sum check), the restricted DB role, append-only trigger, CHECK constraints | Migration test on a Neon branch copy; the sum of all totals is identical before and after |
| **G-2** | `buildGradeGrid` + `cellState` (pure) with unit and property tests | 100 % of invariants pass on random matrices |
| **G-3** | Read API: `/grid`, `/changes`, `/evaluations/:id`, `/review-queue` | Query count ≤ 3 per grid call; payload budget met |
| **G-4** | Grid UI: rotation layout, group bands, sticky header and column, collapsible hospitals, virtualization, roving keyboard focus, status line, filters in the URL | Playwright: keyboard navigation, RTL sticky, 500×40 performance |
| **G-5** | Popover (single controlled) + Student sheet + Calendar layout | Popover shows the criteria with no network wait; Esc returns focus |
| **G-6** | Actions + Dialogs + Review Queue (approve dispute, accept or reject late, correct, lock/unlock scopes) with `expectedVersion` | Two-admin race → one succeeds, one gets 409; journal + audit rows present |
| **G-7** | Live updates (TanStack Query polling + overlap cursor + safety net) | Simulated out-of-order commits never lose a cell |
| **G-8** | Excel (3-level merged headers, frozen panes, RTL, detail sheet, footer) + print CSS + export audit | Numbers in the file equal the grid, compared cell by cell in a test |
| **G-9** | Integrity job + Integrity panel + GitHub Actions `pg_dump` → R2 + `BackupRun` heartbeat + restore drill script | Break a total on purpose → panel turns red; restore drill passes |
| **G-10** | Close-course flow + snapshot (checksum) + grade policy (after you confirm the formula); remove the old grading-center code | End-to-end: seed course → evaluators grade → dispute → approve → close → snapshot checksum verifies |

**Overall order across goals:** Goal 1 (S1–S9) → Goal 2 engine (E1–E5) → **Goal 3 (G-1…G-10)** → Goal 2 app (E6–E10). The Grading Center comes before the evaluator front end because it is the most valuable function and it is where the evaluator engine's data is verified.

---

## Questions for you

1. **Final grade formula:** how does the college turn daily totals into the final clinical mark? Is it the average of days, a weighting per hospital, an absence penalty? What is the pass mark (60 %?)? Until you answer, the final column is shown as provisional.
2. **Summary per hospital:** show the average daily total (default) or the sum?
3. **Admin correction:** may an admin change an evaluator's grade (with a reason), or only approve/reject what evaluators submitted? Default: **allowed, with a mandatory reason and full history.**
4. **Cell color scale:** keep a subtle tint by % (default), or plain numbers only?

## References (researched 2026-09-28)

- TanStack Table: [Header Groups guide](https://tanstack.com/table/v8/docs/guide/header-groups) · [Pinning guide](https://tanstack.com/table/v8/docs/guide/pinning) · [Virtualization guide](https://tanstack.com/table/v8/docs/guide/virtualization) · [column virtualization + header groups discussion](https://github.com/TanStack/table/discussions/5557)
- TanStack Virtual: [RTL programmatic scroll fix, PR #1291](https://github.com/TanStack/virtual/pull/1291) · [Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)
- TanStack Query: [Polling](https://tanstack.com/query/latest/docs/framework/react/guides/polling) · [Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- shadcn/ui + Base UI: [shadcn Popover (Base UI)](https://ui.shadcn.com/docs/components/base/popover) · [Base UI Popover](https://base-ui.com/react/components/popover)
- AG Grid comparison: [TanStack Table vs AG Grid (2026)](https://www.simple-table.com/blog/tanstack-table-vs-ag-grid-comparison) · [TanStack on AG Grid](https://tanstack.com/table/v8/docs/enterprise/ag-grid)
- Accessibility: [Accessible data grid guide](https://accessibility.build/guides/accessible-data-grid) · [UXPin: keyboard patterns for complex widgets](https://www.uxpin.com/studio/blog/keyboard-navigation-patterns-complex-widgets/)
- Numbers: [PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html) · [Crunchy Data: choosing a number format](https://www.crunchydata.com/blog/choosing-a-postgresql-number-format)
- Concurrency: [Prisma transactions and optimistic concurrency](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- Backups: [Neon plans (free restore window)](https://neon.com/docs/introduction/plans) · [Neon: automate pg_dump backups](https://neon.com/docs/manage/backup-pg-dump-automate) · [Neon: nightly backups with GitHub Actions](https://neon.com/docs/manage/backups-aws-s3-backup-part-2) · [Cloudflare R2 free tier](https://nubbo.app/blog/cloudflare-r2-free-tier/)
- Excel: [exceljs on npm](https://www.npmjs.com/package/exceljs)
