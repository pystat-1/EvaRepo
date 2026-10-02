# Eva: Final Master Plan

> **Status:** FINAL master plan, consolidating every planning session up to 2026-09-28. §12's open questions are resolved (below). Note: `COURSE_SETUP_PLAN.md` S1–S2 and `EVALUATOR_APP_PLAN.md` E1–E2 were already implemented and deployed before this file's decisions (esp. §12) were confirmed — evolved directly against the live schema/DB rather than through this file's Phase-2-mockups-first sequencing. Nothing has been redone to match; anyone picking up further Goal 1/2 work, or `GRADING_CENTER_PLAN.md`'s G-4/G-5, should decide per-step whether to follow this file's phasing or continue that pragmatic pattern (see `docs/GRADING_CENTER_PLAN.md` §14's note).
> **Rule:** where this file and an older plan disagree, **this file wins**. The detailed specs stay in the goal documents listed in §13.
> **Owner:** Ammar (College of Nursing, University of Baghdad) · **Repo:** `pystat-1/EvaRepo`

---

## 1. The product

**Eva** is an Arabic, right-to-left web app for the nursing college's **clinical training evaluation**:

- Students are organized in **courses → shifts (Morning / Evening) → groups**.
- Each group **rotates through hospitals** on fixed weekdays, following a published **rotation matrix**.
- At each hospital, **several evaluators** record each student's daily **attendance and rubric scores** on their phones, even with no internet.
- The **admin** sees every grade live in the **Grading Center**, resolves disputes, locks results and closes the course.
- **Students** see only their own approved grades.

**The one promise:** a grade that has been entered is never lost, never overwritten without a trace, and never attached to the wrong student.

### Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | Zero grade loss | Every save is journaled; nothing is deleted; nightly integrity check passes; off-site backups exist and are restore-tested |
| G2 | Correct identity | Student = university number; imports never create duplicates |
| G3 | Right person, right scope | Evaluators grade only their hospital/group on scheduled days; students see only themselves; all enforced on the server |
| G4 | Works in the hospital | Import the course once; grade fully offline; automatic sync; installable on the phone |
| G5 | Full admin visibility | One Grading Center grid for the whole course, with a detail popover, review queue and Excel export |
| G6 | Configurable, no code changes | Courses, shifts, hospitals, evaluators, groups, calendar, rotation, rubric and grade policy are all data |
| G7 | Accountable | Every change and decision is audited: who, when, before, after |

## 2. Users

| Role | Uses | Can | Cannot |
|---|---|---|---|
| **Admin** | Desktop admin panel | Set up courses, publish the matrix, see and export all grades, resolve disputes, accept late saves, correct (with reason), lock, close courses | — |
| **Evaluator** | Phone app (PWA) | Import the course schedule, take students, grade offline, edit own grades until locked, export own day to Excel | See colleagues' grades; grade outside scope or schedule; edit locked grades |
| **Student** | Web portal | See own approved grades, feedback and flags | See anyone else; change anything |

Accounts are created by the admin only. Login is by email + password, or Google Sign-In linked to an existing account.

---

## 3. Decisions (confirmed)

| Topic | Decision | Source |
|---|---|---|
| Delivery | 4 phases: Planning → simple UI → Database + data engine → Deployment | User |
| Study type | **Study type = shift: Morning (M) / Evening (E)** | User |
| Course Setup | One tab, 8-step wizard → complete matrix, the base for everything | User |
| Matrix design | **D3 + D10** (pivot grid + inspector + conflict list) to work in; **D6** (compact code matrix) to print; **D1** (group × week) as each group's announced schedule | User ("go with recommendations") |
| Evaluators per hospital | Several; each can import the same group | User |
| Shared view | Shows **only which student is taken by which evaluator**; never grades | User |
| Two evaluators grade one student-day | **Both kept**, day marked **DISPUTED**, flag to both evaluators + admin; **admin approves one** | User |
| Late window | **7 days** after the evaluation date (Baghdad time), **with reminders**; after that the save is stored and the admin may accept it | User |
| Editing | Evaluator edits own grade **until the admin locks it** | User |
| Grading Center | **Rebuilt from scratch**, not limited by v3; students × Hospital → Week → Day; cell = day total; click → popover with criteria | User |
| Tools | **Free / open-source only** | User |
| Implement | Plan first; build only after approval of this file | User |

