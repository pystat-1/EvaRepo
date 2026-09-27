# Big Goal 2: Evaluator App · FINAL PLAN

> **Status:** FINAL. Decisions confirmed by the user on 2026-09-27. Not implemented yet.
> **Depends on:** Big Goal 1, the Course Setup matrix (`COURSE_SETUP_PLAN.md`). The evaluator app imports its schedule from the published matrix. The server engine (E1–E5) can be built first on the current `RotationBlock` data, because the matrix writes the same tables.
> **Stack:** free and open-source only. Existing Next.js + Prisma + Neon + Cloudflare setup. New packages: `@phosphor-icons/react` (MIT) and `@fontsource/ibm-plex-sans-arabic` (OFL). Web Push uses self-generated VAPID keys, with no paid service.

---

## 0. Confirmed decisions

| # | Topic | Decision |
|---|---|---|
| D1 | **Two evaluators grade the same student on the same day** | Both grades are kept. A **conflict flag** appears to **both evaluators** and to the **admin**. The admin decides **which grade to approve**. |
| D2 | **Shared view** | Shows **only which student is taken by which evaluator**. Colleagues never see each other's scores, notes or totals. |
| D3 | **Late window** | An evaluation may be submitted or synced up to **7 days** after its date, **with reminders** during that period. |
| D4 | **Editing** | An evaluator can edit their own saved evaluation **until the admin locks it**. |
| D5 | **Study type** | Study type = **shift (Morning / Evening)** (from Goal 1). |
| D6 | **Ownership** | Every evaluation, and every attempt to save one, is permanently linked to the evaluator's account. |

---

## 1. What the evaluator app does

1. **Import the course schedule once.** The evaluator downloads their whole course from the published matrix: stints, attendance dates, rosters and rubric. It refreshes itself when online.
2. **Today.** Shows the groups the matrix schedules for this evaluator today → **import group** → roster.
3. **Take a student.** The student is marked "taken by me", and colleagues at the same hospital see it.
4. **Grade.** Attendance, rubric scores, optional notes and feedback. Works **fully offline**. Drafts autosave.
5. **Sync automatically** when the connection returns. Every save is confirmed or explained.
6. **Reminders** for unsynced and missing evaluations, until the 7-day window closes.
7. **Download the day as Excel:** my evaluations only, available online or offline.
8. **Install** on the phone as a PWA (Android and iPhone).
9. Everything lands in the tables the **Grading Center** reads.

---

## 2. The rulebook

### 2.1 Life of one student-day
```
                 take                 save
   ┌───────┐  ───────►  ┌───────┐  ───────►  ┌────────┐   admin lock   ┌────────┐
   │ FREE  │            │ TAKEN │            │ SAVED  │ ─────────────► │ LOCKED │
   └───────┘  ◄───────  └───────┘            └────────┘                └────────┘
               release /     │  take-over         │ ▲
               end of day    │  (unsaved only,    │ │ admin approves one grade
                             │   reason, audited) │ │
                             ▼                    ▼ │
                       new evaluator     second evaluator's save arrives
                                         ──► ┌──────────┐
                                             │ DISPUTED │  flag to both evaluators + admin
                                             └──────────┘
```

### 2.2 Taking a student and the shared view
- Tapping a free student **takes** them. Online, this happens on the server at once (first tap wins). Offline, it is a provisional local mark that is sent on the next sync.
- **Shared view** (colleagues at the same hospital and group, that day) shows only:
  `متاح` (available) · `مأخوذ لدى د. سرى` (taken by Dr. Sura) · `⚠ تعارض` (conflict).
  **No scores, totals, notes or feedback of other evaluators are ever sent to the phone.**
- **Online:** a student taken by someone else cannot be opened for grading. **Take-over** is allowed only if the other evaluator has **not saved** yet. It needs a reason, and it is audited, with the original evaluator notified in the app.
- A take that is never saved **expires at the end of the day**.

