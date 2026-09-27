# Big Goal 2: Evaluator App (Shared Evaluations, Offline, PWA)

> **Status:** PLAN, waiting for approval
> **Date:** 2026-09-27
> **Depends on:** Big Goal 1 (`COURSE_SETUP_PLAN.md`), because the matrix is the schedule the evaluator app imports. The engine below works on today's `RotationBlock` data, so it can be built in parallel and picks up `courseId`/holidays when Goal 1 lands.
> **Structure:** Part A analysis → Part B plan → Part C attack (mistakes and vulnerabilities found) → Part D fixes folded into the final design → Part E build order.

---

# Part A: Analysis of the idea

## A.1 What you asked for, restated

| # | Requirement | Meaning |
|---|---|---|
| R1 | **Shared evaluations** | A hospital has several evaluators. All of them can import the same group. When one of them *takes* a student, the others see that this student is being evaluated or has been evaluated by that evaluator. |
| R2 | **Import group from the matrix** | The evaluator does not search for students. The app shows the groups the matrix schedules them for on that date, and they import the roster in one tap. |
| R3 | **Linked to the evaluator account, never lost** | Every evaluation carries the evaluator's identity permanently. No save is ever silently dropped or overwritten. |
| R4 | **Day export to Excel** | Download the day's evaluations as an `.xlsx` file. |
| R5 | **Import the whole course schedule once** | One import at the start of the course gives the phone everything it needs for the entire course. |
| R6 | **Offline evaluation** | Grade with no signal. Grades sync automatically later. |
| R7 | **Installable PWA** | Installed on the evaluator's phone like an app. |
| R8 | **Feeds the Grading Center** | Every evaluation lands in the same tables the (future, rebuilt) Grading Center reads. |
| R9 | **Simple and effective UI** | Designed with ui-ux-pro-max, design-taste-frontend-v1 and impeccable. |

## A.2 What already exists in v3 (read from the code)