**Defaults adopted** (change any of them by telling me):

| Topic | Default |
|---|---|
| Where to build | Evolve the current repo (v3 code as the base, tagged `v3-final` first); the Grading Center and evaluator app screens are new code |
| Stack | Keep Next.js 16 + TypeScript + Prisma + Neon Postgres |
| Rotation cells | 1-week cells; stints can span several weeks; repeat visits get "visit 2" |
| Attendance days | Set per shift in the course calendar |
| Students | Attached to groups in wizard step 6 |
| Online take | A taken student can't be opened by a colleague; take-over only before the first save, with a reason |
| Disputed grades | Frozen and excluded from statistics and flags until the admin decides |
| Evaluator Excel | Own evaluations only (the shared view has no grades) |
| Admin correction | Allowed, with a mandatory reason and full history |
| Per-hospital summary | Average of daily totals |
| Font / icons | **Cairo** (from your Daily Evaluation design system) · **Phosphor** line icons (the design skills ban emoji; your old app used emoji) |

---

## 4. System overview

```
┌──────────────── Admin panel (desktop) ────────────────┐   ┌──── Evaluator app (phone PWA) ────┐
│ Course Setup wizard → Matrix → Publish → Announce     │   │ Today · Roster · Grade · Shared   │
│ Grading Center grid → Popover → Review Queue → Close  │   │ Schedule · Sync   (works offline) │
│ Data management · Audit · Integrity & backups         │   │ IndexedDB per account + outbox    │
└──────────────┬────────────────────────────────────────┘   └───────────────┬───────────────────┘
               │ /api/gc/v1/*  (admin JSON API)                             │ /api/ev/v1/* (evaluator JSON API)
┌──────────────▼────────────────────────────────────────────────────────────▼───────────────────┐
│ Server (Next.js route handlers): session → scope → validation → state rules → ONE transaction │
│ (journal + evaluation + scores + conflict + audit) → flags → change sequence                  │
└──────────────┬────────────────────────────────────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────┐   nightly   ┌──────────────────────┐
│ Neon Postgres (28 tables)   │ ──────────► │ Cloudflare R2 backup │  + monthly restore drill
│ restricted role · triggers  │  pg_dump    │ + course snapshots   │
└─────────────────────────────┘             └──────────────────────┘
Student portal (/me): read-only, ACTIVE (approved) grades only.
```

---

## 5. Modules

### 5.1 Course Setup (Goal 1): detail in `COURSE_SETUP_PLAN.md`

**One tab, "إعداد الدورة" (Course Setup), with 8 steps.** Each step saves as a draft, shows ✔ or ⚠, and can be reopened.

1. **Year**
2. **Course** (1st / 2nd of the year; opens a draft)
3. **Shifts**: Morning / Evening (= study type)
4. **Hospitals**, with optional capacity
5. **Evaluators ↔ hospitals** (several evaluators per hospital; optional group scope)
6. **Groups**, with students attached (CSV or pick)
7. **Calendar**: start date, number of weeks, attendance weekdays per shift, holidays
8. **Rotation**: auto-generated so each group visits each hospital (Latin square, respects capacity), then hand-adjusted

**Matrix (D3 + D10):**
- One grid with a **By group / By hospital / By evaluator** toggle; weeks are the columns.
- An **inspector** for the selected cell and a live **conflict list**, for example: group without a hospital, hospital over capacity, hospital without an evaluator, evaluator double-booked.

**Publish:**
- A course moves `DRAFT → PUBLISHED → ARCHIVED`, and every publish increases the schedule version.
- Evaluators only see published courses. Weeks that already have grades can't be changed.

**Announced schedule:** per group, with week, dates, hospital and evaluator (D1), plus the whole-course print (D6). Both can be printed or downloaded as PDF/Excel.

### 5.2 Evaluator App (Goal 2): detail in `EVALUATOR_APP_PLAN.md`

