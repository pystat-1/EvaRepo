# Eva v3 — Active Goals & Progress

**Read this file first in any new session before doing anything else.** It is the
persistent memory across context resets / session-limit restarts. After finishing
any task below, update its status and the "Session Log" at the bottom **before**
ending the turn — that is the mechanism that lets work continue across restarts.

Knowledge base: `graphify-out/GRAPH_REPORT.md` (human-readable) and
`graphify-out/graph.json` (queryable — `graphify query "<question>"`) hold a full
structural map of this codebase. Consult them before large changes; re-run
`graphify <path> --update` after significant structural changes so they stay current.

Live site: https://eva-v3-app.netlify.app · Repo: https://github.com/pystat-1/EvaRepo
Neon project: `dry-cell-81671466` (DB name `eva`) · Netlify site: `eva-v3-app` (id `400fb70b-5646-424a-baf2-ae5cfd9e5e9b`)

---

## Goal 1: Evaluator schedule view — "import the group and start evaluating"

**Status: DONE** (2026-09-15) — `/schedule` page, `getEvaluatorSchedule()` in
`src/lib/models/evaluators.ts`, roster import via `listActiveStudentsInGroup()`.
Nav link added to `(evaluator)/layout.tsx`.

Evaluators currently only see `/my` (today's scoped students, flat list — added in the
rotation-enforcement work). Add a schedule-first view: an evaluator-facing page showing
their own upcoming/past rotation stints (which group, which hospital, which dates —
mirrors the admin `/setup` Gantt timeline but scoped to just this evaluator's
assignments), so they can see their whole rotation at a glance and jump straight into
grading any of their scheduled groups, not just whoever's scheduled *today*.

Plan:
- [ ] New model function: resolve an evaluator's own rotation stints (their
      `EvaluatorAssignment` rows → matching `RotationBlock`s for those groups/hospitals)
- [ ] New page e.g. `/schedule` in the `(evaluator)` route group
- [ ] Each stint links into the existing `/grade/[studentId]` flow (or a new
      "grade this group now" list) — respecting the existing schedule enforcement
      (`getScheduledRotationForDate`, `canEvaluatorGradeGroupAtHospital`) already built
- [ ] Add nav link in `(evaluator)/layout.tsx`

## Goal 2: Zero data loss — permanent storage, Google-account-linked

**Status: OAuth flow DONE** (2026-09-15). Credentials received from the user
(2026-09-15) and set as Netlify env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
(secret-scoped — never written to any file in this repo, never logged here).

Decisions (2026-09-15):
- Google Sign-In is **added alongside** email+password, not a replacement.
- Google login only ever signs in to an **existing** account (matched by email,
  linked on first successful sign-in) — it never creates a new account. Preserves
  the admin-provisioned account model; no self-registration via Google.

Implemented:
- [x] Added `googleId` (nullable, unique) to `Account` in schema.prisma — migration
      `20260915000900_add_google_signin`, additive only, applied to production
- [x] `GET /api/auth/google` — redirects to Google's consent screen, CSRF state
      cookie
- [x] `GET /api/auth/google/callback` — exchanges code, verifies `email_verified`,
      finds-or-links the Account by email, issues the same JWT session cookie
      `signSession()`/`SESSION_COOKIE` that email+password login uses, redirects by
      role same as `loginAction`
- [x] "الدخول باستخدام Google" button on `/login`, with a translated error banner
      for each failure mode (no matching account, already linked elsewhere, etc.)

Not yet done:
- [ ] Verify live end-to-end (needs a real Google account to click through — could
      not fully test from an unattended/automated context; a human should try it
      once against `https://eva-v3-app.netlify.app/login` and report back)
- [ ] Account-linking UI: an already-logged-in user (email+password) can link their
      Google account from a settings page, rather than only at first sign-in with
      matching email (nice-to-have, not blocking)

Also queued, independent of the OAuth work (not started yet):
- [ ] Verify Neon's backup/PITR settings on the current plan and document them
- [ ] Add a scheduled export/backup routine (nightly `pg_dump` or Neon branch
      snapshot) so "zero data loss" has a concrete mechanism