| Capability | Where | State |
|---|---|---|
| Scoped roster, today only | `/my`, `getScopedStudents` | Works; flat list with no "who is grading whom" |
| Schedule list + roster per stint | `/schedule`, `getEvaluatorSchedule` | Works |
| Grade form, online then offline fallback | `grade/[studentId]/page.tsx` | Works online; offline only if the page is already open (see C1) |
| Offline bundle (schedule, rosters, rubric, today's evaluations) | `/api/schedule/offline-bundle`, `lib/offline/db.ts` | Works, but holds today only and is not tied to an account |
| Outbox + replay through a Server Action | `lib/offline/sync.ts` | Works, with serious gaps (C2, C3, C8) |
| Excel export of the day | `/api/my/export` | Online only |
| PWA manifest + service worker | `manifest.ts`, `public/sw.js` | Installable; caches static assets only |
| One evaluation per student per day | `Evaluation @@unique([studentId, dateISO])` | Yes, but a second evaluator **silently overwrites** the first (C4) |

**Conclusion:** the pieces exist but they are not trustworthy enough for "never lose a grade", and shared evaluation does not exist. The plan below reuses the good parts (IndexedDB layer, `upsertEvaluation` transaction, scope checks, `exceljs`) and replaces the fragile ones.

---

# Part B: The plan

## B.1 Core concept: who owns an evaluation

For **one student on one day** there is exactly **one owning evaluator**:

1. Evaluator A taps a free student → A **takes** them. The student now shows "قيد التقييم لدى A" (being evaluated by A) to everyone.
2. A saves → the student shows "قيّمه A ✓ 13.5/15" (evaluated by A) to everyone in the shared view.
3. Evaluator B sees this, can open A's evaluation **read-only**, and cannot overwrite it.
4. If A leaves without finishing, B can **take over** (confirmation plus a reason). This is audited, and A is informed.
5. If both graded the same student while offline and could not see each other, **both submissions are kept**. The first one to reach the server becomes the evaluation, and the second is stored as a **conflict** for the admin to resolve in the Grading Center. Nothing is thrown away.

## B.2 Data model changes (additive migration)

```prisma
// Every save from every device, append-only. Never updated, never deleted.
// This is the "never lost" guarantee: even rejected or conflicting saves live here.
model EvaluationSubmission {
  id                 String   @id @default(cuid())
  clientSubmissionId String   @unique        // idempotency key generated on the phone
  studentId          String
  dateISO            String
  evaluatorId        String                  // from the server session, never from the client
  sessionId          String?
  payload            Json                    // attendance, scores, notes, feedback, rubricVersion
  deviceTime         DateTime                // phone clock at save time
  receivedAt         DateTime @default(now())
  source             String                  // "online" | "offline_sync"
  appVersion         String?
  outcome            String                  // "applied" | "duplicate" | "conflict" | "rejected"
  reason             String?
  evaluationId       String?                 // the Evaluation it was applied to / conflicts with
  @@index([studentId, dateISO])
  @@index([evaluatorId, receivedAt])
  @@index([outcome])
}

// Who is currently evaluating whom (advisory lock + shared view).
model EvaluationClaim {
  id           String   @id @default(cuid())
  studentId    String
  dateISO      String
  evaluatorId  String
  status       String   // "active" | "released" | "completed" | "taken_over"
  claimedAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([studentId, dateISO])            // one claim per student-day; history lives in AuditLog
}

// Server-side sessions: instant revoke, account-active check, long offline-friendly life.
model Session {
  id          String    @id @default(cuid())
  accountId   String
  deviceLabel String?
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  expiresAt   DateTime
  revokedAt   DateTime?
  @@index([accountId])
}

model Evaluation {            // + new fields, existing unique key unchanged
  courseId         String?
  rubricVersion    Int?
  lastSubmissionId String?
  syncedLate       Boolean  @default(false)   // arrived more than 24h after deviceTime
}
```

## B.3 One write path: versioned JSON API (replaces the Server Action)

All evaluator reads and writes go through `/api/ev/v1/*`. Online saves and offline replays use **the same endpoint**, so there is one code path to secure and test.

| Method + path | Purpose |
|---|---|
| `GET  /api/ev/v1/me` | Account, active assignments, app-config (timezone, grace days) |
| `GET  /api/ev/v1/bundle?courseId=` | **Whole-course import**: my published stints from the matrix, every attendance date (holidays removed), rosters, rubric snapshot, my existing evaluations; returns `bundleVersion` |
| `GET  /api/ev/v1/bundle/version?courseId=` | Cheap check ("is my offline copy stale?") |
| `GET  /api/ev/v1/day?date=&groupId=` | **Shared view**: for each student, `free / claimed by X / evaluated by X (total) / conflict` |
| `POST /api/ev/v1/claims` · `DELETE …/claims/:id` · `POST …/claims/:id/takeover` | Take, release and take over a student |
| `POST /api/ev/v1/submissions` | Save an evaluation (idempotent by `clientSubmissionId`) → `{ outcome, evaluation }` |
| `GET  /api/ev/v1/export?date=&scope=mine\|group` | Server Excel (online) |

**Server checks on every submission** (identical online and offline):
1. The session is valid, not revoked, the account is active, and the role is EVALUATOR.
2. `clientSubmissionId` has been seen before → return the original result (`duplicate`) and do nothing else.
3. The student is in scope and the group is scheduled at my hospital on `dateISO`. The course is published and the date is not a holiday.
4. The date window: `dateISO` ≤ today (Baghdad time) and ≥ today − **7 grace days** (so an offline save made on the day still syncs later). Anything outside the window is rejected but still stored.
5. Scores: every active rubric section is present, each is a finite number with 0 ≤ s ≤ max, in 0.5 steps. Absent means every score is forced to 0.
6. Ownership: no evaluation yet → apply. Mine → apply as an update. Someone else's → `conflict`, and the existing evaluation is left unchanged.
7. The submission row and the evaluation upsert commit in **one transaction**. Audit and flags follow.

## B.4 Offline architecture

```
┌─────────── Phone (installed PWA) ───────────────────────────────┐
│  App shell /e  (precached HTML + JS, works with zero signal)    │
│   ├─ IndexedDB "eva-ev-<accountId>"                             │
│   │   bundle · rosters · rubric · evaluations · drafts          │
│   │   outbox (clientSubmissionId, accountId, deviceTime …)      │
│   │   claimsLocal (provisional "taken" marks)                   │
│   ├─ Sync runner (one per device via Web Locks)                 │
│   │   on: open · online · every 30 s when visible · "Sync now"  │
│   └─ Service worker: shell + static chunks cached per version   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ JSON /api/ev/v1/* (cookie session)
┌──────────────────────────────▼──────────────────────────────────┐
│ Server: session check → idempotency → scope/schedule → validate │
│ → ownership → txn(Submission + Evaluation + Scores) → audit/flags│
└─────────────────────────────────────────────────────────────────┘
```

- **The app shell is a single client-rendered route `/e`** with in-app navigation (no server round-trip between screens). The service worker precaches it, so the app **opens and navigates fully offline**. This is the fix for C1.
- **Import once per course:** "استيراد جدول الدورة" downloads the whole course bundle (a few hundred KB for ~15 groups × 20 students). Afterwards the app checks `bundle/version` whenever it is online and refreshes silently if the admin changed the matrix or rosters.
- **Drafts autosave** on every tap, so a phone call or a killed tab never loses a half-filled form.
- **Outbox** entries are only removed after the server confirms `applied | duplicate | conflict | rejected`. Rejected and conflict entries stay visible in the Sync screen with the reason, and are also stored on the server.
- **Storage persistence:** call `navigator.storage.persist()` on import. Show a warning if the browser refuses and the app is not installed.

## B.5 Excel export

- **Online:** server file (`exceljs`, already installed), RTL sheet, one column per rubric section, total, attendance, notes, evaluator, sync status. Scope: *my evaluations* (default) or *whole group today (shared)*.
- **Offline:** the same file generated **on the phone** from IndexedDB (lazy-loaded `exceljs`, loaded only when the button is tapped). Unsynced rows are marked "بانتظار المزامنة" (awaiting sync). This file also acts as a **manual backup** of anything not synced yet.

## B.6 PWA install

- The manifest points to `start_url: /e`, with `id`, maskable icons, and shortcuts ("اليوم", "المزامنة").
- **Android/Chrome:** an "تثبيت التطبيق" (install the app) button driven by `beforeinstallprompt`.
- **iPhone/Safari:** an illustrated three-step sheet (Share → Add to Home Screen → Add), because iOS has no install prompt.
- `sw.js` is served with `Cache-Control: no-cache` so updates are detected. A new version waits and shows "تحديث متاح" (update available). It **never activates in the middle of grading**.

## B.7 Front-end design (from the three skills)

**Scene** (impeccable's theme test): *a nurse clinical instructor standing in a hospital ward corridor under bright fluorescent light, phone in one hand, patchy signal, grading 8–20 students between clinical duties, often interrupted.* This means a **light theme**, high contrast, big thumb-reachable controls, zero decorative motion, and a status that can be read at a glance.

**Design dials** (design-taste-v1, adapted to "simple and effective" as the skill allows): `DESIGN_VARIANCE 2 · MOTION_INTENSITY 2 · VISUAL_DENSITY 5`. The skill's default Framer/magnetic/perpetual-motion arsenal is **not used**: it conflicts with the brief, with low-end phones, and with offline bundle size.

| Area | Decision | Source rule |
|---|---|---|
| Color | **Restrained**: keep the existing brand `#1a5276` as the single accent (≤10% of the surface); cool neutrals tinted slightly toward the brand hue; OKLCH tokens | impeccable identity preservation + color strategy; taste-v1 "max 1 accent" |
| Status colors | available / in progress / done / conflict / pending sync, **each with an icon + text**, never color alone, all ≥4.5:1 | ui-ux `color-not-only`, `color-contrast` |
| Type | **IBM Plex Sans Arabic** (Arabic + Latin, free OFL, self-hosted via `@fontsource`, so it works offline); tabular numerals for scores | taste-v1 bans Inter/serif on dashboards; ui-ux `number-tabular`, 16px base |
| Icons | **Phosphor** (`@phosphor-icons/react`, MIT), one stroke weight; **no emoji** | taste-v1 icon rule; ui-ux `no-emoji-icons` |
| Touch | Every target ≥48px, 8px gaps, primary action in the bottom thumb zone, `touch-action: manipulation` | ui-ux §2 |
| Layout | Lists with dividers, **no cards inside cards**, no side-stripe borders, single column, `min-h-dvh`, safe-area insets | impeccable bans; taste-v1 viewport rule |
| Motion | 150–200 ms opacity/transform only, press feedback `scale(.98)`, full `prefers-reduced-motion` support | ui-ux §7; impeccable reduced-motion |
| Feedback | Save → inline check + short vibration (Android) + "التالي" (next student); errors next to the field, with a recovery step | ui-ux §8 |
| States | Skeleton lists, helpful empty states ("لا مجموعات مجدولة اليوم — القادم: الثلاثاء 14/10، مستشفى اليرموك"), offline banner | taste-v1 Rule 5 |

**Navigation:** a bottom bar with 4 items, icon + label: **اليوم** (Today) · **مشترك** (Shared) · **جدولي** (My schedule) · **المزامنة** (Sync, with a pending-count badge).

**Screens (RTL wireframes):**

```
① اليوم — Today                         ② المجموعة — Group roster
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ الأحد 12 تشرين الأول  ● متصل  │        │ ‹ مجموعة B · مستشفى اليرموك   │
│ ──────────────────────────── │        │ ███████░░░  12/18 مُقيَّم      │
│ مجموعة B · اليرموك            │        │ [الكل][متاح 4][قيد 2][منتهٍ 12]│
│ 12/18 مُقيَّم   [ فتح ›]       │        │ ──────────────────────────── │
│ ──────────────────────────── │        │ ○ علي حسن كاظم   2201347  متاح │
│ مجموعة D · اليرموك            │        │ ◔ زينب فاضل      2201355       │
│ لم تُستورد   [ استيراد ↓ ]    │        │   قيد التقييم لدى د. سرى       │
│                              │        │ ✓ حيدر عباس      2201362       │
│                              │        │   د. سرى · 13.5/15             │
│                              │        │ ✓ مريم صالح      2201370  أنت  │
│                              │        │ ──────────────────────────── │
│ [اليوم][مشترك][جدولي][مزامنة²]│        │ [ ↓ تنزيل Excel اليوم ]        │
└──────────────────────────────┘        └──────────────────────────────┘

③ التقييم — Grade sheet                 ④ مشترك — Shared evaluations
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ ‹ علي حسن كاظم · 2201347      │        │ اليرموك · اليوم · قبل 20 ث     │
│ الحضور                        │        │ [كل المجموعات ▾]               │
│ [ حاضر ][ متأخر ][ غائب ]      │        │ د. سرى الموسوي — 7 طلاب        │
│ الملاحظة اليومية      /5      │        │   حيدر عباس        13.5 ✓     │
│      [ − ]   4   [ + ]        │        │   زينب فاضل        قيد التقييم │
│ المناقشة والتغذية الراجعة  /7   │        │ أنت — 5 طلاب                   │
│      [ − ]  5.5  [ + ]        │        │   مريم صالح        14 ✓        │
│ الموقف والتواصل   [0][½][1]   │        │ ⚠ تعارض: أحمد جواد (راجِع)     │
│ الانتظام          [0][½][1]   │        │                              │
│ المظهر            [0][½][1]   │        │                              │
│ + إضافة ملاحظة / تغذية راجعة   │        │                              │
│ ──────────────────────────── │        │                              │
│ المجموع 12.5/15  [ حفظ والتالي ]│        │                              │
└──────────────────────────────┘        └──────────────────────────────┘
```

- **Grade-sheet input:** sections with max ≤ 1 use three chips (0, ½, 1). Larger sections use a −/+ stepper (0.5 steps) with a tappable number that opens the numeric keypad. Choosing "غائب" (absent) greys out the scores and sets them to 0.
- **جدولي (My schedule):** weeks from the matrix with dates, hospital and group, plus **one** "استيراد جدول الدورة للعمل دون اتصال" (import the course schedule for offline work) button showing the last import time and size.
- **المزامنة (Sync):** pending list, errors with a recovery action ("افتح وأعد الحفظ" = open and save again), conflicts, "زامن الآن" (sync now), storage-persistence status, and the install guide.

---

# Part C: Attack on the plan and the current code

Everything below was found by reading the code or by stress-testing Part B. Severity: 🔴 critical (can lose, corrupt or misattribute grades) · 🟠 high · 🟡 medium.

## C.1 Problems in the existing v3 evaluator code (verified in source)

| # | Sev | Finding | Evidence | Consequence |
|---|---|---|---|---|
| C1 | 🔴 | **Offline navigation is broken.** When offline, `sw.js` answers every page navigation with `offline.html`, and the grade page HTML is never cached. | `public/sw.js` navigate handler; no page caching | Offline grading only works if the grade page happened to be open already. Opening the app or moving to another student offline shows the "offline" page. *(Found by reading the code; the E9 test will confirm it in a browser.)* |
| C2 | 🔴 | **Offline replay calls a Server Action.** Server Action IDs change on every deploy. | `sync.ts` → `gradeStudentAction` | After any deploy, queued grades from an older app version fail and get stuck as "errors" |
| C3 | 🔴 | **The outbox is not tied to an account.** Its key is `studentId:dateISO` with no `accountId`. Logout does not clear offline data. | `offline/db.ts`, `logoutAction` | On a shared phone, evaluator A's queued grades are replayed **as evaluator B**, and A's roster remains visible to B |
| C4 | 🔴 | **A second evaluator silently overwrites the first.** The upsert on `(studentId, dateISO)` replaces `evaluatorId` and all scores. | `upsertEvaluation` `update:` branch | In a shared hospital, B's save erases A's grade from the live record (only the audit JSON keeps it) |
| C5 | 🟠 | **The server accepts any `dateISO`** that is a scheduled day, including future or months-old days. | `gradeStudentAction` reads `dateISO` from the form; no window check | Backdating or pre-grading by editing the request |
| C6 | 🟠 | **NaN scores pass validation.** `Number("abc")` is NaN, and NaN fails both `< 0` and `> max`, so it is accepted. | `upsertEvaluation` range check | `total` becomes NaN. Either it is stored (Postgres floats accept NaN), which corrupts statistics and flags, or the save fails with an unclear database error |
| C7 | 🟠 | **A deactivated evaluator keeps access for up to 12 h.** `requireRole` trusts the JWT and never checks `account.active`. | `lib/auth.ts` | Revoking a lost phone or a dismissed evaluator is not immediate |
| C8 | 🟠 | **An expired session looks like "offline" forever.** A 401 during sync is thrown as a `TypeError`, so sync "stops offline" with no prompt to log in. | `sync.ts` `checkStillValid` | Grades sit unsynced for days while the evaluator believes they are pending normally |
| C9 | 🟠 | **No idempotency.** A lost response followed by a retry or double tap resubmits. | No request key anywhere | Duplicate audit entries today. Under the new ownership rule it would become a **self-conflict**. |
| C10 | 🟡 | **"Today" is computed in UTC** (`toISOString().slice(0,10)` in 13 places). Iraq is UTC+3. | grep | Between 00:00 and 03:00 local, "today" is yesterday. Phone and server can disagree. |
| C11 | 🟡 | **The offline bundle is today-only**, and "today" is fixed at import time. | `offline-bundle/route.ts` | A bundle imported on Sunday has no Tuesday context, so the roster shows stale "not graded" states |
| C12 | 🟡 | **Excel export needs the network.** | `/api/my/export` | No end-of-day file in a hospital without signal |
| C13 | 🟡 | **Browser storage can be evicted.** There is no `navigator.storage.persist()` call. Safari may clear site data of non-installed web apps after ~7 days without use. | none | An unsynced outbox could be wiped |

## C.2 Attacks on this plan (Part B), and how the design answers them

| # | Sev | Attack: "what if…" | Answer built into the design |
|---|---|---|---|
| P1 | 🔴 | Two evaluators, both offline, take and grade the same student | Claims are advisory. The server applies the first submission and stores the second as `conflict`. Both evaluators see a ⚠ badge after sync, and the admin resolves it in the Grading Center. **Nothing is discarded.** |
| P2 | 🟠 | An evaluator takes a student and then goes home | Take-over with confirmation and a reason (audited). Claims auto-expire at the end of the day. A *saved* evaluation can never be taken over, only an unsaved claim. |
| P3 | 🔴 | A phone is lost or stolen with the course roster on it | The bundle holds only name, university number and group (no email or phone). The admin revokes the device's `Session`, so it can never sync again. Logout wipes local data after warning about unsynced items. **Accepted residual risk:** local data on a lost phone cannot be wiped remotely. An optional app PIN is listed as future work. |
| P4 | 🟠 | The admin changes the matrix or moves a student after the evaluator imported | `bundleVersion` is checked whenever online, with a silent refresh. A save for a student no longer in scope is `rejected` but **stored**, shown with the reason, and visible to the admin. |
| P5 | 🟠 | The rubric changes mid-course while phones are offline | The rubric is **snapshotted per published course** (`rubricVersion`). Edits apply only from a new version with an effective date. A submission is validated against the version it was made with. This removes the "stuck forever" rubric error the current code has. |
| P6 | 🟠 | A new deploy breaks the cached app shell (the HTML points to chunks that no longer exist) | The service worker caches shell + chunks as **one versioned set**. The new version downloads completely before it is offered, and activates only when the user taps "تحديث" (update) with no unsaved draft. Old chunks are kept until then. |
| P7 | 🟠 | The phone clock is wrong or deliberately changed to backdate | The server validates `dateISO` against its own Baghdad date with a 7-day grace window. It stores `deviceTime` and `receivedAt`, and marks `syncedLate` or clock-skew cases for the Grading Center to show. |
| P8 | 🟡 | Two open tabs sync at the same time | Web Locks ensure a single sync runner, and idempotency makes any double send harmless. |
| P9 | 🔴 | An evaluator reads another hospital's evaluations through the shared view | `/day` derives the scope from the server session only: groups in my assignments, at my hospital, on that date. The client never sends a hospital ID. An automated test asserts no cross-hospital leakage (like the existing phase-2 smoke test). |
| P10 | 🟠 | CSRF against the new JSON endpoints | A SameSite=Lax cookie (already set), plus JSON-only bodies and an `Origin` header check on every POST/DELETE. |
| P11 | 🟡 | Polling overloads the free Neon database | Poll only while the screen is visible, every 30 s, backing off to 2 min when idle. The endpoint is small, indexed and uses a `since` cursor. That is roughly 40 req/min for 20 active evaluators, which is well within limits. |
| P12 | 🟠 | The session expires during a long offline shift | Evaluator sessions last **14 days, sliding**, and are server-side, so they are revocable. When sync gets a 401, it shows a **"سجّل الدخول للمزامنة"** (log in to sync) banner and never pretends to be offline. The outbox survives the login because it is keyed by account. |
| P13 | 🟡 | The college actually wants **two evaluators per student per day** (for example, averaged) | This plan assumes one owner per student-day. **Question Q1 below.** Changing it later touches only the ownership rule (step 6). The submissions journal already keeps every evaluator's input. |
| P14 | 🟡 | Excel/CSV formula injection through names or notes (`=HYPERLINK…`) | `exceljs` writes plain strings, not formulas. For any CSV path, prefix `'` to cells starting with `= + - @`. |
| P15 | 🟡 | A large bundle on slow 3G | A gzip JSON bundle of about 200–400 KB. Import shows progress and can be resumed. Rosters are split per group so a refresh fetches only what changed. |

---

# Part D: Final decisions (fixes folded in)

1. **Evaluator app = offline-first shell at `/e`.** The old `/my`, `/schedule` and `/grade/*` routes redirect to it. *(fixes C1, C11)*
2. **One versioned JSON write path** with idempotency keys, used for both online saves and offline replay. The evaluator app no longer calls Server Actions. *(C2, C9)*
3. **Append-only `EvaluationSubmission` journal** in the same transaction as the evaluation. *(R3, C4, P1)*
4. **Ownership rule:** the first applied save owns the student-day; others go to `conflict`. Take-over applies to unsaved claims only. *(C4, P1, P2)*
5. **Offline storage per account** (`eva-ev-<accountId>`). Outbox entries carry `accountId` and are replayed only by that account. Logout wipes after an unsynced-items warning. *(C3)*
6. **Server-side sessions,** with an `active` check on every request, instant revoke, and 14-day sliding sessions for evaluators. *(C7, C8, P12)*
7. **Strict validation:** finite numbers, 0.5 steps, all sections present, absent means 0, date window of Baghdad today − 7 to Baghdad today, course published, not a holiday. *(C5, C6, P7)*
8. **A single `todayBaghdad()` helper** replaces all 13 UTC date computations. *(C10)*
9. **Rubric snapshot per published course.** *(P5)*
10. **Versioned service worker,** update only on the user's tap, `storage.persist()`, and an install guide for iOS and Android. *(P6, C13, R7)*
11. **Offline Excel** generated on the phone, which doubles as a manual backup. *(C12, R4)*
12. **Free stack only:** everything is open source (MIT/OFL) on the existing Neon + Cloudflare setup. New packages are `@phosphor-icons/react` (MIT) and `@fontsource/ibm-plex-sans-arabic` (OFL). No paid push or realtime service; polling is enough.

---

# Part E: Build order

Each step is shippable, type-checked, and verified before the next one starts.

| Step | Deliverable | Verification |
|---|---|---|
| **E1** | Migration: `EvaluationSubmission`, `EvaluationClaim`, `Session`, `Evaluation` fields; `todayBaghdad()`; validation fixes (NaN, date window, all sections) | Unit tests: validation, date window, idempotency |
| **E2** | Server sessions + `active` check + revoke; evaluator 14-day sliding session | Test: deactivated account → 401 immediately |
| **E3** | `/api/ev/v1/submissions` with the ownership rule + journal in one transaction; admin/grading-center reads unchanged | Tests: concurrent A/B same student → one applied, one conflict, both stored; replay the same key → `duplicate` |
| **E4** | Claims + `/day` shared view with server-derived scope | Test: no cross-hospital leakage; take-over audited |
| **E5** | Course bundle + version endpoint (reads the matrix / `RotationBlock`) | Test: a matrix change bumps the version |
| **E6** | App shell `/e`: design tokens, font, icons, bottom nav, screens ①–④ + Sync, drafts autosave | Playwright at 375 px, RTL, contrast check |
| **E7** | Offline layer: per-account IndexedDB, outbox, Web-Locks sync runner, 401 handling, versioned service worker, `storage.persist()` | Playwright **offline mode**: open the app cold offline → grade 3 students → go online → all 3 applied |
| **E8** | Excel (server + on-device), PWA install flow (Android prompt + iOS sheet), manifest update | Manual check on Android Chrome + iOS Safari |
| **E9** | Redirect old evaluator routes; end-to-end smoke: two evaluators, same group, shared view, conflict, export | Full scripted run against a seeded DB |

---

## Questions (defaults will be used if you don't answer)

1. **One or two evaluators per student per day?** Default: **one owner per student-day**; a second save becomes a conflict for the admin.
2. **What colleagues can see in the shared view:** status and name only, or also the total and read-only details? Default: **name + status + total, details read-only.**
3. **Offline grace window:** how many days after the evaluation date may an offline save still sync? Default: **7 days.**
4. **Can an evaluator edit their own saved evaluation later?** Default: **yes, until the admin locks it** (every edit is kept in the journal).