- **Offline-first shell `/e`**, installable (PWA), with 4 tabs: **اليوم** (Today) · **مشترك** (Shared) · **جدولي** (My schedule) · **المزامنة** (Sync).
- **Import the course once:** stints from the matrix, attendance dates, rosters (name, university number, group) and the rubric version. It refreshes itself when online.
- **Take → grade → save.** Drafts autosave. Every save gets a one-time key, so a retry is never counted twice.
- **Shared view:** `متاح` (available) · `مأخوذ لدى د. X` (taken by Dr. X) · `⚠ تعارض` (conflict). **No grades of colleagues ever reach the phone.**
- **Server checks on every save** (online and offline identical):
  - session valid and account active
  - idempotency
  - scope + published schedule + not a holiday
  - 7-day window
  - finite scores in 0.5 steps, every criterion present, absent = 0
  - ownership / lock / dispute state
  - one transaction
- **Reminders:** in-app, app-icon badge, and Web Push (free VAPID keys; notifications never show student names), on day 0/3/5/6.
- **Excel:** online (from the server) or offline (built on the phone). Unsynced rows are marked, so the file doubles as a backup.
- **Security:** server-side sessions (14-day sliding, revocable), one local database per account, logout wipes only after sync.

### 5.3 Grading Center (Goal 3): detail in `GRADING_CENTER_PLAN.md`

- **Rotation view** (your table design):
  - **Columns:** Hospital → Week of the stint → Attendance day, with per-hospital summary columns and a course total.
  - **Rows:** students **banded by group**, and each band header shows that group's **real dates**.
  - **Hospitals collapse** to their summary columns; the student column and header rows stay pinned.
- **Calendar view:** real dates as columns.
- **Cell states** (icon + text): evaluated · absent · late · missing (days left) · overdue · disputed · late-save waiting · corrected · locked · future · holiday · not scheduled.
- **Popover** (shadcn/ui on Base UI; click or Enter):
  - date, hospital, group, week, day
  - every criterion as score / max, the total and %
  - attendance, evaluator, notes and feedback, device time vs received time
  - disputed cells show both grades side by side
- **Actions:** approve dispute, accept or reject late, correct, lock or unlock (cell / group-day / group-week / stint / course).
  - They are never done inside the popover. Each opens a confirmation dialog, with a reason where needed.
  - Each action carries a version check, so two admins can't overwrite each other.
- **Review Queue:** disputes, late saves, overdue, unplaced. Clicking an item jumps to its cell.
- **Live updates:** only the changed cells refresh, every 15 s, plus a full safety refresh.
- **Exports:** Excel with 3-level merged headers, identical to the screen, and print per group. All come from the same builder function.
- **Close course:** checks there is 0 missing, 0 disputed and 0 pending → locks the course → stores a checksummed snapshot.

### 5.4 Student portal

Keeps `/me`. It shows only **ACTIVE** (approved) evaluations, feedback and flags, never disputed or unapproved data.

### 5.5 Shared admin services