- [ ] Audit that every grade-write path is transactional (already true for
      `upsertEvaluation` — confirm no other write path regressed this)

## Goal 3: Evaluator — download the day's detailed evaluation as Excel

**Status: DONE** (2026-09-15) — `GET /api/my/export?date=YYYY-MM-DD` using
`exceljs`, button on `/my`. Full per-rubric-section columns, not just totals.

An evaluator should be able to download an `.xlsx` of a given day's evaluations they
did (or are scheduled for) — full per-criterion detail, not just totals, matching the
Grading Center's level of detail.

Plan:
- [ ] Pick an Excel library (`exceljs` — no native deps, works in Netlify's
      serverless runtime; avoid `xlsx`/SheetJS's older license/CVE baggage)
- [ ] New route handler e.g. `/api/evaluations/export?date=YYYY-MM-DD` (or a
      server action returning a file) scoped to the logged-in evaluator's own
      graded students for that date
- [ ] Columns: student name/code/university number, hospital, attendance, each
      rubric section's score, total, notes/feedback
- [ ] Add a "تنزيل تقرير اليوم (Excel)" button on `/my` (or the new `/schedule` page)

## Goal 4: Offline-capable evaluation, sync when back online

**Status: IN PROGRESS (2026-09-14) — Phase 4a shipped, 4b next**

Decision: full offline capability — works with zero connectivity for hours, not just
resilient to brief drops. This is a genuinely large, multi-session build. Phased plan:

**Phase 4a — PWA shell (installable, static-asset offline)** — DONE (2026-09-14)
- [x] `manifest.json` + icons, service worker registration — `src/app/manifest.ts`
      (start_url `/my`, brand-colored icons at `public/icon-192.png` /
      `icon-512.png`), registered from `src/app/sw-register.tsx` in the root
      layout.
- [x] Service worker caches the evaluator app shell (JS/CSS) so the app *opens*
      offline, even before any data work — `public/sw.js`: precaches
      `public/offline.html` + icons, cache-first for `/_next/static/*`,
      network-first-with-offline-fallback for navigations. Deliberately does
      **not** cache dynamic/personalized HTML yet (grades, schedules) — that's
      explicit IndexedDB work in 4b/4c, not implicit HTTP caching.

**Phase 4b — "Import once": local data cache**
- [ ] IndexedDB store (via a small wrapper, e.g. `idb`) for: the evaluator's
      schedule (`getEvaluatorSchedule` result), each stint's student roster, the
      active rubric sections (`listRubricSections`), and any already-saved
      evaluations for context
- [ ] An explicit "استيراد الجدول للعمل دون اتصال" (import schedule for offline
      work) action on `/schedule` that fetches all of the above and populates
      IndexedDB in one shot

**Phase 4c — Offline-first grading UI**
- [ ] `/grade/[studentId]` reads from IndexedDB when offline (detect via
      `navigator.onLine` + actual fetch failure, not just the flag) instead of
      failing on the server component fetch
- [ ] Grade submission writes to a local outbox (IndexedDB) instead of calling the
      server action directly when offline; UI shows "محفوظ محليًا — سيُزامن عند
      الاتصال" (saved locally — will sync when online)

**Phase 4d — Sync queue**
- [ ] Background sync (Background Sync API where supported, falling back to an
      on-`online`-event flush) replays the outbox through the *existing*
      `gradeStudentAction`/`upsertEvaluation` — reuses all existing server-side
      enforcement (schedule check, hospital assignment check) unchanged
- [ ] Conflict handling: `upsertEvaluation` is already an upsert keyed on
      (studentId, dateISO), so a same-student-same-day double-write just becomes
      "last sync wins" — acceptable for one evaluator's own queued writes, but
      cross-device conflicts (two devices, same evaluator, same day, offline on
      both) need a explicit decision: last-write-wins (simple, current default) or
      surface a merge prompt. **Revisit before shipping 4d.**
- [ ] Handle: rubric changed on the server while evaluator was offline and had
      already scored against the old rubric shape — validate/remap on sync, surface
      a clear error rather than silently dropping scores for removed sections

Not started — Goals 1 and 3 (done) and the Google auth wiring (pending credentials)
take priority since they're smaller and don't block on anything. Start 4a once those
are clear.

## Open questions for the user

1. ~~Google Sign-In: replace or add alongside email/password?~~ **Answered: alongside.**
2. ~~Google OAuth client ID + secret~~ **Received 2026-09-15, set as Netlify env vars.**
3. ~~Offline: lightweight retry-queue, or full PWA/local-database?~~ **Answered: full PWA.**

No open questions remain — Goal 2's OAuth flow is implemented (needs a human to
click through it once to confirm live), Goal 4's PWA build is the
`eva-goals-autopilot` cloud routine's job now.

