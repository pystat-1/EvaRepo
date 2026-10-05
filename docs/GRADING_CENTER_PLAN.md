# Big Goal 3: Grading Center · FINAL PLAN

> **Status:** FINAL. Decisions confirmed by the user on 2026-09-28 (this file closes `FINAL_PLAN.md` §12's six open questions — see §0 below). Not implemented yet.
> **Depends on:** Big Goal 1 (Course Setup / matrix, `COURSE_SETUP_PLAN.md`) and Big Goal 2 (Evaluator App, `EVALUATOR_APP_PLAN.md`) — the Grading Center reads the same `Evaluation`/`EvaluationScore`/`EvaluationSubmission`/`EvaluationConflict`/`EvaluationClaim`/`Flag` tables both goals already write to.
> **Supersedes:** where this file disagrees with `FINAL_PLAN.md` §5.3/§11, `FINAL_PLAN.md` wins per its own precedence rule — this file only fills in the detail FINAL_PLAN.md pointed to and was missing.
> **Stack:** free and open-source only, per `FINAL_PLAN.md` §7 — TanStack Table v8 + TanStack Virtual + TanStack Query v5, shadcn/ui on Base UI, Phosphor icons, Cairo font, exceljs (already installed).

---

## 0. §12's open questions, resolved (2026-09-28)

| # | Question | Decision |
|---|---|---|
| 1 | Final grade formula | **Provisional for now**: the final mark shown is a simple average of daily totals, clearly labeled "مبدئي" (provisional) everywhere it appears (grid footer, student sheet, exports). The real formula (weights, absence penalty, pass mark) is deferred — this plan versions grade policy (`CourseGradePolicy`, §9) precisely so swapping in the real formula later never touches historical data. |
| 2 | v3 production data | **Start clean.** The rebuilt schema (§9) does not carry over the current production rows (156 students, 386 evaluations, etc. as of 2026-09-27). Existing data stays in the DB, untouched, until the user explicitly says to drop or archive it — nothing in this plan deletes anything by itself. |
| 3 | Hosting | **Cloudflare Workers only**, confirmed — matches the already-live deployment (`evarepo.evarepo.workers.dev`, `wrangler.jsonc`). The stale Netlify workflow is dead weight to remove in P1, not a real second target. |
| 4 | Google Sign-In | **Keep it** — already implemented (`src/app/api/auth/google/callback/route.ts`), including the E2 server-session treatment for evaluators. Only the production OAuth redirect URI is still outstanding (P5). |
| 5 | Icons | **Phosphor** line icons, one stroke weight, no emoji — matching `EVALUATOR_APP_PLAN.md` §9. |
| 6 | Cell colors | **Subtle tint by score band**, layered under the mandatory icon+text status (never color alone — same accessibility rule as `EVALUATOR_APP_PLAN.md` §9: every status pair ≥ 4.5:1 contrast). |

**Font note:** `FINAL_PLAN.md` §8 specifies **Cairo**, which overrides `EVALUATOR_APP_PLAN.md` §9's IBM Plex Sans Arabic per the precedence rule in both files' headers. The Evaluator App's font choice should be revisited to Cairo when that plan is next touched, so the admin and evaluator apps share one self-hosted typeface — not re-litigated here since it's out of this plan's scope.

---

## 1. What the Grading Center does

The admin's single place to see, understand and act on every grade in a published course:

1. **See everything at once.** One grid: rows are students (banded by group), columns are hospital → week → attendance day, cells are day totals. A per-hospital summary column and a course total column sit alongside.
2. **Read one cell's full story.** Click (or press Enter on) a cell to open a popover: every rubric criterion's score, attendance, evaluator, notes/feedback, device time vs. received time — and, if disputed, both competing grades side by side.
3. **Act, deliberately.** Every state-changing action (approve a dispute, accept/reject a late save, correct a grade, lock/unlock) opens a confirmation dialog with a reason where the rulebook requires one. Nothing happens from a stray click inside the popover.
4. **Never lose track of what's missing.** A Review Queue surfaces disputes, late saves, overdue (still-missing) evaluations and unplaced grades — the last being FINAL_PLAN.md §10's "placed + unplaced = total" invariant made visible, not just a design principle.
5. **Export exactly what's on screen.** Excel (3-level merged headers, RTL) and print-per-group come from the same builder function that renders the grid — so the file can never drift from what the admin was looking at.
6. **Close a course only when it's actually done.** Closing checks 0 missing, 0 disputed, 0 pending, then locks the course and writes a checksummed snapshot.

---

## 2. The two views

Both views are built by the same pure engine function (`buildGradeGrid`, §11) with a different column axis — never two separate implementations that could drift.

### 2.1 Rotation view (primary, `FINAL_PLAN.md` §5.3's "your table design")

```
                    ┌─────────── مستشفى اليرموك ───────────┐  ┌── مستشفى بغداد ──┐   الملخص   المجموع
                    │  الأسبوع 1 (5–9 ت1)  │ الأسبوع 2 (12–16) │  │ الأسبوع 3 (19–23) │  اليرموك    الكلي
                    │  أحد   ثلاثاء         │ أحد   ثلاثاء       │  │ أحد   ثلاثاء       │            
مجموعة A · صباحي     │                                                                              
 علي حسن كاظم        │  ✓12.5  ✓13         │  ✓14   ⚠غياب      │  │  ⏳    ⏳          │  13.2/15    ~62%
 زينب فاضل           │  ✓11    ✗تعارض      │  ✓12   ✓13.5      │  │  ⏳    ⏳          │  12.1/15    ~58%
مجموعة B · مسائي     │  … (band header shows this group's REAL dates from the matrix) …
```

- **Columns:** Hospital → the week-of-stint that hospital covers (with its real date range from the published matrix) → attendance day, plus a per-hospital summary column and a course-total column. A hospital with no groups this week collapses to nothing (no empty column stretch).
- **Rows:** students, **banded by group** (§ FINAL_PLAN.md §5.3). Each group's band header shows that group's actual attendance dates for the visible weeks — pulled from the published matrix's attendance-date expander (`COURSE_SETUP_PLAN.md`'s `expandAttendanceDates`), never a generic "week N" label.
- **Collapsing:** a hospital's day columns collapse to just its summary column on tap/click, so a wide course (many hospitals × many weeks) stays scannable. The student-name column and the header rows stay pinned (CSS `position: sticky`, not a virtualization side-effect) while scrolling in either direction.
- **Scale target:** 500 students × 40 day-columns scrolling smoothly (`FINAL_PLAN.md` U4's verification) — this is exactly what TanStack Virtual is for; only visible rows/columns mount.

### 2.2 Calendar view

Same student rows, same cell renderer, but columns are real calendar dates across the whole course (not grouped by hospital/week) — for "what happened on this specific day across every group" questions the rotation view doesn't answer well (e.g. a holiday check, or an admin spot-checking a specific date a complaint referenced).

A toggle switches between the two views without losing scroll position on the student axis.

---

## 3. Cell states

Every cell shows **icon + text**, never color alone (contrast ≥ 4.5:1 for every pairing), with the score-band tint (§0.6) as a secondary, non-load-bearing signal:

| State | Meaning | Icon |
|---|---|---|
| **Evaluated** | A grade exists for this student-day, `ACTIVE` status | check-circle |
| **Absent** | Attendance = absent (score forced to 0 per `EVALUATOR_APP_PLAN.md` §2.6) | x-circle (muted) |
| **Late** | Attendance = late, graded normally | clock |
| **Missing (N days left)** | Scheduled, no grade yet, still inside the 7-day window | warning-circle, with the days-left count |
| **Overdue** | Still missing after the 7-day window closed | warning-circle (danger tint) |
| **Disputed** | Two+ submissions competing, frozen pending admin decision | warning-diamond |
| **Late-save waiting** | A save arrived after day 7, stored `late`, awaiting admin accept/reject | clock-counter-clockwise |
| **Corrected** | An admin correction replaced the original grade (history kept, §5) | pencil-simple |
| **Locked** | Locked at any scope (cell/group-day/group-week/stint/course) | lock-simple |
| **Future** | The date hasn't happened yet | — (empty, no icon needed) |
| **Holiday** | Excluded from attendance by `CourseHoliday` | calendar-x (muted) |
| **Not scheduled** | This student's group isn't at any hospital this day (a gap, §6 of `COURSE_SETUP_PLAN.md`'s conflict checker already flags these at the matrix level) | minus |

---

## 4. The popover

Opens on click or `Enter` (keyboard-navigable grid — arrow keys move the focused cell, matching `FINAL_PLAN.md` U4's keyboard-check requirement). Shows, top to bottom:

1. Date, hospital, group, week-of-stint, day-of-week.
2. Every active rubric criterion as `score / max`, the total and the percentage.
3. Attendance, evaluator name, notes, feedback.
4. `deviceTime` vs. `receivedAt` (from `EvaluationSubmission`, `EVALUATOR_APP_PLAN.md` §3) — the pair that catches a backdated phone clock (risk P7 in that plan).
5. **If disputed:** both competing submissions side by side, each with its own attendance/scores/notes/evaluator/times — exactly the comparison `EVALUATOR_APP_PLAN.md` §2.3 promises the admin's Review Inbox.

The popover is **read-only**. Every action lives one level below it (§5), never inline here — this is what makes every state change deliberate and auditable rather than a stray click.

---

## 5. Actions and the Review Queue

| Action | Scope options | Confirmation requires |
|---|---|---|
| **Approve dispute** | One student-day | Choosing which submission wins; optional note. The chosen submission becomes the `Evaluation`; the other stays in `EvaluationSubmission` marked not-approved. Both evaluators see the outcome (`EVALUATOR_APP_PLAN.md` §2.3). |
| **Accept / reject late** | One student-day | A late (`outcome: "late"`) submission either becomes the evaluation (accept) or stays rejected (reject); either way it's recorded, never silently dropped. |
| **Correct** | One student-day | A mandatory reason. The prior grade is never overwritten in place — a new `EvaluationSubmission` row is written (`source: "admin_correction"`), and the evaluation now points at it. Full history stays queryable. |
| **Lock / unlock** | Cell · group-day · group-week · stint · course | Unlock is admin-only, always audited (`EVALUATOR_APP_PLAN.md` §2.5's lock scopes, using the `lockedAt`/`lockedById` columns already added to `Evaluation` in E1). |

**Every action carries a version check** (an `updatedAt` or a small integer version the client must echo back) so two admins acting on the same cell at once get a clear "changed since you opened it, reload" (`409`) instead of a silent last-write-wins — `FINAL_PLAN.md` §11's "two admins decide the same thing" risk.

**Review Queue** (absorbs the Evaluator App's Review Inbox, `EVALUATOR_APP_PLAN.md` §4): four sections — disputes, late saves, overdue, unplaced — each row jumps the grid to that cell on click. "Unplaced" is the literal implementation of the zero-data-loss counter: every `EvaluationSubmission` with `outcome = "applied"` must resolve to exactly one placed cell; anything that doesn't (a scope/schedule mismatch surfacing after the matrix changed, per risk P4 in `EVALUATOR_APP_PLAN.md`) shows up here instead of vanishing.

---

## 6. Live updates

- Only the **changed cells** refetch on a 15-second interval (a small "what changed since cursor X" endpoint, not a full grid reload) — matching `FINAL_PLAN.md` §5.3.
- A full safety refresh runs periodically underneath (catches anything the incremental cursor missed) — cheap because it's a diff against the client's cached grid, not a re-render from scratch.
- TanStack Query owns the cache; the incremental endpoint's response is a set of cell patches applied directly, not a query invalidation storm.

---

## 7. Exports

- **Excel**: 3-level merged headers (hospital → week → day) identical to the rotation view, via `exceljs` (already a dependency). Cells are plain strings; CSV-injection characters (`= + - @`) are escaped at the start of any cell, matching `EVALUATOR_APP_PLAN.md` §7's rule — the same rule applies here since this is the same class of export.
- **Print per group**: a simplified single-group table (one band from the main grid), CSS print styles, no Excel dependency needed for this path.
- Both come from the same grid-building function (`buildGradeGrid`) that renders the screen — never a second, hand-maintained export query that can drift from what's displayed.

---

## 8. Close course

1. Checks: 0 missing (within window), 0 disputed, 0 pending late-saves, 0 unplaced.
2. If all clear: `Course.status → ARCHIVED` (reusing the status enum from `COURSE_SETUP_PLAN.md` §8), every `Evaluation` in the course locked at the course scope.
3. Writes a `CourseSnapshot`: a checksum (hash of every evaluation's id + total + status, sorted) so a later integrity check can detect any change to "closed" data — closing a course is supposed to be the last write it ever gets.
4. Any of the four checks failing blocks the close with a specific, actionable message (not just "can't close") — the same items the Review Queue already tracks.

---

## 9. Data model (additive; nothing from Goals 1–2 is removed)

Reuses, unchanged: `Evaluation`, `EvaluationScore`, `EvaluationSubmission`, `EvaluationConflict`, `EvaluationClaim`, `Flag`, `AuditLog`, `Course` (all already in schema after E1/S1).

```prisma
// Grade policy is versioned from day one (§0's provisional-formula answer)
// so swapping in the real formula later is a new version, never a
// silent reinterpretation of a grade a student already received — the
// same principle EvaluationScore already applies to individual rubric
// sections (labelArAtTime/maxScoreAtTime).
model CourseGradePolicy {
  id          String   @id @default(cuid())
  courseId    String
  course      Course   @relation(fields: [courseId], references: [id])
  version     Int
  formula     String   // "simple_average" for now; versioned so a future
                        // real formula is a new row, not an edit to this one
  isFinal     Boolean  @default(false) // false = shown as "مبدئي" everywhere
  createdAt   DateTime @default(now())

  @@unique([courseId, version])
  @@map("course_grade_policies")
}

// Rubric versioning (EVALUATOR_APP_PLAN.md §3 already calls for
// Evaluation.rubricVersion; this is the table that number points at).
// A rubric edit only affects courses published after the edit — a phone
// that imported course bundle v3 keeps grading against rubric v3 even if
// the admin tweaks wording mid-course.
model RubricVersion {
  id         String   @id @default(cuid())
  version    Int      @unique
  publishedAt DateTime @default(now())
  sections   RubricSection[]

  @@map("rubric_versions")
}
// RubricSection (existing model) gains an optional rubricVersionId — additive,
// existing rows (the current single unversioned rubric) become version 1.

// One append-only row per admin-visible correction/lock/dispute-approval
// decision that needs a version check (§5) — distinct from AuditLog
// (which is the general "before/after JSON" record for every entity):
// this is specifically what the grid's optimistic-concurrency check reads
// to answer "has this cell changed since the admin opened it."
model GradeDecisionVersion {
  id           String   @id @default(cuid())
  evaluationId String
  version      Int
  updatedAt    DateTime @default(now())

  @@unique([evaluationId, version])
  @@index([evaluationId])
  @@map("grade_decision_versions")
}

// Written once when a course is closed (§8) — a checksum a later
// integrity job can compare against to prove nothing changed after close.
model CourseSnapshot {
  id         String   @id @default(cuid())
  courseId   String
  course     Course   @relation(fields: [courseId], references: [id])
  checksum   String
  evaluationCount Int
  createdAt  DateTime @default(now())

  @@map("course_snapshots")
}
```

**Deferred, not part of this migration:** `FINAL_PLAN.md` §6's `Evaluation`/`EvaluationScore` score columns moving from `Float` to `NUMERIC(5,2)` for exact decimal arithmetic, and the Postgres-level guards (append-only trigger on the journal, no-`DELETE` app role, CHECK constraints, `IntegrityRun`/`BackupRun` heartbeat tables). These are real, valuable hardening steps (`FINAL_PLAN.md` D2/D8) but are infrastructure-wide, not specific to the Grading Center screen — tracked here as follow-up work for whoever picks up `FINAL_PLAN.md` D2/D8 directly, so this plan's own build order (§14) isn't blocked waiting on a full precision migration.

---

## 10. API: one versioned JSON path (`/api/gc/v1/*`, matching the evaluator app's own `/api/ev/v1/*` pattern)

| Method + path | Purpose |
|---|---|
| `GET  /api/gc/v1/grid?courseId=&view=rotation\|calendar&cursor=` | The grid data: student rows (banded by group), column definitions, cell states. `cursor` supports the incremental refresh (§6). |
| `GET  /api/gc/v1/cell?evaluationId=` | Full popover detail for one cell, including competing submissions if disputed. |
| `POST /api/gc/v1/actions/approve-dispute` | `{ conflictId, chosenSubmissionId, note? }` → resolves the conflict (§5) |
| `POST /api/gc/v1/actions/late` | `{ submissionId, decision: "accept" \| "reject" }` |
| `POST /api/gc/v1/actions/correct` | `{ evaluationId, reason, ...newValues }` — version-checked (§5) |
| `POST /api/gc/v1/actions/lock` · `POST /api/gc/v1/actions/unlock` | `{ scope: "cell" \| "group_day" \| "group_week" \| "stint" \| "course", ...scopeIds }` |
| `GET  /api/gc/v1/review-queue?courseId=` | Disputes, late-saves, overdue, unplaced — for the Review Queue panel |
| `GET  /api/gc/v1/export?courseId=&format=xlsx\|print&groupId=` | The Excel/print builder, same function as the grid renderer (§7) |
| `POST /api/gc/v1/courses/:id/close` | Runs the §8 checks; closes or returns which check(s) failed |

Every POST requires `requireRole("ADMIN")`, a matching `Origin` header (the evaluator app's CSRF rule applies equally here), and a JSON body.

---

## 11. Engine: pure functions

The two views (§2), the export builder (§7), and the read API (§10) all call **one** function:

```ts
function buildGradeGrid(input: {
  course: CourseWithMatrix;      // from Course Setup's published matrix
  students: StudentWithGroup[];
  evaluations: EvaluationWithScores[];
  conflicts: EvaluationConflict[];
  view: "rotation" | "calendar";
}): GradeGrid   // { columns, rows, summary } — pure, no DB access inside
```

`cellState(evaluation, submission, conflict, today, gradePolicy): CellState` is the per-cell classifier (§3's table, as code) — also pure, also unit-testable in isolation, matching the pattern already established in `src/lib/courseSetup/` and `src/lib/evaluator/validation.ts`: business rules that don't need a database live as small, directly-tested functions; only the thin model layer around them touches Prisma.

**Property tests** (`fast-check`, per `FINAL_PLAN.md` §7): generate random combinations of evaluations/conflicts/schedules and assert the invariant that matters most — every evaluation is placed in exactly one cell, and placed + unplaced always equals the total evaluation count for the course.

---

## 12. Design system

Inherits `FINAL_PLAN.md` §8 in full: navy `#1a5276` single accent, cohort colors (Morning `#2980b9` / Evening `#8e44ad`), status colors (present `#27ae60` / absent `#c0392b` / warning `#e67e22`), Cairo type at the compact scale, Phosphor line icons, `cubic-bezier(.22,1,.36,1)` easing at 150–250ms. Admin-specific from §8: dense grids, pinned headers, list dividers (no nested cards), a confirmation dialog for every decision (§5).

The score-band tint (§0.6) is a **third** signal layered under color-coded status and icon+text — never the only way a state is communicated.

---

## 13. Risk register

| # | Risk | Answer |
|---|---|---|
| G1 | Matrix edited after grading hides existing grades | Evaluations keep their own placement independent of the live matrix; a mismatch surfaces in the Unplaced tray (§5) instead of the grade disappearing |
| G2 | Live updates miss a change between polls | Incremental cursor + a periodic full safety refresh underneath (§6) |
| G3 | Two admins act on the same cell at once | Version check on every action → `409` "changed since you opened it" (§5) |
| G4 | Export drifts from what the grid actually shows | One `buildGradeGrid` function feeds the screen, the Excel export, and print (§7, §11) |
| G5 | A grade is silently lost between "evaluated" and "shows up on the grid" | The placed+unplaced invariant is enforced by property tests (§11) and made visible in the Review Queue (§5), not just asserted in code |
| G6 | Admin correction overwrites history | Corrections write a new `EvaluationSubmission` row (`source: "admin_correction"`), never an in-place update (§5) |
| G7 | Course closes with disputes/late-saves/missing items still open | The four §8 checks block close and say specifically what's outstanding |
| G8 | Closed course data changes after close | `CourseSnapshot` checksum (§8, §9) for a later integrity check to compare against |
| G9 | Grade formula changes retroactively reinterpret an old grade | `CourseGradePolicy` is versioned (§9); a formula change is a new version, applied going forward, never rewriting history |
| G10 | Rubric wording/scale change reinterprets an already-graded evaluation | `RubricVersion` (§9) — an evaluation keeps the rubric version it was graded against |

---

## 14. Build order

Cross-referenced against `FINAL_PLAN.md` §9's phase table, whose own step IDs (D5/D7/D8/D9, U4) this plan's G-numbers map onto:

| Step | Deliverable | Verification | FINAL_PLAN.md step |
|---|---|---|---|
| **G-1** | Schema additions (§9: `CourseGradePolicy`, `RubricVersion`, `GradeDecisionVersion`, `CourseSnapshot`) | Migration applies cleanly; existing rubric backfilled as version 1 | D2 (schema), shared with S1/E1 |
| **G-2** | `buildGradeGrid` + `cellState` pure engine (§11), unit + property tested | Placed+unplaced invariant holds under generated inputs | D5 |
| **G-3** | Read API: `/grid`, `/cell`, `/review-queue` (§10) | A seeded course renders correctly via the API alone (no UI yet) | D5 |
| **G-4** | Grid UI: rotation + calendar views, virtualized, pinned headers, keyboard nav (§2, §3) — **on sample data first**, per `FINAL_PLAN.md` Phase 2's no-DB-writes rule | 500×40 scrolls smoothly; 375px and 1440px both work; keyboard-only pass |
| **G-5** | Popover + student sheet + Review Queue UI (§4, §5) — sample data | Disputed cell shows both grades correctly side by side |
| **G-6** | Actions: approve-dispute, accept/reject-late, correct, lock/unlock, all version-checked (§5, §10) — wired to real data | Concurrent same-cell edit → 409; correction preserves history |
| **G-7** | Close-course flow (§8) | Blocks correctly on each of the 4 unmet conditions individually |
| **G-8** | Exports: Excel (merged headers) + print-per-group (§7) | File numbers match the grid, cell by cell |
| **G-9** | Live updates: incremental cursor + safety refresh (§6) | A change made by one admin appears for another within 15s without a full reload |
| **G-10** | Wire everything to real data end-to-end; retire the old `/grading-center` routes with a redirect | Old URLs redirect; nothing orphaned; full acceptance run per `FINAL_PLAN.md` D10 |

**On G-4/G-5's "sample data first" note:** this follows `FINAL_PLAN.md` Phase 2's explicit rule (clickable screens, no database writes, reviewed with the user before Phase 3's engine work) — a deliberate change from how Goals 1 and 2 were built in this repo so far (schema-and-model-first, evolved directly against the live database). Whoever picks up G-4 should confirm with the user whether to follow that mockup-first sequencing strictly, or continue the pragmatic "evolve in place" pattern already used for Course Setup and the Evaluator App sessions work — the two approaches have different review checkpoints and shouldn't be mixed silently mid-build.

---

# Addendum (2026-10-02): the combined UI design

Interactive mockup: https://claude.ai/artifact/SgxBDaHvbaqwrBHgYcPBfV (opens on "التصميم المدمج"; the 5 source designs stay on the same canvas for comparison). It **supersedes Part B's layout details** where they differ.

| Feature | Taken from | What it does |
|---|---|---|
| Program tabs (Morning / Evening) | all | Separate programs, never mixed; switching resets filters and expansions |
| Scope tabs: whole course · period 1 · period 2 · period 3 · course summary | Design 4 | Whole course = 12 day columns; a period = 4 wide columns with the evaluator's name; summary = per-hospital and per-criterion averages |
| Column order: by hospital / by date | Designs 1 + 2 | Hospital → week → day (your table; group row shows real dates) or calendar weeks (header shows real dates; group row shows each group's hospital) |
| Day cells: color by % + number + status tag | Designs 1 + 5 | Sequential navy scale; tags for absent / late / disputed / missing / corrected / below 60% |
| "All criteria" = rows, not columns | Design 3 | Each student expands into 5 criterion rows (per student, or all at once); columns never multiply |
| Criterion row summary | Designs 3 + 2 | Average per criterion with a small bar |
| Student summary columns | Designs 1 + 5 | Average per hospital, trend sparkline, course %, absences |
| Status filter chips + search | new | All · needs attention · disputed · missing · absent · below 60% · late · corrected; matching cells get a navy ring; search by name / university number / code |
| Day popover | shared | Criteria with bars, attendance, evaluator, notes, phone vs server times; dispute comparison with approve buttons |

## Implementation status (2026-10-02): read-only views live

Built on the existing tables (no schema change) and shipped as the default `/grading-center` mode. The older sheet, table and tree stay under `?mode=sheet|table|tree`.

| View (tab) | Source design | What is built |
|---|---|---|
| التصميم المدمج | Combined | Scope: whole course · each period · course summary. Order: by hospital / by date. Totals or all criteria (expandable rows, per student or all). Summary columns, filter chips, search |
| الشبكة الدورانية | Design 1 | Hospital → week at that hospital → day, a per-hospital average column, course % and absences. "All criteria" splits each day into one narrow column per criterion plus the day total (م1…م5 legend) |
| الخريطة الحرارية | Design 5 | Calendar-order compact heat cells with trend and %. "All criteria" = one card per student with a criterion × day mini heatmap |

**Data rules as built**
- Only validated evaluations (`pendingValidation = false`) show grades. A day the evaluator saved but has not validated (اعتماد) shows as **غير معتمد** with no numbers.
- States: ok · late · absent (an evaluation, or an attendance-only absence on a validated work day) · disputed (open `EvaluationConflict`) · awaiting · pending (inside the 7-day window) · missing (window passed) · future · holiday (`CourseHoliday`).
- Disputed days are left out of averages until the admin picks one evaluation. Averages are labeled **مبدئية** (provisional, per §12).
- Scheduled days come from active `RotationBlock`s (`daysOfWeek`, else the term's weekdays). Weeks are Saturday-keyed (Sun–Thu working week).
- Periods exist only when every group's blocks share the same non-overlapping date ranges (2–8 of them). Otherwise the period tabs are hidden.
- Validated evaluations on unscheduled dates are never hidden: a notice lists them.
- Reads of tables added by later migrations (attendance, work days, holidays, conflicts) fall back to "none recorded" instead of failing the page.
- Hospital colors use the validated categorical palette, always next to the hospital name. The cell scale is the app's teal ramp, and every state also carries a word.

**Code:** `src/lib/gradeMatrix/` (pure builders + `build.test.ts`), `src/lib/models/gradeMatrix.ts` (loader), `src/components/gradeMatrix/` (views, popover).

**Not built yet** (still per Part A/B build order): dispute approval and other admin actions (G-6), the review queue, Excel and print exports from these views (G-8), live updates (G-9) and virtualization for very large courses.

## Eva Desktop (2026-10-02, desktop 0.5.0)

The same three views are now the default tab of Eva Desktop's **مركز الدرجات** (tab **مركز التقييم**; **قائمة التقييمات** and **كشف المجموعة** stay beside it).
- The pure rules (`types`, `build`, `visual`) moved to `packages/core/src/gradeMatrix`, shared by the website (`src/lib/gradeMatrix/*` re-export them) and the desktop.
- The desktop loader is `packages/db/src/repo/gradeMatrix.ts` (SQLite). Differences from the website's: the desktop stores one rotation block per week, so back-to-back blocks at one hospital are merged into one stint (this keeps the period tabs per hospital stay); a disputed day is an evaluation with `status = 'DISPUTED'`; weekdays fall back to the course's attendance pattern.
- The views are copied into `apps/desktop/src/components/gradeMatrix` with links to website pages removed; `gm.css` supplies the few tokens and layout utilities the website gets from Tailwind.

## Course matrix, «كشف اليوم» and «ملخص الطالب» (2026-10-06, desktop 0.8.0)

Chosen after comparing several layouts (https://claude.ai/artifact/Q1mQGxwqCAdkEpac49scv7): one row per student and one column per attendance day scales to any course size and any rotation, so it stays the main view.

- **Course matrix** (التصميم المدمج · الدورة كاملة): calendar order by default. Each group's band shows its rotation as hospital-tinted segments («مستشفى … · الدوران n · dates») over the day columns, followed by a «معدل المجموعة» row. «في الخلايا» shows the day's total or one criterion; «الترتيب» orders students as listed, weakest first or by absences. The matrix has no summary columns any more. Day headers open «كشف اليوم» on that day.
- **«كشف اليوم»** (replaces the day board): one day as a table, grouped by hospital then group, with every criterion, the total (opens the day popover), attendance, evaluator and note; sortable columns and a per-group average row.
- **«ملخص الطالب»**: its own option (was «ملخص الدورة»): student names with per-hospital and per-criterion averages, course average and %, absences and trend.
- Pure helpers `criterionDay` and `sortByStats` in `packages/core/src/gradeMatrix/build.ts`; `DaySheet.tsx` in both apps. E2E: `npm run e2e -w @eva/desktop -- daysheet`.
- **«ملف الطالب»** (desktop 0.9.0): every student name in the grid, «كشف اليوم» and «ملخص الطالب» opens a side panel with the student's whole course: average, %, graded days, absences, per-hospital and per-criterion averages, then every scheduled day grouped by rotation with all criteria, total, attendance, evaluator and note. A day's total opens the usual day popover; Esc closes the popover first, then the file. `StudentFile.tsx` in both apps.