- Review Inbox (merged into the Grading Center's Review Queue)
- Audit log
- Evaluator device sessions (revoke)
- Integrity and backup panel
- Data management pages (the old separate tabs, kept for editing only)

---

## 6. Database: detail in `DATABASE_DESIGN.md`

Interactive map: https://claude.ai/artifact/CS3HFH23NKoKt58aFkJTP8

- **28 tables in 5 areas, 52 relationships.** 13 tables exist in v3 (7 gain columns), and 15 are new.

| Area | Tables |
|---|---|
| Course & schedule | Course, StudyType (= shift), CourseStudyType, Hospital, CourseHospital, Group, Student, CourseAttendancePattern, CourseHoliday, RotationBlock |
| People & access | Account, Session, EvaluatorAssignment, PushSubscription, ReminderLog |
| Evaluation engine | **Evaluation**, EvaluationScore, EvaluationSubmission (journal), EvaluationConflict, EvaluationClaim, Flag |
| Rubric & grade policy | RubricVersion, RubricSection, CourseGradePolicy |
| Safety & audit | AuditLog, CourseSnapshot, IntegrityRun, BackupRun |

**Guards enforced by Postgres itself:**
- one grade per student per day
- a unique save key
- the journal is append-only (trigger)
- the app role has **no DELETE** on grades
- scores are `NUMERIC(5,2)`
- CHECK constraints on scores, attendance and statuses
- a change sequence
- nightly integrity + backup heartbeat

---

## 7. Technology (all free)

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router, route handlers), TypeScript, Tailwind v4. *Read `node_modules/next/dist/docs/` before coding (AGENTS.md).* |
| Database | Neon Postgres (free: 0.5 GB, 6-hour restore window) + Prisma (Neon driver adapter) |
| Grid | TanStack Table v8 + TanStack Virtual (rows, RTL) + TanStack Query v5 |
| UI parts | shadcn/ui on Base UI (Popover, Dialog, Sheet), Phosphor icons, Cairo font (self-hosted for offline) |
| Offline | Service worker (hand-written, versioned), IndexedDB via `idb`, Web Locks, Background Sync where available |
| Push | Web Push with VAPID keys from a Cloudflare Cron Trigger (a WebCrypto-based library; fallback: in-app + badge) |
| Files | exceljs (already installed) for Excel; CSS print for PDF |
| Backups | GitHub Actions nightly `pg_dump` → encrypted → Cloudflare R2 (10 GB free), 30 daily + 12 monthly, monthly restore drill |
| Tests | Vitest + fast-check (property tests) + Playwright (offline, RTL, keyboard, races) |
| Hosting | **Cloudflare Workers via OpenNext** (the repo's current target: `wrangler.jsonc`); confirm in Phase 4 |

---

## 8. Design system

Based on your **Daily Evaluation Design System**, adapted by the three design skills:

- **Color:**
  - Navy `#1a5276` is the single accent. Cohort colors: Morning blue `#2980b9`, Evening purple `#8e44ad`.
  - Status colors: present green `#27ae60`, absent red `#c0392b`, warning orange `#e67e22`.
  - Ink `#2c3e50` on `#f5f6fa`; hairline `#e2e6ea`. A dark theme is derived from it.
  - Every status is shown with **icon + text**, never color alone, at contrast ≥ 4.5:1.
- **Type:** Cairo, compact scale (28 / 22 / 17 / 15 / 14 / 13 / 12), tabular numerals for scores.
- **Admin:** dense grids, pinned headers, lists with dividers, no nested cards, confirmation dialogs for every decision.
- **Evaluator phone:**
  - light theme; 48 px touch targets; the main action in the thumb zone
  - chips (0, ½, 1) and −/+ steppers for scores; Save moves to the next student
  - minimal motion, full reduced-motion support
- **Signature easing** `cubic-bezier(.22,1,.36,1)`, 150–250 ms.

---

## 9. Roadmap: the 4 phases

Each step ends with type-check, lint, tests passing, a commit, and an update to `docs/MEMORY.md`. The IDs in brackets point to the detailed steps in the goal documents.

### Phase 1: Planning ✅ (this file)
Done: goals, roles, workflows, three goal plans with attack findings, the database design, and this master plan. **Exit:** you approve this file — done 2026-09-28, all six §12 questions resolved (`docs/GRADING_CENTER_PLAN.md` §0 has the detail). `docs/MEMORY.md`, `docs/PHASE_1_PLAN.md` and `docs/DATABASE_DESIGN.md` are still referenced in §13 but not yet written — not blocking, since this file and the three goal plans are self-contained.

### Phase 2: Simple UI (clickable screens, mock data, no database writes)

| Step | Deliverable | Verification |
|---|---|---|
| **U1** | Tag `v3-final`; design tokens (§8), Cairo self-hosted, Phosphor, shadcn/ui on Base UI set up, RTL base layout | Renders at 375 px and 1440 px, both themes |
| **U2** | New admin shell and navigation: **إعداد الدورة** (Course Setup) · **مركز التقييم** (Grading Center) · **المراجعة** (Review) · **إدارة البيانات** (Data management) · **السجل** (Log) | Keyboard and RTL check |
| **U3** | Course Setup wizard (8 steps) + matrix D3+D10 + print D6 + group schedule D1, on sample data [S2–S5 UI] | Click through a full sample course |
| **U4** | Grading Center grid (rotation + calendar views) + popover + student sheet + Review Queue + action dialogs, on sample data [G-4, G-5 UI] | 500 students × 40 day-columns scroll smoothly |
| **U5** | Evaluator app screens: Today, Roster, Grade, Shared, Schedule, Sync, install guide, on sample data [E6] | Phone check at 375 px, one-handed use |
| **U6** | **Review with you**, then adjust | Your approval of the screens |

### Phase 3: Database + data engine (the most important phase)

| Step | Deliverable | Verification |
|---|---|---|
| **D1** | Foundations: `todayBaghdad()` everywhere; score validation fix (NaN, 0.5 steps, all criteria); server sessions + active-account check + revoke [E1, E2] | Deactivated account → refused at once |
| **D2** | **Schema migration** to the 28-table design (additive); float → `NUMERIC(5,2)` with a before/after sum check; restricted app role; append-only trigger; CHECK constraints [S1, E1, G-1] | Migration rehearsed on a Neon branch copy; sums identical |
| **D3** | **Course Setup engine:** wizard persistence, rotation generator, conflict checker, attendance-date expander, publish + versions, announced schedule [S1, S5, S6] | Property tests on generator and conflicts |
| **D4** | **Evaluation write path:** `/api/ev/v1/submissions` (idempotency, window, ownership, locks, disputes), claims + take-over, shared view (names only), attention list [E3, E4] | Concurrent A/B → DISPUTED, both stored; retry → duplicate; no cross-hospital leak |
| **D5** | **Grading Center engine:** `buildGradeGrid` + `cellState` (pure, one builder for all outputs), read API, change feed, actions with version checks, Review Queue, admin correction [G-2, G-3, G-6, G-7, E5] | Every evaluation placed exactly once; two-admin race → 409 |
| **D6** | **Evaluator offline layer:** course bundle + version, IndexedDB per account, outbox, sync runner (Web Locks, 401 handling), versioned service worker, `storage.persist()` [E6 data, E7] | Playwright offline: cold start offline → grade 3 → reconnect → all applied |
| **D7** | **Reminders + exports:** push/badge/in-app reminders with ReminderLog; evaluator Excel (server + phone); Grading Center Excel (merged headers) + print [E8, E9, G-8] | File numbers equal the grid, cell by cell |
| **D8** | **Integrity + backups:** nightly IntegrityRun, GitHub Actions pg_dump → R2 with BackupRun heartbeat, restore-drill script, admin panel [G-9] | Break a total on purpose → panel red; restore drill passes |
| **D9** | **Wire the Phase-2 screens to real data**; close-course + snapshot + grade policy; retire the old tabs and routes (`/setup`, `/master`, old grading center, `/my`, `/schedule`, `/grade`) [S7, S8, E10, G-10] | Old URLs redirect; nothing orphaned |
| **D10** | **Acceptance run:** a full simulated course: setup → publish → 2 evaluators offline → dispute → admin approves → late save accepted → lock → close → snapshot checksum verifies | Integrity check green at the end |

### Phase 4: Deployment

| Step | Deliverable |
|---|---|
| **P1** | Confirm the single hosting target (Cloudflare Workers + OpenNext, as the repo is set up now); remove the stale Netlify workflow `.github/workflows/deploy.yml`; record the live URL in memory |
| **P2** | Environments: production + staging (a Neon branch); secrets in the host's settings; migrations run by CI with the owner role; the app uses the restricted role |
| **P3** | CI on every push: type-check, lint, unit + property tests, Playwright; deploy only when green |
| **P4** | Turn on the nightly backups and integrity job; alerts on failure; first restore drill on production data |
| **P5** | Add the production Google OAuth redirect URI (known open issue from v3) |
| **P6** | **Pilot:** one hospital, one group, 1–2 weeks; evaluators install the PWA; daily integrity review |
| **P7** | **Data from v3:** migrate production data (with count and sum reconciliation) or start clean; your choice (§12) |
| **P8** | Full rollout + runbook: restore a backup, revoke a lost phone, resolve disputes, close a course |

---

## 10. Zero-data-loss strategy (all layers together)

1. **Phone:** drafts autosave; outbox kept until the server confirms; per-account storage; persistent storage requested; offline Excel as a manual backup.
2. **Network:** one-time key per save, so retries are harmless; one versioned API instead of deploy-sensitive Server Actions.
3. **Server:** every attempt goes to the journal first; validation; ownership rules; one transaction.
4. **Database:** unique student-day; append-only journal; no DELETE for the app; exact decimals; CHECKs; change sequence.
5. **Admin:** version checks on every decision; every decision audited; nothing hidden (the "Unplaced" tray and placed + unplaced = total counter).
6. **Operations:** nightly integrity check; nightly off-site backups; monthly restore drill; checksummed course snapshots; alerts when anything fails.

---

## 11. Top risks and their answers

Full lists: `EVALUATOR_APP_PLAN.md` §10 and `GRADING_CENTER_PLAN.md` Part G.

| Risk | Answer |
|---|---|
| v3 offline grading breaks when navigating offline; replays break after deploys; the outbox isn't per account | New `/e` shell, versioned API, per-account storage (D6) |
| v3 lets a second evaluator silently overwrite the first | Journal + DISPUTED + admin decision (D4) |
| v3 accepts any date and non-numeric scores; "today" is computed in UTC | 7-day Baghdad window, strict validation, one date helper (D1, D4) |
| Matrix edited after grading hides grades | Evaluations keep their own placement; Unplaced tray; graded weeks locked (D3, D5) |
| Live updates miss a change | Overlap cursor + version merge + periodic full refresh (D5) |
| Two admins decide the same thing | Version check → "changed since you opened it" (D5) |
| Backups fail silently (already happened in v3) | Heartbeat + red panel + alert + restore drill (D8, P4) |
| Neon free tier limits (0.5 GB, 6-hour restore window) | Small data volume; off-site backups; upgrade only if needed |
| Lost evaluator phone | Minimal data on the phone; revoke its session; no names in notifications |
| The final grade formula is still unknown | Versioned grade policy; final column shown as "provisional" until you decide |

---

## 12. Open questions — resolved 2026-09-28

All six answered; full detail in `docs/GRADING_CENTER_PLAN.md` §0.

1. **Final grade formula:** provisional simple average for now, labeled "مبدئي" everywhere, versioned (`CourseGradePolicy`) so the real formula can replace it later without touching history.
2. **Data from v3:** **start clean** — existing production data is left in place but not carried into the rebuilt schema.
3. **Hosting:** **Cloudflare Workers only**, confirmed.
4. **Google Sign-In:** **kept.**
5. **Icons:** **Phosphor** line icons.
6. **Cell colors:** **subtle tint by score band**, layered under the mandatory icon+text status.

---

## 13. Document map

| File | Role |
|---|---|
| `docs/FINAL_PLAN.md` | **This master plan** (wins on conflicts) |
| `docs/MEMORY.md` | Session memory hub: current state, facts, decisions log |
| `docs/PHASE_1_PLAN.md` | Original Phase 1 analysis: goals, roles, workflows, v3 lessons |
| `docs/COURSE_SETUP_PLAN.md` | Goal 1 spec: wizard, 10 matrix designs, conflict checks, publish (S1–S9) |
| `docs/EVALUATOR_APP_PLAN.md` | Goal 2 spec: rulebook, API, offline, reminders, design, risks (E1–E10) |
| `docs/GRADING_CENTER_PLAN.md` | Goal 3 spec: grid, popover, engine, tools, instructions, risks (G-1…G-10) |
| `docs/DATABASE_DESIGN.md` | Target schema: 28 tables, ER diagram, guards |
| `PROJECT_GOALS.md` | v3 history (legacy, reference only) |

## 14. Working rules for whoever builds this

- Read `docs/MEMORY.md` and this file first. Read the Next.js 16 guides in `node_modules/next/dist/docs/` before writing code (AGENTS.md).
- Work on the assigned branch. One step per commit series. Validate (type-check, lint, tests) before every push.
- Never weaken a guard in §10 to make something pass. Never delete grade data. Never skip or disable a test.
- After each step: update `docs/MEMORY.md` (state + decisions) in place, with no repeated log entries.
- Any change to a confirmed decision in §3 needs your approval first.