### 2.3 Conflicts (D1)
- A conflict can only happen when the take could not be enforced: both evaluators were **offline**, or both saved at the same moment.
- When the second evaluator's save reaches the server:
  1. **Both** submissions are stored permanently.
  2. The student-day becomes **DISPUTED**.
  3. A conflict flag appears:
     - **to both evaluators** (on the student row, on Today, and in Sync): "⚠ تعارض مع د. X — بانتظار قرار الإدارة" (conflict with Dr. X, awaiting the admin's decision). Neither sees the other's grades.
     - **to the admin**: in the **Review Inbox** with a nav badge, showing both grades side by side (attendance, every section, total, notes, evaluator, device time, received time).
- **While disputed:** the evaluation is **frozen**. Neither evaluator can edit it, and it is **excluded from statistics and at-risk flags** until the admin decides.
- **The admin approves one grade** (optionally with a note). The approved grade becomes the evaluation, and its evaluator becomes the owner. The other grade stays in the journal as `not approved`. Both evaluators see the outcome. Audited.
- **Late arrivals:** if a third evaluator's save, or a stale queued save, arrives after the decision, a **new conflict** opens against the approved grade. Nothing is applied silently.

### 2.4 The 7-day window and reminders (D3)
- The window is measured in **Baghdad time**. An evaluation dated `D` can be submitted or synced from `D` up to the end of `D + 7`.
- **Reminders** go to the evaluator for two kinds of items:
  - **Unsynced:** saved on the phone but not yet on the server. Only the phone knows about these.
  - **Missing:** students scheduled with this evaluator on a date in the window who have no evaluation from anyone. The server knows about these.
- **Reminder schedule:** evening of day 0, then day 3, day 5, and day 6 ("last day tomorrow"). On day 7 the window closes.
- **After day 7:** the evaluator can no longer submit. A late sync is **not discarded**. It is stored as `late` and appears in the admin's Review Inbox, where the admin may **accept** it (audited) or leave it rejected.
- The admin sees **overdue** items (still missing on day 7) per evaluator.

### 2.5 Editing and locking (D4)
- An evaluator can edit **their own** saved evaluation any time **until the admin locks it**. Every edit is a new journal entry, so the full history is kept.
- **Admin lock scopes:** one evaluation · a group-day · a group-week · a whole course. **Unlock** is admin-only and audited.
- An edit that arrives after a lock (for example, queued offline) is stored as `rejected: locked` and shown to the evaluator and the admin.
- Evaluators can **never** edit another evaluator's evaluation.

### 2.6 Server checks on every save (online and offline replay are identical)
1. **Session:** valid and not revoked, account active, role EVALUATOR.
2. **Idempotency:** a repeated `clientSubmissionId` returns the original result and does nothing else.
3. **Scope:** the student is in the evaluator's assignments. The course is **published**. The group is scheduled at the evaluator's hospital on that date. The date is not a holiday.
4. **Window:** `D` ≤ today (Baghdad) and today ≤ `D + 7`. Otherwise the save is stored as `late`.
5. **Scores:** every active section of the course's rubric version is present, each a finite number, 0 ≤ score ≤ max, in 0.5 steps. Absent forces all scores to 0.
6. **State:**
   - free → apply
   - own and not locked → apply edit
   - locked → `rejected: locked`
   - someone else's, or disputed → `conflict`
7. **One transaction** writes the journal row, the evaluation, its scores and any conflict record. Audit and flag recompute follow; disputed evaluations are skipped.

---

## 3. Data model (additive migration; existing data untouched)

```prisma
enum EvaluationStatus { ACTIVE DISPUTED }

model Evaluation {                       // existing, + fields; @@unique([studentId, dateISO]) kept
  status           EvaluationStatus @default(ACTIVE)
  courseId         String?
  rubricVersion    Int?
  lastSubmissionId String?
  lockedAt         DateTime?
  lockedById       String?
}

// Append-only journal: every save attempt from every device. Never updated or deleted.
model EvaluationSubmission {
  id                 String   @id @default(cuid())
  clientSubmissionId String   @unique            // idempotency key made on the phone
  studentId          String
  dateISO            String
  evaluatorId        String                     // from the server session only
  sessionId          String?
  payload            Json                       // attendance, scores, notes, feedback, rubricVersion
  deviceTime         DateTime
  receivedAt         DateTime @default(now())
  source             String                     // "online" | "offline_sync"
  appVersion         String?
  outcome            String                     // applied | duplicate | conflict | late | rejected
  reason             String?                    // e.g. "locked", "out_of_scope", "not_scheduled"
  evaluationId       String?
  @@index([studentId, dateISO])
  @@index([evaluatorId, receivedAt])
  @@index([outcome])
}

// A dispute between two or more submissions for one student-day.
model EvaluationConflict {
  id                  String    @id @default(cuid())
  studentId           String
  dateISO             String
  status              String    // "open" | "resolved"
  submissionIds       String[]  // every competing submission
  chosenSubmissionId  String?
  resolvedById        String?
  resolvedAt          DateTime?
  note                String?
  createdAt           DateTime  @default(now())
  @@index([status])
  @@index([studentId, dateISO])
}

// "Taken by" marks for the shared view.
model EvaluationClaim {
  id          String   @id @default(cuid())
  studentId   String
  dateISO     String
  evaluatorId String
  status      String   // active | released | completed | taken_over | expired
  reason      String?  // take-over reason
  claimedAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([studentId, dateISO])            // history kept in AuditLog
}

// Server-side sessions: instant revoke, active-account check, long offline-friendly life.
model Session {
  id          String    @id @default(cuid())
  accountId   String
  deviceLabel String?
  createdAt   DateTime  @default(now())
  lastSeenAt  DateTime  @default(now())
  expiresAt   DateTime                 // evaluators: 14 days, sliding
  revokedAt   DateTime?
  @@index([accountId])
}

// Free Web Push (VAPID) for reminders when the app is closed.
model PushSubscription {
  id        String   @id @default(cuid())
  accountId String
  sessionId String
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
}

model ReminderLog {                      // prevents sending the same reminder twice
  id        String   @id @default(cuid())
  accountId String
  kind      String   // "missing" | "window_closing"
  dateISO   String
  stage     Int      // 0, 3, 5, 6
  sentAt    DateTime @default(now())
  @@unique([accountId, kind, dateISO, stage])
}
```

**From Goal 1 (required):** `Course.status = PUBLISHED`, `courseId` on blocks and assignments, holidays, and the **rubric snapshot per published course** (`rubricVersion`). Rubric edits then apply only from a new version, so phones that are offline are never invalidated.

---

## 4. API: one versioned JSON path (no Server Actions in the evaluator app)

| Method + path | Purpose |
|---|---|
| `GET  /api/ev/v1/me` | Account, assignments, server Baghdad date, window days, app config |
| `GET  /api/ev/v1/bundle?courseId=` | Whole-course import: stints, attendance dates (holidays removed), rosters (name, university number, group only), rubric version, **my** evaluations; returns `bundleVersion` |
| `GET  /api/ev/v1/bundle/version?courseId=` | Cheap staleness check |
| `GET  /api/ev/v1/day?date=&groupId=` | Shared view: per student `free / taken by <name> / conflict` + **my own** status. No other evaluator's grades. |
| `POST /api/ev/v1/claims` · `DELETE /claims/:id` · `POST /claims/:id/takeover` | Take, release, take over (unsaved only, reason required) |
| `POST /api/ev/v1/submissions` | Save (idempotent) → `{ outcome, reason?, evaluation? }` |
| `GET  /api/ev/v1/attention` | My missing evaluations in the window, open conflicts, rejected or late items, days left |
| `POST /api/ev/v1/push/subscribe` · `DELETE …/push/subscribe` | Reminder notifications on or off |
| `GET  /api/ev/v1/export?date=` | Server Excel, my evaluations only |

Every POST/DELETE requires a JSON body and a matching `Origin` header (CSRF), plus the SameSite=Lax session cookie. The scope is always derived from the session; the client never sends a hospital ID.

**Admin (new, minimal, until the Grading Center rebuild):**

| Page / action | Purpose |
|---|---|
| `/review` **Review Inbox** (nav badge) | Open conflicts (side-by-side comparison → approve one), late submissions (accept / leave rejected), rejected items (information), overdue missing evaluations per evaluator |
| Lock / unlock | Per evaluation, group-day, group-week, course |
| Sessions | See each evaluator's devices, **revoke** a device |

---

## 5. Offline architecture

```
┌──────────── Phone (installed PWA) ───────────────────────────────┐
│ App shell /e — client-rendered, precached, navigates offline     │
│  IndexedDB  "eva-ev-<accountId>"  (one database per account)     │
│   bundle · rosters · rubric · myEvaluations · drafts             │
│   outbox (clientSubmissionId, accountId, deviceTime, payload)    │
│   localClaims · attention cache                                  │
│  Sync runner — single instance per device (Web Locks)            │
│   triggers: app open · online · every 30 s while visible ·       │
│             "زامن الآن" · Android Periodic Background Sync        │
│  Service worker — shell + chunks cached as one versioned set;    │
│   update applies only on user tap, never mid-grading             │
└───────────────────────────────┬──────────────────────────────────┘
                                │ /api/ev/v1/*  (session cookie)
┌───────────────────────────────▼──────────────────────────────────┐
│ session → idempotency → scope/schedule → window → validate →     │
│ state rules → txn(journal + evaluation + scores + conflict)      │
│ → audit → flags (skip DISPUTED) → reminders cron                 │
└──────────────────────────────────────────────────────────────────┘
```

- **The shell `/e`** replaces `/my`, `/schedule` and `/grade/*`, which redirect to it. The app opens and moves between screens with zero signal.
- **Outbox entries** are deleted only after the server answers `applied`, `duplicate`, `conflict`, `late` or `rejected`. Every non-applied answer stays visible in **Sync** with its reason and next step.
- **401 during sync** shows "سجّل الدخول للمزامنة" (log in to sync), never "offline". The outbox survives re-login because it is keyed per account.
- **Logout** warns about unsynced items, and wipes local data only after they are synced (or after explicit confirmation plus an Excel backup).
- **Storage safety:** `navigator.storage.persist()` on import. A warning appears if persistence is refused and the app is not installed.
- **Bundle refresh:** `bundleVersion` is checked whenever online, and the refresh is silent. It is split per group, so only changed rosters download.

---

## 6. Reminders (free, three layers)

| Layer | Covers | Works when | Tech |
|---|---|---|---|
| **In-app** | Unsynced + missing + conflicts, with "باقي N أيام" (N days left) | App open | Banner on Today, badge on Sync |
| **App icon badge** | Count of unsynced + missing | Installed, app closed (Android, iOS 16.4+ installed) | Badging API |
| **Push notification** | Missing evaluations and the window closing (server knows these) | App closed; Android; iOS 16.4+ **installed** PWA | Web Push with VAPID from a **Cloudflare Cron Trigger** (daily at 18:00 Baghdad), `ReminderLog` de-duplication |
| **Local check** | Unsynced items (only the phone knows) | Android installed PWA, when the browser allows | Periodic Background Sync (best effort) |

- **Lock-screen privacy:** notifications never contain student names. Example: "لديك 4 تقييمات لم تُرسل — باقي يومان" (you have 4 evaluations not sent — 2 days left).
- The push library must be **WebCrypto-based** so it runs on Cloudflare Workers. This is verified in step E8, and if no library works there, the plan falls back to in-app reminders plus the badge only.

---

## 7. Excel export (my evaluations only)

- **Online:** server file with `exceljs` (already installed). RTL sheet with one column per rubric section, plus total, attendance, notes, feedback, and a status column (saved / disputed / locked).
- **Offline:** the same file generated on the phone from IndexedDB (`exceljs` loaded only on tap). Unsynced rows are marked "بانتظار المزامنة" (awaiting sync). This file doubles as a **manual backup**.
- Cells are written as plain strings. Any CSV path escapes cells starting with `= + - @`, to prevent formula injection.

---

## 8. PWA install and updates

- **Manifest:** `start_url: /e`, `id`, `scope`, maskable icons, shortcuts (اليوم / المزامنة), `dir: rtl`, `lang: ar`.
- **Android/Chrome:** an "تثبيت التطبيق" (install the app) button (`beforeinstallprompt`).
- **iPhone/Safari:** a three-step illustrated guide (Share → Add to Home Screen → Add), shown once and reachable from Sync.
- **Updates:** `sw.js` is served `no-cache`. The new version downloads completely in the background, then shows "تحديث متاح" (update available). It applies on tap, and never while a draft is open.

---

## 9. Front-end design

**Scene:** *a nurse clinical instructor in a hospital corridor under fluorescent light, phone in one hand, patchy signal, grading 8–20 students between duties, often interrupted.* This gives a light theme, high contrast, big thumb-zone controls, status readable at a glance, and no decorative motion.

| Area | Decision |
|---|---|
| Dials (design-taste-v1, adapted to "simple and effective") | Variance 2 · Motion 2 · Density 5. No Framer, magnetic or perpetual effects. |
| Color (impeccable: restrained, keep identity) | Existing brand `#1a5276` as the only accent (≤10%). Cool neutrals slightly tinted toward it. OKLCH tokens. |
| Status | Available · Taken by X · In progress (mine) · Saved · Awaiting sync · Conflict · Locked. Each has an **icon + text**, and every color pair is ≥4.5:1. |
| Type | IBM Plex Sans Arabic, self-hosted so it works offline. 16px base, tabular numerals for scores. |
| Icons | Phosphor, one stroke weight. No emoji. |
| Touch (ui-ux-pro-max) | Targets ≥48px, 8px gaps, primary action at the bottom, `touch-action: manipulation`, safe-area insets, `min-h-dvh`. |
| Layout | Single column, lists with dividers, no nested cards, no side-stripe borders. |
| Motion | 150–200 ms opacity/transform, press `scale(.98)`, full `prefers-reduced-motion`. |
| States | Skeletons, helpful empty states, offline banner, inline errors with a recovery action. |

**Bottom navigation (4):** اليوم (Today) · مشترك (Shared) · جدولي (My schedule) · المزامنة (Sync, badge).

```
① اليوم — Today                          ② المجموعة — Roster (mine + shared status)
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ الأحد 12 تشرين الأول   ● متصل │         │ ‹ مجموعة B · مستشفى اليرموك   │
│ ⚠ 3 تقييمات ناقصة — باقي 4 أيام│         │ ███████░░░  أنجزت 7 من 18     │
│ ⚠ تعارض واحد بانتظار الإدارة   │         │ [الكل][متاح][مأخوذ][لي]         │
│ ──────────────────────────── │         │ ──────────────────────────── │
│ مجموعة B · اليرموك            │         │ ○ علي حسن كاظم   2201347  متاح │
│ أنجزت 7   [ فتح ›]             │         │ ◔ زينب فاضل      2201355       │
│ ──────────────────────────── │         │   مأخوذ لدى د. سرى             │
│ مجموعة D · اليرموك            │         │ ✓ مريم صالح      2201370       │
│ لم تُستورد   [ استيراد ↓ ]    │         │   لي · محفوظ                   │
│                              │         │ ⚠ أحمد جواد      2201381       │
│                              │         │   تعارض مع د. سرى — للإدارة    │
│ [اليوم][مشترك][جدولي][مزامنة³]│         │ [ ↓ تنزيل Excel تقييماتي ]     │
└──────────────────────────────┘         └──────────────────────────────┘

③ التقييم — Grade sheet                  ④ مشترك — Shared (who took whom)
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ ‹ علي حسن كاظم · 2201347      │         │ اليرموك · اليوم · قبل 20 ث     │
│ الحضور                        │         │ [كل المجموعات ▾]               │
│ [ حاضر ][ متأخر ][ غائب ]      │         │ د. سرى الموسوي — 6 طلاب        │
│ الملاحظة اليومية      /5      │         │   زينب فاضل · حيدر عباس · …    │
│      [ − ]   4   [ + ]        │         │ د. علي الربيعي — 4 طلاب        │
│ المناقشة والتغذية الراجعة  /7   │         │   نور حسين · كرار سعد · …      │
│      [ − ]  5.5  [ + ]        │         │ أنت — 7 طلاب                   │
│ الموقف والتواصل   [0][½][1]   │         │ متاح — 1 طالب                  │
│ الانتظام          [0][½][1]   │         │   علي حسن كاظم                 │
│ المظهر            [0][½][1]   │         │                              │
│ + ملاحظة / تغذية راجعة         │         │ (لا درجات — من أخذ من فقط)     │
│ المجموع 12.5/15 [ حفظ والتالي ]│         │                              │
└──────────────────────────────┘         └──────────────────────────────┘
```

- **Grade sheet input:** sections with max ≤ 1 use chips (0, ½, 1); larger ones use a −/+ stepper (0.5 steps) with a tappable number for the keypad. "غائب" (absent) greys out the scores and sets them to 0. Saving gives an inline check, a short vibration (Android), then the next free student.
- **جدولي (My schedule):** the course weeks from the matrix (dates, hospital, group) and one "استيراد جدول الدورة" (import the course schedule) button showing the last import time and size.
- **المزامنة (Sync):** pending items, and results that need action (conflict / late / rejected, each with its reason). It also holds "زامن الآن" (sync now), reminder on/off, storage status and the install guide.

---

## 10. Risk register: attack findings and how the final plan closes them

**Existing v3 defects (verified in source; each is fixed by this plan):**

| # | Defect | Fix |
|---|---|---|
| C1 | Offline navigation shows `offline.html`; the grade page is never cached (found by reading the code, to be confirmed in E7) | Precached shell `/e` (§5) |
| C2 | Offline replay calls a Server Action whose ID changes on every deploy | Versioned JSON API (§4) |
| C3 | Outbox not tied to an account; logout keeps data, so grades replay as another evaluator | Per-account database + `accountId` on entries + logout wipe (§5) |
| C4 | A second evaluator's save silently overwrites the first | Journal + DISPUTED + admin decision (§2.3) |
| C5 | Server accepts any scheduled `dateISO` (backdating or grading ahead) | 7-day Baghdad window (§2.4) |
| C6 | Non-numeric (NaN) scores pass validation | Finite, 0.5-step, all-sections check (§2.6) |
| C7 | Deactivated account keeps access up to 12 h | Server sessions + active check + revoke (§3) |
| C8 | Expired session during sync looks like "offline" forever | Explicit 401 state (§5) |
| C9 | No idempotency (retries and double taps) | `clientSubmissionId` (§2.6) |
| C10 | "Today" computed in UTC (13 places); Iraq is UTC+3 | One `todayBaghdad()` helper |
| C11 | Offline bundle is today-only | Whole-course bundle (§4) |
| C12 | Excel export needs the network | On-device Excel (§7) |
| C13 | Browser may evict unsynced data | `storage.persist()` + install + reminders (§5, §6) |

**Attacks on the design itself:**

| # | Attack | Answer |
|---|---|---|
| P1 | Both evaluators grade the same student offline | Both kept, DISPUTED, flag to both + admin, admin approves one (§2.3) |
| P2 | An evaluator takes a student and leaves | Take-over of unsaved takes, with reason and audit; auto-expiry at end of day |
| P3 | Lost or stolen phone holding rosters | Minimal data (name, university number, group); admin revokes the device session; no names in notifications. **Residual:** local data can't be wiped remotely (optional app PIN is future work). |
| P4 | Matrix or roster changes after import | `bundleVersion` auto-refresh; out-of-scope saves stored as `rejected` with a reason |
| P5 | Rubric edited while phones are offline | Rubric versioned per published course |
| P6 | Deploy breaks the cached shell | Versioned service worker set; update on tap only |
| P7 | Phone clock changed to backdate | Server date is authoritative; `deviceTime` vs `receivedAt` stored and shown to the admin |
| P8 | Two tabs sync at once | Web Locks + idempotency |
| P9 | Shared view leaks another hospital's data, or colleagues' grades | Server-derived scope; `/day` returns names/status only; automated leakage test |
| P10 | CSRF on the JSON API | Origin check + JSON-only + SameSite=Lax |
| P11 | Polling overloads the free Neon database | 30 s only while visible, backoff when idle, small indexed endpoint |
| P12 | Session expires during a long offline shift | 14-day sliding evaluator sessions, revocable |
| P13 | Admin approves A, then a stale queued save from B arrives | Opens a **new** conflict; nothing applied silently (§2.3) |
| P14 | Evaluator edits while disputed | Frozen until the admin decides (§2.3) |
| P15 | Disputed grade distorts statistics or at-risk flags | Excluded until resolved (§2.3) |
| P16 | Save arrives after day 7 | Stored as `late`; admin may accept (§2.4) |
| P17 | Edit arrives after the admin locked | Stored as `rejected: locked`, shown to both (§2.5) |
| P18 | Notification spam, or duplicate reminders | `ReminderLog` unique per stage; at most 4 reminders per date |
| P19 | Formula injection in exports | Plain strings; CSV escaping (§7) |

---

## 11. Build order

Each step is shippable and verified before the next one starts. Order after Goal 1: **S1–S9 (matrix) → E1–E10**. E1–E5 may start before the matrix is finished.

| Step | Deliverable | Verification |
|---|---|---|
| **E1** | Migration (§3); `todayBaghdad()`; validation fixes (NaN, 0.5 steps, all sections, window) | Unit tests |
| **E2** | Server sessions: active check, revoke, 14-day sliding for evaluators; admin Sessions page | Deactivated account gets 401 immediately |
| **E3** | `POST /submissions`: idempotency, state rules, journal + conflict in one transaction; flags skip DISPUTED | Concurrent A/B → DISPUTED with both stored; same key → `duplicate`; lock → `rejected` |
| **E4** | Claims, take-over, `/day` shared view (names/status only), `/attention` | Cross-hospital and colleague-grade leakage tests |
| **E5** | Admin **Review Inbox**: conflicts (approve one), late (accept), rejected, overdue; lock/unlock scopes | Approve B → evaluation = B, audit written, both evaluators see the outcome |
| **E6** | Course bundle + version (reads the published matrix) | A matrix edit bumps the version |
| **E7** | App shell `/e`: tokens, font, icons, nav, screens ①–④ + Sync + drafts; per-account IndexedDB; outbox; Web-Locks sync; 401 state; versioned service worker; `storage.persist()` | Playwright offline test: open cold offline → grade 3 students → reconnect → all applied; 375 px RTL + contrast check |
| **E8** | Reminders: in-app, badge, Web Push (VAPID, Cloudflare Cron), Periodic Sync, `ReminderLog` | Seeded missing items → day-3 / 5 / 6 reminders fire once each |
| **E9** | Excel (server + on-device), install flow (Android prompt + iOS guide), manifest | Manual check on Android Chrome + iPhone Safari |
| **E10** | Redirect old evaluator routes; end-to-end run: two evaluators, same group, offline conflict → admin approves → lock → late edit rejected | Full scripted run on a seeded DB |

---

## 12. Not in this goal (later)

- **Grading Center rebuild.** It will absorb the Review Inbox and show `deviceTime`, `receivedAt`, and the journal history per evaluation.
- Optional app PIN / biometric lock for lost-phone protection.
- Student-facing view of approved grades (the existing `/me` keeps working and shows only ACTIVE evaluations).