---

## Session Log

_Newest entry on top. One entry per work session — what was done, what's next._

### 2026-09-15 — Google Sign-In wired in
- Also set up and verified (via two capability tests) the `eva-goals-autopilot`
  cloud routine (trig_01Cy3PFo9Z5oF1HWJJyJrL24, hourly at :45) — confirmed it runs
  on genuinely independent cloud infrastructure (not the user's machine) and can
  push to this repo (required installing the Claude GitHub App for this repo,
  which the user did). It's working through Goal 4's phases autonomously now.
- User created the Google OAuth client and sent the Client ID/Secret. Set as
  Netlify env vars `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (secret-scoped).
- Implemented the full Google Sign-In flow: schema migration (additive `googleId`
  column), `/api/auth/google` + `/api/auth/google/callback` routes, login page
  button + error states. Google login only signs in to an existing
  admin-provisioned account (matched/linked by email) — never creates one.
- Migration applied to production (additive only, zero risk to existing rows).
- **Next step:** a human needs to actually click "الدخول باستخدام Google" on
  https://eva-v3-app.netlify.app/login once, with a real Google account matching
  an existing Eva account's email, to confirm the live flow end-to-end — this
  wasn't fully testable without a real Google account and browser interaction.
- **Root-caused and diagnosed the Netlify deploy issue flagged below**: it is
  NOT a webhook/GitHub-integration problem (the previous entry's hypothesis
  was wrong, corrected here). Tried a manual deploy trigger — it failed with
  `error_message: "Skipped due to account credit usage exceeded"`. **The
  Netlify team's build minutes/credits are exhausted** on this plan
  (`nf_team_dev`), almost certainly from the very high number of builds
  triggered across this long session (every push = a build). This blocks
  ALL deploys — auto and manual — until credits reset or the plan is
  upgraded, not just this one commit.
- **This directly affects `eva-goals-autopilot`**: it can keep committing
  working, buildable code, but none of it will actually go live until this
  is resolved. Code safety is unaffected (nothing is lost, just not
  deployed) but "confirm the deploy is ready" (a hard safety rule for that
  routine) will keep failing through no fault of the code itself.
- **Needs a human to resolve** — I cannot see Netlify billing/plan details
  or purchase more credits. Options: wait for the usage window to reset
  (check the Netlify dashboard for when), or upgrade the plan/add credits at
  https://app.netlify.com/projects/eva-v3-app (Site configuration → or team
  billing settings).
- **Until resolved**, `eva-goals-autopilot` should still make code progress
  (committing is still valuable — deploy will catch up once credits are
  available) but should NOT loop retrying the deploy-confirmation step for
  a long time each run if it sees this same "credit usage exceeded" error —
  note it in the log and move on rather than burning the whole run stuck
  polling a deploy that cannot succeed right now.

### 2026-09-14 — Goal 4 Phase 4a (PWA shell) shipped
- Autonomous run. Goal 2 (Google OAuth) still blocked — no
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` documented anywhere in this file —
  so it was skipped entirely, per this run's instructions.
- Read `node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`
  and `offline-support.md` first, per `AGENTS.md`: confirmed this Next.js
  version's `manifest.ts` file convention and the experimental `useOffline`
  hook both behave as expected, and that `useOffline` alone does **not**
  cover a full offline app open (it only retries soft navigations/Server
  Actions) — a service worker is required for that, matching the Phase 4a
  plan already written here.
- Implemented Phase 4a in full: `src/app/manifest.ts` (installable manifest,
  `start_url: "/my"`), two brand-colored PNG icons generated locally (no new
  dependency — a small one-off Python/zlib script, not checked in),
  `public/sw.js` (precache + cache-first for `/_next/static/*` + offline
  fallback on failed navigations), `public/offline.html` (static branded
  offline page), `src/app/sw-register.tsx` wired into the root layout, plus
  `themeColor`/`icons` metadata. Fixed a stale comment in
  `(evaluator)/layout.tsx` that still said the PWA work was "scoped for
  Phase 3".
- No schema/DB changes (none needed for 4a, per the hard safety rules).
  Verified with `npx tsc --noEmit` (clean) and `npx next build` (clean, zero
  errors) — also smoke-tested with `next start`: `/manifest.webmanifest`,
  `/sw.js`, `/offline.html`, `/icon-192.png` all serve 200, and `/login`'s
  HTML includes the `<link rel="manifest">` and `<meta name="theme-color">`
  tags. Pushed to `main` after rebasing onto a concurrent push-capability
  test commit that landed on origin mid-session (see the entry below this
  one) — final pushed commit is `8cb600a`.
- **Deploy check (per the hard safety rules): did not confirm ready.**
  Polled Netlify (`get-project` on site `400fb70b-5646-424a-baf2-ae5cfd9e5e9b`)
  for ~10 minutes after the push. `currentDeploy` never changed from
  `6aa886b7a192600008ef1a77` (commit `1be92b9`, the *previous* push, which
  itself deployed fine in ~64s) — no new deploy for `8cb600a` ever appeared,
  successful or failed. This doesn't look like a build failure (nothing to
  revert — the previous deploy is still `ready` and serving, so production
  isn't broken); it looks like the auto-deploy trigger itself didn't fire
  for this push. Per the rules ("never touch Netlify settings beyond
  read-only status checks"), did not attempt to investigate further or
  force a deploy — flagged at the top of this log for a human to check the
  site's repository/webhook link in the Netlify dashboard.
- **Next step:** a human should confirm Netlify is picking up pushes to
  `main` again (check Build & deploy settings / trigger a manual deploy if
  needed) and verify Phase 4a actually goes live. Once that's confirmed,
  continue with Goal 4 Phase 4b ("Import once": IndexedDB store for the
  evaluator's schedule/roster/rubric via a small wrapper like `idb`, plus an
  explicit "استيراد الجدول للعمل دون اتصال" import action on `/schedule`).
  Goal 2 stays skipped until the user hands over the Google OAuth
  credentials.

### 2026-09-14 — Push-capability re-test
- Cloud routine push-capability re-test succeeded after GitHub App install.

### 2026-09-15 — Goals 1 & 3 shipped, Goal 2/4 scoped
- User answered the open questions: Google Sign-In added alongside existing auth
  (user provisions OAuth credentials and will hand them over); offline goal is a
  full PWA (zero-connectivity-for-hours), not a lightweight retry queue.
- Built and deployed Goal 1 (`/schedule` — evaluator's own rotation stints,
  past/current/future, roster import into grading) and Goal 3 (`GET
  /api/my/export?date=` — per-day Excel export via `exceljs`, full rubric-section
  detail). Commit `32fd7ad`, verified live (see below).
- Wrote the full Phase 4a–4d plan for the offline PWA into Goal 4 above — did not
  start building it yet; it's the largest remaining piece.
- **Next step:** waiting on Google OAuth credentials from the user to continue
  Goal 2. In the meantime, start Goal 4 Phase 4a (PWA shell: manifest + service
  worker + installable app shell) since it doesn't depend on anything blocked.

### 2026-09-15 — Session start
- Ran `/graphify` on the full repo: 417 nodes, 970 edges, 32 communities.
  Outputs in `graphify-out/` (graph.json, GRAPH_REPORT.md, graph.html). Committed
  to the repo so it persists across sessions/machines.
- Created this goals file with the 4 requested goals broken into concrete tasks.
- Flagged Goals 2 and 4 as blocked on user decisions (see "Open questions" above) —
  did not start implementation on those to avoid committing to the wrong architecture.
- **Next step:** get answers to the open questions; meanwhile start Goal 1
  (evaluator schedule view) and Goal 3 (Excel export) since both are unambiguous
  and don't require a decision from the user.
